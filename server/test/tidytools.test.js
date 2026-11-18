// Step 8: the three more tools of the built-in `library` (the meeting point of server, "Step 8: tidying the library", "Three more tools of
// the built-in `library`"): the report, the restore and the read, behind `run`, with the rules, the question, the record and
// the log of any call. The libraries are written by hand, as a person would. Every test starts the command with HOME a folder it
// made, and says "trail" and "log".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withHost } from "./askhost.js";
import { sleep } from "./helpers.js";
import { jobsOf, viaCtx } from "./jobhelpers.js";
import {
  COUNT,
  FAILED,
  archivedOf,
  fileIn,
  inLib,
  libSettings,
  messageOf,
  names,
  okLine,
  programText,
  projectSettings,
  putProgram,
  putStats,
  removedFrom,
  saveCall,
  statsOf,
  trailOf,
  wordLine,
  world,
} from "./libhelpers.js";
import { logEntries, logText } from "./recordhelpers.js";
import { ran } from "./shellhelpers.js";
import {
  BAD_NAME_OF,
  H_PAIRS,
  H_PROGRAMS,
  H_SEQUENCES,
  H_UNUSED,
  LOG_OFF,
  NOT_IN_ARCHIVE,
  NO_SUCH_READ,
  READ_AS_JSON,
  REPORT,
  RESTORE_CAP,
  SAVED_ALREADY_RESTORE,
  backIn,
  dayOf,
  emptyReport,
  isoOf,
  putArchived,
  putSequences,
  questionOf,
  sequenceLineOf,
  sequencesOf,
  sequencesText,
  splitReport,
} from "./tidyhelpers.js";

const SHARE = "const { rows } = await tools.practice.rows({});\nconst { count } = await tools.practice.count({});\nrows.filter((row) => row.city === city).length / count";
const CITY_COUNT = { about: "Counts the rows of one city.", params: ["city"], code: COUNT };
const CITY_SHARE = { about: "The share of one city.", params: ["city"], code: SHARE };
const OLD = { about: "An old one.", code: '"old"' };

const WITH_LOG = (w, onetool = {}) => libSettings({ log: true, logFolder: w.L, ...onetool });

describe("`library.report`", () => {
  test("an empty library, the log switched off: the nine lines of part `library`, then the trail of the one call; no file is made", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, REPORT);
      assert.equal(answer.isError, false, answer.text);
      const { report, trail } = splitReport(answer.text);
      assert.deepEqual(report, emptyReport(LOG_OFF));
      assert.equal(trail.length, 1, answer.text);
      assert.match(trail[0], okLine("library.report", String(report.join("\n").length)));
      assert.deepEqual(names(w.H), [], "the report changes no file, and makes no folder");
    });
  });

  test("an empty library, the log on and no sequences file: `(none)`; the report changes no file", async () => {
    const w = world();
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const { report } = splitReport((await ran(ctx, REPORT)).text);
      assert.deepEqual(report, emptyReport("(none)"));
      assert.deepEqual(names(w.H), [], "no sequences file is made by a report");
    });
  });

  test("every key of the arguments is ignored: `library.report('x', 1)` is the same call", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const plain = splitReport((await ran(ctx, REPORT)).text).report;
      const odd = await ran(ctx, 'await library.report({ name: 5, limit: 1 }, "x", 1)');
      assert.equal(odd.isError, false, odd.text);
      assert.deepEqual(splitReport(odd.text).report, plain);
    });
  });

  test("the library of the moment, its stats and the sequences file of a person: the lines by the rule, the default 30 days", async () => {
    const w = world();
    const now = Date.now();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "cityShare", CITY_SHARE);
    putProgram(w.UL, "old", OLD);
    putProgram(w.UL, "fresh", { about: "Used 29 days ago.", code: '"fresh"' });
    putStats(w.UL, {
      cityCount: { uses: 2, lastUse: isoOf(now), failures: 0 },
      old: { uses: 1, lastUse: isoOf(now, 40), failures: 0 },
      fresh: { uses: 4, lastUse: isoOf(now, 29), failures: 1 },
    });
    const rows = ["practice.rows"];
    const both = ["practice.rows", "practice.count"];
    putSequences(
      w,
      [
        ...Array(3).fill(sequenceLineOf(["practice.count"])),
        ...Array(3).fill(sequenceLineOf(rows)), // saved: the sequence of cityCount
        ...Array(3).fill(sequenceLineOf(both)), // saved: the sequence of cityShare
        ...Array(2).fill(sequenceLineOf(["practice.echo"])), // twice only
        "this is not json",
        sequenceLineOf([]),
        '{"sequence":[1]}',
        "",
      ].join("\n"),
    );
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answer = await ran(ctx, REPORT);
      assert.equal(answer.isError, false, answer.text);
      // the program lines: uses rising, then by name (the order of the cap of a save)
      assert.deepEqual(splitReport(answer.text).report, [
        "Library report: 4 programs",
        H_PROGRAMS,
        "lib.cityShare (user): 0 uses, 0 failures, never",
        `lib.old (user): 1 uses, 0 failures, ${dayOf(now, 40)}`,
        `lib.cityCount (user): 2 uses, 0 failures, ${dayOf(now)}`,
        `lib.fresh (user): 4 uses, 1 failures, ${dayOf(now, 29)}`,
        H_PAIRS,
        "lib.cityCount and lib.cityShare: 1 of 2 tools (practice.rows)",
        H_UNUSED,
        "lib.old",
        H_SEQUENCES,
        "3 times: practice.count",
      ]);
    });
  });

  test("a stats.json edited by hand is what the next report says; a program file written by hand is in it", async () => {
    const w = world();
    putProgram(w.UL, "a", { about: "A.", code: "1" });
    putProgram(w.UL, "b", { about: "B.", code: "2" });
    putStats(w.UL, { a: { uses: 5, lastUse: null, failures: 0 }, b: { uses: 1, lastUse: null, failures: 0 } });
    await inLib(w, libSettings(), async (ctx) => {
      const lines = (answer) => splitReport(answer.text).report.slice(2, 4);
      assert.deepEqual(lines(await ran(ctx, REPORT)), ["lib.b (user): 1 uses, 0 failures, never", "lib.a (user): 5 uses, 0 failures, never"]);
      putStats(w.UL, { a: { uses: 0, lastUse: null, failures: 2 }, b: { uses: 1, lastUse: null, failures: 0 } });
      assert.deepEqual(lines(await ran(ctx, REPORT)), ["lib.a (user): 0 uses, 2 failures, never", "lib.b (user): 1 uses, 0 failures, never"]);
      putProgram(w.UL, "c", { about: "C.", code: "3" });
      assert.equal(splitReport((await ran(ctx, REPORT)).text).report[0], "Library report: 3 programs");
    });
  });

  test("both libraries: the project's program is in the report once, with its place", async () => {
    const w = world();
    putProgram(w.UL, "both", { about: "User's.", code: "1" });
    putProgram(w.PL, "both", { about: "Project's.", code: "2" });
    putProgram(w.PL, "local", { about: "Local.", code: "3" });
    await inLib(w, projectSettings(w, { hostRules: false }), async (ctx) => {
      const { report } = splitReport((await ran(ctx, REPORT)).text);
      assert.equal(report[0], "Library report: 2 programs");
      assert.deepEqual(report.slice(2, 4), ["lib.both (project): 0 uses, 0 failures, never", "lib.local (project): 0 uses, 0 failures, never"]);
    });
  });

  test("the log switched off: a sequences file the person left is not read, and nothing is counted", async () => {
    const w = world();
    putSequences(w, `${Array(3).fill(sequenceLineOf(["practice.count"])).join("\n")}\n`);
    await inLib(w, libSettings({ log: false }), async (ctx) => {
      const { report } = splitReport((await ran(ctx, REPORT)).text);
      assert.deepEqual(report.slice(-2), [H_SEQUENCES, LOG_OFF]);
      assert.equal(report.some((line) => line.startsWith("3 times:")), false);
    });
  });

  test("a sequences file that cannot be read gives no sequence, in silence", async () => {
    const w = world();
    mkdirSync(sequencesOf(w), { recursive: true }); // a folder where the file should be
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answer = await ran(ctx, REPORT);
      assert.equal(answer.isError, false, answer.text);
      assert.deepEqual(splitReport(answer.text).report, emptyReport("(none)"));
      await sleep(150);
      assert.equal(ctx.stderr(), "");
    });
  });

  test("a sequences file of more than 2,000,000 bytes: only its last 2,000,000 bytes are read", async () => {
    const w = world();
    const old = sequenceLineOf(["old.seq"]);
    const recent = sequenceLineOf(["new.seq"]);
    // the first lines, then more than 2,000,000 bytes of lines that are no sequence, then the last lines:
    // the last 2,000,000 bytes start inside the filler, after the three `old.seq` lines
    const filler = `${JSON.stringify({ junk: "x".repeat(990) })}\n`;
    const fillerLines = Math.ceil(2000100 / filler.length);
    const text = `${Array(3).fill(old).join("\n")}\n${filler.repeat(fillerLines)}${Array(3).fill(recent).join("\n")}\n`;
    assert.ok(text.length - (3 * (old.length + 1)) > 2000000, "the first lines are beyond the last 2,000,000 bytes");
    putSequences(w, text);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const { report } = splitReport((await ran(ctx, REPORT)).text);
      assert.deepEqual(report.slice(-2), [H_SEQUENCES, "3 times: new.seq"]);
      assert.equal(report.some((line) => line.includes("old.seq")), false);
    });
  });

  test("the report is cut at 6,000 characters (its default): the programs least used stand first, `(<m> more not shown)` in the place of the others", async () => {
    const w = world();
    const n = 100;
    const programNames = Array.from({ length: n }, (_, at) => `p${String(at).padStart(3, "0")}${"x".repeat(30)}`);
    for (const name of programNames) putProgram(w.UL, name, { about: "One.", code: "1" });
    const lineOf = (name) => `lib.${name} (user): 0 uses, 0 failures, never`;
    // by the rule of "The limit" of the meeting point of library: the greatest k for which the whole text has at most 6000 characters
    const textFor = (k) =>
      [
        `Library report: ${n} programs`,
        H_PROGRAMS,
        ...programNames.slice(0, k).map(lineOf),
        ...(k < n ? [`(${n - k} more not shown)`] : []),
        H_PAIRS,
        "(none)",
        H_UNUSED,
        "(none)",
        H_SEQUENCES,
        "(none)",
      ].join("\n");
    let k = n;
    while (textFor(k).length > 6000) k -= 1;
    assert.ok(k > 0 && k < n);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answer = await ran(ctx, REPORT);
      assert.equal(answer.isError, false, answer.text.slice(0, 200));
      const { report } = splitReport(answer.text);
      assert.equal(report.join("\n"), textFor(k));
      assert.ok(report.join("\n").length <= 6000);
    });
  });
});

describe("`library.read`", () => {
  test("the text of the file as onetool would write it, whatever its lines; the project's program when both libraries have one", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "both", { about: "User's.", code: '"user"' });
    putProgram(w.PL, "both", { about: "Project's.", params: ["a", "b"], code: '"project"' });
    await inLib(w, projectSettings(w, { hostRules: false }), async (ctx) => {
      const asked = async (name) => {
        const answer = await ran(ctx, READ_AS_JSON(name));
        assert.equal(answer.isError, false, answer.text);
        return JSON.parse(answer.text.split("\n")[0]);
      };
      assert.equal(await asked("cityCount"), programText(CITY_COUNT));
      assert.equal(await asked("both"), programText({ about: "Project's.", params: ["a", "b"], code: '"project"' }));
      const plain = await ran(ctx, 'await library.read("cityCount")');
      assert.ok(plain.text.startsWith(programText(CITY_COUNT)), plain.text);
      const trail = trailOf(plain.text);
      assert.equal(trail.length, 2, plain.text);
      assert.match(trail[1], okLine("library.read", String(programText(CITY_COUNT).length)));
    });
  });

  test("a file changed by hand is what the next read gives; a name not saved, an archived one and a file that is no program are `no program named`", async () => {
    const w = world();
    putProgram(w.UL, "a", { about: "A.", code: '"one"' });
    putProgram(w.UL, "gone", { about: "Goes.", code: "1" });
    await inLib(w, libSettings(), async (ctx) => {
      const asked = async (name) => JSON.parse((await ran(ctx, READ_AS_JSON(name))).text.split("\n")[0]);
      assert.equal(await asked("a"), programText({ about: "A.", code: '"one"' }));
      putProgram(w.UL, "a", { about: "A, again.", code: '"two"' });
      assert.equal(await asked("a"), programText({ about: "A, again.", code: '"two"' }));
      assert.equal((await ran(ctx, 'await library.remove("gone")')).text.split("\n")[0], removedFrom("gone", "user"));
      for (const name of ["nope", "gone", "A", "ab"]) {
        const answer = await ran(ctx, `await library.read(${JSON.stringify(name)})`);
        assert.equal(answer.isError, true);
        assert.equal(answer.text.split("\n")[0], FAILED(NO_SUCH_READ(name)));
        assert.match(trailOf(answer.text).at(-1), wordLine("library.read", "failed"));
      }
    });
  });

  test("a name that is not a name: the message of the rule, the name left out, a name of 41 characters, a name that is not a text", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const caught = async (call) => (await ran(ctx, messageOf(call))).text.split("\n")[0];
      for (const call of ['library.read("bad name")', "library.read()", "library.read(5)", 'library.read("1a")', 'library.read("")', `library.read("${"a".repeat(41)}")`, "library.read(null)"]) {
        assert.equal(await caught(call), BAD_NAME_OF("read"), call);
      }
      assert.equal(await caught(`library.read("${"a".repeat(40)}")`), NO_SUCH_READ("a".repeat(40)), "40 characters is a name");
    });
  });
});

describe("`library.restore`", () => {
  test("the newest archived file comes back to the user library as it was, the older stays; the program that restored it does not find it under `lib`, the next does", async () => {
    const w = world();
    putArchived(w.UA, "old", { about: "Older.", code: '"older"' }, "2026-11-17T10-00-00-000Z");
    putArchived(w.UA, "old", OLD, "2026-11-18T10-00-00-000Z");
    await inLib(w, libSettings(), async (ctx) => {
      const restored = await ran(ctx, '[await library.restore("old"), typeof lib.old].join("|")');
      assert.equal(restored.isError, false, restored.text);
      const lines = restored.text.split("\n");
      assert.equal(lines[0], `${backIn("old", "user")}|undefined`);
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], okLine("library.restore", String(backIn("old", "user").length)));
      assert.equal(fileIn(w.UL, "old.js"), programText(OLD));
      assert.deepEqual(archivedOf(w.UA, "old"), ["old.2026-11-17T10-00-00-000Z.js"], "the older file stays in the archive");
      assert.deepEqual(await ran(ctx, "typeof lib.old"), { text: "function", isError: false });
      assert.deepEqual(await ran(ctx, "await lib.old()"), { text: "old", isError: false });
    });
  });

  test("it comes back with no count: what stats.json held of it is not the report's", async () => {
    const w = world();
    putArchived(w.UA, "old", OLD);
    putStats(w.UL, { old: { uses: 7, lastUse: isoOf(Date.now(), 2), failures: 3 } });
    await inLib(w, libSettings(), async (ctx) => {
      assert.equal((await ran(ctx, 'await library.restore("old")')).text.split("\n")[0], backIn("old", "user"));
      const { report } = splitReport((await ran(ctx, REPORT)).text);
      assert.equal(report[2], "lib.old (user): 0 uses, 0 failures, never");
      assert.equal(report.includes(H_UNUSED) && report[report.indexOf(H_UNUSED) + 1], "(none)");
    });
  });

  test("the rejections of part `library`, as `<id> failed: <message>`; nothing is moved", async () => {
    const w = world();
    putProgram(w.UL, "kept", { about: "Kept.", code: "1" });
    putProgram(w.UL, "second", { about: "Second.", code: "2" });
    putArchived(w.UA, "kept", { about: "Kept, before.", code: "0" });
    putArchived(w.UA, "Second", { about: "Second, by case.", code: "0" });
    putArchived(w.UA, "third", { about: "Third.", code: "3" });
    const archiveBefore = names(w.UA);
    await inLib(w, libSettings({ libraryCap: 2 }), async (ctx) => {
      const caught = async (call) => (await ran(ctx, messageOf(call))).text.split("\n")[0];
      assert.equal(await caught('library.restore("nope")'), NOT_IN_ARCHIVE("nope"));
      assert.equal(await caught('library.restore("kept")'), SAVED_ALREADY_RESTORE("kept"));
      assert.equal(await caught('library.restore("Second")'), "library.restore failed: the name Second differs from the saved program second only by case");
      // the cap of the settings is the cap of the restore: two programs are saved, two is the limit
      assert.equal(await caught('library.restore("third")'), RESTORE_CAP(2, 2));
      for (const call of ['library.restore("bad name")', "library.restore()", "library.restore(5)", 'library.restore("1a")']) {
        assert.equal(await caught(call), BAD_NAME_OF("restore"), call);
      }
      assert.deepEqual(names(w.UA), archiveBefore);
      assert.deepEqual(names(w.UL).filter((name) => name.endsWith(".js")), ["kept.js", "second.js"]);
    });
  });

  test("the answer of a failed restore is a failure of the program, with the trail line `failed`", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, 'await library.restore("nope")');
      assert.equal(answer.isError, true);
      assert.equal(answer.text.split("\n")[0], FAILED(NOT_IN_ARCHIVE("nope")));
      assert.match(trailOf(answer.text).at(-1), wordLine("library.restore", "failed"));
    });
  });

  test("the project's archive first: a program the project's archive holds is restored in the project's library; one only the user's archive holds, in the user's", async () => {
    const w = world();
    putArchived(w.PA, "local", { about: "Local.", code: '"local"' });
    putArchived(w.UA, "mine", { about: "Mine.", code: '"mine"' });
    await inLib(w, projectSettings(w, { hostRules: false }), async (ctx) => {
      assert.equal((await ran(ctx, 'await library.restore("local")')).text.split("\n")[0], backIn("local", "project"));
      assert.equal(existsSync(join(w.PL, "local.js")), true);
      assert.equal(existsSync(join(w.UL, "local.js")), false);
      assert.equal((await ran(ctx, 'await library.restore("mine")')).text.split("\n")[0], backIn("mine", "user"));
      assert.equal(existsSync(join(w.UL, "mine.js")), true);
      assert.equal(existsSync(join(w.PL, "mine.js")), false);
      assert.deepEqual(archivedOf(w.PA, "local"), []);
      assert.deepEqual(archivedOf(w.UA, "mine"), []);
    });
  });

  test("a name the project's archive holds is never looked for in the user's, also when the project's restore is refused", async () => {
    const w = world();
    putProgram(w.PL, "twice", { about: "Saved in the project.", code: "1" });
    putArchived(w.PA, "twice", { about: "Project's, archived.", code: "2" });
    putArchived(w.UA, "twice", { about: "User's, archived.", code: "3" });
    const userArchive = names(w.UA);
    await inLib(w, projectSettings(w, { hostRules: false }), async (ctx) => {
      const answer = await ran(ctx, 'await library.restore("twice")');
      assert.equal(answer.isError, true);
      assert.equal(answer.text.split("\n")[0], FAILED(SAVED_ALREADY_RESTORE("twice")));
      assert.equal(existsSync(join(w.UL, "twice.js")), false, "not restored in the user's library either");
      assert.deepEqual(names(w.UA), userArchive);
    });
  });

  test("a file put in the archive by hand under a name of the form part `library` gives is restored like any; a name in neither archive is not", async () => {
    const w = world();
    putArchived(w.PA, "mine", { about: "Not here.", code: "1" });
    await inLib(w, libSettings(), async (ctx) => {
      // no project: the project's archive is not looked at
      assert.equal((await ran(ctx, 'await library.restore("mine")')).text.split("\n")[0], FAILED(NOT_IN_ARCHIVE("mine")));
      putArchived(w.UA, "mine", { about: "By hand.", code: '"by hand"' }, "2030-01-01T00-00-00-000Z");
      assert.equal((await ran(ctx, 'await library.restore("mine")')).text.split("\n")[0], backIn("mine", "user"));
      assert.deepEqual(await ran(ctx, "await lib.mine()"), { text: "by hand", isError: false });
    });
  });
});

describe("what a remove, a replace and a restore give back", () => {
  test("a program removed, one replaced by a save and one moved for its failures come back with `library.restore`, with no count", async () => {
    const w = world();
    putProgram(w.UL, "removed", { about: "Removed.", code: '"removed"' });
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "broken", { about: "Always fails.", code: 'throw new Error("no")' });
    putStats(w.UL, { cityCount: { uses: 9, lastUse: isoOf(Date.now(), 1), failures: 0 } });
    await inLib(w, libSettings(), async (ctx) => {
      await ran(ctx, 'await library.remove("removed")');
      const rowsIn = { about: "The rows of one city, counted.", params: ["city"], code: "(await tools.practice.rows({ city })).rows.length", replace: true };
      const replaced = await ran(ctx, `await ${saveCall("rowsIn", rowsIn)}`);
      assert.equal(replaced.text.split("\n")[0], "lib.rowsIn is saved in the user library; lib.cityCount went to the archive.");
      for (let time = 1; time <= 5; time++) await ran(ctx, 'await lib.broken().catch(() => "caught")');
      assert.equal(existsSync(join(w.UL, "broken.js")), false, "moved for its failures");
      for (const name of ["removed", "cityCount", "broken"]) {
        assert.equal((await ran(ctx, `await library.restore("${name}")`)).text.split("\n")[0], backIn(name, "user"), name);
      }
      assert.deepEqual(await ran(ctx, "await lib.removed()"), { text: "removed", isError: false });
      assert.equal((await ran(ctx, 'await lib.cityCount({ city: "Lyon" })')).text.split("\n")[0], "625");
      const { report } = splitReport((await ran(ctx, REPORT)).text);
      assert.ok(report.includes("lib.broken (user): 0 uses, 0 failures, never"), report.join("\n"));
      assert.ok(report.some((line) => line.startsWith("lib.cityCount (user): 1 uses, 0 failures, ")), "back with no count, then one use");
    });
  });
});

describe("the rules, the question, the record and the log: as for any call of the library", () => {
  const ASK = (w, onetool = {}) => libSettings({ log: true, logFolder: w.L, ask: ["library.report", "library.restore", "library.read"], ...onetool });

  test("the person is asked for each of the three with the arguments as the program gave them; a no, no answer and a failed question refuse it", async () => {
    const w = world();
    putProgram(w.UL, "kept", { about: "Kept.", code: "1" });
    putArchived(w.UA, "old", OLD);
    let reply = { action: "decline" };
    await withHost(ASK(w), { env: { HOME: w.H }, answer: () => reply }, async (host) => {
      const refusal = (id, cause) => FAILED(`onetool: ${id} is refused by the rule ask "${id}": ${cause}`);
      const first = async (code) => {
        const one = await host.run(code);
        return { text: one.text.split("\n")[0], isError: one.isError, trail: one.text.split("\n").at(-1) };
      };
      const report = await first(REPORT);
      assert.deepEqual([report.text, report.isError], [refusal("library.report", "the person said no"), true]);
      assert.match(report.trail, wordLine("library.report", "refused"));
      assert.equal(host.questions[0].message, questionOf("library.report", "library.report", {}));
      assert.equal((await first('await library.restore("old")')).text, refusal("library.restore", "the person said no"));
      assert.equal(host.questions[1].message, questionOf("library.restore", "library.restore", { name: "old" }));
      assert.equal(existsSync(join(w.UL, "old.js")), false, "nothing was restored without a yes");
      assert.equal((await first('await library.read("kept")')).text, refusal("library.read", "the person said no"));
      assert.equal(host.questions[2].message, questionOf("library.read", "library.read", { name: "kept" }));
      reply = { action: "cancel" };
      assert.equal((await first(REPORT)).text, refusal("library.report", "the person gave no answer"));
      reply = { error: { code: -32603, message: "no" } };
      assert.equal((await first(REPORT)).text, refusal("library.report", "the question failed"));
      // the arguments are checked before the question: no question for a call that cannot be made
      reply = { action: "accept" };
      const asked = host.questions.length;
      assert.equal((await first('await library.restore("bad name")')).text, FAILED(BAD_NAME_OF("restore")));
      assert.equal((await first("await library.read(5)")).text, FAILED(BAD_NAME_OF("read")));
      assert.equal(host.questions.length, asked);
      // a yes: the work is done
      assert.equal((await first('await library.restore("old")')).text, backIn("old", "user"));
      assert.equal(existsSync(join(w.UL, "old.js")), true);
      assert.equal((await first(REPORT)).text, "Library report: 2 programs");
      assert.equal((await first('await library.read("old")')).text, "// about: An old one.");
    });
    const decisions = (id) => logEntries(w.L).filter((entry) => entry.id === id).map((entry) => entry.decision);
    assert.deepEqual(decisions("library.report"), ["asked: no", "asked: no answer", "asked: failed", "asked: yes"]);
    assert.deepEqual(decisions("library.restore"), ["asked: no", "asked: not asked", "asked: yes"]);
    assert.deepEqual(decisions("library.read"), ["asked: no", "asked: not asked", "asked: yes"]);
  });

  test("a host that cannot ask: the refusal of step 3, and nothing is restored", async () => {
    const w = world();
    putArchived(w.UA, "old", OLD);
    await withHost(ASK(w), { capabilities: {}, env: { HOME: w.H } }, async (host) => {
      const answer = await host.run('await library.restore("old")');
      assert.equal(answer.isError, true);
      assert.equal(
        answer.text.split("\n")[0],
        FAILED('onetool: library.restore is refused by the rule ask "library.restore": the host program cannot ask the person'),
      );
      assert.deepEqual(host.questions, []);
      assert.equal(existsSync(join(w.UL, "old.js")), false);
    });
  });

  test("deny: each id by itself, and `library.*` for the five", async () => {
    const w = world();
    putProgram(w.UL, "kept", { about: "Kept.", code: "1" });
    putArchived(w.UA, "old", OLD);
    await inLib(w, WITH_LOG(w, { deny: ["library.read", "library.report"] }), async (ctx) => {
      for (const [call, id] of [["library.report()", "library.report"], ['library.read("kept")', "library.read"]]) {
        const answer = await ran(ctx, `await ${call}`);
        assert.equal(answer.isError, true);
        assert.equal(answer.text.split("\n")[0], FAILED(`onetool: ${id} is denied by the rule deny "${id}"`));
        assert.match(trailOf(answer.text).at(-1), wordLine(id, "refused"));
      }
      assert.equal((await ran(ctx, 'await library.restore("old")')).text.split("\n")[0], backIn("old", "user"), "restore is not denied");
    });
    const w2 = world();
    putArchived(w2.UA, "old", OLD);
    await inLib(w2, libSettings({ deny: ["library.*"] }), async (ctx) => {
      for (const call of ["library.report()", 'library.read("a")', 'library.restore("old")']) {
        const answer = await ran(ctx, `await ${call}`);
        assert.equal(answer.isError, true);
        assert.equal(answer.text.split("\n")[0], FAILED(`onetool: ${call.split("(")[0]} is denied by the rule deny "library.*"`), call);
      }
      assert.equal(existsSync(join(w2.UL, "old.js")), false);
    });
    assert.deepEqual(logEntries(w.L).map((entry) => [entry.id, entry.decision]), [["library.report", "denied"], ["library.read", "denied"], ["library.restore", "allowed"]]);
  });

  test("the log: `{}` for a report, `{ name }` for the two others, `{ name: null }` for a name that is no text; the report and the program are in no line", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putArchived(w.UA, "old", OLD);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      await ran(ctx, 'await library.report({ name: "ignored" })');
      await ran(ctx, 'await library.restore("old")');
      await ran(ctx, 'await library.read("cityCount")');
      await ran(ctx, "await library.read(5)");
      await ran(ctx, 'await library.restore("nope")');
    });
    const entries = logEntries(w.L);
    const of = (id) => entries.filter((entry) => entry.id === id);
    assert.deepEqual(of("library.report").map((entry) => entry.args), [{}]);
    assert.deepEqual(of("library.restore").map((entry) => entry.args), [{ name: "old" }, { name: "nope" }]);
    assert.deepEqual(of("library.read").map((entry) => entry.args), [{ name: "cityCount" }, { name: null }]);
    assert.deepEqual(of("library.read").map((entry) => [entry.decision, entry.fault]), [["allowed", null], ["allowed", BAD_NAME_OF("read")]]);
    assert.deepEqual(of("library.restore").map((entry) => entry.fault), [null, NOT_IN_ARCHIVE("nope")]);
    const text = logText(w.L);
    for (const secret of ["Library report", "rows.filter", "Counts the rows", "An old one", "--- programs"]) assert.equal(text.includes(secret), false, secret);
  });
});

describe("what follows, and must hold", () => {
  test("the report, the read and a prompt change no file: the library, its stats, the archive and the sequences are as they were, whole", async () => {
    const w = world();
    const stats = { cityCount: { uses: 2, lastUse: "2026-11-01T10:00:00.000Z", failures: 1 } };
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putStats(w.UL, stats);
    putArchived(w.UA, "old", OLD);
    const sequences = `${Array(3).fill(sequenceLineOf(["practice.count"])).join("\n")}\n`;
    putSequences(w, sequences);
    const snapshot = () => ({
      library: names(w.UL).map((name) => [name, readFileSync(join(w.UL, name), "utf8")]),
      archive: names(w.UA).map((name) => [name, readFileSync(join(w.UA, name), "utf8")]),
      sequences: sequencesText(w),
      home: names(join(w.H, ".onetool")),
    });
    const before = snapshot();
    assert.equal(before.sequences, sequences);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      await ran(ctx, REPORT);
      await ran(ctx, 'await library.read("cityCount")');
      await ran(ctx, 'await library.read("nope").catch(() => 0)');
      await ctx.client.listPrompts();
      await ctx.client.getPrompt({ name: "tidy-library" });
      await ctx.client.listTools();
      await ctx.call("search", {});
    });
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(statsOf(w.UL), stats);
  });

  test("the three calls in a job are calls like any other: its answer holds the text and the trail", async () => {
    const w = world();
    putProgram(w.UL, "kept", { about: "Kept.", code: "1" });
    putArchived(w.UA, "old", OLD);
    await inLib(w, libSettings({ backgroundSeconds: 10 }), async (ctx) => {
      const jobs = jobsOf(viaCtx(ctx));
      await jobs.start('[await library.restore("old"), JSON.stringify(await library.read("kept")), (await library.report()).split("\\n")[0]].join("|")');
      const ended = await jobs.untilEnded("j1");
      assert.equal(ended.isError, false, ended.text);
      assert.ok(ended.text.includes(`${backIn("old", "user")}|${JSON.stringify(programText({ about: "Kept.", code: "1" }))}|Library report: 2 programs`), ended.text);
      const trail = trailOf(ended.text);
      assert.deepEqual(
        trail.slice(1).map((line) => line.split(" ")[0]),
        ["library.restore", "library.read", "library.report"],
      );
    });
  });

  test("nothing on standard error, and no answer holds a library folder or the path of the sequences file", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putArchived(w.UA, "old", OLD);
    putSequences(w, `${sequenceLineOf(["practice.count"])}\n`);
    await inLib(w, WITH_LOG(w), async (ctx) => {
      const answers = [
        await ran(ctx, REPORT),
        await ran(ctx, 'await library.read("cityCount")'),
        await ran(ctx, 'await library.restore("old")'),
        await ran(ctx, 'await library.restore("old")'),
        await ran(ctx, 'await library.read("nope")'),
        await ran(ctx, "(await tools.practice.count({})).count"),
      ];
      await sleep(200);
      assert.equal(ctx.stderr(), "");
      const places = [w.H, w.W, w.UL, w.UA, w.PL, w.PA, sequencesOf(w), join(w.H, ".onetool")];
      for (const { text } of answers) for (const place of places) assert.equal(text.includes(place), false, `an answer holds ${place}: ${text}`);
      assert.equal(logText(w.L).includes(w.H), false);
    });
  });
});
