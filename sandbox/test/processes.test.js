import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, alive, environmentOf, waitFor, sleep } from "./helpers.js";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function runFixture(name, ...args) {
  const r = spawnSync(process.execPath, [fixture(name), ...args], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.error, undefined, String(r.error));
  return r;
}

async function settle() {
  assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process of an earlier call still runs");
}

const isKill = (signal) => signal === "SIGKILL" || signal === 9;

describe("one process per call; several at the same time, sharing nothing", () => {
  test("three calls at once are three processes", async () => {
    await settle();
    const running = [1, 2, 3].map(() => runProgram("while (true) {}", { timeoutMs: 1500 }));
    const seen = await waitFor(() => childRows().length >= 3, 3000);
    const rows = childRows();
    const results = await Promise.all(running);
    assert.ok(seen, "the three processes were not all seen at once");
    assert.strictEqual(rows.length, 3);
    for (const r of results) expectFail(r, "timeout", "stopped after 1500 ms");
  });

  test("a program's globals and lines are its own", async () => {
    const results = await Promise.all([
      runProgram('globalThis.shared = "a"; console.log("from a"); await new Promise((r) => setTimeout(r, 100)); return typeof globalThis.other'),
      runProgram('globalThis.other = "b"; console.log("from b"); await new Promise((r) => setTimeout(r, 100)); return typeof globalThis.shared'),
    ]);
    expectOk(results[0], "undefined", ["from a"]);
    expectOk(results[1], "undefined", ["from b"]);
    expectOk(await runProgram("typeof globalThis.shared"), "undefined");
  });

  test("two programs at once, whose tool calls wait for each other", async () => {
    let arrived = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const giveUp = setTimeout(() => release("gave up"), 2000);
    const callTool = recorder(async (server, tool, args) => {
      if (++arrived === 2) release("both");
      return (await gate) + ":" + args.who;
    });
    const tools = { s: ["t"] };
    const [a, b] = await Promise.all([
      runProgram('return await tools.s.t({ who: "a" })', { tools, callTool, timeoutMs: 20000 }),
      runProgram('return await tools.s.t({ who: "b" })', { tools, callTool, timeoutMs: 20000 }),
    ]);
    clearTimeout(giveUp);
    expectOk(a, "both:a");
    expectOk(b, "both:b");
  });
});

describe("the process of the program", () => {
  async function whileRunning(options = {}) {
    await settle();
    const running = runProgram("while (true) {}", { timeoutMs: 1500, ...options });
    const row = await waitFor(() => childRows()[0], 3000);
    const result = await running;
    assert.ok(row, "no process of the program was seen");
    return { row, result };
  }

  test("it is started with the permission model, and no right to write, to spawn or to start a worker", async () => {
    const { row } = await whileRunning();
    assert.match(row.command, /(^|\s)--permission(\s|=|$)/);
    assert.doesNotMatch(row.command, /--allow-fs-write/);
    assert.doesNotMatch(row.command, /--allow-child-process/);
    assert.doesNotMatch(row.command, /--allow-worker/);
    assert.doesNotMatch(row.command, /--allow-fs-read[= ]\*/);
  });

  test("its environment is empty: no variable of the caller reaches it", async (t) => {
    const probe = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      env: { ...process.env, ONETOOL_PROBE_VARIABLE: "visible-probe-value" },
      stdio: "ignore",
    });
    let shown;
    try {
      shown = environmentOf(probe.pid);
    } finally {
      probe.kill("SIGKILL");
    }
    if (!shown || !shown.includes("visible-probe-value")) {
      t.skip("this platform does not show the environment of a process");
      return;
    }
    process.env.ONETOOL_SECRET_VARIABLE = "secret-value-123";
    try {
      await settle();
      const running = runProgram("while (true) {}", { timeoutMs: 1500 });
      const row = await waitFor(() => childRows()[0], 3000);
      assert.ok(row, "no process of the program was seen");
      const env = environmentOf(row.pid);
      await running;
      assert.ok(env !== null);
      assert.ok(!env.includes("secret-value-123"), "a variable of the caller reached the program's process");
      assert.ok(!env.includes("ONETOOL_SECRET_VARIABLE"));
    } finally {
      delete process.env.ONETOOL_SECRET_VARIABLE;
    }
  });

  test("when the promise resolves after a stop at the limit, the process has ended or was sent SIGKILL", async () => {
    const { row } = await whileRunning({ timeoutMs: 300 });
    assert.ok(await waitFor(() => !alive(row.pid), 2000), "the process of the program still runs");
  });

  test("when the promise resolves after a normal end, the process has ended", async () => {
    await settle();
    const r = await runProgram("1 + 1");
    expectOk(r, 2);
    assert.ok(await waitFor(() => childRows().length === 0, 2000), "a process of the program still runs");
  });
});

describe("signals", () => {
  test("a caller with handlers of its own, and one that ignores signals, is not touched", () => {
    const r = runFixture("signals.mjs");
    assert.strictEqual(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.deepStrictEqual(got.results, [true, false, false, true, true]);
    assert.deepStrictEqual(got.changed, []);
  });

  test("one listener of the caller's exit event is added, once however many calls are made", () => {
    const r = runFixture("signals.mjs");
    assert.strictEqual(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    assert.strictEqual(got.exitAfterThree, got.exitBefore + 1);
    assert.strictEqual(got.exitAfterFive, got.exitBefore + 1);
  });

  test("the sandbox sends only SIGKILL, and only to a process it started", () => {
    const r = runFixture("kills.mjs", "timeout");
    assert.strictEqual(r.status, 0, r.stderr);
    const got = JSON.parse(r.stdout);
    expectFail(got.result, "timeout", "stopped after 300 ms");
    assert.ok(got.children.length >= 1);
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.children.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
  });

  test("when the caller exits while a program runs, the exit listener kills it", async () => {
    let pid;
    try {
      const r = runFixture("kills.mjs", "exit-kills");
      assert.strictEqual(r.status, 0, r.stderr);
      const got = JSON.parse(r.stdout);
      pid = got.pid;
      assert.ok(pid, "the fixture saw no process of the program");
      assert.ok(await waitFor(() => !alive(pid), 3000), "the program's process outlived its caller");
      for (const k of got.kills) assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
    } finally {
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  test("when nothing runs, the caller exits with no signal sent", () => {
    const r = runFixture("kills.mjs", "idle-exit");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { killsAtExit: [] });
  });
});

describe("a second stop", () => {
  test("when the limit passes as the program ends there is one result, the value or the timeout", async () => {
    await settle();
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const limits = [];
      for (let ms = 20; ms <= 300; ms += 10) limits.push(ms);
      const results = await Promise.all(
        limits.map((ms) => runProgram("await new Promise((r) => setTimeout(r, 0));\n7", { timeoutMs: ms })),
      );
      results.forEach((r, i) => {
        if (r.ok) expectOk(r, 7);
        else expectFail(r, "timeout", `stopped after ${limits[i]} ms`);
      });
      await sleep(200);
      assert.deepStrictEqual(failures, []);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });
});

describe("standard output and standard error of the caller", () => {
  test("nothing is written, by the sandbox or by the program, whatever happens to it", () => {
    const r = runFixture("silent.mjs");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
});
