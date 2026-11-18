import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as sandbox from "../src/index.js";
import { childRows, alive, waitFor, sleep } from "./helpers.js";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const isKill = (signal) => signal === "SIGKILL" || signal === 9;
const REFUSED = { read: "refused", write: "refused", spawn: "refused", worker: "refused" };

let folder;
let probePath;
before(() => {
  folder = mkdtempSync(join(tmpdir(), "onetool-walls-"));
  probePath = join(folder, "probe-target.txt");
  writeFileSync(probePath, "secret text of the probe file\n");
});
after(() => rmSync(folder, { recursive: true, force: true }));

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs");

function runFixture(...args) {
  const r = spawnSync(process.execPath, [fixture("walls.mjs"), ...args], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.error, undefined, String(r.error));
  return r;
}

function fixtureJson(scenario) {
  const r = runFixture(scenario, probePath);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe("the exports", () => {
  test("two exports: runProgram and checkWalls", () => {
    assert.deepStrictEqual(Object.keys(sandbox).sort(), ["checkWalls", "runProgram"]);
    assert.strictEqual(typeof sandbox.runProgram, "function");
    assert.strictEqual(typeof sandbox.checkWalls, "function");
  });
});

describe("the four walls, seen by a probe", () => {
  test("a file outside sandbox/src: read, write, spawn and worker are all refused", async () => {
    await settle();
    const walls = await sandbox.checkWalls(probePath);
    assert.deepStrictEqual(Object.keys(walls).sort(), ["read", "spawn", "worker", "write"]);
    assert.deepStrictEqual(walls, REFUSED);
  });

  test("afterwards no file probePath + .written exists, and the probe file is as it was", async () => {
    await sandbox.checkWalls(probePath);
    assert.strictEqual(existsSync(probePath + ".written"), false);
    assert.strictEqual(readFileSync(probePath, "utf8"), "secret text of the probe file\n");
  });

  test("the answer is the same again, and with a time limit given", async () => {
    assert.deepStrictEqual(await sandbox.checkWalls(probePath), REFUSED);
    assert.deepStrictEqual(await sandbox.checkWalls(probePath, { timeoutMs: 20000 }), REFUSED);
    assert.deepStrictEqual(await sandbox.checkWalls(probePath, {}), REFUSED);
  });

  test("several at the same time", async () => {
    const all = await Promise.all([1, 2, 3].map(() => sandbox.checkWalls(probePath, { timeoutMs: 20000 })));
    for (const walls of all) assert.deepStrictEqual(walls, REFUSED);
  });

  test("when the promise resolves, the process of the probe has ended or was sent SIGKILL", async () => {
    await settle();
    await sandbox.checkWalls(probePath);
    assert.ok(await waitFor(() => childRows().length === 0, 2000), "a process of the probe still runs");
  });
});

describe("the probe is started as a program is: the same options, built by the one code", () => {
  const options = (args) => {
    const flags = [];
    const reads = [];
    const scripts = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--allow-fs-read") reads.push(args[++i]);
      else if (a.startsWith("--allow-fs-read=")) reads.push(a.slice("--allow-fs-read=".length));
      else if (a.startsWith("-")) flags.push(a);
      else scripts.push(a);
    }
    return { flags, reads, scripts };
  };
  const inSrc = (path) => resolve(path).startsWith(resolve(srcDir) + sep);

  test("the same Node, flags, memory ceiling, empty environment and standard streams", () => {
    const got = fixtureJson("argv");
    assert.deepStrictEqual(got.walls, REFUSED);
    assert.strictEqual(got.probe.length, 1, "checkWalls must start exactly one process");
    assert.strictEqual(got.run.length, 1);
    const [probe] = got.probe;
    const [program] = got.run;
    assert.strictEqual(probe.file, program.file);
    assert.strictEqual(probe.file, process.execPath);
    assert.deepStrictEqual(probe.envPairs, []);
    assert.deepStrictEqual(program.envPairs, []);
    assert.strictEqual(probe.stdio, program.stdio);

    const p = options(probe.args);
    const q = options(program.args);
    assert.deepStrictEqual(p.flags, q.flags);
    assert.ok(p.flags.includes("--permission"));
    assert.ok(p.flags.includes("--max-old-space-size=256"), `the ceiling of the program is the default: ${p.flags}`);
    for (const side of [p, q]) {
      for (const flag of side.flags) {
        assert.doesNotMatch(flag, /^--allow-(fs-write|child-process|worker)/);
      }
      assert.ok(!side.reads.includes("*"));
    }
  });

  test("the probe is a file of sandbox/src, readable by its process; the program may not read it", () => {
    const got = fixtureJson("argv");
    const p = options(got.probe[0].args);
    const q = options(got.run[0].args);
    assert.strictEqual(q.scripts.length, 1);
    // the probe's command line may carry the path to read besides the file it runs
    const files = p.scripts.filter((a) => inSrc(a) && resolve(a) !== resolve(q.scripts[0]));
    assert.strictEqual(files.length, 1, `no single probe file of sandbox/src in the command line: ${p.scripts}`);
    const [probeFile] = files;
    assert.notStrictEqual(resolve(probeFile), resolve(q.scripts[0]));
    assert.ok(p.reads.map((r) => resolve(r)).includes(resolve(probeFile)), "the probe file is not among the files its process may read");
    for (const read of [...p.reads, ...q.reads]) assert.ok(inSrc(read), `a file outside sandbox/src may be read: ${read}`);
    assert.ok(!q.reads.map((r) => resolve(r)).includes(resolve(probeFile)), "the process of a program may read the probe file");
    assert.ok(!got.run[0].args.some((a) => a.includes(probeFile)), "the command line of a program names the probe file");
    // the file the probe is asked to read is not among the files its process may read
    assert.ok(!p.reads.some((r) => resolve(r) === resolve(probePath)), "the probe may read the file it was asked to read");
  });
});

describe("what a caller of checkWalls is given", () => {
  const bad = [
    ["nothing", () => sandbox.checkWalls()],
    ["undefined", () => sandbox.checkWalls(undefined)],
    ["null", () => sandbox.checkWalls(null)],
    ["a number", () => sandbox.checkWalls(5)],
    ["an object", () => sandbox.checkWalls({})],
    ["a list", () => sandbox.checkWalls([probePath])],
    ["an empty string", () => sandbox.checkWalls("")],
    ["a String object", () => sandbox.checkWalls(new String(probePath))],
    ["timeoutMs is 0", () => sandbox.checkWalls(probePath, { timeoutMs: 0 })],
    ["timeoutMs is negative", () => sandbox.checkWalls(probePath, { timeoutMs: -5 })],
    ["timeoutMs is NaN", () => sandbox.checkWalls(probePath, { timeoutMs: NaN })],
    ["timeoutMs is Infinity", () => sandbox.checkWalls(probePath, { timeoutMs: Infinity })],
    ["timeoutMs is a string", () => sandbox.checkWalls(probePath, { timeoutMs: "100" })],
    ["timeoutMs is null", () => sandbox.checkWalls(probePath, { timeoutMs: null })],
  ];
  for (const [name, call] of bad) {
    test(`${name}: a TypeError and no process is started`, async () => {
      await settle();
      let promise;
      assert.doesNotThrow(() => {
        promise = call();
      }, "the call is rejected, never thrown at once");
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }
});

describe("the time limit of checkWalls", () => {
  test("a probe that has not answered after timeoutMs: the promise rejects with an Error", async () => {
    await settle();
    await assert.rejects(sandbox.checkWalls(probePath, { timeoutMs: 1 }), (e) => {
      assert.ok(e instanceof Error);
      assert.strictEqual(e.message, "the probe did not answer in 1 ms");
      return true;
    });
    assert.ok(await waitFor(() => childRows().length === 0, 3000), "the process of the probe still runs");
  });

  test("a probe that cannot answer is killed: the message names the limit, the process is gone", () => {
    const got = fixtureJson("stopped");
    assert.strictEqual(got.caught.isError, true);
    assert.strictEqual(got.caught.message, "the probe did not answer in 300 ms");
    assert.strictEqual(got.pids.length, 1);
    assert.deepStrictEqual(got.stillAlive, [], "the probe's process outlived the rejection (it was stopped, only SIGKILL ends it)");
  });

  test("the sandbox sends only SIGKILL, and only to the process it started", () => {
    const got = fixtureJson("stopped");
    assert.ok(got.kills.length >= 1, "no signal was sent to a probe that could not answer");
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.pids.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
  });

  test("a limit that passes as the probe answers: one outcome, the answer or the rejection", async () => {
    await settle();
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const limits = [];
      for (let ms = 40; ms <= 200; ms += 10) limits.push(ms);
      const outcomes = await Promise.allSettled(limits.map((ms) => sandbox.checkWalls(probePath, { timeoutMs: ms })));
      outcomes.forEach((o, i) => {
        if (o.status === "fulfilled") assert.deepStrictEqual(o.value, REFUSED);
        else {
          assert.ok(o.reason instanceof Error);
          assert.strictEqual(o.reason.message, `the probe did not answer in ${limits[i]} ms`);
        }
      });
      await sleep(200);
      assert.deepStrictEqual(failures, []);
      assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process of a probe still runs");
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });
});

describe("a probe that ends before it answers", () => {
  test("the promise rejects with an Error: the probe ended before it answered", () => {
    const got = fixtureJson("ended");
    assert.strictEqual(got.caught.isError, true);
    assert.strictEqual(got.caught.message, "the probe ended before it answered");
    assert.strictEqual(got.pids.length, 1);
  });

  test("killing a process that has already ended is no fault, and the signal is only SIGKILL", () => {
    const got = fixtureJson("ended");
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.pids.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
    }
  });
});

describe("signals and the exit of the caller", () => {
  test("a caller with handlers of its own, and one that ignores signals, is not touched", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.results, [REFUSED, REFUSED, REFUSED]);
    assert.strictEqual(got.ran.ok, true);
    assert.deepStrictEqual(got.changed, []);
  });

  test("checkWalls uses the one exit listener that exists: one added, however many calls are made", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.exits, [got.exitBefore + 1, got.exitBefore + 1, got.exitBefore + 1, got.exitBefore + 1]);
  });

  test("when the caller exits while a probe runs, the exit listener kills it", async () => {
    let pid;
    try {
      const got = fixtureJson("exit-kills");
      pid = got.pid;
      assert.ok(pid, "the fixture saw no process of the probe");
      assert.ok(await waitFor(() => !alive(pid), 3000), "the probe's process outlived its caller");
      for (const k of got.kills) assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
    } finally {
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  test("when nothing runs, the caller exits with no signal sent", () => {
    assert.deepStrictEqual(fixtureJson("idle-exit"), { killsAtExit: [] });
  });
});

describe("standard output and standard error of the caller", () => {
  test("nothing is written, whatever happens to the probe", () => {
    const r = runFixture("silent", probePath);
    assert.strictEqual(r.status, 0, `the outcomes were not those expected (${r.status}): ${r.stderr}`);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
});
