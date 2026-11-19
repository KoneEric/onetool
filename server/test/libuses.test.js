// Step 7: "When the program's result is there" (the meeting point of server, "Step 7: the library"): the uses, the failures in a row and the
// move to the archive, the sequence of calls and the three notes of the trail; what follows, and must hold; the end.
// The saved programs are written by hand. Every test starts the command with HOME a folder it made.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ONE_CALL_NOTE, rawOnetool, settingsOf, sleep, waitFor } from "./helpers.js";
import { jobsOf, viaCtx } from "./jobhelpers.js";
import {
  ARCHIVED,
  COUNT,
  FAILED,
  SAME_AS,
  SAVE_IT,
  archivedOf,
  fileIn,
  inLib,
  libSettings,
  names,
  okLine,
  programText,
  projectSettings,
  putProgram,
  putRaw,
  saveCall,
  statsOf,
  world,
} from "./libhelpers.js";
import { ran } from "./shellhelpers.js";

const CITY_COUNT = { about: "Counts the rows of one city.", params: ["city"], code: COUNT };
const BROKEN = { about: "Always fails.", code: 'throw new Error("no")' };
const CAUGHT = "await lib.broken().catch(() => \"caught\")";

const countOf = (city) => `(await tools.practice.count({ city: "${city}" })).count`;
const ROWS_OF_NICE = '(await tools.practice.rows({ city: "Nice" })).rows.length';

/** The answer as lines: `lines.length` of an answer with a trail is the body, `--- calls ---`, the calls, the notes. */
const linesOf = (answer) => answer.text.split("\n");

describe("the uses", () => {
  test("each call that ended is a use, the inner ones too: stats.json holds them when run answers", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "lyonShare", { about: "The share of Lyon.", code: '(await lib.cityCount({ city: "Lyon" })) / 5000' });
    await inLib(w, libSettings(), async (ctx) => {
      const started = Date.now();
      const first = await ran(ctx, "await lib.lyonShare()");
      assert.equal(linesOf(first)[0], "0.125");
      const stats = statsOf(w.UL);
      assert.equal(stats.cityCount.uses, 1);
      assert.equal(stats.lyonShare.uses, 1);
      assert.equal(stats.cityCount.failures, 0);
      for (const name of ["cityCount", "lyonShare"]) {
        assert.match(stats[name].lastUse, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        const at = Date.parse(stats[name].lastUse);
        assert.ok(at >= started - 2000 && at <= Date.now() + 2000, `lastUse is the time of the call: ${stats[name].lastUse}`);
      }
      await ran(ctx, "await lib.lyonShare()");
      await ran(ctx, 'await lib.cityCount({ city: "Nice" })');
      assert.equal(statsOf(w.UL).cityCount.uses, 3);
      assert.equal(statsOf(w.UL).lyonShare.uses, 2);
      assert.equal(fileIn(w.UL, "cityCount.js"), programText(CITY_COUNT), "a use changes no file of a program");
    });
  });

  test("a program that fails after the call still counts the use; a saved program that threw is a use that failed", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "boom", { about: "Throws.", code: 'throw new Error("boom")' });
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, 'await lib.cityCount({ city: "Lyon" }); throw new Error("x")');
      assert.equal(answer.isError, true);
      assert.equal(statsOf(w.UL).cityCount.uses, 1);
      assert.deepEqual(await ran(ctx, "await lib.boom()"), { text: "The program failed: Error: boom", isError: true });
      assert.equal(statsOf(w.UL).boom.uses, 1);
      assert.equal(statsOf(w.UL).boom.failures, 1);
    });
  });

  test("the uses of the project's programs go to the project's stats.json, the user's to the user's; a shadowed program is not used", async () => {
    const w = world();
    putProgram(w.PL, "pOnly", { about: "In the project.", code: '"p"' });
    putProgram(w.PL, "dup", { about: "The project's.", code: '"dp"' });
    putProgram(w.UL, "uOnly", { about: "In the user's.", code: '"u"' });
    putProgram(w.UL, "dup", { about: "The user's.", code: '"du"' });
    await inLib(w, projectSettings(w), async (ctx) => {
      assert.deepEqual(await ran(ctx, "[await lib.pOnly(), await lib.uOnly(), await lib.dup()].join()"), { text: "p,u,dp", isError: false });
      assert.deepEqual(Object.keys(statsOf(w.PL)).sort(), ["dup", "pOnly"]);
      assert.deepEqual(Object.keys(statsOf(w.UL)), ["uOnly"], "the user's dup was not called");
      assert.equal(statsOf(w.PL).dup.uses, 1);
    });
  });

  test("nothing is saved without a call of library.save: a use writes stats.json and nothing else, the files of the programs are as they were", async () => {
    const w = world();
    putProgram(w.UL, "a", { about: "A.", code: "1" });
    putProgram(w.UL, "b", { about: "B.", code: "2" });
    await inLib(w, libSettings(), async (ctx) => {
      await ran(ctx, "await lib.a()");
      await ran(ctx, "(await tools.practice.count({})).count");
      assert.deepEqual(names(w.UL), ["a.js", "b.js", "stats.json"]);
      assert.equal(fileIn(w.UL, "a.js"), programText({ about: "A.", code: "1" }));
      assert.equal(fileIn(w.UL, "b.js"), programText({ about: "B.", code: "2" }));
      assert.deepEqual(names(join(w.H, ".onetool")), ["library"], "no archive was made");
    });
  });
});

describe("a saved program that failed too often is moved to the archive", () => {
  test("five failures in a row, one per program: the fifth ends with the note, the file is moved, the next program does not find it", async () => {
    const w = world();
    putProgram(w.UL, "broken", BROKEN);
    await inLib(w, libSettings(), async (ctx) => {
      for (let i = 1; i <= 4; i++) {
        assert.deepEqual(await ran(ctx, CAUGHT), { text: "caught", isError: false }, `run ${i}`);
        assert.equal(statsOf(w.UL).broken.failures, i);
        assert.equal(statsOf(w.UL).broken.uses, i);
      }
      assert.equal(existsSync(join(w.UL, "broken.js")), true);
      const fifth = await ran(ctx, CAUGHT);
      assert.equal(fifth.isError, false);
      assert.deepEqual(linesOf(fifth), ["caught", "--- calls ---", ARCHIVED("broken")]);
      assert.equal(existsSync(join(w.UL, "broken.js")), false);
      const archived = archivedOf(w.UA, "broken");
      assert.equal(archived.length, 1);
      assert.equal(readFileSync(join(w.UA, archived[0]), "utf8"), programText(BROKEN));
      assert.equal(statsOf(w.UL)?.broken, undefined);
      assert.deepEqual(await ran(ctx, "typeof lib.broken"), { text: "undefined", isError: false });
    });
  });

  test("a success sets the count back to 0: four failures, a success, four failures keep the program; one more moves it", async () => {
    const w = world();
    putProgram(w.UL, "flaky", { about: "Fails when told to.", params: ["fail"], code: 'if (fail) throw new Error("no");\n"fine"' });
    const fails = 'await lib.flaky({ fail: true }).catch(() => "caught")';
    await inLib(w, libSettings(), async (ctx) => {
      for (let i = 0; i < 4; i++) assert.equal((await ran(ctx, fails)).text, "caught");
      assert.equal(statsOf(w.UL).flaky.failures, 4);
      assert.deepEqual(await ran(ctx, "await lib.flaky({ fail: false })"), { text: "fine", isError: false });
      assert.equal(statsOf(w.UL).flaky.failures, 0);
      for (let i = 0; i < 4; i++) assert.equal((await ran(ctx, fails)).text, "caught");
      assert.equal(existsSync(join(w.UL, "flaky.js")), true);
      assert.deepEqual(linesOf(await ran(ctx, fails)), ["caught", "--- calls ---", ARCHIVED("flaky")]);
      assert.equal(existsSync(join(w.UL, "flaky.js")), false);
    });
  });

  test("five failures in one program: they are five uses in the order they ended, and the program is moved when it ends", async () => {
    const w = world();
    putProgram(w.UL, "broken", BROKEN);
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, 'for (let i = 0; i < 5; i++) await lib.broken().catch(() => 0);\n"done"');
      assert.deepEqual(linesOf(answer), ["done", "--- calls ---", ARCHIVED("broken")]);
      assert.equal(existsSync(join(w.UL, "broken.js")), false);
      assert.equal(archivedOf(w.UA, "broken").length, 1);
    });
  });

  test("with the trail off no note is shown, and the program is moved all the same", async () => {
    const w = world();
    putProgram(w.UL, "broken", BROKEN);
    await inLib(w, libSettings({ trail: false }), async (ctx) => {
      for (let i = 0; i < 5; i++) assert.deepEqual(await ran(ctx, CAUGHT), { text: "caught", isError: false });
      assert.equal(existsSync(join(w.UL, "broken.js")), false);
      assert.equal(archivedOf(w.UA, "broken").length, 1);
    });
  });

  test("the notes of the two libraries: the project's first, then the user's", async () => {
    const w = world();
    putProgram(w.UL, "alpha", BROKEN);
    putProgram(w.PL, "zeta", BROKEN);
    await inLib(w, projectSettings(w), async (ctx) => {
      const code = 'for (let i = 0; i < 5; i++) { await lib.alpha().catch(() => 0); await lib.zeta().catch(() => 0); }\n"done"';
      assert.deepEqual(linesOf(await ran(ctx, code)), ["done", "--- calls ---", ARCHIVED("zeta"), ARCHIVED("alpha")]);
      assert.equal(archivedOf(w.PA, "zeta").length, 1);
      assert.equal(archivedOf(w.UA, "alpha").length, 1);
    });
  });

  test("a job that makes a saved program fail five times ends with the note in its answer", async () => {
    const w = world();
    putProgram(w.UL, "broken", BROKEN);
    await inLib(w, libSettings(), async (ctx) => {
      const jobs = jobsOf(viaCtx(ctx));
      await jobs.start('for (let i = 0; i < 5; i++) await lib.broken().catch(() => 0);\n"done"');
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, false);
      assert.deepEqual(linesOf(ended).slice(1), ["--- answer ---", "done", "--- calls ---", ARCHIVED("broken")]);
      assert.deepEqual(await jobs.ask("j1"), ended, "asked again, the same answer");
      assert.equal(existsSync(join(w.UL, "broken.js")), false);
    });
  });
});

describe("the sequence of the program's own text: a saved program that does the same", () => {
  test("the note names it, whatever the result, and the answer is the text, the trail and the note", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings(), async (ctx) => {
      const same = await ran(ctx, ROWS_OF_NICE);
      const lines = linesOf(same);
      assert.equal(lines.length, 4, same.text);
      assert.equal(lines[0], "625");
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], okLine("practice.rows"));
      assert.equal(lines[3], SAME_AS("cityCount"));
      const failed = await ran(ctx, 'await tools.practice.rows({}); throw new Error("boom")');
      assert.equal(failed.isError, true);
      assert.ok(failed.text.startsWith("The program failed: Error: boom\n--- calls ---\n"), failed.text);
      assert.equal(linesOf(failed).at(-1), SAME_AS("cityCount"));
    });
  });

  test("the first of the programs of the library, in its order: the two libraries together, by name", async () => {
    const w = world();
    const rows = { about: "Rows.", code: "(await tools.practice.rows({})).rows.length" };
    putProgram(w.UL, "zzz", rows);
    putProgram(w.UL, "aaa", rows);
    putProgram(w.PL, "mmm", rows);
    await inLib(w, projectSettings(w), async (ctx) => {
      assert.equal(linesOf(await ran(ctx, ROWS_OF_NICE)).at(-1), SAME_AS("aaa"));
    });
  });

  test("not the same: another order, more calls, fewer calls, no call; a program that only calls lib has an empty sequence", async () => {
    const w = world();
    putProgram(w.UL, "both", { about: "Rows then count.", code: "await tools.practice.rows({});\nawait tools.practice.count({});\n1" });
    putProgram(w.UL, "nothing", { about: "No tool.", code: "1" });
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings(), async (ctx) => {
      const other = await ran(ctx, "await tools.practice.count({}); await tools.practice.rows({}); 1");
      assert.deepEqual([linesOf(other)[0], linesOf(other)[1], linesOf(other).length], ["1", "--- calls ---", 4], other.text);
      const more = await ran(ctx, "await tools.practice.rows({}); await tools.practice.count({}); await tools.practice.count({}); 1");
      assert.equal(linesOf(more).length, 5, more.text);
      assert.ok(!more.text.includes("does this"));
      const fewer = await ran(ctx, "await tools.practice.count({}); 1");
      assert.equal(linesOf(fewer).length, 3, fewer.text);
      assert.deepEqual(await ran(ctx, "1 + 1"), { text: "2", isError: false }, "no call and no note: no trail");
      const calling = await ran(ctx, 'await lib.cityCount({ city: "Lyon" })');
      assert.equal(linesOf(calling).length, 3, "the code of the program is the text it was given, not the text of the saved program it called");
    });
  });

  test("a program whose text names a saved program and the same tools gets the note all the same", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, 'await lib.cityCount({ city: "Lyon" });\n(await tools.practice.rows({})).rows.length');
      assert.equal(linesOf(answer).at(-1), SAME_AS("cityCount"));
    });
  });
});

describe("the sequence that is not saved", () => {
  const FIRST_THREE = [countOf("Paris"), countOf("Lyon"), countOf("Nice")];

  test("the third run of one sequence says to save it, once: not the fourth, nor a later one; the texts may differ", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      for (const [i, code] of FIRST_THREE.entries()) {
        const answer = await ran(ctx, code);
        const lines = linesOf(answer);
        assert.equal(lines[0], "625");
        assert.equal(lines[1], "--- calls ---");
        assert.match(lines[2], okLine("practice.count", "13"));
        if (i < 2) assert.equal(lines.length, 3, answer.text);
        else assert.deepEqual(lines.slice(3), [SAVE_IT(3), ONE_CALL_NOTE], answer.text); // step 12: the third program of one call each in a row
      }
      for (const code of [countOf("Paris"), countOf("Brest")]) assert.equal(linesOf(await ran(ctx, code)).length, 3, "not at the fourth, nor later");
    });
  });

  test("only a program that ended well counts; the sequence of another program is counted by itself", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      assert.equal(linesOf(await ran(ctx, countOf("Paris"))).length, 3);
      assert.equal((await ran(ctx, 'await tools.practice.count({}); throw new Error("x")')).isError, true);
      assert.equal(linesOf(await ran(ctx, countOf("Lyon"))).length, 3, "the failed run did not count: this is the second");
      assert.equal(linesOf(await ran(ctx, ROWS_OF_NICE)).length, 3, "rows is another sequence");
      const third = await ran(ctx, countOf("Nice"));
      // step 12: the run that failed put the streak back to 0, so Lyon, rows and Nice are three in a row of one call each
      assert.deepEqual(linesOf(third).slice(3), [SAVE_IT(3), ONE_CALL_NOTE]);
      assert.equal(linesOf(await ran(ctx, ROWS_OF_NICE)).length, 3, "rows has run twice");
    });
  });

  test("a saved program that does the same stops the count: after it is removed, the count starts from 0", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings(), async (ctx) => {
      for (let i = 0; i < 3; i++) {
        const answer = await ran(ctx, ROWS_OF_NICE);
        // step 12: the third of three programs of one call each in a row has the note of step 12 after the other
        const expected = i < 2 ? [SAME_AS("cityCount")] : [SAME_AS("cityCount"), ONE_CALL_NOTE];
        assert.deepEqual(linesOf(answer).slice(3), expected, "each gets the note of the saved program, never the other");
      }
      assert.equal((await ran(ctx, 'await library.remove("cityCount")')).text.split("\n")[0], "lib.cityCount went to the archive of the user library.");
      // step 12: after the note the streak is 0; the remove (one call) makes 1, the first run 2, the second 3: it says so
      assert.equal(linesOf(await ran(ctx, ROWS_OF_NICE)).length, 3);
      assert.deepEqual(linesOf(await ran(ctx, ROWS_OF_NICE)).slice(3), [ONE_CALL_NOTE]);
      assert.deepEqual(linesOf(await ran(ctx, ROWS_OF_NICE)).slice(3), [SAVE_IT(3)]);
    });
  });

  test("the foreground and the jobs count together, in the memory of the process", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const jobs = jobsOf(viaCtx(ctx));
      assert.equal(linesOf(await ran(ctx, countOf("Paris"))).length, 3);
      await jobs.start(countOf("Lyon"));
      const ended = await jobs.untilEnded("j1");
      assert.equal(linesOf(ended).length, 5, ended.text);
      assert.match(linesOf(ended)[4], okLine("practice.count"));
      assert.deepEqual(linesOf(await ran(ctx, countOf("Nice"))).slice(3), [SAVE_IT(3)]);
    });
  });

  test("the third job of one sequence has the note in its answer", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const jobs = jobsOf(viaCtx(ctx));
      for (const [i, city] of ["Paris", "Lyon", "Nice"].entries()) {
        await jobs.start(countOf(city));
        const ended = await jobs.untilEnded(`j${i + 1}`);
        const lines = linesOf(ended);
        assert.deepEqual(lines.slice(1, 4), ["--- answer ---", "625", "--- calls ---"]);
        if (i < 2) assert.equal(lines.length, 5, ended.text);
        else assert.deepEqual(lines.slice(5), [SAVE_IT(3)], ended.text);
      }
    });
  });

  test("a program with no tool in its text is never counted, and a program that uses only the shell neither", async () => {
    const w = world();
    putProgram(w.UL, "one", { about: "One.", code: "1" });
    await inLib(w, projectSettings(w), async (ctx) => {
      for (let i = 0; i < 5; i++) assert.deepEqual(await ran(ctx, "await lib.one()"), { text: "1", isError: false });
      for (let i = 0; i < 4; i++) {
        const answer = await ran(ctx, 'await write("a.txt", "x"); "done"');
        // step 12: the five programs with no call put the streak at 0; the third program of one call in a row has its note
        assert.deepEqual([linesOf(answer)[0], linesOf(answer).length], ["done", i === 2 ? 4 : 3], answer.text);
        if (i === 2) assert.equal(linesOf(answer)[3], ONE_CALL_NOTE);
      }
    });
  });

  test("with the trail off the answers are the texts, to the character, notes or not", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings({ trail: false }), async (ctx) => {
      assert.deepEqual(await ran(ctx, 'await lib.cityCount({ city: "Lyon" })'), { text: "625", isError: false }, "the saved program is there");
      for (let i = 0; i < 4; i++) assert.deepEqual(await ran(ctx, ROWS_OF_NICE), { text: "625", isError: false });
      for (const city of ["Paris", "Lyon", "Nice", "Brest"]) assert.deepEqual(await ran(ctx, countOf(city)), { text: "625", isError: false });
    });
  });
});

describe("what follows, and must hold", () => {
  test("nothing about a save or a use goes to standard error, and no answer holds a library folder", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "broken", BROKEN);
    // hostRules is off: with the shell on, onetool says once that the host is not known (step 5), which is not this test's line
    await inLib(w, projectSettings(w, { hostRules: false }), async (ctx) => {
      const answers = [];
      const results = [];
      for (const code of [
        `await ${saveCall("local", { about: "Here.", code: '"here"' })}`,
        `await ${saveCall("local", { about: "Here, again.", code: '"here"', replace: true })}`,
        'await lib.cityCount({ city: "Lyon" })',
        'for (let i = 0; i < 5; i++) await lib.broken().catch(() => 0);\n"done"',
        'await library.remove("local")',
        'await library.remove("local")',
      ]) {
        const one = await ran(ctx, code);
        results.push(one);
        answers.push(one.text);
      }
      // the six calls did what they were asked: a save, a replace, a use, a move to the archive, a removal, a name not saved
      assert.deepEqual(
        results.map((one) => [linesOf(one)[0], one.isError]),
        [
          ["lib.local is saved in the project library.", false],
          ["lib.local is saved in the project library; lib.local went to the archive.", false],
          ["625", false],
          ["done", false],
          ["lib.local went to the archive of the project library.", false],
          [FAILED("library.remove failed: no program named local is saved"), true],
        ],
      );
      await sleep(200);
      assert.equal(ctx.stderr(), "", "nothing on standard error");
      for (const text of answers) for (const place of [w.H, w.W, w.UL, w.PL, w.UA, w.PA]) assert.equal(text.includes(place), false, `an answer holds ${place}: ${text}`);
    });
  });

  test("the files of a person are followed: a file made by hand is a program for the next run, one changed or removed too, a stats.json that is not JSON is not a fault", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      putProgram(w.UL, "a", { about: "A.", code: '"one"' });
      assert.equal((await ran(ctx, "await lib.a()")).text, "one");
      putProgram(w.UL, "a", { about: "A.", code: '"two"' });
      assert.equal((await ran(ctx, "await lib.a()")).text, "two");
      putRaw(w.UL, "stats.json", "this is not json");
      assert.equal((await ran(ctx, "await lib.a()")).text, "two", "a stats.json that is not JSON is no fault");
    });
  });
});

describe("the end", () => {
  const SAVING = 'for (let i = 0; i < 30; i++) await library.save("p" + i, { about: "x.", code: String(i) });\nawait new Promise(() => {})';

  for (const how of ["SIGTERM", "SIGINT", "standard input closed"]) {
    test(`${how} while a program saves: exit code 0 within 5 seconds, onetool does not wait for the saves`, async () => {
      const w = world();
      const raw = rawOnetool(settingsOf({}, { trail: true, log: false, timeoutSeconds: 10 }), { env: { HOME: w.H } });
      try {
        await raw.initialize();
        let answered = null;
        raw.callTool("run", { code: SAVING }, 15000).then((message) => (answered = message), () => {});
        await waitFor(() => {
          if (answered !== null) assert.fail(`the program ended before it saved: ${JSON.stringify(answered.result ?? answered.error)}`);
          return existsSync(join(w.UL, "p0.js"));
        }, 5000, "the first save");
        if (how === "standard input closed") {
          raw.child.stdin.end();
          assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
        } else {
          assert.deepEqual(await raw.endBy(how, 5000), { code: 0, signal: null });
        }
      } finally {
        raw.kill();
        await raw.exited;
      }
    });
  }
});
