import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, waitFor, sleep } from "./helpers.js";

// Same as expectOk / expectFail, with the key `state` besides, which is read as `state`.
function okWith(result, value, state, logs = []) {
  assert.deepStrictEqual(Object.keys(result).sort(), ["logs", "ok", "state", "value"]);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value, value);
  assert.deepStrictEqual(result.logs, logs);
  assertPlain(result.state);
  assert.deepStrictEqual(result.state, state);
}

function failWith(result, kind, message, state, logs) {
  assert.deepStrictEqual(Object.keys(result).sort(), ["error", "logs", "ok", "state"]);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(Object.keys(result.error).sort(), ["kind", "message"]);
  assert.strictEqual(result.error.kind, kind);
  if (message instanceof RegExp) assert.match(result.error.message, message);
  else assert.strictEqual(result.error.message, message);
  if (logs !== undefined) assert.deepStrictEqual(result.logs, logs);
  assertPlain(result.state);
  assert.deepStrictEqual(result.state, state);
}

function assertPlain(state) {
  assert.ok(typeof state === "object" && state !== null && !Array.isArray(state), "state is not a plain object");
  assert.strictEqual(Object.getPrototypeOf(state), Object.prototype);
}

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs");

describe("without the argument state, step 1 holds as it is", () => {
  test("typeof state is undefined and the result has no key state", async () => {
    expectOk(await runProgram("typeof state"), "undefined");
    expectOk(await runProgram("typeof state", { state: undefined }), "undefined");
  });

  test("a failure has no key state either", async () => {
    expectFail(await runProgram("throw new Error('x')", { state: undefined }), "error", "Error: x", []);
    expectFail(await runProgram("let = =", { state: undefined }), "error", /^SyntaxError: /);
    expectFail(await runProgram("while (true) {}", { timeoutMs: 300, state: undefined }), "timeout", "stopped after 300 ms");
  });
});

describe("what the program finds under state", () => {
  test("an object equal to the JSON round trip of the argument", async () => {
    const argument = { a: 1, b: [1, "two", { c: null }], s: "text", nested: { deep: { er: true } } };
    okWith(await runProgram("state", { state: argument }), argument, argument);
  });

  test("the round trip drops what JSON drops and turns a Date to its text", async () => {
    const argument = { keep: 1, gone: undefined, fn: () => 1, when: new Date(0), list: [undefined, 2] };
    const expected = JSON.parse(JSON.stringify(argument));
    assert.deepStrictEqual(expected, { keep: 1, when: "1970-01-01T00:00:00.000Z", list: [null, 2] });
    okWith(await runProgram("state", { state: argument }), expected, expected);
  });

  test("an empty object is an empty object", async () => {
    okWith(await runProgram("Object.keys(state).length", { state: {} }), 0, {});
    okWith(await runProgram("JSON.stringify(state)", { state: {} }), "{}", {});
  });

  test("the keys come in the order of the argument", async () => {
    okWith(await runProgram("JSON.stringify(state)", { state: { z: 1, a: 2, m: 3 } }), '{"z":1,"a":2,"m":3}', {
      z: 1,
      a: 2,
      m: 3,
    });
  });

  test("it can be read with tools and logs in the same program", async () => {
    const callTool = recorder(async (server, tool, args) => ({ got: args.n + 1 }));
    const r = await runProgram("console.log(state.n); const r = await tools.s.t({ n: state.n }); state.r = r; r.got", {
      state: { n: 4 },
      tools: { s: ["t"] },
      callTool,
    });
    okWith(r, 5, { n: 4, r: { got: 5 } }, ["4"]);
    assert.deepStrictEqual(callTool.calls, [["s", "t", { n: 4 }]]);
  });

  test("two programs at once have each their own state", async () => {
    const [a, b] = await Promise.all([
      runProgram("await new Promise((r) => setTimeout(r, 50)); state.who = state.who + '!'; state.who", { state: { who: "a" } }),
      runProgram("state.who = state.who + '?'; state.who", { state: { who: "b" } }),
    ]);
    okWith(a, "a!", { who: "a!" });
    okWith(b, "b?", { who: "b?" });
  });

  test("a large state has no limit of the sandbox", async () => {
    const rows = Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `row ${i}`, tags: ["a", "b"] }));
    const r = await runProgram("state.rows.length", { state: { rows }, timeoutMs: 30000 });
    okWith(r, 20000, { rows });
  });
});

describe("the program changes state by its keys", () => {
  test("a key is added, changed and deleted", async () => {
    const r = await runProgram("state.rows = [1, 2]; state.a = state.a + 1; delete state.gone; state.nested.x = 'y'; 0", {
      state: { a: 1, gone: true, nested: { k: 1 } },
    });
    okWith(r, 0, { a: 2, rows: [1, 2], nested: { k: 1, x: "y" } });
  });

  test("the value and the state are sent apart: an object reached from both comes back twice", async () => {
    const r = await runProgram("const o = { n: 1 }; state.o = o; return o", { state: {} });
    okWith(r, { n: 1 }, { o: { n: 1 } });
    assert.notStrictEqual(r.value, r.state.o);
  });

  test("a key holding undefined or a function is dropped, a Date becomes its text", async () => {
    const r = await runProgram("state.u = undefined; state.f = () => 1; state.d = new Date(0); state.k = 1; 2", { state: {} });
    okWith(r, 2, { d: "1970-01-01T00:00:00.000Z", k: 1 });
  });

  test("the name state cannot be given another value: the object stays the one the result is read from", async () => {
    const caught = await runProgram("state.a = 1; try { state = { b: 2 } } catch (e) {} state.c = 3; 0", { state: {} });
    okWith(caught, 0, { a: 1, c: 3 });
    // `state = {}` either throws a TypeError, or does nothing
    const bare = await runProgram("state.a = 1; state = { b: 2 }", { state: {} });
    if (bare.ok) assert.deepStrictEqual(bare.state, { a: 1 });
    else failWith(bare, "error", /^TypeError: /, { a: 1 });
  });

  test("a program that declares its own const or let state hides the global one, which stays as it was", async () => {
    okWith(await runProgram("const state = { a: 2 }; state.a = 5; state.a", { state: { a: 1 } }), 5, { a: 1 });
    okWith(await runProgram("let state = 3; state = 4; state", { state: { a: 1 } }), 4, { a: 1 });
  });

  test("the argument object is never changed", async () => {
    const argument = { a: 1, list: [1, 2], nested: { k: "v" } };
    const copy = structuredClone(argument);
    const first = await runProgram("state.a = 2; state.list.push(3); state.nested.k = 'w'; delete state.list; state.z = 1", {
      state: argument,
    });
    assert.deepStrictEqual(first.state, { a: 2, nested: { k: "w" }, z: 1 });
    assert.deepStrictEqual(argument, copy);
    await runProgram("state.a = 2; throw new Error('x')", { state: argument });
    assert.deepStrictEqual(argument, copy);
    await runProgram("state.a = 2; while (true) {}", { state: argument, timeoutMs: 300 });
    assert.deepStrictEqual(argument, copy);
    assert.deepStrictEqual(Object.keys(argument), Object.keys(copy));
  });
});

describe("the state of each result", () => {
  test("ok: the object as it is when the value is known, after a promise value is awaited", async () => {
    const code = [
      "state.a = 1;",
      "const p = (async () => { await new Promise((r) => setTimeout(r, 20)); state.b = 2; return 5 })();",
      "p",
    ].join("\n");
    okWith(await runProgram(code, { state: {} }), 5, { a: 1, b: 2 });
  });

  test("ok: a program with no value, and one that returns early", async () => {
    okWith(await runProgram("state.a = 1", { state: {} }), 1, { a: 1 });
    okWith(await runProgram("state.a = 1; return; state.b = 2", { state: {} }), undefined, { a: 1 });
    okWith(await runProgram("const x = 1", { state: { k: 1 } }), undefined, { k: 1 });
    okWith(await runProgram("", { state: { k: 1 } }), undefined, { k: 1 });
  });

  test("error, the program threw: what it put in state before it failed is there", async () => {
    failWith(await runProgram("state.x = 1; console.log('before'); throw new Error('boom')", { state: { k: 1 } }), "error", "Error: boom", { k: 1, x: 1 }, ["before"]);
    failWith(await runProgram("state.x = 1; await Promise.reject(new RangeError('r'))", { state: {} }), "error", "RangeError: r", { x: 1 });
    failWith(await runProgram("state.x = 1; throw 'text'", { state: {} }), "error", "text", { x: 1 });
  });

  test("error, a promise value rejects later: the state is as it is then", async () => {
    const code = "state.a = 1; await new Promise((r) => setTimeout(r, 20)); state.b = 2; throw new Error('late')";
    failWith(await runProgram(code, { state: {} }), "error", "Error: late", { a: 1, b: 2 });
  });

  test("error, the value cannot be sent as JSON: what the program put in state is there", async () => {
    failWith(await runProgram("state.x = 1; return 1n", { state: {} }), "error", "the value cannot be sent as JSON", { x: 1 });
    failWith(await runProgram("state.x = 1; const c = {}; c.c = c; return c", { state: { k: 1 } }), "error", "the value cannot be sent as JSON", { k: 1, x: 1 });
  });

  test("error, the text is not valid JavaScript: equal to the argument", async () => {
    const argument = { a: 1, list: [1, { b: 2 }] };
    failWith(await runProgram("let = = 1", { state: argument }), "error", /^SyntaxError: /, argument);
    failWith(await runProgram("state.a = 2; 1 +", { state: argument }), "error", /^SyntaxError: /, argument);
  });

  test("timeout: equal to the argument", async () => {
    const argument = { a: 1, list: [1, 2] };
    failWith(await runProgram("state.a = 99; while (true) {}", { state: argument, timeoutMs: 400 }), "timeout", "stopped after 400 ms", argument);
    failWith(await runProgram("state.a = 99; console.log('x'); await new Promise(() => {})", { state: argument, timeoutMs: 500 }), "timeout", "stopped after 500 ms", argument);
  });

  test("crash: equal to the argument", async () => {
    const argument = { a: 1 };
    const r = await runProgram("state.a = 99; const a = []; while (true) a.push(new Array(100000).fill(1))", {
      state: argument,
      memoryMb: 16,
      timeoutMs: 30000,
    });
    failWith(r, "crash", /^code (\d+|null), signal ([A-Z0-9]+|null)$/, argument);
  });

  test("a crash from outside is equal to the argument", async () => {
    await settle();
    const running = runProgram("state.a = 99; while (true) {}", { state: { a: 1 }, timeoutMs: 30000 });
    const victim = await waitFor(() => childRows()[0]?.pid, 5000);
    assert.ok(victim, "no process of the program was seen");
    process.kill(victim, "SIGKILL");
    failWith(await running, "crash", "code null, signal SIGKILL", { a: 1 });
  });

  test("what a timer does to state after the result is known is not seen", async () => {
    okWith(await runProgram("setTimeout(() => { state.late = 1 }, 30); 1", { state: {} }), 1, {});
    await sleep(100);
  });
});

describe("a state JSON cannot hold", () => {
  const message = "state was not kept: it cannot be sent as JSON";

  test("the program had a value: error, with state equal to the argument", async () => {
    const argument = { a: 1, nested: { b: [2] } };
    failWith(await runProgram("state.self = state; 5", { state: argument }), "error", message, argument);
    failWith(await runProgram("state.big = 1n; state.a = 2; 5", { state: argument }), "error", message, argument);
    failWith(await runProgram("state.toJSON = () => [1, 2]; 5", { state: argument }), "error", message, argument);
    failWith(await runProgram("state.toJSON = () => 7; return 'v'", { state: argument }), "error", message, argument);
    failWith(await runProgram("state.nested.loop = state.nested; 5", { state: argument }), "error", message, argument);
  });

  test("the program had failed: its own error stays, with state equal to the argument", async () => {
    const argument = { a: 1 };
    failWith(await runProgram("state.self = state; throw new Error('boom')", { state: argument }), "error", "Error: boom", argument);
    failWith(await runProgram("state.big = 1n; await Promise.reject(new TypeError('t'))", { state: argument }), "error", "TypeError: t", argument);
  });

  test("a state that cannot be held when the program was stopped is still the argument", async () => {
    const argument = { a: 1 };
    failWith(await runProgram("state.self = state; while (true) {}", { state: argument, timeoutMs: 300 }), "timeout", "stopped after 300 ms", argument);
  });
});

describe("state and the walls of the program", () => {
  const climb = (expression) => `${expression}.constructor.constructor("return typeof process")()`;

  test("the function constructor through state and through a value in it reaches no process", async () => {
    const argument = { o: { k: 1 }, list: [1, 2], s: "text", n: 5, fn: null };
    const r = await runProgram(
      [
        `const found = [${climb("state")}, ${climb("state.o")}, ${climb("state.list")}, ${climb("state.s")}, ${climb("state.n")}];`,
        "state.added = {}; found.push(" + climb("state.added") + ");",
        "found",
      ].join("\n"),
      { state: argument },
    );
    okWith(r, ["undefined", "undefined", "undefined", "undefined", "undefined", "undefined"], { ...argument, added: {} });
  });

  test("require, process, fetch and import are not found with a state either", async () => {
    const r = await runProgram(
      "[typeof process, typeof require, typeof fetch, typeof module, typeof Buffer, typeof WebSocket]",
      { state: { a: 1 } },
    );
    okWith(r, Array(6).fill("undefined"), { a: 1 });
    const imp = await runProgram('await import("node:fs")', { state: { a: 1 } });
    failWith(imp, "error", /./, { a: 1 });
  });
});

describe("bad state rejects with a TypeError and starts no process", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const bad = [
    ["null", null],
    ["a list", [1, 2]],
    ["an empty list", []],
    ["a string", "text"],
    ["a number", 5],
    ["an object with a cycle", cyclic],
    ["an object with a BigInt", { n: 1n }],
    [
      "an object whose key throws on JSON.stringify",
      {
        get boom() {
          throw new Error("no");
        },
      },
    ],
  ];
  for (const [name, state] of bad) {
    test(name, async () => {
      await settle();
      await assert.rejects(() => runProgram("1", { state }), TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("the call is rejected, never thrown at once", async () => {
    let promise;
    assert.doesNotThrow(() => {
      promise = runProgram("1", { state: null });
    });
    assert.ok(promise instanceof Promise);
    await assert.rejects(promise, TypeError);
  });
});

describe("state changes nothing in the time limit of a program", () => {
  test("an endless loop with state is stopped at the limit", async () => {
    const t0 = Date.now();
    const r = await runProgram("while (true) {}", { state: { a: 1 }, timeoutMs: 300 });
    failWith(r, "timeout", "stopped after 300 ms", { a: 1 });
    assert.ok(Date.now() - t0 >= 250, "stopped early");
  });

  test("a short program with state ends well inside the limit", async () => {
    okWith(await runProgram("state.a", { state: { a: 1 }, timeoutMs: 20000 }), 1, { a: 1 });
  });
});
