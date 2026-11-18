import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { getEventListeners } from "node:events";
import { fileURLToPath } from "node:url";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, alive, waitFor, sleep } from "./helpers.js";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const isKill = (signal) => signal === "SIGKILL" || signal === 9;
const LOOP = "while (true) {}";
const STOPPED = "stopped by the caller";

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs");

function fixtureJson(scenario) {
  const r = spawnSync(process.execPath, [fixture("stop.mjs"), scenario], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.error, undefined, String(r.error));
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// Starts `code` with a controller's signal, waits for its process, aborts, gives the result and the pid.
async function abortedWhileRunning(code = LOOP, options = {}, reason) {
  await settle();
  const controller = new AbortController();
  const running = runProgram(code, { timeoutMs: 3000, ...options, signal: controller.signal });
  const row = await waitFor(() => childRows()[0], 3000);
  assert.ok(row, "no process of the program was seen");
  if (reason === undefined) controller.abort();
  else controller.abort(reason);
  return { result: await running, pid: row.pid, controller };
}

function expectStopped(result, logs) {
  assert.deepStrictEqual(Object.keys(result).sort(), ["error", "logs", "ok"]);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.error, { kind: "stopped", message: STOPPED });
  assert.ok(Array.isArray(result.logs) && result.logs.every((l) => typeof l === "string"));
  if (logs !== undefined) assert.deepStrictEqual(result.logs, logs);
}

describe("without the argument signal, the sections above hold", () => {
  test("signal absent or undefined: a program ends as before, and a failure is never stopped", async () => {
    expectOk(await runProgram("1 + 1", { signal: undefined }), 2);
    expectOk(await runProgram("1 + 1"), 2);
    expectFail(await runProgram("throw new Error('x')", { signal: undefined }), "error", "Error: x", []);
    expectFail(await runProgram(LOOP, { signal: undefined, timeoutMs: 300 }), "timeout", "stopped after 300 ms");
    expectFail(await runProgram(LOOP, { timeoutMs: 300 }), "timeout", "stopped after 300 ms");
  });

  test("a signal that never aborts changes nothing: the value, the logs, the state", async () => {
    const { signal } = new AbortController();
    expectOk(await runProgram("console.log('a'); return [1, 2]", { signal }), [1, 2], ["a"]);
    const r = await runProgram("state.n = 1; return 3", { signal, state: { n: 0 } });
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.deepStrictEqual(r.state, { n: 1 });
    expectFail(await runProgram("throw new Error('x')", { signal }), "error", "Error: x", []);
    expectFail(await runProgram(LOOP, { signal, timeoutMs: 300 }), "timeout", "stopped after 300 ms");
  });
});

describe("the caller aborts while the program runs", () => {
  test("the result is kind stopped, with the message stopped by the caller, and logs a list of strings", async () => {
    const { result } = await abortedWhileRunning();
    expectStopped(result);
  });

  test("it is not a timeout: the limit was far away", async () => {
    await settle();
    const controller = new AbortController();
    const started = Date.now();
    const running = runProgram(LOOP, { timeoutMs: 20000, signal: controller.signal });
    assert.ok(await waitFor(() => childRows()[0], 3000));
    controller.abort();
    expectStopped(await running);
    assert.ok(Date.now() - started < 10000, "the program was stopped by the limit, not by the abort");
  });

  test("the process has ended or was sent SIGKILL when the promise resolves", async () => {
    const { result, pid } = await abortedWhileRunning();
    expectStopped(result);
    assert.ok(await waitFor(() => !alive(pid), 2000), "the process of the program still runs");
  });

  test("a program that never awaits, one that waits for ever and one that waits on a timer are all stopped", async () => {
    for (const code of [LOOP, "await new Promise(() => {})", "await new Promise((r) => setTimeout(r, 30000))"]) {
      const { result, pid } = await abortedWhileRunning(code);
      expectStopped(result);
      assert.ok(await waitFor(() => !alive(pid), 2000));
    }
  });

  test("the reason of the abort is not read: the message is always the same", async () => {
    const reasons = [
      undefined,
      "because",
      new Error("the reason"),
      { message: "an object", toString() { throw new Error("no"); } },
      null,
      42,
    ];
    for (const reason of reasons) {
      const { result } = await abortedWhileRunning(LOOP, {}, reason === undefined ? undefined : reason);
      expectStopped(result);
      assert.strictEqual(result.error.message, STOPPED);
    }
  });

  test("abort straight after the call, before any process could have answered", async () => {
    await settle();
    const controller = new AbortController();
    const running = runProgram(LOOP, { timeoutMs: 3000, signal: controller.signal });
    controller.abort();
    expectStopped(await running);
    assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process of the program still runs");
  });

  test("a second abort of the same controller does nothing", async () => {
    const { result, controller } = await abortedWhileRunning();
    expectStopped(result);
    assert.doesNotThrow(() => controller.abort());
    assert.doesNotThrow(() => controller.abort(new Error("again")));
    await sleep(50);
  });

  test("logs holds lines that reached the caller before the stop: fewer than the program printed is accepted", async () => {
    const { result } = await abortedWhileRunning("console.log('one'); " + LOOP);
    expectStopped(result);
    assert.ok(result.logs.every((l) => l === "one"), JSON.stringify(result.logs));
    assert.ok(result.logs.length <= 1);
  });

  test("with the argument state, the state of the result is equal to the argument", async () => {
    const argument = { a: 1, list: [1, "two"], nested: { deep: true } };
    const { result } = await abortedWhileRunning("state.a = 99; state.extra = 1; " + LOOP, { state: argument });
    assert.deepStrictEqual(Object.keys(result).sort(), ["error", "logs", "ok", "state"]);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.error, { kind: "stopped", message: STOPPED });
    assert.deepStrictEqual(result.state, { a: 1, list: [1, "two"], nested: { deep: true } });
    assert.deepStrictEqual(argument, { a: 1, list: [1, "two"], nested: { deep: true } }, "the argument was changed");
    assert.strictEqual(Object.getPrototypeOf(result.state), Object.prototype);
  });

  test("the abort of a program that is waiting for a tool call", async () => {
    await settle();
    let release;
    const callTool = recorder(() => new Promise((resolve) => (release = resolve)));
    const controller = new AbortController();
    const running = runProgram("await tools.s.t({ x: 1 })", { tools: { s: ["t"] }, callTool, timeoutMs: 3000, signal: controller.signal });
    assert.ok(await waitFor(() => callTool.calls.length === 1, 3000), "the call was not made");
    controller.abort();
    expectStopped(await running);
    assert.deepStrictEqual(callTool.calls, [["s", "t", { x: 1 }]]);
    release("too late");
    await sleep(100);
    assert.strictEqual(callTool.calls.length, 1);
  });
});

describe("tool calls and the abort", () => {
  const tools = { s: ["t"] };

  test("callTool is never called after the promise has resolved, after an abort", async () => {
    let resolved = false;
    let late = 0;
    const controller = new AbortController();
    const callTool = recorder(async () => {
      if (resolved) late++;
      if (callTool.calls.length === 3) controller.abort();
      return 1;
    });
    const r = await runProgram("while (true) { await tools.s.t({}) }", { tools, callTool, timeoutMs: 3000, signal: controller.signal });
    resolved = true;
    expectStopped(r);
    assert.ok(callTool.calls.length >= 3);
    const atResolve = callTool.calls.length;
    await sleep(300);
    assert.strictEqual(late, 0, "callTool was called after the promise resolved");
    assert.strictEqual(callTool.calls.length, atResolve);
  });

  test("a call still waiting when the program is stopped: its answer or its error is dropped", async () => {
    let rejectCall;
    const controller = new AbortController();
    const callTool = recorder(() => {
      setTimeout(() => controller.abort(), 20);
      return new Promise((_, reject) => (rejectCall = reject));
    });
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const r = await runProgram("await tools.s.t({})", { tools, callTool, timeoutMs: 3000, signal: controller.signal });
      expectStopped(r);
      rejectCall(new Error("too late"));
      await sleep(150);
      assert.strictEqual(callTool.calls.length, 1);
      assert.deepStrictEqual(failures, []);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });

  test("with shell: a command still waiting is dropped, and nothing more is asked", async () => {
    const controller = new AbortController();
    let release;
    const callTool = recorder(() => {
      setTimeout(() => controller.abort(), 20);
      return new Promise((resolve) => (release = resolve));
    });
    const r = await runProgram("await $`sleep 100`; await read('p')", { shell: true, callTool, timeoutMs: 3000, signal: controller.signal });
    expectStopped(r);
    release({ exitCode: 0, stdout: "", stderr: "" });
    await sleep(150);
    assert.deepStrictEqual(callTool.calls, [["shell", "run", { command: "sleep 100" }]]);
  });
});

describe("a signal already aborted when runProgram is called", () => {
  test("no process is started, and the result is stopped, with logs []", async () => {
    await settle();
    const running = runProgram("console.log('x'); 1 + 1", { signal: AbortSignal.abort() });
    assert.ok(running instanceof Promise);
    assert.deepStrictEqual(childRows(), [], "a process was started");
    const r = await running;
    expectStopped(r, []);
    await sleep(50);
    assert.deepStrictEqual(childRows(), []);
  });

  test("callTool and onProgress are never called", async () => {
    const callTool = recorder();
    const lines = [];
    const r = await runProgram('progress("a"); await tools.s.t({}); await read("p"); 1', {
      tools: { s: ["t"] },
      shell: true,
      callTool,
      onProgress: (l) => lines.push(l),
      signal: AbortSignal.abort(),
    });
    expectStopped(r, []);
    await sleep(100);
    assert.deepStrictEqual(callTool.calls, []);
    assert.deepStrictEqual(lines, []);
  });

  test("with the argument state, the state of the result is equal to the argument", async () => {
    const argument = { a: 1, b: [true, null] };
    const r = await runProgram("state.a = 2", { state: argument, signal: AbortSignal.abort() });
    assert.deepStrictEqual(Object.keys(r).sort(), ["error", "logs", "ok", "state"]);
    assert.deepStrictEqual(r.error, { kind: "stopped", message: STOPPED });
    assert.deepStrictEqual(r.logs, []);
    assert.deepStrictEqual(r.state, { a: 1, b: [true, null] });
    assert.deepStrictEqual(argument, { a: 1, b: [true, null] });
  });

  test("the reason of the abort is not read", async () => {
    const controller = new AbortController();
    controller.abort(new Error("a reason that is not the message"));
    expectStopped(await runProgram("1", { signal: controller.signal }), []);
    const second = new AbortController();
    second.abort("text");
    expectStopped(await runProgram("1", { signal: second.signal }), []);
  });

  test("the limit and the program do not matter: not even a program that would fail", async () => {
    expectStopped(await runProgram("let = =", { signal: AbortSignal.abort() }), []);
    expectStopped(await runProgram("throw new Error('x')", { signal: AbortSignal.abort(), timeoutMs: 1 }), []);
    expectStopped(await runProgram("", { signal: AbortSignal.abort() }), []);
  });

  test("the other arguments are tested first: a bad argument still rejects with its TypeError, and no process is started", async () => {
    await settle();
    const aborted = () => AbortSignal.abort();
    const bad = [
      ["code", () => runProgram(5, { signal: aborted() })],
      ["no code", () => runProgram(undefined, { signal: aborted() })],
      ["tools", () => runProgram("1", { tools: [], signal: aborted() })],
      ["a tool without callTool", () => runProgram("1", { tools: { s: ["t"] }, signal: aborted() })],
      ["timeoutMs", () => runProgram("1", { timeoutMs: 0, signal: aborted() })],
      ["memoryMb", () => runProgram("1", { memoryMb: 8, signal: aborted() })],
      ["state", () => runProgram("1", { state: null, signal: aborted() })],
      ["shell", () => runProgram("1", { shell: "yes", signal: aborted() })],
      ["shell without callTool", () => runProgram("1", { shell: true, signal: aborted() })],
      ["onProgress", () => runProgram("1", { onProgress: "x", signal: aborted() })],
    ];
    for (const [name, call] of bad) {
      let promise;
      assert.doesNotThrow(() => {
        promise = call();
      }, `${name}: the call is rejected, never thrown at once`);
      await assert.rejects(promise, TypeError, name);
    }
    assert.deepStrictEqual(childRows(), []);
  });
});

describe("the listener the sandbox puts on the signal", () => {
  const count = (signal) => getEventListeners(signal, "abort").length;

  test("after a value, after a failure, after a syntax error: none of the sandbox's is left", async () => {
    const { signal } = new AbortController();
    const before = count(signal);
    expectOk(await runProgram("1 + 1", { signal }), 2);
    assert.strictEqual(count(signal), before);
    expectFail(await runProgram("throw new Error('x')", { signal }), "error", "Error: x");
    assert.strictEqual(count(signal), before);
    expectFail(await runProgram("let = =", { signal }), "error", /^SyntaxError: /);
    assert.strictEqual(count(signal), before);
    expectFail(await runProgram("return 1n", { signal }), "error", "the value cannot be sent as JSON");
    assert.strictEqual(count(signal), before);
  });

  test("after a timeout", async () => {
    const { signal } = new AbortController();
    const before = count(signal);
    expectFail(await runProgram(LOOP, { signal, timeoutMs: 300 }), "timeout", "stopped after 300 ms");
    assert.strictEqual(count(signal), before);
  });

  test("after a crash", async () => {
    const { signal } = new AbortController();
    const before = count(signal);
    const r = await runProgram("const a = []; while (true) a.push(new Array(100000).fill(1))", { signal, memoryMb: 16, timeoutMs: 30000 });
    expectFail(r, "crash", /^code /);
    assert.strictEqual(count(signal), before);
  });

  test("after a stop by the abort, and after a signal already aborted", async () => {
    const controller = new AbortController();
    const before = count(controller.signal);
    await settle();
    const running = runProgram(LOOP, { signal: controller.signal, timeoutMs: 3000 });
    assert.ok(await waitFor(() => childRows()[0], 3000));
    controller.abort();
    expectStopped(await running);
    assert.strictEqual(count(controller.signal), before);
    expectStopped(await runProgram("1", { signal: controller.signal }), []);
    assert.strictEqual(count(controller.signal), before);
  });

  test("a signal that aborts after the promise resolved does nothing", async () => {
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const callTool = recorder();
      const lines = [];
      const controller = new AbortController();
      const r = await runProgram("progress('a'); return 5", { signal: controller.signal, onProgress: (l) => lines.push(l), callTool });
      expectOk(r, 5);
      controller.abort();
      await sleep(150);
      assert.deepStrictEqual(lines, ["a"]);
      assert.deepStrictEqual(failures, []);
      assert.deepStrictEqual(r, { ok: true, value: 5, logs: [] });
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });
});

describe("one signal for several calls", () => {
  test("its abort stops each of them that still runs", async () => {
    await settle();
    const controller = new AbortController();
    const running = [1, 2, 3].map(() => runProgram(LOOP, { signal: controller.signal, timeoutMs: 3000 }));
    assert.ok(await waitFor(() => childRows().length >= 3, 3000), "the three processes were not all seen at once");
    const pids = childRows().map((r) => r.pid);
    controller.abort();
    for (const r of await Promise.all(running)) expectStopped(r);
    assert.ok(await waitFor(() => pids.every((pid) => !alive(pid)), 2000), "a process of a program still runs");
  });

  test("a call that ended before the abort keeps its own result; one that still runs is stopped", async () => {
    await settle();
    const controller = new AbortController();
    const quick = await runProgram("6 * 7", { signal: controller.signal });
    const slow = runProgram(LOOP, { signal: controller.signal, timeoutMs: 3000 });
    assert.ok(await waitFor(() => childRows()[0], 3000));
    controller.abort();
    expectOk(quick, 42);
    expectStopped(await slow);
  });

  test("a call made after the abort, with the same signal, is stopped and starts no process", async () => {
    await settle();
    const controller = new AbortController();
    controller.abort();
    const r = await Promise.all([runProgram("1", { signal: controller.signal }), runProgram("2", { signal: controller.signal })]);
    for (const x of r) expectStopped(x, []);
    assert.deepStrictEqual(childRows(), []);
  });

  test("calls with signals of their own: the abort of one stops only that one", async () => {
    await settle();
    const a = new AbortController();
    const b = new AbortController();
    const ra = runProgram("await new Promise((r) => setTimeout(r, 300)); return 'a'", { signal: a.signal, timeoutMs: 3000 });
    const rb = runProgram(LOOP, { signal: b.signal, timeoutMs: 3000 });
    assert.ok(await waitFor(() => childRows().length >= 2, 3000));
    b.abort();
    expectStopped(await rb);
    expectOk(await ra, "a");
  });
});

describe("the abort with the time limit and with the end of the program", () => {
  async function noFailure(body) {
    await settle();
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      await body();
      await sleep(200);
      assert.deepStrictEqual(failures, []);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  }

  test("whichever comes first ends the program, with its own kind: the limit first", async () => {
    await noFailure(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        expectFail(await runProgram(LOOP, { signal: controller.signal, timeoutMs: 300 }), "timeout", "stopped after 300 ms");
      } finally {
        clearTimeout(timer);
      }
      controller.abort();
    });
  });

  test("whichever comes first ends the program, with its own kind: the abort first", async () => {
    const { result } = await abortedWhileRunning(LOOP, { timeoutMs: 20000 });
    expectStopped(result);
  });

  test("the abort as the limit passes: one result, a timeout or stopped", async () => {
    await noFailure(async () => {
      const limits = [];
      for (let ms = 150; ms <= 300; ms += 10) limits.push(ms);
      const controllers = limits.map(() => new AbortController());
      const running = limits.map((ms, i) => runProgram(LOOP, { timeoutMs: ms, signal: controllers[i].signal }));
      limits.forEach((ms, i) => setTimeout(() => controllers[i].abort(), ms));
      const results = await Promise.all(running);
      results.forEach((r, i) => {
        if (r.error?.kind === "stopped") expectStopped(r);
        else expectFail(r, "timeout", `stopped after ${limits[i]} ms`);
      });
    });
  });

  test("the abort as the program ends: one result, the value or stopped", async () => {
    await noFailure(async () => {
      const delays = [];
      for (let ms = 20; ms <= 300; ms += 10) delays.push(ms);
      const controllers = delays.map(() => new AbortController());
      const running = delays.map((ms, i) => runProgram("await new Promise((r) => setTimeout(r, 0));\n7", { signal: controllers[i].signal }));
      delays.forEach((ms, i) => setTimeout(() => controllers[i].abort(), ms));
      const results = await Promise.all(running);
      for (const r of results) {
        if (r.ok) expectOk(r, 7);
        else expectStopped(r);
      }
    });
  });

  test("a short limit and a signal that aborts later: the timeout, and the later abort does nothing", async () => {
    await noFailure(async () => {
      const controller = new AbortController();
      const r = await runProgram("await new Promise(() => {})", { signal: controller.signal, timeoutMs: 200 });
      expectFail(r, "timeout", "stopped after 200 ms");
      controller.abort();
    });
  });
});

describe("onProgress with signal", () => {
  test("lines posted before the stop are handed over or not, in order; none after the promise resolved", async () => {
    const controller = new AbortController();
    const lines = [];
    let resolved = false;
    let late = 0;
    const onProgress = (line) => {
      lines.push(line);
      if (resolved) late++;
      if (lines.length === 5) controller.abort();
    };
    const r = await runProgram("for (let i = 0; ; i++) { progress('n' + i); await new Promise((r) => setTimeout(r, 1)) }", {
      onProgress,
      signal: controller.signal,
      timeoutMs: 20000,
    });
    resolved = true;
    expectStopped(r);
    const atResolve = lines.length;
    await sleep(300);
    assert.strictEqual(late, 0, "onProgress was called after the promise resolved");
    assert.strictEqual(lines.length, atResolve);
    const indexes = lines.map((l) => Number(/^n(\d+)$/.exec(l)?.[1]));
    assert.ok(indexes.every((n) => Number.isInteger(n)), JSON.stringify(lines));
    for (let i = 1; i < indexes.length; i++) assert.ok(indexes[i] > indexes[i - 1], `lines out of order: ${lines}`);
    assert.ok(lines.length >= 5);
  });

  test("the lines are not in logs, and the logs are not lines, when stopped", async () => {
    const lines = [];
    const { result } = await abortedWhileRunning("console.log('log'); progress('line'); " + LOOP, { onProgress: (l) => lines.push(l) });
    expectStopped(result);
    assert.ok(result.logs.every((l) => l === "log"));
    assert.ok(lines.every((l) => l === "line"));
  });
});

describe("signal with shell, state and tools: each does what its own section says", () => {
  test("a signal that does not abort, with all of them", async () => {
    const callTool = recorder(async (server, tool, args) => (tool === "run" ? { exitCode: 0, stdout: "o\n", stderr: "" } : { server, tool, args }));
    const { signal } = new AbortController();
    const r = await runProgram("state.k = 1; const a = await tools.s.t({ n: 1 }); const b = await $`ls`.text(); return [a, b]", {
      signal,
      state: { k: 0 },
      shell: true,
      tools: { s: ["t"] },
      callTool,
    });
    assert.deepStrictEqual(Object.keys(r).sort(), ["logs", "ok", "state", "value"]);
    assert.deepStrictEqual(r.value, [{ server: "s", tool: "t", args: { n: 1 } }, "o\n"]);
    assert.deepStrictEqual(r.state, { k: 1 });
    assert.deepStrictEqual(callTool.calls, [
      ["s", "t", { n: 1 }],
      ["shell", "run", { command: "ls" }],
    ]);
  });

  test("a bad signal, with all the rest good: TypeError", async () => {
    await assert.rejects(runProgram("1", { signal: {}, shell: true, callTool: recorder(), state: {} }), TypeError);
  });
});

describe("a bad signal", () => {
  const bad = [
    ["null", null],
    ["a string", "abort"],
    ["an empty string", ""],
    ["a number", 5],
    ["an object", {}],
    ["an object with a key aborted that is false", { aborted: false }],
    ["an object with a key aborted that is true", { aborted: true }],
    ["an object that looks like a signal", { aborted: false, addEventListener() {}, removeEventListener() {} }],
    ["an AbortController", new AbortController()],
    ["a list", [AbortSignal.abort()]],
    ["true", true],
    ["false", false],
    ["a function", () => {}],
  ];
  for (const [name, signal] of bad) {
    test(`${name}: a TypeError, and no process is started`, async () => {
      await settle();
      let promise;
      assert.doesNotThrow(() => {
        promise = runProgram("1 + 1", { signal });
      }, "the call is rejected, never thrown at once");
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("a signal made by AbortSignal.timeout, AbortSignal.any and a controller is good", async () => {
    const controller = new AbortController();
    expectOk(await runProgram("1", { signal: AbortSignal.timeout(60000) }), 1);
    expectOk(await runProgram("2", { signal: AbortSignal.any([controller.signal]) }), 2);
    expectOk(await runProgram("3", { signal: controller.signal }), 3);
  });
});

describe("processes, signals and time limits", () => {
  test("the one signal the sandbox sends is SIGKILL, to the process it started: an abort sends it as the limit does", () => {
    const got = fixtureJson("abort-kills");
    assert.deepStrictEqual(Object.keys(got.result).sort(), ["error", "logs", "ok"]);
    assert.deepStrictEqual(got.result.error, { kind: "stopped", message: STOPPED });
    assert.ok(got.pids.length >= 1);
    assert.ok(got.kills.length >= 1, "no signal was sent to a program that was stopped");
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.pids.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
  });

  test("a second abort sends nothing, and a signal already aborted starts no process", () => {
    const got = fixtureJson("abort-kills");
    assert.strictEqual(got.afterSecond, got.beforeSecond, "a signal was sent by a second abort");
    assert.deepStrictEqual(got.alreadyAborted, { ok: false, error: { kind: "stopped", message: STOPPED }, logs: [] });
    assert.strictEqual(got.spawnsAfter, got.spawnsBefore, "a process was started for a signal already aborted");
  });

  test("an abort after the promise resolved sends nothing", () => {
    const got = fixtureJson("abort-kills");
    assert.deepStrictEqual(got.ranToEnd, { ok: true, value: 4, logs: [] });
    assert.strictEqual(got.afterLate, got.beforeLate, "a signal was sent after the promise resolved");
  });

  test("a caller with handlers of its own, and one that ignores signals, is not touched", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.changed, []);
    assert.deepStrictEqual(got.results.map((r) => r.error?.kind ?? "ok"), ["stopped", "stopped", "ok", "stopped"]);
  });

  test("one listener of the caller's exit event is added, once however many calls are made", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.exits, [got.exitBefore + 1, got.exitBefore + 1, got.exitBefore + 1, got.exitBefore + 1]);
  });

  test("when the caller exits while a program with onProgress and a signal runs, the exit listener kills it", async () => {
    let pid;
    try {
      const got = fixtureJson("exit-kills");
      pid = got.pid;
      assert.ok(pid, "the fixture saw no process of the program");
      assert.ok(await waitFor(() => !alive(pid), 3000), "the program's process outlived its caller");
      for (const k of got.kills) assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
    } finally {
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  test("when nothing runs, the caller exits with no signal sent, after programs stopped by a signal", () => {
    assert.deepStrictEqual(fixtureJson("idle-exit"), { killsAtExit: [] });
  });
});
