import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, waitFor, sleep } from "./helpers.js";

// "Step 8: `library.report`, `library.restore` and `library.read`". Every program of this file that should end by
// itself is given a limit of its own, at most 10 seconds, and every wait of a test is at most 5 seconds
// ("Processes, signals, time limits and waits").
const run = (code, options = {}) => runProgram(code, { timeoutMs: 8000, ...options });
const withLib = (code, library, options = {}) => run(code, { library, callTool: recorder(), ...options });
const item = (name, code, params = []) => ({ name, params, code });
const T = '"return typeof process"';
const THREE = ["report", "restore", "read"];
const FIVE = ["read", "remove", "report", "restore", "save"];

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 5000), "a process still runs");

function useSpy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  fn.uses = () => calls.map((args) => args[0]);
  return fn;
}

describe("the object library has five functions", () => {
  test("Object.keys(library).sort() gives read, remove, report, restore, save, and each is a function", async () => {
    const r = await withLib(
      "return [Object.keys(library).sort(), typeof library.report, typeof library.restore, typeof library.read, typeof library.save, typeof library.remove]",
      [],
    );
    expectOk(r, [FIVE, "function", "function", "function", "function", "function"]);
  });

  test("the same with a list that is not empty, and lib is the list the caller gave", async () => {
    const library = [item("double", "n * 2", ["n"])];
    expectOk(await withLib("return [Object.keys(library).sort(), Object.keys(lib)]", library), [FIVE, ["double"]]);
  });

  test("a saved program finds the five too, since it finds library", async () => {
    const library = [item("keys", "return [Object.keys(library).sort(), typeof library.report, typeof library.restore, typeof library.read]")];
    expectOk(await withLib("return await lib.keys()", library), [FIVE, "function", "function", "function"]);
  });

  test("without library nothing changes: typeof library is undefined, and using one of the three is the usual ReferenceError", async () => {
    for (const options of [{}, { library: undefined }, { library: undefined, onLibrary: () => {} }]) {
      expectOk(await run("return [typeof library, 'library' in globalThis]", options), ["undefined", false]);
      expectFail(await run("await library.report()", options), "error", "ReferenceError: library is not defined", []);
      expectFail(await run("await library.restore('x')", options), "error", "ReferenceError: library is not defined", []);
      expectFail(await run("await library.read('x')", options), "error", "ReferenceError: library is not defined", []);
    }
  });

  test("a tool named report, restore or read of the server library in tools is no library: reached as before, the global stays undefined", async () => {
    const callTool = recorder(async () => "viaTools");
    const r = await run("return [typeof library, await tools.library.report({}), await tools.library.restore({ name: 'a' }), await tools.library.read({})]", {
      tools: { library: THREE },
      callTool,
    });
    expectOk(r, ["undefined", "viaTools", "viaTools", "viaTools"]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "report", {}],
      ["library", "restore", { name: "a" }],
      ["library", "read", {}],
    ]);
  });
});

describe("the examples: with library [] and a callTool that records and answers done", () => {
  const answering = () => recorder(async () => "done");

  test("report() gives done and callTool got (library, report, {}); report('x', 1) makes the same call", async () => {
    const callTool = answering();
    expectOk(await withLib("return [await library.report(), await library.report('x', 1)]", [], { callTool }), ["done", "done"]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "report", {}],
      ["library", "report", {}],
    ]);
  });

  test("restore('cityCount') makes (library, restore, { name }); restore() makes (library, restore, {})", async () => {
    const callTool = answering();
    expectOk(await withLib("return [await library.restore('cityCount'), await library.restore()]", [], { callTool }), ["done", "done"]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "restore", { name: "cityCount" }],
      ["library", "restore", {}],
    ]);
  });

  test("read('cityCount', 'more') makes (library, read, { name: 'cityCount' }); read() makes (library, read, {})", async () => {
    const callTool = answering();
    expectOk(await withLib("return [await library.read('cityCount', 'more'), await library.read()]", [], { callTool }), ["done", "done"]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "read", { name: "cityCount" }],
      ["library", "read", {}],
    ]);
  });

  test("with a callTool that rejects with new Error('no'): await library.read('x').catch((e) => e.message) gives no", async () => {
    const callTool = recorder(async () => {
      throw new Error("no");
    });
    expectOk(await withLib("return await library.read('x').catch((e) => e.message)", [], { callTool }), "no");
  });

  test("all the examples in one program, in order", async () => {
    const callTool = answering();
    const code = [
      "const out = [];",
      "out.push(await library.report());",
      "out.push(await library.report('x', 1));",
      "out.push(await library.restore('cityCount'));",
      "out.push(await library.read('cityCount', 'more'));",
      "out.push(await library.restore());",
      "return out",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool }), Array(5).fill("done"));
    assert.deepStrictEqual(callTool.calls, [
      ["library", "report", {}],
      ["library", "report", {}],
      ["library", "restore", { name: "cityCount" }],
      ["library", "read", { name: "cityCount" }],
      ["library", "restore", {}],
    ]);
  });
});

describe("the arguments of the three", () => {
  test("report hands over exactly {}: every argument is dropped, of whatever kind", async () => {
    const callTool = recorder();
    const code = [
      "await library.report();",
      "await library.report(undefined);",
      "await library.report(null);",
      "await library.report('name');",
      "await library.report({ name: 'x', extra: 1 });",
      "await library.report(['a'], 2, 3);",
      "await library.report(1n);",
      "const cyc = {}; cyc.self = cyc; await library.report(cyc);",
      "return 1",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool }), 1);
    assert.deepStrictEqual(callTool.calls, Array(8).fill(["library", "report", {}]));
  });

  for (const tool of ["restore", "read"]) {
    test(`${tool}: the first argument goes under the key name, left out or undefined gives {}, more arguments are dropped`, async () => {
      const callTool = recorder();
      const code = [
        `await library.${tool}('a');`,
        `await library.${tool}();`,
        `await library.${tool}(undefined);`,
        `await library.${tool}(undefined, 'second');`,
        `await library.${tool}('b', 'extra', 3, { name: 'other' });`,
        "return 1",
      ].join("\n");
      expectOk(await withLib(code, [], { callTool }), 1);
      assert.deepStrictEqual(callTool.calls, [
        ["library", tool, { name: "a" }],
        ["library", tool, {}],
        ["library", tool, {}],
        ["library", tool, {}],
        ["library", tool, { name: "b" }],
      ]);
    });

    test(`${tool}: the name reaches callTool after a JSON round trip`, async () => {
      const callTool = recorder();
      const code = [
        `await library.${tool}(5);`,
        `await library.${tool}(null);`,
        `await library.${tool}({ a: [1, undefined], b: undefined, d: new Date(0) });`,
        "return 1",
      ].join("\n");
      expectOk(await withLib(code, [], { callTool }), 1);
      assert.deepStrictEqual(callTool.calls, [
        ["library", tool, { name: 5 }],
        ["library", tool, { name: null }],
        ["library", tool, { name: { a: [1, null], d: "1970-01-01T00:00:00.000Z" } }],
      ]);
    });

    test(`${tool}: a name JSON cannot hold throws the arguments cannot be sent as JSON, and callTool is not called`, async () => {
      const callTool = recorder();
      const code = [
        "const out = [];",
        "const take = async (p) => { try { await p; out.push('no error') } catch (e) { out.push([e instanceof Error, e.message]) } };",
        "const cyc = {}; cyc.self = cyc;",
        `await take(library.${tool}(1n)); await take(library.${tool}(cyc)); await take(library.${tool}({ deep: [1n] }));`,
        "return out",
      ].join("\n");
      expectOk(await withLib(code, [], { callTool }), Array(3).fill([true, "the arguments cannot be sent as JSON"]));
      assert.deepStrictEqual(callTool.calls, []);
    });
  }
});

describe("what comes back, and what is thrown", () => {
  const answer = async () => ({ ok: true, when: new Date(0), skipped: undefined, list: [1, undefined] });

  test("each resolves with what callTool resolved with, after a JSON round trip", async () => {
    const callTool = recorder(answer);
    const r = await withLib("return [await library.report(), await library.restore('a'), await library.read('b')]", [], { callTool });
    const one = { ok: true, when: "1970-01-01T00:00:00.000Z", list: [1, null] };
    expectOk(r, [one, one, one]);
  });

  test("undefined stays undefined", async () => {
    const callTool = recorder(async () => undefined);
    expectOk(await withLib("return [await library.report() === undefined, await library.restore('a') === undefined, await library.read('b') === undefined]", [], { callTool }), [
      true,
      true,
      true,
    ]);
  });

  test("when callTool rejects or throws, the call throws an Error with the message of what was thrown", async () => {
    const things = [new Error("taken"), "a plain string", { message: "an object message" }, 12, new Error("again"), "text"];
    let i = 0;
    const callTool = recorder(async () => {
      throw things[i++];
    });
    const code = [
      "const out = [];",
      "const take = async (p) => { try { await p; out.push('no error') } catch (e) { out.push([e instanceof Error, e.message]) } };",
      "await take(library.report()); await take(library.restore('a')); await take(library.read('b')); await take(library.report());",
      "await take(library.restore('c')); await take(library.read('d'));",
      "return out",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool }), [
      [true, "taken"],
      [true, "a plain string"],
      [true, "an object message"],
      [true, "12"],
      [true, "again"],
      [true, "text"],
    ]);
    assert.strictEqual(callTool.calls.length, 6);
  });

  test("a program that does not catch it fails with that Error", async () => {
    const callTool = recorder(async () => {
      throw new Error("refused by the caller");
    });
    expectFail(await withLib("await library.restore('x')", [], { callTool }), "error", "Error: refused by the caller", []);
  });

  test("they are async: a call gives a promise, and calls may run at the same time, each with its own answer", async () => {
    const callTool = recorder(async (server, tool, args) => {
      await sleep(tool === "report" ? 60 : 5);
      return tool + (args.name ?? "");
    });
    const r = await withLib(
      "const p = library.read('x'); const t = typeof p.then; await p; return [p instanceof Promise, t, await Promise.all([library.report(), library.restore('a'), library.read('b')])]",
      [],
      { callTool },
    );
    expectOk(r, [true, "function", ["report", "restorea", "readb"]]);
  });

  test("calls that wait for each other are all in flight at once", async () => {
    let arrived = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const giveUp = setTimeout(() => release("gave up"), 5000);
    const callTool = recorder(async (server, tool) => {
      arrived++;
      if (arrived === 3) release("open");
      return (await gate) + tool;
    });
    const r = await withLib("return await Promise.all([library.report(), library.restore('a'), library.read('b')])", [], { callTool });
    clearTimeout(giveUp);
    expectOk(r, ["openreport", "openrestore", "openread"]);
  });

  test("answers still waiting when the program ends are dropped: callTool is never called after the promise resolved", async () => {
    let resolved = false;
    let late = 0;
    const callTool = recorder(async () => {
      if (resolved) late++;
      await sleep(100);
      return 1;
    });
    expectOk(await withLib("library.report(); library.restore('a'); library.read('b'); return 'done'", [], { callTool }), "done");
    resolved = true;
    await sleep(300);
    assert.strictEqual(late, 0, "callTool was called after the promise resolved");
  });

  test("a rejection nobody awaited is no failure of the caller's process", async () => {
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const callTool = recorder(async () => {
        throw new Error("no");
      });
      expectOk(await withLib("library.report().catch(() => {}); library.read('x').catch(() => {}); return 1", [], { callTool }), 1);
      await sleep(150);
      assert.deepStrictEqual(failures, []);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });
});

describe("a saved program, lib, onLibrary and tools", () => {
  test("a saved program finds the three and makes the same calls", async () => {
    const callTool = recorder(async (server, tool, args) => [tool, args]);
    const library = [
      item("all", "return [await library.report(), await library.restore(n), await library.read(n, 'more')]", ["n"]),
    ];
    const r = await withLib("return await lib.all({ n: 'cityCount' })", library, { callTool });
    expectOk(r, [["report", {}], ["restore", { name: "cityCount" }], ["read", { name: "cityCount" }]]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "report", {}],
      ["library", "restore", { name: "cityCount" }],
      ["library", "read", { name: "cityCount" }],
    ]);
  });

  test("onLibrary hears nothing of the three: a use is only for a call of a saved program", async () => {
    const onLibrary = useSpy();
    const callTool = recorder(async () => "x");
    const library = [item("keep", "return await library.read(n)", ["n"])];
    const r = await withLib("await library.report(); await library.restore('a'); await library.read('b'); return await lib.keep({ n: 'z' })", library, { onLibrary, callTool });
    expectOk(r, "x");
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "keep", ok: true }]);
    assert.strictEqual(callTool.calls.length, 4);
  });

  test("with the three only, onLibrary is never called", async () => {
    const onLibrary = useSpy();
    expectOk(await withLib("await library.report(); await library.restore('a'); await library.read('b'); return 1", [], { onLibrary }), 1);
    await sleep(100);
    assert.deepStrictEqual(onLibrary.calls, []);
  });

  test("a program that restores one does not find it under lib", async () => {
    const callTool = recorder(async () => ({ restored: true }));
    const r = await withLib("const a = await library.restore('fresh'); return [a, typeof lib.fresh, Object.keys(lib)]", [item("old", "return 1")], { callTool });
    expectOk(r, [{ restored: true }, "undefined", ["old"]]);
  });

  test("lib is unchanged by read and report, and a saved program of lib still runs after them", async () => {
    const callTool = recorder(async () => "x");
    const r = await withLib("await library.report(); await library.read('double'); return [Object.keys(lib), await lib.double({ n: 4 })]", [item("double", "n * 2", ["n"])], { callTool });
    expectOk(r, [["double"], 8]);
    assert.deepStrictEqual(callTool.calls.map((c) => c[1]), ["report", "read"]);
  });

  test("tools is not changed: its keys are the caller's, whatever library holds", async () => {
    const r = await run("return [Object.keys(tools), typeof tools.report, typeof tools.restore, typeof tools.read]", {
      library: [],
      tools: { p: ["q"] },
      callTool: recorder(),
    });
    expectOk(r, [["p"], "undefined", "undefined", "undefined"]);
  });

  test("the three and save, remove in one program: calls arrive as each one says, in the order of the calls", async () => {
    const callTool = recorder(async () => 1);
    const code = [
      "await library.save('a', { code: 'x' });",
      "await library.remove('b');",
      "await library.report();",
      "await library.restore('c');",
      "await library.read('d');",
      "return 1",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool }), 1);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "save", { name: "a", code: "x" }],
      ["library", "remove", { name: "b" }],
      ["library", "report", {}],
      ["library", "restore", { name: "c" }],
      ["library", "read", { name: "d" }],
    ]);
  });
});

describe("the walls hold through the three, a value they gave and an error they threw", () => {
  const PRELUDE = "const caught = async (p) => { try { await p; return 'no error' } catch (e) { return e } };\n";
  const answer = () => recorder(async () => ({ a: 1, list: [1] }));
  const failing = () =>
    recorder(async () => {
      throw new Error("refused");
    });

  describe("the function constructor", () => {
    const paths = [];
    for (const name of THREE) {
      paths.push(
        [`library.${name}`, `library.${name}.constructor(${T})()`, answer],
        [`the constructor of library.${name}`, `library.${name}.constructor.constructor(${T})()`, answer],
        [`the prototype of library.${name}`, `Object.getPrototypeOf(library.${name}).constructor(${T})()`, answer],
        [`call of library.${name}`, `library.${name}.call.constructor(${T})()`, answer],
        [`bind of library.${name}`, `library.${name}.bind().constructor(${T})()`, answer],
        [`the global object, library.${name}`, `globalThis["library"].${name}.constructor.constructor(${T})()`, answer],
        [`the promise of library.${name}`, `library.${name}('x').constructor.constructor(${T})()`, answer],
        [`an object library.${name} gave`, `(await library.${name}('x')).constructor.constructor(${T})()`, answer],
        [`a list library.${name} gave`, `(await library.${name}('x')).list.constructor.constructor(${T})()`, answer],
        [`an error library.${name} threw`, `(await caught(library.${name}('x'))).constructor.constructor(${T})()`, failing],
        [`the prototype of an error library.${name} threw`, `Object.getPrototypeOf(await caught(library.${name}('x'))).constructor.constructor(${T})()`, failing],
      );
      if (name !== "report") paths.push([`the error of a name library.${name} cannot send`, `(await caught(library.${name}(1n))).constructor.constructor(${T})()`, answer]);
    }
    paths.push(["the keys of library, as a list", `Object.keys(library).constructor.constructor(${T})()`, answer]);
    for (const [name, code, make] of paths) {
      test(name, async () => {
        expectOk(await withLib(`${PRELUDE}return ${code}`, [], { callTool: make() }), "undefined");
      });
    }
  });

  test("typeof process, require, fetch, module, Buffer and WebSocket are undefined in a saved program that calls the three", async () => {
    const library = [
      item("probe", [
        "await library.report(); await library.restore('a'); await library.read('b');",
        "return [typeof process, typeof require, typeof fetch, typeof module, typeof Buffer, typeof WebSocket,",
        `  await library.report.constructor(${T})(), await library.read.constructor(${T})(), await library.restore.constructor(${T})()]`,
      ].join("\n")),
    ];
    expectOk(await withLib("return await lib.probe()", library, { callTool: answer() }), Array(9).fill("undefined"));
  });

  test("import() rejects and the permission model refuses, in a program that has just made the three calls", async () => {
    const code = [
      "await library.report(); await library.restore('a'); await library.read('b');",
      "const out = [];",
      'for (const spec of ["node:fs", "node:child_process", "node:worker_threads"]) {',
      '  try { await import(spec); out.push("loaded") } catch (e) { out.push("rejected") }',
      "}",
      "return out",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool: answer() }), Array(3).fill("rejected"));
  });

  test("the program's environment is empty after the three calls: no variable of the caller reaches it", async () => {
    expectOk(await withLib("await library.report(); return [typeof process, typeof globalThis.process]", [], { callTool: answer() }), ["undefined", "undefined"]);
  });
});

describe("the three with shell, state, tools, onProgress and signal: each does what its own section says", () => {
  test("with every one at once, nothing changes another", async () => {
    const lines = [];
    const onLibrary = useSpy();
    const controller = new AbortController();
    const callTool = recorder(async (server, tool) => (tool === "run" ? { exitCode: 0, stdout: "o\n", stderr: "" } : [server, tool]));
    const library = [item("all", "progress('in saved'); state.k = n; console.log('saved log'); return [await tools.s.t({}), await $`ls`.text(), await library.report()]", ["n"])];
    const r = await run("progress('first'); const a = await lib.all({ n: 1 }); return [a, await library.restore('x'), await library.read('y')]", {
      library,
      onLibrary,
      onProgress: (l) => lines.push(l),
      signal: controller.signal,
      state: { k: 0 },
      shell: true,
      tools: { s: ["t"] },
      callTool,
    });
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.deepStrictEqual(r.value, [[[ "s", "t" ], "o\n", ["library", "report"]], ["library", "restore"], ["library", "read"]]);
    assert.deepStrictEqual(r.logs, ["saved log"]);
    assert.deepStrictEqual(r.state, { k: 1 });
    assert.deepStrictEqual(lines, ["first", "in saved"]);
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "all", ok: true }]);
    assert.deepStrictEqual(callTool.calls, [
      ["s", "t", {}],
      ["shell", "run", { command: "ls" }],
      ["library", "report", {}],
      ["library", "restore", { name: "x" }],
      ["library", "read", { name: "y" }],
    ]);
  });

  test("the result of a program that used the three has the keys it had before", async () => {
    const r = await withLib("await library.report(); console.log('x'); return 1", [], { callTool: recorder(async () => 1) });
    expectOk(r, 1, ["x"]);
    const r2 = await withLib("await library.read('a'); throw new Error('x')", [], { callTool: recorder(async () => 1), state: { a: 1 } });
    assert.deepStrictEqual(Object.keys(r2).sort(), ["error", "logs", "ok", "state"]);
    assert.strictEqual(r2.error.message, "Error: x");
    assert.deepStrictEqual(r2.state, { a: 1 });
  });

  test("a program that restores or reads with the state: state is its own, the calls are the caller's", async () => {
    const callTool = recorder(async () => ({ n: 7 }));
    const r = await withLib("const r = await library.read('x'); state.n = r.n; return await library.restore('y')", [], { callTool, state: { n: 0 } });
    assert.deepStrictEqual(r, { ok: true, value: { n: 7 }, logs: [], state: { n: 7 } });
  });
});

describe("processes, signals, time limits and waits: stops while a call of the three waits", () => {
  // A callTool whose call of the tool `tool` never answers.
  const hanging = (tool) => recorder((server, t) => (t === tool ? new Promise(() => {}) : Promise.resolve("x")));

  for (const tool of THREE) {
    test(`the time limit stops a program that waits in library.${tool}: timeout, no more call, the process gone`, async () => {
      await settle();
      const callTool = hanging(tool);
      const r = await withLib(`await library.${tool}('x')`, [], { callTool, timeoutMs: 400, state: { a: 1 } });
      assert.deepStrictEqual(Object.keys(r).sort(), ["error", "logs", "ok", "state"]);
      assert.deepStrictEqual(r.error, { kind: "timeout", message: "stopped after 400 ms" });
      assert.deepStrictEqual(r.state, { a: 1 });
      assert.ok(await waitFor(() => childRows().length === 0, 5000), "the process of the program still runs");
      await sleep(100);
      assert.strictEqual(callTool.calls.length, 1);
    });

    test(`the abort stops a program that waits in library.${tool}: stopped, one process, the process gone`, async () => {
      await settle();
      const controller = new AbortController();
      const callTool = hanging(tool);
      const running = withLib(`await library.${tool}('x')`, [], { callTool, signal: controller.signal, timeoutMs: 8000 });
      assert.ok(await waitFor(() => callTool.calls.length === 1, 5000), "the program made no tool call");
      assert.strictEqual(childRows().length, 1, "more or less than one process runs");
      controller.abort();
      const r = await running;
      expectFail(r, "stopped", "stopped by the caller");
      assert.ok(await waitFor(() => childRows().length === 0, 5000), "the process of the program still runs");
      await sleep(100);
      assert.strictEqual(callTool.calls.length, 1);
      assert.doesNotThrow(() => controller.abort(), "a second abort");
    });
  }

  test("a signal already aborted: no process, callTool never called, the result stopped", async () => {
    await settle();
    const callTool = recorder();
    const r = await withLib("await library.report(); await library.restore('a'); await library.read('b')", [], { callTool, signal: AbortSignal.abort() });
    assert.deepStrictEqual(r, { ok: false, error: { kind: "stopped", message: "stopped by the caller" }, logs: [] });
    assert.deepStrictEqual(callTool.calls, []);
    assert.deepStrictEqual(childRows(), []);
  });

  test("an abort after the promise resolved does nothing: no more call, no process", async () => {
    await settle();
    const controller = new AbortController();
    const callTool = recorder(async () => "x");
    expectOk(await withLib("return await library.read('a')", [], { callTool, signal: controller.signal }), "x");
    controller.abort();
    await sleep(150);
    assert.strictEqual(callTool.calls.length, 1);
    assert.deepStrictEqual(childRows(), []);
  });

  test("answers dropped after a stop: callTool is never called after the promise resolved", async () => {
    await settle();
    const controller = new AbortController();
    let resolved = false;
    let late = 0;
    const callTool = recorder(async () => {
      if (resolved) late++;
      return new Promise(() => {});
    });
    const running = withLib("library.report(); library.restore('a'); await library.read('b')", [], { callTool, signal: controller.signal });
    assert.ok(await waitFor(() => callTool.calls.length === 3, 5000), "the program made no three calls");
    controller.abort();
    expectFail(await running, "stopped", "stopped by the caller");
    resolved = true;
    await sleep(200);
    assert.strictEqual(late, 0);
    assert.strictEqual(callTool.calls.length, 3);
  });

  test("a program that ends while its calls wait leaves no process running", async () => {
    const callTool = recorder(() => new Promise(() => {}));
    expectOk(await withLib("library.report(); library.restore('a'); library.read('b'); return 'ended'", [], { callTool }), "ended");
    assert.ok(await waitFor(() => childRows().length === 0, 5000), "a process still runs");
  });
});
