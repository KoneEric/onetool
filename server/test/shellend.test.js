// Step 4: "Commands, the time limit and the end" (the meeting point of server, "Step 4: the built-in server `shell`"). A command is
// stopped with everything it started when its program is stopped or ends, and when onetool ends. The command of these
// tests starts a child, writes the two process numbers to a file of the first folder and waits.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { alive, sleep, waitFor, withOnetool, withRaw } from "./helpers.js";
import { WAITING_COMMAND, pidsIn, ran, shellSettings, workFolder } from "./shellhelpers.js";

const PROGRAM = `await $(${JSON.stringify(WAITING_COMMAND)})`;

/** The two process numbers in the file `pids` of `W`, once it holds them. */
async function pidsOf(W) {
  return waitFor(() => (existsSync(join(W, "pids")) ? pidsIn(readFileSync(join(W, "pids"), "utf8")) : null), 5000, "the command to write its process numbers");
}

/** Neither process is there, within `ms` milliseconds. */
async function goneWithin(pids, ms) {
  await waitFor(() => pids.every((pid) => !alive(pid)), ms, `the processes ${pids.join(" and ")} to be gone`);
}

/** The processes of a test are ended whatever happens. */
function reap(pids) {
  for (const pid of pids ?? []) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

describe("a command still running when its program ends", () => {
  test("the program is stopped at the time limit: the answer is the usual one, and the command and its child are gone", async () => {
    const { W } = workFolder();
    let pids;
    try {
      await withOnetool(shellSettings([W], { onetool: { timeoutSeconds: 2 } }), async (ctx) => {
        const answer = await ran(ctx, PROGRAM);
        assert.deepEqual(answer, { text: "The program was stopped after 2 seconds.", isError: true });
        pids = await pidsOf(W);
        assert.equal(pids.length, 2);
        assert.notEqual(pids[0], pids[1]);
        // within 2 seconds after the answer, neither process is there
        await goneWithin(pids, 2000);
      });
    } finally {
      reap(pids);
    }
  });

  test("a program that ends by itself while a command it did not await still runs: the same", async () => {
    const { W } = workFolder();
    let pids;
    try {
      await withOnetool(shellSettings([W], { onetool: { timeoutSeconds: 30 } }), async (ctx) => {
        // the program starts the command, waits until it has written its numbers, and ends without awaiting it
        const code = [
          `const running = $(${JSON.stringify(WAITING_COMMAND)}).text();`,
          "for (;;) {",
          '  try { await read("pids"); break; } catch (e) {}',
          "}",
          'return "done";',
        ].join("\n");
        assert.deepEqual(await ran(ctx, code), { text: "done", isError: false });
        pids = await pidsOf(W);
        await goneWithin(pids, 2000);
      });
    } finally {
      reap(pids);
    }
  });

  test("the shell is on and a command is stopped: onetool goes on and answers the next call", async () => {
    const { W } = workFolder();
    let pids;
    try {
      await withOnetool(shellSettings([W], { onetool: { timeoutSeconds: 2 } }), async (ctx) => {
        assert.equal((await ran(ctx, PROGRAM)).text, "The program was stopped after 2 seconds.");
        pids = await pidsOf(W);
        assert.deepEqual(await ran(ctx, "await $`echo again`.text()"), { text: "again\n", isError: false });
      });
    } finally {
      reap(pids);
    }
  });
});

describe("onetool ends while a command runs", () => {
  const ENDS = [
    ["standard input closes", (raw) => raw.child.stdin.end()],
    ["SIGINT", (raw) => raw.child.kill("SIGINT")],
    ["SIGTERM", (raw) => raw.child.kill("SIGTERM")],
  ];
  for (const [what, end] of ENDS) {
    test(`${what}: exit code 0 within 5 seconds, and the command and its child are gone`, async () => {
      const { W } = workFolder();
      let pids;
      try {
        await withRaw(shellSettings([W], { onetool: { timeoutSeconds: 60 } }), async (raw) => {
          await raw.initialize();
          const pending = raw.callTool("run", { code: PROGRAM }, 30000).catch(() => undefined);
          pids = await pidsOf(W);
          end(raw);
          assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
          await goneWithin(pids, 4000);
          await pending;
        });
      } finally {
        reap(pids);
      }
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${signal} when no program and no command runs: exit code 0 within 5 seconds`, async () => {
      const { W } = workFolder();
      await withRaw(shellSettings([W]), async (raw) => {
        await raw.initialize();
        await raw.callTool("search", {});
        assert.deepEqual(await raw.endBy(signal, 5000), { code: 0, signal: null });
      });
    });
  }

  test("standard input closes after commands ended by themselves: exit code 0 within 5 seconds", async () => {
    const { W } = workFolder();
    await withRaw(shellSettings([W]), async (raw) => {
      await raw.initialize();
      const res = await raw.callTool("run", { code: "await $`echo hi`.text()" });
      assert.equal(res.result.content[0].text, "hi\n");
      await sleep(50);
      raw.child.stdin.end();
      assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
    });
  });
});
