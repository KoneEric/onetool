// Step 2: `state`, kept between two calls of run (the meeting point of server, "Step 2: `state`").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fakeEntry, okText, settingsOf, textOf, tmpDir, withOnetool, withRaw, writeSettings } from "./helpers.js";

const FAKE = (onetool = {}) => settingsOf({ fake: fakeEntry() }, { timeoutSeconds: 10, ...onetool });

describe("state: what one call leaves, the next one finds", () => {
  test("the first program finds an empty object", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      assert.equal(okText(await ctx.run("typeof state")), "object");
      assert.equal(okText(await ctx.run("JSON.stringify(state)")), "{}");
    });
  });

  test("state.n = 41, then state.n + 1 answers 42, and the second call calls no tool", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      assert.notEqual((await ctx.run("await tools.fake.rec({ a: 1 }); state.n = 41")).isError, true);
      assert.equal(okText(await ctx.run("state.n + 1")), "42");
      // the server recorded the one call of the first program, and no other
      assert.equal(okText(await ctx.run("await tools.fake.calls({})")), '[{"name":"rec","arguments":{"a":1}}]');
    });
  });

  test("a key that a program removes is gone for the next one", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      await ctx.run("state.n = 1; state.m = 2");
      await ctx.run("delete state.n");
      assert.equal(okText(await ctx.run("JSON.stringify(state)")), '{"m":2}');
    });
  });

  test("a program that throws after state.a = 1 has kept a", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      const failed = await ctx.run('state.a = 1; throw new Error("x")');
      assert.equal(failed.isError, true);
      assert.equal(textOf(failed), "The program failed: Error: x");
      assert.equal(okText(await ctx.run("state.a")), "1");
    });
  });

  test("a program stopped at the time limit has kept nothing of that call, and what was kept before is still there", async () => {
    await withOnetool(FAKE({ timeoutSeconds: 1 }), async (ctx) => {
      await ctx.run("state.a = 1");
      const stopped = await ctx.run("state.a = 99; state.b = 2; while (true) {}");
      assert.equal(stopped.isError, true);
      assert.equal(textOf(stopped), "The program was stopped after 1 seconds.");
      assert.equal(okText(await ctx.run("JSON.stringify(state)")), '{"a":1}');
    });
  });

  test("a program whose process ended has kept nothing of that call, and what was kept before is still there", async () => {
    await withOnetool(FAKE({ timeoutSeconds: 30 }), async (ctx) => {
      await ctx.run("state.a = 1");
      // memoryMb is left at its default (256): a program that keeps 2 GB of numbers cannot stay in it.
      const crashed = await ctx.run("state.a = 99; state.b = 2; const keep = []; while (true) keep.push(new Array(1000000).fill(1))");
      assert.equal(crashed.isError, true);
      assert.ok(textOf(crashed).startsWith("The program's process ended before it answered ("), textOf(crashed));
      assert.equal(okText(await ctx.run("JSON.stringify(state)")), '{"a":1}');
    });
  });

  test("a state that cannot be sent as JSON: the answer says so, and nothing of that call is kept", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      await ctx.run("state.a = 1");
      for (const code of ["state.c = 1n; 5", "state.a = 2; state.self = state; 5"]) {
        const res = await ctx.run(code);
        assert.equal(res.isError, true, code);
        assert.equal(textOf(res), "The program failed: state was not kept: it cannot be sent as JSON", code);
        assert.equal(okText(await ctx.run("JSON.stringify(state)")), '{"a":1}', code);
      }
    });
  });

  test("a call refused for its arguments, and search, leave the kept state as it was", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      await ctx.run("state.x = 1");
      assert.equal((await ctx.call("run", {})).isError, true);
      assert.equal((await ctx.call("run", { code: 5 })).isError, true);
      assert.equal(textOf(await ctx.call("run", { code: null })), 'onetool: run needs "code", a text');
      assert.equal((await ctx.call("search", { words: 5 })).isError, true);
      await ctx.call("search", {});
      await ctx.call("search", { words: "hello" });
      assert.equal(okText(await ctx.run("JSON.stringify(state)")), '{"x":1}');
    });
  });
});

describe("state: calls in progress at the same time", () => {
  // The fake's tool `barrier` answers both calls once two are waiting, so both programs have begun before either ends.
  const PROGRAM = (assign, after = "") => `${assign}; await tools.fake.barrier({}); ${after} 1`;

  test("two that set different keys both keep theirs", async () => {
    await withOnetool(FAKE(), async (ctx) => {
      const both = await Promise.all([ctx.run(PROGRAM("state.a = 1")), ctx.run(PROGRAM("state.b = 2"))]);
      assert.deepEqual(both.map(okText), ["1", "1"]);
      assert.equal(okText(await ctx.run("Object.keys(state).sort().join() + ':' + (state.a + state.b)")), "a,b:3");
    });
  });

  test("two that set the same key: the one that ends last wins, whichever began first", async () => {
    for (const [delayed, expected] of [["second", "second"], ["first", "first"]]) {
      await withOnetool(FAKE(), async (ctx) => {
        const wait = "await new Promise((resolve) => setTimeout(resolve, 400));";
        const results = await Promise.all([
          ctx.run(PROGRAM('state.k = "first"', delayed === "first" ? wait : "")),
          ctx.run(PROGRAM('state.k = "second"', delayed === "second" ? wait : "")),
        ]);
        assert.deepEqual(results.map(okText), ["1", "1"]);
        assert.equal(okText(await ctx.run("state.k")), expected);
      });
    }
  });
});

describe("state: its size", () => {
  test("it is kept up to stateLimit characters as JSON, exactly stateLimit included, and not beyond", async () => {
    await withOnetool(FAKE({ stateLimit: 1000 }), async (ctx) => {
      // {"s":"<992 x>"} is 6 + 992 + 2 = 1000 characters
      assert.equal(okText(await ctx.run('state.s = "x".repeat(992); 1')), "1");
      assert.equal(okText(await ctx.run("state.s.length")), "992");
      // {"s":"<993 x>"} is 1001 characters: the value is not answered, and nothing of the call is kept
      const over = await ctx.run('state.s = "x".repeat(993); 7');
      assert.equal(over.isError, true);
      assert.equal(textOf(over), "The program failed: state was not kept: it is 1001 characters as JSON, the limit is 1000");
      assert.equal(okText(await ctx.run("state.s.length")), "992");
    });
  });

  test("the console.log lines follow the text of a state that was not kept", async () => {
    await withOnetool(FAKE({ stateLimit: 1000 }), async (ctx) => {
      const over = await ctx.run('console.log("one"); console.log("two"); state.s = "y".repeat(993); 7');
      assert.equal(over.isError, true);
      assert.equal(
        textOf(over),
        "The program failed: state was not kept: it is 1001 characters as JSON, the limit is 1000\n--- console.log ---\none\ntwo",
      );
      assert.equal(okText(await ctx.run("typeof state.s")), "undefined");
    });
  });

  test("a program that fails keeps its own failure as the answer, and keeps nothing when its state is too big", async () => {
    await withOnetool(FAKE({ stateLimit: 1000 }), async (ctx) => {
      const failed = await ctx.run('state.big = "x".repeat(2000); throw new Error("mine")');
      assert.equal(failed.isError, true);
      assert.equal(textOf(failed), "The program failed: Error: mine");
      assert.equal(okText(await ctx.run("typeof state.big")), "undefined");
    });
  });

  test("the kept state reaches the host only when a program returns it, and the answer is cut like any other", async () => {
    await withOnetool(FAKE({ answerLimit: 1000 }), async (ctx) => {
      assert.equal(okText(await ctx.run('state.big = "x".repeat(3000); "kept"')), "kept");
      assert.equal(okText(await ctx.run("1 + 1")), "2");
      const notice = "\n[cut: the answer was 3000 characters, the limit is 1000]";
      assert.equal(okText(await ctx.run("state.big")), "x".repeat(1000 - notice.length) + notice);
    });
  });
});

describe("state: one process, one session", () => {
  test("a new process starts with {}, and nothing is written to a file", async () => {
    const cwd = tmpDir();
    const path = writeSettings(FAKE());
    const settingsFolder = path.slice(0, path.lastIndexOf("/"));
    await withOnetool(
      path,
      async (ctx) => {
        await ctx.run("state.x = 1");
        assert.equal(okText(await ctx.run("state.x")), "1");
      },
      { cwd },
    );
    assert.deepEqual(readdirSync(cwd), []);
    assert.deepEqual(readdirSync(settingsFolder), ["settings.json"]);
    await withOnetool(path, async (ctx) => {
      assert.equal(okText(await ctx.run("JSON.stringify(state)")), "{}");
    });
  });

  test("a signal when no program runs ends it as usual, with exit code 0, and the kept state goes with the process", async () => {
    await withRaw(FAKE(), async (raw) => {
      await raw.initialize();
      const res = await raw.callTool("run", { code: "state.x = 1; state.x" });
      assert.equal(res.result.content[0].text, "1");
      assert.deepEqual(await raw.endBy("SIGTERM", 5000), { code: 0, signal: null });
    });
  });
});

describe("state: the description of run", () => {
  test("it holds the word state between backquotes, and says that it is kept from one call to the next", async () => {
    await withRaw(FAKE(), async (raw) => {
      await raw.initialize();
      const { result } = await raw.request("tools/list", {});
      const run = result.tools[0];
      assert.equal(run.name, "run");
      assert.ok(run.description.includes("`state`"), run.description);
      // assumed: "kept from one call to the next" is read as one of the words kept, keeps, keep, persist, remember(s)
      assert.match(run.description, /\b(kept|keeps?|persists?|remembers?)\b/i);
      const texts = [
        run.description,
        run.inputSchema.properties.code.description,
        run.inputSchema.properties.background.description,
        run.inputSchema.properties.job.description,
        run.inputSchema.properties.stop.description,
        run.inputSchema.properties.jobs.description,
        result.tools[1].description,
        result.tools[1].inputSchema.properties.words.description,
      ];
      assert.ok(texts.join("").length < 1500, `the descriptions are ${texts.join("").length} characters`);
    });
  });
});
