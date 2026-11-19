// Step 12: the line of the trail after three programs of one call each
// (the meeting point of server, "Step 12: leading the session to group its work", "The line of the trail" and "What follows, and must hold").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeEntry, practiceEntry } from "./helpers.js";
import { SAVE_IT, world, putProgram, projectSettings } from "./libhelpers.js";
import { jobsOf } from "./jobhelpers.js";
import { ECHO, LYON, ONE_CALL_NOTE, PARIS, ROWS, THREE, WIPE, callLine, linesOf, settingsFor, withSession } from "./grouphelpers.js";

const SERVERS = () => ({ practice: practiceEntry(), fake: fakeEntry() });
const hasNote = (answer) => answer.lines.includes(ONE_CALL_NOTE);

describe("three programs of one call each", () => {
  test("the first two have their call and nothing more; the third has four lines, the last the note", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const first = await it.run(LYON);
      assert.equal(first.isError, false);
      assert.equal(first.lines.length, 3, first.text);
      assert.deepEqual(first.lines.slice(0, 2), ["625", "--- calls ---"]);
      assert.match(first.lines[2], callLine("practice.count", "13 chars"));
      const second = await it.run(ECHO("a"));
      assert.equal(second.lines.length, 3, second.text);
      assert.equal(second.lines[0], "a");
      const third = await it.run(WIPE);
      assert.equal(third.isError, false);
      assert.equal(third.lines.length, 4, third.text);
      assert.deepEqual(third.lines.slice(0, 2), ["wiped", "--- calls ---"]);
      assert.match(third.lines[2], callLine("practice.wipe", "5 chars"));
      assert.equal(third.lines[3], "(the last 3 programs each made one call: they could have been one program)");
      assert.equal(third.lines[3], ONE_CALL_NOTE);
    });
  });

  test("it is said again only after three more: the fourth and the fifth have no such line, the sixth has it", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const answers = [];
      for (const code of [LYON, ECHO("a"), WIPE, ROWS, PARIS, WIPE]) answers.push(await it.run(code));
      assert.equal(hasNote(answers[2]), true);
      assert.deepEqual(answers.map(hasNote), [false, false, true, false, false, true]);
      assert.equal(answers[5].lines.length, 4, answers[5].text);
      assert.equal(answers[3].lines.length, 3);
      assert.equal(answers[4].lines.length, 3);
    });
  });

  test("three different programs give the line as three runs of the same one do: the streak is of the process", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const answers = [await it.run(ROWS), await it.run(ECHO("x")), await it.run(PARIS)];
      assert.deepEqual(answers.map(hasNote), [false, false, true]);
    });
  });

  test("the same text three times gives two notes at the third run, in this order: the note of step 7, then this one", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const answers = [await it.run(LYON), await it.run(LYON), await it.run(LYON)];
      assert.equal(answers[0].lines.length, 3);
      assert.equal(answers[1].lines.length, 3);
      assert.deepEqual(answers[2].lines.slice(3), [SAVE_IT(3), ONE_CALL_NOTE]);
    });
  });

  test("programs of one call of any kind count: a call of the shell, of the library, of a listed server", async () => {
    const w = world();
    await withSession(projectSettings(w), {}, async (it) => {
      const saved = await it.run('await library.save("one", { about: "One.", code: "1" })');
      const wrote = await it.run('await write("a.txt", "x"); "done"');
      const counted = await it.run(PARIS);
      assert.equal(hasNote(saved), false);
      assert.equal(hasNote(wrote), false);
      assert.equal(hasNote(counted), true, counted.text);
    });
  });

  test("the answer is the same with the trail off: no note is shown, the answers are the texts", async () => {
    await withSession(settingsFor({ trail: false }), {}, async (it) => {
      assert.equal((await it.run(LYON)).text, "625");
      assert.equal((await it.run(ECHO("a"))).text, "a");
      assert.equal((await it.run(WIPE)).text, "wiped");
      assert.equal((await it.run(ROWS)).text, "625");
    });
  });

  test('"instructions": false switches the instructions only: the note is the same', async () => {
    await withSession(settingsFor({ instructions: false }), {}, async (it) => {
      const answers = [await it.run(LYON), await it.run(ECHO("a")), await it.run(WIPE)];
      assert.deepEqual(answers.map(hasNote), [false, false, true]);
    });
  });
});

describe("what puts the streak back to 0", () => {
  // two programs of one call, the program that does not count, two more, then a sixth: the line only at the fifth after the first two
  const PROGRAMS = [LYON, ROWS, PARIS, '(await tools.practice.rows({ city: "Nice" })).rows.length', WIPE];

  async function around(it, breaker) {
    const answers = [await it.run(PROGRAMS[0]), await it.run(PROGRAMS[1])];
    const between = await breaker();
    answers.push(await it.run(PROGRAMS[2]), await it.run(PROGRAMS[3]));
    for (const answer of [...answers, between]) assert.equal(hasNote(answer), false, answer.text);
    const last = await it.run(PROGRAMS[4]);
    assert.equal(last.lines.at(-1), ONE_CALL_NOTE, last.text);
    assert.equal(last.lines.length, 4, last.text);
    return between;
  }

  test("a program that made no call", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const between = await around(it, () => it.run("1 + 1"));
      assert.equal(between.text, "2");
    });
  });

  test("a program that made two calls or three", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      await around(it, () => it.run(THREE));
    });
    await withSession(settingsFor(), {}, async (it) => {
      await around(it, () => it.run('await tools.practice.count({ city: "Nice" }); await tools.practice.count({ city: "Brest" })'));
    });
  });

  test("two programs of one call, one of three, then two of one call: no line; a third program of one call has it", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const answers = [await it.run(LYON), await it.run(ECHO("a")), await it.run(THREE), await it.run(ROWS), await it.run(ECHO("b"))];
      assert.deepEqual(answers.map(hasNote), [false, false, false, false, false]);
      assert.equal(hasNote(await it.run(WIPE)), true);
    });
  });

  test("a program whose answer is a fault (its one call fails, uncaught)", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const between = await around(it, () => it.run("await tools.practice.fail({})"));
      assert.equal(between.isError, true);
    });
  });

  test("a program that catches the failure of its one call and ends well counts", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const first = await it.run(LYON);
      const caught = await it.run('try { await tools.practice.fail({}); return "went"; } catch (error) { return "caught"; }');
      assert.equal(caught.isError, false);
      assert.equal(caught.lines[0], "caught");
      const third = await it.run(ROWS);
      assert.equal(hasNote(first) || hasNote(caught), false);
      assert.equal(third.lines.at(-1), ONE_CALL_NOTE, third.text);
    });
  });

  test("a program stopped at its time limit", async () => {
    await withSession(settingsFor({ timeoutSeconds: 1 }, SERVERS()), {}, async (it) => {
      const between = await around(it, () => it.run("await tools.fake.barrier({})"));
      assert.equal(between.isError, true);
    });
  });

  test("a program whose call is refused by a rule counts when it ends well: it made one call", async () => {
    await withSession(settingsFor({ deny: ["practice.wipe"] }), {}, async (it) => {
      const answers = [await it.run(LYON), await it.run(ROWS)];
      const refused = await it.run('try { await tools.practice.wipe({}); return "went"; } catch (error) { return "refused"; }');
      assert.equal(refused.lines[0], "refused");
      assert.deepEqual([...answers, refused].map(hasNote), [false, false, true]);
    });
  });

  test("a program that calls a saved program, whatever the calls inside it", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "Counts the rows of one city.", params: ["city"], code: "(await tools.practice.rows({ city })).rows.length" });
    putProgram(w.UL, "twice", { about: "Two counts.", code: "await tools.practice.count({}); await tools.practice.count({}); 2" });
    await withSession(settingsFor(), { env: { HOME: w.H } }, async (it) => {
      const between = await around(it, () => it.run('await lib.cityCount({ city: "Lyon" })'));
      assert.equal(between.lines[0], "625");
    });
    await withSession(settingsFor(), { env: { HOME: w.H } }, async (it) => {
      await around(it, () => it.run("await lib.twice()"));
    });
  });

  test("a program whose answer is a fault because the state is too large", async () => {
    await withSession(settingsFor({ stateLimit: 1000 }), {}, async (it) => {
      const between = await around(it, () => it.run('state.big = "x".repeat(2000); await tools.practice.echo({ text: "a" })'));
      assert.equal(between.isError, true);
    });
  });
});

describe("a question reached the host", () => {
  const ASKING = () => settingsFor({ ask: ["practice.echo"] });
  const BREAKER = ECHO("q");

  test("the person said yes: the program does not count, and the streak is back to 0", async () => {
    await withSession(ASKING(), { capabilities: { elicitation: {} }, answer: () => ({ action: "accept" }) }, async (it) => {
      const between = await around(it, () => it.run(BREAKER));
      assert.equal(it.host.questions.length, 1);
      assert.equal(between.lines[0], "q");
    });
  });

  test("the person said no: the program that ends well does not count either", async () => {
    await withSession(ASKING(), { capabilities: { elicitation: {} }, answer: () => ({ action: "decline" }) }, async (it) => {
      await around(it, () => it.run('try { await tools.practice.echo({ text: "q" }); return "went"; } catch (error) { return "declined"; }'));
      assert.equal(it.host.questions.length, 1);
    });
  });

  test("the host cannot ask: that is no question, and a program that ends well with its one call counts", async () => {
    await withSession(ASKING(), { capabilities: {} }, async (it) => {
      const first = await it.run(LYON);
      const unasked = await it.run('try { await tools.practice.echo({ text: "q" }); return "went"; } catch (error) { return "no way to ask"; }');
      assert.equal(unasked.lines[0], "no way to ask");
      assert.equal(it.host.questions.length, 0);
      const third = await it.run(ROWS);
      assert.equal(hasNote(first) || hasNote(unasked), false);
      assert.equal(third.lines.at(-1), ONE_CALL_NOTE, third.text);
    });
  });

  async function around(it, breaker) {
    const answers = [await it.run(LYON), await it.run(ROWS)];
    const between = await breaker();
    answers.push(await it.run(PARIS), await it.run('(await tools.practice.rows({ city: "Nice" })).rows.length'));
    for (const answer of [...answers, between]) assert.equal(hasNote(answer), false, answer.text);
    const last = await it.run(WIPE);
    assert.equal(last.lines.at(-1), ONE_CALL_NOTE, last.text);
    return between;
  }
});

describe("jobs and programs at the same time", () => {
  test("a job in between changes nothing: the third program in the foreground has the line, the answer for the job has none", async () => {
    await withSession(settingsFor({ backgroundSeconds: 30 }), {}, async (it) => {
      const jobs = jobsOf(it.call);
      const first = await it.run(LYON);
      const second = await it.run(ROWS);
      await jobs.start(ECHO("job"));
      const ended = await jobs.untilEnded("j1", 10000);
      assert.ok(ended.text.includes("practice.echo"), ended.text);
      assert.equal(ended.text.includes(ONE_CALL_NOTE), false);
      const third = await it.run(PARIS);
      assert.deepEqual([first, second].map(hasNote), [false, false]);
      assert.equal(third.lines.at(-1), ONE_CALL_NOTE, third.text);
    });
  });

  test("a job that made no call or several does not break the row", async () => {
    await withSession(settingsFor({ backgroundSeconds: 30 }), {}, async (it) => {
      const jobs = jobsOf(it.call);
      const first = await it.run(LYON);
      await jobs.start(THREE);
      await jobs.untilEnded("j1", 10000);
      const second = await it.run(ROWS);
      await jobs.start("1 + 1");
      await jobs.untilEnded("j2", 10000);
      const third = await it.run(PARIS);
      assert.deepEqual([first, second].map(hasNote), [false, false]);
      assert.equal(third.lines.at(-1), ONE_CALL_NOTE, third.text);
    });
  });

  test("three jobs of one call each never make the note: a job never touches the streak", async () => {
    await withSession(settingsFor({ backgroundSeconds: 30, maxJobs: 3 }), {}, async (it) => {
      const jobs = jobsOf(it.call);
      for (const [at, code] of [LYON, ROWS, PARIS].entries()) {
        await jobs.start(code);
        const ended = await jobs.untilEnded(`j${at + 1}`, 10000);
        assert.equal(ended.text.includes(ONE_CALL_NOTE), false, ended.text);
      }
      const first = await it.run(ECHO("a"));
      const second = await it.run(ROWS);
      assert.deepEqual([first, second].map(hasNote), [false, false]);
    });
  });

  test("a question about a call of a job changes nothing for the programs in the foreground", async () => {
    await withSession(settingsFor({ backgroundSeconds: 30, ask: ["practice.echo"] }), { capabilities: { elicitation: {} }, answer: () => ({ action: "accept" }) }, async (it) => {
      const jobs = jobsOf(it.call);
      const first = await it.run(LYON);
      const second = await it.run(ROWS);
      await jobs.start(ECHO("job"));
      const ended = await jobs.untilEnded("j1", 10000);
      assert.equal(it.host.questions.length, 1);
      assert.equal(ended.text.includes(ONE_CALL_NOTE), false);
      const third = await it.run(PARIS);
      assert.deepEqual([first, second].map(hasNote), [false, false]);
      assert.equal(third.lines.at(-1), ONE_CALL_NOTE, third.text);
    });
  });

  test("programs in the foreground at the same time: of three programs of one call each, one has the note, and the numbers are right", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      const answers = await Promise.all([it.run(LYON), it.run(ROWS), it.run(PARIS)]);
      assert.equal(answers.filter(hasNote).length, 1, answers.map((answer) => answer.text).join("\n---\n"));
      assert.equal(linesOf(await it.search()).at(-1), "this session: 3 programs, 3 calls, 1.0 calls per program");
    });
  });
});
