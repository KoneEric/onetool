// Step 8: the prompt `tidy-library` and the capabilities (the meeting point of server, "Step 8: tidying the library", "The prompt
// `tidy-library`"). Every test starts the command with HOME a folder it made, and says "trail" and "log".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fakeEntry, practiceEntry, settingsOf, tmpDir, withRaw } from "./helpers.js";
import { inLib, libSettings, names, putProgram, putRaw, world, COUNT } from "./libhelpers.js";

const SETTINGS = (onetool = {}, servers = { practice: practiceEntry() }) =>
  settingsOf(servers, { trail: true, timeoutSeconds: 10, log: false, ...onetool });

/** `fn(raw)` with the command started and initialised, HOME being `home`. */
const withPrompts = (settings, home, fn) =>
  withRaw(settings, async (raw) => {
    await raw.initialize();
    return fn(raw);
  }, { env: { HOME: home } });

const getPrompt = async (raw, name = "tidy-library", extra = {}) => (await raw.request("prompts/get", { name, ...extra }, 3000)).result;

const REQUIRED = [
  "library.report()",
  "library.read(name)",
  "library.save",
  "replace: true",
  "library.remove",
  "library.restore",
  "merge",
  "retire",
  "rename",
  "Change nothing before the person says yes.",
];

describe("the capabilities: one more key, `prompts`", () => {
  test("`{ tools: {}, prompts: {} }`: no `listChanged` for the prompts, and no other capability", async () => {
    const home = tmpDir();
    await withRaw(SETTINGS(), async (raw) => {
      const res = await raw.initialize();
      assert.deepEqual(res.result.capabilities, { tools: {}, prompts: {} });
    }, { env: { HOME: home } });
  });

  test("the shell with no folder given (the one case of step 5): `{ tools: { listChanged: true }, prompts: {} }`", async () => {
    await withRaw(SETTINGS({ shell: {} }), async (raw) => {
      const res = await raw.initialize();
      assert.deepEqual(res.result.capabilities, { tools: { listChanged: true }, prompts: {} });
    }, { env: { HOME: tmpDir() } });
  });

  test("the shell with folders in the file: `{ tools: {}, prompts: {} }`", async () => {
    await withRaw(SETTINGS({ shell: { folders: [tmpDir()] } }), async (raw) => {
      const res = await raw.initialize();
      assert.deepEqual(res.result.capabilities, { tools: {}, prompts: {} });
    }, { env: { HOME: tmpDir() } });
  });
});

describe("`prompts/list`", () => {
  test("exactly one prompt, with exactly the keys `name` and `description`, whatever the request holds", async () => {
    await withPrompts(SETTINGS(), tmpDir(), async (raw) => {
      for (const params of [{}, { cursor: "next-page" }, { cursor: "" }]) {
        const { result } = await raw.request("prompts/list", params, 3000);
        assert.deepEqual(Object.keys(result), ["prompts"], JSON.stringify(params));
        assert.equal(result.prompts.length, 1);
        const [prompt] = result.prompts;
        assert.deepEqual(Object.keys(prompt).sort(), ["description", "name"]);
        assert.equal(prompt.name, "tidy-library");
        assert.equal(typeof prompt.description, "string");
        assert.ok(prompt.description.length > 0 && prompt.description.length <= 200, `${prompt.description.length} characters`);
        assert.equal(prompt.description.includes("\n"), false, "one sentence");
      }
    });
  });
});

describe("`prompts/get`", () => {
  test("one message of the role `user`, its content a text; the description is the one of the list; `arguments` are ignored", async () => {
    await withPrompts(SETTINGS(), tmpDir(), async (raw) => {
      const listed = (await raw.request("prompts/list", {}, 3000)).result.prompts[0];
      const got = await getPrompt(raw);
      assert.deepEqual(Object.keys(got).sort(), ["description", "messages"]);
      assert.equal(got.description, listed.description);
      assert.equal(got.messages.length, 1);
      const [message] = got.messages;
      assert.deepEqual(Object.keys(message).sort(), ["content", "role"]);
      assert.equal(message.role, "user");
      assert.deepEqual(Object.keys(message.content).sort(), ["text", "type"]);
      assert.equal(message.content.type, "text");
      assert.equal(typeof message.content.text, "string");
      const again = await getPrompt(raw, "tidy-library", { arguments: { anything: "1", name: "x" } });
      assert.deepEqual(again, got);
    });
  });

  test("the text is under 2,000 characters and holds the words the text of the piece lists", async () => {
    await withPrompts(SETTINGS(), tmpDir(), async (raw) => {
      const { text } = (await getPrompt(raw)).messages[0].content;
      assert.ok(text.length < 2000, `${text.length} characters`);
      for (const needed of REQUIRED) assert.ok(text.includes(needed), `the text lacks ${JSON.stringify(needed)}`);
    });
  });

  test("the text is fixed: the same whatever the settings and the library hold, and it names no server, tool or saved program", async () => {
    const plain = world();
    const full = world();
    putProgram(full.UL, "zebraCount", { about: "Counts zebras.", params: ["city"], code: COUNT });
    putProgram(full.PL, "okapiShare", { about: "Shares okapis.", code: "1" });
    const first = await withPrompts(SETTINGS(), plain.H, (raw) => getPrompt(raw));
    const second = await withPrompts(
      SETTINGS({ shell: { folders: [full.W] }, libraryCap: 7, ask: ["library.save"], deny: ["library.remove"], timeoutSeconds: 3, log: true, logFolder: full.L },
        { fake: fakeEntry(), practice: practiceEntry() }),
      full.H,
      (raw) => getPrompt(raw),
    );
    assert.deepEqual(second, first);
    const { text } = first.messages[0].content;
    for (const name of ["practice", "zebraCount", "okapiShare", "fake"]) assert.equal(text.includes(name), false, name);
    assert.equal(text.includes(plain.H) || text.includes(full.H) || text.includes(full.W), false, "no folder");
  });

  test("any other name is an error holding `unknown prompt: <name>`, the name compared exactly, case counting", async () => {
    await withPrompts(SETTINGS(), tmpDir(), async (raw) => {
      for (const name of ["nope", "Tidy-Library", "TIDY-LIBRARY", "tidy-library ", "tidy_library", "tidy-librar", ""]) {
        const message = await raw.request("prompts/get", { name }, 3000);
        assert.equal(message.result, undefined, JSON.stringify(name));
        assert.equal(typeof message.error?.message, "string", JSON.stringify(name));
        assert.ok(message.error.message.includes(`unknown prompt: ${name}`), message.error.message);
      }
      // and onetool goes on
      assert.equal((await getPrompt(raw)).messages.length, 1);
    });
  });
});

describe("both requests are answered at once and touch nothing", () => {
  test("they wait for no listed server: a server that never lists its tools does not hold them back", async () => {
    const home = tmpDir();
    const settings = SETTINGS({ connectSeconds: 20 }, { hang: fakeEntry({ listHang: true }) });
    await withPrompts(settings, home, async (raw) => {
      const started = Date.now();
      const listed = await raw.request("prompts/list", {}, 3000);
      const got = await raw.request("prompts/get", { name: "tidy-library" }, 3000);
      assert.equal(listed.result.prompts.length, 1);
      assert.equal(got.result.messages.length, 1);
      assert.ok(Date.now() - started < 3000);
      assert.deepEqual(raw.stderrLines(), [], "nothing on standard error, the server not being given up yet");
    });
  });

  test("they read and write no file, read no library and say nothing on standard error", async () => {
    const w = world();
    putProgram(w.UL, "a", { about: "A.", code: "1" });
    putRaw(w.UL, "notes.js", "not a program");
    const before = names(w.UL);
    await withPrompts(SETTINGS({ shell: { folders: [w.W] }, log: true, logFolder: w.L }), w.H, async (raw) => {
      assert.equal((await raw.request("prompts/list", {}, 3000)).result.prompts.length, 1);
      assert.equal((await getPrompt(raw)).messages.length, 1);
      assert.ok((await raw.request("prompts/get", { name: "nope" }, 3000)).error.message.includes("unknown prompt: nope"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(raw.stderr().includes("is not a saved program"), false, "the library was not read");
      assert.equal(raw.stderrLines().filter((line) => line.includes("notes.js")).length, 0);
    });
    assert.deepEqual(names(w.UL), before);
    assert.deepEqual(names(w.H), [".onetool"], "only the folder the test made");
    assert.deepEqual(names(join(w.H, ".onetool")), ["library"], "no archive, no sequences file");
    assert.deepEqual(names(w.L), [], "no call of a real tool: no line of the log");
    assert.deepEqual(names(w.W), [], "the project is as it was");
  });
});

describe("`tools/list` and `search` are what they were", () => {
  test("exactly `run` and `search`; `search` shows none of the three new ids, as it does not show `library.save`", async () => {
    const w = world();
    putProgram(w.UL, "a", { about: "A.", code: "1" });
    await inLib(w, libSettings(), async (ctx) => {
      const { tools } = await ctx.client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
      assert.ok(tools[0].description.includes("Saved programs: 1"));
      const texts = [tools[0].description, ...Object.values(tools[0].inputSchema.properties).map((one) => one.description), tools[1].description, tools[1].inputSchema.properties.words.description];
      assert.ok(texts.join("").length < 1500, `${texts.join("").length} characters`);
      for (const words of [undefined, "library", "report", "restore", "read", "tidy"]) {
        const answer = (await ctx.call("search", words === undefined ? {} : { words })).content[0].text;
        for (const id of ["library.report", "library.restore", "library.read", "library.save"]) assert.equal(answer.includes(id), false, `${id} in the search of ${words}`);
      }
    });
  });
});
