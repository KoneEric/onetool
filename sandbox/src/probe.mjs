// The probe of checkWalls, run in a process started as the process of a program is. argv[2] is the path of a file
// that exists outside sandbox/src. It tries four things the program may not do and writes one line to standard
// output: { read, write, spawn, worker }, each "refused" (ERR_ACCESS_DENIED), "done" or "failed" (anything else).
import fs from "node:fs";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";

const target = process.argv[2];
const cleanup = [];

function attempt(fn) {
  try {
    fn();
    return "done";
  } catch (thrown) {
    return thrown?.code === "ERR_ACCESS_DENIED" ? "refused" : "failed";
  }
}

const walls = {
  read: attempt(() => fs.readFileSync(target)),
  write: attempt(() => fs.writeFileSync(target + ".written", "written by the probe\n")),
  spawn: attempt(() => {
    const child = spawn(process.execPath, ["--version"], { stdio: "ignore" });
    child.on("error", () => {});
    cleanup.push(() => child.kill("SIGKILL"));
  }),
  worker: attempt(() => {
    const worker = new Worker("0", { eval: true });
    worker.on("error", () => {});
    cleanup.push(() => worker.terminate());
  }),
};

for (const stop of cleanup) {
  try {
    stop();
  } catch {
    // nothing to stop
  }
}
process.stdout.write(JSON.stringify(walls) + "\n", () => process.exit(0));
