// Step 6: "Jobs, the end, signals and time limits" (the meeting point of server): jobs end when onetool ends, and onetool does not wait
// for a job. The end is the one of "End, and signals": exit code 0 within 5 seconds, and what onetool started is gone.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childrenOf, fakeEntry, practiceEntry, settingsOf, tmpPath, waitFor, withRaw, alive } from "./helpers.js";
import { WAITING_COMMAND, pidsIn, shellSettings, workFolder } from "./shellhelpers.js";
import { HANG, goneWithin, jobsOf, reap, viaRaw } from "./jobhelpers.js";

const ENDS = [
  ["standard input closes", (raw) => raw.child.stdin.end()],
  ["SIGINT", (raw) => raw.child.kill("SIGINT")],
  ["SIGTERM", (raw) => raw.child.kill("SIGTERM")],
];
const MARKED = `await tools.fake.mark({}); ${HANG}`;

/** Starts onetool, waits until the listed servers are connected, and gives `{ raw, jobs }`. */
async function connected(raw) {
  await raw.initialize();
  const res = await raw.callTool("search", {});
  assert.equal(res.result.content[0].text.includes("not connected"), false);
  return jobsOf(viaRaw(raw));
}

const SETTINGS = (markFile) =>
  settingsOf({ fake: fakeEntry({ markFile }), practice: practiceEntry() }, { timeoutSeconds: 60, backgroundSeconds: 600, maxJobs: 3 });

async function allGone(pids) {
  await waitFor(() => pids.every((pid) => !alive(pid)), 2000, "the processes onetool started to end");
}

describe("jobs end when onetool ends", () => {
  for (const [what, end] of ENDS) {
    test(`${what} while jobs run: exit code 0 within 5 seconds, no process of onetool is left`, async () => {
      const markFile = tmpPath("mark");
      await withRaw(SETTINGS(markFile), async (raw) => {
        const jobs = await connected(raw);
        assert.match((await jobs.start(MARKED)).text, /^Job j1 started/);
        assert.match((await jobs.start("await tools.fake.barrier({})")).text, /^Job j2 started/);
        await waitFor(() => existsSync(markFile), 5000, "the job to run");
        const started = childrenOf(raw.child.pid);
        assert.ok(started.length >= 4, `the two servers and the two programs run: ${started.length}`);
        end(raw);
        assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
        await allGone(started);
      });
    });
  }

  for (const [what, end] of ENDS) {
    test(`${what} while a job's command runs: exit code 0 within 5 seconds, the command and its child are gone within 2 seconds after`, async () => {
      const { W } = workFolder();
      let pids;
      try {
        await withRaw(shellSettings([W], { onetool: { backgroundSeconds: 600 } }), async (raw) => {
          await raw.initialize();
          const jobs = jobsOf(viaRaw(raw));
          assert.match((await jobs.start(`await $(${JSON.stringify(WAITING_COMMAND)})`)).text, /^Job j1 started/);
          pids = await waitFor(() => (existsSync(join(W, "pids")) ? pidsIn(readFileSync(join(W, "pids"), "utf8")) : null), 5000, "the command");
          end(raw);
          assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
          await goneWithin(pids, 2000);
        });
      } finally {
        reap(pids);
      }
    });
  }

  test("a second signal while it is ending: the process is gone within 5 seconds", async () => {
    const markFile = tmpPath("mark");
    await withRaw(SETTINGS(markFile), async (raw) => {
      const jobs = await connected(raw);
      await jobs.start(MARKED);
      await waitFor(() => existsSync(markFile), 5000, "the job to run");
      const started = childrenOf(raw.child.pid);
      raw.child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 30));
      raw.child.kill("SIGTERM");
      await raw.within(5000);
      await allGone(started);
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${signal} when jobs were started and have ended, and none runs: exit code 0 within 5 seconds`, async () => {
      await withRaw(SETTINGS(tmpPath("mark")), async (raw) => {
        const jobs = await connected(raw);
        assert.match((await jobs.start("1")).text, /^Job j1 started/);
        await jobs.untilEnded("j1");
        assert.match((await jobs.start("throw new Error('x')")).text, /^Job j2 started/);
        await jobs.untilEnded("j2");
        assert.deepEqual(await raw.endBy(signal, 5000), { code: 0, signal: null });
      });
    });
  }

  test("a job's program stopped on request leaves no process, and onetool goes on", async () => {
    const markFile = tmpPath("mark");
    await withRaw(SETTINGS(markFile), async (raw) => {
      const jobs = await connected(raw);
      const servers = childrenOf(raw.child.pid);
      await jobs.start(MARKED);
      await waitFor(() => existsSync(markFile), 5000, "the job to run");
      const program = childrenOf(raw.child.pid).filter((pid) => !servers.includes(pid));
      assert.equal(program.length, 1, "one process for the program");
      await jobs.stop("j1");
      await goneWithin(program, 2000);
      assert.deepEqual(await jobs.send({ code: "1 + 1" }), { text: "2", isError: false });
    });
  });
});
