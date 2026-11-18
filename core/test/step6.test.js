import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.js";
import { settingsOf, faultOf, deepFreeze, printedBy } from "./helpers.js";

// The functions are read off the module at call time, so a missing one fails its own test and not the file.
const formatRun = (...args) => core.formatRun(...args);
const runRequest = (...args) => core.runRequest(...args);
const jobState = (...args) => core.jobState(...args);
const jobStarted = (...args) => core.jobStarted(...args);
const jobLimitMessage = (...args) => core.jobLimitMessage(...args);
const noJobMessage = (...args) => core.noJobMessage(...args);
const jobLine = (...args) => core.jobLine(...args);
const formatJobs = (...args) => core.formatJobs(...args);
const formatJob = (...args) => core.formatJob(...args);

const withOnetool = (onetool) => ({ mcpServers: {}, onetool });
const problemsOf = (onetool) => faultOf(withOnetool(onetool)).problems;
const BACKGROUND = "onetool.backgroundSeconds: must be a number above 0, at most 86400";
const MAX_JOBS = "onetool.maxJobs: must be a whole number from 0 to 100";

// -- the exports -----------------------------------------------------------------------------------------------

describe("step 6: the exports", () => {
  test("the eight new names are functions of core/src/index.js", () => {
    for (const name of ["runRequest", "jobState", "jobStarted", "jobLimitMessage", "noJobMessage", "jobLine", "formatJobs", "formatJob"]) {
      assert.equal(typeof core[name], "function", name);
    }
  });
});

// -- backgroundSeconds and maxJobs -----------------------------------------------------------------------------

describe("step 6: backgroundSeconds and maxJobs in the settings file", () => {
  test("neither in the file: 7200 and 3", () => {
    for (const file of [{ mcpServers: {} }, withOnetool({}), withOnetool({ timeoutSeconds: 5, searchLimit: 2 }), withOnetool({ shell: {} })]) {
      const got = settingsOf(file);
      assert.equal(got.backgroundSeconds, 7200);
      assert.equal(got.maxJobs, 3);
    }
  });

  test("backgroundSeconds: a number above 0 and at most 86400, both ends of the range and 0.5 are valid", () => {
    for (const value of [0.5, 1, 60, 3601, 7200, 86399.5, 86400, 0.001]) {
      const got = settingsOf(withOnetool({ backgroundSeconds: value }));
      assert.equal(got.backgroundSeconds, value);
      assert.equal(got.bad.length, 0);
    }
  });

  test("backgroundSeconds not valid: 0, negative, above 86400, a string, true, null, a list, an object", () => {
    for (const value of [0, -0.5, -1, 86400.5, 86401, 1000000, "7200", "0.5", "", true, false, null, [], [7200], {}]) {
      assert.deepEqual(problemsOf({ backgroundSeconds: value }), [BACKGROUND], JSON.stringify(value));
    }
  });

  test("maxJobs: a whole number from 0 to 100, both ends included; 0 is kept and is not the default", () => {
    for (const value of [0, 1, 2, 3, 50, 99, 100]) {
      const got = settingsOf(withOnetool({ maxJobs: value }));
      assert.equal(got.maxJobs, value);
      assert.equal(got.bad.length, 0);
    }
    assert.equal(settingsOf(withOnetool({ maxJobs: 0 })).maxJobs, 0);
  });

  test("maxJobs not valid: negative, above 100, not whole, a string, true, null, a list, an object", () => {
    for (const value of [-1, 101, 1000, 0.5, 1.5, 99.9, "3", "0", "", true, false, null, [], [3], {}]) {
      assert.deepEqual(problemsOf({ maxJobs: value }), [MAX_JOBS], JSON.stringify(value));
    }
  });

  test("the two limits are independent of timeoutSeconds: backgroundSeconds below it is valid", () => {
    const got = settingsOf(withOnetool({ timeoutSeconds: 3600, backgroundSeconds: 1 }));
    assert.equal(got.timeoutSeconds, 3600);
    assert.equal(got.backgroundSeconds, 1);
    const got2 = settingsOf(withOnetool({ timeoutSeconds: 0.5, backgroundSeconds: 86400 }));
    assert.equal(got2.timeoutSeconds, 0.5);
    assert.equal(got2.backgroundSeconds, 86400);
  });

  test("the whole returned object, with both given", () => {
    const got = settingsOf({
      mcpServers: { s: { command: "node" } },
      onetool: { backgroundSeconds: 0.5, maxJobs: 0 },
    });
    assert.deepEqual(got, {
      servers: [{ name: "s", command: "node", args: [], env: {} }],
      bad: [],
      answerLimit: 8000,
      timeoutSeconds: 60,
      connectSeconds: 30,
      searchLimit: 10,
      stateLimit: 10000000,
      allow: [],
      deny: [],
      ask: [],
      shell: null,
      trail: false,
      log: true,
      logFolder: null,
      hostRules: true,
      hostServers: [],
      backgroundSeconds: 0.5,
      maxJobs: 0,
      libraryCap: 50,
    });
  });

  test("the two keys are not unknown keys, and a wrong case stays unknown", () => {
    for (const key of ["backgroundSeconds", "maxJobs"]) {
      assert.ok(!problemsOf({ [key]: "x", foo: 1 }).includes(`onetool.${key}: unknown key`), key);
    }
    assert.deepEqual(problemsOf({ backgroundseconds: 5 }), ["onetool.backgroundseconds: unknown key"]);
    assert.deepEqual(problemsOf({ MaxJobs: 5 }), ["onetool.MaxJobs: unknown key"]);
    assert.deepEqual(problemsOf({ max_jobs: 5 }), ["onetool.max_jobs: unknown key"]);
  });

  test("the problems come after the one of hostServers, backgroundSeconds first, in the order of the table", () => {
    const got = faultOf({
      onetool: {
        maxJobs: 101,
        backgroundSeconds: 0,
        hostServers: 1,
        hostRules: 1,
        logFolder: 1,
        zzz: 1,
      },
    });
    assert.deepEqual(got.problems, [
      "mcpServers: missing",
      "onetool.zzz: unknown key",
      "onetool.logFolder: must be a full path",
      "onetool.hostRules: must be true or false",
      "onetool.hostServers: must be a list of server names",
      BACKGROUND,
      MAX_JOBS,
    ]);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("no problem holds a value of the file", () => {
    const problems = problemsOf({ backgroundSeconds: "SECRET-1", maxJobs: "SECRET-2" });
    assert.equal(problems.length, 2);
    assert.ok(!problems.join(" ").includes("SECRET"));
  });
});

// -- formatRun and the kind stopped ----------------------------------------------------------------------------

describe("step 6: formatRun and the kind stopped", () => {
  const stopped = (message, logs = []) => ({ ok: false, error: { kind: "stopped", message }, logs });

  test("kind stopped", () => {
    assert.equal(formatRun(stopped("killed by the caller")), "The program was stopped on request.");
  });

  test("the message is not read, and the timeout does not change the text", () => {
    assert.equal(formatRun(stopped("")), "The program was stopped on request.");
    assert.equal(formatRun(stopped("any other text")), "The program was stopped on request.");
    assert.equal(formatRun(stopped("m"), { timeoutSeconds: 5 }), "The program was stopped on request.");
    assert.equal(formatRun(stopped("m"), {}), "The program was stopped on request.");
  });

  test("the logs follow it as they follow any other first line", () => {
    assert.equal(
      formatRun(stopped("m", ["l1", "l2"])),
      "The program was stopped on request.\n--- console.log ---\nl1\nl2",
    );
    assert.equal(formatRun(stopped("m", [])), "The program was stopped on request.");
  });

  test("the five older rows are unchanged", () => {
    const fail = (kind, message) => ({ ok: false, error: { kind, message }, logs: [] });
    assert.equal(formatRun({ ok: true, value: undefined, logs: [] }), "undefined");
    assert.equal(formatRun({ ok: true, value: "a", logs: [] }), "a");
    assert.equal(formatRun({ ok: true, value: { a: 1 }, logs: [] }), '{"a":1}');
    assert.equal(formatRun(fail("error", "boom")), "The program failed: boom");
    assert.equal(formatRun(fail("timeout", "m"), { timeoutSeconds: 0.5 }), "The program was stopped after 0.5 seconds.");
    assert.equal(formatRun(fail("crash", "exit code 1")), "The program's process ended before it answered (exit code 1).");
  });
});

// -- runRequest ------------------------------------------------------------------------------------------------

describe("step 6: runRequest, the three things a call asks for", () => {
  const NEEDS_CODE = 'onetool: run needs "code", a text';
  const SEVERAL = 'onetool: run takes one of "code", "job" and "jobs", not several';
  const TAKES = (name) => `onetool: run takes "${name}", true or false`;
  const TAKES_JOB = 'onetool: run takes "job", the id of a job';
  const STOP_ONLY = 'onetool: run takes "stop" only with "job"';
  const BACKGROUND_ONLY = 'onetool: run takes "background" only with "code"';
  const problem = (text) => ({ problem: text });

  test("the examples of the meeting point", () => {
    assert.deepEqual(runRequest({ code: "1" }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ code: "1", background: true, job: "", stop: false, jobs: false }), {
      mode: "run",
      code: "1",
      background: true,
    });
    assert.deepEqual(runRequest({ job: "j1", stop: true, code: "" }), { mode: "job", job: "j1", stop: true });
    assert.deepEqual(runRequest({ jobs: true }), { mode: "jobs" });
    assert.deepEqual(runRequest({}), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: 5 }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ jobs: false }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: "1", job: "j1" }), problem(SEVERAL));
    assert.deepEqual(runRequest({ stop: true }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: "1", stop: true }), problem(STOP_ONLY));
    assert.deepEqual(runRequest({ background: "yes", code: "1" }), problem(TAKES("background")));
  });

  test("the results have exactly their keys", () => {
    assert.deepEqual(Object.keys(runRequest({ code: "1" })).sort(), ["background", "code", "mode"]);
    assert.deepEqual(Object.keys(runRequest({ job: "j" })).sort(), ["job", "mode", "stop"]);
    assert.deepEqual(Object.keys(runRequest({ jobs: true })), ["mode"]);
    assert.deepEqual(Object.keys(runRequest({})), ["problem"]);
  });

  test("test 1: args is not a plain object, nothing throws", () => {
    for (const args of [undefined, null, [], [{ code: "1" }], "code", "", 5, 0, true, false, () => ({ code: "1" })]) {
      assert.deepEqual(runRequest(args), problem(NEEDS_CODE), String(args));
    }
    assert.deepEqual(runRequest(), problem(NEEDS_CODE));
  });

  test("a code that is a string, the empty one included, runs; code is not trimmed", () => {
    assert.deepEqual(runRequest({ code: "" }), { mode: "run", code: "", background: false });
    assert.deepEqual(runRequest({ code: "  1 \n" }), { mode: "run", code: "  1 \n", background: false });
    assert.deepEqual(runRequest({ code: "   " }), { mode: "run", code: "   ", background: false });
  });

  test("background, stop and jobs ask only when exactly true; false, absent and undefined are the same", () => {
    assert.deepEqual(runRequest({ code: "1", background: false }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ code: "1", background: undefined }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ code: "1", background: true }), { mode: "run", code: "1", background: true });
    assert.deepEqual(runRequest({ code: "1", stop: false, jobs: false }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ code: "1", stop: undefined, jobs: undefined }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ job: "j1", stop: false }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ job: "j1", stop: undefined }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ job: "j1" }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ jobs: true, background: false, stop: false }), { mode: "jobs" });
  });

  test("test 2: background, stop or jobs that is not absent, undefined, null (since step 7), true or false", () => {
    for (const name of ["background", "stop", "jobs"]) {
      for (const value of ["true", "false", "yes", "", 1, 0, [], [true], {}]) {
        assert.deepEqual(runRequest({ code: "1", [name]: value }), problem(TAKES(name)), `${name} ${JSON.stringify(value)}`);
      }
    }
  });

  test("test 2 names the first that is not valid, in the order background, stop, jobs, and comes before the rest", () => {
    assert.deepEqual(runRequest({ jobs: "z", stop: "y", background: "x", code: "1" }), problem(TAKES("background")));
    assert.deepEqual(runRequest({ jobs: "z", stop: "y", code: "1" }), problem(TAKES("stop")));
    assert.deepEqual(runRequest({ jobs: "z" }), problem(TAKES("jobs")));
    assert.deepEqual(runRequest({ job: 5, background: "x" }), problem(TAKES("background")));
    assert.deepEqual(runRequest({ code: "1", job: "j1", background: "x" }), problem(TAKES("background")));
  });

  test("test 3: job that is not absent, undefined, null or a string", () => {
    for (const job of [5, 0, true, false, [], ["j1"], {}]) {
      assert.deepEqual(runRequest({ code: "1", job }), problem(TAKES_JOB), JSON.stringify(job));
      assert.deepEqual(runRequest({ job }), problem(TAKES_JOB), JSON.stringify(job));
    }
    assert.deepEqual(runRequest({ job: 5, jobs: true }), problem(TAKES_JOB));
  });

  test("job asks only when it is a string that is not empty; null, empty and undefined are the same as absent", () => {
    for (const job of [null, "", undefined]) {
      assert.deepEqual(runRequest({ code: "1", job }), { mode: "run", code: "1", background: false }, String(job));
      assert.deepEqual(runRequest({ jobs: true, job }), { mode: "jobs" }, String(job));
      assert.deepEqual(runRequest({ job }), problem(NEEDS_CODE), String(job));
    }
  });

  test("a job of white space only is not empty: it asks, and is returned as given", () => {
    assert.deepEqual(runRequest({ job: "  " }), { mode: "job", job: "  ", stop: false });
    assert.deepEqual(runRequest({ job: " j1 ", stop: true }), { mode: "job", job: " j1 ", stop: true });
    assert.deepEqual(runRequest({ code: "1", job: "  " }), problem(SEVERAL));
  });

  test("test 4: none of the three is asked for", () => {
    assert.deepEqual(runRequest({ background: true }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ background: false, stop: false, jobs: false, job: null }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: undefined }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: undefined, stop: true }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ foo: 1 }), problem(NEEDS_CODE));
  });

  test("code is given when the key has a value that is not undefined: null and the wrong kinds then fail the type test", () => {
    for (const code of [null, 5, 0, true, false, [], ["1"], {}]) {
      assert.deepEqual(runRequest({ code }), problem(NEEDS_CODE), JSON.stringify(code));
      assert.deepEqual(runRequest({ code, background: true }), problem(NEEDS_CODE), JSON.stringify(code));
      assert.deepEqual(runRequest({ code, stop: true }), problem(NEEDS_CODE), JSON.stringify(code));
    }
  });

  test("test 5: more than one of code, job and jobs", () => {
    assert.deepEqual(runRequest({ code: "1", jobs: true }), problem(SEVERAL));
    assert.deepEqual(runRequest({ job: "j1", jobs: true }), problem(SEVERAL));
    assert.deepEqual(runRequest({ code: "1", job: "j1", jobs: true }), problem(SEVERAL));
    assert.deepEqual(runRequest({ code: "", job: "j1", jobs: true }), problem(SEVERAL));
  });

  test("when job or jobs asks, a code that is null or empty counts as not given; any other value is given", () => {
    for (const code of [null, "", undefined]) {
      assert.deepEqual(runRequest({ job: "j1", code }), { mode: "job", job: "j1", stop: false }, String(code));
      assert.deepEqual(runRequest({ jobs: true, code }), { mode: "jobs" }, String(code));
    }
    assert.deepEqual(runRequest({ job: "j1", stop: true, code: null }), { mode: "job", job: "j1", stop: true });
    for (const code of ["1", " ", 0, 5, false, [], {}]) {
      assert.deepEqual(runRequest({ job: "j1", code }), problem(SEVERAL), JSON.stringify(code));
      assert.deepEqual(runRequest({ jobs: true, code }), problem(SEVERAL), JSON.stringify(code));
    }
  });

  test("asked code: a string else the problem; then stop does not ask", () => {
    assert.deepEqual(runRequest({ code: 5, stop: true }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: "1", stop: true }), problem(STOP_ONLY));
    assert.deepEqual(runRequest({ code: "1", stop: true, background: true }), problem(STOP_ONLY));
    assert.deepEqual(runRequest({ code: "", stop: true }), problem(STOP_ONLY));
  });

  test("asked job: background does not ask; stop is returned as asked", () => {
    assert.deepEqual(runRequest({ job: "j1", background: true }), problem(BACKGROUND_ONLY));
    assert.deepEqual(runRequest({ job: "j1", background: true, stop: true }), problem(BACKGROUND_ONLY));
    assert.deepEqual(runRequest({ job: "j1", background: false, stop: true }), { mode: "job", job: "j1", stop: true });
  });

  test("asked jobs: background must not ask, then stop must not ask, each with its own problem of test 2", () => {
    assert.deepEqual(runRequest({ jobs: true, background: true }), problem(TAKES("background")));
    assert.deepEqual(runRequest({ jobs: true, stop: true }), problem(TAKES("stop")));
    assert.deepEqual(runRequest({ jobs: true, background: true, stop: true }), problem(TAKES("background")));
  });

  test("every other key of args is ignored", () => {
    assert.deepEqual(runRequest({ code: "1", foo: 1, mode: "jobs", problem: "x" }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ job: "j", timeout: 5, id: "k" }), { mode: "job", job: "j", stop: false });
    assert.deepEqual(runRequest({ jobs: true, mode: "run", code: null }), { mode: "jobs" });
  });

  test("it does not change its argument and prints nothing", () => {
    const args = deepFreeze({ code: "1", background: true, job: null, stop: false, jobs: false });
    const printed = printedBy(() => {
      runRequest(args);
      runRequest(deepFreeze({ job: "j1", stop: true }));
      runRequest(deepFreeze({ jobs: true, code: "1" }));
    });
    assert.deepEqual(printed, []);
  });
});

// -- the texts of a job ----------------------------------------------------------------------------------------

describe("step 6: jobState", () => {
  const fail = (kind) => ({ ok: false, error: { kind, message: "m" }, logs: [] });

  test("ok is done", () => {
    assert.equal(jobState({ ok: true, value: 1, logs: [] }), "done");
    assert.equal(jobState({ ok: true, value: undefined, logs: ["x"] }), "done");
    assert.equal(jobState({ ok: true, value: "a", logs: [] }), "done");
  });

  test("error and crash are failed", () => {
    assert.equal(jobState(fail("error")), "failed");
    assert.equal(jobState(fail("crash")), "failed");
  });

  test("timeout and stopped are stopped", () => {
    assert.equal(jobState(fail("timeout")), "stopped");
    assert.equal(jobState(fail("stopped")), "stopped");
  });
});

describe("step 6: jobStarted, jobLimitMessage and noJobMessage", () => {
  test("jobStarted", () => {
    assert.equal(jobStarted("j1"), 'Job j1 started. Its state: run({ job: "j1" }). To stop it: run({ job: "j1", stop: true }).');
    assert.equal(jobStarted("j12"), 'Job j12 started. Its state: run({ job: "j12" }). To stop it: run({ job: "j12", stop: true }).');
  });

  test("jobLimitMessage: always `jobs`, also for 0 and 1", () => {
    const text = (n) =>
      `onetool: the job was not started: no more than ${n} jobs may run at once (onetool.maxJobs). Wait for one to end, or stop one.`;
    assert.equal(jobLimitMessage(3), text(3));
    assert.equal(jobLimitMessage(0), text(0));
    assert.equal(jobLimitMessage(1), text(1));
    assert.equal(jobLimitMessage(100), text(100));
  });

  test("noJobMessage", () => {
    assert.equal(noJobMessage("j7"), "onetool: no job j7 in this session. run({ jobs: true }) lists them.");
    assert.equal(noJobMessage("nope"), "onetool: no job nope in this session. run({ jobs: true }) lists them.");
  });
});

describe("step 6: jobLine and formatJobs", () => {
  test("the example of the meeting point", () => {
    assert.equal(jobLine({ id: "j2", state: "running", startedAt: 1000, endedAt: null }, 13999), "j2: running, 12 s");
  });

  test("a running job runs until now; the whole seconds, rounded down", () => {
    const job = (startedAt) => ({ id: "j1", state: "running", startedAt, endedAt: null });
    assert.equal(jobLine(job(5000), 5000), "j1: running, 0 s");
    assert.equal(jobLine(job(5000), 5999), "j1: running, 0 s");
    assert.equal(jobLine(job(5000), 6000), "j1: running, 1 s");
    assert.equal(jobLine(job(0), 3600000), "j1: running, 3600 s");
  });

  test("an ended job runs until endedAt, whatever now is; endedAt 0 is a number", () => {
    const base = { id: "j3", startedAt: 1000 };
    assert.equal(jobLine({ ...base, state: "done", endedAt: 3999 }, 900000), "j3: done, 2 s");
    assert.equal(jobLine({ ...base, state: "failed", endedAt: 4000 }, 4000), "j3: failed, 3 s");
    assert.equal(jobLine({ ...base, state: "stopped", endedAt: 1000 }, 99999), "j3: stopped, 0 s");
    assert.equal(jobLine({ id: "j3", state: "done", startedAt: 0, endedAt: 0 }, 50000), "j3: done, 0 s");
  });

  test("a negative result counts as 0", () => {
    assert.equal(jobLine({ id: "j1", state: "running", startedAt: 5000, endedAt: null }, 1000), "j1: running, 0 s");
    assert.equal(jobLine({ id: "j1", state: "done", startedAt: 5000, endedAt: 4000 }, 9000), "j1: done, 0 s");
    assert.equal(jobLine({ id: "j1", state: "running", startedAt: 5000, endedAt: null }, 4999), "j1: running, 0 s");
  });

  test("the state and the id are put in as they are; other keys are not read", () => {
    const job = { id: "job-é 1", state: "stopped", startedAt: 0, endedAt: 2000, progress: ["x"], progressCount: 9, answer: "a" };
    assert.equal(jobLine(job, 0), "job-é 1: stopped, 2 s");
  });

  test("formatJobs: the lines in the order given, joined by a line break, none at the end", () => {
    const jobs = [
      { id: "j2", state: "done", startedAt: 0, endedAt: 4500 },
      { id: "j1", state: "running", startedAt: 1000, endedAt: null },
      { id: "j3", state: "failed", startedAt: 2000, endedAt: 2999 },
    ];
    assert.equal(formatJobs(jobs, 10999), "j2: done, 4 s\nj1: running, 9 s\nj3: failed, 0 s");
    assert.equal(formatJobs(jobs.slice(1, 2), 10999), "j1: running, 9 s");
  });

  test("formatJobs of an empty list", () => {
    assert.equal(formatJobs([], 5000), "No job in this session.");
  });
});

describe("step 6: formatJob", () => {
  const job = (more = {}) => ({
    id: "j1",
    state: "running",
    startedAt: 0,
    endedAt: null,
    progress: [],
    progressCount: 0,
    answer: null,
    ...more,
  });

  test("the example of the meeting point", () => {
    const done = { id: "j1", state: "done", startedAt: 0, endedAt: 2500, progress: ["half", "all"], progressCount: 2, answer: "625" };
    assert.equal(formatJob(done, 9000), "job j1: done, 2 s\n--- progress ---\nhalf\nall\n--- answer ---\n625");
  });

  test("a running job with no line posted is one line", () => {
    assert.equal(formatJob(job(), 9000), "job j1: running, 9 s");
    assert.equal(formatJob(job(), 9999), "job j1: running, 9 s");
  });

  test("the first line is `job ` and the jobLine", () => {
    const j = job({ id: "j4", state: "failed", startedAt: 1000, endedAt: 5000, answer: "The program failed: boom" });
    assert.equal(formatJob(j, 90000).split("\n")[0], `job ${jobLine(j, 90000)}`);
    assert.equal(formatJob(j, 90000).split("\n")[0], "job j4: failed, 4 s");
  });

  test("progress lines come in order, under the line --- progress ---", () => {
    assert.equal(formatJob(job({ progress: ["a", "b", "c"], progressCount: 3 }), 2000), "job j1: running, 2 s\n--- progress ---\na\nb\nc");
  });

  test("progressCount above the lines kept: a line with the difference, always `lines`", () => {
    // 5 - 2 = 3
    assert.equal(
      formatJob(job({ progress: ["d", "e"], progressCount: 5 }), 0),
      "job j1: running, 0 s\n--- progress ---\n(3 earlier lines not shown)\nd\ne",
    );
    // 2 - 1 = 1
    assert.equal(
      formatJob(job({ progress: ["z"], progressCount: 2 }), 0),
      "job j1: running, 0 s\n--- progress ---\n(1 earlier lines not shown)\nz",
    );
    // 1000 - 3 = 997
    assert.equal(
      formatJob(job({ progress: ["a", "b", "c"], progressCount: 1000 }), 0).split("\n")[2],
      "(997 earlier lines not shown)",
    );
  });

  test("progressCount equal to the lines kept: no such line", () => {
    assert.ok(!formatJob(job({ progress: ["a", "b"], progressCount: 2 }), 0).includes("earlier"));
  });

  test("no progress kept: no progress section at all, whatever progressCount says", () => {
    assert.equal(formatJob(job({ progress: [], progressCount: 7 }), 3000), "job j1: running, 3 s");
    assert.equal(
      formatJob(job({ state: "done", endedAt: 1000, progress: [], progressCount: 7, answer: "x" }), 3000),
      "job j1: done, 1 s\n--- answer ---\nx",
    );
  });

  test("line breaks in a progress item, \\r\\n or \\n or \\r, are each one space", () => {
    const got = formatJob(job({ progress: ["a\r\nb\nc\rd"], progressCount: 1 }), 0);
    assert.equal(got, "job j1: running, 0 s\n--- progress ---\na b c d");
    assert.equal(formatJob(job({ progress: ["a\n\nb"], progressCount: 1 }), 0).split("\n")[2], "a  b");
    assert.equal(formatJob(job({ progress: ["a\r\n\r\nb"], progressCount: 1 }), 0).split("\n")[2], "a  b");
    assert.equal(formatJob(job({ progress: ["\nx\n"], progressCount: 1 }), 0).split("\n")[2], " x ");
  });

  test("an item longer than lineLimit is its first lineLimit characters and `...`; exactly lineLimit is not cut", () => {
    const lines = (j, opts) => formatJob(j, 0, opts).split("\n").slice(2);
    assert.deepEqual(lines(job({ progress: ["abcdef"], progressCount: 1 }), { lineLimit: 3 }), ["abc..."]);
    assert.deepEqual(lines(job({ progress: ["abc"], progressCount: 1 }), { lineLimit: 3 }), ["abc"]);
    assert.deepEqual(lines(job({ progress: ["ab"], progressCount: 1 }), { lineLimit: 3 }), ["ab"]);
    assert.deepEqual(lines(job({ progress: ["abcd"], progressCount: 1 }), { lineLimit: 3 }), ["abc..."]);
    assert.deepEqual(lines(job({ progress: ["abcdef", "xy", "uvwxyz"], progressCount: 3 }), { lineLimit: 1 }), ["a...", "x...", "u..."]);
  });

  test("the line breaks are replaced before the length is counted", () => {
    const lines = (j, opts) => formatJob(j, 0, opts).split("\n").slice(2);
    // "ab\r\ncd" is "ab cd": 5 characters
    assert.deepEqual(lines(job({ progress: ["ab\r\ncd"], progressCount: 1 }), { lineLimit: 5 }), ["ab cd"]);
    assert.deepEqual(lines(job({ progress: ["ab\r\ncd"], progressCount: 1 }), { lineLimit: 4 }), ["ab c..."]);
    assert.deepEqual(lines(job({ progress: ["ab\ncd\nef"], progressCount: 1 }), { lineLimit: 4 }), ["ab c..."]);
  });

  test("the default lineLimit is 200", () => {
    const at = (n) => formatJob(job({ progress: ["x".repeat(n)], progressCount: 1 }), 0).split("\n")[2];
    assert.equal(at(200), "x".repeat(200));
    assert.equal(at(201), `${"x".repeat(200)}...`);
    assert.equal(at(5000), `${"x".repeat(200)}...`);
    const withEmpty = formatJob(job({ progress: ["x".repeat(201)], progressCount: 1 }), 0, {}).split("\n")[2];
    assert.equal(withEmpty, `${"x".repeat(200)}...`);
  });

  test("an empty item is an empty line", () => {
    assert.equal(formatJob(job({ progress: ["", "x"], progressCount: 2 }), 0), "job j1: running, 0 s\n--- progress ---\n\nx");
  });

  test("the answer, as it is: line breaks kept, nothing cut, the lineLimit does not touch it", () => {
    const answer = `${"y".repeat(500)}\r\nsecond\nthird\n`;
    const got = formatJob(job({ state: "done", endedAt: 1000, answer }), 5000, { lineLimit: 5 });
    assert.equal(got, `job j1: done, 1 s\n--- answer ---\n${answer}`);
  });

  test("the answer, the empty string included: the text ends with the line break after --- answer ---", () => {
    assert.equal(formatJob(job({ state: "done", endedAt: 1000, answer: "" }), 5000), "job j1: done, 1 s\n--- answer ---\n");
    assert.ok(formatJob(job({ state: "done", endedAt: 1000, answer: "" }), 5000).endsWith("--- answer ---\n"));
  });

  test("a job whose answer is null has no answer section", () => {
    assert.ok(!formatJob(job({ progress: ["a"], progressCount: 1 }), 0).includes("--- answer ---"));
  });

  test("the sections come in order: job line, progress, answer; no line break at the end", () => {
    const j = job({ state: "stopped", endedAt: 4000, progress: ["a", "b"], progressCount: 4, answer: "The program was stopped on request." });
    assert.equal(
      formatJob(j, 100000),
      [
        "job j1: stopped, 4 s",
        "--- progress ---",
        "(2 earlier lines not shown)",
        "a",
        "b",
        "--- answer ---",
        "The program was stopped on request.",
      ].join("\n"),
    );
  });

  test("a failed job and a job with the answer but no progress", () => {
    assert.equal(
      formatJob(job({ state: "failed", startedAt: 1000, endedAt: 3500, answer: "The program failed: boom" }), 0),
      "job j1: failed, 2 s\n--- answer ---\nThe program failed: boom",
    );
  });

  test("none of them changes its arguments or prints", () => {
    const j = deepFreeze({
      id: "j1",
      state: "done",
      startedAt: 0,
      endedAt: 1500,
      progress: ["a\nb", "c".repeat(300)],
      progressCount: 9,
      answer: "x",
    });
    const opts = deepFreeze({ lineLimit: 10 });
    const jobs = deepFreeze([{ id: "j1", state: "running", startedAt: 0, endedAt: null }]);
    const printed = printedBy(() => {
      formatJob(j, 5000, opts);
      formatJob(j, 5000);
      jobLine(j, 5000);
      formatJobs(jobs, 5000);
      formatJobs(deepFreeze([]), 5000);
      jobState(deepFreeze({ ok: false, error: { kind: "stopped", message: "m" }, logs: ["l"] }));
      jobStarted("j1");
      jobLimitMessage(3);
      noJobMessage("j1");
      formatRun(deepFreeze({ ok: false, error: { kind: "stopped", message: "m" }, logs: ["l"] }), deepFreeze({ timeoutSeconds: 2 }));
    });
    assert.deepEqual(printed, []);
  });
});
