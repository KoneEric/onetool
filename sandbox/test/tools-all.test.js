import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, sleep, childRows, waitFor } from "./helpers.js";

// Step 10: a server given as `true` in `tools`: every name under it is a tool call.

const T = '"return typeof process"';
const far = { far: true };

// A promise that gives up after `ms` (10 s at most, as the text asks of a wait), so that a missing piece
// fails in seconds and not at the limit of the runner.
function within(promise, ms = 10000) {
  let timer;
  const giveUp = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gave up after ${ms} ms`)), ms);
  });
  return Promise.race([promise, giveUp]).finally(() => clearTimeout(timer));
}

async function received(code, impl, tools = far, extra = {}) {
  const callTool = recorder(impl);
  const r = await within(runProgram(code, { tools, callTool, timeoutMs: 10000, ...extra }));
  return { r, calls: callTool.calls };
}

describe("a server given as true: what the program finds", () => {
  test("an object under tools, with no key of its own, and a function for every name", async () => {
    const { r } = await received(
      [
        "return [typeof tools.far, Object.keys(tools), Object.keys(tools.far),",
        "  typeof tools.far.count, typeof tools.far.anything, typeof tools.far['get-rows'], typeof tools.far['a b'],",
        "  typeof tools.far[''], typeof tools.far['123']]",
      ].join("\n"),
      undefined,
      { practice: ["rows", "count"], far: true },
    );
    expectOk(r, ["object", ["practice", "far"], [], "function", "function", "function", "function", "function", "function"]);
  });

  test("a server name that is no identifier is reached with brackets", async () => {
    const { r, calls } = await received('return await tools["my server"].x({ n: 1 })', async () => "got", {
      "my server": true,
    });
    expectOk(r, "got");
    assert.deepStrictEqual(calls, [["my server", "x", { n: 1 }]]);
  });

  test("typeof of a function it gives is function, and the call gives a promise", async () => {
    const { r } = await received("const p = tools.far.anything({});\nconst t = typeof p.then;\nawait p;\nt");
    expectOk(r, "function");
  });

  test("then and toJSON are undefined", async () => {
    const { r, calls } = await received("return [typeof tools.far.then, typeof tools.far.toJSON]");
    expectOk(r, ["undefined", "undefined"]);
    assert.deepStrictEqual(calls, []);
  });

  test("await on the object gives the object itself, and calls nothing", async () => {
    const { r, calls } = await received("const f = await tools.far;\nreturn [f === tools.far, typeof f.count]");
    expectOk(r, [true, "function"]);
    assert.deepStrictEqual(calls, []);
  });

  test("a program whose value is the object ends with that object and calls nothing", async () => {
    const { r, calls } = await received("tools.far");
    expectOk(r, {});
    assert.deepStrictEqual(calls, []);
  });

  test("JSON.stringify of tools calls nothing", async () => {
    const { r, calls } = await received("return [JSON.stringify(tools), JSON.stringify(tools.far)]", undefined, {
      practice: ["rows"],
      far: true,
    });
    expectOk(r, ['{"practice":{},"far":{}}', "{}"]);
    assert.deepStrictEqual(calls, []);
  });

  test("a name that is a symbol gives undefined", async () => {
    const { r, calls } = await received(
      "return [typeof tools.far[Symbol('x')], typeof tools.far[Symbol.iterator], typeof tools.far[Symbol.for('y')], typeof tools.far[Symbol.toPrimitive]]",
    );
    expectOk(r, ["undefined", "undefined", "undefined", "undefined"]);
    assert.deepStrictEqual(calls, []);
  });

  test("a key whose value is a list is as before: a name that is not listed is undefined", async () => {
    const { r } = await received(
      "return [typeof tools.practice.rows, typeof tools.practice.nope, Object.keys(tools.practice), typeof tools.far.nope]",
      undefined,
      { practice: ["rows", "count"], far: true },
    );
    expectOk(r, ["function", "undefined", ["rows", "count"], "function"]);
  });

  test("calling an unlisted name of a list key is still the usual TypeError, and callTool is not called", async () => {
    const { r, calls } = await received("await tools.practice.nope({})", undefined, { practice: ["rows"], far: true });
    expectFail(r, "error", /^TypeError: .*is not a function$/);
    assert.deepStrictEqual(calls, []);
  });

  test("without the key, the server is undefined as before", async () => {
    const { r } = await received("return [typeof tools.other, typeof tools.far]", undefined, { practice: ["rows"], far: true });
    expectOk(r, ["undefined", "object"]);
  });
});

describe("a server given as true: a tool call", () => {
  test("callTool gets the server, the name and the arguments", async () => {
    const { r, calls } = await received('return await tools.far.count({ city: "Lyon" })', async () => ({ count: 625 }));
    expectOk(r, { count: 625 });
    assert.deepStrictEqual(calls, [["far", "count", { city: "Lyon" }]]);
  });

  test("a name with a dash, a space, an empty name and a number name", async () => {
    const { r, calls } = await received(
      "await tools.far['get-rows']({ a: 1 }); await tools.far['a b']({ b: 2 }); await tools.far['']({ c: 3 }); await tools.far['123']({ d: 4 }); 0",
    );
    expectOk(r, 0);
    assert.deepStrictEqual(calls, [
      ["far", "get-rows", { a: 1 }],
      ["far", "a b", { b: 2 }],
      ["far", "", { c: 3 }],
      ["far", "123", { d: 4 }],
    ]);
  });

  test("no argument, or undefined, reaches callTool as {}; more than one are dropped", async () => {
    const { r, calls } = await received("await tools.far.a(); await tools.far.b(undefined); await tools.far.c({ n: 1 }, { n: 2 }, 3); 0");
    expectOk(r, 0);
    assert.deepStrictEqual(calls, [
      ["far", "a", {}],
      ["far", "b", {}],
      ["far", "c", { n: 1 }],
    ]);
  });

  test("the arguments reach callTool after a JSON round trip", async () => {
    const { r, calls } = await received("await tools.far.t({ d: new Date(0), u: undefined, f() {}, list: [1, 'x'], n: NaN }); 0");
    expectOk(r, 0);
    assert.deepStrictEqual(calls, [["far", "t", { d: "1970-01-01T00:00:00.000Z", list: [1, "x"], n: null }]]);
  });

  test("arguments JSON cannot hold: the call throws in the program, and callTool is not called", async () => {
    const { r, calls } = await received(
      [
        "const c = {}; c.c = c;",
        "const out = [];",
        "for (const bad of [c, 1n, { n: 2n }]) {",
        "  try { await tools.far.t(bad); out.push('no throw') }",
        "  catch (e) { out.push([e instanceof Error, e.message]) }",
        "}",
        "return out",
      ].join("\n"),
    );
    const one = [true, "the arguments cannot be sent as JSON"];
    expectOk(r, [one, one, one]);
    assert.deepStrictEqual(calls, []);
  });

  test("what callTool resolves with comes back through JSON; undefined stays undefined", async () => {
    const { r } = await received(
      "const a = await tools.far.a(); const b = await tools.far.b(); return [a, typeof a, b]",
      async (server, tool) => (tool === "a" ? undefined : { d: new Date(0), u: undefined, list: [1, "x"], n: NaN }),
    );
    expectOk(r, [null, "undefined", { d: "1970-01-01T00:00:00.000Z", list: [1, "x"], n: null }]);
  });

  test("a rejection of callTool throws in the program an Error with its message, which the program can catch", async () => {
    const { r } = await received(
      "try { await tools.far.t({}) } catch (e) { return [e instanceof Error, e.message] }",
      async () => {
        throw new Error("no");
      },
    );
    expectOk(r, [true, "no"]);
  });

  test("a thrown value with no message is String(thrown); one with a message gives it", async () => {
    const thrown = [
      ["a string", "a string"],
      [42, "42"],
      [{ message: "typed" }, "typed"],
      [{ toString: () => "mine" }, "mine"],
    ];
    for (const [value, message] of thrown) {
      const { r } = await received("try { await tools.far.t({}) } catch (e) { return [e instanceof Error, e.message] }", async () => {
        throw value;
      });
      expectOk(r, [true, message]);
    }
  });

  test("an uncaught rejection ends the program as a program that threw", async () => {
    const { r } = await received("await tools.far.t({})", async () => {
      throw new Error("boom");
    });
    expectFail(r, "error", "Error: boom");
  });

  test("callTool that throws at once, not rejects, is the same", async () => {
    const callTool = (...args) => {
      throw new RangeError(`sync ${args[1]}`);
    };
    const r = await within(
      runProgram("try { await tools.far.t({}) } catch (e) { return e.message }", { tools: far, callTool, timeoutMs: 10000 }),
    );
    expectOk(r, "sync t");
  });

  test("calls at the same time each get their own answer, and none waits for another to end", async () => {
    const arrived = [];
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const giveUp = setTimeout(release, 10000);
    const callTool = recorder(async (server, tool, args) => {
      arrived.push(args.n);
      if (arrived.length === 3) release();
      await gate;
      return { n: args.n * 10, tool };
    });
    try {
      const r = await within(
        runProgram(
          "return await Promise.all([tools.far.a({ n: 1 }), tools.far.b({ n: 2 }), tools.far.c({ n: 3 })])",
          { tools: far, callTool, timeoutMs: 10000 },
        ),
      );
      expectOk(r, [
        { n: 10, tool: "a" },
        { n: 20, tool: "b" },
        { n: 30, tool: "c" },
      ]);
      assert.deepStrictEqual([...arrived].sort(), [1, 2, 3]);
    } finally {
      clearTimeout(giveUp);
      release();
    }
  });

  test("callTool is called once per call, in the order of the calls", async () => {
    const { calls } = await received("await tools.far.t({ n: 1 }); await tools.far.u({ n: 2 }); await tools.far.t({ n: 3 })");
    assert.deepStrictEqual(calls, [
      ["far", "t", { n: 1 }],
      ["far", "u", { n: 2 }],
      ["far", "t", { n: 3 }],
    ]);
  });

  test("two servers given as true each name their own", async () => {
    const { r, calls } = await received("await tools.one.x({}); await tools.two.x({}); return Object.keys(tools)", undefined, {
      one: true,
      two: true,
    });
    expectOk(r, ["one", "two"]);
    assert.deepStrictEqual(calls, [
      ["one", "x", {}],
      ["two", "x", {}],
    ]);
  });

  test("a list key and a key given as true side by side reach callTool by their own names", async () => {
    const { r, calls } = await received("await tools.practice.rows({ a: 1 }); await tools.far.rows({ b: 2 }); 0", undefined, {
      practice: ["rows"],
      far: true,
    });
    expectOk(r, 0);
    assert.deepStrictEqual(calls, [
      ["practice", "rows", { a: 1 }],
      ["far", "rows", { b: 2 }],
    ]);
  });
});

describe("a server given as true: the walls hold", () => {
  const PRELUDE = "const caught = async (p) => { try { await p; return 'no error' } catch (e) { return e } };\n";
  const answer = async () => ({ a: 1, list: [1] });
  const failing = async () => {
    throw new Error("refused");
  };
  const paths = [
    ["the object", `tools.far.constructor(${T})()`, answer],
    ["the constructor of the object's constructor", `tools.far.constructor.constructor(${T})()`, answer],
    ["the prototype of the object", `Object.getPrototypeOf(tools.far).constructor(${T})()`, answer],
    ["a function it gives", `tools.far.count.constructor(${T})()`, answer],
    ["the constructor of a function it gives", `tools.far.count.constructor.constructor(${T})()`, answer],
    ["the prototype of a function it gives", `Object.getPrototypeOf(tools.far.count).constructor(${T})()`, answer],
    ["call of a function it gives", `tools.far.count.call.constructor(${T})()`, answer],
    ["bind of a function it gives", `tools.far.count.bind().constructor(${T})()`, answer],
    ["the global object", `globalThis.tools.far.count.constructor.constructor(${T})()`, answer],
    ["tools itself", `tools.constructor.constructor(${T})()`, answer],
    ["the promise of a call", `tools.far.count({}).constructor.constructor(${T})()`, answer],
    ["a value a call returned", `(await tools.far.count({})).constructor.constructor(${T})()`, answer],
    ["a list a call returned", `(await tools.far.count({})).list.constructor.constructor(${T})()`, answer],
    ["an error a call threw", `(await caught(tools.far.count({}))).constructor.constructor(${T})()`, failing],
    ["the prototype of an error a call threw", `Object.getPrototypeOf(await caught(tools.far.count({}))).constructor.constructor(${T})()`, failing],
    ["an error a call cannot send", `(await caught(tools.far.count(1n))).constructor.constructor(${T})()`, answer],
  ];
  for (const [name, code, impl] of paths) {
    test(`${name}: undefined, or a throw`, async () => {
      const { r } = await received(`${PRELUDE}return ${code}`, impl);
      if (r.ok) expectOk(r, "undefined");
      else expectFail(r, "error");
    });
  }

  test("typeof process, require, fetch, module, Buffer and WebSocket are undefined, with such a server given", async () => {
    const { r } = await received(
      "return [typeof process, typeof require, typeof fetch, typeof module, typeof Buffer, typeof WebSocket]",
    );
    expectOk(r, ["undefined", "undefined", "undefined", "undefined", "undefined", "undefined"]);
  });

  test("import() still rejects", async () => {
    const { r } = await received('try { await import("node:fs"); return "imported" } catch (e) { return "rejected" }');
    expectOk(r, "rejected");
  });
});

describe("a server given as true: faults of the arguments", () => {
  const callTool = async () => null;
  const settle = async () =>
    assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process of an earlier call still runs");
  const bad = [
    ["a value false", () => runProgram("1", { tools: { far: false }, callTool })],
    ["a value null", () => runProgram("1", { tools: { far: null }, callTool })],
    ["a value undefined", () => runProgram("1", { tools: { far: undefined }, callTool })],
    ["a value that is a string", () => runProgram("1", { tools: { far: "true" }, callTool })],
    ["a value that is a number", () => runProgram("1", { tools: { far: 1 }, callTool })],
    ["a value that is an object", () => runProgram("1", { tools: { far: {} }, callTool })],
    ["a value that is an object with a key", () => runProgram("1", { tools: { far: { count: true } }, callTool })],
    ["a list that holds true", () => runProgram("1", { tools: { far: [true] }, callTool })],
    ["a list that holds a number", () => runProgram("1", { tools: { far: ["a", 1] }, callTool })],
    ["a good value among bad ones", () => runProgram("1", { tools: { good: true, ok: ["a"], far: false }, callTool })],
    ["a value true and one that is a string", () => runProgram("1", { tools: { good: true, far: "x" }, callTool })],
    ["tools is a list", () => runProgram("1", { tools: [true], callTool })],
    ["tools is true", () => runProgram("1", { tools: true, callTool })],
    ["a value true and callTool missing", () => runProgram("1", { tools: { far: true } })],
    ["a value true and callTool null", () => runProgram("1", { tools: { far: true }, callTool: null })],
    ["a value true and callTool a string", () => runProgram("1", { tools: { far: true }, callTool: "x" })],
    ["a value true next to an empty list and callTool missing", () => runProgram("1", { tools: { a: [], far: true } })],
  ];
  for (const [name, call] of bad) {
    test(`${name}: a TypeError, and no process`, async () => {
      await settle();
      await assert.rejects(call, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("the call is rejected, never thrown at once", async () => {
    let promise;
    assert.doesNotThrow(() => {
      promise = runProgram("1", { tools: { far: true } });
    });
    assert.ok(promise instanceof Promise);
    await assert.rejects(promise, TypeError);
  });

  test("a value true with a callTool that is a function is good", async () => {
    expectOk(await runProgram("1", { tools: far, callTool }), 1);
    expectOk(await runProgram("1", { tools: { a: ["b"], far: true }, callTool }), 1);
  });

  test("tools that name no tool and have no value true need no callTool", async () => {
    expectOk(await runProgram("1", { tools: { a: [] } }), 1);
    expectOk(await runProgram("1", { tools: {} }), 1);
  });

  test("a list that names a tool still needs callTool", async () => {
    await assert.rejects(runProgram("1", { tools: { a: ["b"] } }), TypeError);
  });
});

describe("a server given as true: independent of the other arguments", () => {
  test("shell, state, library, onProgress and tools given as true each do what their own section says", async () => {
    const lines = [];
    const callTool = recorder(async (server, tool, args) => {
      if (server === "shell") return { exitCode: 0, stdout: "out\n", stderr: "" };
      return { server, tool, args };
    });
    const code = [
      "state.n = (state.n ?? 0) + 1;",
      "progress('p', 1);",
      "const out = await $`ls`.text();",
      "const viaLib = await lib.viaFar({ x: 5 });",
      "const direct = await tools.far.t({ k: 1 });",
      "return [out, viaLib, direct, typeof tools.far.then]",
    ].join("\n");
    const r = await within(
      runProgram(code, {
        tools: far,
        callTool,
        shell: true,
        state: { n: 1 },
        onProgress: (line) => lines.push(line),
        library: [{ name: "viaFar", params: ["x"], code: "await tools.far.fromLib({ x })" }],
        timeoutMs: 10000,
      }),
    );
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.value, [
      "out\n",
      { server: "far", tool: "fromLib", args: { x: 5 } },
      { server: "far", tool: "t", args: { k: 1 } },
      "undefined",
    ]);
    assert.deepStrictEqual(r.state, { n: 2 });
    assert.deepStrictEqual(r.logs, []);
    assert.deepStrictEqual(lines, ["p 1"]);
    assert.deepStrictEqual(callTool.calls, [
      ["shell", "run", { command: "ls" }],
      ["far", "fromLib", { x: 5 }],
      ["far", "t", { k: 1 }],
    ]);
  });

  test("console.log lines of a program that calls such a tool are in logs as before", async () => {
    const { r } = await received("console.log('a', 1); await tools.far.t({}); console.log('b'); 7");
    expectOk(r, 7, ["a 1", "b"]);
  });

  test("a key named shell given as true reaches callTool with the same three arguments as shell does", async () => {
    const { r, calls } = await received("await tools.shell.run({ command: 'ls' }); await $`ls`", async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }), { shell: true }, { shell: true });
    expectOk(r, { exitCode: 0, stdout: "", stderr: "" });
    assert.deepStrictEqual(calls, [
      ["shell", "run", { command: "ls" }],
      ["shell", "run", { command: "ls" }],
    ]);
  });
});

describe("a server given as true: processes, signals, time limits", () => {
  test("the time limit stops a program that calls such a tool for ever, and callTool is not called after the result", async () => {
    let resolved = false;
    let late = 0;
    const callTool = recorder(async () => {
      if (resolved) late++;
      return 1;
    });
    const r = await within(runProgram("while (true) { await tools.far.t({}) }", { tools: far, callTool, timeoutMs: 400 }));
    resolved = true;
    expectFail(r, "timeout", "stopped after 400 ms");
    assert.ok(callTool.calls.length > 0);
    await sleep(300);
    assert.strictEqual(late, 0);
  });

  test("a call still waiting when the program returns: its answer is dropped, and callTool is not called after", async () => {
    let resolved = false;
    let late = 0;
    let finish;
    const callTool = recorder(async () => {
      if (resolved) late++;
      await new Promise((resolve) => (finish = resolve));
      return "late answer";
    });
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const r = await within(
        runProgram("tools.far.t({});\nawait new Promise((r) => setTimeout(r, 250));\nreturn 'ended'", {
          tools: far,
          callTool,
          timeoutMs: 10000,
        }),
      );
      resolved = true;
      expectOk(r, "ended");
      assert.strictEqual(callTool.calls.length, 1);
      finish();
      await sleep(200);
      assert.strictEqual(late, 0);
      assert.deepStrictEqual(failures, []);
    } finally {
      finish?.();
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });

  test("a signal that aborts while such a call waits stops the program", async () => {
    const controller = new AbortController();
    let arrived;
    const seen = new Promise((resolve) => (arrived = resolve));
    const callTool = recorder(async () => {
      arrived();
      return new Promise(() => {});
    });
    const running = runProgram("await tools.far.t({}); 1", { tools: far, callTool, timeoutMs: 10000, signal: controller.signal });
    try {
      await within(seen);
    } finally {
      controller.abort();
    }
    const r = await within(running);
    expectFail(r, "stopped", "stopped by the caller");
    assert.deepStrictEqual(callTool.calls, [["far", "t", {}]]);
    assert.ok(await waitFor(() => childRows().length === 0, 3000), "the process of the program still runs");
  });

  test("one process per call, and it has ended when the promise resolves", async () => {
    assert.ok(await waitFor(() => childRows().length === 0, 3000));
    const r = await within(runProgram("await tools.far.t({}); 1", { tools: far, callTool: async () => 1, timeoutMs: 10000 }));
    expectOk(r, 1);
    assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs after the result");
  });
});
