// Step 8: the sequences file (the meeting point of server, "Step 8: tidying the library", "The sequences file") and the end
// ("Tidying, the end, signals, time limits and waits"). Every test starts the command with HOME a folder it made, says "trail"
// and "log", and gives `timeoutSeconds` 10 at most.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rawOnetool, settingsOf, sleep, waitFor } from "./helpers.js";
import { jobsOf, viaCtx } from "./jobhelpers.js";
import {
  COUNT,
  FAILED,
  SAVE_IT,
  fileIn,
  inLib,
  libSettings,
  names,
  putProgram,
  putRaw,
  world,
} from "./libhelpers.js";
import { UUID, logEntries } from "./recordhelpers.js";
import { ran } from "./shellhelpers.js";
import {
  REPORT,
  putArchived,
  putSequences,
  sequenceLineOf,
  sequenceObjects,
  sequencesOf,
  sequencesText,
  splitReport,
} from "./tidyhelpers.js";

const COUNT_PARIS = '(await tools.practice.count({ city: "Paris" })).count';
const WITH_LOG = (w, onetool = {}) => libSettings({ log: true, logFolder: w.L, ...onetool });

describe("when a line is written", () => {
  test("a program that named a tool and ended well: one line `{ time, session, sequence }`, whole, in the file when `run` answers; the folder is made", async () => {
    const w = world();
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const before = Date.now();
      const answer = await ran(ctx, "await tools.practice.rows({});\nawait tools.practice.count({});\nawait tools.practice.count({});\n1");
      const after = Date.now();
      assert.equal(answer.isError, false, answer.text);
      // read at once: the line of the program is in the file when `run` answers
      const text = sequencesText(w);
      assert.ok(text !== null, "the file is there");
      assert.ok(text.endsWith("\n") && text.indexOf("\n") === text.length - 1, "one line, one line break after it");
      const [line] = sequenceObjects(w);
      assert.deepEqual(Object.keys(line), ["time", "session", "sequence"]);
      assert.deepEqual(line.sequence, ["practice.rows", "practice.count", "practice.count"], "the tools the text names, as often as it names them");
      assert.equal(new Date(line.time).toISOString(), line.time);
      assert.ok(Date.parse(line.time) >= before - 1 && Date.parse(line.time) <= after + 1, `${line.time} is the time of the program`);
      assert.equal(`${JSON.stringify(line)}\n`, text, "no space, no other key");
      assert.deepEqual(names(join(w.H, ".onetool")), ["sequences.jsonl"], "the folder is made, and nothing else in it");
      // the session is the one of the lines of the log
      const sessions = new Set(logEntries(w.L).map((entry) => entry.session));
      assert.deepEqual([...sessions], [line.session]);
      assert.match(line.session, UUID);
    });
  });

  test("a line each time 1 is added to the count: the third time and the fourth too; the lines are appended to what the file holds", async () => {
    const w = world();
    const held = `${sequenceLineOf(["other.tool"])}\nnot a line of ours\n`;
    putSequences(w, held);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answers = [];
      for (let time = 1; time <= 4; time++) answers.push(await ran(ctx, COUNT_PARIS));
      assert.ok(answers[2].text.endsWith(SAVE_IT(3)), "the note of step 7 is what it was");
      const text = sequencesText(w);
      assert.ok(text.startsWith(held), "what the file held is kept, whole");
      const added = text.slice(held.length).split("\n");
      assert.equal(added.pop(), "", "each line ends with a line break");
      assert.equal(added.length, 4);
      for (const line of added) assert.deepEqual(Object.keys(JSON.parse(line)), ["time", "session", "sequence"]);
      assert.deepEqual(added.map((line) => JSON.parse(line).sequence), Array(4).fill(["practice.count"]));
    });
  });

  test("the line holds the ids of the tools and nothing else of the program: never its text, an argument or an answer", async () => {
    const w = world();
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answer = await ran(ctx, '// SECRET-COMMENT\nconst said = await tools.practice.echo({ text: "SECRET-ARGUMENT" });\nsaid');
      assert.equal(answer.text.split("\n")[0], "SECRET-ARGUMENT");
      const text = sequencesText(w);
      assert.equal(text.includes("SECRET"), false);
      assert.deepEqual(sequenceObjects(w).map((line) => line.sequence), [["practice.echo"]]);
    });
  });

  test("no line for: a program that names no tool, one that calls a saved program, one that does what a saved program does, one that failed", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "Counts the rows of one city.", params: ["city"], code: COUNT });
    await inLib(w, WITH_LOG(w), async (ctx) => {
      await ran(ctx, "1 + 1");
      await ran(ctx, 'await lib.cityCount({ city: "Lyon" })');
      const same = await ran(ctx, '(await tools.practice.rows({ city: "Nice" })).rows.length');
      assert.ok(same.text.endsWith("(lib.cityCount does this: call it)"), same.text);
      const thrown = await ran(ctx, 'await tools.practice.count({});\nthrow new Error("after the call")');
      assert.equal(thrown.isError, true);
      const failedCall = await ran(ctx, "await tools.practice.fail({})");
      assert.equal(failedCall.isError, true);
      assert.equal(sequencesText(w), null, "nothing was written, the folder was not made");
      assert.equal(existsSync(join(w.H, ".onetool", "sequences.jsonl")), false);
      // and a program that ends well after them writes its own line only
      await ran(ctx, COUNT_PARIS);
      assert.deepEqual(sequenceObjects(w).map((line) => line.sequence), [["practice.count"]]);
    });
  });

  test("with the log switched off nothing is written and no folder is made, and the note and the count are what they were", async () => {
    const w = world();
    await inLib(w, libSettings({ log: false }), async (ctx) => {
      const answers = [];
      for (let time = 1; time <= 4; time++) answers.push(await ran(ctx, COUNT_PARIS));
      assert.deepEqual(answers.map((answer) => answer.text.split("\n").length), [3, 3, 4, 3]);
      assert.equal(answers[2].text.split("\n")[3], SAVE_IT(3));
    });
    assert.deepEqual(names(w.H), [], "no file and no folder");
  });

  test("a job that ended well: its line is in the file when its end is known", async () => {
    const w = world();
    await inLib(w, WITH_LOG(w, { backgroundSeconds: 10 }), async (ctx) => {
      const jobs = jobsOf(viaCtx(ctx));
      await jobs.start("await tools.practice.rows({});\nawait tools.practice.echo({ text: 'x' });\n1");
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, false, ended.text);
      assert.deepEqual(sequenceObjects(w).map((line) => line.sequence), [["practice.rows", "practice.echo"]]);
    });
  });

  test("programs that end together: every line is whole, one for each", async () => {
    const w = world();
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answers = await Promise.all(Array.from({ length: 6 }, () => ran(ctx, COUNT_PARIS)));
      assert.ok(answers.every((answer) => answer.isError === false));
      const text = sequencesText(w);
      const lines = text.split("\n");
      assert.equal(lines.pop(), "");
      assert.equal(lines.length, 6);
      for (const line of lines) assert.deepEqual(JSON.parse(line).sequence, ["practice.count"]);
    });
  });
});

describe("a line that cannot be written", () => {
  test("the answer is what it would be, and `onetool: the log cannot be written` is said once on standard error, however many lines fail", async () => {
    const w = world();
    putRaw(w.H, ".onetool", "this is a file, so no folder can be made in it");
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answers = [];
      for (let time = 1; time <= 3; time++) answers.push(await ran(ctx, COUNT_PARIS));
      assert.deepEqual(answers.map((answer) => [answer.isError, answer.text.split("\n").length, answer.text.split("\n")[0]]), [
        [false, 3, "625"],
        [false, 3, "625"],
        [false, 4, "625"],
      ]);
      assert.equal(answers[2].text.split("\n")[3], SAVE_IT(3));
      await waitFor(() => ctx.stderrLines().includes("onetool: the log cannot be written"), 5000, "the line about the log");
      await sleep(250);
      assert.deepEqual(ctx.stderrLines(), ["onetool: the log cannot be written"]);
      assert.equal(ctx.stderr().includes(w.H), false, "no path");
    });
  });

  test("once for the life of the process also when the log itself and the sequences fail", async () => {
    const w = world();
    putRaw(w.H, ".onetool", "this is a file, so no folder can be made in it");
    putRaw(w.L, "blocker", "a file where the log folder should be");
    await inLib(w, libSettings({ log: true, logFolder: join(w.L, "blocker", "sub") }), async (ctx) => {
      for (let time = 1; time <= 3; time++) assert.equal((await ran(ctx, COUNT_PARIS)).text.split("\n")[0], "625");
      await waitFor(() => ctx.stderrLines().length >= 1, 5000, "the line about the log");
      await sleep(250);
      assert.deepEqual(ctx.stderrLines(), ["onetool: the log cannot be written"]);
    });
  });
});

describe("the sequences last from one session to the next", () => {
  test("three programs with the same unsaved sequence in three processes: `3 times: <the sequence>`; once a program with that sequence is saved the line is gone, the file unchanged", async () => {
    const w = world();
    for (let round = 1; round <= 3; round++) {
      await inLib(w, WITH_LOG(w), async (ctx) => {
        const answer = await ran(ctx, COUNT_PARIS);
        assert.equal(answer.text.split("\n").length, 3, "the count in memory is 1: no note");
      });
    }
    const lines = sequenceObjects(w);
    assert.equal(lines.length, 3);
    assert.equal(new Set(lines.map((line) => line.session)).size, 3, "one session per process");
    for (const line of lines) assert.match(line.session, UUID);
    const sessionsOfLog = new Set(logEntries(w.L).map((entry) => entry.session));
    assert.deepEqual([...sessionsOfLog].sort(), lines.map((line) => line.session).sort());
    const written = sequencesText(w);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      assert.deepEqual(splitReport((await ran(ctx, REPORT)).text).report.slice(-2), [
        "--- sequences of calls run 3 times or more and not saved ---",
        "3 times: practice.count",
      ]);
      putProgram(w.UL, "parisCount", { about: "Counts Paris.", code: COUNT_PARIS });
      assert.deepEqual(splitReport((await ran(ctx, REPORT)).text).report.slice(-2), [
        "--- sequences of calls run 3 times or more and not saved ---",
        "(none)",
      ]);
    });
    assert.equal(sequencesText(w), written, "the file is as it was");
  });
});

describe("the end", () => {
  // a program that restores one program (so a file appears), then asks for reports for a long time, and never ends
  const BUSY =
    'await library.restore("old");\nfor (let i = 0; i < 100000; i++) await library.report();\nawait new Promise(() => {})';

  for (const how of ["SIGTERM", "SIGINT", "standard input closed"]) {
    test(`${how} while a program restores and asks for reports: exit code 0 within 5 seconds, onetool does not wait for them`, async () => {
      const w = world();
      putArchived(w.UA, "old", { about: "An old one.", code: '"old"' });
      const raw = rawOnetool(settingsOf({}, { trail: true, log: true, logFolder: w.L, timeoutSeconds: 10 }), { env: { HOME: w.H } });
      try {
        await raw.initialize();
        let answered = null;
        raw.callTool("run", { code: BUSY }, 15000).then((message) => (answered = message), () => {});
        await waitFor(() => {
          if (answered !== null) assert.fail(`the program ended before the end: ${JSON.stringify(answered.result ?? answered.error)}`);
          return existsSync(join(w.UL, "old.js"));
        }, 5000, "the restore");
        if (how === "standard input closed") {
          raw.child.stdin.end();
          assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
        } else {
          assert.deepEqual(await raw.endBy(how, 5000), { code: 0, signal: null });
        }
        assert.equal(fileIn(w.UL, "old.js").startsWith("// about: An old one."), true, "what was restored is whole");
      } finally {
        raw.kill();
        await raw.exited;
      }
    });
  }

  test("a signal when nothing runs, with the prompt asked for: the same end, exit code 0", async () => {
    const w = world();
    const raw = rawOnetool(settingsOf({}, { trail: true, log: true, logFolder: w.L, timeoutSeconds: 10 }), { env: { HOME: w.H } });
    try {
      await raw.initialize();
      assert.equal((await raw.request("prompts/list", {}, 3000)).result.prompts.length, 1);
      assert.deepEqual(await raw.endBy("SIGTERM", 5000), { code: 0, signal: null });
    } finally {
      raw.kill();
      await raw.exited;
    }
  });
});

test("a call that was refused leaves no line in the sequences file", async () => {
  const w = world();
  await inLib(w, WITH_LOG(w, { deny: ["practice.count"] }), async (ctx) => {
    const answer = await ran(ctx, COUNT_PARIS);
    assert.equal(answer.isError, true);
    assert.equal(answer.text.split("\n")[0], FAILED('onetool: practice.count is denied by the rule deny "practice.count"'));
    assert.equal(sequencesText(w), null);
    assert.equal(existsSync(sequencesOf(w)), false);
  });
});
