import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, waitFor, sleep } from "./helpers.js";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const T = '"return typeof process"';

let folder;
let probePath;
before(() => {
  folder = mkdtempSync(join(tmpdir(), "onetool-progress-"));
  probePath = join(folder, "probe-target.txt");
  writeFileSync(probePath, "secret text of the probe file\n");
});
after(() => rmSync(folder, { recursive: true, force: true }));

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs");

function fixtureJson(scenario) {
  const r = spawnSync(process.execPath, [fixture("stop.mjs"), scenario, probePath], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.error, undefined, String(r.error));
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// A caller's onProgress that keeps what it was called with.
function listener(impl = () => undefined) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl(...args);
  };
  fn.calls = calls;
  fn.lines = () => calls.map((args) => args[0]);
  return fn;
}

describe("without the argument onProgress, the sections above hold", () => {
  const options = [
    ["no options", undefined],
    ["onProgress absent", {}],
    ["onProgress undefined", { onProgress: undefined }],
    ["onProgress undefined with a signal that does not abort", { onProgress: undefined, signal: new AbortController().signal }],
  ];
  for (const [name, opts] of options) {
    test(`${name}: progress is undefined`, async () => {
      expectOk(await runProgram("return [typeof progress, 'progress' in globalThis, typeof globalThis.progress]", opts), [
        "undefined",
        false,
        "undefined",
      ]);
    });

    test(`${name}: a program that uses progress fails with the usual ReferenceError`, async () => {
      expectFail(await runProgram('progress("x")', opts), "error", "ReferenceError: progress is not defined", []);
    });
  }

  test("the result has the same keys as before", async () => {
    expectOk(await runProgram("1 + 1", { onProgress: undefined }), 2);
    expectOk(await runProgram("console.log('x'); 1 + 1", { onProgress: undefined }), 2, ["x"]);
  });
});

describe("with onProgress, the program finds progress", () => {
  test("it is a function, at once, and gives undefined: nothing to await", async () => {
    const onProgress = listener();
    const r = await runProgram(
      'const got = progress("a"); return [typeof progress, got === undefined, typeof got, got instanceof Promise]',
      { onProgress },
    );
    expectOk(r, ["function", true, "undefined", false]);
    assert.deepStrictEqual(onProgress.lines(), ["a"]);
  });

  test("several calls in a row are handed over in order, whether or not anything is awaited", async () => {
    const onProgress = listener();
    expectOk(await runProgram('progress("a");\nprogress("b");\nprogress("c");\n1', { onProgress }), 1);
    assert.deepStrictEqual(onProgress.lines(), ["a", "b", "c"]);
  });

  test("onProgress is called once for each call, with one argument, in the order of the calls", async () => {
    const onProgress = listener();
    const r = await runProgram("for (let i = 0; i < 200; i++) progress(i);\nreturn 'done'", { onProgress });
    expectOk(r, "done");
    // number i is the text JSON.stringify(i) gives: String(i)
    assert.deepStrictEqual(onProgress.lines(), Array.from({ length: 200 }, (_, i) => String(i)));
    assert.ok(onProgress.calls.every((args) => args.length === 1), "onProgress was given more than the line");
  });

  test("a line is a string, whatever the program gave", async () => {
    const onProgress = listener();
    await runProgram('progress({ a: 1 }); progress(5); progress(null); progress(true); progress(["x"])', { onProgress });
    assert.deepStrictEqual(onProgress.lines(), ['{"a":1}', "5", "null", "true", '["x"]']);
    assert.ok(onProgress.lines().every((l) => typeof l === "string"));
  });

  test("the arguments are turned to text and joined by one space; none gives the empty string", async () => {
    const onProgress = listener();
    await runProgram(
      [
        'progress("a", "b");',
        'progress("a", 1, { k: [1] }, undefined, null);',
        "progress();",
        'progress("");',
        'progress("", "");',
        'progress("x", undefined);',
        "progress(undefined);",
      ].join("\n"),
      { onProgress },
    );
    assert.deepStrictEqual(onProgress.lines(), ["a b", 'a 1 {"k":[1]} undefined null', "", "", " ", "x undefined", "undefined"]);
  });

  test("a line is built as a call of console.log builds its string, also for the odd arguments", async () => {
    const onProgress = listener();
    const args = [
      "[]",
      "[undefined]",
      '[Symbol("s")]',
      "[1n]",
      "[(() => 1)]",
      "[(() => { const a = {}; a.a = a; return a })()]",
      '[{ toJSON() { throw new Error("no") } }]',
      "[new Date(0)]",
      '["a", 2n, Symbol.iterator]',
      "[NaN, Infinity, -0]",
      '[new Error("e")]',
      '[{ toString() { throw new Error("no") }, toJSON() { return undefined } }]',
    ];
    const code = args.map((a) => `{ const a = ${a}; console.log(...a); progress(...a) }`).join("\n") + "\nreturn 1";
    const r = await runProgram(code, { onProgress });
    expectOk(r, 1, r.logs);
    assert.strictEqual(r.logs.length, args.length);
    assert.deepStrictEqual(onProgress.lines(), r.logs);
    // the rule the text gives: a Symbol, a BigInt and a function have no JSON, so String(argument)
    assert.strictEqual(r.logs[2], "Symbol(s)");
    assert.strictEqual(r.logs[3], "1");
  });

  test("what onProgress returns is not read: a value, a promise that never settles, a rejected promise", async () => {
    const onProgress = listener((line) => (line === "a" ? 5 : line === "b" ? new Promise(() => {}) : { then() {} }));
    expectOk(await runProgram('progress("a"); progress("b"); progress("c"); return "end"', { onProgress }), "end");
    assert.deepStrictEqual(onProgress.lines(), ["a", "b", "c"]);
  });

  test("when onProgress throws, the program is not told, the run goes on, and the next line is handed over", async () => {
    const onProgress = listener((line) => {
      if (line === "b") throw new Error("the caller's function failed");
      if (line === "c") throw "a string";
    });
    const r = await runProgram(
      'let told = 0; for (const l of ["a", "b", "c", "d"]) { try { progress(l) } catch (e) { told++ } }\nreturn told',
      { onProgress },
    );
    expectOk(r, 0);
    assert.deepStrictEqual(onProgress.lines(), ["a", "b", "c", "d"]);
  });

  test("when onProgress throws every time, the program still ends with its value", async () => {
    const onProgress = listener(() => {
      throw new Error("always");
    });
    expectOk(await runProgram('progress("a"); progress("b"); await null; progress("c"); return "end"', { onProgress }), "end");
    assert.deepStrictEqual(onProgress.lines(), ["a", "b", "c"]);
  });

  test("a throwing onProgress leaves no failure in the caller", async () => {
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const onProgress = listener(() => {
        throw new Error("always");
      });
      expectOk(await runProgram('progress("a"); progress("b"); 1', { onProgress }), 1);
      await sleep(150);
      assert.deepStrictEqual(onProgress.lines(), ["a", "b"]);
      assert.deepStrictEqual(failures, []);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });

  test("a line is not added to logs, and console.log does not call onProgress", async () => {
    const onProgress = listener();
    const r = await runProgram('console.log("log 1"); progress("line 1"); console.warn("log 2"); progress("line 2"); 7', {
      onProgress,
    });
    expectOk(r, 7, ["log 1", "log 2"]);
    assert.deepStrictEqual(onProgress.lines(), ["line 1", "line 2"]);
    const onlyLogs = listener();
    expectOk(await runProgram('console.log("a"); console.info("b"); console.error("c"); console.debug("d"); 1', { onProgress: onlyLogs }), 1, ["a", "b", "c", "d"]);
    assert.deepStrictEqual(onlyLogs.calls, []);
  });

  test("the program may hide progress with a declaration of its own", async () => {
    const onProgress = listener();
    expectOk(await runProgram('const progress = (...a) => "mine:" + a.join(","); return [progress("x", "y"), typeof progress]', { onProgress }), [
      "mine:x,y",
      "function",
    ]);
    expectOk(await runProgram('let progress = 3; return progress', { onProgress }), 3);
    assert.deepStrictEqual(onProgress.calls, []);
    expectOk(await runProgram('progress("global"); 1', { onProgress }), 1);
    assert.deepStrictEqual(onProgress.lines(), ["global"]);
  });

  test("the value is the program's own, whatever is posted: progress adds nothing to the result", async () => {
    const onProgress = listener();
    const r = await runProgram('progress("a"); progress("b")', { onProgress });
    expectOk(r, undefined);
    assert.ok(!("state" in r));
  });
});

describe("every line posted before the end is handed over before the promise resolves", () => {
  test("ok: true", async () => {
    const onProgress = listener();
    const r = await runProgram("for (let i = 0; i < 300; i++) progress('p' + i);\nprogress('last');\nreturn 1", { onProgress });
    expectOk(r, 1);
    const seen = onProgress.lines().length;
    assert.strictEqual(seen, 301, "a line was not handed over when the promise resolved");
    assert.strictEqual(onProgress.lines()[300], "last");
  });

  test("ok: true, after a wait for a timer and the value of the last line", async () => {
    const onProgress = listener();
    const r = await runProgram("progress('a');\nawait new Promise((r) => setTimeout(r, 30));\nprogress('b');\n2 + 3", { onProgress });
    expectOk(r, 5);
    assert.deepStrictEqual(onProgress.lines(), ["a", "b"]);
  });

  test("kind error: the program threw after it posted", async () => {
    const onProgress = listener();
    const r = await runProgram("for (let i = 0; i < 100; i++) progress(i);\nthrow new Error('boom')", { onProgress });
    expectFail(r, "error", "Error: boom", []);
    assert.strictEqual(onProgress.lines().length, 100);
    assert.strictEqual(onProgress.lines()[99], "99");
  });

  test("kind error: the value cannot be sent as JSON", async () => {
    const onProgress = listener();
    const r = await runProgram("progress('a'); progress('b'); return 1n", { onProgress });
    expectFail(r, "error", "the value cannot be sent as JSON", []);
    assert.deepStrictEqual(onProgress.lines(), ["a", "b"]);
  });

  test("with state, a tool call and logs, all of them still as they were", async () => {
    const onProgress = listener();
    const callTool = recorder(async (server, tool, args) => ({ echo: args.n }));
    const r = await runProgram(
      "progress('before'); const a = await tools.s.t({ n: 1 }); state.n = a.echo; console.log('log'); progress('after'); return a.echo",
      { onProgress, callTool, tools: { s: ["t"] }, state: { n: 0 } },
    );
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.strictEqual(r.value, 1);
    assert.deepStrictEqual(r.logs, ["log"]);
    assert.deepStrictEqual(r.state, { n: 1 });
    assert.deepStrictEqual(onProgress.lines(), ["before", "after"]);
    assert.deepStrictEqual(callTool.calls, [["s", "t", { n: 1 }]]);
  });
});

describe("onProgress is never called after the promise has resolved", () => {
  async function noLateLine(code, options, kind, message) {
    let resolved = false;
    let late = 0;
    let count = 0;
    const onProgress = (line) => {
      count++;
      if (resolved) late++;
    };
    const r = await runProgram(code, { ...options, onProgress });
    resolved = true;
    expectFail(r, kind, message);
    assert.ok(count > 0, "the program posted no line before it was stopped");
    const atResolve = count;
    await sleep(300);
    assert.strictEqual(late, 0, "onProgress was called after the promise resolved");
    assert.strictEqual(count, atResolve);
  }

  test("after a stop at the limit, by a program that posts all the time", async () => {
    await noLateLine("while (true) { progress('x'); await new Promise((r) => setTimeout(r, 1)) }", { timeoutMs: 500 }, "timeout", "stopped after 500 ms");
  });

  test("after a stop by the abort of a signal", async () => {
    const controller = new AbortController();
    let resolved = false;
    let late = 0;
    let count = 0;
    const onProgress = () => {
      count++;
      if (resolved) late++;
      if (count === 3) controller.abort();
    };
    const r = await runProgram("while (true) { progress('x'); await new Promise((r) => setTimeout(r, 1)) }", {
      onProgress,
      signal: controller.signal,
      timeoutMs: 20000,
    });
    resolved = true;
    expectFail(r, "stopped", "stopped by the caller");
    await sleep(300);
    assert.strictEqual(late, 0, "onProgress was called after the promise resolved");
  });

  test("after a program that ended, with a line posted by a timer it left behind", async () => {
    let resolved = false;
    let late = 0;
    const onProgress = () => {
      if (resolved) late++;
    };
    const r = await runProgram("setTimeout(() => progress('late'), 150);\nprogress('a');\nreturn 1", { onProgress });
    resolved = true;
    expectOk(r, 1);
    await sleep(400);
    assert.strictEqual(late, 0, "onProgress was called after the promise resolved");
  });
});

describe("the walls hold through progress", () => {
  const withProgress = (code, options = {}) => runProgram(code, { onProgress: () => {}, ...options });

  test("typeof process, require, fetch, module, Buffer and WebSocket are all undefined, and progress is a function", async () => {
    expectOk(
      await withProgress(
        'return [["process", "require", "fetch", "module", "Buffer", "WebSocket"].map((n) => typeof globalThis[n]), typeof progress]',
      ),
      [Array(6).fill("undefined"), "function"],
    );
  });

  test("import() rejects, and a static import line is a syntax error", async () => {
    expectOk(
      await withProgress(
        [
          "const out = [];",
          'for (const spec of ["node:fs", "fs", "./x.js", "data:text/javascript,export default 1", "node:child_process"]) {',
          '  try { await import(spec); out.push("loaded") } catch (e) { out.push("rejected") }',
          "}",
          "return [out, typeof progress]",
        ].join("\n"),
      ),
      [Array(5).fill("rejected"), "function"],
    );
    expectFail(await withProgress('import fs from "node:fs";\n1'), "error", /^SyntaxError: /);
  });

  test("the function constructor, Function and eval reach no more", async () => {
    expectOk(
      await withProgress(
        `return [(function () {}).constructor(${T})(), Function(${T})(), eval("typeof process"), await (async () => {}).constructor(${T})(), typeof progress]`,
      ),
      [...Array(4).fill("undefined"), "function"],
    );
  });

  describe("the function constructor through progress", () => {
    const paths = [
      ["progress", `progress.constructor(${T})()`],
      ["the constructor of the constructor of progress", `progress.constructor.constructor(${T})()`],
      ["the prototype of progress", `Object.getPrototypeOf(progress).constructor(${T})()`],
      ["call of progress", `progress.call.constructor(${T})()`],
      ["bind of progress", `progress.bind().constructor(${T})()`],
      ["the global object", `globalThis.progress.constructor(${T})()`],
      ["the global object as a key", `globalThis["progress"].constructor.constructor(${T})()`],
    ];
    for (const [name, code] of paths) {
      test(name, async () => {
        expectOk(await withProgress(`return ${code}`), "undefined");
      });
    }
  });

  test("an error a program makes from a call of progress, and the value it gave, reach no more", async () => {
    expectOk(
      await withProgress(
        `const got = progress("x"); let seen; try { progress.nope() } catch (e) { seen = [e.constructor.constructor(${T})(), Object.getPrototypeOf(e).constructor.constructor(${T})()] } return [seen, typeof got]`,
      ),
      [["undefined", "undefined"], "undefined"],
    );
  });

  test("no file is read, no file written, no process started, no worker", async () => {
    const r = await withProgress(
      [
        "const out = {};",
        'for (const n of ["process", "require", "Buffer", "fetch"]) out[n] = typeof globalThis[n];',
        'try { await import("node:fs"); out.fs = "loaded" } catch { out.fs = "rejected" }',
        'try { await import("node:child_process"); out.cp = "loaded" } catch { out.cp = "rejected" }',
        'try { await import("node:worker_threads"); out.w = "loaded" } catch { out.w = "rejected" }',
        'progress("tried");',
        "return out",
      ].join("\n"),
    );
    expectOk(r, { process: "undefined", require: "undefined", Buffer: "undefined", fetch: "undefined", fs: "rejected", cp: "rejected", w: "rejected" });
  });

  test("the process is started exactly as without the arguments: the same Node, flags, empty environment, streams; checkWalls the same", () => {
    const got = fixtureJson("argv");
    const [plain] = got.spawns[0];
    const [both] = got.spawns[1];
    assert.strictEqual(got.spawns[0].length, 1);
    assert.strictEqual(got.spawns[1].length, 1, "one process is started for a program with both arguments");
    assert.deepStrictEqual(got.results[0], { ok: true, value: 2, logs: [] });
    assert.deepStrictEqual(got.results[1], { ok: true, value: 2, logs: ["b"] });
    assert.deepStrictEqual(got.lines, ["a"]);
    assert.strictEqual(both.file, plain.file);
    assert.strictEqual(both.file, process.execPath);
    assert.deepStrictEqual(both.args, plain.args);
    assert.deepStrictEqual(both.envPairs, []);
    assert.deepStrictEqual(plain.envPairs, []);
    assert.strictEqual(both.stdio, plain.stdio);
    assert.ok(both.args.includes("--permission"));
    assert.ok(!both.args.some((a) => /^--allow-(fs-write|child-process|worker)/.test(a)));
    assert.deepStrictEqual(got.walls, { read: "refused", write: "refused", spawn: "refused", worker: "refused" });
  });
});

describe("a bad onProgress", () => {
  const bad = [
    ["null", null],
    ["a string", "console.log"],
    ["an empty string", ""],
    ["a number", 5],
    ["an object", {}],
    ["an object with a call key", { call: () => {} }],
    ["a list", [() => {}]],
    ["true", true],
    ["false", false],
  ];
  for (const [name, onProgress] of bad) {
    test(`${name}: a TypeError, and no process is started`, async () => {
      await settle();
      let promise;
      assert.doesNotThrow(() => {
        promise = runProgram("1 + 1", { onProgress });
      }, "the call is rejected, never thrown at once");
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("a function of any kind is good: an arrow, an async function, a bound function, a class method", async () => {
    const lines = [];
    class Holder {
      take(line) {
        lines.push("method:" + line);
      }
    }
    const kinds = [
      (line) => lines.push("arrow:" + line),
      async (line) => lines.push("async:" + line),
      function (line) {
        lines.push("function:" + line);
      },
      new Holder().take.bind(new Holder()),
    ];
    for (const onProgress of kinds) expectOk(await runProgram('progress("x"); 1', { onProgress }), 1);
    assert.deepStrictEqual(lines, ["arrow:x", "async:x", "function:x", "method:x"]);
  });
});

describe("onProgress with shell, state and tools: each does what its own section says", () => {
  test("with tools: the call and its answer are as before, the line is apart", async () => {
    const onProgress = listener();
    const callTool = recorder(async (server, tool, args) => ({ got: args }));
    const r = await runProgram(
      'progress("start"); const a = await tools.s.t({ x: 1 }); progress("a", a); return a',
      { onProgress, tools: { s: ["t"] }, callTool },
    );
    expectOk(r, { got: { x: 1 } });
    assert.deepStrictEqual(callTool.calls, [["s", "t", { x: 1 }]]);
    assert.deepStrictEqual(onProgress.lines(), ["start", 'a {"got":{"x":1}}']);
  });

  test("with shell: the four names are there, calls are those of the table, lines are apart", async () => {
    const onProgress = listener();
    const callTool = recorder(async (server, tool) => (tool === "run" ? { exitCode: 0, stdout: "out\n", stderr: "" } : "ok:" + tool));
    const r = await runProgram(
      'progress("1"); const a = await read("p"); progress("2"); const b = await $`ls`.text(); return [a, b, typeof progress, typeof edit]',
      { onProgress, shell: true, callTool },
    );
    expectOk(r, ["ok:read", "out\n", "function", "function"]);
    assert.deepStrictEqual(callTool.calls, [
      ["shell", "read", { path: "p" }],
      ["shell", "run", { command: "ls" }],
    ]);
    assert.deepStrictEqual(onProgress.lines(), ["1", "2"]);
  });

  test("with shell false the four names stay undefined, with onProgress", async () => {
    expectOk(await runProgram("return [typeof $, typeof read, typeof write, typeof edit, typeof progress]", { onProgress: () => {} }), [
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "function",
    ]);
  });

  test("with state: the result has the key state as before", async () => {
    const onProgress = listener();
    const r = await runProgram('progress("s"); state.a = 2; return state.a', { onProgress, state: { a: 1, b: [1] } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.strictEqual(r.value, 2);
    assert.deepStrictEqual(r.state, { a: 2, b: [1] });
    assert.deepStrictEqual(onProgress.lines(), ["s"]);
  });

  test("a failed program with state keeps what it put there, as before", async () => {
    const onProgress = listener();
    const r = await runProgram('state.a = 9; progress("s"); throw new Error("x")', { onProgress, state: { a: 1 } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["error", "logs", "ok", "state"]);
    assert.strictEqual(r.error.message, "Error: x");
    assert.deepStrictEqual(r.state, { a: 9 });
  });

  test("a bad argument of another kind still rejects, with onProgress good", async () => {
    await assert.rejects(runProgram(5, { onProgress: () => {} }), TypeError);
    await assert.rejects(runProgram("1", { onProgress: () => {}, timeoutMs: 0 }), TypeError);
    await assert.rejects(runProgram("1", { onProgress: () => {}, tools: { s: ["t"] } }), TypeError);
    await assert.rejects(runProgram("1", { onProgress: () => {}, shell: true }), TypeError);
    await assert.rejects(runProgram("1", { onProgress: () => {}, state: null }), TypeError);
    assert.deepStrictEqual(childRows(), []);
  });
});

describe("two calls at once, each with its own onProgress", () => {
  test("the lines of each go to its own function", async () => {
    const a = listener();
    const b = listener();
    const [ra, rb] = await Promise.all([
      runProgram('for (let i = 0; i < 20; i++) { progress("a" + i); await new Promise((r) => setTimeout(r, 2)) } return "a"', { onProgress: a }),
      runProgram('for (let i = 0; i < 20; i++) { progress("b" + i); await new Promise((r) => setTimeout(r, 2)) } return "b"', { onProgress: b }),
    ]);
    expectOk(ra, "a");
    expectOk(rb, "b");
    assert.deepStrictEqual(a.lines(), Array.from({ length: 20 }, (_, i) => "a" + i));
    assert.deepStrictEqual(b.lines(), Array.from({ length: 20 }, (_, i) => "b" + i));
  });
});

describe("standard output and standard error of the caller", () => {
  test("nothing is written, by the sandbox or by the program, whatever happens to it, with onProgress and signal", () => {
    const r = spawnSync(process.execPath, [fixture("stop.mjs"), "silent"], { encoding: "utf8", timeout: 60000 });
    assert.strictEqual(r.error, undefined, String(r.error));
    assert.strictEqual(r.status, 0, `the outcomes were not those expected (${r.status}): ${r.stderr}`);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
});
