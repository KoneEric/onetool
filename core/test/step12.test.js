import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.js";
import { settingsOf, faultOf, deepFreeze, printedBy } from "./helpers.js";

// The names are read off the module at call time, so a missing one fails its own test and not the file.
const nextStreak = (...args) => {
  assert.equal(typeof core.nextStreak, "function", "nextStreak is not exported");
  return core.nextStreak(...args);
};
const oneProgramNote = (...args) => {
  assert.equal(typeof core.oneProgramNote, "function", "oneProgramNote is not exported");
  return core.oneProgramNote(...args);
};
const sessionLine = (...args) => {
  assert.equal(typeof core.sessionLine, "function", "sessionLine is not exported");
  return core.sessionLine(...args);
};
const searchTools = (...args) => core.searchTools(...args);
const formatTrail = (...args) => core.formatTrail(...args);

const withOnetool = (onetool) => ({ mcpServers: {}, onetool });
const problemsOf = (onetool) => faultOf(withOnetool(onetool)).problems;
const INSTRUCTIONS_PROBLEM = "onetool.instructions: must be true or false";
const LIBRARY_CAP = "onetool.libraryCap: must be a whole number from 1 to 1000";
const MAX_JOBS = "onetool.maxJobs: must be a whole number from 0 to 100";

// -- the exports -----------------------------------------------------------------------------------------------

describe("step 12: the exports", () => {
  test("INSTRUCTIONS is a string, and the three new names are functions", () => {
    assert.equal(typeof core.INSTRUCTIONS, "string");
    for (const name of ["nextStreak", "oneProgramNote", "sessionLine"]) {
      assert.equal(typeof core[name], "function", name);
    }
  });
});

// -- instructions in the settings file -------------------------------------------------------------------------

describe("step 12: instructions in the settings file", () => {
  test("absent: true", () => {
    assert.equal(settingsOf({ mcpServers: {} }).instructions, true);
    assert.equal(settingsOf({ mcpServers: {}, onetool: {} }).instructions, true);
    assert.equal(settingsOf(withOnetool({ searchLimit: 3 })).instructions, true);
  });

  test("true and false are kept", () => {
    assert.equal(settingsOf(withOnetool({ instructions: true })).instructions, true);
    assert.equal(settingsOf(withOnetool({ instructions: false })).instructions, false);
  });

  test("anything else is the problem, exact, and the reading goes on", () => {
    const bad = [null, "false", "true", "", 0, 1, -1, 0.5, "text", [], [true], {}, { value: true }];
    for (const value of bad) {
      assert.deepEqual(problemsOf({ instructions: value }), [INSTRUCTIONS_PROBLEM], JSON.stringify(value));
    }
  });

  test("it is not an unknown key, and a wrong case stays unknown", () => {
    assert.ok(!problemsOf({ instructions: 5, foo: 1 }).includes("onetool.instructions: unknown key"));
    assert.deepEqual(problemsOf({ Instructions: true }), ["onetool.Instructions: unknown key"]);
    assert.deepEqual(problemsOf({ instruction: true }), ["onetool.instruction: unknown key"]);
    assert.deepEqual(problemsOf({ INSTRUCTIONS: true }), ["onetool.INSTRUCTIONS: unknown key"]);
  });

  test("its problem comes after the one of libraryCap, and the message joins them", () => {
    const got = faultOf({ onetool: { instructions: 1, libraryCap: 0, maxJobs: 101, zzz: 1 } });
    assert.deepEqual(got.problems, [
      "mcpServers: missing",
      "onetool.zzz: unknown key",
      MAX_JOBS,
      LIBRARY_CAP,
      INSTRUCTIONS_PROBLEM,
    ]);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("the text itself is not set in the file: a text is not valid", () => {
    assert.deepEqual(problemsOf({ instructions: "Use run for everything." }), [INSTRUCTIONS_PROBLEM]);
  });

  test("no problem holds a value of the file", () => {
    const problems = problemsOf({ instructions: "SECRET-1" });
    assert.deepEqual(problems, [INSTRUCTIONS_PROBLEM]);
    assert.ok(!problems.join(" ").includes("SECRET"));
  });

  test("the whole returned object, with instructions false; the rest is as before", () => {
    const got = settingsOf({ mcpServers: { s: { command: "node" } }, onetool: { instructions: false } });
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
      trail: true,
      log: true,
      logFolder: null,
      hostRules: true,
      hostServers: [],
      backgroundSeconds: 7200,
      maxJobs: 3,
      libraryCap: 50,
      instructions: false,
    });
  });

  test("the returned keys are those of before plus instructions", () => {
    assert.deepEqual(Object.keys(settingsOf({ mcpServers: {} })).sort(), [
      "allow",
      "answerLimit",
      "ask",
      "backgroundSeconds",
      "bad",
      "connectSeconds",
      "deny",
      "hostRules",
      "hostServers",
      "instructions",
      "libraryCap",
      "log",
      "logFolder",
      "maxJobs",
      "searchLimit",
      "servers",
      "shell",
      "stateLimit",
      "timeoutSeconds",
      "trail",
    ]);
  });

  test("it prints nothing", () => {
    assert.deepEqual(printedBy(() => settingsOf(withOnetool({ instructions: false }))), []);
  });
});

// -- INSTRUCTIONS ----------------------------------------------------------------------------------------------

describe("step 12: INSTRUCTIONS", () => {
  const TEXT =
    "onetool gives you two tools, run and search. It saves context only when one program does several steps. " +
    "Before the first run, list the steps of the task. Put every step that needs no decision into one program: " +
    "loops, filters, several tools. Return only the small result you need to decide what comes next. Keep large " +
    "results in state and look at them in a later program. Never use run for one tool call when the next call is " +
    "already known: put both calls in one program.";

  test("it is exactly the text of the meeting point", () => {
    assert.equal(core.INSTRUCTIONS, TEXT);
  });

  test("it is one line, 470 characters, and at most 600", () => {
    assert.equal(typeof core.INSTRUCTIONS, "string");
    assert.equal(core.INSTRUCTIONS.length, 470);
    assert.ok(core.INSTRUCTIONS.length <= 600);
    assert.ok(!/[\r\n]/.test(core.INSTRUCTIONS));
  });

  test("it does not change with the settings read", () => {
    settingsOf(withOnetool({ instructions: false }));
    assert.equal(core.INSTRUCTIONS, TEXT);
  });
});

// -- nextStreak ------------------------------------------------------------------------------------------------

describe("step 12: nextStreak", () => {
  const ONE = { ok: true, calls: 1, asked: false, lib: 0 };

  test("the examples of the meeting point", () => {
    assert.deepEqual(nextStreak(0, ONE), { streak: 1, say: false });
    assert.deepEqual(nextStreak(2, ONE), { streak: 0, say: true });
    assert.deepEqual(nextStreak(2, { ok: true, calls: 3, asked: false, lib: 0 }), { streak: 0, say: false });
    assert.deepEqual(nextStreak(2, { ok: true, calls: 1, asked: true, lib: 0 }), { streak: 0, say: false });
    assert.deepEqual(nextStreak(2, { ok: true, calls: 1, asked: false, lib: 1 }), { streak: 0, say: false });
    assert.deepEqual(nextStreak(2, { ok: false, calls: 1, asked: false, lib: 0 }), { streak: 0, say: false });
  });

  test("a program counts when ok, exactly one call, not asked, no saved program; below the limit the streak grows", () => {
    assert.deepEqual(nextStreak(1, ONE), { streak: 2, say: false });
  });

  test("each way of not counting puts the streak back to 0, whatever it was", () => {
    const others = [
      { ok: true, calls: 0, asked: false, lib: 0 },
      { ok: true, calls: 2, asked: false, lib: 0 },
      { ok: true, calls: 10, asked: false, lib: 0 },
      { ok: true, calls: 1, asked: true, lib: 0 },
      { ok: true, calls: 1, asked: false, lib: 1 },
      { ok: true, calls: 1, asked: false, lib: 4 },
      { ok: false, calls: 1, asked: false, lib: 0 },
      { ok: false, calls: 0, asked: false, lib: 0 },
      { ok: false, calls: 1, asked: true, lib: 1 },
    ];
    for (const streak of [0, 1, 2, 5]) {
      for (const program of others) {
        assert.deepEqual(nextStreak(streak, program), { streak: 0, say: false }, `${streak} ${JSON.stringify(program)}`);
      }
    }
  });

  test("the result has exactly the two keys, streak and say", () => {
    for (const [streak, program] of [[0, ONE], [2, ONE], [1, { ...ONE, calls: 2 }]]) {
      assert.deepEqual(Object.keys(nextStreak(streak, program)).sort(), ["say", "streak"]);
    }
  });

  test("the line is said for the third program, and again only after three more that count", () => {
    let streak = 0;
    const said = [];
    for (let i = 0; i < 7; i++) {
      const got = nextStreak(streak, ONE);
      streak = got.streak;
      said.push(got.say);
    }
    assert.deepEqual(said, [false, false, true, false, false, true, false]);
    assert.equal(streak, 1);
  });

  test("a program that does not count in the middle starts the count again", () => {
    let streak = nextStreak(0, ONE).streak;
    streak = nextStreak(streak, ONE).streak;
    assert.equal(streak, 2);
    const broken = nextStreak(streak, { ...ONE, calls: 2 });
    assert.deepEqual(broken, { streak: 0, say: false });
    assert.deepEqual(nextStreak(broken.streak, ONE), { streak: 1, say: false });
  });

  test("a streak already at or above times: streak + 1 is times or more, so it is said and put back to 0", () => {
    assert.deepEqual(nextStreak(3, ONE), { streak: 0, say: true });
    assert.deepEqual(nextStreak(7, ONE), { streak: 0, say: true });
  });

  test("times: 1 makes every program that counts say it", () => {
    assert.deepEqual(nextStreak(0, ONE, { times: 1 }), { streak: 0, say: true });
    assert.deepEqual(nextStreak(0, { ...ONE, calls: 2 }, { times: 1 }), { streak: 0, say: false });
  });

  test("times: 2 and times: 5", () => {
    assert.deepEqual(nextStreak(0, ONE, { times: 2 }), { streak: 1, say: false });
    assert.deepEqual(nextStreak(1, ONE, { times: 2 }), { streak: 0, say: true });
    assert.deepEqual(nextStreak(3, ONE, { times: 5 }), { streak: 4, say: false });
    assert.deepEqual(nextStreak(4, ONE, { times: 5 }), { streak: 0, say: true });
    assert.deepEqual(nextStreak(2, ONE, { times: 5 }), { streak: 3, say: false });
  });

  test("the default of times is 3, whether the option is absent, empty or undefined", () => {
    for (const options of [undefined, {}, { times: undefined }]) {
      assert.deepEqual(nextStreak(1, ONE, options), { streak: 2, say: false });
      assert.deepEqual(nextStreak(2, ONE, options), { streak: 0, say: true });
    }
  });

  test("other keys of the program are not read", () => {
    assert.deepEqual(nextStreak(2, { ...ONE, name: "x", extra: 9, error: "e" }), { streak: 0, say: true });
    assert.deepEqual(nextStreak(0, { ...ONE, name: "x", extra: 9 }), { streak: 1, say: false });
  });

  test("it changes no argument, keeps nothing and prints nothing", () => {
    const program = deepFreeze({ ...ONE });
    const options = deepFreeze({ times: 3 });
    const printed = printedBy(() => {
      assert.deepEqual(nextStreak(2, program, options), { streak: 0, say: true });
      assert.deepEqual(nextStreak(2, program, options), { streak: 0, say: true });
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(program, ONE);
    assert.deepEqual(nextStreak(0, ONE), { streak: 1, say: false });
  });

  test("the result is a new object each time", () => {
    assert.notEqual(nextStreak(0, ONE), nextStreak(0, ONE));
  });
});

// -- oneProgramNote --------------------------------------------------------------------------------------------

describe("step 12: oneProgramNote", () => {
  test("the line, with times put in", () => {
    assert.equal(oneProgramNote(3), "(the last 3 programs each made one call: they could have been one program)");
    assert.equal(oneProgramNote(1), "(the last 1 programs each made one call: they could have been one program)");
    assert.equal(oneProgramNote(10), "(the last 10 programs each made one call: they could have been one program)");
    assert.equal(oneProgramNote(100), "(the last 100 programs each made one call: they could have been one program)");
  });

  test("it is one line in parentheses, with no line break at either end", () => {
    const note = oneProgramNote(3);
    assert.ok(note.startsWith("(") && note.endsWith(")"));
    assert.ok(!/[\r\n]/.test(note));
    assert.equal(note, note.trim());
  });

  test("it is handed to formatTrail in notes, as it is", () => {
    const note = oneProgramNote(3);
    assert.equal(formatTrail([], { notes: [note] }), `--- calls ---\n${note}`);
  });

  test("it prints nothing", () => {
    assert.deepEqual(printedBy(() => oneProgramNote(3)), []);
  });
});

// -- sessionLine -----------------------------------------------------------------------------------------------

describe("step 12: sessionLine", () => {
  test("the examples of the meeting point", () => {
    assert.equal(sessionLine(3, 3), "this session: 3 programs, 3 calls, 1.0 calls per program");
    assert.equal(sessionLine(4, 6), "this session: 4 programs, 6 calls, 1.5 calls per program");
    assert.equal(sessionLine(1, 0), "this session: 1 programs, 0 calls, 0.0 calls per program");
    assert.equal(sessionLine(3, 2000), "this session: 3 programs, 2000 calls, 666.7 calls per program");
    assert.equal(sessionLine(0, 0), "");
  });

  test("no programs: the empty string, whatever the calls are", () => {
    assert.equal(sessionLine(0, 5), "");
  });

  test("always `programs` and `calls`, also for 1", () => {
    assert.equal(sessionLine(1, 1), "this session: 1 programs, 1 calls, 1.0 calls per program");
    assert.equal(sessionLine(2, 1), "this session: 2 programs, 1 calls, 0.5 calls per program");
  });

  test("the rate has one decimal, always: calls / programs, written with toFixed(1)", () => {
    assert.equal(sessionLine(2, 4), "this session: 2 programs, 4 calls, 2.0 calls per program");
    assert.equal(sessionLine(3, 1), "this session: 3 programs, 1 calls, 0.3 calls per program"); // 1 / 3 = 0.333...
    assert.equal(sessionLine(3, 2), "this session: 3 programs, 2 calls, 0.7 calls per program"); // 2 / 3 = 0.666...
    assert.equal(sessionLine(1, 10), "this session: 1 programs, 10 calls, 10.0 calls per program");
    // the rounding of a tie is the one of toFixed, whatever it is for this value
    assert.equal(sessionLine(20, 21), `this session: 20 programs, 21 calls, ${(21 / 20).toFixed(1)} calls per program`);
    assert.equal(sessionLine(8, 1), `this session: 8 programs, 1 calls, ${(1 / 8).toFixed(1)} calls per program`);
  });

  test("the numbers are in digits with no separator", () => {
    assert.equal(sessionLine(1, 1000000), "this session: 1 programs, 1000000 calls, 1000000.0 calls per program");
    assert.equal(sessionLine(12345, 0), "this session: 12345 programs, 0 calls, 0.0 calls per program");
  });

  test("it is one line, and it prints nothing", () => {
    assert.ok(!sessionLine(4, 6).includes("\n"));
    assert.deepEqual(printedBy(() => sessionLine(4, 6)), []);
  });
});

// -- searchTools and the session -------------------------------------------------------------------------------

describe("step 12: searchTools and the session", () => {
  const tool = (name, description) => ({ name, description });
  const practice = {
    server: "practice",
    tools: [
      tool("rows", "Returns the practice table: 5,000 rows of id, name, city and amount."),
      tool("count", "Counts rows."),
      tool("wipe", "Deletes things."),
      tool("find", "Finds one row."),
      tool("sum", "Adds amounts."),
    ],
  };
  const program = (name, about) => ({ name, about, params: [], uses: 0 });
  const cityCount = program("cityCount", "Counts the rows of one city.");
  const SESSION_4_6 = "this session: 4 programs, 6 calls, 1.5 calls per program";
  const NO_WORDS = [undefined, null, "", "  \t\n "];

  test("the example of the meeting point", () => {
    assert.equal(searchTools([practice], undefined, { session: { programs: 4, calls: 6 } }), `practice: 5 tools\n${SESSION_4_6}`);
  });

  test("an empty catalog, no saved program and a session of 2 programs and 0 calls: two lines", () => {
    assert.equal(
      searchTools([], undefined, { session: { programs: 2, calls: 0 } }),
      "No server is listed.\nthis session: 2 programs, 0 calls, 0.0 calls per program",
    );
  });

  test("no session, undefined, null: nothing changes, to the character", () => {
    const catalog = [practice, { server: "dead", tools: [], error: "down" }];
    for (const words of [...NO_WORDS, "rows", "nothing-matches"]) {
      for (const programs of [undefined, [], [cityCount]]) {
        const before = searchTools(catalog, words, programs === undefined ? {} : { programs });
        assert.equal(searchTools(catalog, words, { programs, session: undefined }), before, JSON.stringify(words));
        assert.equal(searchTools(catalog, words, { programs, session: null }), before, JSON.stringify(words));
        assert.equal(searchTools(catalog, words, { session: undefined, ...(programs ? { programs } : {}) }), before);
      }
    }
    assert.equal(searchTools([], undefined, { session: null }), "No server is listed.");
    assert.equal(searchTools([], undefined, { session: undefined }), "No server is listed.");
  });

  test("with no words, of every kind: the line of the session is added, one line break before it", () => {
    const catalog = [practice, { server: "dead", tools: [], error: "down" }];
    const before = searchTools(catalog);
    assert.equal(before, "practice: 5 tools\ndead: not connected (down)");
    for (const words of NO_WORDS) {
      assert.equal(searchTools(catalog, words, { session: { programs: 4, calls: 6 } }), `${before}\n${SESSION_4_6}`, JSON.stringify(words));
    }
  });

  test("a session of no program adds nothing: not even a line break", () => {
    const catalog = [practice];
    assert.equal(searchTools(catalog, undefined, { session: { programs: 0, calls: 0 } }), "practice: 5 tools");
    assert.equal(searchTools(catalog, undefined, { session: { programs: 0, calls: 3 } }), "practice: 5 tools");
    assert.equal(searchTools([], undefined, { session: { programs: 0, calls: 0 } }), "No server is listed.");
    assert.equal(
      searchTools([], undefined, { programs: [cityCount], session: { programs: 0, calls: 0 } }),
      "library: 1 programs",
    );
  });

  test("the line of the session is the last one, after the line of the library", () => {
    const catalog = [practice];
    assert.equal(
      searchTools(catalog, undefined, { programs: [cityCount, program("b", "B.")], session: { programs: 4, calls: 6 } }),
      `practice: 5 tools\nlibrary: 2 programs\n${SESSION_4_6}`,
    );
    assert.equal(
      searchTools([], undefined, { programs: [cityCount], session: { programs: 4, calls: 6 } }),
      `library: 1 programs\n${SESSION_4_6}`,
    );
  });

  test("the line is the one of sessionLine, for the numbers of the session", () => {
    assert.equal(
      searchTools([practice], undefined, { session: { programs: 3, calls: 2000 } }),
      "practice: 5 tools\nthis session: 3 programs, 2000 calls, 666.7 calls per program",
    );
    assert.equal(
      searchTools([practice], undefined, { session: { programs: 1, calls: 0 } }),
      "practice: 5 tools\nthis session: 1 programs, 0 calls, 0.0 calls per program",
    );
  });

  test("the limit does not hide the line of the session", () => {
    assert.equal(
      searchTools([practice, { server: "other", tools: [] }], undefined, { limit: 1, session: { programs: 4, calls: 6 } }),
      `practice: 5 tools\nother: 0 tools\n${SESSION_4_6}`,
    );
  });

  test("with words, the session is not read and the answer is what it was", () => {
    const catalog = [practice];
    const unread = {};
    Object.defineProperty(unread, "programs", { get: () => assert.fail("session.programs was read"), enumerable: true });
    Object.defineProperty(unread, "calls", { get: () => assert.fail("session.calls was read"), enumerable: true });
    for (const words of ["rows", "row", "count wipe", "nothing-matches"]) {
      const before = searchTools(catalog, words);
      assert.equal(searchTools(catalog, words, { session: { programs: 4, calls: 6 } }), before, words);
      assert.equal(searchTools(catalog, words, { session: unread }), before, words);
      assert.equal(searchTools(catalog, words, { programs: [cityCount], session: unread }), searchTools(catalog, words, { programs: [cityCount] }), words);
    }
    assert.equal(searchTools([], "x", { session: { programs: 4, calls: 6 } }), "No tool matches.");
  });

  test("with words and a limit that cuts the matches: the answer is what it was", () => {
    const got = searchTools([practice], "rows", { limit: 1, session: { programs: 4, calls: 6 } });
    assert.equal(got, searchTools([practice], "rows", { limit: 1 }));
    assert.ok(!got.includes("this session"));
  });

  test("a server named `this session` is a server like any other", () => {
    const named = { server: "this session", tools: [tool("a", "A."), tool("b", "B.")] };
    assert.equal(searchTools([named], undefined), "this session: 2 tools");
    assert.equal(
      searchTools([named], undefined, { session: { programs: 4, calls: 6 } }),
      `this session: 2 tools\n${SESSION_4_6}`,
    );
    assert.equal(searchTools([named], "a"), "this session.a() - A.");
  });

  test("it changes no argument and prints nothing", () => {
    const catalog = deepFreeze([practice]);
    const options = deepFreeze({ programs: [cityCount], session: { programs: 4, calls: 6 } });
    const printed = printedBy(() => {
      assert.equal(searchTools(catalog, undefined, options), `practice: 5 tools\nlibrary: 1 programs\n${SESSION_4_6}`);
    });
    assert.deepEqual(printed, []);
  });
});
