import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAKE_TOOL_COUNT, fakeEntry, okText, practiceEntry, settingsOf, textOf, tmpPath, waitFor, withOnetool } from "./helpers.js";

const FAKE_ONLY = (onetool = {}) => settingsOf({ fake: fakeEntry() }, { timeoutSeconds: 10, ...onetool });

describe("a call of a tool of a real server, as the program sees it", () => {
  test("the result is read by toolValue: structured, JSON text, plain text, no text", async () => {
    await withOnetool(FAKE_ONLY(), async (ctx) => {
      const code = [
        "const a = await tools.fake.structured({});",
        "const b = await tools.fake.json({});",
        "const c = await tools.fake.plain({});",
        "const d = await tools.fake.empty({});",
        "return { a, b, c, d };",
      ].join("\n");
      assert.equal(okText(await ctx.run(code)), '{"a":{"x":1},"b":{"n":12},"c":"hello world","d":null}');
    });
  });

  test("a tool that fails: <id> failed: <its text>, which the program may catch", async () => {
    await withOnetool(FAKE_ONLY(), async (ctx) => {
      const caught = await ctx.run(
        "try { await tools.fake.toolerr({}); } catch (e) { return e.message; } return 'no error'",
      );
      assert.equal(okText(caught), "fake.toolerr failed: bad things");
      const uncaught = await ctx.run("await tools.fake.toolerr({})");
      assert.equal(uncaught.isError, true);
      assert.equal(textOf(uncaught), "The program failed: Error: fake.toolerr failed: bad things");
    });
  });

  test("a JSON-RPC error of the server: <id> failed: <the error's message>", async () => {
    await withOnetool(FAKE_ONLY(), async (ctx) => {
      const msg = okText(await ctx.run("try { await tools.fake.rpcerr({}); } catch (e) { return e.message; }"));
      assert.ok(msg.startsWith("fake.rpcerr failed: "), msg);
      assert.ok(msg.includes("boom"), msg);
    });
  });

  test("the arguments reach the server as they are; no argument reaches it as {}", async () => {
    await withOnetool(FAKE_ONLY(), async (ctx) => {
      const code = [
        'await tools.fake.rec({ a: 1, b: [2, "x"], c: { d: "é" } });',
        "await tools.fake.rec();",
        "return await tools.fake.calls({});",
      ].join("\n");
      assert.equal(
        okText(await ctx.run(code)),
        '[{"name":"rec","arguments":{"a":1,"b":[2,"x"],"c":{"d":"é"}}},{"name":"rec","arguments":{}}]',
      );
    });
  });

  test("a name that is no identifier is reached with brackets", async () => {
    const settings = settingsOf({ "my server": fakeEntry({ tools: ["get-rows"] }) }, { timeoutSeconds: 10 });
    await withOnetool(settings, async (ctx) => {
      assert.equal(okText(await ctx.run('await tools["my server"]["get-rows"]({})')), "called get-rows");
    });
  });
});

describe("the practice server behind it", () => {
  const PRACTICE_ONLY = settingsOf({ practice: practiceEntry() }, { timeoutSeconds: 10 });

  test("a failing tool: practice.fail failed: practice failure: <reason>", async () => {
    await withOnetool(PRACTICE_ONLY, async (ctx) => {
      const asked = await ctx.run("await tools.practice.fail({})");
      assert.equal(asked.isError, true);
      assert.equal(textOf(asked), "The program failed: Error: practice.fail failed: practice failure: asked to fail");
      const why = okText(await ctx.run('try { await tools.practice.fail({ reason: "nope" }); } catch (e) { return e.message; }'));
      assert.equal(why, "practice.fail failed: practice failure: nope");
    });
  });

  test("tools that answer with text and with JSON", async () => {
    await withOnetool(PRACTICE_ONLY, async (ctx) => {
      assert.equal(okText(await ctx.run('await tools.practice.echo({ text: "hello world" })')), "hello world");
      assert.equal(okText(await ctx.run('await tools.practice.count({ city: "Lyon" })')), '{"count":625}');
    });
  });
});

describe("the rules of allow and deny", () => {
  test("a denied tool exists in the program; calling it gives the refusal, and the real server is not called", async () => {
    await withOnetool(FAKE_ONLY({ deny: ["fake.r*"] }), async (ctx) => {
      const code = [
        'const out = { type: typeof tools.fake.rec };',
        "try { await tools.fake.rec({}); } catch (e) { out.message = e.message; }",
        "out.calls = await tools.fake.calls({});",
        "return out;",
      ].join("\n");
      assert.equal(
        okText(await ctx.run(code)),
        JSON.stringify({ type: "function", message: 'onetool: fake.rec is denied by the rule deny "fake.r*"', calls: [] }),
      );
    });
  });

  test("a tool that matches no rule of allow is refused with the message of the decision", async () => {
    await withOnetool(FAKE_ONLY({ allow: ["fake.hello", "fake.calls"] }), async (ctx) => {
      const code = [
        "const out = {};",
        "try { await tools.fake.rec({}); } catch (e) { out.message = e.message; }",
        "out.calls = await tools.fake.calls({});",
        "out.hello = await tools.fake.hello({});",
        "return out;",
      ].join("\n");
      assert.equal(
        okText(await ctx.run(code)),
        JSON.stringify({
          message: "onetool: fake.rec is not allowed: it matches no rule of allow",
          calls: [],
          hello: "called hello",
        }),
      );
    });
  });

  test("the decision comes first: a denied tool given a bad argument gives the refusal", async () => {
    await withOnetool(FAKE_ONLY({ deny: ["fake.rec"] }), async (ctx) => {
      const msg = okText(await ctx.run("try { await tools.fake.rec(5); } catch (e) { return e.message; }"));
      assert.equal(msg, 'onetool: fake.rec is denied by the rule deny "fake.rec"');
    });
  });

  test("an uncaught refusal ends the program: the answer of the real thing", async () => {
    await withOnetool(settingsOf({ practice: practiceEntry() }, { deny: ["practice.wipe"] }), async (ctx) => {
      const res = await ctx.run("await tools.practice.wipe({})");
      assert.equal(res.isError, true);
      assert.equal(
        textOf(res),
        'The program failed: Error: onetool: practice.wipe is denied by the rule deny "practice.wipe"',
      );
    });
  });
});

describe("arguments that are not an object", () => {
  test("a list, a text, a number or null: onetool: the arguments of <id> must be an object, and no call", async () => {
    await withOnetool(FAKE_ONLY(), async (ctx) => {
      const code = [
        "const messages = [];",
        'for (const bad of [[1, 2], "text", 5, null]) {',
        "  try { await tools.fake.rec(bad); messages.push('called'); } catch (e) { messages.push(e.message); }",
        "}",
        "return { messages, calls: await tools.fake.calls({}) };",
      ].join("\n");
      const message = "onetool: the arguments of fake.rec must be an object";
      assert.equal(
        okText(await ctx.run(code)),
        JSON.stringify({ messages: [message, message, message, message], calls: [] }),
      );
    });
  });
});

describe("a server whose process ends while onetool runs", () => {
  test("its calls reject, search goes on showing its tools, it is not started again, the others go on", async () => {
    const startLog = tmpPath("starts");
    const settings = settingsOf(
      { fake: fakeEntry({ startLog }), practice: practiceEntry() },
      { timeoutSeconds: 10 },
    );
    await withOnetool(settings, async (ctx) => {
      const dying = okText(
        await ctx.run("try { await tools.fake.die({}); return 'answered'; } catch (e) { return e.message; }"),
      );
      assert.ok(dying.startsWith("fake.die failed: "), dying);
      // once its process is gone, every call says so
      let last = "";
      await waitFor(
        async () => {
          last = okText(
            await ctx.run("try { await tools.fake.hello({}); return 'answered'; } catch (e) { return e.message; }"),
          );
          return last === "fake.hello failed: not connected";
        },
        3000,
        `fake.hello failed: not connected (last answer: ${last})`,
      );
      assert.equal(okText(await ctx.run("1 + 1")), "2");
      assert.equal(textOf(await ctx.call("search", {})), `fake: ${FAKE_TOOL_COUNT} tools\npractice: 5 tools`);
      assert.equal(okText(await ctx.run('await tools.practice.echo({ text: "still here" })')), "still here");
      assert.equal(readFileSync(startLog, "utf8").trim().split("\n").length, 1);
    });
  });
});

describe("several calls of run at once", () => {
  test("they run at the same time: two programs that wait for each other both end", async () => {
    // The fake answers `barrier` only once two calls wait for it.
    await withOnetool(FAKE_ONLY({ timeoutSeconds: 3 }), async (ctx) => {
      const both = await Promise.all([ctx.run("await tools.fake.barrier({})"), ctx.run("await tools.fake.barrier({})")]);
      assert.deepEqual(both.map(okText), ["released", "released"]);
    });
  });
});
