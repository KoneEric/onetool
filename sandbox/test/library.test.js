import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, waitFor, sleep } from "./helpers.js";

// Every program of this file that should end by itself is given a limit of its own, at most 10 seconds
// ("Processes, signals, time limits and waits"), and every wait of a test is at most 5 seconds.
const run = (code, options = {}) => runProgram(code, { timeoutMs: 8000, ...options });
const withLib = (code, library, options = {}) => run(code, { library, callTool: recorder(), ...options });
const item = (name, code, params = []) => ({ name, params, code });
const T = '"return typeof process"';

const DOUBLE = item("double", "n * 2", ["n"]);
const TWICE = item("twice", "const once = await lib.double({ n });\nawait lib.double({ n: once })", ["n"]);
const EXAMPLE = [DOUBLE, TWICE];
const BOOM = item("boom", "throw new Error('boom')");

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 5000), "a process still runs");

// A caller's onLibrary that keeps what it was called with.
function useSpy(impl = () => undefined) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl(...args);
  };
  fn.calls = calls;
  fn.uses = () => calls.map((args) => args[0]);
  return fn;
}

// Fails the test when the caller's process gets an unhandled failure while `body` runs.
async function noFailure(body) {
  const failures = [];
  const onBad = (e) => failures.push(e);
  process.on("unhandledRejection", onBad);
  process.on("uncaughtException", onBad);
  try {
    await body();
    await sleep(150);
    assert.deepStrictEqual(failures, []);
  } finally {
    process.off("unhandledRejection", onBad);
    process.off("uncaughtException", onBad);
  }
}

describe("without library, the sections above hold", () => {
  const options = [
    ["library absent", {}],
    ["library undefined", { library: undefined }],
    ["library undefined with onLibrary", { library: undefined, onLibrary: () => {} }],
  ];
  for (const [name, opts] of options) {
    test(`${name}: lib and library are undefined`, async () => {
      expectOk(
        await run("return [typeof lib, typeof library, 'lib' in globalThis, 'library' in globalThis, typeof globalThis.lib, typeof globalThis.library]", opts),
        ["undefined", "undefined", false, false, "undefined", "undefined"],
      );
    });

    test(`${name}: a program that uses lib or library fails with the usual ReferenceError`, async () => {
      expectFail(await run("lib.double({ n: 1 })", opts), "error", "ReferenceError: lib is not defined", []);
      expectFail(await run('library.save("x")', opts), "error", "ReferenceError: library is not defined", []);
    });
  }

  test("a tool named library in tools is no library: the global stays undefined", async () => {
    const callTool = recorder(async () => "saved");
    const r = await run('return [typeof library, typeof lib, await tools.library.save({ x: 1 })]', { tools: { library: ["save"] }, callTool });
    expectOk(r, ["undefined", "undefined", "saved"]);
    assert.deepStrictEqual(callTool.calls, [["library", "save", { x: 1 }]]);
  });

  test("onLibrary without library is valid, and is never called", async () => {
    const onLibrary = useSpy();
    expectOk(await run("return 1 + 1", { onLibrary }), 2);
    expectOk(await run("return typeof lib", { onLibrary }), "undefined");
    expectFail(await run("await lib.double({ n: 1 })", { onLibrary }), "error", /^ReferenceError: /, []);
    await sleep(100);
    assert.deepStrictEqual(onLibrary.calls, []);
  });

  test("the result has the same keys as before", async () => {
    expectOk(await run("console.log('x'); 1 + 1", { library: undefined }), 2, ["x"]);
  });
});

describe("with library, the program finds lib and library", () => {
  test("lib is an object with a function per item; library an object with five functions", async () => {
    const r = await withLib(
      "return [typeof lib, typeof library, Object.keys(lib), Object.keys(library).sort(), typeof lib.double, typeof lib.twice, typeof library.save, typeof library.remove]",
      EXAMPLE,
    );
    expectOk(r, ["object", "object", ["double", "twice"], ["read", "remove", "report", "restore", "save"], "function", "function", "function", "function"]);
  });

  test("an empty list is valid: lib has no function, library still has five", async () => {
    expectOk(await withLib("return [typeof lib, Object.keys(lib), Object.keys(library).sort(), typeof library.save, typeof library.remove]", []), [
      "object",
      [],
      ["read", "remove", "report", "restore", "save"],
      "function",
      "function",
    ]);
  });

  test("a name that is not in the list is undefined, and calling it is the usual TypeError", async () => {
    const callTool = recorder();
    expectOk(await withLib("return [typeof lib.other, typeof lib.nope]", EXAMPLE, { callTool }), ["undefined", "undefined"]);
    expectFail(await withLib("await lib.other({})", EXAMPLE, { callTool }), "error", /^TypeError: .*is not a function$/, []);
    assert.deepStrictEqual(callTool.calls, []);
  });

  test("a call gives a promise: nothing is made at once that the program must not await", async () => {
    expectOk(await withLib("const p = lib.double({ n: 1 }); const t = typeof p.then; const v = await p; return [p instanceof Promise, t, v]", EXAMPLE), [
      true,
      "function",
      2,
    ]);
  });

  test("a name that is no identifier is reached with brackets, and gives its function", async () => {
    const library = [item("my prog", "return 'a'"), item("get-rows", "return 'b'")];
    expectOk(await withLib('return [await lib["my prog"]({}), await lib["get-rows"]({})]', library), ["a", "b"]);
  });

  test("the examples: double 4 is 8, twice 3 is 12, double with no argument is NaN (null on the caller's side)", async () => {
    const callTool = recorder();
    expectOk(await withLib("return await lib.double({ n: 4 })", EXAMPLE, { callTool }), 8);
    expectOk(await withLib("return await lib.twice({ n: 3 })", EXAMPLE, { callTool }), 12);
    expectOk(await withLib("return await lib.double()", EXAMPLE, { callTool }), null);
    expectOk(await withLib("return typeof lib.other", EXAMPLE, { callTool }), "undefined");
    assert.deepStrictEqual(callTool.calls, [], "a saved program is no tool call");
  });

  test("the last expression is the value, as for a program", async () => {
    expectOk(await withLib("return await lib.double({ n: 4 })", EXAMPLE), 8);
    expectOk(await withLib("const r = await lib.twice({ n: 5 });\nr", EXAMPLE), 20);
  });

  test("the example with a tool: count gives 625 and callTool got (p, count, { city: Lyon })", async () => {
    const callTool = recorder(async () => ({ count: 625 }));
    const library = [{ name: "count", params: ["city"], code: "(await tools.p.count({ city })).count" }];
    const r = await run("return await lib.count({ city: 'Lyon' })", { library, tools: { p: ["count"] }, callTool });
    expectOk(r, 625);
    assert.deepStrictEqual(callTool.calls, [["p", "count", { city: "Lyon" }]]);
  });
});

describe("lib.<name>(args): the arguments", () => {
  test("no argument and undefined are {}: the code runs, every param is undefined", async () => {
    const callTool = recorder();
    const library = [item("f", "return typeof n", ["n"])];
    expectOk(await withLib("return [await lib.f(), await lib.f(undefined), await lib.f({})]", library, { callTool }), ["undefined", "undefined", "undefined"]);
  });

  test("anything else that is not a plain object: the call throws a TypeError, and the code is not run", async () => {
    const library = [item("f", "console.log('ran'); return 1", ["n"])];
    const r = await withLib(
      [
        "const out = [];",
        "for (const bad of [null, [], ['n'], 'str', 5, true, () => {}]) {",
        "  try { await lib.f(bad); out.push('ran') } catch (e) { out.push(e.name) }",
        "}",
        "return out",
      ].join("\n"),
      library,
    );
    expectOk(r, Array(7).fill("TypeError"), []);
  });

  test("the call rejects: the TypeError comes through the promise, as for an async function", async () => {
    const library = [item("f", "return 1", ["n"])];
    expectOk(await withLib("let p; try { p = lib.f(null) } catch { return 'thrown at once' }\ntry { await p } catch (e) { return e.name }\nreturn 'no error'", library), "TypeError");
  });

  test("more arguments than one are dropped", async () => {
    const library = [item("f", "return n", ["n"])];
    expectOk(await withLib("return [await lib.f({ n: 1 }, { n: 2 }), await lib.f({ n: 3 }, null, 5)]", library), [1, 3]);
  });

  test("each name of params is a variable holding args[name], undefined when args has no such key", async () => {
    const library = [item("f", "return [a, typeof b, typeof c, d, e]", ["a", "b", "d", "e"])];
    expectOk(await withLib("return await lib.f({ a: 1, c: 3, d: 0, e: null })", library), [1, "undefined", "undefined", 0, null]);
  });

  test("args is handed over as it is, with no JSON round trip: objects, functions, dates, bigints, cycles", async () => {
    const library = [
      item(
        "f",
        "o.x = 2; return [typeof fn, fn(), d instanceof Date, d.getTime(), typeof big, cyc.self === cyc, typeof u]",
        ["o", "fn", "d", "big", "cyc", "u"],
      ),
    ];
    const code = [
      "const o = { x: 1 };",
      "const cyc = {}; cyc.self = cyc;",
      "const r = await lib.f({ o, fn: () => 5, d: new Date(0), big: 10n, cyc, u: undefined });",
      "return [r, o.x]",
    ].join("\n");
    expectOk(await withLib(code, library), [["function", 5, true, 0, "bigint", true, "undefined"], 2]);
  });
});

describe("lib.<name>(args): the value and what is thrown", () => {
  test("the value is the one of a program: a return that ran, else the last expression, else undefined", async () => {
    const library = [
      item("ret", "return 5\nnever()"),
      item("last", "const a = 2; a * 3"),
      item("comment", "const a = 4; a + 1 // five\n// and more"),
      item("none", "const a = 1"),
      item("waits", "await null; 7"),
      item("empty", ""),
      item("spaces", "  \n\t "),
    ];
    expectOk(await withLib("return [await lib.ret(), await lib.last(), await lib.comment(), await lib.none() === undefined, await lib.waits(), await lib.empty() === undefined, await lib.spaces() === undefined]", library), [
      5,
      6,
      5,
      true,
      7,
      true,
      true,
    ]);
  });

  test("a value that is a promise is awaited", async () => {
    const library = [item("later", "new Promise((resolve) => setTimeout(() => resolve(9), 20))")];
    expectOk(await withLib("return await lib.later()", library), 9);
  });

  test("the call resolves with the value as it is, with no JSON round trip", async () => {
    const library = [
      item("mk", "return { d: new Date(0), fn: () => 1, big: 3n, u: undefined, nan: NaN }"),
      item("id", "return v", ["v"]),
      item("cycle", "const c = {}; c.self = c; return c"),
    ];
    const code = [
      "const v = await lib.mk();",
      "const o = {};",
      "const c = await lib.cycle();",
      "return [v.d instanceof Date, typeof v.fn, typeof v.big, 'u' in v, Number.isNaN(v.nan), (await lib.id({ v: o })) === o, c.self === c]",
    ].join("\n");
    expectOk(await withLib(code, library), [true, "function", "bigint", true, true, true, true]);
  });

  test("the call rejects with what the code threw, as it is", async () => {
    const library = [
      item("err", "throw err", ["err"]),
      item("str", "throw 'a string'"),
      item("num", "throw 5"),
      item("rejects", "await Promise.reject(new RangeError('r'))"),
      BOOM,
    ];
    const code = [
      "const caught = async (p) => { try { await p; return ['no error'] } catch (e) { return [e] } };",
      "const same = new Error('mine');",
      "const [a] = await caught(lib.err({ err: same }));",
      "const [b] = await caught(lib.str());",
      "const [c] = await caught(lib.num());",
      "const [d] = await caught(lib.rejects());",
      "const [e] = await caught(lib.boom());",
      "return [a === same, b, c, d.name, d.message, e instanceof Error, e.message]",
    ].join("\n");
    expectOk(await withLib(code, library), [true, "a string", 5, "RangeError", "r", true, "boom"]);
  });

  test("an error the program does not catch ends it as kind error, like a throw of its own", async () => {
    expectFail(await withLib("await lib.boom()", [BOOM]), "error", "Error: boom", []);
    expectFail(await withLib("await lib.bad()", [item("bad", "null.x")]), "error", /^TypeError: /, []);
  });
});

describe("what a saved program finds", () => {
  test("lib and library themselves: saved programs call each other, and themselves", async () => {
    const library = [
      item("fact", "n <= 1 ? 1 : n * (await lib.fact({ n: n - 1 }))", ["n"]),
      item("isEven", "n === 0 ? true : await lib.isOdd({ n: n - 1 })", ["n"]),
      item("isOdd", "n === 0 ? false : await lib.isEven({ n: n - 1 })", ["n"]),
      item("seen", "return [typeof lib, typeof library, typeof lib.fact, typeof library.save]"),
    ];
    // 5! is 5 * 4 * 3 * 2 * 1; 6 is even, 7 is odd, 7 is not even
    expectOk(
      await withLib("return [await lib.fact({ n: 5 }), await lib.isEven({ n: 6 }), await lib.isOdd({ n: 7 }), await lib.isEven({ n: 7 }), await lib.seen()]", library),
      [120, true, true, false, ["object", "object", "function", "function"]],
    );
  });

  test("tools: every tool call of the code is a tool call of the program, with the JSON round trips", async () => {
    const callTool = recorder(async (server, tool, args) => {
      if (tool === "fail") throw new Error("nope");
      return { when: new Date(0), skipped: undefined, got: args };
    });
    const library = [
      item("viaTools", "return await tools.p.q({ x, y: undefined })", ["x"]),
      item("failing", "try { await tools.p.fail({}) } catch (e) { return [e instanceof Error, e.message] }"),
    ];
    const r = await run("return [await lib.viaTools({ x: 1 }), await lib.failing()]", { library, tools: { p: ["q", "fail"] }, callTool });
    expectOk(r, [{ when: "1970-01-01T00:00:00.000Z", got: { x: 1 } }, [true, "nope"]]);
    assert.deepStrictEqual(callTool.calls, [
      ["p", "q", { x: 1 }],
      ["p", "fail", {}],
    ]);
  });

  test("console and timers: a line it prints is in logs, in the order of the calls", async () => {
    const library = [item("say", "console.log('b', 1); console.warn({ k: 1 }); await new Promise((r) => setTimeout(r, 10)); console.info('d'); return [typeof setTimeout, typeof clearTimeout]")];
    const r = await withLib("console.log('a'); const r = await lib.say(); console.error('e'); return r", library);
    expectOk(r, ["function", "function"], ["a", "b 1", '{"k":1}', "d", "e"]);
  });

  test("state: the code reads and changes it, and the result has it", async () => {
    const library = [item("bump", "state.n = (state.n ?? 0) + 1; return state.n")];
    const r = await withLib("await lib.bump(); return await lib.bump()", library, { state: { n: 5, keep: [1] } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.strictEqual(r.value, 7);
    assert.deepStrictEqual(r.state, { n: 7, keep: [1] });
    expectOk(await withLib("return await lib.seen()", [item("seen", "return typeof state")]), "undefined");
  });

  test("shell: the four names, and their calls are those of the table", async () => {
    const callTool = recorder(async (server, tool) => (tool === "run" ? { exitCode: 0, stdout: "a\n", stderr: "" } : "ok:" + tool));
    const library = [
      item("names", "return [typeof $, typeof read, typeof write, typeof edit]"),
      item("go", "return [await read('p'), await write('p', 't'), await edit('p', 'o', 'n'), await $`ls`.text()]"),
    ];
    expectOk(await withLib("return [await lib.names(), await lib.go()]", library, { shell: true, callTool }), [
      Array(4).fill("function"),
      ["ok:read", "ok:write", "ok:edit", "a\n"],
    ]);
    assert.deepStrictEqual(callTool.calls, [
      ["shell", "read", { path: "p" }],
      ["shell", "write", { path: "p", text: "t" }],
      ["shell", "edit", { path: "p", old: "o", new: "n" }],
      ["shell", "run", { command: "ls" }],
    ]);
    expectOk(await withLib("return await lib.names()", library), Array(4).fill("undefined"));
  });

  test("progress: a line it posts goes to onProgress, and is no line of logs", async () => {
    const lines = [];
    const library = [item("post", "progress('from saved', 1); console.log('log'); return typeof progress")];
    expectOk(await withLib("progress('first'); return await lib.post()", library, { onProgress: (l) => lines.push(l) }), "function", ["log"]);
    assert.deepStrictEqual(lines, ["first", "from saved 1"]);
    expectOk(await withLib("return await lib.post().catch((e) => e.name)", library), "ReferenceError");
  });

  test("a program that saves one does not find it under lib: lib is the list the caller gave", async () => {
    const callTool = recorder(async () => ({ saved: true }));
    const r = await withLib(
      "const a = await library.save('fresh', { about: 'a', params: ['x'], code: 'x', replace: true }); return [a, typeof lib.fresh, Object.keys(lib)]",
      [DOUBLE],
      { callTool },
    );
    expectOk(r, [{ saved: true }, "undefined", ["double"]]);
  });
});

describe("a saved program that is not valid JavaScript", () => {
  const library = [
    item("badCode", "const = ;"),
    item("badBrace", "}"),
    item("badImport", 'import fs from "node:fs";\n1'),
    item("badParam1", "return 1", ["1x"]),
    item("badParam2", "return 1", ["a b"]),
    item("badParam3", "return 1", ["a-b"]),
    item("badParam4", "return 1", ["class"]),
    DOUBLE,
    TWICE,
  ];
  const names = library.slice(0, 7).map((i) => i.name);

  test("each call of such a function rejects with an error whose name is SyntaxError", async () => {
    const code = [
      `const out = [];`,
      `for (const name of ${JSON.stringify(names)}) { try { await lib[name]({}); out.push('ran') } catch (e) { out.push(e.name) } }`,
      `return out`,
    ].join("\n");
    expectOk(await withLib(code, library), Array(7).fill("SyntaxError"));
  });

  test("nothing else is touched: the program and the other functions of lib work", async () => {
    const code = [
      "let seen;",
      "try { await lib.badCode({}) } catch (e) { seen = e.name }",
      "return [seen, typeof lib.badCode, typeof lib.badParam1, await lib.double({ n: 4 }), await lib.twice({ n: 2 })]",
    ].join("\n");
    expectOk(await withLib(code, library), ["SyntaxError", "function", "function", 8, 8]);
  });

  test("a program that never calls them ends with its own value", async () => {
    expectOk(await withLib("return await lib.double({ n: 1 })", library), 2);
  });

  test("one that does not catch it ends as kind error, SyntaxError", async () => {
    expectFail(await withLib("await lib.badCode({})", library), "error", /^SyntaxError: /, []);
  });

  test("a saved program that calls a broken one gets the SyntaxError, and can catch it", async () => {
    const items = [...library, item("caller", "try { await lib.badCode({}) } catch (e) { return e.name }")];
    expectOk(await withLib("return await lib.caller()", items), "SyntaxError");
  });
});

describe("each call runs the code anew", () => {
  test("a variable declared in the code is of that call alone", async () => {
    const library = [
      item("f", "var seen = typeof leaked; var leaked = n; const secret = n; return [seen, leaked]", ["n"]),
    ];
    const r = await withLib("const a = await lib.f({ n: 1 }); const b = await lib.f({ n: 2 }); return [a, b, typeof leaked, typeof secret, typeof seen]", library);
    expectOk(r, [["undefined", 1], ["undefined", 2], "undefined", "undefined", "undefined"]);
  });

  test("a call that makes a tool call makes it again at each call", async () => {
    const callTool = recorder(async () => 1);
    const library = [item("f", "return await tools.p.q({ n })", ["n"])];
    expectOk(await run("await lib.f({ n: 1 }); await lib.f({ n: 1 }); return await lib.f({ n: 2 })", { library, tools: { p: ["q"] }, callTool }), 1);
    assert.deepStrictEqual(callTool.calls, [
      ["p", "q", { n: 1 }],
      ["p", "q", { n: 1 }],
      ["p", "q", { n: 2 }],
    ]);
  });

  test("calls may run at the same time, each with its own variables and its own answer", async () => {
    const library = [item("slow", "const mine = n; await new Promise((r) => setTimeout(r, wait)); return mine", ["n", "wait"])];
    const r = await withLib(
      "return await Promise.all([lib.slow({ n: 'a', wait: 80 }), lib.slow({ n: 'b', wait: 10 }), lib.slow({ n: 'c', wait: 40 })])",
      library,
    );
    expectOk(r, ["a", "b", "c"]);
  });

  test("calls that wait for each other are all in flight at once", async () => {
    let arrived = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const giveUp = setTimeout(() => release("gave up"), 5000);
    const callTool = recorder(async (server, tool, args) => {
      arrived++;
      if (arrived === 3) release("open");
      return (await gate) + args.id;
    });
    const library = [item("f", "return await tools.s.t({ id })", ["id"])];
    const r = await run("return await Promise.all([1, 2, 3].map((id) => lib.f({ id })))", { library, tools: { s: ["t"] }, callTool });
    clearTimeout(giveUp);
    expectOk(r, ["open1", "open2", "open3"]);
  });
});

describe("library.save and library.remove: tool calls of the server library", () => {
  const answer = async () => ({ ok: true, when: new Date(0), skipped: undefined });

  test("save(name, { about, params, code, replace }) is callTool(library, save, { name, about, params, code, replace })", async () => {
    const callTool = recorder(answer);
    const r = await withLib("return await library.save('n', { about: 'a', params: ['x', 'y'], code: 'x + y', replace: true })", [], { callTool });
    expectOk(r, { ok: true, when: "1970-01-01T00:00:00.000Z" });
    assert.deepStrictEqual(callTool.calls, [["library", "save", { name: "n", about: "a", params: ["x", "y"], code: "x + y", replace: true }]]);
  });

  test("a key left out is dropped by the JSON round trip", async () => {
    const callTool = recorder(answer);
    await withLib(
      "await library.save('a', { code: 'x' }); await library.save('b', { about: undefined, params: [], replace: false }); await library.save(); return 1",
      [],
      { callTool },
    );
    assert.deepStrictEqual(callTool.calls, [
      ["library", "save", { name: "a", code: "x" }],
      ["library", "save", { name: "b", params: [], replace: false }],
      ["library", "save", {}],
    ]);
  });

  test("a second argument that is not an object gives { name } alone", async () => {
    const callTool = recorder(answer);
    await withLib("await library.save('a'); await library.save('b', undefined); await library.save('c', null); await library.save('d', 'text'); return 1", [], { callTool });
    assert.deepStrictEqual(callTool.calls, [
      ["library", "save", { name: "a" }],
      ["library", "save", { name: "b" }],
      ["library", "save", { name: "c" }],
      ["library", "save", { name: "d" }],
    ]);
  });

  test("other keys of the second argument and more arguments are dropped", async () => {
    const callTool = recorder(answer);
    await withLib("await library.save('a', { code: 'x', name: 'other', extra: 1, nested: { y: 2 } }, { code: 'ignored' }, 7); return 1", [], { callTool });
    assert.deepStrictEqual(callTool.calls, [["library", "save", { name: "a", code: "x" }]]);
  });

  test("remove(name) is callTool(library, remove, { name }), and more arguments are dropped", async () => {
    const callTool = recorder(async () => "gone");
    const r = await withLib("return [await library.remove('n'), await library.remove('m', 'extra', 3), await library.remove()]", [], { callTool });
    expectOk(r, ["gone", "gone", "gone"]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "remove", { name: "n" }],
      ["library", "remove", { name: "m" }],
      ["library", "remove", {}],
    ]);
  });

  test("what callTool resolves with comes back after a JSON round trip, undefined stays undefined", async () => {
    const callTool = recorder(async (server, tool) => (tool === "save" ? undefined : { a: [1, undefined], n: null }));
    const r = await withLib("const s = await library.save('n'); const m = await library.remove('n'); return [s === undefined, m]", [], { callTool });
    expectOk(r, [true, { a: [1, null], n: null }]);
  });

  test("when callTool rejects or throws, the call throws an Error with the message of what was thrown", async () => {
    const things = [new Error("taken"), "a plain string", { message: "an object message" }, 12];
    let i = 0;
    const callTool = recorder(async () => {
      throw things[i++ % things.length];
    });
    const code = [
      "const out = [];",
      "const take = async (p) => { try { await p; out.push('no error') } catch (e) { out.push([e instanceof Error, e.message]) } };",
      "await take(library.save('a')); await take(library.remove('b')); await take(library.save('c')); await take(library.remove('d'));",
      "return out",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool }), [
      [true, "taken"],
      [true, "a plain string"],
      [true, "an object message"],
      [true, "12"],
    ]);
  });

  test("arguments JSON cannot hold: the call throws in the program and callTool is not called", async () => {
    const callTool = recorder();
    const code = [
      "const out = [];",
      "const take = async (p) => { try { await p; out.push('no error') } catch (e) { out.push([e instanceof Error, e.message]) } };",
      "const cyc = {}; cyc.self = cyc;",
      "await take(library.save('a', { params: [1n] })); await take(library.save('b', { code: cyc })); await take(library.remove(cyc));",
      "return out",
    ].join("\n");
    expectOk(await withLib(code, [], { callTool }), Array(3).fill([true, "the arguments cannot be sent as JSON"]));
    assert.deepStrictEqual(callTool.calls, []);
  });

  test("calls may run at the same time, each gets its own answer", async () => {
    const callTool = recorder(async (server, tool, args) => {
      await sleep(args.name === "slow" ? 60 : 5);
      return args.name;
    });
    expectOk(await withLib("return await Promise.all([library.save('slow'), library.remove('fast'), library.save('mid')])", [], { callTool }), ["slow", "fast", "mid"]);
    assert.strictEqual(callTool.calls.length, 3);
  });

  test("they are async functions, and tools is not changed: a tools key named library is reached as before", async () => {
    const callTool = recorder(async () => "x");
    const r = await run(
      "const p = library.save('a'); const t = typeof p.then; await p; return [t, Object.keys(tools), await tools.library.save({ name: 'viaTools' }), await library.save('n')]",
      { library: [DOUBLE], tools: { library: ["save"], p: ["q"] }, callTool },
    );
    expectOk(r, ["function", ["library", "p"], "x", "x"]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "save", { name: "a" }],
      ["library", "save", { name: "viaTools" }],
      ["library", "save", { name: "n" }],
    ]);
  });

  test("answers still waiting when the program ends are dropped: callTool is never called after the promise resolved", async () => {
    let resolved = false;
    let late = 0;
    const callTool = recorder(async () => {
      if (resolved) late++;
      await sleep(100);
      return 1;
    });
    expectOk(await withLib("library.save('a'); library.remove('b'); return 'done'", [], { callTool }), "done");
    resolved = true;
    await sleep(300);
    assert.strictEqual(late, 0, "callTool was called after the promise resolved");
  });

  test("the saved program that calls library.save makes the same call, with a use for its own call only", async () => {
    const callTool = recorder(async () => "saved");
    const onLibrary = useSpy();
    const library = [item("keep", "return await library.save(n, { code: 'x' })", ["n"])];
    expectOk(await withLib("return await lib.keep({ n: 'z' })", library, { callTool, onLibrary }), "saved");
    assert.deepStrictEqual(callTool.calls, [["library", "save", { name: "z", code: "x" }]]);
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "keep", ok: true }]);
  });
});

describe("onLibrary: the caller hears of each call of a saved program", () => {
  const SLOW = item("slow", "await new Promise((r) => setTimeout(r, 120)); return 's'");
  const FAST = item("fast", "return 'f'");

  test("it is called once per call that has ended, with one argument: an object with exactly name and ok", async () => {
    const onLibrary = useSpy();
    const r = await withLib("await lib.double({ n: 1 }); await lib.double({ n: 2 }); try { await lib.boom() } catch {} return 1", [DOUBLE, BOOM], { onLibrary });
    expectOk(r, 1);
    assert.deepStrictEqual(onLibrary.uses(), [
      { name: "double", ok: true },
      { name: "double", ok: true },
      { name: "boom", ok: false },
    ]);
    assert.ok(onLibrary.calls.every((args) => args.length === 1), "onLibrary was given more than the use");
    for (const use of onLibrary.uses()) {
      assert.deepStrictEqual(Object.keys(use).sort(), ["name", "ok"]);
      assert.strictEqual(Object.getPrototypeOf(use), Object.prototype);
    }
  });

  test("a saved program that calls another gives two uses, the inner one first", async () => {
    const onLibrary = useSpy();
    expectOk(await withLib("return await lib.twice({ n: 3 })", EXAMPLE, { onLibrary }), 12);
    assert.deepStrictEqual(onLibrary.uses(), [
      { name: "double", ok: true },
      { name: "double", ok: true },
      { name: "twice", ok: true },
    ]);
  });

  test("a call that calls itself gives a use for each call, the innermost first", async () => {
    const onLibrary = useSpy();
    const library = [item("down", "n <= 0 ? 0 : await lib.down({ n: n - 1 })", ["n"])];
    expectOk(await withLib("return await lib.down({ n: 2 })", library, { onLibrary }), 0);
    assert.deepStrictEqual(onLibrary.uses(), Array(3).fill({ name: "down", ok: true }));
  });

  test("ok is false when the call rejected: a throw of the code, a TypeError for its args, a SyntaxError", async () => {
    const onLibrary = useSpy();
    const library = [BOOM, DOUBLE, item("broken", "const = ;"), item("rej", "await Promise.reject('r')")];
    const code = [
      "const take = async (p) => { try { await p } catch {} };",
      "await take(lib.boom()); await take(lib.double(null)); await take(lib.broken()); await take(lib.rej()); await take(lib.double([]));",
      "return 1",
    ].join("\n");
    expectOk(await withLib(code, library, { onLibrary }), 1);
    assert.deepStrictEqual(onLibrary.uses(), [
      { name: "boom", ok: false },
      { name: "double", ok: false },
      { name: "broken", ok: false },
      { name: "rej", ok: false },
      { name: "double", ok: false },
    ]);
  });

  test("a saved program whose inner call rejected and was not caught: both uses are ok false, inner first", async () => {
    const onLibrary = useSpy();
    const library = [BOOM, item("outer", "await lib.boom()")];
    expectFail(await withLib("await lib.outer()", library, { onLibrary }), "error", "Error: boom", []);
    assert.deepStrictEqual(onLibrary.uses(), [
      { name: "boom", ok: false },
      { name: "outer", ok: false },
    ]);
  });

  test("the uses come in the order the calls ended, not the order they began", async () => {
    const onLibrary = useSpy();
    expectOk(await withLib("const s = lib.slow(); const f = lib.fast(); return await Promise.all([s, f])", [SLOW, FAST], { onLibrary }), ["s", "f"]);
    assert.deepStrictEqual(onLibrary.uses(), [
      { name: "fast", ok: true },
      { name: "slow", ok: true },
    ]);
  });

  test("the name is the one under lib, whatever it looks like", async () => {
    const onLibrary = useSpy();
    const library = [item("my prog", "return 1"), item("get-rows", "return 2")];
    expectOk(await withLib('return [await lib["my prog"](), await lib["get-rows"]()]', library, { onLibrary }), [1, 2]);
    assert.deepStrictEqual(onLibrary.uses(), [
      { name: "my prog", ok: true },
      { name: "get-rows", ok: true },
    ]);
  });

  test("a use is no tool call, is not in logs, and library.save and library.remove give none", async () => {
    const onLibrary = useSpy();
    const callTool = recorder(async () => null);
    const r = await withLib("console.log('log'); await lib.double({ n: 1 }); await library.save('a'); await library.remove('a'); return 1", [DOUBLE], { onLibrary, callTool });
    expectOk(r, 1, ["log"]);
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "double", ok: true }]);
    assert.deepStrictEqual(callTool.calls, [
      ["library", "save", { name: "a" }],
      ["library", "remove", { name: "a" }],
    ]);
  });

  test("console.log and progress call no onLibrary", async () => {
    const onLibrary = useSpy();
    expectOk(await withLib("console.log('a'); progress('b'); return 1", [DOUBLE], { onLibrary, onProgress: () => {} }), 1, ["a"]);
    assert.deepStrictEqual(onLibrary.calls, []);
  });

  test("a call that had not ended when the program's result was known gives no use; one that had ended gives one", async () => {
    const onLibrary = useSpy();
    let atResolve;
    const r = await withLib("lib.slow(); lib.fast(); await new Promise((r) => setTimeout(r, 40)); return 'end'", [SLOW, FAST], { onLibrary });
    atResolve = onLibrary.uses();
    expectOk(r, "end");
    assert.deepStrictEqual(atResolve, [{ name: "fast", ok: true }], "the use of a call that ended before the program's end was not handed over");
    await sleep(400);
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "fast", ok: true }], "a call that had not ended gave a use");
  });

  test("a call still waiting for a tool when the program returns gives no use", async () => {
    const onLibrary = useSpy();
    const callTool = recorder(() => new Promise(() => {}));
    const library = [item("wait", "return await tools.s.t({})")];
    expectOk(await run("lib.wait(); await new Promise((r) => setTimeout(r, 30)); return 1", { library, tools: { s: ["t"] }, callTool, onLibrary }), 1);
    await sleep(200);
    assert.deepStrictEqual(onLibrary.calls, []);
  });

  test("every use that ended before the end of the program is handed over before the promise resolves: ok true", async () => {
    const onLibrary = useSpy();
    const r = await withLib("for (let i = 0; i < 100; i++) await lib.double({ n: i });\nawait lib.double({ n: 100 });\nreturn 1", [DOUBLE], { onLibrary });
    expectOk(r, 1);
    assert.strictEqual(onLibrary.calls.length, 101, "a use was not handed over when the promise resolved");
  });

  test("every use that ended before the end of the program is handed over before the promise resolves: kind error", async () => {
    const onLibrary = useSpy();
    const r = await withLib("for (let i = 0; i < 50; i++) await lib.double({ n: i });\nthrow new Error('after')", [DOUBLE], { onLibrary });
    expectFail(r, "error", "Error: after", []);
    assert.strictEqual(onLibrary.calls.length, 50);
    const second = useSpy();
    const r2 = await withLib("await lib.double({ n: 1 }); await lib.double({ n: 2 }); return 1n", [DOUBLE], { onLibrary: second });
    expectFail(r2, "error", "the value cannot be sent as JSON", []);
    assert.strictEqual(second.calls.length, 2);
  });

  test("with state, a tool call and logs, all of them still as they were", async () => {
    const onLibrary = useSpy();
    const callTool = recorder(async (server, tool, args) => ({ echo: args.n }));
    const library = [item("f", "const a = await tools.s.t({ n }); state.n = a.echo; console.log('log'); return a.echo", ["n"])];
    const r = await run("return await lib.f({ n: 1 })", { library, onLibrary, callTool, tools: { s: ["t"] }, state: { n: 0 } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.strictEqual(r.value, 1);
    assert.deepStrictEqual(r.logs, ["log"]);
    assert.deepStrictEqual(r.state, { n: 1 });
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "f", ok: true }]);
    assert.deepStrictEqual(callTool.calls, [["s", "t", { n: 1 }]]);
  });

  test("what onLibrary returns is not read: a value, a promise that never settles", async () => {
    const onLibrary = useSpy((use) => (use.name === "a" ? 5 : new Promise(() => {})));
    const library = [item("a", "return 1"), item("b", "return 2"), item("c", "return 3")];
    expectOk(await withLib("return [await lib.a(), await lib.b(), await lib.c()]", library, { onLibrary }), [1, 2, 3]);
    assert.strictEqual(onLibrary.calls.length, 3);
  });

  test("when onLibrary throws, the program is not told, the run goes on, and the next use is handed over", async () => {
    const onLibrary = useSpy((use) => {
      if (use.name === "b") throw new Error("the caller's function failed");
      if (use.name === "c") throw "a string";
    });
    const library = ["a", "b", "c", "d"].map((name) => item(name, `return '${name}'`));
    const r = await withLib("const out = []; for (const n of ['a', 'b', 'c', 'd']) { try { out.push(await lib[n]()) } catch { out.push('told') } } return out", library, { onLibrary });
    expectOk(r, ["a", "b", "c", "d"]);
    assert.deepStrictEqual(onLibrary.uses().map((u) => u.name), ["a", "b", "c", "d"]);
  });

  test("a throwing onLibrary leaves no failure in the caller", async () => {
    await noFailure(async () => {
      const onLibrary = useSpy(() => {
        throw new Error("always");
      });
      expectOk(await withLib("await lib.double({ n: 1 }); return await lib.double({ n: 2 })", [DOUBLE], { onLibrary }), 4);
      assert.strictEqual(onLibrary.calls.length, 2);
    });
  });

  test("with onLibrary good and no saved program called, it is never called", async () => {
    const onLibrary = useSpy();
    expectOk(await withLib("return 1", [DOUBLE], { onLibrary }), 1);
    expectOk(await withLib("return 1", [], { onLibrary }), 1);
    assert.deepStrictEqual(onLibrary.calls, []);
  });

  test("two calls at once, each with its own library and its own onLibrary", async () => {
    const a = useSpy();
    const b = useSpy();
    const [ra, rb] = await Promise.all([
      withLib("return [await lib.f(), await lib.f()]", [item("f", "return 'a'")], { onLibrary: a }),
      withLib("return [await lib.f(), await lib.g()]", [item("f", "return 'b'"), item("g", "return 'bg'")], { onLibrary: b }),
    ]);
    expectOk(ra, ["a", "a"]);
    expectOk(rb, ["b", "bg"]);
    assert.deepStrictEqual(a.uses(), [
      { name: "f", ok: true },
      { name: "f", ok: true },
    ]);
    assert.deepStrictEqual(b.uses(), [
      { name: "f", ok: true },
      { name: "g", ok: true },
    ]);
  });
});

describe("onLibrary is never called after the promise has resolved", () => {
  test("after a stop at the limit, by a program that calls all the time", async () => {
    let resolved = false;
    let late = 0;
    let count = 0;
    const onLibrary = () => {
      count++;
      if (resolved) late++;
    };
    const r = await withLib("while (true) { await lib.double({ n: 1 }); await new Promise((r) => setTimeout(r, 1)) }", [DOUBLE], { onLibrary, timeoutMs: 600 });
    resolved = true;
    expectFail(r, "timeout", "stopped after 600 ms");
    assert.ok(count > 0, "no use was handed over before the stop");
    const atResolve = count;
    await sleep(300);
    assert.strictEqual(late, 0, "onLibrary was called after the promise resolved");
    assert.strictEqual(count, atResolve);
  });

  test("after a stop by the abort of a signal", async () => {
    const controller = new AbortController();
    let resolved = false;
    let late = 0;
    let count = 0;
    const onLibrary = () => {
      count++;
      if (resolved) late++;
      if (count === 3) controller.abort();
    };
    const r = await withLib("while (true) { await lib.double({ n: 1 }); await new Promise((r) => setTimeout(r, 1)) }", [DOUBLE], {
      onLibrary,
      signal: controller.signal,
    });
    resolved = true;
    expectFail(r, "stopped", "stopped by the caller");
    await sleep(300);
    assert.strictEqual(late, 0, "onLibrary was called after the promise resolved");
  });

  test("after a program that ended, with a call a timer it left behind starts", async () => {
    let resolved = false;
    let late = 0;
    const onLibrary = () => {
      if (resolved) late++;
    };
    const r = await withLib("setTimeout(() => lib.double({ n: 1 }), 150);\nreturn 1", [DOUBLE], { onLibrary });
    resolved = true;
    expectOk(r, 1);
    await sleep(400);
    assert.strictEqual(late, 0, "onLibrary was called after the promise resolved");
  });

  test("the limit passes as a saved program ends: one result, the value or the timeout, and no late use", async () => {
    await noFailure(async () => {
      const limits = [];
      for (let ms = 60; ms <= 300; ms += 20) limits.push(ms);
      const library = [item("nap", "await new Promise((r) => setTimeout(r, 30)); return 7")];
      const late = [];
      const outcomes = await Promise.all(
        limits.map(async (ms, i) => {
          let resolved = false;
          const r = await runProgram("await lib.nap(); return 7", {
            library,
            callTool: recorder(),
            timeoutMs: ms,
            onLibrary: () => {
              if (resolved) late.push(i);
            },
          });
          resolved = true;
          return r;
        }),
      );
      outcomes.forEach((r, i) => {
        if (r.ok) expectOk(r, 7);
        else expectFail(r, "timeout", `stopped after ${limits[i]} ms`);
      });
      await sleep(200);
      assert.deepStrictEqual(late, [], "onLibrary was called after the promise resolved");
      await settle();
    });
  });
});

describe("a bad library", () => {
  const goodItem = item("f", "return a", ["a"]);
  const bad = [
    ["null", null],
    ["an object", {}],
    ["an object with a length", { length: 0 }],
    ["an object that looks like a list", { 0: goodItem, length: 1 }],
    ["a string", "double"],
    ["an empty string", ""],
    ["a number", 5],
    ["true", true],
    ["false", false],
    ["a function", () => []],
    ["an item that is null", [null]],
    ["an item that is a string", ["double"]],
    ["an item that is a number", [5]],
    ["an item that is a list", [["f", [], "1"]]],
    ["an item that is a function", [() => 1]],
    ["an item with no name", [{ params: [], code: "1" }]],
    ["a name that is a number", [{ name: 1, params: [], code: "1" }]],
    ["a name that is null", [{ name: null, params: [], code: "1" }]],
    ["a name that is a list", [{ name: ["f"], params: [], code: "1" }]],
    ["an item with no params", [{ name: "f", code: "1" }]],
    ["params that is a string", [{ name: "f", params: "n", code: "1" }]],
    ["params that is null", [{ name: "f", params: null, code: "1" }]],
    ["params that is an object", [{ name: "f", params: { 0: "n", length: 1 }, code: "1" }]],
    ["a param that is a number", [{ name: "f", params: [1], code: "1" }]],
    ["a param that is null", [{ name: "f", params: [null], code: "1" }]],
    ["a param that is a list", [{ name: "f", params: [["n"]], code: "1" }]],
    ["an item with no code", [{ name: "f", params: [] }]],
    ["code that is a number", [{ name: "f", params: [], code: 1 }]],
    ["code that is null", [{ name: "f", params: [], code: null }]],
    ["code that is a list", [{ name: "f", params: [], code: ["1"] }]],
    ["code that is a function", [{ name: "f", params: [], code: () => 1 }]],
    ["a good item and then a bad one", [goodItem, { name: "g", params: [], code: 1 }]],
    ["a bad item and then a good one", [{ name: "g", params: [1], code: "1" }, goodItem]],
  ];
  for (const [name, library] of bad) {
    test(`${name}: a TypeError, and no process is started`, async () => {
      await settle();
      let promise;
      assert.doesNotThrow(() => {
        promise = runProgram("1 + 1", { library, callTool: recorder(), timeoutMs: 8000 });
      }, "the call is rejected, never thrown at once");
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("a good library with callTool that is not a function: a TypeError, and no process is started", async () => {
    await settle();
    for (const callTool of [undefined, null, "callTool", {}, 5, [() => {}]]) {
      for (const library of [[], [DOUBLE], EXAMPLE]) {
        await assert.rejects(runProgram("1 + 1", { library, callTool, timeoutMs: 8000 }), TypeError);
      }
    }
    await assert.rejects(runProgram("1 + 1", { library: [DOUBLE], timeoutMs: 8000 }), TypeError);
    assert.deepStrictEqual(childRows(), []);
    await sleep(30);
    assert.deepStrictEqual(childRows(), []);
  });

  test("an item with other keys, empty params and an empty code is good; the other keys are not read", async () => {
    const library = [
      { name: "f", params: [], code: "return 1", about: 5, extra: { nested: true }, replace: "yes", name2: null },
      { name: "g", params: [], code: "" },
    ];
    expectOk(await withLib("return [await lib.f(), await lib.g() === undefined]", library), [1, true]);
  });

  test("a library that is good, with the other arguments bad: the TypeError of those", async () => {
    const callTool = recorder();
    await assert.rejects(runProgram(5, { library: [DOUBLE], callTool }), TypeError);
    await assert.rejects(runProgram("1", { library: [DOUBLE], callTool, timeoutMs: 0 }), TypeError);
    await assert.rejects(runProgram("1", { library: [DOUBLE], callTool, memoryMb: 8 }), TypeError);
    await assert.rejects(runProgram("1", { library: [DOUBLE], callTool, state: null }), TypeError);
    await assert.rejects(runProgram("1", { library: [DOUBLE], callTool, shell: "yes" }), TypeError);
    await assert.rejects(runProgram("1", { library: [DOUBLE], callTool, onProgress: 5 }), TypeError);
    await assert.rejects(runProgram("1", { library: [DOUBLE], callTool, signal: {} }), TypeError);
    assert.deepStrictEqual(childRows(), []);
  });

  test("the library is not read when it is not given: absent and undefined never reject", async () => {
    expectOk(await run("return 1", { library: undefined }), 1);
    expectOk(await run("return 1", { library: undefined, callTool: undefined }), 1);
  });
});

describe("a bad onLibrary", () => {
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
  for (const [name, onLibrary] of bad) {
    test(`${name}: a TypeError, and no process is started, with a library and without`, async () => {
      await settle();
      for (const options of [{ library: [DOUBLE], callTool: recorder() }, {}]) {
        let promise;
        assert.doesNotThrow(() => {
          promise = runProgram("1 + 1", { ...options, onLibrary, timeoutMs: 8000 });
        }, "the call is rejected, never thrown at once");
        assert.ok(promise instanceof Promise);
        await assert.rejects(promise, TypeError);
      }
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("a function of any kind is good: an arrow, an async function, a bound function, a class method", async () => {
    const seen = [];
    class Holder {
      take(use) {
        seen.push("method:" + use.name);
      }
    }
    const kinds = [
      (use) => seen.push("arrow:" + use.name),
      async (use) => seen.push("async:" + use.name),
      function (use) {
        seen.push("function:" + use.name);
      },
      new Holder().take.bind(new Holder()),
    ];
    for (const onLibrary of kinds) expectOk(await withLib("return await lib.double({ n: 1 })", [DOUBLE], { onLibrary }), 2);
    assert.deepStrictEqual(seen, ["arrow:double", "async:double", "function:double", "method:double"]);
  });

  test("undefined is good", async () => {
    expectOk(await withLib("return await lib.double({ n: 1 })", [DOUBLE], { onLibrary: undefined }), 2);
  });
});

describe("the walls hold through lib and library", () => {
  const LIBRARY = [
    DOUBLE,
    BOOM,
    item("fn", "return () => 1"),
    item("obj", "return {}"),
    item("arr", "return []"),
    item("err", "return new Error('made')"),
    item("typeErr", "null.x"),
    item("syntax", "const = ;"),
    item("toolFail", "await tools.p.fail({})"),
    item("toolVal", "return await tools.p.val({})"),
    item("inside", [
      "const out = [typeof process, typeof require, typeof fetch, typeof module, typeof Buffer, typeof WebSocket];",
      `out.push((function () {}).constructor(${T})(), Function(${T})(), eval("typeof process"), await (async () => {}).constructor(${T})());`,
      `out.push(await lib.double.constructor(${T})(), await library.save.constructor(${T})(), typeof globalThis.process);`,
      "return out",
    ].join("\n")),
    item("imports", [
      "const out = [];",
      'for (const spec of ["node:fs", "fs", "./x.js", "data:text/javascript,export default 1", "node:child_process", "node:worker_threads"]) {',
      '  try { await import(spec); out.push("loaded") } catch (e) { out.push("rejected") }',
      "}",
      "return out",
    ].join("\n")),
    item("staticImport", 'import fs from "node:fs";\nreturn 1'),
  ];
  const callTool = () =>
    recorder(async (server, tool) => {
      if (tool === "fail") throw new Error("the tool failed");
      return { a: 1 };
    });
  const withWalls = (code, options = {}) => run(code, { library: LIBRARY, tools: { p: ["fail", "val"] }, callTool: callTool(), ...options });
  const PRELUDE = "const caught = async (p) => { try { await p; return 'no error' } catch (e) { return e } };\n";

  test("typeof process, require, fetch, module, Buffer and WebSocket are all undefined, in the code and through lib", async () => {
    expectOk(await withWalls("return [await lib.inside(), typeof lib, typeof library]"), [
      Array(13).fill("undefined"),
      "object",
      "object",
    ]);
  });

  test("import() rejects in the code of a saved program, and a static import line is a SyntaxError", async () => {
    expectOk(await withWalls("return await lib.imports()"), Array(6).fill("rejected"));
    expectOk(await withWalls(PRELUDE + "return (await caught(lib.staticImport())).name"), "SyntaxError");
  });

  describe("the function constructor, through everything the program is given", () => {
    const paths = [
      ["a function of lib", `lib.double.constructor(${T})()`],
      ["the constructor of that constructor", `lib.double.constructor.constructor(${T})()`],
      ["the prototype of a function of lib", `Object.getPrototypeOf(lib.double).constructor(${T})()`],
      ["call of a function of lib", `lib.double.call.constructor(${T})()`],
      ["bind of a function of lib", `lib.double.bind().constructor(${T})()`],
      ["lib itself", `lib.constructor.constructor(${T})()`],
      ["library itself", `library.constructor.constructor(${T})()`],
      ["library.save", `library.save.constructor(${T})()`],
      ["library.remove", `library.remove.constructor(${T})()`],
      ["the constructor of library.save", `library.save.constructor.constructor(${T})()`],
      ["the global object", `globalThis.lib.double.constructor(${T})()`],
      ["the global object, library, as a key", `globalThis["library"].save.constructor.constructor(${T})()`],
      ["the promise of a call", `lib.double({ n: 1 }).constructor.constructor(${T})()`],
      ["a function a saved program returned", `(await lib.fn()).constructor(${T})()`],
      ["an object a saved program returned", `(await lib.obj()).constructor.constructor(${T})()`],
      ["the prototype of an object a saved program returned", `Object.getPrototypeOf(await lib.obj()).constructor.constructor(${T})()`],
      ["a list a saved program returned", `(await lib.arr()).constructor.constructor(${T})()`],
      ["an error a saved program returned", `(await lib.err()).constructor.constructor(${T})()`],
      ["a value a tool call returned inside a saved program", `(await lib.toolVal()).constructor.constructor(${T})()`],
      ["an error a saved program threw", `(await caught(lib.boom())).constructor.constructor(${T})()`],
      ["the prototype of an error a saved program threw", `Object.getPrototypeOf(await caught(lib.boom())).constructor.constructor(${T})()`],
      ["a TypeError the code made", `(await caught(lib.typeErr())).constructor.constructor(${T})()`],
      ["the TypeError of a bad args", `(await caught(lib.double(null))).constructor.constructor(${T})()`],
      ["the SyntaxError of a bad code", `(await caught(lib.syntax())).constructor.constructor(${T})()`],
      ["an error a tool call threw inside a saved program", `(await caught(lib.toolFail())).constructor.constructor(${T})()`],
      ["an error library.save threw", `(await caught(library.save('x'))).constructor.constructor(${T})()`],
    ];
    for (const [name, code] of paths) {
      test(name, async () => {
        const callTool = recorder(async () => {
          throw new Error("refused");
        });
        const options = name.startsWith("an error library.save") ? { callTool, tools: {} } : {};
        expectOk(await withWalls(`${PRELUDE}return ${code}`, options), "undefined");
      });
    }
  });

  test("no file is read, no file written, no process started, no worker, through a saved program", async () => {
    const library = [
      item("tries", [
        "const out = {};",
        'for (const n of ["process", "require", "Buffer", "fetch"]) out[n] = typeof globalThis[n];',
        'try { await import("node:fs"); out.fs = "loaded" } catch { out.fs = "rejected" }',
        'try { await import("node:child_process"); out.cp = "loaded" } catch { out.cp = "rejected" }',
        'try { await import("node:worker_threads"); out.w = "loaded" } catch { out.w = "rejected" }',
        "return out",
      ].join("\n")),
    ];
    expectOk(await withLib("return await lib.tries()", library), {
      process: "undefined",
      require: "undefined",
      Buffer: "undefined",
      fetch: "undefined",
      fs: "rejected",
      cp: "rejected",
      w: "rejected",
    });
  });

  test("the program and the saved program share one world: what the one finds, the other finds", async () => {
    const library = [item("typeofProcess", "return typeof process")];
    expectOk(await withLib("return [typeof process, await lib.typeofProcess()]", library), ["undefined", "undefined"]);
  });

  test("lib and library may be hidden by a declaration of the program's own", async () => {
    const code = [
      "const lib = { double: async () => 'mine' };",
      "const library = 'also mine';",
      "return [await lib.double(), library]",
    ].join("\n");
    expectOk(await withLib(code, [DOUBLE]), ["mine", "also mine"]);
    expectOk(await withLib("let lib = 3; return lib", [DOUBLE]), 3);
  });
});

describe("library and onLibrary with shell, state, tools, onProgress and signal: each does what its own section says", () => {
  test("with every one at once, nothing changes another", async () => {
    const lines = [];
    const onLibrary = useSpy();
    const controller = new AbortController();
    const callTool = recorder(async (server, tool) => (tool === "run" ? { exitCode: 0, stdout: "o\n", stderr: "" } : [server, tool]));
    const library = [item("all", "progress('in saved'); state.k = n; console.log('saved log'); return [await tools.s.t({}), await $`ls`.text(), await library.save('x')]", ["n"])];
    const r = await run("progress('first'); return await lib.all({ n: 1 })", {
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
    assert.deepStrictEqual(r.value, [["s", "t"], "o\n", ["library", "save"]]);
    assert.deepStrictEqual(r.logs, ["saved log"]);
    assert.deepStrictEqual(r.state, { k: 1 });
    assert.deepStrictEqual(lines, ["first", "in saved"]);
    assert.deepStrictEqual(onLibrary.uses(), [{ name: "all", ok: true }]);
    assert.deepStrictEqual(callTool.calls, [
      ["s", "t", {}],
      ["shell", "run", { command: "ls" }],
      ["library", "save", { name: "x" }],
    ]);
  });

  test("a failed program with state keeps what a saved program put there", async () => {
    const library = [item("put", "state.a = 9")];
    const r = await withLib("await lib.put(); throw new Error('x')", library, { state: { a: 1 } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["error", "logs", "ok", "state"]);
    assert.strictEqual(r.error.message, "Error: x");
    assert.deepStrictEqual(r.state, { a: 9 });
  });

  test("tools is not changed: its keys are the caller's, whatever the library holds", async () => {
    const r = await run("return [Object.keys(tools), typeof tools.library, typeof tools.lib, typeof tools.double]", {
      library: [DOUBLE],
      tools: { p: ["q"] },
      callTool: recorder(),
    });
    expectOk(r, [["p"], "undefined", "undefined", "undefined"]);
  });

  test("a signal that never aborts changes nothing", async () => {
    const { signal } = new AbortController();
    const onLibrary = useSpy();
    expectOk(await withLib("return await lib.twice({ n: 2 })", EXAMPLE, { signal, onLibrary }), 8);
    assert.strictEqual(onLibrary.calls.length, 3);
  });

  test("a signal already aborted: no process, no callTool, no onLibrary, the result stopped, with the state of the argument", async () => {
    await settle();
    const callTool = recorder();
    const onLibrary = useSpy();
    const r = await withLib("await lib.double({ n: 1 })", [DOUBLE], { signal: AbortSignal.abort(), callTool, onLibrary, state: { a: 1 } });
    assert.deepStrictEqual(r, { ok: false, error: { kind: "stopped", message: "stopped by the caller" }, logs: [], state: { a: 1 } });
    assert.deepStrictEqual(callTool.calls, []);
    assert.deepStrictEqual(onLibrary.calls, []);
    assert.deepStrictEqual(childRows(), []);
  });

  test("the abort stops a saved program as it stops any text of its program: one process, stopped, no use", async () => {
    await settle();
    const controller = new AbortController();
    const onLibrary = useSpy();
    const callTool = recorder(() => new Promise(() => {}));
    const library = [item("wait", "console.log('saved started'); await tools.s.t({})")];
    const running = run("await lib.wait()", { library, tools: { s: ["t"] }, callTool, onLibrary, signal: controller.signal, state: { a: 1 }, timeoutMs: 8000 });
    assert.ok(await waitFor(() => callTool.calls.length === 1, 5000), "the saved program made no tool call");
    assert.strictEqual(childRows().length, 1, "a saved program runs in the one process of its program");
    controller.abort();
    const r = await running;
    assert.deepStrictEqual(Object.keys(r).sort(), ["error", "logs", "ok", "state"]);
    assert.deepStrictEqual(r.error, { kind: "stopped", message: "stopped by the caller" });
    assert.ok(r.logs.every((l) => l === "saved started"));
    assert.deepStrictEqual(r.state, { a: 1 });
    assert.ok(await waitFor(() => childRows().length === 0, 5000), "the process of the program still runs");
    await sleep(100);
    assert.deepStrictEqual(onLibrary.calls, [], "a call that had not ended gave a use");
    assert.strictEqual(callTool.calls.length, 1);
  });

  test("the time limit stops a saved program that never awaits, with the kind timeout and no use", async () => {
    await settle();
    const onLibrary = useSpy();
    const library = [item("spin", "while (true) {}")];
    const r = await withLib("await lib.spin()", library, { timeoutMs: 400, onLibrary, state: { s: [1] } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["error", "logs", "ok", "state"]);
    assert.deepStrictEqual(r.error, { kind: "timeout", message: "stopped after 400 ms" });
    assert.deepStrictEqual(r.state, { s: [1] });
    assert.ok(await waitFor(() => childRows().length === 0, 5000), "the process of the program still runs");
    await sleep(100);
    assert.deepStrictEqual(onLibrary.calls, []);
  });

  test("whichever comes first ends the program, with its own kind: a short limit, and a signal that aborts later", async () => {
    await settle();
    const controller = new AbortController();
    const r = await withLib("await lib.never()", [item("never", "await new Promise(() => {})")], { timeoutMs: 300, signal: controller.signal });
    expectFail(r, "timeout", "stopped after 300 ms");
    assert.doesNotThrow(() => controller.abort());
    await sleep(50);
  });

  test("the uses of a program stopped at the limit may be fewer than its calls that ended, never more", async () => {
    const onLibrary = useSpy();
    const library = [item("fast", "return 1"), item("spin", "while (true) {}")];
    const r = await withLib("await lib.fast(); await lib.fast(); await lib.spin()", library, { timeoutMs: 500, onLibrary });
    expectFail(r, "timeout", "stopped after 500 ms");
    assert.ok(onLibrary.calls.length <= 2);
    assert.ok(onLibrary.uses().every((u) => u.name === "fast" && u.ok === true));
  });
});
