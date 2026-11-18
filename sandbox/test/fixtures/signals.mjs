// A caller with signal handlers of its own, and one that ignores a signal.
// Prints, as JSON, what runProgram did to the caller's signal and exit listeners.
import os from "node:os";

const names = Object.keys(os.constants.signals);
const h = { term: () => {}, int: () => {}, hup: () => {}, usr2: () => {} };
process.on("SIGTERM", h.term);
process.on("SIGINT", h.int);
process.on("SIGHUP", h.hup);
process.on("SIGUSR2", h.usr2);
process.on("SIGPIPE", () => {});

const before = Object.fromEntries(names.map((n) => [n, process.listeners(n)]));
const exitBefore = process.listenerCount("exit");

const { runProgram } = await import("../../src/index.js");

const results = [];
const run = async (code, opts) => results.push((await runProgram(code, opts)).ok);

await run("1 + 1");
await run("throw new Error('x')");
await run("while (true) {}", { timeoutMs: 200 });
const exitAfterThree = process.listenerCount("exit");
await run("2 + 2");
await run("await new Promise((r) => setTimeout(r, 5)); 3");
const exitAfterFive = process.listenerCount("exit");

const changed = names.filter((n) => {
  const now = process.listeners(n);
  return now.length !== before[n].length || now.some((f, i) => f !== before[n][i]);
});

process.stdout.write(JSON.stringify({ results, changed, exitBefore, exitAfterThree, exitAfterFive }));
