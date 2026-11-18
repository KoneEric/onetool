import { describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runCommand } from "../src/index.js";
import { treeTest, fault, within, quote, sleep, pidsIn, allGone, reap } from "./helpers.js";

const STOPPED = "the command was stopped";

// Runs `body`; whatever it collected of process numbers is killed when it fails, so a failure leaves nothing.
async function guarded(pids, body) {
  try {
    await body();
  } catch (err) {
    for (const list of pids) reap(list);
    throw err;
  }
}

// `$$` is the shell, the subshell holds a `sleep` of its own, and the shell waits:
// three processes of one group, the last two not started by the part itself.
const treeCommand = (pidFile, deepFile) =>
  `( sleep 100 & echo $! > ${quote(deepFile)}; wait ) & echo "$$ $!" > ${quote(pidFile)}; wait`;

describe("a stop sends SIGKILL to the whole group, and everything it held is gone", () => {
  treeTest("an abort of `signal`: `the command was stopped`, and the shell, its child and theirs are gone", async (T) => {
    const pidFile = join(T.root, "pids");
    const deepFile = join(T.root, "deep");
    const seen = [];
    await guarded(seen, async () => {
      const controller = new AbortController();
      const running = runCommand(treeCommand(pidFile, deepFile), { cwd: T.W, signal: controller.signal });
      const settled = running.then(
        () => "resolved",
        (err) => err,
      );
      const [shell, child] = await pidsIn(pidFile, 2);
      const [grandchild] = await pidsIn(deepFile, 1);
      seen.push([shell, child, grandchild]);
      controller.abort();
      const err = await within(settled, 4000, "the aborted command");
      assert.notEqual(err, "resolved");
      await fault(Promise.reject(err), STOPPED);
      await allGone([shell, child, grandchild]);
    });
  });

  treeTest("an abort with a reason is the same fault, without the reason in it", async (T) => {
    const pidFile = join(T.root, "pids");
    const controller = new AbortController();
    const running = runCommand(`echo "$$ $!" > ${quote(pidFile)}; sleep 100`, { cwd: T.W, signal: controller.signal });
    const settled = fault(running, STOPPED);
    const [shell] = await pidsIn(pidFile, 1);
    await guarded([[shell]], async () => {
      controller.abort(new Error("secret reason"));
      await within(settled, 4000, "the aborted command");
      await allGone([shell]);
    });
  });

  treeTest("an output over the limit: the fault, and the shell, its child and theirs are gone", async (T) => {
    const pidFile = join(T.root, "pids");
    const deepFile = join(T.root, "deep");
    const command = `( sleep 100 & echo $! > ${quote(deepFile)}; wait ) & echo "$$ $!" > ${quote(pidFile)}; sleep 0.2; printf 01234567890; wait`;
    const settled = fault(runCommand(command, { cwd: T.W, outputLimit: 10 }), "the output is over 10 bytes");
    const [shell, child] = await pidsIn(pidFile, 2);
    const [grandchild] = await pidsIn(deepFile, 1);
    await guarded([[shell, child, grandchild]], async () => {
      await within(settled, 4000, "the command over the limit");
      await allGone([shell, child, grandchild]);
    });
  });

  treeTest("standard error over the limit stops the group the same way", async (T) => {
    const pidFile = join(T.root, "pids");
    const command = `sleep 100 & echo "$$ $!" > ${quote(pidFile)}; sleep 0.2; printf 01234567890 >&2; wait`;
    const settled = fault(runCommand(command, { cwd: T.W, outputLimit: 10 }), "the output is over 10 bytes");
    const [shell, child] = await pidsIn(pidFile, 2);
    await guarded([[shell, child]], async () => {
      await within(settled, 4000, "the command over the limit");
      await allGone([shell, child]);
    });
  });

  treeTest("a command that never stops writing is stopped at the limit", async (T) => {
    const pidFile = join(T.root, "pids");
    const settled = fault(
      runCommand(`yes & echo "$$ $!" > ${quote(pidFile)}; wait`, { cwd: T.W, outputLimit: 1000 }),
      "the output is over 1000 bytes",
    );
    const [shell, child] = await pidsIn(pidFile, 2);
    await guarded([[shell, child]], async () => {
      await within(settled, 6000, "the flooding command");
      await allGone([shell, child]);
    });
  });
});

describe("nothing a command started outlives it", () => {
  treeTest("a process left in the background (`sleep 100 &`) is gone; the promise resolves with the shell's code", async (T) => {
    const pidFile = join(T.root, "pids");
    const seen = [];
    await guarded(seen, async () => {
      const started = Date.now();
      const got = await within(
        runCommand(`sleep 100 & echo "$$ $!" > ${quote(pidFile)}; echo hello; exit 4`, { cwd: T.W }),
        6000,
        "a command that left a process in the background",
      );
      assert.ok(Date.now() - started < 6000);
      assert.deepEqual(got, { exitCode: 4, stdout: "hello\n", stderr: "" });
      const pids = await pidsIn(pidFile, 2);
      seen.push(pids);
      await allGone(pids);
    });
  });

  treeTest("what was written until then is all there, when the background process holds the pipe", async (T) => {
    const pidFile = join(T.root, "pids");
    const seen = [];
    await guarded(seen, async () => {
      const command = `sleep 100 & echo "$$ $!" > ${quote(pidFile)}; head -c 200000 /dev/zero | tr '\\0' a; echo end >&2`;
      const got = await within(runCommand(command, { cwd: T.W }), 6000, "the command with output and a background process");
      assert.equal(got.exitCode, 0);
      assert.equal(got.stdout.length, 200000);
      assert.equal(got.stderr, "end\n");
      const pids = await pidsIn(pidFile, 2);
      seen.push(pids);
      await allGone(pids);
    });
  });

  treeTest("the same for a process left by a subshell, and by a command that failed", async (T) => {
    const pidFile = join(T.root, "pids");
    const deepFile = join(T.root, "deep");
    const seen = [];
    await guarded(seen, async () => {
      const command = `( sleep 100 & echo $! > ${quote(deepFile)} ) ; echo "$$" > ${quote(pidFile)}; exit 9`;
      const got = await within(runCommand(command, { cwd: T.W }), 6000, "the command with a left subshell");
      assert.equal(got.exitCode, 9);
      const pids = [...(await pidsIn(pidFile, 1)), ...(await pidsIn(deepFile, 1))];
      seen.push(pids);
      await allGone(pids);
    });
  });

  treeTest("a command killed by a signal of its own leaves nothing either", async (T) => {
    const pidFile = join(T.root, "pids");
    const seen = [];
    await guarded(seen, async () => {
      const got = await within(
        runCommand(`sleep 100 & echo "$$ $!" > ${quote(pidFile)}; kill -TERM $$`, { cwd: T.W }),
        6000,
        "the self-killed command",
      );
      assert.equal(got.exitCode, 143);
      const pids = await pidsIn(pidFile, 2);
      seen.push(pids);
      await allGone(pids);
    });
  });

  treeTest("when the promise settles the shell has ended: gone at once after an abort", async (T) => {
    const pidFile = join(T.root, "pids");
    const controller = new AbortController();
    const settled = fault(
      runCommand(`sleep 100 & echo "$$ $!" > ${quote(pidFile)}; wait`, { cwd: T.W, signal: controller.signal }),
      STOPPED,
    );
    const [shell, child] = await pidsIn(pidFile, 2);
    await guarded([[shell, child]], async () => {
      controller.abort();
      await within(settled, 4000, "the aborted command");
      await allGone([shell, child]);
    });
  });
});

describe("an abort that comes late, or twice, or beside another command", () => {
  treeTest("a second abort of the same signal: one result, nothing else happens", async (T) => {
    const pidFile = join(T.root, "pids");
    const controller = new AbortController();
    const settled = fault(
      runCommand(`echo "$$" > ${quote(pidFile)}; sleep 100`, { cwd: T.W, signal: controller.signal }),
      STOPPED,
    );
    const [shell] = await pidsIn(pidFile, 1);
    await guarded([[shell]], async () => {
      controller.abort();
      controller.abort();
      // an abort event once more, by hand, after the command was stopped
      await within(settled, 4000, "the aborted command");
      controller.signal.dispatchEvent(new Event("abort"));
      await allGone([shell]);
      await sleep(100);
    });
  });

  treeTest("an abort after the command ended: nothing happens", async (T) => {
    const controller = new AbortController();
    const got = await within(runCommand("echo done", { cwd: T.W, signal: controller.signal }), 6000, "the command");
    assert.deepEqual(got, { exitCode: 0, stdout: "done\n", stderr: "" });
    controller.abort();
    controller.abort();
    await sleep(100);
    assert.deepEqual(got, { exitCode: 0, stdout: "done\n", stderr: "" });
  });

  treeTest("an abort after a fault of the output: nothing happens", async (T) => {
    const controller = new AbortController();
    await fault(
      runCommand("printf 01234567890", { cwd: T.W, signal: controller.signal, outputLimit: 10 }),
      "the output is over 10 bytes",
    );
    controller.abort();
    await sleep(100);
  });

  treeTest("an abort of a signal that never aborts changes nothing", async (T) => {
    const controller = new AbortController();
    const got = await within(
      runCommand("sleep 0.1; echo ok", { cwd: T.W, signal: controller.signal }),
      6000,
      "the command with a quiet signal",
    );
    assert.deepEqual(got, { exitCode: 0, stdout: "ok\n", stderr: "" });
  });

  treeTest("one command stopped, the other one runs on: they share nothing", async (T) => {
    const pidA = join(T.root, "pidA");
    const pidB = join(T.root, "pidB");
    const stopA = new AbortController();
    const stopB = new AbortController();
    const a = fault(
      runCommand(`sleep 100 & echo "$$ $!" > ${quote(pidA)}; wait`, { cwd: T.W, signal: stopA.signal }),
      STOPPED,
    );
    const b = runCommand(`sleep 100 & echo "$$ $!" > ${quote(pidB)}; sleep 0.6; echo b-done`, {
      cwd: T.X,
      signal: stopB.signal,
    });
    const [shellA, childA] = await pidsIn(pidA, 2);
    const [shellB, childB] = await pidsIn(pidB, 2);
    await guarded([[shellA, childA], [shellB, childB]], async () => {
      stopA.abort();
      await within(a, 4000, "the stopped command");
      await allGone([shellA, childA]);
      assert.deepEqual(await within(b, 6000, "the other command"), { exitCode: 0, stdout: "b-done\n", stderr: "" });
      await allGone([shellB, childB]);
    });
  });

  treeTest("two commands over the limit and one aborted at the same time: each its own result", async (T) => {
    const stop = new AbortController();
    const settled = await Promise.allSettled([
      runCommand("printf 01234567890; sleep 100", { cwd: T.W, outputLimit: 10 }),
      runCommand("sleep 100", { cwd: T.W, signal: stop.signal }),
      runCommand("printf ok", { cwd: T.W }),
    ].map((p) => within(p, 8000, "a command")).concat([
      sleep(150).then(() => stop.abort()).then(() => "aborted"),
    ]));
    assert.equal(settled[0].status, "rejected");
    assert.equal(settled[0].reason.message, "the output is over 10 bytes");
    assert.equal(settled[1].status, "rejected");
    assert.equal(settled[1].reason.message, STOPPED);
    assert.equal(settled[2].status, "fulfilled");
    assert.deepEqual(settled[2].value, { exitCode: 0, stdout: "ok", stderr: "" });
  });
});
