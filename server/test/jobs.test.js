// Step 6: programs in the background (the meeting point of server, "Step 6: programs in the background"): the input schema of `run`,
// the reading of the arguments, starting a job, asking for it, stopping it, listing the jobs, `progress`, what follows.
// The listed servers are the fake one (which holds a call in its tool `barrier` while no second call comes) and the
// practice one; the texts are those of part `core`, written out in jobhelpers.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEntry, settingsOf, sleep, textOf, tmpDir, waitFor, withOnetool, withRaw } from "./helpers.js";
import { WAITING_COMMAND, pidsIn, shellSettings, workFolder } from "./shellhelpers.js";
import { logEntries } from "./recordhelpers.js";
import { hostDenial, put, shellOnly, withClaude, world } from "./stepfive.js";
import { withHost } from "./askhost.js";
import {
  HANG,
  NEEDS_CODE,
  NO_JOBS,
  SETTINGS,
  SEVERAL,
  STOPPED_ON_REQUEST,
  firstLine,
  goneWithin,
  headOf,
  inBarrier,
  jobLimit,
  jobStarted,
  jobsOf,
  listLine,
  noJob,
  reap,
  viaCtx,
  viaHost,
} from "./jobhelpers.js";

/** Runs `fn(jobs, ctx)` against the real command, `jobs` being the client of `run` for jobs. */
const inJobs = (settings, fn) => withOnetool(settings, (ctx) => fn(jobsOf(viaCtx(ctx)), ctx));

const FAILED = (message) => `The program failed: Error: ${message}`;

describe("the input schema of `run`", () => {
  const listOf = (settings) =>
    withRaw(settings, async (raw) => {
      await raw.initialize();
      return (await raw.request("tools/list", {})).result.tools;
    });

  test("five properties in this order, with their types, each described, and no key `required`; `search` is as it was", async () => {
    const [run, search] = await listOf(SETTINGS());
    assert.deepEqual([run.name, search.name], ["run", "search"]);
    assert.equal(run.inputSchema.type, "object");
    assert.deepEqual(Object.keys(run.inputSchema.properties), ["code", "background", "job", "stop", "jobs"]);
    const types = Object.fromEntries(Object.entries(run.inputSchema.properties).map(([name, one]) => [name, one.type]));
    assert.deepEqual(types, { code: "string", background: "boolean", job: "string", stop: "boolean", jobs: "boolean" });
    for (const [name, one] of Object.entries(run.inputSchema.properties)) {
      assert.ok(typeof one.description === "string" && one.description.length > 0, `${name} has a description`);
    }
    assert.equal(Object.hasOwn(run.inputSchema, "required"), false, "a call with `job` alone must be valid for the schema");
    assert.equal(search.inputSchema.type, "object");
    assert.deepEqual(Object.keys(search.inputSchema.properties), ["words"]);
    assert.equal(search.inputSchema.properties.words.type, "string");
    assert.equal(search.inputSchema.required, undefined);
  });

  test("the description texts together are under 1,500 characters, with the shell off and with the shell having folders", async () => {
    const { W } = workFolder();
    for (const settings of [SETTINGS(), shellSettings([W], { onetool: { backgroundSeconds: 30 } })]) {
      const [run, search] = await listOf(settings);
      const texts = [
        run.description,
        ...["code", "background", "job", "stop", "jobs"].map((name) => run.inputSchema.properties[name].description),
        search.description,
        search.inputSchema.properties.words.description,
      ];
      assert.ok(texts.every((one) => typeof one === "string" && one.length > 0));
      assert.ok(texts.join("").length < 1500, `the descriptions are ${texts.join("").length} characters`);
    }
  });

  test("the description of `run` holds `background: true`, `job` and `progress(`, and what the older steps say it holds", async () => {
    const { W } = workFolder();
    for (const settings of [SETTINGS(), shellSettings([W])]) {
      const [run] = await listOf(settings);
      for (const needle of ["background: true", "job", "progress(", "tools.<server>.<tool>(", "await", "console.log", "search", "`state`"]) {
        assert.ok(run.description.includes(needle), `the description of run holds ${needle}`);
      }
    }
  });

  test("the texts are fixed: tools/list is the same before a job, with one running and after it ended", async () => {
    await inJobs(SETTINGS(), async (jobs, ctx) => {
      const before = (await ctx.client.listTools()).tools;
      assert.equal((await jobs.start(HANG)).text, jobStarted("j1"));
      assert.equal((await jobs.start("1")).text, jobStarted("j2"));
      await jobs.untilEnded("j2");
      assert.deepEqual((await ctx.client.listTools()).tools, before);
      await jobs.stop("j1");
      assert.deepEqual((await ctx.client.listTools()).tools, before);
    });
  });
});

describe("reading the arguments", () => {
  const PROBLEMS = [
    [{}, NEEDS_CODE],
    [{ code: 5 }, NEEDS_CODE],
    [{ jobs: false }, NEEDS_CODE],
    [{ stop: true }, NEEDS_CODE],
    [{ code: "1", job: "j1" }, SEVERAL],
    [{ code: "1", jobs: true }, SEVERAL],
    [{ job: "j1", jobs: true }, SEVERAL],
    [{ code: "1", stop: true }, 'onetool: run takes "stop" only with "job"'],
    [{ code: "1", background: "yes" }, 'onetool: run takes "background", true or false'],
    [{ code: "1", stop: 1 }, 'onetool: run takes "stop", true or false'],
    [{ code: "1", jobs: "no" }, 'onetool: run takes "jobs", true or false'],
    [{ job: 5 }, 'onetool: run takes "job", the id of a job'],
    [{ job: "j1", background: true }, 'onetool: run takes "background" only with "code"'],
    [{ jobs: true, background: true }, 'onetool: run takes "background", true or false'],
    [{ jobs: true, stop: true }, 'onetool: run takes "stop", true or false'],
  ];

  test("a call that runRequest refuses is answered with its text, as a fault, and touches nothing: no program, no job number, no state", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.send({ code: "state.x = 1" });
      for (const [args, text] of PROBLEMS) {
        assert.deepEqual(await jobs.send(args), { text, isError: true }, JSON.stringify(args));
      }
      assert.deepEqual(await jobs.send({ code: "JSON.stringify(state)" }), { text: '{"x":1}', isError: false });
      assert.deepEqual(await jobs.list(), { text: NO_JOBS, isError: false });
      assert.deepEqual(await jobs.start(HANG), { text: jobStarted("j1"), isError: false });
    });
  });

  test("the arguments a host fills in with false, null or the empty string do not ask: `code` alone is answered as before", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      assert.deepEqual(await jobs.send({ code: "1 + 1", background: false, job: "", stop: false, jobs: false }), { text: "2", isError: false });
      assert.deepEqual(await jobs.send({ code: "1 + 1", job: null, words: 3, extra: {} }), { text: "2", isError: false });
      assert.deepEqual(await jobs.send({ code: "1 + 1", background: false }), { text: "2", isError: false });
      assert.deepEqual(await jobs.list(), { text: NO_JOBS, isError: false }, "no job was made");
    });
  });

  test("with `job` or `jobs` asked, a `code` that is null or empty is not given", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      assert.deepEqual(await jobs.send({ job: "j1", code: "" }), { text: noJob("j1"), isError: true });
      assert.deepEqual(await jobs.send({ job: "j1", code: null, stop: false }), { text: noJob("j1"), isError: true });
      assert.deepEqual(await jobs.send({ jobs: true, code: "", job: "", background: false, stop: false }), { text: NO_JOBS, isError: false });
      assert.deepEqual(await jobs.send({ jobs: true, code: null }), { text: NO_JOBS, isError: false });
    });
  });

  test("a job id of white space only asks: it is a job that is not kept, and is not trimmed", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      assert.deepEqual(await jobs.ask(" "), { text: noJob(" "), isError: true });
      assert.deepEqual(await jobs.ask(" j1"), { text: noJob(" j1"), isError: true });
    });
  });
});

describe("starting a job", () => {
  test("the answer is jobStarted(id), without isError, given at once, with the next id each time", async () => {
    await inJobs(SETTINGS({ maxJobs: 3 }), async (jobs, ctx) => {
      await ctx.call("search", {});
      for (const id of ["j1", "j2", "j3"]) {
        const began = Date.now();
        assert.deepEqual(await jobs.start(HANG), { text: jobStarted(id), isError: false });
        assert.ok(Date.now() - began < 3000, "the answer did not wait for the program");
      }
    });
  });

  test("a program in the foreground goes on while a job runs, and a job does not wait for it", async () => {
    await inJobs(SETTINGS({ maxJobs: 1 }), async (jobs, ctx) => {
      await ctx.call("search", {});
      const began = Date.now();
      const foreground = jobs.send({ code: 'await new Promise((done) => setTimeout(done, 2500)); "fg"' });
      // programs in the foreground are not counted: with maxJobs 1 the start is not refused
      assert.deepEqual(await jobs.start(HANG), { text: jobStarted("j1"), isError: false });
      assert.ok(Date.now() - began < 2000, "the start did not wait for the foreground program");
      assert.deepEqual(await jobs.send({ code: "1 + 1" }), { text: "2", isError: false }, "a foreground call does not wait for the job");
      assert.deepEqual(await foreground, { text: "fg", isError: false });
    });
  });

  test("the program finds `progress`, in a job and in the foreground; in the foreground the lines are dropped", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      assert.deepEqual(await jobs.send({ code: "typeof progress" }), { text: "function", isError: false });
      assert.deepEqual(await jobs.send({ code: 'progress("x", 1); console.log("y"); String(progress("z"))' }), {
        text: "undefined\n--- console.log ---\ny",
        isError: false,
      });
      await jobs.start("typeof progress");
      assert.deepEqual((await jobs.untilEnded("j1")).text.split("\n").slice(1), ["--- answer ---", "function"]);
      assert.equal((await jobs.list()).text.split("\n").length, 1, "the foreground made no job");
    });
  });

  test("`search` is not changed by jobs, and lists none", async () => {
    await inJobs(SETTINGS(), async (jobs, ctx) => {
      const before = textOf(await ctx.call("search", {}));
      await jobs.start("1");
      await jobs.untilEnded("j1");
      await jobs.start(HANG);
      assert.equal(textOf(await ctx.call("search", {})), before);
      assert.ok(!/\bj\d\b|job/i.test(before));
    });
  });
});

describe("the limit of jobs that run", () => {
  test("at maxJobs running the answer is jobLimitMessage(maxJobs) with isError, and the refused start took no number", async () => {
    await inJobs(SETTINGS({ maxJobs: 2 }), async (jobs) => {
      assert.equal((await jobs.start(HANG)).text, jobStarted("j1"));
      assert.equal((await jobs.start(HANG)).text, jobStarted("j2"));
      assert.deepEqual(await jobs.start(HANG), { text: jobLimit(2), isError: true });
      assert.deepEqual(await jobs.start("1"), { text: jobLimit(2), isError: true });
      await jobs.stop("j1");
      assert.deepEqual(await jobs.start(HANG), { text: jobStarted("j3"), isError: false }, "j1 no longer runs, and the refusals took no number");
      assert.deepEqual((await jobs.list()).text.split("\n").map((line) => line.split(":")[0]), ["j1", "j2", "j3"]);
    });
  });

  test("a job that has ended is not counted", async () => {
    await inJobs(SETTINGS({ maxJobs: 1 }), async (jobs) => {
      assert.equal((await jobs.start("1")).text, jobStarted("j1"));
      await jobs.untilEnded("j1");
      assert.equal((await jobs.start("2")).text, jobStarted("j2"));
      await jobs.untilEnded("j2");
      assert.equal((await jobs.start("throw new Error('x')")).text, jobStarted("j3"));
      await jobs.untilEnded("j3");
      assert.equal((await jobs.start(HANG)).text, jobStarted("j4"));
    });
  });

  test("maxJobs 1 and two starts at the same moment: one takes the place, the other is refused", async () => {
    await inJobs(SETTINGS({ maxJobs: 1 }), async (jobs, ctx) => {
      await ctx.call("search", {});
      const answers = await Promise.all([jobs.start(HANG), jobs.start(HANG)]);
      assert.deepEqual(answers.map((one) => one.text).sort(), [jobLimit(1), jobStarted("j1")].sort());
      assert.deepEqual(answers.map((one) => one.isError).sort(), [false, true]);
    });
  });

  test("maxJobs 0: every start is refused with jobLimitMessage(0), and takes no number", async () => {
    await inJobs(SETTINGS({ maxJobs: 0 }), async (jobs) => {
      for (let again = 0; again < 2; again++) assert.deepEqual(await jobs.start("1"), { text: jobLimit(0), isError: true });
      assert.deepEqual(await jobs.list(), { text: NO_JOBS, isError: false });
    });
  });
});

describe("asking for a job", () => {
  test("a job that is not kept: noJobMessage, as a fault; the id is compared exactly, case counting", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      assert.deepEqual(await jobs.ask("j99"), { text: noJob("j99"), isError: true });
      await jobs.start(HANG);
      assert.deepEqual(await jobs.ask("J1"), { text: noJob("J1"), isError: true });
      assert.deepEqual(await jobs.ask("j1 "), { text: noJob("j1 "), isError: true });
      assert.equal((await jobs.ask("j1")).isError, false);
    });
  });

  test("a job that runs: one line `job <id>: running, <n> s`, then the lines it posted, and no answer", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      assert.equal((await jobs.start(`progress("fetching"); ${HANG}`)).text, jobStarted("j1"));
      const first = await jobs.untilText("j1", "fetching");
      assert.deepEqual(first.text.split("\n").slice(1), ["--- progress ---", "fetching"]);
      assert.match(firstLine(first.text), headOf("j1", "running"));
      assert.equal(first.isError, false);
      await jobs.start(HANG);
      const quiet = await jobs.ask("j2");
      assert.match(quiet.text, /^job j2: running, \d+ s$/);
    });
  });

  test("a job that is done: the progress, the answer, and the lines of console.log as formatRun puts them; asking again gives the same", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start('console.log("hi"); progress("p1", 2); 7');
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, false);
      const lines = ended.text.split("\n");
      assert.match(lines[0], headOf("j1", "done"));
      assert.deepEqual(lines.slice(1), ["--- progress ---", "p1 2", "--- answer ---", "7", "--- console.log ---", "hi"]);
      assert.deepEqual(await jobs.ask("j1"), ended);
      assert.deepEqual(await jobs.ask("j1"), ended);
    });
  });

  test("the last 10 lines are kept, oldest first, with the number of the others; a job that runs shows them too", async () => {
    const loop = 'for (let i = 0; i < 15; i++) progress("l" + i);';
    const kept = Array.from({ length: 10 }, (_, i) => `l${i + 5}`);
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start(`${loop} "fin"`);
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- progress ---", "(5 earlier lines not shown)", ...kept, "--- answer ---", "fin"]);
      await jobs.start(`${loop} ${HANG}`);
      const running = await jobs.untilText("j2", "l14");
      assert.deepEqual(running.text.split("\n").slice(1), ["--- progress ---", "(5 earlier lines not shown)", ...kept]);
    });
  });

  test("a line is shown by formatJob with its default lineLimit: 200 characters and `...`", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start('progress("x".repeat(300)); progress("a\\nb"); 1');
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1, 4), ["--- progress ---", `${"x".repeat(200)}...`, "a b"]);
    });
  });

  test("a job that failed: isError exactly then; the other states are not faults", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start('throw new Error("boom")');
      const failed = await jobs.untilEnded("j1");
      assert.equal(failed.isError, true);
      const lines = failed.text.split("\n");
      assert.match(lines[0], headOf("j1", "failed"));
      assert.deepEqual(lines.slice(1), ["--- answer ---", "The program failed: Error: boom"]);
      await jobs.start("1");
      assert.equal((await jobs.untilEnded("j2")).isError, false);
      await jobs.start(HANG);
      const stopped = await jobs.stop("j3");
      assert.match(firstLine(stopped.text), headOf("j3", "stopped"));
      assert.equal(stopped.isError, false);
    });
  });

  test("a job that met its limit is stopped, and says the limit it has, as it was written", async () => {
    await inJobs(SETTINGS({ backgroundSeconds: 0.5 }), async (jobs) => {
      await jobs.start(HANG);
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, false);
      const lines = ended.text.split("\n");
      assert.match(lines[0], headOf("j1", "stopped"));
      assert.deepEqual(lines.slice(1), ["--- answer ---", "The program was stopped after 0.5 seconds."]);
    });
  });

  test("the limit of the foreground does not hold a job", async () => {
    await inJobs(SETTINGS({ timeoutSeconds: 1, backgroundSeconds: 30 }), async (jobs) => {
      const wait = 'await new Promise((done) => setTimeout(done, 2500)); "late"';
      await jobs.start(wait);
      const foreground = await jobs.send({ code: wait });
      assert.deepEqual(foreground, { text: "The program was stopped after 1 seconds.", isError: true });
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "late"]);
      assert.match(firstLine(ended.text), headOf("j1", "done"));
    });
  });
});

describe("the trail of a job", () => {
  const TRAIL = (extra = {}) => SETTINGS({ trail: true, ...extra });

  test("an ended job whose program made calls ends with its trail, in the order the calls began", async () => {
    await inJobs(TRAIL(), async (jobs) => {
      await jobs.start('await tools.practice.count({}); await tools.practice.echo({ text: "x" }); "ok"');
      const ended = await jobs.untilEnded("j1");
      const lines = ended.text.split("\n");
      assert.deepEqual(lines.slice(1, 3), ["--- answer ---", "ok"]);
      assert.equal(lines[3], "--- calls ---");
      assert.equal(lines.length, 6);
      assert.match(lines[4], /^practice\.count \d+ ms \d+ chars$/);
      assert.match(lines[5], /^practice\.echo \d+ ms \d+ chars$/);
      assert.deepEqual(await jobs.ask("j1"), ended);
    });
  });

  test("no call, no trail; a job that runs shows no trail even with a call made; trail false gives none", async () => {
    await inJobs(TRAIL(), async (jobs) => {
      await jobs.start('"quiet"');
      assert.deepEqual((await jobs.untilEnded("j1")).text.split("\n").slice(1), ["--- answer ---", "quiet"]);
      await jobs.start('await tools.practice.count({}); await tools.fake.barrier({})');
      await inBarrier(jobs.send);
      const running = await jobs.ask("j2");
      assert.match(running.text, /^job j2: running, \d+ s$/);
    });
    await inJobs(SETTINGS({ trail: false }), async (jobs) => {
      await jobs.start('await tools.practice.count({}); "x"');
      assert.deepEqual((await jobs.untilEnded("j1")).text.split("\n").slice(1), ["--- answer ---", "x"]);
    });
  });

  test("the answer of an ended job is cut as any answer: answerLimit characters, the trail whole at its end", async () => {
    await inJobs(TRAIL({ answerLimit: 300 }), async (jobs) => {
      await jobs.start('await tools.practice.count({}); "x".repeat(500)');
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.text.length, 300);
      assert.match(
        ended.text,
        /^job j1: done, \d+ s\n--- answer ---\nx+\n\[cut: the answer was \d+ characters, the limit is 300\]\n--- calls ---\npractice\.count \d+ ms \d+ chars$/,
      );
    });
  });

  test("an ended job with no trail is cut by cutAnswer, and so is the list", async () => {
    await inJobs(SETTINGS({ answerLimit: 100 }), async (jobs) => {
      await jobs.start('"x".repeat(500)');
      const ended = await jobs.untilEnded("j1");
      const head = firstLine(ended.text);
      const whole = `${head}\n--- answer ---\n${"x".repeat(500)}`;
      const notice = `\n[cut: the answer was ${whole.length} characters, the limit is 100]`;
      assert.equal(ended.text, whole.slice(0, 100 - notice.length) + notice);
      for (let again = 0; again < 8; again++) await jobs.untilEnded((await jobs.start("1")).text.split(" ")[1]);
      const list = await jobs.list();
      assert.equal(list.text.length, 100);
      assert.match(list.text, /\n\[cut: the answer was \d+ characters, the limit is 100\]$/);
      assert.ok(list.text.startsWith("j1: done, "));
      assert.equal(list.isError, false);
    });
  });
});

describe("stopping a job", () => {
  const WAITING = 'progress("p"); await tools.fake.barrier({})';

  test("a job that runs: it is stopped, the answer is the one of asking, with the call that had not ended unfinished", async () => {
    const L = tmpDir();
    await inJobs(SETTINGS({ trail: true, logFolder: L }), async (jobs) => {
      assert.equal((await jobs.start(WAITING)).text, jobStarted("j1"));
      await inBarrier(jobs.send);
      const stopped = await jobs.stop("j1");
      assert.equal(stopped.isError, false);
      const lines = stopped.text.split("\n");
      assert.match(lines[0], headOf("j1", "stopped"));
      assert.deepEqual(lines.slice(1, 6), ["--- progress ---", "p", "--- answer ---", STOPPED_ON_REQUEST, "--- calls ---"]);
      assert.equal(lines.length, 7);
      assert.match(lines[6], /^fake\.barrier \d+ ms unfinished$/);
      assert.deepEqual(await jobs.ask("j1"), stopped);
      assert.deepEqual(await jobs.stop("j1"), stopped, "a second stop answers the same");
      // the line of the call is in the log when the answer is given, as unfinished
      const barrier = logEntries(L).filter((entry) => entry.id === "fake.barrier");
      assert.equal(barrier.length, 1);
      assert.equal(barrier[0].fault, "unfinished");
    });
  });

  test("a job that has ended: nothing is done, the answer is the one of asking; a job that is not kept: noJobMessage", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start("42");
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(await jobs.stop("j1"), ended);
      await jobs.start('throw new Error("boom")');
      const failed = await jobs.untilEnded("j2");
      assert.deepEqual(await jobs.stop("j2"), failed);
      assert.deepEqual(await jobs.stop("j7"), { text: noJob("j7"), isError: true });
    });
  });

  test("two stops of the same job at once: both answer the stopped job", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start(HANG);
      const [one, two] = await Promise.all([jobs.stop("j1"), jobs.stop("j1")]);
      for (const answer of [one, two]) {
        assert.match(firstLine(answer.text), headOf("j1", "stopped"));
        assert.equal(answer.isError, false);
        assert.ok(answer.text.endsWith(STOPPED_ON_REQUEST));
      }
      assert.deepEqual(one, two);
    });
  });

  test("a job that is stopped keeps nothing of its own in `state`, and what was kept before is still there", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.send({ code: "state.a = 1" });
      await jobs.start(`state.a = 99; state.b = 2; ${HANG}`);
      await sleep(200);
      await jobs.stop("j1");
      assert.deepEqual(await jobs.send({ code: "JSON.stringify(state)" }), { text: '{"a":1}', isError: false });
    });
  });

  test("a stopped job frees its place, and a foreground call goes on", async () => {
    await inJobs(SETTINGS({ maxJobs: 1 }), async (jobs) => {
      await jobs.start(HANG);
      assert.deepEqual(await jobs.start(HANG), { text: jobLimit(1), isError: true });
      await jobs.stop("j1");
      assert.deepEqual(await jobs.start(HANG), { text: jobStarted("j2"), isError: false });
      assert.deepEqual(await jobs.send({ code: "1 + 1" }), { text: "2", isError: false });
    });
  });
});

describe("a job and its commands", () => {
  test("a command a job's program did not await is stopped with everything it started when the program ends", async () => {
    const { W } = workFolder();
    let pids;
    try {
      await inJobs(shellSettings([W], { onetool: { backgroundSeconds: 30 } }), async (jobs) => {
        const code = [
          `const running = $(${JSON.stringify(WAITING_COMMAND)}).text();`,
          "for (;;) {",
          '  try { await read("pids"); break; } catch (e) {}',
          "}",
          'return "left";',
        ].join("\n");
        await jobs.start(code);
        const ended = await jobs.untilEnded("j1");
        assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "left"]);
        pids = await waitFor(() => (existsSync(join(W, "pids")) ? pidsIn(readFileSync(join(W, "pids"), "utf8")) : null), 5000, "the pids");
        await goneWithin(pids, 2000);
      });
    } finally {
      reap(pids);
    }
  });

  test("a job that meets its limit while a command runs: the command and its child are gone within 2 seconds", async () => {
    const { W } = workFolder();
    let pids;
    try {
      await inJobs(shellSettings([W], { onetool: { backgroundSeconds: 1 } }), async (jobs) => {
        await jobs.start(`await $(${JSON.stringify(WAITING_COMMAND)})`);
        const ended = await jobs.untilEnded("j1");
        assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "The program was stopped after 1 seconds."]);
        pids = await waitFor(() => (existsSync(join(W, "pids")) ? pidsIn(readFileSync(join(W, "pids"), "utf8")) : null), 5000, "the pids");
        await goneWithin(pids, 2000);
      });
    } finally {
      reap(pids);
    }
  });

  test("with the shell having folders a job finds `$`, `read`, `write` and `edit`, and the work is done", async () => {
    const { W } = workFolder({ "a.txt": "alpha\n" });
    await inJobs(shellSettings([W], { onetool: { backgroundSeconds: 30 } }), async (jobs) => {
      await jobs.start('await write("b.txt", "x"); await edit("a.txt", "alpha", "omega"); (await $`echo hi`.text()).trim() + (await read("b.txt"))');
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "hix"]);
      assert.equal(readFileSync(join(W, "a.txt"), "utf8"), "omega\n");
    });
  });
});

describe("what follows, and must hold", () => {
  test("`state` is shared by the rule of nextState: a job that sets state.kept = 5 has kept it when it has ended", async () => {
    await inJobs(SETTINGS(), async (jobs) => {
      await jobs.start('await new Promise((done) => setTimeout(done, 300)); state.kept = 5; "late"');
      assert.deepEqual(await jobs.send({ code: "JSON.stringify(state)" }), { text: "{}", isError: false }, "not kept before it has ended");
      await jobs.untilEnded("j1");
      assert.deepEqual(await jobs.send({ code: "state.kept" }), { text: "5", isError: false });
    });
  });

  test("a job reads the state of the moment it starts, and a state that is too large makes the job failed", async () => {
    await inJobs(SETTINGS({ stateLimit: 1000 }), async (jobs) => {
      await jobs.send({ code: "state.a = 1" });
      await jobs.start("state.a + 1");
      assert.deepEqual((await jobs.untilEnded("j1")).text.split("\n").slice(1), ["--- answer ---", "2"]);
      await jobs.start('state.big = "x".repeat(2000); "ok"');
      const ended = await jobs.untilEnded("j2");
      assert.equal(ended.isError, true);
      const lines = ended.text.split("\n");
      assert.match(lines[0], headOf("j2", "failed"));
      // the object that would be kept is {"a":1,"big":"<2000 x>"}: `{"a":1,"big":"` is 14 characters, then 2000, then `"}`
      assert.deepEqual(lines.slice(1), ["--- answer ---", "The program failed: state was not kept: it is 2016 characters as JSON, the limit is 1000"]);
      assert.deepEqual(await jobs.send({ code: "JSON.stringify(state)" }), { text: '{"a":1}', isError: false });
    });
  });

  test("the calls of a job's program go through the rules of onetool: a denied tool is refused, the real server is not called", async () => {
    await inJobs(SETTINGS({ deny: ["practice.wipe"] }), async (jobs) => {
      await jobs.start("await tools.practice.wipe({})");
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, true);
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", FAILED('onetool: practice.wipe is denied by the rule deny "practice.wipe"')]);
    });
  });

  test("a call of a job's program takes backgroundSeconds in the place of timeoutSeconds: a call that waits 3 seconds is not given up at 1", async () => {
    // the barrier of the fake server holds a call until a second one comes; timeoutSeconds 1 would end a call at 2 seconds
    await inJobs(SETTINGS({ timeoutSeconds: 1, backgroundSeconds: 30, maxJobs: 2 }), async (jobs) => {
      await jobs.start("await tools.fake.barrier({})");
      await inBarrier(jobs.send);
      await sleep(3000);
      await jobs.start("await tools.fake.barrier({})");
      for (const id of ["j1", "j2"]) {
        const ended = await jobs.untilEnded(id);
        assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "released"], id);
        assert.match(firstLine(ended.text), headOf(id, "done"));
      }
    });
  });

  test("the log holds one line per call of a job's program, with the session of the foreground; starting, asking, stopping and listing write none", async () => {
    const L = tmpDir();
    await inJobs(SETTINGS({ logFolder: L }), async (jobs) => {
      await jobs.send({ code: "await tools.practice.count({})" });
      await jobs.start('await tools.practice.echo({ text: "x" })');
      await jobs.untilEnded("j1");
      // when the answer is given for a job that has ended, the line of every call of its program is in the file
      assert.deepEqual(logEntries(L).map((entry) => entry.id), ["practice.count", "practice.echo"]);
      await jobs.ask("j1");
      await jobs.stop("j1");
      await jobs.list();
      await jobs.ask("j9");
      await jobs.start(HANG);
      await jobs.stop("j2");
      const entries = logEntries(L);
      assert.deepEqual(entries.map((entry) => entry.id), ["practice.count", "practice.echo"]);
      assert.equal(entries[0].session, entries[1].session);
    });
  });

  test("no answer and no line on standard error holds a value of the settings file, and nothing about a job goes to standard error", async () => {
    const L = tmpDir();
    const { W } = workFolder();
    const secret = "s3cr3t-value-of-the-file";
    const settings = settingsOf(
      { fake: fakeEntry({}, { env: { SECRET: secret } }) },
      { shell: { folders: [W], deny: ["rm *"] }, backgroundSeconds: 1, timeoutSeconds: 10, maxJobs: 1, trail: true, logFolder: L },
    );
    await inJobs(settings, async (jobs, ctx) => {
      const answers = [];
      const note = async (promise) => {
        const one = await promise;
        answers.push(one.text);
        return one;
      };
      await note(jobs.start('progress("p"); await tools.fake.rec({ a: 1 }); 5'));
      await note(jobs.untilEnded("j1"));
      await note(jobs.start('await $`rm nothing`'));
      await note(jobs.untilEnded("j2"));
      await note(jobs.start(HANG));
      await note(jobs.untilEnded("j3"));
      await note(jobs.start(HANG));
      await note(jobs.stop("j4"));
      await note(jobs.ask("j1"));
      await note(jobs.list());
      for (const text of answers) {
        for (const value of [secret, W, L]) assert.ok(!text.includes(value), `an answer holds ${value}: ${text}`);
      }
      await sleep(200);
      for (const line of ctx.stderrLines()) assert.ok(!/job|\bj\d+\b/i.test(line) && !line.includes(secret) && !line.includes(W), line);
    });
  });
});

describe("keeping the jobs", () => {
  test("ended jobs are kept, the last 20: the one that ended first is forgotten, a job that runs never is, a number is not used twice", async () => {
    await inJobs(SETTINGS({ maxJobs: 3 }), async (jobs) => {
      assert.equal((await jobs.start(HANG)).text, jobStarted("j1"));
      for (let id = 2; id <= 22; id++) {
        assert.equal((await jobs.start(`${id}`)).text, jobStarted(`j${id}`));
        await jobs.untilEnded(`j${id}`);
      }
      // j2 ended first of the 21 ended jobs: it is forgotten; j1 runs
      assert.deepEqual(await jobs.ask("j2"), { text: noJob("j2"), isError: true });
      assert.deepEqual(await jobs.stop("j2"), { text: noJob("j2"), isError: true });
      assert.match((await jobs.ask("j3")).text, /^job j3: done/);
      const lines = (await jobs.list()).text.split("\n");
      assert.equal(lines.length, 21);
      assert.match(lines[0], listLine("j1", "running"));
      lines.slice(1).forEach((line, at) => assert.match(line, listLine(`j${at + 3}`, "done")));
      assert.equal((await jobs.start("1")).text, jobStarted("j23"));
    });
  });

  test("`{ jobs: true }` lists the jobs kept in the order they were started, with their states; with none: No job in this session.", async () => {
    await inJobs(SETTINGS({ maxJobs: 2 }), async (jobs) => {
      assert.deepEqual(await jobs.list(), { text: NO_JOBS, isError: false });
      await jobs.start("1");
      await jobs.untilEnded("j1");
      await jobs.start('throw new Error("x")');
      await jobs.untilEnded("j2");
      await jobs.start(HANG);
      await jobs.start(HANG);
      await jobs.stop("j3");
      const list = await jobs.list();
      assert.equal(list.isError, false);
      const lines = list.text.split("\n");
      assert.equal(lines.length, 4);
      assert.match(lines[0], listLine("j1", "done"));
      assert.match(lines[1], listLine("j2", "failed"));
      assert.match(lines[2], listLine("j3", "stopped"));
      assert.match(lines[3], listLine("j4", "running"));
      assert.deepEqual(await jobs.list(), list, "asking again, nothing is used up");
    });
  });
});

describe("a job's program under a host program that can be asked", () => {
  const ASK = (onetool = {}) => settingsOf({ fake: fakeEntry() }, { timeoutSeconds: 1, backgroundSeconds: 30, ask: ["fake.rec"], ...onetool });
  const QUESTION = [
    "onetool: a program wants to call fake.rec.",
    'Arguments: {"a":1}',
    'The rule ask "fake.rec" asks for your consent. Allow this call?',
  ].join("\n");

  test("the question reaches the host while no call of run is in progress, is asked once, and the job goes on after the yes", async () => {
    await withHost(ASK(), { answer: () => ({ action: "accept" }) }, async (host) => {
      const jobs = jobsOf(viaHost(host));
      assert.equal((await jobs.start("await tools.fake.rec({ a: 1 })")).text, jobStarted("j1"));
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "called rec"]);
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, QUESTION);
    });
  });

  test("the person's no is the refusal of step 3, and the job has failed", async () => {
    await withHost(ASK(), { answer: () => ({ action: "decline" }) }, async (host) => {
      const jobs = jobsOf(viaHost(host));
      await jobs.start("await tools.fake.rec({ a: 1 })");
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, true);
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", FAILED('onetool: fake.rec is refused by the rule ask "fake.rec": the person said no')]);
    });
  });

  test("a host that cannot ask gives the refusal of step 3, and no question is sent", async () => {
    await withHost(ASK(), { capabilities: {} }, async (host) => {
      const jobs = jobsOf(viaHost(host));
      await jobs.start("await tools.fake.rec({ a: 1 })");
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1), [
        "--- answer ---",
        FAILED('onetool: fake.rec is refused by the rule ask "fake.rec": the host program cannot ask the person'),
      ]);
      assert.equal(host.questions.length, 0);
    });
  });

  test("a question of a job may wait for the person longer than timeoutSeconds: the time of a call of a job is backgroundSeconds", async () => {
    const slow = async () => {
      await sleep(3000);
      return { action: "accept" };
    };
    await withHost(ASK(), { answer: slow }, async (host) => {
      const jobs = jobsOf(viaHost(host));
      await jobs.start("await tools.fake.rec({ a: 1 })");
      const ended = await jobs.untilEnded("j1", 20000);
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "called rec"]);
    });
  });
});

describe("a job's program under the rules of the host program", () => {
  test("they are read again when the job starts, and the shell takes the folders of the roots", async () => {
    const w = world();
    await withClaude(shellOnly({ onetool: { backgroundSeconds: 30, hostRules: true } }), w, {}, async (host) => {
      const jobs = jobsOf(viaHost(host));
      await jobs.start("(await $`cat one.txt`.text()).trim()");
      assert.deepEqual((await jobs.untilEnded("j1")).text.split("\n").slice(1), ["--- answer ---", "alpha"]);
      await jobs.start("await $`rm one.txt`");
      const denied = await jobs.untilEnded("j2");
      assert.equal(denied.isError, true);
      assert.deepEqual(denied.text.split("\n").slice(1), ["--- answer ---", FAILED(hostDenial("shell.run", "Bash(rm *)", w.fileA))]);
      assert.equal(existsSync(join(w.A, "one.txt")), true);
      // a file written after the first job is read for the next one
      put(w.localA, { permissions: { deny: ["Bash(cat *)"] } });
      await jobs.start("(await $`cat one.txt`.text()).trim()");
      const again = await jobs.untilEnded("j3");
      assert.deepEqual(again.text.split("\n").slice(1), ["--- answer ---", FAILED(hostDenial("shell.run", "Bash(cat *)", w.localA))]);
    });
  });
});
