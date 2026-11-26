// Step 12: the instructions given to the host, and the sentence in the description of `run`
// (the meeting point of server, "Step 12: leading the session to group its work", "The instructions" and "The description of `run`").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeEntry, practiceEntry, rawOnetool, settingsOf, textOf, tmpDir, withOnetool, writeSettings } from "./helpers.js";
import { startHost } from "./askhost.js";
import { EMPTY_LIBRARY_TEXT, putProgram, putStats, libSettings, world } from "./libhelpers.js";
import { INSTRUCTIONS, SENTENCE, openHost, withSession } from "./grouphelpers.js";
import { join } from "node:path";

const descriptionTexts = (tools) =>
  tools.flatMap((tool) => [tool.description, ...Object.values(tool.inputSchema?.properties ?? {}).map((property) => property.description)]);
const totalOf = (tools) => descriptionTexts(tools).join("").length;

describe("the instructions of the answer to initialize", () => {
  test("by default: the package's client has exactly the text, at most 600 characters", async () => {
    await withOnetool(libSettings(), async (ctx) => {
      assert.equal(ctx.client.getInstructions(), INSTRUCTIONS);
      assert.ok(INSTRUCTIONS.length <= 600);
    });
  });

  test('"instructions": true says the same as the default', async () => {
    await withOnetool(libSettings({ instructions: true }), async (ctx) => {
      assert.equal(ctx.client.getInstructions(), INSTRUCTIONS);
    });
  });

  test('"instructions": false: no key `instructions` in the result of initialize, and `getInstructions()` is undefined', async () => {
    await withOnetool(libSettings({ instructions: false }), async (ctx) => {
      assert.equal(ctx.client.getInstructions(), undefined);
    });
    const it = await openHost(libSettings({ instructions: false }));
    try {
      assert.equal(Object.hasOwn(it.host.initializeResult, "instructions"), false);
    } finally {
      await it.close();
    }
  });

  test("the raw result has the key `instructions` with exactly the text; the rest of the answer is what it is with false: the name, the version, the capabilities", async () => {
    const on = await openHost(libSettings());
    const off = await openHost(libSettings({ instructions: false }));
    try {
      assert.equal(on.host.initializeResult.instructions, INSTRUCTIONS);
      const { instructions, ...rest } = on.host.initializeResult;
      assert.equal(typeof instructions, "string");
      assert.deepEqual(rest, off.host.initializeResult);
      assert.equal(rest.serverInfo.name, "onetool");
      assert.equal(typeof rest.serverInfo.version, "string");
      assert.equal(typeof rest.capabilities, "object");
      assert.equal(on.host.stderr().includes("onetool gives you"), false, "nothing of it on standard error");
    } finally {
      await on.close();
      await off.close();
    }
  });

  test("the text is fixed: the same with no server, with the shell on, with a saved program, with bad entries, with rules, for another host program", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "Counts the rows of one city.", params: ["city"], code: "1" });
    const cases = [
      ["no server", settingsOf({}, { trail: true, log: false }), {}],
      ["the shell on, a saved program, a project", libSettings({ shell: { folders: [w.W] } }, { practice: practiceEntry(), fake: fakeEntry() }), { env: { HOME: w.H } }],
      ["a bad entry and rules", libSettings({ allow: ["practice.*"], deny: ["practice.wipe"], ask: ["practice.echo"] }, { practice: practiceEntry(), broken: { nothing: true } }), {}],
      ["a host that can be asked, under another name", libSettings(), { capabilities: { elicitation: {} }, name: "another-host" }],
    ];
    for (const [what, settings, options] of cases) {
      const host = await startHost(settings, { capabilities: {}, ...options });
      try {
        assert.equal(host.initializeResult.instructions, INSTRUCTIONS, what);
        for (const name of ["practice", "fake"]) assert.equal(host.initializeResult.instructions.includes(name), false, `${what}: names no server`);
      } finally {
        host.kill();
        await host.exited;
      }
    }
  });

  test("it is given once, in that answer: no later message of onetool carries it", async () => {
    const raw = rawOnetool(libSettings());
    try {
      const first = await raw.initialize();
      assert.equal(first.result.instructions, INSTRUCTIONS);
      assert.equal((await raw.request("tools/list", {})).error, undefined);
      assert.equal((await raw.callTool("run", { code: "1 + 1" })).result.content[0].text, "2");
      assert.equal((await raw.callTool("search", {})).error, undefined);
      assert.equal((await raw.request("prompts/list", {})).error, undefined);
      const carrying = raw.lines.filter((line) => line.includes(INSTRUCTIONS.slice(0, 60)));
      assert.equal(carrying.length, 1, "one message holds the text");
      assert.equal(JSON.parse(carrying[0]).id, first.id);
    } finally {
      raw.kill();
      await raw.exited;
    }
  });
});

describe("the two tools and the prompt are what they were", () => {
  test("tools/list gives exactly run and search with the properties of step 6, and the prompt of step 8 is listed; all the same with false", async () => {
    const lists = [];
    for (const onetool of [{}, { instructions: false }]) {
      await withOnetool(libSettings(onetool), async (ctx) => {
        const { tools } = await ctx.client.listTools(undefined, { timeout: 10000 });
        assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
        assert.deepEqual(Object.keys(tools[0].inputSchema.properties), ["code", "background", "job", "stop", "jobs"]);
        assert.deepEqual(Object.keys(tools[1].inputSchema.properties), ["words"]);
        const { prompts } = await ctx.client.listPrompts(undefined, { timeout: 10000 });
        assert.deepEqual(prompts.map((prompt) => prompt.name), ["tidy-library"]);
        lists.push(JSON.stringify([tools, prompts]));
      });
    }
    assert.equal(lists[0], lists[1], "with false the tools and the prompt are the same, to the character");
  });
});

describe("the sentence in the description of run", () => {
  test("it holds the sentence, with the shell off or on, and the library empty or full, in every case under the limits", async () => {
    const w = world();
    // five programs with names of 40 characters, the most used: the library text is as long as it can be
    const longNames = ["a", "b", "c", "d", "e"].map((letter) => letter.repeat(40));
    for (const name of longNames) putProgram(w.UL, name, { about: "One.", code: "1" });
    putStats(w.UL, Object.fromEntries(longNames.map((name, at) => [name, { uses: 10 - at, lastUse: "2026-11-18T10:00:00.000Z", failures: 0 }])));
    const cases = [
      ["the shell off, an empty library", libSettings(), tmpDir(), true],
      ["the shell on with folders, an empty library", libSettings({ shell: { folders: [w.W] } }), tmpDir(), true],
      ["the shell off, a full library", libSettings(), w.H, false],
      ["the shell on with folders, a full library", libSettings({ shell: { folders: [w.W] } }), w.H, false],
    ];
    for (const [what, settings, home, empty] of cases) {
      const path = writeSettings(settings);
      await withOnetool(path, async (ctx) => {
        const { tools } = await ctx.client.listTools(undefined, { timeout: 10000 });
        const run = tools.find((tool) => tool.name === "run");
        assert.ok(run.description.includes(SENTENCE), what);
        assert.ok(totalOf(tools) < 1500, `${what}: all the descriptions are ${totalOf(tools)} characters`);
        if (empty) {
          assert.ok(run.description.includes(` ${EMPTY_LIBRARY_TEXT}`), what);
          // the texts that are fixed: everything but the one space and the library text
          const fixed = totalOf(tools) - EMPTY_LIBRARY_TEXT.length - 1;
          assert.ok(fixed < 1200, `${what}: the fixed texts are ${fixed} characters`);
        }
      }, { env: { HOME: home } });
    }
  });

  test("the earlier words of the description are still there, and the description is the same with instructions false", async () => {
    const descriptions = [];
    for (const onetool of [{}, { instructions: false }]) {
      await withOnetool(libSettings(onetool), async (ctx) => {
        const { tools } = await ctx.client.listTools(undefined, { timeout: 10000 });
        descriptions.push(tools[0].description);
        for (const word of ["tools.<server>.<tool>(", "await", "console.log", "search", "background: true", "job", "progress("]) {
          assert.ok(tools[0].description.includes(word), word);
        }
      });
    }
    assert.equal(descriptions[0], descriptions[1]);
  });
});
