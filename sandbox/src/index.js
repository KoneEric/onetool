// Runs a JavaScript program in a process of its own. See the meeting point of sandbox.
//
// Lines on the program process's standard input (from here):
//   { t: "init", code, tools, state, shell, progress, library }  once, first; state is JSON text, or null when none
//                                                was given; shell is true when the program finds `$`, `read`, `write`
//                                                and `edit`; progress is true when it finds `progress`; library is
//                                                the list of { name, params, code }, or null when none was given
//   { t: "result", id, status, text }            the answer of a tool call: status "ok" (text is JSON),
//                                                "undefined" or "error" (text is the message)
// Lines on its standard output (to here):
//   { t: "log", s }   { t: "progress", s }   { t: "use", name, ok }   { t: "call", id, server, tool, args }
//   { t: "done", kind, text, state }
//   state is JSON text, or null when the state cannot be held; it is absent when none was given.
// checkWalls runs probe.mjs in a process started by the same code (launch), and reads one line of it.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHILD = fileURLToPath(new URL("./child.mjs", import.meta.url));
const PROBE = fileURLToPath(new URL("./probe.mjs", import.meta.url));
const FILES = [CHILD, fileURLToPath(new URL("./last-expression.mjs", import.meta.url))];
const DEFAULT_MEMORY_MB = 256;
const NOT_KEPT = "state was not kept: it cannot be sent as JSON";
const LONGEST_TIMER = 2 ** 31 - 1;

const running = new Set();
let listening = false;

function kill(child) {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

function listen() {
  if (listening) return;
  listening = true;
  process.on("exit", () => {
    for (const child of running) kill(child);
  });
}

// The one place a process of the sandbox is started: a program and the probe of checkWalls differ only in the
// file they run (and the files they may read).
function launch(script, { files, memoryMb, args = [] }) {
  const child = spawn(
    process.execPath,
    ["--permission", ...files.map((file) => `--allow-fs-read=${file}`), `--max-old-space-size=${memoryMb}`, script, ...args],
    { env: {}, stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
  );
  running.add(child);
  child.stdout.setEncoding("utf8");
  child.stdout.on("error", () => {});
  child.stdin.on("error", () => {});
  return child;
}

function onLines(child, onLine) {
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      onLine(line);
    }
  });
}

// The JSON text of a state the caller gave, or a TypeError.
function stateText(state) {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new TypeError("state must be a plain object that JSON.stringify can turn to text");
  }
  let text;
  try {
    text = JSON.stringify(state);
  } catch {
    throw new TypeError("state must be a plain object that JSON.stringify can turn to text");
  }
  const back = typeof text === "string" ? JSON.parse(text) : null;
  if (typeof back !== "object" || back === null || Array.isArray(back)) {
    throw new TypeError("state must be a plain object that JSON.stringify can turn to text");
  }
  return text;
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function checkLibrary(library) {
  const bad = new TypeError("library must be a list of { name, params, code }: a string, a list of strings, a string");
  if (!Array.isArray(library)) throw bad;
  for (const item of library) {
    if (!isPlainObject(item) || typeof item.name !== "string" || typeof item.code !== "string") throw bad;
    if (!Array.isArray(item.params) || !item.params.every((param) => typeof param === "string")) throw bad;
  }
}

function check(code, { tools, callTool, timeoutMs, memoryMb, shell, onProgress, signal, library, onLibrary }) {
  if (typeof code !== "string") throw new TypeError("code must be a string");
  if (typeof tools !== "object" || tools === null || Array.isArray(tools)) {
    throw new TypeError("tools must be an object of arrays of strings");
  }
  let named = false;
  for (const list of Object.values(tools)) {
    if (!Array.isArray(list) || !list.every((name) => typeof name === "string")) {
      throw new TypeError("tools must be an object of arrays of strings");
    }
    if (list.length > 0) named = true;
  }
  if (typeof shell !== "boolean") throw new TypeError("shell must be true or false");
  if ((named || shell) && typeof callTool !== "function") {
    throw new TypeError("callTool must be a function when tools names a tool or shell is true");
  }
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a finite number above 0");
  }
  if (typeof memoryMb !== "number" || !Number.isInteger(memoryMb) || memoryMb < 16) {
    throw new TypeError("memoryMb must be a whole number of 16 or more");
  }
  if (onProgress !== undefined && typeof onProgress !== "function") throw new TypeError("onProgress must be a function");
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError("signal must be an AbortSignal");
  if (library !== undefined) {
    checkLibrary(library);
    if (typeof callTool !== "function") throw new TypeError("callTool must be a function when library is given");
  }
  if (onLibrary !== undefined && typeof onLibrary !== "function") throw new TypeError("onLibrary must be a function");
}

// A line goes to the caller's function; what it does or returns is no concern of the program.
function post(onProgress, line) {
  try {
    const returned = onProgress(line);
    if (returned instanceof Promise) returned.catch(() => {});
  } catch {
    // the program is not told
  }
}

function messageOf(thrown) {
  try {
    const message = thrown?.message;
    if (message !== undefined && message !== null) return String(message);
  } catch {
    // fall through
  }
  try {
    return String(thrown);
  } catch {
    return "";
  }
}

export async function runProgram(
  code,
  { tools = {}, callTool, timeoutMs = 60000, memoryMb = DEFAULT_MEMORY_MB, state, shell = false, onProgress, signal, library, onLibrary } = {},
) {
  check(code, { tools, callTool, timeoutMs, memoryMb, shell, onProgress, signal, library, onLibrary });
  const given = state === undefined ? undefined : stateText(state);
  const stopped = () => {
    const result = { ok: false, error: { kind: "stopped", message: "stopped by the caller" }, logs: [] };
    if (given !== undefined) result.state = JSON.parse(given);
    return result;
  };
  if (signal?.aborted) return stopped();
  listen();

  return new Promise((resolve) => {
    const logs = [];
    let finished = false;

    const child = launch(CHILD, { files: FILES, memoryMb });

    const timer = setTimeout(
      () => finish({ ok: false, error: { kind: "timeout", message: `stopped after ${timeoutMs} ms` }, logs }),
      Math.min(timeoutMs, LONGEST_TIMER),
    );

    // childState: the state text the program's process sent; anything else gives the argument back.
    function finish(result, childState) {
      if (finished) return;
      finished = true;
      if (given !== undefined) result.state = JSON.parse(typeof childState === "string" ? childState : given);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      running.delete(child);
      kill(child);
      resolve(result);
    }
    const onAbort = () => fail("stopped", "stopped by the caller");
    const fail = (kind, message, childState) => finish({ ok: false, error: { kind, message }, logs }, childState);

    const send = (message) => {
      if (child.stdin.writable) child.stdin.write(JSON.stringify(message) + "\n");
    };

    async function answer({ id, server, tool, args }) {
      let reply;
      try {
        if (finished) return;
        const value = await callTool(server, tool, JSON.parse(args));
        const json = value === undefined ? undefined : JSON.stringify(value);
        reply = json === undefined ? { status: "undefined" } : { status: "ok", text: json };
      } catch (thrown) {
        reply = { status: "error", text: messageOf(thrown) };
      }
      if (!finished) send({ t: "result", id, ...reply });
    }

    function onLine(line) {
      if (finished) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.t === "log") logs.push(message.s);
      else if (message.t === "progress") {
        if (onProgress !== undefined) post(onProgress, message.s);
      }
      else if (message.t === "use") {
        if (onLibrary !== undefined) post(onLibrary, { name: String(message.name), ok: message.ok === true });
      }
      else if (message.t === "call") answer(message);
      else if (message.t === "done") {
        if (message.kind === "error") fail("error", message.text, message.state);
        else if (given !== undefined && typeof message.state !== "string") fail("error", NOT_KEPT);
        else finish({ ok: true, value: message.kind === "value" ? JSON.parse(message.text) : undefined, logs }, message.state);
      }
    }

    onLines(child, onLine);
    child.on("error", () => fail("crash", "code null, signal null"));
    child.on("close", (exitCode, signal) => fail("crash", `code ${exitCode}, signal ${signal}`));

    signal?.addEventListener("abort", onAbort, { once: true });
    send({
      t: "init",
      code,
      tools,
      state: given ?? null,
      shell,
      progress: onProgress !== undefined,
      library: library === undefined ? null : library.map(({ name, params, code }) => ({ name, params, code })),
    });
  });
}

const WALL = new Set(["refused", "done", "failed"]);

export async function checkWalls(probePath, { timeoutMs = 10000 } = {}) {
  if (typeof probePath !== "string" || probePath === "") throw new TypeError("probePath must be the path of a file");
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a finite number above 0");
  }
  listen();

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = launch(PROBE, { files: [...FILES, PROBE], memoryMb: DEFAULT_MEMORY_MB, args: [probePath] });

    const timer = setTimeout(
      () => settle(() => reject(new Error(`the probe did not answer in ${timeoutMs} ms`))),
      Math.min(timeoutMs, LONGEST_TIMER),
    );

    function settle(outcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      running.delete(child);
      kill(child);
      outcome();
    }

    onLines(child, (line) => {
      let walls;
      try {
        walls = JSON.parse(line);
      } catch {
        return;
      }
      const keys = ["read", "write", "spawn", "worker"];
      if (walls === null || typeof walls !== "object" || !keys.every((key) => WALL.has(walls[key]))) return;
      settle(() => resolve(Object.fromEntries(keys.map((key) => [key, walls[key]]))));
    });
    const ended = () => settle(() => reject(new Error("the probe ended before it answered")));
    child.on("error", ended);
    child.on("close", ended);
  });
}
