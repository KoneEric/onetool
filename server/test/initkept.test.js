// Step 11, the tools a server keeps (the meeting point of server, "The tools a server keeps"): an entry with `tools` offers only those tools
// in the catalog, in `search` and in the names of a program; the rules go on as before for the kept ones; an entry without `tools` is
// as before. The practice server, the fake server and a server at an address are the servers behind onetool; HOME is a folder of the test.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeEntry, okText, practiceEntry, settingsOf, textOf, tmpDir, withOnetool, withoutSession } from "./helpers.js";
import { withHttp, urlEntry } from "./httpfixture.js";
import { COUNT_LYON, failedLine, signSettings, withPractice, withSignin, signIn } from "./signhelpers.js";

const ONETOOL = { timeoutSeconds: 10 };
const KEPT = ["count", "echo", "nosuch"];
const kept = (tools = KEPT) => ({ ...practiceEntry(), tools });

describe("the catalog and search", () => {
  test("search with no words counts the kept tools: two of the five the server lists", async () => {
    await withOnetool(settingsOf({ practice: kept() }, ONETOOL), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 2 tools");
    });
  });

  test("search with words finds the kept tools and no other", async () => {
    await withOnetool(settingsOf({ practice: kept() }, ONETOOL), async (ctx) => {
      const echo = textOf(await ctx.call("search", { words: "echo" }));
      assert.ok(echo.split("\n").some((line) => line.startsWith("practice.echo(")), echo);
      for (const word of ["wipe", "fail", "rows"]) {
        const text = textOf(await ctx.call("search", { words: word }));
        assert.ok(!text.split("\n").some((line) => line.startsWith(`practice.${word}(`)), `${word}: ${text}`);
      }
      assert.ok(!textOf(await ctx.call("search", { words: "wipe" })).includes("practice.wipe"));
    });
  });

  test("a name of tools that the server does not list gives nothing, and nothing is said on standard error about what is not kept", async () => {
    await withOnetool(settingsOf({ practice: kept() }, ONETOOL), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 2 tools");
      await ctx.run("1");
      for (const name of ["nosuch", "rows", "wipe", "fail"]) assert.ok(!ctx.stderr().includes(name), ctx.stderr());
    });
  });

  test("the same server with no tools in its entry: five tools, as before", async () => {
    await withOnetool(settingsOf({ practice: practiceEntry() }, ONETOOL), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 5 tools");
    });
  });

  test("a server at an address keeps only its tools too", async () => {
    await withHttp({ tools: ["hello", "rec", "calls", "plain"] }, async (server) => {
      const settings = settingsOf({ web: { ...urlEntry(server), tools: ["plain", "hello"] } }, ONETOOL);
      await withOnetool(settings, async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), "web: 2 tools");
        assert.equal(okText(await ctx.run("[typeof tools.web.hello, typeof tools.web.rec, typeof tools.web.plain].join(' ')")).split("\n")[0], "function undefined function");
      });
    });
  });
});

describe("the names given to a program", () => {
  test("a kept tool is a function, one that is not kept is undefined, exactly as a name the server does not have", async () => {
    await withOnetool(settingsOf({ practice: kept() }, ONETOOL), async (ctx) => {
      const text = okText(
        await ctx.run("[typeof tools.practice.count, typeof tools.practice.echo, typeof tools.practice.rows, typeof tools.practice.wipe, typeof tools.practice.nosuch].join(' ')"),
      );
      assert.equal(text.split("\n")[0], "function function undefined undefined undefined");
    });
  });

  test("calling a tool that is not kept throws a TypeError, as for a name the server lacks", async () => {
    await withOnetool(settingsOf({ practice: kept() }, ONETOOL), async (ctx) => {
      const code = (name) => `try { await tools.practice.${name}({}); return "answered"; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; }`;
      assert.equal(okText(await ctx.run(code("rows"))).split("\n")[0], "TypeError");
      assert.equal(okText(await ctx.run(code("nosuch"))).split("\n")[0], "TypeError");
    });
  });

  test("a kept tool works: it is called on the real server", async () => {
    await withOnetool(settingsOf({ practice: kept() }, ONETOOL), async (ctx) => {
      assert.equal(okText(await ctx.run('(await tools.practice.count({ city: "Lyon" })).count')).split("\n")[0], "625");
    });
  });

  test("the real server is never asked for a tool that is not kept", async () => {
    const entry = { ...fakeEntry({ tools: ["rec", "calls", "plain", "mark"] }), tools: ["calls", "plain"] };
    await withOnetool(settingsOf({ fake: entry }, ONETOOL), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "fake: 2 tools");
      const answer = await ctx.run(
        'try { await tools.fake.rec({ x: 1 }); } catch (e) {} try { await tools.fake.mark({}); } catch (e) {} await tools.fake.plain({ y: 2 }); return await tools.fake.calls({});',
      );
      assert.deepEqual(JSON.parse(okText(answer)), [{ name: "plain", arguments: { y: 2 } }]);
    });
  });
});

describe("everything else is as before for the kept tools", () => {
  test("deny covers a kept tool: its refusal is the message of the rule; a tool not kept stays a TypeError", async () => {
    const settings = settingsOf({ practice: kept(["count", "echo", "wipe"]) }, { ...ONETOOL, deny: ["practice.echo"] });
    await withOnetool(settings, async (ctx) => {
      const denied = await ctx.run('await tools.practice.echo({ text: "x" })');
      assert.equal(denied.isError, true);
      assert.equal(textOf(denied).split("\n")[0], 'The program failed: Error: onetool: practice.echo is denied by the rule deny "practice.echo"');
      assert.equal(withoutSession(textOf(await ctx.call("search", {}))), "practice: 2 tools");
      const notKept = await ctx.run("await tools.practice.rows({})");
      assert.equal(notKept.isError, true);
      assert.match(textOf(notKept).split("\n")[0], /^The program failed: TypeError/);
    });
  });

  test("a list of kept tools closes no tool of another server: tools speaks of its own server only", async () => {
    const settings = settingsOf({ practice: kept(["count", "echo"]), other: practiceEntry() }, { ...ONETOOL, deny: ["other.wipe"] });
    await withOnetool(settings, async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 2 tools\nother: 4 tools");
    });
  });
});

describe("a sign-in server that keeps some tools", () => {
  test("sign in needed: every name is still a function that gives the message of step 10; once connected its tools are the kept ones", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const S = signSettings(practice, { withCommand: false, far: { tools: ["count", "echo"] } });
      await withSignin(S, home, async (one) => {
        assert.equal(await one.search(), "far: sign in needed");
        const names = await one.run("[typeof tools.far.rows, typeof tools.far.count, typeof tools.far.whatever].join(' ')");
        assert.equal(names.lines[0], "function function function");
        const failed = await one.run("await tools.far.rows({})");
        assert.equal(failed.isError, true);
        assert.equal(failed.lines[0], failedLine(S, "far.rows"));

        await signIn(S, home);
        assert.equal(withoutSession(await one.search()), "far: 2 tools");
        const after = await one.run("[typeof tools.far.rows, typeof tools.far.count, typeof tools.far.echo].join(' ')");
        assert.equal(after.lines[0], "undefined function function");
        assert.equal((await one.run(COUNT_LYON)).lines[0], "625");
      });
    });
  });
});
