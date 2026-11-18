// A caller of runProgram with `onProgress` and `signal`, with spies on what it starts and on every signal sent
// from this process. argv[2] is the scenario, argv[3] the path of a probe file (a file outside sandbox/src).
//   argv          the options the processes of a plain program, of one with onProgress and a signal that never
//                 aborts, and of one with a signal already aborted are started with; then checkWalls
//   abort-kills   a program is stopped by the abort of its signal; the abort is made again; a program is run with
//                 that signal, already aborted; and one more abort comes after the end of a program that ended by itself
//   signals       a caller with signal handlers of its own, and one that ignores a signal, runs programs that
//                 are stopped by a signal
//   exit-kills    the caller exits while a program (with onProgress and a signal) runs
//   idle-exit     nothing runs when the caller exits, after programs stopped by a signal
//   silent        the caller writes nothing, whatever happens to the programs
import fs from "node:fs";
import os from "node:os";
import { ChildProcess } from "node:child_process";
import { childRows, waitFor } from "../helpers.js";

const scenario = process.argv[2];
const probePath = process.argv[3];

const kills = [];
const spawns = [];
const processKill = process.kill;
process.kill = function (pid, signal) {
  kills.push({ via: "process.kill", pid, signal });
  return processKill.apply(this, arguments);
};
const childKill = ChildProcess.prototype.kill;
ChildProcess.prototype.kill = function (signal) {
  kills.push({ via: "child.kill", pid: this.pid, signal });
  return childKill.apply(this, arguments);
};
const childSpawn = ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn = function (options) {
  const seen = { file: options.file, args: [...options.args], envPairs: [...(options.envPairs ?? [])], stdio: JSON.stringify(options.stdio) };
  const result = childSpawn.apply(this, arguments);
  seen.pid = this.pid;
  spawns.push(seen);
  return result;
};

const { runProgram, checkWalls } = await import("../../src/index.js");
const out = (o) => fs.writeSync(1, JSON.stringify(o));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOOP = "while (true) {}";

// Runs `code` with an AbortController and aborts it once a process of the program is seen.
async function stoppedByAbort(options = {}, code = LOOP) {
  const controller = new AbortController();
  const running = runProgram(code, { timeoutMs: 20000, ...options, signal: controller.signal });
  const row = await waitFor(() => childRows()[0], 5000);
  controller.abort();
  return { result: await running, pid: row?.pid, controller };
}

if (scenario === "argv") {
  const plain = await runProgram("1 + 1");
  const mark1 = spawns.length;
  const lines = [];
  const controller = new AbortController();
  const both = await runProgram('progress("a"); console.log("b"); 1 + 1', { onProgress: (l) => lines.push(l), signal: controller.signal });
  const mark2 = spawns.length;
  const aborted = await runProgram("1 + 1", { onProgress: (l) => lines.push(l), signal: AbortSignal.abort() });
  const mark3 = spawns.length;
  const killsBeforeWalls = kills.length;
  const walls = await checkWalls(probePath);
  out({
    results: [plain, both, aborted],
    spawns: [spawns.slice(0, mark1), spawns.slice(mark1, mark2), spawns.slice(mark2, mark3)],
    lines,
    walls,
    kills: kills.slice(0, killsBeforeWalls),
    self: process.pid,
  });
} else if (scenario === "abort-kills") {
  const { result, controller } = await stoppedByAbort();
  const beforeSecond = kills.length;
  controller.abort(); // a second abort of the same controller
  await wait(100);
  const afterSecond = kills.length;
  const spawnsBefore = spawns.length;
  const alreadyAborted = await runProgram("1 + 1", { signal: controller.signal });
  const spawnsAfter = spawns.length;
  const second = new AbortController();
  const ranToEnd = await runProgram("2 + 2", { signal: second.signal });
  const beforeLate = kills.length;
  second.abort(); // after the promise resolved
  await wait(150);
  const pids = spawns.map((s) => s.pid);
  out({ result, alreadyAborted, ranToEnd, pids, kills, beforeSecond, afterSecond, spawnsBefore, spawnsAfter, beforeLate, afterLate: kills.length, self: process.pid });
} else if (scenario === "signals") {
  const names = Object.keys(os.constants.signals);
  process.on("SIGTERM", () => {});
  process.on("SIGINT", () => {});
  process.on("SIGHUP", () => {});
  process.on("SIGUSR2", () => {});
  process.on("SIGPIPE", () => {});
  const before = Object.fromEntries(names.map((n) => [n, process.listeners(n)]));
  const exitBefore = process.listenerCount("exit");
  const results = [];
  const exits = [];
  results.push((await stoppedByAbort({ onProgress: () => {} })).result);
  exits.push(process.listenerCount("exit"));
  results.push((await stoppedByAbort()).result);
  exits.push(process.listenerCount("exit"));
  results.push(await runProgram("1 + 1", { signal: new AbortController().signal, onProgress: () => {} }));
  exits.push(process.listenerCount("exit"));
  results.push(await runProgram("1 + 1", { signal: AbortSignal.abort() }));
  exits.push(process.listenerCount("exit"));
  const changed = names.filter((n) => {
    const now = process.listeners(n);
    return now.length !== before[n].length || now.some((f, i) => f !== before[n][i]);
  });
  out({ results, exitBefore, exits, changed });
} else if (scenario === "exit-kills") {
  const controller = new AbortController();
  runProgram(LOOP, { timeoutMs: 60000, onProgress: () => {}, signal: controller.signal }).catch(() => {});
  const pid = await waitFor(() => childRows()[0]?.pid, 5000);
  process.on("exit", () => out({ pid, kills }));
  process.exit(0);
} else if (scenario === "idle-exit") {
  await stoppedByAbort();
  await runProgram("1 + 1", { signal: AbortSignal.abort() });
  await runProgram("1 + 1", { signal: new AbortController().signal });
  await wait(200);
  kills.length = 0;
  process.on("exit", () => out({ killsAtExit: kills }));
  process.exit(0);
} else if (scenario === "silent") {
  let bad = 0;
  const throwing = () => {
    throw new Error("the caller's onProgress throws");
  };
  const first = await runProgram('progress("a", 1); progress(); 1', { onProgress: throwing });
  if (first.ok !== true) bad++;
  if ((await stoppedByAbort({ onProgress: throwing }, 'progress("x"); while (true) {}')).result.error?.kind !== "stopped") bad++;
  if ((await runProgram("1", { signal: AbortSignal.abort(), onProgress: throwing })).error?.kind !== "stopped") bad++;
  const failed = await runProgram('progress("x"); throw new Error("boom")', { onProgress: throwing });
  if (failed.error?.kind !== "error") bad++;
  const timed = await runProgram('progress("x"); while (true) {}', { onProgress: throwing, timeoutMs: 300 });
  if (timed.error?.kind !== "timeout") bad++;
  try {
    await runProgram("1", { onProgress: 5 });
    bad++;
  } catch (e) {
    if (!(e instanceof TypeError)) bad++;
  }
  try {
    await runProgram("1", { signal: {} });
    bad++;
  } catch (e) {
    if (!(e instanceof TypeError)) bad++;
  }
  process.exitCode = bad;
}
