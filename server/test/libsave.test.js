// Step 7: `callTool("library", tool, args)` (the meeting point of server, "Step 7: the library", "`callTool("library", tool, args)`"):
// the order of its steps, the saves and the removals, the rules, the question, the record and the log. The texts of a
// refused save are those of the meeting point of library, the answers of a save and of a removal those of the meeting point of server. Every test
// starts the command with HOME a folder it made, and the trail is off where the whole answer is compared.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withHost } from "./askhost.js";
import { tmpDir, waitFor } from "./helpers.js";
import { ROOTS, shellOnly, withProgram } from "./stepfive.js";
import { logEntries, logText } from "./recordhelpers.js";
import {
  BAD_ABOUT,
  BAD_CODE,
  BAD_NAME,
  BAD_PARAMS,
  BAD_REMOVE_NAME,
  BAD_REPLACE,
  CANNOT_WRITE,
  CAP,
  COUNT,
  FAILED,
  NOT_SAVED,
  SAME_TOOLS,
  SAVED_ALREADY,
  TWIN,
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
  putRaw,
  putStats,
  removedFrom,
  saveCall,
  savedIn,
  savedReplacing,
  statsOf,
  trailOf,
  wordLine,
  world,
} from "./libhelpers.js";
import { ran } from "./shellhelpers.js";

const NO_TRAIL = (onetool = {}) => libSettings({ trail: false, ...onetool });
const ONE = { about: "One.", code: "1" };
const TWO = { about: "Two.", code: "2" };

describe("a save", () => {
  test("it goes to the user's library when the shell has no folder: the file is the file of the meeting point of library, the answer says where", async () => {
    const w = world();
    const program = { about: "Counts the rows of one city.", params: ["city"], code: COUNT };
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, `await ${saveCall("cityCount", program)}`);
      assert.equal(answer.isError, false, answer.text);
      const lines = answer.text.split("\n");
      assert.equal(lines.length, 3, answer.text);
      assert.equal(lines[0], savedIn("cityCount", "user"));
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], okLine("library.save", String(savedIn("cityCount", "user").length)));
      assert.equal(fileIn(w.UL, "cityCount.js"), programText(program));
      assert.equal(await ran(ctx, "typeof lib.cityCount").then((one) => one.text), "function", "the next program finds it");
    });
  });

  test("a program that saves one does not find it under `lib` in itself, and finds it in the next", async () => {
    const w = world();
    await inLib(w, NO_TRAIL(), async (ctx) => {
      const code = `${saveCall("double", { about: "Doubles.", params: ["n"], code: "n * 2" })};\ntypeof lib.double`;
      assert.deepEqual(await ran(ctx, code), { text: "undefined", isError: false });
      assert.deepEqual(await ran(ctx, "await lib.double({ n: 4 })"), { text: "8", isError: false });
    });
  });

  test("with folders in effect the target is the project's library: the file is there, the home is not touched", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "The user's.", params: ["city"], code: '"user"' });
    await inLib(w, projectSettings(w, { trail: false }), async (ctx) => {
      assert.deepEqual(await ran(ctx, `await ${saveCall("local", { about: "Says where it is.", code: '"here"' })}`), {
        text: savedIn("local", "project"),
        isError: false,
      });
      assert.equal(fileIn(w.PL, "local.js"), programText({ about: "Says where it is.", code: '"here"' }));
      assert.equal(existsSync(join(w.UL, "local.js")), false);
      // the decision looks at the target library only: a name the user's library has is free in the project's
      assert.deepEqual(await ran(ctx, `await ${saveCall("cityCount", { about: "The project's.", code: '"project"' })}`), {
        text: savedIn("cityCount", "project"),
        isError: false,
      });
      assert.deepEqual(await ran(ctx, 'await lib.cityCount({ city: "Lyon" })'), { text: "project", isError: false });
    });
  });

  test("a same name needs replace: true, and the old file goes to the archive with its date", async () => {
    const w = world();
    await inLib(w, NO_TRAIL(), async (ctx) => {
      assert.equal((await ran(ctx, `await ${saveCall("a", ONE)}`)).text, savedIn("a", "user"));
      const refused = await ran(ctx, `await ${saveCall("a", TWO)}`);
      assert.deepEqual(refused, { text: FAILED(SAVED_ALREADY("a")), isError: true });
      assert.equal(fileIn(w.UL, "a.js"), programText(ONE), "the file is what it was");
      assert.deepEqual(await ran(ctx, `await ${saveCall("a", { ...TWO, replace: true })}`), {
        text: savedReplacing("a", "user", "a"),
        isError: false,
      });
      assert.equal(fileIn(w.UL, "a.js"), programText(TWO));
      const archived = archivedOf(w.UA, "a");
      assert.equal(archived.length, 1, names(w.UA).join());
      assert.equal(fileIn(w.UA, archived[0]), programText(ONE));
    });
  });

  test("the same tools in the same order as a saved program: refused, or put in its place with replace: true", async () => {
    const w = world();
    const rowsOf = { about: "The rows of one city.", params: ["city"], code: "(await tools.practice.rows({ city })).rows" };
    putProgram(w.UL, "cityCount", { about: "Counts the rows of one city.", params: ["city"], code: COUNT });
    putStats(w.UL, { cityCount: { uses: 3, lastUse: null, failures: 0 } });
    await inLib(w, NO_TRAIL(), async (ctx) => {
      assert.deepEqual(await ran(ctx, `await ${saveCall("rowsOf", rowsOf)}`), { text: FAILED(SAME_TOOLS("cityCount")), isError: true });
      assert.equal(existsSync(join(w.UL, "rowsOf.js")), false);
      assert.deepEqual(await ran(ctx, `await ${saveCall("rowsOf", { ...rowsOf, replace: true })}`), {
        text: savedReplacing("rowsOf", "user", "cityCount"),
        isError: false,
      });
      assert.equal(existsSync(join(w.UL, "cityCount.js")), false, "the program put in its place is gone");
      assert.equal(fileIn(w.UL, "rowsOf.js"), programText(rowsOf));
      assert.equal(archivedOf(w.UA, "cityCount").length, 1);
      assert.equal(statsOf(w.UL)?.cityCount, undefined, "its entry of stats.json went with it");
    });
  });

  test("a name that differs only by case from a saved program is refused, with or without replace", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", ONE);
    await inLib(w, NO_TRAIL(), async (ctx) => {
      for (const replace of [undefined, true]) {
        const answer = await ran(ctx, `await ${saveCall("citycount", { ...TWO, replace })}`);
        assert.deepEqual(answer, { text: FAILED(TWIN("citycount", "cityCount")), isError: true });
      }
      assert.equal(fileIn(w.UL, "cityCount.js"), programText(ONE), "the saved program is what it was");
    });
  });

  test("the cap: `libraryCap` programs are held, the three least used are named; the cap is the target library's own", async () => {
    const w = world();
    const uses = { alpha: 5, beta: 1, gamma: 3, delta: 9 };
    for (const name of Object.keys(uses)) putProgram(w.UL, name, ONE);
    putStats(w.UL, Object.fromEntries(Object.entries(uses).map(([name, n]) => [name, { uses: n, lastUse: null, failures: 0 }])));
    await inLib(w, NO_TRAIL({ libraryCap: 4 }), async (ctx) => {
      assert.deepEqual(await ran(ctx, `await ${saveCall("fifth", TWO)}`), { text: FAILED(CAP(4, 4, "beta, gamma, alpha")), isError: true });
      assert.equal(existsSync(join(w.UL, "fifth.js")), false);
      // replace: true on a name that is saved is not a growth of the library
      assert.deepEqual(await ran(ctx, `await ${saveCall("beta", { ...TWO, replace: true })}`), {
        text: savedReplacing("beta", "user", "beta"),
        isError: false,
      });
    });
    await inLib(w, projectSettings(w, { trail: false, libraryCap: 4 }), async (ctx) => {
      assert.equal((await ran(ctx, `await ${saveCall("fifth", TWO)}`)).text, savedIn("fifth", "project"), "the project's library holds none");
    });
  });

  test("the library of the target only is counted: with a cap of 1, one program in each library, the second save in the project's is refused", async () => {
    const w = world();
    putProgram(w.UL, "a", ONE);
    await inLib(w, projectSettings(w, { trail: false, libraryCap: 1 }), async (ctx) => {
      assert.equal((await ran(ctx, `await ${saveCall("x", ONE)}`)).text, savedIn("x", "project"));
      assert.deepEqual(await ran(ctx, `await ${saveCall("y", TWO)}`), { text: FAILED(CAP(1, 1, "x")), isError: true });
    });
  });

  test("the arguments are checked by checkSave: each fault gives its own text, and nothing is written", async () => {
    const w = world();
    const cases = [
      ['library.save("bad name", { about: "A.", code: "1" })', BAD_NAME],
      [`library.save("${"a".repeat(41)}", { about: "A.", code: "1" })`, BAD_NAME],
      ['library.save(5, { about: "A.", code: "1" })', BAD_NAME],
      ['library.save("bad name", {})', BAD_NAME],
      ['library.save("ok", { code: "1" })', BAD_ABOUT],
      ['library.save("ok", { about: "a\\nb", code: "1" })', BAD_ABOUT],
      ['library.save("ok", { about: "   ", code: "1" })', BAD_ABOUT],
      [`library.save("ok", { about: "${"a".repeat(201)}", code: "1" })`, BAD_ABOUT],
      ['library.save("ok")', BAD_ABOUT],
      ['library.save("ok", null)', BAD_ABOUT],
      ['library.save("ok", { about: "A.", params: ["a", "a"], code: "1" })', BAD_PARAMS],
      ['library.save("ok", { about: "A.", params: "city", code: "1" })', BAD_PARAMS],
      ['library.save("ok", { about: "A.", params: ["1a"], code: "1" })', BAD_PARAMS],
      ['library.save("ok", { about: "A.", params: null, code: "1" })', BAD_PARAMS],
      ['library.save("ok", { about: "A.", code: "  \\n" })', BAD_CODE],
      ['library.save("ok", { about: "A." })', BAD_CODE],
      ['library.save("ok", { about: "A.", code: "x".repeat(100001) })', BAD_CODE],
      ['library.save("ok", { about: "A.", code: "1", replace: "yes" })', BAD_REPLACE],
      ['library.save("ok", { about: "A.", code: "1", replace: null })', BAD_REPLACE],
    ];
    await inLib(w, NO_TRAIL(), async (ctx) => {
      for (const [call, message] of cases) {
        assert.deepEqual(await ran(ctx, messageOf(call)), { text: message, isError: false }, call);
      }
      // uncaught, the answer is the failure of the program
      assert.deepEqual(await ran(ctx, 'await library.save("bad name", { about: "A.", code: "1" })'), { text: FAILED(BAD_NAME), isError: true });
      assert.deepEqual(names(w.H), [], "nothing was written, no folder was made");
    });
  });

  test("a limit that is exactly met is taken: 200 characters of about, 20 names, a name of 40 characters", async () => {
    const w = world();
    const params = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const name = "N".repeat(40);
    await inLib(w, NO_TRAIL(), async (ctx) => {
      const call = `library.save("${name}", { about: "${"a".repeat(200)}", params: ${JSON.stringify(params)}, code: "1" })`;
      assert.deepEqual(await ran(ctx, `await ${call}`), { text: savedIn(name, "user"), isError: false });
    });
  });

  test("a library that cannot be written: the program gets `library.save failed: the library cannot be written`", async () => {
    const w = world();
    putRaw(w.H, ".onetool", "this is a file, so no folder can be made in it");
    await inLib(w, libSettings(), async (ctx) => {
      const answer = await ran(ctx, `await ${saveCall("a", ONE)}`);
      assert.equal(answer.isError, true);
      const lines = answer.text.split("\n");
      assert.equal(lines[0], FAILED(CANNOT_WRITE));
      assert.match(lines.at(-1), wordLine("library.save", "failed"));
      assert.equal(answer.text.includes(w.H), false, "no path");
    });
  });
});

describe("the project's library follows the folders in effect at the moment", () => {
  test("the first root of the host is the project; when the roots change the next save goes to the new first folder, and with none to the user's", async () => {
    const w = world();
    const second = tmpDir();
    const settings = shellOnly({ onetool: { hostRules: false, timeoutSeconds: 10 } });
    await withProgram(settings, { home: w.H, capabilities: ROOTS, roots: [w.W] }, async (host) => {
      assert.deepEqual(await host.run(`await ${saveCall("a", ONE)}`), { text: savedIn("a", "project"), isError: false });
      assert.equal(fileIn(w.PL, "a.js"), programText(ONE));
      host.setRoots([second]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      assert.deepEqual(await host.run(`await ${saveCall("b", TWO)}`), { text: savedIn("b", "project"), isError: false });
      assert.equal(fileIn(join(second, ".onetool", "library"), "b.js"), programText(TWO));
      assert.equal(existsSync(join(w.PL, "b.js")), false);
      assert.equal((await host.run("[typeof lib.a, typeof lib.b].join()")).text, "undefined,function", "the library of the moment is the new project's");
      host.setRoots([]);
      await waitFor(() => host.rootsRequests.length === 3, 3000, "the third reading");
      assert.deepEqual(await host.run(`await ${saveCall("c", ONE)}`), { text: savedIn("c", "user"), isError: false });
      assert.equal(fileIn(w.UL, "c.js"), programText(ONE));
    });
  });
});

describe("a removal", () => {
  test("a name that is not valid, and a name that is not saved", async () => {
    const w = world();
    putProgram(w.UL, "kept", ONE);
    await inLib(w, NO_TRAIL(), async (ctx) => {
      assert.deepEqual(await ran(ctx, messageOf('library.remove("bad name")')), { text: BAD_REMOVE_NAME, isError: false });
      assert.deepEqual(await ran(ctx, messageOf("library.remove(5)")), { text: BAD_REMOVE_NAME, isError: false });
      assert.deepEqual(await ran(ctx, 'await library.remove("nothing")'), { text: FAILED(NOT_SAVED("nothing")), isError: true });
      assert.equal(existsSync(join(w.UL, "kept.js")), true);
      assert.deepEqual(names(w.UA), []);
    });
  });

  test("the program goes to the archive of its library with its text; the entry of stats.json goes too", async () => {
    const w = world();
    putProgram(w.UL, "gone", TWO);
    putProgram(w.UL, "kept", ONE);
    putStats(w.UL, { gone: { uses: 2, lastUse: null, failures: 0 }, kept: { uses: 1, lastUse: null, failures: 0 } });
    await inLib(w, NO_TRAIL(), async (ctx) => {
      assert.deepEqual(await ran(ctx, 'await library.remove("gone")'), { text: removedFrom("gone", "user"), isError: false });
      assert.equal(existsSync(join(w.UL, "gone.js")), false);
      const archived = archivedOf(w.UA, "gone");
      assert.equal(archived.length, 1);
      assert.equal(fileIn(w.UA, archived[0]), programText(TWO));
      assert.deepEqual(Object.keys(statsOf(w.UL) ?? {}), ["kept"]);
      assert.equal((await ran(ctx, "typeof lib.gone")).text, "undefined");
    });
  });

  test("the project's library is tried first; a name it does not have is the user's", async () => {
    const w = world();
    putProgram(w.PL, "dup", { about: "The project's.", code: '"p"' });
    putProgram(w.UL, "dup", { about: "The user's.", code: '"u"' });
    putProgram(w.UL, "onlyUser", ONE);
    await inLib(w, projectSettings(w, { trail: false }), async (ctx) => {
      assert.deepEqual(await ran(ctx, 'await library.remove("dup")'), { text: removedFrom("dup", "project"), isError: false });
      assert.equal(existsSync(join(w.PL, "dup.js")), false);
      assert.equal(existsSync(join(w.UL, "dup.js")), true, "the user's is still there");
      assert.equal(archivedOf(w.PA, "dup").length, 1);
      assert.deepEqual(await ran(ctx, "await lib.dup()"), { text: "u", isError: false });
      assert.deepEqual(await ran(ctx, 'await library.remove("dup")'), { text: removedFrom("dup", "user"), isError: false });
      assert.equal(archivedOf(w.UA, "dup").length, 1);
      assert.deepEqual(await ran(ctx, 'await library.remove("onlyUser")'), { text: removedFrom("onlyUser", "user"), isError: false });
      assert.deepEqual(await ran(ctx, 'await library.remove("dup")'), { text: FAILED(NOT_SAVED("dup")), isError: true });
    });
  });
});

describe("the works are done one after the other, in the order they reached the step", () => {
  test("two saves of one name at once: the first is saved, the second is refused as a same name", async () => {
    const w = world();
    await inLib(w, NO_TRAIL(), async (ctx) => {
      const code = [
        `const results = await Promise.allSettled([${saveCall("a", ONE)}, ${saveCall("a", TWO)}]);`,
        'JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason.message)))',
      ].join("\n");
      const answer = await ran(ctx, code);
      assert.equal(answer.isError, false, answer.text);
      assert.deepEqual(JSON.parse(answer.text), [savedIn("a", "user"), SAVED_ALREADY("a")]);
      assert.equal(fileIn(w.UL, "a.js"), programText(ONE));
    });
  });

  test("two saves at the cap of 1: the first is saved, the second finds the library full", async () => {
    const w = world();
    await inLib(w, NO_TRAIL({ libraryCap: 1 }), async (ctx) => {
      const code = [
        `const results = await Promise.allSettled([${saveCall("a", ONE)}, ${saveCall("b", TWO)}]);`,
        'JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason.message)))',
      ].join("\n");
      assert.deepEqual(JSON.parse((await ran(ctx, code)).text), [savedIn("a", "user"), CAP(1, 1, "a")]);
      assert.deepEqual(names(w.UL).filter((one) => one.endsWith(".js")), ["a.js"]);
    });
  });

  test("a save and a removal of the same program at once: in the order the calls were made", async () => {
    const w = world();
    putProgram(w.UL, "a", ONE);
    await inLib(w, NO_TRAIL(), async (ctx) => {
      const code = [
        `const results = await Promise.allSettled([library.remove("a"), ${saveCall("a", TWO)}]);`,
        'JSON.stringify(results.map((r) => (r.status === "fulfilled" ? r.value : r.reason.message)))',
      ].join("\n");
      assert.deepEqual(JSON.parse((await ran(ctx, code)).text), [removedFrom("a", "user"), savedIn("a", "user")]);
      assert.equal(fileIn(w.UL, "a.js"), programText(TWO));
    });
  });
});

describe("the rules `allow` and `deny` on the calls of the library", () => {
  test('`"deny": ["library.*"]` lets no program save or remove: the decision speaks, nothing is written, the trail says `refused`', async () => {
    const w = world();
    putProgram(w.UL, "kept", ONE);
    const before = names(w.UL);
    await inLib(w, libSettings({ deny: ["library.*"] }), async (ctx) => {
      const saved = await ran(ctx, `await ${saveCall("a", TWO)}`);
      assert.equal(saved.isError, true);
      const lines = saved.text.split("\n");
      assert.equal(lines[0], FAILED('onetool: library.save is denied by the rule deny "library.*"'));
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], wordLine("library.save", "refused"));
      assert.deepEqual(await ran(ctx, messageOf('library.remove("kept")')).then((one) => one.text.split("\n")[0]), 'onetool: library.remove is denied by the rule deny "library.*"');
      assert.deepEqual(names(w.UL), before);
      assert.deepEqual(names(w.H), [".onetool"]);
      assert.deepEqual(names(join(w.H, ".onetool")), ["library"], "no archive was made");
    });
  });

  test("deny of `library.save` alone leaves `library.remove` working, and the pattern is in the message", async () => {
    const w = world();
    putProgram(w.UL, "kept", ONE);
    await inLib(w, NO_TRAIL({ deny: ["library.save"] }), async (ctx) => {
      assert.deepEqual(await ran(ctx, `await ${saveCall("a", TWO)}`), {
        text: FAILED('onetool: library.save is denied by the rule deny "library.save"'),
        isError: true,
      });
      assert.deepEqual(await ran(ctx, 'await library.remove("kept")'), { text: removedFrom("kept", "user"), isError: false });
    });
  });

  test("an `allow` that does not match `library.*` refuses them as it refuses any tool", async () => {
    const w = world();
    await inLib(w, NO_TRAIL({ allow: ["practice.*"] }), async (ctx) => {
      assert.deepEqual(await ran(ctx, `await ${saveCall("a", TWO)}`), {
        text: FAILED("onetool: library.save is not allowed: it matches no rule of allow"),
        isError: true,
      });
      assert.deepEqual(names(w.H), []);
    });
  });
});

describe("the record of a call of the library, and the log", () => {
  test("the trail and the log: sizes, faults, and the name, the size of the code and `replace` of the arguments, never a program's text", async () => {
    const w = world();
    const SECRET = "SECRET_TEXT_OF_THE_PROGRAM";
    await inLib(w, libSettings({ log: true, logFolder: w.L }), async (ctx) => {
      const answers = [];
      const note = async (code) => {
        const one = await ran(ctx, code);
        answers.push(one.text);
        return one;
      };
      const code = `"${SECRET}"`;
      const saved = await note(`await ${saveCall("a", { about: "One.", code })}`);
      assert.equal(saved.text.split("\n")[0], savedIn("a", "user"));
      await note(`await ${saveCall("a", { about: "Again.", code })}`);
      await note('await library.save(5, { about: "One.", code: "1" })');
      await note(`await ${saveCall("b", { about: "Two.", code: "2", replace: true })}`);
      await note('await library.remove("a")');
      await note('await library.remove("nothing")');
      const entries = logEntries(w.L);
      assert.deepEqual(entries.map((entry) => entry.id), Array(6).fill(null).map((_, i) => (i < 4 ? "library.save" : "library.remove")));
      const [first, again, five, replaced, removed, missing] = entries;
      assert.deepEqual(first.args, { name: "a", codeSize: code.length, replace: false });
      assert.deepEqual([first.decision, first.fault, first.size], ["allowed", null, savedIn("a", "user").length]);
      assert.deepEqual(again.args, { name: "a", codeSize: code.length, replace: false });
      assert.deepEqual([again.decision, again.fault, again.size], ["allowed", SAVED_ALREADY("a"), null]);
      assert.deepEqual(five.args, { name: null, codeSize: 1, replace: false });
      assert.equal(five.fault, BAD_NAME);
      assert.deepEqual(replaced.args, { name: "b", codeSize: 1, replace: true });
      assert.equal(replaced.size, savedIn("b", "user").length);
      assert.deepEqual(removed.args, { name: "a" });
      assert.deepEqual([removed.fault, removed.size], [null, removedFrom("a", "user").length]);
      assert.deepEqual(missing.args, { name: "nothing" });
      assert.equal(missing.fault, NOT_SAVED("nothing"));
      // the trail of the first answer: one line, `library.save <n> ms <size> chars`
      assert.match(trailOf(saved.text).at(-1), okLine("library.save", String(savedIn("a", "user").length)));
      const text = logText(w.L);
      for (const value of [SECRET, w.H, w.W]) assert.equal(text.includes(value), false, `the log holds ${value}`);
      for (const one of answers) for (const value of [w.H, w.W, w.UL]) assert.equal(one.includes(value), false, `an answer holds ${value}`);
    });
  });

  test("a call refused by deny is `denied` in the log, with no size and the fault `refused by the rules`", async () => {
    const w = world();
    await inLib(w, libSettings({ log: true, logFolder: w.L, deny: ["library.remove"] }), async (ctx) => {
      await ran(ctx, 'await library.remove("a")');
      const [entry] = logEntries(w.L);
      assert.deepEqual([entry.id, entry.decision, entry.size, entry.fault], ["library.remove", "denied", null, "refused by the rules"]);
      assert.deepEqual(entry.args, { name: "a" });
    });
  });
});

describe("the question: a rule of `ask` on a call of the library", () => {
  const ASK = (w, onetool = {}) => libSettings({ trail: false, log: true, logFolder: w.L, ask: ["library.save", "library.remove"], ...onetool });
  const questionOf = (id, rule, args) =>
    [
      `onetool: a program wants to call ${id}.`,
      `Arguments: ${JSON.stringify(args)}`,
      `The rule ask "${rule}" asks for your consent. Allow this call?`,
    ].join("\n");

  test("the person is asked for each save, the four refusals and a yes are in the answers and in the log", async () => {
    const w = world();
    let reply = { action: "accept" };
    await withHost(ASK(w, { libraryCap: 1 }), { env: { HOME: w.H }, answer: () => reply }, async (host) => {
      const save = (name, program) => host.run(`await ${saveCall(name, program)}`);
      const refusal = (cause) => FAILED(`onetool: library.save is refused by the rule ask "library.save": ${cause}`);
      // the arguments as the program gave them, in the question
      assert.equal((await save("a", ONE)).text.split("\n")[0], savedIn("a", "user"));
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, questionOf("library.save", "library.save", { name: "a", about: "One.", code: "1" }));
      assert.deepEqual(host.questions[0].params.requestedSchema, { type: "object", properties: {} });
      assert.equal(host.questions[0].params.mode, "form");
      reply = { action: "decline" };
      assert.deepEqual(await save("b", TWO), { text: refusal("the person said no"), isError: true });
      reply = { action: "cancel" };
      assert.deepEqual(await save("b", TWO), { text: refusal("the person gave no answer"), isError: true });
      reply = { error: { code: -32603, message: "no" } };
      assert.deepEqual(await save("b", TWO), { text: refusal("the question failed"), isError: true });
      assert.equal(host.questions.length, 4);
      assert.equal(existsSync(join(w.UL, "b.js")), false, "nothing was saved without a yes");
      // bad arguments are refused before the question
      reply = { action: "accept" };
      assert.deepEqual(await host.run('await library.save("bad name", { about: "A.", code: "1" })'), { text: FAILED(BAD_NAME), isError: true });
      assert.equal(host.questions.length, 4, "no question for a call that cannot be made");
      // a yes, and then the decision of the library refuses: the cap is 1
      assert.deepEqual((await save("c", TWO)).text, FAILED(CAP(1, 1, "a")));
      assert.equal(host.questions.length, 5);
    });
    const saves = logEntries(w.L).filter((entry) => entry.id === "library.save");
    assert.deepEqual(saves.map((entry) => entry.decision), ["asked: yes", "asked: no", "asked: no answer", "asked: failed", "asked: not asked", "asked: yes"]);
    assert.deepEqual(saves.map((entry) => entry.fault), [null, "refused by the rules", "refused by the rules", "refused by the rules", BAD_NAME, CAP(1, 1, "a")]);
  });

  test("a host that cannot ask: the refusal of step 3, and nothing is saved", async () => {
    const w = world();
    await withHost(ASK(w), { capabilities: {}, env: { HOME: w.H } }, async (host) => {
      assert.deepEqual(await host.run(`await ${saveCall("a", ONE)}`), {
        text: FAILED('onetool: library.save is refused by the rule ask "library.save": the host program cannot ask the person'),
        isError: true,
      });
      assert.deepEqual(host.questions, []);
      assert.deepEqual(names(w.H), []);
    });
    assert.deepEqual(logEntries(w.L).map((entry) => entry.decision), ["asked: cannot ask"]);
  });

  test("a removal is asked as a save is, with the name as its arguments; a no leaves the program as it was", async () => {
    const w = world();
    putProgram(w.UL, "kept", ONE);
    let reply = { action: "decline" };
    await withHost(ASK(w), { env: { HOME: w.H }, answer: () => reply }, async (host) => {
      assert.deepEqual(await host.run('await library.remove("kept")'), {
        text: FAILED('onetool: library.remove is refused by the rule ask "library.remove": the person said no'),
        isError: true,
      });
      assert.equal(host.questions[0].message, questionOf("library.remove", "library.remove", { name: "kept" }));
      assert.equal(fileIn(w.UL, "kept.js"), programText(ONE));
      reply = { action: "accept" };
      assert.equal((await host.run('await library.remove("kept")')).text.split("\n")[0], removedFrom("kept", "user"));
      assert.equal(host.questions.length, 2);
    });
  });
});
