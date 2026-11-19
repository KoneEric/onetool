// Step 7: the library (the meeting point of server, "Step 7: the library"): the words, the description of `run`, `search`, and what a
// program finds of the library. Every test starts the command with HOME a folder it made (the rule "Step 7: what every
// test of this part sets"), and every settings file says "trail" and "log". The saved programs are written by hand, as a
// person would, in the folders the test made.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { sleep, textOf, waitFor, withoutSession } from "./helpers.js";
import { withHost } from "./askhost.js";
import { jobsOf, viaCtx } from "./jobhelpers.js";
import { logEntries } from "./recordhelpers.js";
import {
  COUNT,
  EMPTY_LIBRARY_TEXT,
  inLib,
  libSettings,
  libraryText,
  names,
  okLine,
  projectSettings,
  putProgram,
  putRaw,
  putStats,
  wordLine,
  world,
} from "./libhelpers.js";
import { ran } from "./shellhelpers.js";

const CITY_COUNT = { about: "Counts the rows of one city.", params: ["city"], code: COUNT };

const descriptionOf = async (ctx) => (await ctx.client.listTools()).tools.find((tool) => tool.name === "run").description;
const searched = async (ctx, words) => textOf(await ctx.call("search", words === undefined ? {} : { words }));

/** The description texts of the two tools together, as "The two tools" counts them. */
async function allTexts(ctx) {
  const { tools } = await ctx.client.listTools();
  const [run, search] = tools;
  return [
    run.description,
    ...Object.values(run.inputSchema.properties).map((one) => one.description),
    search.description,
    search.inputSchema.properties.words.description,
  ];
}
const total = (texts) => texts.join("").length;

describe("the words: the start looks at no folder and makes none", () => {
  test("tools/list, search and programs that use no library leave the home and the project as they were", async () => {
    const w = world();
    await inLib(w, projectSettings(w), async (ctx) => {
      assert.ok((await descriptionOf(ctx)).includes(EMPTY_LIBRARY_TEXT), "the library is read, and there is none");
      await searched(ctx);
      await searched(ctx, "rows");
      assert.deepEqual(await ran(ctx, "1 + 1"), { text: "2", isError: false });
      const counted = await ran(ctx, "(await tools.practice.count({})).count");
      assert.equal(counted.isError, false);
      assert.equal(counted.text.split("\n")[0], "5000");
      assert.deepEqual(names(w.H), [], "the home is as it was");
      assert.deepEqual(names(w.W), [], "the project is as it was");
    });
  });

  test("the user's folder is HOME/.onetool/library, read anew each time: a file made, changed or deleted by hand is followed", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      assert.equal((await ran(ctx, "typeof lib.a")).text, "undefined");
      assert.ok((await descriptionOf(ctx)).endsWith(EMPTY_LIBRARY_TEXT));
      putProgram(w.UL, "a", { about: "Does a.", code: "1 + 1" });
      assert.ok((await descriptionOf(ctx)).endsWith(libraryText([{ name: "a", uses: 0 }])), "tools/list reads the folder when it is answered");
      assert.equal(withoutSession(await searched(ctx)), "practice: 5 tools\nlibrary: 1 programs");
      assert.deepEqual(await ran(ctx, "await lib.a()"), { text: "2", isError: false });
      putProgram(w.UL, "a", { about: "Does a, again.", code: "1 + 2" });
      assert.equal(await searched(ctx, "again"), "lib.a() - Does a, again.");
      assert.deepEqual(await ran(ctx, "await lib.a()"), { text: "3", isError: false });
      rmSync(join(w.UL, "a.js"));
      assert.ok((await descriptionOf(ctx)).endsWith(EMPTY_LIBRARY_TEXT));
      assert.equal(withoutSession(await searched(ctx)), "practice: 5 tools");
      assert.equal((await ran(ctx, "typeof lib.a")).text, "undefined");
    });
  });

  test("the project's folder is FIRST-FOLDER/.onetool/library: both are read, the project's wins on a same name and is counted once", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "The user's count.", params: ["city"], code: '"user"' });
    putProgram(w.UL, "onlyUser", { about: "Only in the user's.", code: '"u"' });
    putProgram(w.PL, "cityCount", { about: "The project's own count.", params: ["city"], code: '"project"' });
    putProgram(w.PL, "onlyProject", { about: "Only in the project's.", code: '"p"' });
    await inLib(w, projectSettings(w), async (ctx) => {
      assert.equal(await searched(ctx), "practice: 5 tools\nshell: 4 tools\nlibrary: 3 programs");
      assert.equal((await searched(ctx, "city")).split("\n")[0], "lib.cityCount({ city }) - The project's own count.");
      assert.deepEqual(await ran(ctx, 'await lib.cityCount({ city: "Lyon" })'), { text: "project", isError: false });
      assert.deepEqual(await ran(ctx, "await lib.onlyUser()"), { text: "u", isError: false });
      assert.deepEqual(await ran(ctx, "await lib.onlyProject()"), { text: "p", isError: false });
      const description = await descriptionOf(ctx);
      assert.ok(description.includes(libraryText(["cityCount", "onlyProject", "onlyUser"].map((name) => ({ name, uses: 0 })))));
    });
  });

  test("with no folder of the shell only the user's library is read, and the project's folder of another place is not", async () => {
    const w = world();
    putProgram(w.PL, "inProject", { about: "In the project.", code: "1" });
    putProgram(w.UL, "inUser", { about: "In the user's.", code: "2" });
    await inLib(w, libSettings(), async (ctx) => {
      assert.equal(await searched(ctx), "practice: 5 tools\nlibrary: 1 programs");
      assert.equal((await ran(ctx, "[typeof lib.inProject, typeof lib.inUser].join()")).text, "undefined,function");
    });
  });
});

describe("a file that is not a program", () => {
  const told = (ctx) => ctx.stderrLines().filter((one) => one.startsWith("onetool: library:"));
  const line = (path) => `onetool: library: ${path} is not a saved program, it is left out`;

  test("it is left out and said once per path on standard error, for the life of the process", async () => {
    const w = world();
    putProgram(w.UL, "good", { about: "Good.", code: "1" });
    putRaw(w.UL, "notes.js", "not a program");
    await inLib(w, libSettings(), async (ctx) => {
      await ctx.client.listTools();
      assert.equal(await searched(ctx), "practice: 5 tools\nlibrary: 1 programs");
      await searched(ctx);
      await ran(ctx, "await lib.good()");
      await waitFor(() => told(ctx).length >= 1, 3000, "the line about notes.js");
      await sleep(150);
      assert.deepEqual(told(ctx), [line(join(w.UL, "notes.js"))]);
      // a second path is told by itself, once; the first is not told again, not even when its file is made anew
      putRaw(w.UL, "odd.js", "// about:\n");
      rmSync(join(w.UL, "notes.js"));
      putRaw(w.UL, "notes.js", "still not a program");
      await searched(ctx);
      await searched(ctx);
      await waitFor(() => told(ctx).length >= 2, 3000, "the line about odd.js");
      await sleep(150);
      assert.deepEqual(told(ctx), [line(join(w.UL, "notes.js")), line(join(w.UL, "odd.js"))]);
    });
  });

  test("the project's bad file is told with its own path", async () => {
    const w = world();
    putRaw(w.PL, "broken.js", "x");
    await inLib(w, projectSettings(w), async (ctx) => {
      await searched(ctx);
      await waitFor(() => told(ctx).length >= 1, 3000, "the line about broken.js");
      await sleep(150);
      assert.deepEqual(told(ctx), [line(join(w.PL, "broken.js"))]);
    });
  });

  test("a call of run refused for its arguments reads no library: no line is told until a program starts", async () => {
    const w = world();
    putRaw(w.UL, "notes.js", "not a program");
    await inLib(w, libSettings(), async (ctx) => {
      for (const args of [{}, { code: 5 }, { code: "1", background: "yes" }]) {
        const refused = await ctx.call("run", args);
        assert.equal(refused.isError, true, JSON.stringify(args));
      }
      await sleep(300);
      assert.deepEqual(told(ctx), [], "nothing was read");
      assert.equal((await ran(ctx, "1")).text, "1");
      await waitFor(() => told(ctx).length >= 1, 3000, "the line, once a program starts");
      assert.deepEqual(told(ctx), [line(join(w.UL, "notes.js"))]);
    });
  });
});

describe("the description of `run`", () => {
  test("the shell off: the fixed text of before, one space, the library text; the schemas are what they were", async () => {
    const w = world();
    await inLib(w, libSettings(), async (ctx) => {
      const { tools } = await ctx.client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
      assert.deepEqual(Object.keys(tools[0].inputSchema.properties), ["code", "background", "job", "stop", "jobs"]);
      assert.equal(Object.hasOwn(tools[0].inputSchema, "required"), false);
      assert.deepEqual(Object.keys(tools[1].inputSchema.properties), ["words"]);
      const { description } = tools[0];
      assert.ok(description.endsWith(` ${EMPTY_LIBRARY_TEXT}`), description);
      const fixed = description.slice(0, description.length - EMPTY_LIBRARY_TEXT.length - 1);
      assert.ok(!fixed.includes("Saved programs"), "the fixed text holds no library text");
      assert.ok(description.includes("Saved programs: 0") && description.includes("library.save("));
      for (const needle of ["$`", "read(", "write(", "edit("]) assert.ok(!description.includes(needle), needle);
    });
  });

  test("what the older steps say it holds is still there: the texts were shortened, not emptied", async () => {
    const w = world();
    await inLib(w, projectSettings(w), async (ctx) => {
      const description = await descriptionOf(ctx);
      const needles = [
        "tools.<server>.<tool>(", "await", "console.log", "search", "`state`", "background: true", "job", "progress(",
        "$`command`", ".text()", ".nothrow()", "read(path)", "write(path, text)", "edit(path, old, new)",
      ];
      for (const needle of needles) assert.ok(description.includes(needle), `the description of run holds ${needle}`);
      // assumed: "says that the answer is the value of the last expression" is read as the words "last expression"
      assert.match(description, /last expression/i);
    });
  });

  test("the shell having folders: the description of the shell off, one space, the fixed text of step 4 after the library text", async () => {
    const w = world();
    putProgram(w.UL, "a", { about: "Does a.", code: "1" });
    let off;
    await inLib(w, libSettings(), async (ctx) => {
      off = await descriptionOf(ctx);
    });
    await inLib(w, projectSettings(w), async (ctx) => {
      const on = await descriptionOf(ctx);
      assert.ok(on.startsWith(`${off} `), "the description of the shell off, one space");
      const added = on.slice(off.length);
      assert.ok(added.length < 300, `the space and the text of step 4 are ${added.length} characters`);
      assert.ok(added.includes("$`command`") && !added.includes("Saved programs"));
      assert.ok(on.includes("Saved programs: 1"), "the library text is in it");
      assert.ok(on.indexOf("Saved programs") < on.indexOf("$`command`"));
    });
  });

  test("the library text names the most used, from stats.json, in the order of core's rule", async () => {
    const w = world();
    const programs = ["b", "a", "c"].map((name) => ({ name, uses: { a: 4, b: 4, c: 9 }[name] }));
    for (const { name, uses } of programs) putProgram(w.UL, name, { about: `Is ${name}.`, code: "1" });
    putStats(w.UL, Object.fromEntries(programs.map(({ name, uses }) => [name, { uses, lastUse: null, failures: 0 }])));
    await inLib(w, libSettings(), async (ctx) => {
      const description = await descriptionOf(ctx);
      assert.ok(description.endsWith(libraryText(programs)));
      assert.ok(description.includes("Saved programs: 3 (most used: c, a, b). Call one as"), "9 uses first, then the 4 by name");
    });
  });

  test("no notification is sent when the library changes: the description of the moment is asked for", async () => {
    const w = world();
    await withHost(libSettings(), { capabilities: {}, env: { HOME: w.H } }, async (host) => {
      assert.ok((await host.description()).endsWith(EMPTY_LIBRARY_TEXT));
      putProgram(w.UL, "a", { about: "Does a.", code: "1" });
      assert.ok((await host.description()).endsWith(libraryText([{ name: "a", uses: 0 }])));
      assert.equal((await host.run('await library.save("b", { about: "Does b.", code: "2" })')).isError, false);
      await sleep(200);
      assert.equal(host.listChanged, 0, "no notifications/tools/list_changed");
      assert.equal(host.initializeResult.capabilities.tools.listChanged, undefined);
      assert.ok((await host.description()).includes("Saved programs: 2"));
    });
  });

  test("the library text is under 300 characters with its space, and all the description texts are under 1,500, whatever the library holds", async () => {
    const w = world();
    // 30 programs whose names are 40 characters long, the most used last in the alphabet
    const programs = Array.from({ length: 30 }, (_, i) => ({ name: `prog${String(i).padStart(2, "0")}${"A".repeat(34)}`, uses: i }));
    for (const { name } of programs) {
      assert.equal(name.length, 40);
      putProgram(w.UL, name, { about: "One.", code: "1" });
    }
    putStats(w.UL, Object.fromEntries(programs.map(({ name, uses }) => [name, { uses, lastUse: null, failures: 0 }])));
    const expected = libraryText(programs);
    assert.ok(expected.length <= 298);
    for (const settings of [libSettings(), projectSettings(w)]) {
      await inLib(w, settings, async (ctx) => {
        const texts = await allTexts(ctx);
        assert.ok(texts[0].includes(expected), "the library text is the one core makes, names cut at its limit");
        const from = texts[0].indexOf("Saved programs: 30");
        const libraryPart = texts[0].slice(from, from + expected.length);
        assert.equal(libraryPart, expected);
        assert.ok(` ${expected}`.length < 300);
        assert.ok(total(texts) < 1500, `the descriptions are ${total(texts)} characters`);
      });
    }
  });

  test("the texts that are fixed (the two tools', the six properties', the text of step 4) are together under 1,200 characters", async () => {
    const w = world();
    await inLib(w, projectSettings(w), async (ctx) => {
      const texts = await allTexts(ctx);
      // the description holds: the fixed text, a space, the library text of an empty library, a space, the text of step 4
      const fixed = total(texts) - EMPTY_LIBRARY_TEXT.length - 2;
      assert.ok(fixed < 1200, `the fixed texts are ${fixed} characters`);
      assert.ok(total(texts) < 1500);
    });
  });
});

describe("`search`", () => {
  const SET = [
    ["alpha", { about: "Sums the zebra rows.", code: "1" }],
    ["middle", { about: "Nothing.", params: ["zebra"], code: "2" }],
    ["zebraSum", { about: "Sums them up.", code: "3" }],
  ];

  test("with no words the answer ends with `library: <n> programs` after the line of the shell; none saved, no such line", async () => {
    const w = world();
    await inLib(w, projectSettings(w), async (ctx) => {
      assert.equal(await searched(ctx), "practice: 5 tools\nshell: 4 tools");
      putProgram(w.UL, "one", { about: "One.", code: "1" });
      assert.equal(await searched(ctx), "practice: 5 tools\nshell: 4 tools\nlibrary: 1 programs");
      for (const [name, program] of SET) putProgram(w.PL, name, program);
      assert.equal(await searched(ctx), "practice: 5 tools\nshell: 4 tools\nlibrary: 4 programs");
    });
  });

  test("with words the matching programs come first: the word in `lib.<name>` scores 2, in the sentence or an argument 1, ties in the library's order", async () => {
    const w = world();
    for (const [name, program] of SET) putProgram(w.UL, name, program);
    await inLib(w, libSettings(), async (ctx) => {
      assert.equal(
        await searched(ctx, "zebra"),
        ["lib.zebraSum() - Sums them up.", "lib.alpha() - Sums the zebra rows.", "lib.middle({ zebra }) - Nothing."].join("\n"),
      );
      // zebraSum: 2 (zebra in its name) + 0; middle: 1 (zebra in its params) + 1 (nothing in its sentence); alpha: 1 + 0.
      // zebraSum and middle tie at 2: the library's order (by name) puts middle first.
      // the full description of practice.wipe ("... It deletes nothing.") matches `nothing` too: score 1, after the programs.
      assert.equal(
        await searched(ctx, "ZEBRA nothing"),
        ["lib.middle({ zebra }) - Nothing.", "lib.zebraSum() - Sums them up.", "lib.alpha() - Sums the zebra rows.", "practice.wipe() - Pretends to delete the practice table."].join("\n"),
      );
      assert.equal(await searched(ctx, "qqqq"), "No tool matches.");
    });
  });

  test("the programs come before the lines of the tools, and the catalog is not changed", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings(), async (ctx) => {
      const lines = (await searched(ctx, "rows")).split("\n");
      assert.equal(lines[0], "lib.cityCount({ city }) - Counts the rows of one city.");
      assert.ok(lines.slice(1).every((one) => one.startsWith("practice.")), "then the tools");
      assert.ok(lines.includes("practice.rows(city?: string) - Returns the practice table: 5,000 rows of id, name, city and amount."));
      assert.equal(await searched(ctx), "practice: 5 tools\nlibrary: 1 programs");
    });
  });

  test("no rule hides a saved program: with every `library.*` denied the programs are still listed", async () => {
    const w = world();
    putProgram(w.UL, "one", { about: "One.", code: "1" });
    await inLib(w, libSettings({ deny: ["library.*", "practice.wipe"] }), async (ctx) => {
      assert.equal(await searched(ctx), "practice: 4 tools\nlibrary: 1 programs");
      assert.equal(await searched(ctx, "one"), "lib.one() - One.");
    });
  });

  test("search and tools/list change no file", async () => {
    const w = world();
    putProgram(w.UL, "one", { about: "One.", code: "1" });
    putRaw(w.UL, "notes.js", "not a program");
    putStats(w.UL, { one: { uses: 2, lastUse: null, failures: 1 } });
    const before = names(w.UL);
    await inLib(w, libSettings(), async (ctx) => {
      assert.ok((await descriptionOf(ctx)).includes("Saved programs: 1"), "the library is read");
      assert.equal(await searched(ctx), "practice: 5 tools\nlibrary: 1 programs");
      await searched(ctx, "one");
      assert.deepEqual(names(w.UL), before);
      assert.deepEqual(names(w.H), [".onetool"]);
      assert.deepEqual(names(join(w.H, ".onetool")), ["library"], "no archive was made either");
    });
  });
});

describe("a program and the library", () => {
  test("`typeof lib` and `typeof library` are `object` in every program, the foreground and a job; `tools` has no key `library`", async () => {
    const w = world();
    const code = '[typeof lib, typeof library, typeof library.save, typeof library.remove, typeof lib.nothing, Object.keys(tools).join(), "library" in tools].join("|")';
    await inLib(w, libSettings(), async (ctx) => {
      assert.deepEqual(await ran(ctx, code), { text: "object|object|function|function|undefined|practice|false", isError: false });
      const jobs = jobsOf(viaCtx(ctx));
      await jobs.start(code);
      const ended = await jobs.untilEnded("j1");
      assert.deepEqual(ended.text.split("\n").slice(1), ["--- answer ---", "object|object|function|function|undefined|practice|false"]);
    });
  });

  test("a saved program is called as `await lib.<name>(args)`; its calls are in the trail of the program that called it", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, 'await lib.cityCount({ city: "Lyon" })');
      assert.equal(answer.isError, false);
      const lines = answer.text.split("\n");
      assert.equal(lines.length, 3, answer.text);
      assert.equal(lines[0], "625");
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], okLine("practice.rows"));
    });
  });

  test("saved programs call each other; each call inside is in the trail and in the log of the program that started them", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", CITY_COUNT);
    putProgram(w.UL, "lyonShare", { about: "The share of Lyon.", code: '(await lib.cityCount({ city: "Lyon" })) / 5000' });
    await inLib(w, libSettings({ log: true, logFolder: w.L }), async (ctx) => {
      const answer = await ran(ctx, "await lib.lyonShare()");
      const lines = answer.text.split("\n");
      assert.equal(lines.length, 3, answer.text);
      assert.equal(lines[0], "0.125");
      assert.match(lines[2], okLine("practice.rows"));
      const entries = logEntries(w.L);
      assert.deepEqual(entries.map((entry) => entry.id), ["practice.rows"], "the call of a saved program is no tool call");
      assert.deepEqual(entries[0].args, {});
      assert.equal(entries[0].decision, "allowed");
    });
  });

  test("the rules, the kept state and the errors are those of the program that calls", async () => {
    const w = world();
    putProgram(w.UL, "nuke", { about: "Wipes.", code: "await tools.practice.wipe({})" });
    putProgram(w.UL, "bump", { about: "Counts in state.", code: "state.n = (state.n ?? 0) + 1;\nstate.n" });
    putProgram(w.UL, "boom", { about: "Throws.", code: 'throw new Error("boom")' });
    await inLib(w, libSettings({ deny: ["practice.wipe"] }), async (ctx) => {
      const denied = await ran(ctx, "await lib.nuke().catch((e) => e.message)");
      assert.equal(denied.isError, false);
      const lines = denied.text.split("\n");
      assert.equal(lines[0], 'onetool: practice.wipe is denied by the rule deny "practice.wipe"');
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], wordLine("practice.wipe", "refused"));
      assert.deepEqual(await ran(ctx, "await lib.bump()"), { text: "1", isError: false });
      assert.deepEqual(await ran(ctx, "await lib.bump()"), { text: "2", isError: false });
      assert.deepEqual(await ran(ctx, "state.n"), { text: "2", isError: false });
      assert.deepEqual(await ran(ctx, "await lib.boom()"), { text: "The program failed: Error: boom", isError: true });
    });
  });

  test("a question asked for a call inside a saved program is the program's question: asked once, the answer decides", async () => {
    const w = world();
    putProgram(w.UL, "nuke", { about: "Wipes.", code: "await tools.practice.wipe({})" });
    let reply = "accept";
    await withHost(libSettings({ ask: ["practice.wipe"], trail: false }), { env: { HOME: w.H }, answer: () => ({ action: reply }) }, async (host) => {
      assert.deepEqual(await host.run("await lib.nuke()"), { text: "wiped", isError: false });
      assert.equal(host.questions.length, 1);
      assert.equal(
        host.questions[0].message,
        'onetool: a program wants to call practice.wipe.\nArguments: {}\nThe rule ask "practice.wipe" asks for your consent. Allow this call?',
      );
      reply = "decline";
      assert.deepEqual(await host.run("await lib.nuke()"), {
        text: 'The program failed: Error: onetool: practice.wipe is refused by the rule ask "practice.wipe": the person said no',
        isError: true,
      });
      assert.equal(host.questions.length, 2);
    });
  });
});
