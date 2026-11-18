import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { alive, childrenOf, fakeEntry, practiceEntry, settingsOf, tmpPath, waitFor, withRaw } from "./helpers.js";

// The processes onetool started (the listed servers, the programs) are gone a little after it is.
async function allGone(pids) {
  await waitFor(() => pids.every((pid) => !alive(pid)), 4000, "the processes onetool started to end");
}

/** Starts onetool in front of the fake and practice servers, and waits until the servers are connected. */
async function connected(raw) {
  await raw.initialize();
  const res = await raw.callTool("search", {});
  assert.equal(res.result.content[0].text.includes("not connected"), false);
}

const IDLE = () => settingsOf({ fake: fakeEntry(), practice: practiceEntry() }, { timeoutSeconds: 60 });

describe("the end when nothing runs", () => {
  test("standard input closes: the connections close, the servers end, exit code 0 within 5 seconds", async () => {
    await withRaw(IDLE(), async (raw) => {
      await connected(raw);
      const started = childrenOf(raw.child.pid);
      assert.ok(started.length >= 2, "the two servers run");
      raw.child.stdin.end();
      const ended = await raw.within(5000);
      assert.deepEqual(ended, { code: 0, signal: null });
      await allGone(started);
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${signal}: the same end, exit code 0 within 5 seconds`, async () => {
      await withRaw(IDLE(), async (raw) => {
        await connected(raw);
        const started = childrenOf(raw.child.pid);
        assert.ok(started.length >= 2, "the two servers run");
        const ended = await raw.endBy(signal, 5000);
        assert.deepEqual(ended, { code: 0, signal: null });
        await allGone(started);
      });
    });
  }
});

describe("the end before the listed servers are connected", () => {
  const PENDING = () => {
    const pidFile = tmpPath("pid");
    return {
      pidFile,
      settings: settingsOf({ hang: fakeEntry({ listHang: true, pidFile }) }, { connectSeconds: 30 }),
    };
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${signal}: exit code 0 within 5 seconds, and the pending server's process ends`, async () => {
      const { pidFile, settings } = PENDING();
      await withRaw(settings, async (raw) => {
        await raw.initialize();
        await waitFor(() => existsSync(pidFile), 3000, "the server to start");
        const started = childrenOf(raw.child.pid);
        const ended = await raw.endBy(signal, 5000);
        assert.deepEqual(ended, { code: 0, signal: null });
        await allGone(started);
      });
    });
  }

  test("standard input closes: exit code 0 within 5 seconds", async () => {
    const { pidFile, settings } = PENDING();
    await withRaw(settings, async (raw) => {
      await raw.initialize();
      await waitFor(() => existsSync(pidFile), 3000, "the server to start");
      const started = childrenOf(raw.child.pid);
      raw.child.stdin.end();
      assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
      await allGone(started);
    });
  });
});

describe("the end while programs run", () => {
  const PROGRAMS = {
    "a program that waits on a promise": "await tools.fake.mark({}); await new Promise(() => {})",
    "a program in an endless loop": "await tools.fake.mark({}); while (true) {}",
  };

  /** Starts a program, waits until it has called the server (so it runs), and gives the processes then alive. */
  async function startRunning(raw, markFile, code) {
    await connected(raw);
    raw.send({ id: 900, method: "tools/call", params: { name: "run", arguments: { code } } });
    await waitFor(() => existsSync(markFile), 5000, "the program to run");
    const started = childrenOf(raw.child.pid);
    assert.ok(started.length >= 3, "the two servers and the program's process run");
    return started;
  }

  const SETTINGS = (markFile) =>
    settingsOf({ fake: fakeEntry({ markFile }), practice: practiceEntry() }, { timeoutSeconds: 60 });

  for (const [what, code] of Object.entries(PROGRAMS)) {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      test(`${signal} with ${what}: exit code 0 within 5 seconds, no process of onetool is left`, async () => {
        const markFile = tmpPath("mark");
        await withRaw(SETTINGS(markFile), async (raw) => {
          const started = await startRunning(raw, markFile, code);
          const ended = await raw.endBy(signal, 5000);
          assert.deepEqual(ended, { code: 0, signal: null });
          await allGone(started);
        });
      });
    }
  }

  test("standard input closes with a program running: exit code 0 within 5 seconds, no process is left", async () => {
    const markFile = tmpPath("mark");
    await withRaw(SETTINGS(markFile), async (raw) => {
      const started = await startRunning(raw, markFile, PROGRAMS["a program in an endless loop"]);
      raw.child.stdin.end();
      assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
      await allGone(started);
    });
  });

  test("a second signal while it is ending: the process is gone within 5 seconds", async () => {
    const markFile = tmpPath("mark");
    await withRaw(SETTINGS(markFile), async (raw) => {
      const started = await startRunning(raw, markFile, PROGRAMS["a program in an endless loop"]);
      raw.child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 30));
      raw.child.kill("SIGTERM");
      await raw.within(5000);
      await allGone(started);
    });
  });
});
