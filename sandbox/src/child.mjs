// The process of the program. It reads one JSON object per line on standard input and writes one per line on
// standard output; see index.js for the lines. The program runs in a context of its own, and only strings cross
// between that context and this code, so nothing of this realm (and so no `process`) reaches the program.
import vm from "node:vm";
import { withLastExpression } from "./last-expression.mjs";

// Runs inside the context. It may use nothing from outside but `host`, which is held by its closures alone.
function bootstrap(host) {
  "use strict";
  const { stringify, parse } = JSON;
  const text = String;
  const AsyncFunction = (async function () {}).constructor;
  const { getPrototypeOf } = Object;
  const ObjectPrototype = Object.prototype;
  const define = (name, value) =>
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });

  // A stack trace would hand the program the functions of the frames that made it.
  Object.defineProperty(Error, "prepareStackTrace", { value: undefined, writable: false, configurable: false });

  const describe = (thrown) => {
    try {
      return thrown instanceof Error ? thrown.name + ": " + thrown.message : text(thrown);
    } catch (_) {
      return "";
    }
  };

  const toText = (argument) => {
    if (typeof argument === "string") return argument;
    if (argument === undefined) return "undefined";
    try {
      const json = stringify(argument);
      if (json !== undefined) return json;
    } catch (_) {}
    try {
      return text(argument);
    } catch (_) {
      return "";
    }
  };
  const console = {};
  for (const name of ["log", "info", "warn", "error", "debug"]) {
    console[name] = (...args) => host.log(args.map(toText).join(" "));
  }
  define("console", console);

  // `progress`, when the caller gave onProgress: a line built as console.log builds its string, posted at once.
  const defineProgress = () => {
    define("progress", function progress(...args) {
      host.progress(args.map(toText).join(" "));
    });
  };

  const timers = new Map();
  let timerId = 0;
  define("setTimeout", function setTimeout(callback, delay, ...args) {
    if (typeof callback !== "function") throw new TypeError("The callback must be a function");
    delay = Number(delay);
    if (!(delay >= 1)) delay = 1;
    const id = ++timerId;
    timers.set(id, [callback, args]);
    host.timer(id, Math.min(delay, 2147483647));
    return id;
  });
  define("clearTimeout", function clearTimeout(id) {
    if (timers.delete(id)) host.untimer(id);
  });

  // The global `state`, when the caller gave one; the object the result is read from.
  let kept = null;
  const readState = () => {
    if (kept === null) return undefined;
    try {
      const json = stringify(kept);
      const back = typeof json === "string" ? parse(json) : null;
      if (typeof back === "object" && back !== null && !Array.isArray(back)) return json;
    } catch (_) {}
    return null;
  };

  const pending = new Map();
  let callId = 0;
  const makeTool = (server, tool) =>
    async function (args) {
      let json;
      try {
        json = args === undefined ? "{}" : stringify(args);
      } catch (_) {
        throw new Error("the arguments cannot be sent as JSON");
      }
      if (json === undefined) json = "{}";
      return new Promise((resolve, reject) => {
        const id = ++callId;
        pending.set(id, [resolve, reject]);
        host.call(id, server, tool, json);
      });
    };

  // The four names of `shell: true`: more ways to make a tool call of the server "shell", nothing else.
  const defineShell = () => {
    const callRead = makeTool("shell", "read");
    const callWrite = makeTool("shell", "write");
    const callEdit = makeTool("shell", "edit");
    const callRun = makeTool("shell", "run");

    define("read", async function read(path) {
      return callRead({ path });
    });
    define("write", async function write(path, text) {
      return callWrite({ path, text });
    });
    define("edit", async function edit(path, old, replacement) {
      return callEdit({ path, old, new: replacement });
    });

    const quote = (value) => "'" + value.split("'").join("'\\''") + "'";
    const word = (value) => {
      const kind = typeof value;
      if (kind === "string") return quote(value);
      if (kind === "number" || kind === "boolean") return quote(text(value));
      throw new TypeError("a value in a command must be a string, a number, a boolean or a list of them");
    };
    const insert = (value) => {
      if (!Array.isArray(value)) return word(value);
      let out = "";
      for (let i = 0; i < value.length; i++) out += (i > 0 ? " " : "") + word(value[i]);
      return out;
    };
    const failure = ({ exitCode, stdout, stderr }) => {
      const detail = stderr.trim().slice(0, 500);
      const error = new Error("the command failed with exit code " + exitCode + (detail === "" ? "" : ": " + detail));
      error.exitCode = exitCode;
      error.stdout = stdout;
      error.stderr = stderr;
      return error;
    };

    // A command object starts nothing until `then` or `text` is called; then it makes the one call.
    const command = (commandText) => {
      let started = null;
      let throws = true;
      const start = () => {
        if (started === null) {
          started = callRun({ command: commandText }).then((result) => {
            if (throws && result.exitCode !== 0) throw failure(result);
            return result;
          });
        }
        return started;
      };
      const object = {
        then: (onDone, onFail) => start().then(onDone, onFail),
        text: () => start().then((result) => result.stdout),
        nothrow() {
          throws = false;
          return object;
        },
      };
      return object;
    };

    define("$", function $(first) {
      if (typeof first === "string") return command(first);
      if (Array.isArray(first) && Array.isArray(first.raw)) {
        const raw = first.raw;
        let out = raw[0];
        for (let i = 1; i < arguments.length; i++) out += insert(arguments[i]) + raw[i];
        return command(out);
      }
      throw new TypeError("$ takes a template or one string");
    });
  };

  // `lib` and `library`, when the caller gave a library: the saved programs run here, in this world, as one more
  // way to run text; `library.save`, `remove`, `report`, `restore` and `read` are five more ways to make a tool call
  // of the server "library". Nothing else is given to the program.
  const IDENTIFIER = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
  const defineLibrary = (items) => {
    const isPlain = (value) => {
      if (typeof value !== "object" || value === null) return false;
      const prototype = getPrototypeOf(value);
      return prototype === ObjectPrototype || prototype === null;
    };

    // Each name of params is checked as a bare identifier before it is handed to the compiler, so that no text of
    // params can end the parameter list; the compiler then refuses what the language refuses.
    const compileItem = (params, code) => {
      for (const param of params) {
        if (!IDENTIFIER.test(param)) throw new SyntaxError("Invalid parameter name: " + param);
      }
      let fn = new AsyncFunction(...params, code);
      for (const variant of parse(host.variants(code))) {
        try {
          fn = new AsyncFunction(...params, variant);
          break;
        } catch (_) {}
      }
      return fn;
    };

    const makeSaved = (name, params, code) => {
      let compiled = null;
      return async function (args) {
        let ok = false;
        try {
          if (args === undefined) args = {};
          else if (!isPlain(args)) throw new TypeError("the arguments of a saved program must be an object");
          if (compiled === null) {
            try {
              compiled = { fn: compileItem(params, code) };
            } catch (thrown) {
              compiled = { thrown };
            }
          }
          if ("thrown" in compiled) throw compiled.thrown;
          const values = [];
          for (const param of params) values.push(args[param]);
          const value = await compiled.fn(...values);
          ok = true;
          return value;
        } finally {
          host.use(name, ok);
        }
      };
    };

    const lib = {};
    for (const { name, params, code } of items) {
      Object.defineProperty(lib, name, { value: makeSaved(name, params, code), writable: true, enumerable: true, configurable: true });
    }
    define("lib", lib);

    const callSave = makeTool("library", "save");
    const callRemove = makeTool("library", "remove");
    const library = {};
    Object.defineProperty(library, "save", {
      value: async function save(name, options) {
        const given = typeof options === "object" && options !== null ? options : {};
        return callSave({ name, about: given.about, params: given.params, code: given.code, replace: given.replace });
      },
      writable: true, enumerable: true, configurable: true,
    });
    Object.defineProperty(library, "remove", {
      value: async function remove(name) {
        return callRemove({ name });
      },
      writable: true, enumerable: true, configurable: true,
    });
    const callReport = makeTool("library", "report");
    const callRestore = makeTool("library", "restore");
    const callRead = makeTool("library", "read");
    Object.defineProperty(library, "report", {
      value: async function report() {
        return callReport({});
      },
      writable: true, enumerable: true, configurable: true,
    });
    Object.defineProperty(library, "restore", {
      value: async function restore(name) {
        return callRestore({ name });
      },
      writable: true, enumerable: true, configurable: true,
    });
    Object.defineProperty(library, "read", {
      value: async function read(name) {
        return callRead({ name });
      },
      writable: true, enumerable: true, configurable: true,
    });
    define("library", library);
  };

  return {
    init(toolsJson, stateJson, shell, posts, libraryJson) {
      if (shell) defineShell();
      if (posts) defineProgress();
      if (stateJson !== null) {
        kept = parse(stateJson);
        Object.defineProperty(globalThis, "state", { value: kept, writable: false, configurable: false, enumerable: false });
      }
      const spec = parse(toolsJson);
      const tools = {};
      for (const server of Object.keys(spec)) {
        const entry = {};
        for (const tool of spec[server]) {
          Object.defineProperty(entry, tool, {
            value: makeTool(server, tool), writable: true, enumerable: true, configurable: true,
          });
        }
        Object.defineProperty(tools, server, { value: entry, writable: true, enumerable: true, configurable: true });
      }
      define("tools", tools);
      if (libraryJson !== null) defineLibrary(parse(libraryJson));
    },
    compile: (body) => new AsyncFunction(body),
    fail: (thrown) => host.done("error", describe(thrown), readState()),
    start(fn) {
      (async () => {
        let value;
        try {
          value = await fn();
        } catch (thrown) {
          host.done("error", describe(thrown), readState());
          return;
        }
        const state = readState();
        let json;
        try {
          json = stringify(value);
        } catch (_) {
          host.done("error", "the value cannot be sent as JSON", state);
          return;
        }
        if (json === undefined) host.done("undefined", "", state);
        else host.done("value", json, state);
      })();
    },
    fire(id) {
      const timer = timers.get(id);
      if (!timer) return;
      timers.delete(id);
      try {
        timer[0](...timer[1]);
      } catch (thrown) {
        host.done("error", describe(thrown), readState());
      }
    },
    deliver(id, status, answer) {
      const call = pending.get(id);
      if (!call) return;
      pending.delete(id);
      if (status === "ok") call[0](parse(answer));
      else if (status === "undefined") call[0](undefined);
      else call[1](new Error(answer));
    },
  };
}

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
// Whatever goes wrong here must not reach the program, nor end this process.
const quiet = (fn) => {
  try {
    fn();
  } catch (_) {}
};

const timeouts = new Map();
let boot;
const host = {
  log: (line) => quiet(() => send({ t: "log", s: String(line) })),
  progress: (line) => quiet(() => send({ t: "progress", s: String(line) })),
  use: (name, ok) => quiet(() => send({ t: "use", name: String(name), ok: ok === true })),
  // the texts a saved program may be run as (see last-expression.mjs), as JSON text: only strings cross
  variants: (code) => {
    try {
      return JSON.stringify([...withLastExpression(String(code))]);
    } catch (_) {
      return "[]";
    }
  },
  call: (id, server, tool, args) => quiet(() => send({ t: "call", id, server, tool, args })),
  // state: JSON text; null when it cannot be held; undefined (left out of the line) when none was given
  done: (kind, answer, state) => quiet(() => send({ t: "done", kind, text: String(answer), state })),
  timer: (id, delay) =>
    quiet(() =>
      timeouts.set(
        id,
        setTimeout(() => {
          timeouts.delete(id);
          quiet(() => boot.fire(id));
        }, delay),
      ),
    ),
  untimer: (id) =>
    quiet(() => {
      clearTimeout(timeouts.get(id));
      timeouts.delete(id);
    }),
};

const context = vm.createContext(Object.create(null));
boot = vm.runInContext("(" + bootstrap.toString() + ")", context)(host);

function run({ code, tools, state, shell, progress, library }) {
  boot.init(JSON.stringify(tools), state, shell === true, progress === true, Array.isArray(library) ? JSON.stringify(library) : null);
  let fn;
  try {
    fn = boot.compile(code);
  } catch (thrown) {
    boot.fail(thrown);
    return;
  }
  for (const text of withLastExpression(code)) {
    try {
      fn = boot.compile(text);
      break;
    } catch (_) {}
  }
  boot.start(fn);
}

function onMessage(message) {
  if (message.t === "init") run(message);
  else if (message.t === "result") quiet(() => boot.deliver(message.id, message.status, message.text));
}

// A caller that has gone, or has no more to say, leaves nothing to run for.
process.on("unhandledRejection", () => {});
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    onMessage(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
