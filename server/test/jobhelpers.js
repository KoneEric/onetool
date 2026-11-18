// Helpers of the tests of step 6 (the meeting point of server, "Step 6: programs in the background"): the texts that part `core` fixes
// ("Step 6: the texts of a job"), and a small client of the tool `run` for jobs, whatever speaks to onetool.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { alive, fakeEntry, practiceEntry, settingsOf, sleep, textOf, waitFor } from "./helpers.js";

// the meeting point of core, "`jobStarted(id)`, `jobLimitMessage(maxJobs)`, `noJobMessage(id)`"
export const jobStarted = (id) => `Job ${id} started. Its state: run({ job: "${id}" }). To stop it: run({ job: "${id}", stop: true }).`;
export const jobLimit = (maxJobs) =>
  `onetool: the job was not started: no more than ${maxJobs} jobs may run at once (onetool.maxJobs). Wait for one to end, or stop one.`;
export const noJob = (id) => `onetool: no job ${id} in this session. run({ jobs: true }) lists them.`;
// the meeting point of core, "`formatJobs`" and "`formatRun` and the kind `stopped`"
export const NO_JOBS = "No job in this session.";
export const STOPPED_ON_REQUEST = "The program was stopped on request.";
export const SEVERAL = 'onetool: run takes one of "code", "job" and "jobs", not several';
export const NEEDS_CODE = 'onetool: run needs "code", a text';

/** A program that never ends by itself. */
export const HANG = "await new Promise(() => {})";

export const firstLine = (text) => text.split("\n")[0];
/** The first line of a job that is `state`, as a pattern: `job <id>: <state>, <n> s`. */
export const headOf = (id, state) => new RegExp(`^job ${id}: ${state}, \\d+ s$`);
/** The line of a list for a job: `<id>: <state>, <n> s`. */
export const listLine = (id, state) => new RegExp(`^${id}: ${state}, \\d+ s$`);

/** What `run` answers, as { text, isError }, through the `ctx` of `withOnetool`. */
export function viaCtx(ctx) {
  return async (args) => {
    const result = await ctx.call("run", args);
    return { text: textOf(result), isError: result.isError === true };
  };
}

/** The same through a host program of askhost.js. */
export function viaHost(host) {
  return (args) => host.call("run", args);
}

/** The same through a raw onetool of helpers.js (`rawOnetool`). */
export function viaRaw(raw) {
  return async (args, ms = 20000) => {
    const message = await raw.callTool("run", args, ms);
    assert.equal(message.error, undefined, JSON.stringify(message.error));
    const { content, isError } = message.result;
    assert.ok(Array.isArray(content) && content.length === 1 && content[0].type === "text", "one text item");
    return { text: content[0].text, isError: isError === true };
  };
}

/** The calls of `run` for jobs, through `send(args) -> { text, isError }`. */
export function jobsOf(send) {
  const jobs = {
    send,
    start: (code, more = {}) => send({ code, background: true, ...more }),
    ask: (job) => send({ job }),
    stop: (job) => send({ job, stop: true }),
    list: () => send({ jobs: true }),
    /** "Asked until it has ended": the answer once the first line does not hold `running`. */
    async untilEnded(job, ms = 15000) {
      const end = Date.now() + ms;
      for (;;) {
        const answer = await jobs.ask(job);
        if (!firstLine(answer.text).includes("running")) return answer;
        if (Date.now() >= end) assert.fail(`job ${job} was still running after ${ms} ms: ${answer.text}`);
        await sleep(100);
      }
    },
    /** The answer once it holds `needle`. */
    async untilText(job, needle, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) {
        const answer = await jobs.ask(job);
        if (answer.text.includes(needle)) return answer;
        if (Date.now() >= end) assert.fail(`the answer for ${job} never held ${JSON.stringify(needle)}: ${answer.text}`);
        await sleep(50);
      }
    },
  };
  return jobs;
}

/** Settings with the two real servers behind onetool; `onetool` holds the other keys. */
export const SETTINGS = (onetool = {}, servers = {}) =>
  settingsOf({ fake: fakeEntry(), practice: practiceEntry(), ...servers }, { timeoutSeconds: 10, backgroundSeconds: 30, ...onetool });

/** Waits until the fake server has had a call of its tool `barrier` (a program is waiting in it). */
export async function inBarrier(send, ms = 5000) {
  await waitFor(async () => (await send({ code: "await tools.fake.calls({})" })).text.includes('"name":"barrier"'), ms, "a program to wait in the barrier");
}

/** The two process numbers of a file of two lines (`<pid>\n<pid>\n`), once it holds them. */
export async function twoPids(file, ms = 5000) {
  return waitFor(
    () => {
      if (!existsSync(file)) return null;
      const found = /^(\d+)\n(\d+)\n$/.exec(readFileSync(file, "utf8"));
      return found ? [Number(found[1]), Number(found[2])] : null;
    },
    ms,
    `${file} to hold two process numbers`,
  );
}

/** Neither process is there, within `ms` milliseconds. */
export async function goneWithin(pids, ms) {
  await waitFor(() => pids.every((pid) => !alive(pid)), ms, `the processes ${pids.join(" and ")} to be gone`);
}

/** The processes of a test are ended whatever happens. */
export function reap(pids) {
  for (const pid of pids ?? []) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}
