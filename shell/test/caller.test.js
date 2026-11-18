import { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { treeTest, inChild, pidsIn, allGone, reap } from "./helpers.js";

// These tests run the part inside a process of their own, so that what it does to its caller can be seen:
// the listeners it adds, the signals it sends, what it prints, and what becomes of a command when the
// caller ends. The child writes its result to a file; nothing is printed by it.

describe("what the part does to its caller", () => {
  treeTest("no signal handler is installed; one `exit` listener, once however many commands are run", async (T) => {
    const got = inChild(
      T.root,
      `
const { constants } = await import("node:os");
const names = Object.keys(constants.signals);
const counts = () => Object.fromEntries(names.map((n) => [n, process.listenerCount(n)]));
const own = () => {};
// a caller with handlers of its own, and one that ignores a signal
process.on("SIGTERM", own);
process.on("SIGINT", own);
process.on("SIGHUP", () => {});
const eventsBefore = process.eventNames().map(String);
const signalsBefore = counts();
const exitBefore = process.listenerCount("exit");
const m = await import(args.src);
const exitAfterImport = process.listenerCount("exit");
const done = [];
for (let i = 0; i < 3; i++) {
  await m.runCommand("echo " + i, { cwd: args.cwd });
  done.push(process.listenerCount("exit"));
}
const controller = new AbortController();
const pending = m.runCommand("sleep 100", { cwd: args.cwd, signal: controller.signal });
await new Promise((r) => setTimeout(r, 100));
controller.abort();
await pending.catch(() => {});
await m.runCommand("printf 0123456789AB", { cwd: args.cwd, outputLimit: 10 }).catch(() => {});
return {
  exitBefore,
  exitAfterImport,
  done,
  exitFinal: process.listenerCount("exit"),
  signalsBefore,
  signalsAfter: counts(),
  ownStillThere: process.listeners("SIGTERM").length === 1 && process.listeners("SIGTERM")[0] === own &&
    process.listeners("SIGINT").length === 1 && process.listeners("SIGINT")[0] === own,
  newEvents: process.eventNames().map(String).filter((n) => !eventsBefore.includes(n)),
};
`,
      { cwd: T.W },
    );
    assert.equal(got.status, 0, got.stderr);
    const r = got.result;
    assert.ok(r, "the child did not finish");
    assert.deepEqual(r.signalsAfter, r.signalsBefore);
    assert.equal(r.ownStillThere, true);
    // one listener at most, added once: the count does not move with the commands run
    assert.ok(r.exitFinal - r.exitBefore <= 1, `exit listeners ${r.exitBefore} -> ${r.exitFinal}`);
    assert.deepEqual([...new Set(r.done)].length <= 1, true, `exit listeners after each run: ${r.done}`);
    assert.equal(r.done[2], r.exitFinal);
    assert.ok(r.done[0] >= r.exitAfterImport);
    assert.ok(r.newEvents.every((n) => n === "exit"), `new events on process: ${r.newEvents}`);
  });

  treeTest("the only signal sent is SIGKILL, to a group the part started; nothing is sent when nothing runs", async (T) => {
    const got = inChild(
      T.root,
      `
const { readFileSync, existsSync } = await import("node:fs");
const m = await import(args.src);
const calls = [];
const realKill = process.kill;
process.kill = function (...a) {
  calls.push(a.map(String));
  return realKill.apply(process, a);
};
const waitFile = async (f) => {
  for (let i = 0; i < 200 && !existsSync(f); i++) await new Promise((r) => setTimeout(r, 20));
  return Number(readFileSync(f, "utf8").trim());
};
const shells = [];
const q = (s) => "'" + s + "'";
const f1 = args.dir + "/p1", f2 = args.dir + "/p2", f3 = args.dir + "/p3", f5 = args.dir + "/p5";

// a command that ends by itself, and leaves a process behind
await m.runCommand("echo $$ > " + q(f1) + "; sleep 100 &", { cwd: args.cwd });
shells.push(await waitFile(f1));
// an abort
const c2 = new AbortController();
const p2 = m.runCommand("echo $$ > " + q(f2) + "; sleep 100", { cwd: args.cwd, signal: c2.signal });
const s2 = await waitFile(f2);
c2.abort();
await p2.catch(() => {});
shells.push(s2);
// an output over the limit
const p3 = m.runCommand("echo $$ > " + q(f3) + "; printf 0123456789AB; sleep 100", { cwd: args.cwd, outputLimit: 10 });
await p3.catch(() => {});
shells.push(await waitFile(f3));
// a signal already aborted
const c4 = new AbortController();
c4.abort();
await m.runCommand("echo hi", { cwd: args.cwd, signal: c4.signal }).catch(() => {});

const before = calls.length;
// nothing runs now: an abort again
c2.signal.dispatchEvent(new Event("abort"));
c4.signal.dispatchEvent(new Event("abort"));
const afterDispatch = calls.length;
const c5 = new AbortController();
await m.runCommand("echo $$ > " + q(f5) + "; echo done", { cwd: args.cwd, signal: c5.signal });
shells.push(await waitFile(f5));
const afterRun = calls.length;
c5.abort();
await new Promise((r) => setTimeout(r, 50));
process.emit("exit", 0);
await new Promise((r) => setTimeout(r, 50));
return { calls, before, afterDispatch, afterRun, after: calls.length, shells };
`,
      { cwd: T.W, dir: T.root },
    );
    assert.equal(got.status, 0, got.stderr);
    const r = got.result;
    assert.ok(r, "the child did not finish");
    for (const call of r.calls) {
      const [pid, signal] = call;
      assert.ok(Number(pid) < 0, `a signal to ${pid}: it must go to a group, as -pid`);
      assert.ok(signal === "SIGKILL" || signal === "9", `the signal ${signal} is not SIGKILL`);
      assert.ok(r.shells.includes(-Number(pid)), `the group ${pid} is not one of the commands started`);
    }
    // the last command ended by itself and its group was sent SIGKILL; after that, nothing more
    assert.equal(r.afterDispatch, r.before, "a second abort sent a signal");
    assert.equal(r.after, r.afterRun, "an abort after the end, or the exit event with nothing running, sent a signal");
    await allGone(r.shells);
  });

  treeTest("nothing is printed, on standard output or standard error, by any function", async (T) => {
    const got = inChild(
      T.root,
      `
const m = await import(args.src);
const folders = [args.W, args.X];
const swallow = (p) => p.then(() => "ok", (e) => e.name);
const results = [];
results.push(await swallow(m.runCommand("echo out; echo err >&2", { cwd: args.W })));
results.push(await swallow(m.runCommand("echo out; echo err >&2; exit 2", { cwd: args.W })));
results.push(await swallow(m.runCommand("printf 0123456789AB", { cwd: args.W, outputLimit: 10 })));
results.push(await swallow(m.runCommand("", { cwd: args.W })));
results.push(await swallow(m.runCommand("echo hi", { cwd: args.W + "/no-such" })));
const c = new AbortController();
const p = swallow(m.runCommand("sleep 100", { cwd: args.W, signal: c.signal }));
await new Promise((r) => setTimeout(r, 100));
c.abort();
results.push(await p);
results.push(await swallow(m.readFile("a.txt", { folders })));
results.push(await swallow(m.readFile("nope.txt", { folders })));
results.push(await swallow(m.readFile("../x", { folders })));
results.push(await swallow(m.writeFile("w.txt", "x", { folders })));
results.push(await swallow(m.writeFile("nodir/w.txt", "x", { folders })));
results.push(await swallow(m.editFile("w.txt", "x", "y", { folders })));
results.push(await swallow(m.editFile("w.txt", "zzz", "y", { folders })));
results.push(await swallow(m.realPlace("a.txt", folders)));
results.push(await swallow(m.realPlace("", folders)));
results.push(await swallow(m.missingFolders([args.W, args.W + "/gone"])));
return results;
`,
      { W: T.W, X: T.X, cwd: T.W },
    );
    assert.equal(got.status, 0, got.stderr);
    assert.equal(got.stdout, "");
    assert.equal(got.stderr, "");
    assert.deepEqual(got.result, [
      "ok",
      "ok",
      "ShellError",
      "ShellError",
      "ShellError",
      "ShellError",
      "ok",
      "ShellError",
      "ShellError",
      "ok",
      "ShellError",
      "ok",
      "ShellError",
      "ok",
      "ShellError",
      "ok",
    ]);
  });
});

describe("the caller ends: the `exit` listener stops the commands still running", () => {
  treeTest("a caller that exits while commands run leaves none of their processes", async (T) => {
    const f1 = join(T.root, "p1");
    const f2 = join(T.root, "p2");
    const f2b = join(T.root, "p2b");
    const seen = [];
    const got = inChild(
      T.root,
      `
const { existsSync } = await import("node:fs");
const m = await import(args.src);
const q = (s) => "'" + s + "'";
// a caller that ignores the signals a terminal sends; it leaves by its own choice
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
m.runCommand("sleep 100 & echo \\"$$ $!\\" > " + q(args.f1) + "; wait", { cwd: args.cwd }).catch(() => {});
m.runCommand("( sleep 100 & echo \\"$!\\" > " + q(args.f2) + "; wait ) & echo \\"$$ $!\\" > " + q(args.f2b) + "; wait", { cwd: args.cwd }).catch(() => {});
for (let i = 0; i < 300 && !(existsSync(args.f1) && existsSync(args.f2) && existsSync(args.f2b)); i++) await new Promise((r) => setTimeout(r, 20));
await new Promise((r) => setTimeout(r, 200));
process.exit(0);
`,
      { cwd: T.W, f1, f2, f2b },
    );
    try {
      assert.equal(got.status, 0, got.stderr);
      const first = await pidsIn(f1, 2);
      const second = [...(await pidsIn(f2, 1)), ...(await pidsIn(f2b, 2))];
      seen.push(first, second);
      await allGone([...first, ...second]);
    } catch (err) {
      for (const list of seen) reap(list);
      throw err;
    }
  });

  treeTest("a caller that ends with nothing running: the listener does nothing", async (T) => {
    const mark = join(T.root, "mark.json");
    const got = inChild(
      T.root,
      `
const m = await import(args.src);
const calls = [];
const realKill = process.kill;
process.kill = function (...a) {
  calls.push(a.map(String));
  return realKill.apply(process, a);
};
await m.runCommand("echo done", { cwd: args.cwd });
const afterRun = calls.length;
process.on("exit", () => {
  writeFileSync(args.mark, JSON.stringify({ afterRun, atExit: calls.length }));
});
return { afterRun };
`,
      { cwd: T.W, mark },
    );
    assert.equal(got.status, 0, got.stderr);
    const exitMark = JSON.parse(readFileSync(mark, "utf8"));
    assert.equal(exitMark.atExit, exitMark.afterRun);
  });
});
