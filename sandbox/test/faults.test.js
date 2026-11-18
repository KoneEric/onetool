import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, childRows, waitFor, sleep } from "./helpers.js";

describe("faults of the program", () => {
  const thrown = [
    ['throw new TypeError("x")', "TypeError: x"],
    ['throw new RangeError("r")', "RangeError: r"],
    ['throw new Error("plain")', "Error: plain"],
    ['const e = new Error("m"); e.name = "Custom"; throw e', "Custom: m"],
    ['throw "a string"', "a string"],
    ["throw 42", "42"],
    ["throw { a: 1 }", "[object Object]"],
    ["throw null", "null"],
    ["throw undefined", "undefined"],
    ["const x = 1; x()", "TypeError: x is not a function"],
    ['await Promise.reject(new RangeError("r"))', "RangeError: r"],
    ["await Promise.reject('no error')", "no error"],
    ['await (async () => { throw new Error("deep") })()', "Error: deep"],
    ['await new Promise((_, reject) => setTimeout(() => reject(new Error("later")), 10))', "Error: later"],
    ["missing.name", "ReferenceError: missing is not defined"],
  ];
  for (const [code, message] of thrown) {
    test(code, async () => {
      expectFail(await runProgram(code), "error", message, []);
    });
  }

  test("a value that is thrown and not an Error, with String(value) of its own", async () => {
    expectFail(await runProgram('throw { toString() { return "mine" } }'), "error", "mine");
  });

  test("the text is not valid JavaScript", async () => {
    for (const code of ["let = = 1", "const x = ;", "1 +", "return 1 +", "function (", "{{{", "var 1a = 2"]) {
      expectFail(await runProgram(code), "error", /^SyntaxError: /);
    }
  });

  test("a syntax error is a result, not a rejection, and starts no endless wait", async () => {
    const r = await runProgram("while (true) {", { timeoutMs: 30000 });
    expectFail(r, "error", /^SyntaxError: /);
  });
});

describe("the time limit", () => {
  test("an endless loop that never awaits is stopped at the limit", async () => {
    const t0 = Date.now();
    const r = await runProgram("while (true) {}", { timeoutMs: 300 });
    const took = Date.now() - t0;
    expectFail(r, "timeout", "stopped after 300 ms");
    assert.ok(took >= 250, `stopped early: ${took} ms`);
    assert.ok(took < 5000, `stopped late: ${took} ms`);
  });

  test("a program that waits for ever is stopped at the limit", async () => {
    const t0 = Date.now();
    const r = await runProgram("await new Promise(() => {})", { timeoutMs: 400 });
    const took = Date.now() - t0;
    expectFail(r, "timeout", "stopped after 400 ms");
    assert.ok(took >= 350, `stopped early: ${took} ms`);
    assert.ok(took < 5000, `stopped late: ${took} ms`);
  });

  test("a long timer is stopped at the limit", async () => {
    const t0 = Date.now();
    const r = await runProgram("await new Promise((r) => setTimeout(r, 30000))", { timeoutMs: 250 });
    expectFail(r, "timeout", "stopped after 250 ms");
    assert.ok(Date.now() - t0 < 5000);
  });

  test("the start of the process counts in the limit", async () => {
    const r = await runProgram("1", { timeoutMs: 1 });
    expectFail(r, "timeout", "stopped after 1 ms");
  });

  test("the lines of a stopped program are an array of strings, maybe fewer than it printed", async () => {
    const r = await runProgram('console.log("before"); while (true) {}', { timeoutMs: 300 });
    expectFail(r, "timeout", "stopped after 300 ms");
    assert.ok(r.logs.length <= 1);
  });

  test("the caller's process stays free while the program loops", async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    let quick;
    try {
      const looping = runProgram("while (true) {}", { timeoutMs: 700 });
      quick = await runProgram("6 * 7");
      const r = await looping;
      expectFail(r, "timeout", "stopped after 700 ms");
    } finally {
      clearInterval(timer);
    }
    expectOk(quick, 42);
    assert.ok(ticks >= 5, `the caller's timers ran only ${ticks} times`);
  });

  test("the default limit lets a short program end", async () => {
    expectOk(await runProgram("await new Promise((r) => setTimeout(r, 50)); 1"), 1);
  });
});

describe("the program's process ends", () => {
  test("out of memory is a crash", async () => {
    const r = await runProgram("const a = []; while (true) a.push(new Array(100000).fill(1))", {
      memoryMb: 16,
      timeoutMs: 30000,
    });
    expectFail(r, "crash", /^code (\d+|null), signal ([A-Z0-9]+|null)$/);
  });

  test("a program well inside the default memory ends well", async () => {
    expectOk(await runProgram("const a = new Array(2000000).fill(1); a.length"), 2000000);
  });

  async function killedFromOutside(signal) {
    const running = runProgram("while (true) {}", { timeoutMs: 30000 });
    const victim = await waitFor(() => childRows()[0]?.pid, 5000);
    if (!victim) {
      for (const row of childRows()) process.kill(row.pid, "SIGKILL");
      await running;
      assert.fail("no process of the program was seen");
    }
    process.kill(victim, signal);
    return running;
  }

  test("a process killed from outside is a crash with its signal", async () => {
    await settle();
    expectFail(await killedFromOutside("SIGKILL"), "crash", "code null, signal SIGKILL");
    await settle();
    expectFail(await killedFromOutside("SIGTERM"), "crash", "code null, signal SIGTERM");
  });
});

async function settle() {
  assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process of an earlier call still runs");
}

describe("bad arguments reject with a TypeError and start no process", () => {
  const callTool = async () => null;
  const bad = [
    ["code is no string: nothing", () => runProgram()],
    ["code is no string: a number", () => runProgram(123)],
    ["code is no string: null", () => runProgram(null)],
    ["code is no string: an object", () => runProgram({})],
    ["code is no string: a String object", () => runProgram(new String("1"))],
    ["tools is null", () => runProgram("1", { tools: null })],
    ["tools is a string", () => runProgram("1", { tools: "x" })],
    ["tools is a number", () => runProgram("1", { tools: 5 })],
    ["a server's tools is a string", () => runProgram("1", { tools: { a: "b" }, callTool })],
    ["a server's tools is an object", () => runProgram("1", { tools: { a: {} }, callTool })],
    ["a tool name is a number", () => runProgram("1", { tools: { a: [1] }, callTool })],
    ["a tool name is null", () => runProgram("1", { tools: { a: [null] }, callTool })],
    ["a tool name among good ones is no string", () => runProgram("1", { tools: { a: ["b"], c: ["d", 7] }, callTool })],
    ["timeoutMs is 0", () => runProgram("1", { timeoutMs: 0 })],
    ["timeoutMs is negative", () => runProgram("1", { timeoutMs: -5 })],
    ["timeoutMs is NaN", () => runProgram("1", { timeoutMs: NaN })],
    ["timeoutMs is Infinity", () => runProgram("1", { timeoutMs: Infinity })],
    ["timeoutMs is a string", () => runProgram("1", { timeoutMs: "100" })],
    ["timeoutMs is null", () => runProgram("1", { timeoutMs: null })],
    ["memoryMb is 15", () => runProgram("1", { memoryMb: 15 })],
    ["memoryMb is 0", () => runProgram("1", { memoryMb: 0 })],
    ["memoryMb is negative", () => runProgram("1", { memoryMb: -16 })],
    ["memoryMb is not whole", () => runProgram("1", { memoryMb: 16.5 })],
    ["memoryMb is NaN", () => runProgram("1", { memoryMb: NaN })],
    ["memoryMb is Infinity", () => runProgram("1", { memoryMb: Infinity })],
    ["memoryMb is a string", () => runProgram("1", { memoryMb: "64" })],
    ["memoryMb is null", () => runProgram("1", { memoryMb: null })],
    ["tools names a tool and callTool is missing", () => runProgram("1", { tools: { a: ["b"] } })],
    ["tools names a tool and callTool is no function", () => runProgram("1", { tools: { a: ["b"] }, callTool: "x" })],
    ["tools names a tool and callTool is null", () => runProgram("1", { tools: { a: ["b"] }, callTool: null })],
  ];
  for (const [name, call] of bad) {
    test(name, async () => {
      await settle();
      await assert.rejects(call, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("tools that name no tool need no callTool", async () => {
    expectOk(await runProgram("1", { tools: { a: [] } }), 1);
    expectOk(await runProgram("1", { tools: {} }), 1);
  });

  test("the call is rejected, never thrown at once", async () => {
    let promise;
    assert.doesNotThrow(() => {
      promise = runProgram(123);
    });
    assert.ok(promise instanceof Promise);
    await assert.rejects(promise, TypeError);
  });

  test("good limits are accepted", async () => {
    expectOk(await runProgram("1", { timeoutMs: 20000, memoryMb: 128 }), 1);
    expectOk(await runProgram("1", { timeoutMs: 20000.5, memoryMb: 512 }), 1);
  });
});
