// A caller of checkWalls, with spies on what it starts and on every signal sent from this process.
// argv[2] is the scenario, argv[3] the path of a probe file (a file that exists outside sandbox/src).
//   argv         the options a probe and a program are started with
//   stopped      the probe is stopped (SIGSTOP) as it starts and cannot answer: the limit passes
//   ended        the probe is killed as it starts: it ends before it answers
//   exit-kills   the caller exits while a probe that cannot answer still runs
//   idle-exit    nothing runs when the caller exits
//   signals      a caller with signal handlers of its own, and one that ignores a signal
//   silent       the caller writes nothing, whatever happens to the probe
import fs from "node:fs";
import os from "node:os";
import { ChildProcess } from "node:child_process";

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

let afterSpawn = null;
const childSpawn = ChildProcess.prototype.spawn;
ChildProcess.prototype.spawn = function (options) {
  const seen = { file: options.file, args: [...options.args], envPairs: [...(options.envPairs ?? [])], stdio: JSON.stringify(options.stdio) };
  const result = childSpawn.apply(this, arguments);
  seen.pid = this.pid;
  spawns.push(seen);
  if (afterSpawn && this.pid) afterSpawn(this.pid);
  return result;
};

const { checkWalls, runProgram } = await import("../../src/index.js");
const out = (o) => fs.writeSync(1, JSON.stringify(o));
const alive = (pid) => {
  try {
    processKill.call(process, pid, 0);
    return true;
  } catch {
    return false;
  }
};
const stopIt = (pid) => processKill.call(process, pid, "SIGSTOP");
const killIt = (pid) => processKill.call(process, pid, "SIGKILL");
const catchOf = async (promise) => {
  try {
    return { resolved: await promise };
  } catch (e) {
    return { name: e?.name, isError: e instanceof Error, message: e?.message };
  }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (scenario === "argv") {
  const walls = await checkWalls(probePath);
  const mark = spawns.length;
  const program = await runProgram("1 + 1");
  out({ walls, program, probe: spawns.slice(0, mark), run: spawns.slice(mark), self: process.pid });
} else if (scenario === "stopped") {
  afterSpawn = stopIt;
  const caught = await catchOf(checkWalls(probePath, { timeoutMs: 300 }));
  const pids = spawns.map((s) => s.pid);
  for (let i = 0; i < 100 && pids.some(alive); i++) await wait(20);
  out({ caught, pids, stillAlive: pids.filter(alive), kills, self: process.pid });
} else if (scenario === "ended") {
  afterSpawn = killIt;
  const caught = await catchOf(checkWalls(probePath, { timeoutMs: 20000 }));
  out({ caught, pids: spawns.map((s) => s.pid), kills, self: process.pid });
} else if (scenario === "exit-kills") {
  afterSpawn = stopIt;
  checkWalls(probePath, { timeoutMs: 60000 }).catch(() => {});
  const pid = spawns[0]?.pid;
  await wait(100);
  process.on("exit", () => out({ pid, kills }));
  process.exit(0);
} else if (scenario === "idle-exit") {
  await checkWalls(probePath);
  await checkWalls(probePath);
  await wait(100);
  kills.length = 0;
  process.on("exit", () => out({ killsAtExit: kills }));
  process.exit(0);
} else if (scenario === "signals") {
  const names = Object.keys(os.constants.signals);
  const handlers = [() => {}, () => {}, () => {}, () => {}];
  process.on("SIGTERM", handlers[0]);
  process.on("SIGINT", handlers[1]);
  process.on("SIGHUP", handlers[2]);
  process.on("SIGUSR2", handlers[3]);
  process.on("SIGPIPE", () => {});
  const before = Object.fromEntries(names.map((n) => [n, process.listeners(n)]));
  const exitBefore = process.listenerCount("exit");
  const results = [];
  const exits = [];
  results.push(await checkWalls(probePath));
  exits.push(process.listenerCount("exit"));
  results.push(await checkWalls(probePath));
  exits.push(process.listenerCount("exit"));
  const ran = await runProgram("1 + 1");
  exits.push(process.listenerCount("exit"));
  results.push(await checkWalls(probePath));
  exits.push(process.listenerCount("exit"));
  const changed = names.filter((n) => {
    const now = process.listeners(n);
    return now.length !== before[n].length || now.some((f, i) => f !== before[n][i]);
  });
  out({ results, ran, exitBefore, exits, changed });
} else if (scenario === "silent") {
  let bad = 0;
  const walls = await checkWalls(probePath);
  if (walls.read !== "refused") bad++;
  if ((await catchOf(checkWalls(probePath, { timeoutMs: 1 }))).message !== "the probe did not answer in 1 ms") bad++;
  if ((await catchOf(checkWalls(""))).name !== "TypeError") bad++;
  if ((await catchOf(checkWalls(probePath, { timeoutMs: 0 }))).name !== "TypeError") bad++;
  afterSpawn = killIt;
  if ((await catchOf(checkWalls(probePath))).message !== "the probe ended before it answered") bad++;
  afterSpawn = stopIt;
  if ((await catchOf(checkWalls(probePath, { timeoutMs: 200 }))).message !== "the probe did not answer in 200 ms") bad++;
  process.exitCode = bad;
}
