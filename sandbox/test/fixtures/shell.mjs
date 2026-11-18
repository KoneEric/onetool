// A caller of runProgram with `shell: true`, with spies on what it starts and on every signal sent from this
// process. argv[2] is the scenario, argv[3] the path of a probe file (a file that exists outside sandbox/src).
//   argv         the options the processes of three programs are started with: one without `shell`, one with
//                `shell: true` that makes no call, one with `shell: true` that makes all four kinds of call
//   signals      a caller with signal handlers of its own, and one that ignores a signal
//   timeout      a program that waits for the answer of a call of `$` is stopped at the limit
//   exit-kills   the caller exits while a program waits for the answer of a call
//   idle-exit    nothing runs when the caller exits; the values of the two programs it ran are given
//   silent       the caller writes nothing, whatever happens to the programs
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
const never = () => new Promise(() => {});
const answer = async (server, tool) => (tool === "run" ? { exitCode: 0, stdout: "out\n", stderr: "" } : "ok:" + tool);

const FOUR = [
  'const a = await read("p");',
  'const b = await write("p", "t");',
  'const c = await edit("p", "o", "n");',
  "const d = await $`ls`.text();",
  "console.log(a, b, c, d);",
  "return [a, b, c, d]",
].join("\n");

if (scenario === "argv") {
  const plain = await runProgram("1 + 1", { callTool: answer });
  const mark1 = spawns.length;
  const quiet = await runProgram("1 + 1", { shell: true, callTool: answer });
  const mark2 = spawns.length;
  const four = await runProgram(FOUR, { shell: true, callTool: answer });
  const mark3 = spawns.length;
  const killsBeforeWalls = kills.length;
  const walls = await checkWalls(probePath);
  out({
    results: [plain, quiet, four],
    spawns: [spawns.slice(0, mark1), spawns.slice(mark1, mark2), spawns.slice(mark2, mark3)],
    walls,
    kills: kills.slice(0, killsBeforeWalls),
    self: process.pid,
  });
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
  const run = async (code, options) => {
    results.push((await runProgram(code, { shell: true, callTool: answer, ...options })).ok);
    exits.push(process.listenerCount("exit"));
  };
  await run(FOUR);
  await run("await $`false`.nothrow()");
  await run("await $`ls`", { callTool: never, timeoutMs: 200 });
  await run("await read('p')");
  const changed = names.filter((n) => {
    const now = process.listeners(n);
    return now.length !== before[n].length || now.some((f, i) => f !== before[n][i]);
  });
  out({ results, changed, exitBefore, exits });
} else if (scenario === "timeout") {
  const seen = new Set();
  const poll = setInterval(() => childRows().forEach((r) => seen.add(r.pid)), 10);
  let called = 0;
  const callTool = () => {
    called++;
    return never();
  };
  const result = await runProgram("await $`sleep 100`", { shell: true, callTool, timeoutMs: 300 });
  clearInterval(poll);
  out({ result, called, children: [...seen], kills, self: process.pid });
} else if (scenario === "exit-kills") {
  let called = 0;
  const callTool = () => {
    called++;
    return never();
  };
  runProgram("await read('p')", { shell: true, callTool, timeoutMs: 60000 }).catch(() => {});
  const pid = await waitFor(() => childRows()[0]?.pid, 5000);
  await waitFor(() => called > 0, 3000);
  process.on("exit", () => out({ pid, called, kills }));
  process.exit(0);
} else if (scenario === "idle-exit") {
  const first = await runProgram(FOUR, { shell: true, callTool: answer });
  const second = await runProgram("await $`false`", { shell: true, callTool: async () => ({ exitCode: 1, stdout: "", stderr: "no" }) });
  await new Promise((r) => setTimeout(r, 200));
  kills.length = 0;
  process.on("exit", () => out({ values: [first.value, second.error?.message], killsAtExit: kills }));
  process.exit(0);
} else if (scenario === "silent") {
  const callTool = async (server, tool, args) => {
    if (tool === "run" && args.command === "fail") return { exitCode: 3, stdout: "o", stderr: "e" };
    if (args.path === "reject") throw new Error("tool failed");
    return answer(server, tool);
  };
  const go = (code, options) => runProgram(code, { shell: true, callTool, ...options });
  if (!(await go(FOUR)).ok) process.exitCode = 1;
  await go("console.log('x'); console.error('y'); await $`fail`");
  await go("await read('reject')");
  await go("await $`fail`.nothrow().text()");
  await go("$(5)");
  await go("$`x ${null}`");
  await go("let = = 1");
  await go("await $`sleep 100`", { callTool: never, timeoutMs: 200 });
  await go("write('p', 't'); edit('p', 'o', 'n'); 1");
  await go("return 1n");
  if (process.exitCode === undefined) process.exitCode = 0;
}
