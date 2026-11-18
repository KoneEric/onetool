// A caller of runProgram with `library`, whose programs call `library.report`, `library.restore` and
// `library.read`, with spies on what it starts and on every signal sent from this process. argv[2] is the
// scenario, argv[3] the path of a probe file (a file outside sandbox/src).
//   argv         the options the processes of a plain program, of one that makes the three calls, and of one with
//                every argument at once are started with; then checkWalls
//   stops        a program that waits in a call of the three stopped by the time limit; one stopped by the abort
//                of a signal; a second abort; a signal already aborted; an abort after a program that ended
//   signals      a caller with signal handlers of its own, and one that ignores a signal, runs programs that wait
//                in the three and are stopped by the limit and by a signal
//   exit-kills   the caller exits while a program waits in a call of the three
//   idle-exit    nothing runs when the caller exits, after programs with the three that were stopped
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const library = [
  { name: "double", params: ["n"], code: "n * 2" },
  { name: "three", params: [], code: "return [await library.report(), await library.restore('s'), await library.read('t')]" },
  { name: "hang", params: [], code: "await library.read('hang')" },
  { name: "spin", params: [], code: "while (true) {}" },
  { name: "throws", params: [], code: "throw new Error('saved threw')" },
];
// A call of the tool `read` with the name `hang` never answers; any other answers at once with its own tool.
const callTool = async (server, tool, args) => (tool === "read" && args?.name === "hang" ? new Promise(() => {}) : [server, tool, args]);
const LIMIT = 10000;
const THREE = "return [await library.report(), await library.restore('a'), await library.read('b')]";
const HANG = "await library.read('hang')";

// Runs `code` with `library` and an AbortController, and aborts it once a process of the program is seen.
async function stoppedByAbort(code = HANG, options = {}) {
  const controller = new AbortController();
  const running = runProgram(code, { library, callTool, timeoutMs: LIMIT, ...options, signal: controller.signal });
  const row = await waitFor(() => childRows()[0], 5000);
  controller.abort();
  return { result: await running, pid: row?.pid, controller };
}

if (scenario === "argv") {
  const plain = await runProgram("1 + 1");
  const mark1 = spawns.length;
  const three = await runProgram(THREE, { library: [], callTool, timeoutMs: LIMIT });
  const mark2 = spawns.length;
  const uses = [];
  const lines = [];
  const controller = new AbortController();
  const all = await runProgram(
    "progress('p'); state.n = await lib.double({ n: 4 }); const r = await $`ls`.text(); return [await tools.s.t2({}), r, await lib.three(), await library.report(), await library.read('z')]",
    {
      library,
      callTool: async (server, tool, args) => (tool === "run" ? { exitCode: 0, stdout: "o\n", stderr: "" } : [server, tool, args]),
      onLibrary: (use) => uses.push(use),
      onProgress: (l) => lines.push(l),
      signal: controller.signal,
      state: { n: 0 },
      shell: true,
      tools: { s: ["t2"] },
      timeoutMs: LIMIT,
    },
  );
  const mark3 = spawns.length;
  const killsBeforeWalls = kills.length;
  const walls = await checkWalls(probePath);
  out({
    results: [plain, three, all],
    spawns: [spawns.slice(0, mark1), spawns.slice(mark1, mark2), spawns.slice(mark2, mark3)],
    probe: spawns.slice(mark3),
    uses,
    lines,
    walls,
    kills: kills.slice(0, killsBeforeWalls),
    self: process.pid,
  });
} else if (scenario === "stops") {
  const timed = await runProgram("await lib.hang({})", { library, callTool, timeoutMs: 400 });
  const aborted = await stoppedByAbort("await lib.hang({})");
  const beforeSecond = kills.length;
  aborted.controller.abort(); // a second abort of the same controller
  await wait(100);
  const afterSecond = kills.length;
  const spawnsBefore = spawns.length;
  const alreadyAborted = await runProgram(THREE, { library, callTool, signal: aborted.controller.signal });
  const spawnsAfter = spawns.length;
  const second = new AbortController();
  const ranToEnd = await runProgram("return await library.restore('late')", { library, callTool, signal: second.signal, timeoutMs: LIMIT });
  const beforeLate = kills.length;
  second.abort(); // after the promise resolved
  await wait(150);
  out({
    timed,
    aborted: aborted.result,
    alreadyAborted,
    ranToEnd,
    pids: spawns.map((s) => s.pid),
    kills,
    beforeSecond,
    afterSecond,
    spawnsBefore,
    spawnsAfter,
    beforeLate,
    afterLate: kills.length,
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
  results.push(await runProgram(HANG, { library, callTool, timeoutMs: 300 }));
  exits.push(process.listenerCount("exit"));
  results.push((await stoppedByAbort(HANG)).result);
  exits.push(process.listenerCount("exit"));
  results.push(await runProgram(THREE, { library, callTool, timeoutMs: LIMIT }));
  exits.push(process.listenerCount("exit"));
  results.push(await runProgram(THREE, { library, callTool, signal: AbortSignal.abort() }));
  exits.push(process.listenerCount("exit"));
  const changed = names.filter((n) => {
    const now = process.listeners(n);
    return now.length !== before[n].length || now.some((f, i) => f !== before[n][i]);
  });
  out({ results, exitBefore, exits, changed });
} else if (scenario === "exit-kills") {
  runProgram(HANG, { library, callTool, timeoutMs: 60000 }).catch(() => {});
  const pid = await waitFor(() => childRows()[0]?.pid, 5000);
  process.on("exit", () => out({ pid, kills }));
  process.exit(0);
} else if (scenario === "idle-exit") {
  await stoppedByAbort();
  await runProgram(HANG, { library, callTool, timeoutMs: 300 });
  await runProgram(THREE, { library, callTool, timeoutMs: LIMIT });
  await wait(200);
  kills.length = 0;
  process.on("exit", () => out({ killsAtExit: kills }));
  process.exit(0);
} else if (scenario === "silent") {
  let bad = 0;
  const rejecting = async () => {
    throw new Error("the caller's callTool rejects");
  };
  const first = await runProgram(`console.log('program says'); ${THREE}`, { library, callTool, timeoutMs: LIMIT });
  if (first.ok !== true) bad++;
  const refused = await runProgram("try { await library.report() } catch (e) { return e.message }", { library, callTool: rejecting, timeoutMs: LIMIT });
  if (refused.value !== "the caller's callTool rejects") bad++;
  if ((await stoppedByAbort()).result.error?.kind !== "stopped") bad++;
  const failed = await runProgram("await library.restore('x')", { library, callTool: rejecting, timeoutMs: LIMIT });
  if (failed.error?.kind !== "error") bad++;
  const timed = await runProgram(HANG, { library, callTool, timeoutMs: 300 });
  if (timed.error?.kind !== "timeout") bad++;
  const cyclic = await runProgram("const c = {}; c.self = c; try { await library.read(c) } catch (e) { return e.message }", { library, callTool, timeoutMs: LIMIT });
  if (cyclic.value !== "the arguments cannot be sent as JSON") bad++;
  process.exitCode = bad;
}
