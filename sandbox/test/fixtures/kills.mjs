// Spies on every signal sent from this process. Scenario in argv[2]:
//   timeout    a program stopped at the limit
//   idle-exit  nothing runs when the process exits
//   exit-kills the process exits while a program runs
import fs from "node:fs";
import { ChildProcess } from "node:child_process";
import { childRows, waitFor } from "../helpers.js";

const kills = [];
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

const { runProgram } = await import("../../src/index.js");
const scenario = process.argv[2];
const out = (o) => fs.writeSync(1, JSON.stringify(o));

if (scenario === "timeout") {
  const seen = new Set();
  const poll = setInterval(() => childRows().forEach((r) => seen.add(r.pid)), 10);
  const result = await runProgram("while (true) {}", { timeoutMs: 300 });
  clearInterval(poll);
  out({ result, children: [...seen], kills, self: process.pid });
} else if (scenario === "idle-exit") {
  await runProgram("1 + 1");
  await runProgram("throw new Error('x')");
  await new Promise((r) => setTimeout(r, 200));
  kills.length = 0;
  process.on("exit", () => out({ killsAtExit: kills }));
  process.exit(0);
} else if (scenario === "exit-kills") {
  runProgram("while (true) {}", { timeoutMs: 60000 }).catch(() => {});
  const pid = await waitFor(() => childRows()[0]?.pid, 5000);
  process.on("exit", () => out({ pid, kills }));
  process.exit(0);
}
