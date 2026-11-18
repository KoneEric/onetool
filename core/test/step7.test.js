import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.js";
import { settingsOf, faultOf, deepFreeze, printedBy } from "./helpers.js";

// The functions are read off the module at call time, so a missing one fails its own test and not the file.
const runRequest = (...args) => core.runRequest(...args);
const programLine = (...args) => core.programLine(...args);
const libraryText = (...args) => core.libraryText(...args);
const saveItNote = (...args) => core.saveItNote(...args);
const sameAsNote = (...args) => core.sameAsNote(...args);
const archivedNote = (...args) => core.archivedNote(...args);
const searchTools = (...args) => core.searchTools(...args);
const formatTrail = (...args) => core.formatTrail(...args);
const withTrail = (...args) => core.withTrail(...args);
const decide = (...args) => core.decide(...args);

const withOnetool = (onetool) => ({ mcpServers: {}, onetool });
const problemsOf = (onetool) => faultOf(withOnetool(onetool)).problems;
const LIBRARY_CAP = "onetool.libraryCap: must be a whole number from 1 to 1000";
const MAX_JOBS = "onetool.maxJobs: must be a whole number from 0 to 100";
const TAKEN = "the name is taken by the built-in library";

// -- the exports -----------------------------------------------------------------------------------------------

describe("step 7: the exports", () => {
  test("the five new names are functions of core/src/index.js", () => {
    for (const name of ["programLine", "libraryText", "saveItNote", "sameAsNote", "archivedNote"]) {
      assert.equal(typeof core[name], "function", name);
    }
  });
});

// -- runRequest and null ---------------------------------------------------------------------------------------

describe("step 7: runRequest reads null as not given", () => {
  const problem = (text) => ({ problem: text });
  const NEEDS_CODE = 'onetool: run needs "code", a text';
  const SEVERAL = 'onetool: run takes one of "code", "job" and "jobs", not several';
  const TAKES = (name) => `onetool: run takes "${name}", true or false`;

  test("the examples of the meeting point", () => {
    assert.deepEqual(runRequest({ code: "1", background: null, job: null, stop: null, jobs: null }), {
      mode: "run",
      code: "1",
      background: false,
    });
    assert.deepEqual(runRequest({ job: "j1", stop: null, code: null }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ jobs: null }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: null }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: "1", stop: 0 }), problem(TAKES("stop")));
  });

  test("null for each of the three is the same as absent, in each mode", () => {
    for (const name of ["background", "stop", "jobs"]) {
      assert.deepEqual(runRequest({ code: "1", [name]: null }), { mode: "run", code: "1", background: false }, name);
    }
    assert.deepEqual(runRequest({ job: "j1", background: null }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ job: "j1", jobs: null, stop: null, background: null }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ jobs: true, background: null, stop: null }), { mode: "jobs" });
  });

  test("null does not ask: the other two and the problems of the table decide", () => {
    assert.deepEqual(runRequest({ stop: null }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ background: null }), problem(NEEDS_CODE));
    assert.deepEqual(runRequest({ code: "1", job: "j1", jobs: null }), problem(SEVERAL));
    assert.deepEqual(runRequest({ code: "1", jobs: true, background: null }), problem(SEVERAL));
    assert.deepEqual(runRequest({ code: "1", stop: true, background: null }), problem('onetool: run takes "stop" only with "job"'));
    assert.deepEqual(runRequest({ job: "j1", background: true, stop: null }), problem('onetool: run takes "background" only with "code"'));
  });

  test("the values that are still refused by test 2: yes, 0, 1, the empty string, a list, an object", () => {
    for (const name of ["background", "stop", "jobs"]) {
      for (const value of ["yes", "true", 0, 1, "", [], [true], {}]) {
        assert.deepEqual(runRequest({ code: "1", [name]: value }), problem(TAKES(name)), `${name} ${JSON.stringify(value)}`);
      }
    }
  });

  test("test 2 names the first that is not valid while the others are null", () => {
    assert.deepEqual(runRequest({ background: null, stop: "y", jobs: null, code: "1" }), problem(TAKES("stop")));
    assert.deepEqual(runRequest({ background: null, stop: null, jobs: 1 }), problem(TAKES("jobs")));
    assert.deepEqual(runRequest({ background: 1, stop: null, jobs: null, code: "1" }), problem(TAKES("background")));
  });

  test("job and code keep their rules with null", () => {
    assert.deepEqual(runRequest({ job: null, code: "1" }), { mode: "run", code: "1", background: false });
    assert.deepEqual(runRequest({ job: "j1", code: null }), { mode: "job", job: "j1", stop: false });
    assert.deepEqual(runRequest({ jobs: true, code: null, job: null }), { mode: "jobs" });
  });

  test("it does not change its argument and prints nothing", () => {
    const printed = printedBy(() => {
      runRequest(deepFreeze({ code: "1", background: null, job: null, stop: null, jobs: null }));
      runRequest(deepFreeze({ job: "j1", stop: null, code: null }));
    });
    assert.deepEqual(printed, []);
  });
});

// -- libraryCap ------------------------------------------------------------------------------------------------

describe("step 7: libraryCap in the settings file", () => {
  test("not in the file: 50", () => {
    for (const file of [{ mcpServers: {} }, withOnetool({}), withOnetool({ maxJobs: 1 }), withOnetool({ shell: {} })]) {
      assert.equal(settingsOf(file).libraryCap, 50);
    }
  });

  test("a whole number from 1 to 1000, both ends included, is kept", () => {
    for (const value of [1, 2, 49, 50, 51, 999, 1000]) {
      const got = settingsOf(withOnetool({ libraryCap: value }));
      assert.equal(got.libraryCap, value);
      assert.equal(got.bad.length, 0);
    }
  });

  test("not valid: 0, 1001, 2.5, a string, true, null, and the other wrong kinds", () => {
    for (const value of [0, 1001, 2.5, "50", true, null, -1, 0.5, 1000.5, 100000, "", false, [], [50], {}]) {
      assert.deepEqual(problemsOf({ libraryCap: value }), [LIBRARY_CAP], JSON.stringify(value));
    }
  });

  test("libraryCap is not an unknown key, and a wrong case stays unknown", () => {
    assert.ok(!problemsOf({ libraryCap: "x", foo: 1 }).includes("onetool.libraryCap: unknown key"));
    assert.deepEqual(problemsOf({ librarycap: 5 }), ["onetool.librarycap: unknown key"]);
    assert.deepEqual(problemsOf({ LibraryCap: 5 }), ["onetool.LibraryCap: unknown key"]);
    assert.deepEqual(problemsOf({ library_cap: 5 }), ["onetool.library_cap: unknown key"]);
  });

  test("its problem comes after the one of maxJobs, and the message joins them", () => {
    const got = faultOf({ onetool: { libraryCap: 0, maxJobs: 101, backgroundSeconds: 0, zzz: 1 } });
    assert.deepEqual(got.problems, [
      "mcpServers: missing",
      "onetool.zzz: unknown key",
      "onetool.backgroundSeconds: must be a number above 0, at most 86400",
      MAX_JOBS,
      LIBRARY_CAP,
    ]);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("no problem holds a value of the file", () => {
    const problems = problemsOf({ libraryCap: "SECRET-1" });
    assert.deepEqual(problems, [LIBRARY_CAP]);
    assert.ok(!problems.join(" ").includes("SECRET"));
  });

  test("the whole returned object, with libraryCap given; the shell and the trail default are as before", () => {
    const got = settingsOf({ mcpServers: { s: { command: "node" } }, onetool: { libraryCap: 7 } });
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
      backgroundSeconds: 7200,
      maxJobs: 3,
      libraryCap: 7,
    });
    assert.equal(settingsOf(withOnetool({ shell: {} })).trail, true);
  });
});

// -- a server named library ------------------------------------------------------------------------------------

describe("step 7: a server named library", () => {
  const CMD = { command: "node" };
  const ABS = process.platform === "win32" ? "C:\\work" : "/work";

  test("the name `library` goes to bad, whether the shell is on or off", () => {
    for (const onetool of [undefined, {}, { shell: { folders: [ABS] } }, { shell: {} }]) {
      const file = onetool === undefined ? { mcpServers: { library: CMD } } : { mcpServers: { library: CMD }, onetool };
      const got = settingsOf(file);
      assert.deepEqual(got.servers, []);
      assert.deepEqual(got.bad, [{ name: "library", reason: TAKEN }]);
    }
  });

  test("the test comes before `not an object`, `both command and url`, `no command` and the others", () => {
    for (const entry of [null, 5, [], {}, { command: "" }, { command: "x", url: "http://h/x" }, { url: "ftp://h" }, { command: "x", args: 5 }]) {
      const got = settingsOf({ mcpServers: { library: entry } });
      assert.deepEqual(got.bad, [{ name: "library", reason: TAKEN }], JSON.stringify(entry));
    }
  });

  test("a server reached at an address is taken too", () => {
    const got = settingsOf({ mcpServers: { library: { url: "http://h/mcp" } } });
    assert.deepEqual(got.servers, []);
    assert.deepEqual(got.bad, [{ name: "library", reason: TAKEN }]);
  });

  test("`Library`, `LIBRARY`, `lib` and names that only hold `library` are never taken", () => {
    const got = settingsOf({
      mcpServers: { Library: CMD, LIBRARY: CMD, lib: CMD, "library ": CMD, libraries: CMD, mylibrary: CMD },
    });
    assert.deepEqual(got.bad, []);
    assert.deepEqual(
      got.servers.map((s) => s.name),
      ["Library", "LIBRARY", "lib", "library ", "libraries", "mylibrary"],
    );
  });

  test("the other servers and the order of the file are kept; `library` and `shell` are both taken when both are named", () => {
    const got = settingsOf({
      mcpServers: { a: CMD, library: CMD, b: CMD, shell: CMD, c: CMD },
      onetool: { shell: { folders: [ABS] } },
    });
    assert.deepEqual(
      got.servers.map((s) => s.name),
      ["a", "b", "c"],
    );
    assert.deepEqual(got.bad, [
      { name: "library", reason: TAKEN },
      { name: "shell", reason: "the name is taken by the built-in shell" },
    ]);
  });

  test("the ids library.save and library.remove are matched by decide as any id", () => {
    assert.deepEqual(decide({ deny: ["library.remove"] }, "library", "remove"), {
      allowed: false,
      list: "deny",
      rule: "library.remove",
      message: 'onetool: library.remove is denied by the rule deny "library.remove"',
    });
    assert.deepEqual(decide({ deny: ["library.remove"] }, "library", "save"), { allowed: true });
    assert.deepEqual(decide({ allow: ["library.save"] }, "library", "save"), { allowed: true });
    assert.deepEqual(decide({ allow: ["library.save"] }, "library", "remove"), {
      allowed: false,
      list: "allow",
      rule: null,
      message: "onetool: library.remove is not allowed: it matches no rule of allow",
    });
    assert.deepEqual(decide({ ask: ["library.*"] }, "library", "save"), { allowed: true, ask: "library.*" });
  });
});

// -- programLine -----------------------------------------------------------------------------------------------

describe("step 7: programLine", () => {
  const program = (name, about, params = [], uses = 0) => ({ name, about, params, uses });

  test("the line shows how the program is called", () => {
    assert.equal(programLine(program("cityCount", "Counts the rows of one city.", ["city"])), "lib.cityCount({ city }) - Counts the rows of one city.");
    assert.equal(programLine(program("pair", "Two.", ["a", "b"])), "lib.pair({ a, b }) - Two.");
    assert.equal(programLine(program("many", "Many.", ["a", "b", "c"])), "lib.many({ a, b, c }) - Many.");
    assert.equal(programLine(program("all", "Everything.", [])), "lib.all() - Everything.");
  });

  test("an empty about, or white space only: the line ends after the parenthesis", () => {
    assert.equal(programLine(program("all", "", [])), "lib.all()");
    assert.equal(programLine(program("all", " \t\n ", [])), "lib.all()");
    assert.equal(programLine(program("cityCount", "", ["city"])), "lib.cityCount({ city })");
  });

  test("the sentence is not cut at the first full stop; white space runs become one space, trimmed", () => {
    assert.equal(programLine(program("p", "One. Two! Three?", [])), "lib.p() - One. Two! Three?");
    assert.equal(programLine(program("p", "  Counts \n\t the   rows  \r\n of a city.  ", [])), "lib.p() - Counts the rows of a city.");
  });

  test("an about of 160 characters is kept; longer: its first 157 and three dots", () => {
    const a160 = "x".repeat(160);
    assert.equal(programLine(program("p", a160)), `lib.p() - ${a160}`);
    const a161 = "y".repeat(161);
    assert.equal(programLine(program("p", a161)), `lib.p() - ${"y".repeat(157)}...`);
    const long = "word ".repeat(100);
    const sentence = long.replace(/\s+/g, " ").trim();
    assert.equal(programLine(program("p", long)), `lib.p() - ${sentence.slice(0, 157)}...`);
  });

  test("the length is counted after the white space is made one space", () => {
    const text = `${"a".repeat(100)}\n\n\n\n\n\n\n\n\n\n${"b".repeat(59)}`; // 100 + 1 + 59 = 160 once squeezed
    assert.equal(programLine(program("p", text)), `lib.p() - ${"a".repeat(100)} ${"b".repeat(59)}`);
  });

  test("other keys are not read; the argument is not changed and nothing is printed", () => {
    const frozen = deepFreeze({ name: "p", about: "A.", params: ["x"], uses: 9, code: "return 1", extra: [1] });
    let got;
    const printed = printedBy(() => {
      got = programLine(frozen);
    });
    assert.equal(got, "lib.p({ x }) - A.");
    assert.deepEqual(printed, []);
  });
});

// -- libraryText -----------------------------------------------------------------------------------------------

describe("step 7: libraryText", () => {
  const TAIL = ". Call one as await lib.<name>(args); search finds them; library.save(name, { about, params, code }) keeps a new one.";
  const programs = (...pairs) => pairs.map(([name, uses]) => ({ name, about: "", params: [], uses }));
  // The text by the rule: the count, the names when there is at least one, the fixed end.
  const text = (n, names) => `Saved programs: ${n}${names.length ? ` (most used: ${names.join(", ")})` : ""}${TAIL}`;

  test("no program", () => {
    assert.equal(
      libraryText([]),
      "Saved programs: 0. Call one as await lib.<name>(args); search finds them; library.save(name, { about, params, code }) keeps a new one.",
    );
    assert.equal(libraryText([]), text(0, []));
  });

  test("the most used first, equal uses by name; the example of the meeting point", () => {
    const got = libraryText(programs(["b", 4], ["a", 4], ["c", 9]));
    assert.equal(got, text(3, ["c", "a", "b"]));
    assert.ok(got.startsWith("Saved programs: 3 (most used: c, a, b). Call one as"));
  });

  test("the order of the programs given does not matter", () => {
    const want = text(4, ["d", "a", "b", "c"]);
    assert.equal(libraryText(programs(["c", 1], ["b", 1], ["d", 8], ["a", 3])), want);
    assert.equal(libraryText(programs(["a", 3], ["d", 8], ["c", 1], ["b", 1])), want);
  });

  test("names of equal uses are compared as `<` compares strings: capitals before small letters", () => {
    assert.equal(libraryText(programs(["b", 1], ["a", 1], ["B", 1])), text(3, ["B", "a", "b"]));
    assert.equal(libraryText(programs(["a2", 1], ["a10", 1], ["a", 1])), text(3, ["a", "a10", "a2"]));
  });

  test("the argument is not sorted in place, and nothing is printed", () => {
    const given = deepFreeze(programs(["b", 1], ["a", 5]));
    let got;
    const printed = printedBy(() => {
      got = libraryText(given);
    });
    assert.equal(got, text(2, ["a", "b"]));
    assert.deepEqual(
      given.map((p) => p.name),
      ["b", "a"],
    );
    assert.deepEqual(printed, []);
  });

  test("most: five by default, at most that many, none for 0, and more than there are", () => {
    const seven = programs(["g", 1], ["f", 2], ["e", 3], ["d", 4], ["c", 5], ["b", 6], ["a", 7]);
    assert.equal(libraryText(seven), text(7, ["a", "b", "c", "d", "e"]));
    assert.equal(libraryText(seven, { most: 2 }), text(7, ["a", "b"]));
    assert.equal(libraryText(seven, { most: 1 }), text(7, ["a"]));
    assert.equal(libraryText(seven, { most: 0 }), text(7, []));
    assert.equal(libraryText(seven, { most: 50 }), text(7, ["a", "b", "c", "d", "e", "f", "g"]));
    assert.equal(libraryText(seven, {}), libraryText(seven));
    assert.equal(libraryText(seven, undefined), libraryText(seven));
  });

  test("with most 0 there is no parenthesis at all", () => {
    assert.ok(!libraryText(programs(["a", 1]), { most: 0 }).includes("most used"));
  });

  test("the count is in digits", () => {
    const many = Array.from({ length: 1234 }, (_, i) => ({ name: `p${i}`, about: "", params: [], uses: 0 }));
    assert.ok(libraryText(many, { most: 0 }).startsWith("Saved programs: 1234. Call one as"));
  });

  test("limit: a name is shown only when the whole text with it and every name before it fits", () => {
    const three = programs(["x", 3], ["y", 2], ["z", 1]);
    const all = text(3, ["x", "y", "z"]);
    const two = text(3, ["x", "y"]);
    const one = text(3, ["x"]);
    for (const [limit, want] of [
      [all.length, all],
      [all.length - 1, two],
      [two.length, two],
      [two.length - 1, one],
      [150, one],
    ]) {
      assert.ok(limit >= 150, `the limit ${limit} is a valid one`);
      const got = libraryText(three, { limit });
      assert.equal(got, want, `limit ${limit}`);
      assert.ok(got.length <= limit);
    }
  });

  test("limit: when no name fits, no name and no parenthesis", () => {
    const x = "x".repeat(10);
    const three = programs([x, 3], ["y".repeat(10), 2], ["z".repeat(10), 1]);
    const bare = text(3, []);
    const withOne = text(3, [x]);
    assert.ok(bare.length < 150 && withOne.length > 150);
    assert.equal(libraryText(three, { limit: 150 }), bare);
    assert.equal(libraryText(three, { limit: withOne.length - 1 }), bare);
    assert.equal(libraryText(three, { limit: withOne.length }), withOne);
  });

  test("limit: the first name that does not fit ends the list: no later, shorter name is tried", () => {
    const longName = "b".repeat(12);
    const list = programs(["a", 3], [longName, 2], ["c", 1]);
    const skip = text(3, ["a", "c"]); // what the list would be if the long name were passed over
    assert.ok(skip.length >= 150);
    assert.equal(libraryText(list, { limit: skip.length }), text(3, ["a"]));
  });

  test("limit: never longer than the limit, whatever the names", () => {
    const huge = Array.from({ length: 300 }, (_, i) => ({ name: `${"n".repeat(500)}${i}`, about: "", params: [], uses: i }));
    for (const limit of [150, 200, 298, 1000]) {
      const got = libraryText(huge, { limit });
      assert.ok(got.length <= limit, `limit ${limit}`);
      assert.ok(got.startsWith("Saved programs: 300"));
      assert.ok(got.endsWith(TAIL));
    }
    assert.equal(libraryText(huge, { limit: 150 }), text(300, []));
  });

  test("the default limit is 298", () => {
    const n1 = "a".repeat(60);
    const n2 = "b".repeat(60);
    const n3 = "c".repeat(60);
    const list = programs([n1, 3], [n2, 2], [n3, 1]);
    const withTwo = text(3, [n1, n2]);
    const withThree = text(3, [n1, n2, n3]);
    assert.ok(withTwo.length <= 298 && withThree.length > 298, `${withTwo.length} and ${withThree.length}`);
    assert.equal(libraryText(list), withTwo);
    assert.equal(libraryText(list, { limit: 298 }), withTwo);
    assert.equal(libraryText(list, { limit: withThree.length }), withThree);
  });
});

// -- the three notes -------------------------------------------------------------------------------------------

describe("step 7: saveItNote, sameAsNote, archivedNote", () => {
  test("saveItNote", () => {
    assert.equal(saveItNote(3), "(this sequence of calls has run 3 times: save it as a program with library.save)");
    assert.equal(saveItNote(12), "(this sequence of calls has run 12 times: save it as a program with library.save)");
    assert.equal(saveItNote(1), "(this sequence of calls has run 1 times: save it as a program with library.save)");
  });

  test("sameAsNote", () => {
    assert.equal(sameAsNote("cityCount"), "(lib.cityCount does this: call it)");
    assert.equal(sameAsNote("a"), "(lib.a does this: call it)");
  });

  test("archivedNote", () => {
    assert.equal(archivedNote("broken", 5), "(lib.broken failed 5 times in a row: it was moved to the archive)");
    assert.equal(archivedNote("x", 1), "(lib.x failed 1 times in a row: it was moved to the archive)");
    assert.equal(archivedNote("x", 10), "(lib.x failed 10 times in a row: it was moved to the archive)");
  });

  test("the notes are one line each and print nothing", () => {
    let got;
    const printed = printedBy(() => {
      got = [saveItNote(3), sameAsNote("a"), archivedNote("a", 2)];
    });
    assert.deepEqual(printed, []);
    for (const line of got) assert.ok(!line.includes("\n"));
  });
});

// -- searchTools and the saved programs ------------------------------------------------------------------------

describe("step 7: searchTools and the saved programs", () => {
  const tool = (name, description, properties) => {
    const t = { name };
    if (description !== undefined) t.description = description;
    if (properties) t.inputSchema = { type: "object", properties };
    return t;
  };
  const program = (name, about, params = []) => ({ name, about, params, uses: 0 });
  const cityCount = program("cityCount", "Counts the rows of one city.", ["city"]);
  const CITY_LINE = "lib.cityCount({ city }) - Counts the rows of one city.";
  const practice = {
    server: "practice",
    tools: [tool("rows", "Returns the practice table: 5,000 rows of id, name, city and amount."), tool("wipe", "Deletes things."), tool("count", "Counts rows.")],
  };
  const ROWS = "practice.rows() - Returns the practice table: 5,000 rows of id, name, city and amount.";
  const COUNT = "practice.count() - Counts rows.";

  test("no program, or an empty list, or undefined: as before to the character", () => {
    for (const words of [undefined, "", "rows", "nothing-matches"]) {
      const before = searchTools([practice], words);
      assert.equal(searchTools([practice], words, { programs: [] }), before);
      assert.equal(searchTools([practice], words, { programs: undefined }), before);
      assert.equal(searchTools([practice], words, {}), before);
    }
    assert.equal(searchTools([], undefined, { programs: [] }), "No server is listed.");
    assert.equal(searchTools([], "x", { programs: [] }), "No tool matches.");
  });

  test("no words: the lines of the catalog, then one line `library: <n> programs`", () => {
    const catalog = [practice, { server: "dead", tools: [], error: "down" }];
    const before = searchTools(catalog);
    assert.equal(before, "practice: 3 tools\ndead: not connected (down)");
    for (const words of [undefined, null, "", "  \t\n "]) {
      assert.equal(searchTools(catalog, words, { programs: [cityCount] }), `${before}\nlibrary: 1 programs`, JSON.stringify(words));
      assert.equal(searchTools(catalog, words, { programs: [cityCount, program("b", "B.")] }), `${before}\nlibrary: 2 programs`);
    }
  });

  test("no words: an empty catalog with programs is the one line; with none, `No server is listed.`", () => {
    assert.equal(searchTools([], undefined, { programs: [cityCount, program("b", "")] }), "library: 2 programs");
    assert.equal(searchTools([], "", { programs: [cityCount] }), "library: 1 programs");
    assert.equal(searchTools([], undefined), "No server is listed.");
  });

  test("no words: the count is in digits and the limit does not hide the line", () => {
    const many = Array.from({ length: 12 }, (_, i) => program(`p${i}`, ""));
    assert.equal(searchTools([], undefined, { programs: many }), "library: 12 programs");
    assert.equal(searchTools([practice], undefined, { programs: many, limit: 1 }), "practice: 3 tools\nlibrary: 12 programs");
  });

  test("the example of the meeting point: the program first, then the tools that match", () => {
    const got = searchTools([practice], "rows", { programs: [cityCount] });
    assert.equal(got, [CITY_LINE, ROWS, COUNT].join("\n"));
  });

  test("a program's score: 2 for a word in `lib.<name>`, 1 in about or in a param, else 0", () => {
    const byName = program("alphaTool", "Does a thing.");
    const byAbout = program("second", "Has alpha inside.");
    const byParam = program("third", "Nothing.", ["x", "alpha"]);
    const none = program("fourth", "Nothing.", ["x"]);
    assert.equal(
      searchTools([], "alpha", { programs: [none, byParam, byAbout, byName] }),
      [programLine(byName), programLine(byParam), programLine(byAbout)].join("\n"),
    );
  });

  test("equal scores keep the order of programs", () => {
    const p1 = program("one", "has fig");
    const p2 = program("two", "has fig");
    const p3 = program("three", "has fig");
    assert.equal(searchTools([], "fig", { programs: [p3, p1, p2] }), [programLine(p3), programLine(p1), programLine(p2)].join("\n"));
  });

  test("the word is found in the text `lib.<name>`, anywhere, the case not counting", () => {
    const p = program("cityCount", "Nothing.");
    assert.equal(searchTools([], "lib.city", { programs: [p] }), "lib.cityCount() - Nothing.");
    assert.equal(searchTools([], "ycount", { programs: [p] }), "lib.cityCount() - Nothing.");
    assert.equal(searchTools([], "CITYCOUNT", { programs: [p] }), "lib.cityCount() - Nothing.");
    assert.equal(searchTools([], "b.c", { programs: [p] }), "lib.cityCount() - Nothing.");
    assert.equal(searchTools([], "LIB", { programs: [p] }), "lib.cityCount() - Nothing.");
  });

  test("the word `lib` is found in every program's text and in no tool that does not hold it", () => {
    const p1 = program("a", "A.");
    const p2 = program("b", "B.");
    assert.equal(searchTools([practice], "lib", { programs: [p1, p2] }), [programLine(p1), programLine(p2)].join("\n"));
  });

  test("the case of about and of params does not count", () => {
    const p = program("zed", "Counts ROWS here.", ["CityName"]);
    assert.equal(searchTools([], "rows", { programs: [p] }), programLine(p));
    assert.equal(searchTools([], "cityname", { programs: [p] }), programLine(p));
    assert.equal(searchTools([], "CITYNAME", { programs: [p] }), programLine(p));
  });

  test("words: the score is the sum over the words, and the same word twice counts twice", () => {
    const p1 = program("first", "has red");
    const p2 = program("second", "has red and blue");
    const p3 = program("blue_one", "plain");
    // red blue: p1 1, p2 2, p3 2
    assert.equal(searchTools([], "red blue", { programs: [p1, p2, p3] }), [programLine(p2), programLine(p3), programLine(p1)].join("\n"));
    // red red blue: p1 2, p2 3, p3 2
    assert.equal(searchTools([], "red red blue", { programs: [p1, p2, p3] }), [programLine(p2), programLine(p1), programLine(p3)].join("\n"));
    assert.equal(searchTools([], "  red \t\n  blue  ", { programs: [p1, p2, p3] }), searchTools([], "red blue", { programs: [p1, p2, p3] }));
  });

  test("programs come before tools, whatever the score of the tools", () => {
    const weak = program("weak", "mentions rows once");
    const got = searchTools([practice], "rows rows", { programs: [weak] });
    assert.equal(got, [programLine(weak), ROWS, COUNT].join("\n"));
  });

  test("the lines of the tools are as before when the programs match nothing", () => {
    const before = searchTools([practice], "wipe");
    assert.equal(searchTools([practice], "wipe", { programs: [cityCount] }), before);
  });

  test("when no program and no tool matches: `No tool matches.`", () => {
    assert.equal(searchTools([practice], "zzzz", { programs: [cityCount] }), "No tool matches.");
    assert.equal(searchTools([], "zzzz", { programs: [cityCount] }), "No tool matches.");
  });

  test("an entry with an error matches nothing, programs or not", () => {
    const catalog = [{ server: "deadserver", tools: [], error: "timeout" }];
    assert.equal(searchTools(catalog, "deadserver", { programs: [cityCount] }), "No tool matches.");
    assert.equal(searchTools(catalog, "city", { programs: [cityCount] }), CITY_LINE);
  });

  test("limit: at most that many lines, the programs take their places first", () => {
    const p1 = program("hit_one", "");
    const p2 = program("hit_two", "");
    const tools = { server: "s", tools: [tool("hit_a"), tool("hit_b"), tool("hit_c")] };
    const L = [programLine(p1), programLine(p2), "s.hit_a()", "s.hit_b()", "s.hit_c()"];
    assert.equal(searchTools([tools], "hit", { programs: [p1, p2], limit: 3 }), [...L.slice(0, 3), "(2 more match: add a word)"].join("\n"));
    assert.equal(searchTools([tools], "hit", { programs: [p1, p2], limit: 4 }), [...L.slice(0, 4), "(1 more match: add a word)"].join("\n"));
    assert.equal(searchTools([tools], "hit", { programs: [p1, p2], limit: 2 }), [...L.slice(0, 2), "(3 more match: add a word)"].join("\n"));
    assert.equal(searchTools([tools], "hit", { programs: [p1, p2], limit: 1 }), [L[0], "(4 more match: add a word)"].join("\n"));
  });

  test("limit: exactly limit matches are all shown, and the default is 10", () => {
    const p1 = program("hit_one", "");
    const p2 = program("hit_two", "");
    const tools = { server: "s", tools: [tool("hit_a"), tool("hit_b")] };
    assert.equal(
      searchTools([tools], "hit", { programs: [p1, p2], limit: 4 }),
      [programLine(p1), programLine(p2), "s.hit_a()", "s.hit_b()"].join("\n"),
    );
    const manyPrograms = Array.from({ length: 8 }, (_, i) => program(`hit${i}`, ""));
    const manyTools = { server: "s", tools: [tool("hit_a"), tool("hit_b"), tool("hit_c"), tool("hit_d")] };
    const got = searchTools([manyTools], "hit", { programs: manyPrograms });
    assert.equal(got, [...manyPrograms.map(programLine), "s.hit_a()", "s.hit_b()", "(2 more match: add a word)"].join("\n"));
  });

  test("limit: more programs match than are shown", () => {
    const list = Array.from({ length: 5 }, (_, i) => program(`hit${i}`, ""));
    const got = searchTools([practice], "hit", { programs: list, limit: 2 });
    assert.equal(got, [programLine(list[0]), programLine(list[1]), "(3 more match: add a word)"].join("\n"));
  });

  test("it does not change its arguments and prints nothing", () => {
    const catalog = deepFreeze([practice]);
    const programs = deepFreeze([cityCount, program("zzz", "rows")]);
    const printed = printedBy(() => {
      searchTools(catalog, undefined, { programs });
      searchTools(catalog, "rows", { programs, limit: 1 });
      searchTools(catalog, "none", { programs });
    });
    assert.deepEqual(printed, []);
  });
});

// -- formatTrail and its notes ---------------------------------------------------------------------------------

describe("step 7: formatTrail and its notes", () => {
  const call = (id, ms, size, outcome = "ok") => ({ id, ms, size, outcome });
  const SAVE = "(this sequence of calls has run 3 times: save it as a program with library.save)";
  const ARCHIVED = "(lib.broken failed 5 times in a row: it was moved to the archive)";

  test("notes absent, undefined or empty: as before to the character", () => {
    const calls = [call("practice.rows", 12, 208355), call("shell.read", 0, 0, "refused")];
    const before = formatTrail(calls);
    assert.equal(before, "--- calls ---\npractice.rows 12 ms 208355 chars\nshell.read 0 ms refused");
    assert.equal(formatTrail(calls, { notes: [] }), before);
    assert.equal(formatTrail(calls, { notes: undefined }), before);
    assert.equal(formatTrail(calls, {}), before);
    assert.equal(formatTrail([], { notes: [] }), "");
    assert.equal(formatTrail([], { notes: undefined }), "");
    assert.equal(formatTrail([], { limit: 3 }), "");
  });

  test("the example: one call and one note", () => {
    assert.equal(formatTrail([call("practice.count", 3, 13)], { notes: [SAVE] }), ["--- calls ---", "practice.count 3 ms 13 chars", SAVE].join("\n"));
  });

  test("the example: no call and one note gives the heading and the note", () => {
    assert.equal(formatTrail([], { notes: [ARCHIVED] }), ["--- calls ---", ARCHIVED].join("\n"));
  });

  test("notes are shown in their order, each as it is, no line break at the end", () => {
    const got = formatTrail([call("a.b", 1, 2)], { notes: [ARCHIVED, SAVE, "any (text)  with  spaces "] });
    assert.equal(got, ["--- calls ---", "a.b 1 ms 2 chars", ARCHIVED, SAVE, "any (text)  with  spaces "].join("\n"));
    assert.ok(!got.endsWith("\n"));
  });

  test("limit counts calls only: the line `(<n> more not shown)` comes before the notes, every note is shown", () => {
    const calls = [call("a.a", 1, 1), call("a.b", 2, 2), call("a.c", 3, 3), call("a.d", 4, 4)];
    const notes = ["n1", "n2", "n3"];
    assert.equal(
      formatTrail(calls, { limit: 2, notes }),
      ["--- calls ---", "a.a 1 ms 1 chars", "a.b 2 ms 2 chars", "(2 more not shown)", "n1", "n2", "n3"].join("\n"),
    );
    assert.equal(
      formatTrail(calls.slice(0, 2), { limit: 2, notes }),
      ["--- calls ---", "a.a 1 ms 1 chars", "a.b 2 ms 2 chars", "n1", "n2", "n3"].join("\n"),
    );
    assert.equal(
      formatTrail(calls, { limit: 1, notes: ["only"] }),
      ["--- calls ---", "a.a 1 ms 1 chars", "(3 more not shown)", "only"].join("\n"),
    );
  });

  test("the outcomes other than ok keep their lines beside the notes", () => {
    assert.equal(formatTrail([call("a.b", 5, 9, "failed")], { notes: ["n"] }), "--- calls ---\na.b 5 ms failed\nn");
  });

  test("the notes made by the three functions of the library fit", () => {
    const got = formatTrail([call("practice.count", 3, 13)], { notes: [saveItNote(3), sameAsNote("x"), archivedNote("broken", 5)] });
    assert.equal(got, ["--- calls ---", "practice.count 3 ms 13 chars", SAVE, "(lib.x does this: call it)", ARCHIVED].join("\n"));
  });

  test("withTrail keeps the notes whole, like the rest of the trail", () => {
    const trail = formatTrail([call("a.b", 1, 2)], { notes: [SAVE] });
    assert.ok(trail.includes(SAVE));
    const answer = "x".repeat(500);
    const limit = 300;
    const whole = `${answer}\n${trail}`;
    const notice = `\n[cut: the answer was ${whole.length} characters, the limit is ${limit}]`;
    const room = limit - notice.length - 1 - trail.length;
    assert.ok(room >= 0);
    const got = withTrail(answer, trail, limit);
    assert.equal(got, `${answer.slice(0, room)}${notice}\n${trail}`);
    assert.equal(got.length, limit);
    assert.ok(got.endsWith(SAVE));
    assert.equal(withTrail("short", trail, 8000), `short\n${trail}`);
  });

  test("it does not change its arguments and prints nothing", () => {
    const calls = deepFreeze([call("a.b", 1, 2), call("a.c", 2, 3)]);
    const notes = deepFreeze(["n1", "n2"]);
    const printed = printedBy(() => {
      formatTrail(calls, { limit: 1, notes });
      formatTrail([], { notes });
    });
    assert.deepEqual(printed, []);
  });
});
