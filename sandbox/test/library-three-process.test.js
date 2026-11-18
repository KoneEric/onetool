import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { alive, waitFor } from "./helpers.js";

// The processes, signals and walls of the step 7 arguments, seen from a caller that spies on what it starts and
// on every signal it sends (sandbox/test/fixtures/library-three.mjs). Every call of the fixture has a limit of its own
// of 60 seconds, and the programs in it end by themselves inside 10 seconds ("Processes, signals, time limits
// and waits").
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const isKill = (signal) => signal === "SIGKILL" || signal === 9;
const REFUSED = { read: "refused", write: "refused", spawn: "refused", worker: "refused" };
const STOPPED = { kind: "stopped", message: "stopped by the caller" };

let folder;
let probePath;
before(() => {
  folder = mkdtempSync(join(tmpdir(), "onetool-library-three-"));
  probePath = join(folder, "probe-target.txt");
  writeFileSync(probePath, "secret text of the probe file\n");
});
after(() => rmSync(folder, { recursive: true, force: true }));

function runFixture(...args) {
  const r = spawnSync(process.execPath, [fixture("library-three.mjs"), ...args], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.error, undefined, String(r.error));
  return r;
}

const cache = new Map();
function fixtureJson(scenario) {
  if (!cache.has(scenario)) {
    const r = runFixture(scenario, probePath);
    assert.strictEqual(r.status, 0, r.stderr);
    cache.set(scenario, JSON.parse(r.stdout));
  }
  return structuredClone(cache.get(scenario));
}

// The flags of a command line of the sandbox: what is neither a file to run nor a file that may be read.
const flagsOf = (args) => {
  const flags = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--allow-fs-read") i++;
    else if (a.startsWith("-") && !a.startsWith("--allow-fs-read=")) flags.push(a);
  }
  return flags;
};

describe("the process is started exactly as without the three functions", () => {
  test("the programs ran: the values, the logs, the uses, the lines and the state are those of their sections", () => {
    const got = fixtureJson("argv");
    assert.deepStrictEqual(got.results[0], { ok: true, value: 2, logs: [] });
    assert.deepStrictEqual(got.results[1], {
      ok: true,
      value: [["library", "report", {}], ["library", "restore", { name: "a" }], ["library", "read", { name: "b" }]],
      logs: [],
    });
    // double 4 is 8; the saved program `three` makes the three calls of its own names; report and read(z) come after
    const three = [["library", "report", {}], ["library", "restore", { name: "s" }], ["library", "read", { name: "t" }]];
    assert.deepStrictEqual(got.results[2], {
      ok: true,
      value: [["s", "t2", {}], "o\n", three, ["library", "report", {}], ["library", "read", { name: "z" }]],
      logs: [],
      state: { n: 8 },
    });
    assert.deepStrictEqual(got.lines, ["p"]);
    // a use only for a call of a saved program, never for the three
    assert.deepStrictEqual(got.uses, [
      { name: "double", ok: true },
      { name: "three", ok: true },
    ]);
  });

  test("one process for each program, however many of the three it calls: the same Node, flags, empty environment, streams", () => {
    const got = fixtureJson("argv");
    assert.strictEqual(got.spawns[0].length, 1);
    assert.strictEqual(got.spawns[1].length, 1, "a program that calls the three started more than one process");
    assert.strictEqual(got.spawns[2].length, 1, "a program with every argument and the three started more than one process");
    const [plain] = got.spawns[0];
    for (const [other] of [got.spawns[1], got.spawns[2]]) {
      assert.strictEqual(other.file, plain.file);
      assert.strictEqual(other.file, process.execPath);
      assert.deepStrictEqual(other.args, plain.args);
      assert.deepStrictEqual(other.envPairs, []);
      assert.strictEqual(other.stdio, plain.stdio);
      assert.ok(other.args.includes("--permission"));
      assert.ok(!other.args.some((a) => /^--allow-(fs-write|child-process|worker)/.test(a)));
    }
    assert.deepStrictEqual(plain.envPairs, []);
  });

  test("checkWalls reports the same: all four refused, and the probe is started with the flags of a program", () => {
    const got = fixtureJson("argv");
    assert.deepStrictEqual(got.walls, REFUSED);
    assert.strictEqual(got.probe.length, 1, "checkWalls must start exactly one process");
    const [probe] = got.probe;
    const [program] = got.spawns[1];
    assert.strictEqual(probe.file, program.file);
    assert.deepStrictEqual(probe.envPairs, []);
    assert.strictEqual(probe.stdio, program.stdio);
    assert.deepStrictEqual(flagsOf(probe.args), flagsOf(program.args));
  });

  test("the signals sent while the programs ran are SIGKILL only, only to the processes it started", () => {
    const got = fixtureJson("argv");
    const pids = got.spawns.flat().map((s) => s.pid);
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(pids.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
  });
});

describe("a program that waits in one of the three is stopped by the time limit and by the abort", () => {
  test("a saved program that waits in library.read is stopped at the limit; one stopped by the abort says stopped", () => {
    const got = fixtureJson("stops");
    assert.deepStrictEqual(Object.keys(got.timed).sort(), ["error", "logs", "ok"]);
    assert.deepStrictEqual(got.timed.error, { kind: "timeout", message: "stopped after 400 ms" });
    assert.deepStrictEqual(got.aborted.ok, false);
    assert.deepStrictEqual(got.aborted.error, STOPPED);
    assert.deepStrictEqual(Object.keys(got.aborted).sort(), ["error", "logs", "ok"]);
  });

  test("the one signal sent is SIGKILL, to a process it started, and the process is gone", async () => {
    const got = fixtureJson("stops");
    assert.ok(got.pids.length >= 2);
    assert.ok(got.kills.length >= 2, "no signal was sent to a program that was stopped");
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.pids.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
    for (const pid of got.pids) assert.ok(await waitFor(() => !alive(pid), 3000), `the process ${pid} still runs`);
  });

  test("a second abort sends nothing, and a signal already aborted starts no process", () => {
    const got = fixtureJson("stops");
    assert.strictEqual(got.afterSecond, got.beforeSecond, "a signal was sent by a second abort");
    assert.deepStrictEqual(got.alreadyAborted, { ok: false, error: STOPPED, logs: [] });
    assert.strictEqual(got.spawnsAfter, got.spawnsBefore, "a process was started for a signal already aborted");
  });

  test("an abort after the promise resolved sends nothing", () => {
    const got = fixtureJson("stops");
    assert.deepStrictEqual(got.ranToEnd, { ok: true, value: ["library", "restore", { name: "late" }], logs: [] });
    assert.strictEqual(got.afterLate, got.beforeLate, "a signal was sent after the promise resolved");
  });
});

describe("the caller's own signal handlers and exit", () => {
  test("a caller with handlers of its own, and one that ignores signals, is not touched", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.changed, []);
    assert.deepStrictEqual(got.results.map((r) => r.error?.kind ?? "ok"), ["timeout", "stopped", "ok", "stopped"]);
  });

  test("one listener of the caller's exit event is added, once however many calls are made", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.exits, [got.exitBefore + 1, got.exitBefore + 1, got.exitBefore + 1, got.exitBefore + 1]);
  });

  test("when the caller exits while a program waits in library.read, the exit listener kills its process", async () => {
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

  test("when nothing runs, the caller exits with no signal sent, after programs with the three that were stopped", () => {
    assert.deepStrictEqual(fixtureJson("idle-exit"), { killsAtExit: [] });
  });
});

describe("standard output and standard error of the caller", () => {
  test("nothing is written, by the sandbox or by the program, whatever happens to it, with the three functions", () => {
    const r = runFixture("silent");
    assert.strictEqual(r.status, 0, `the outcomes were not those expected (${r.status}): ${r.stderr}`);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
});
