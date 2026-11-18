import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LINE, fakeEntry, okText, practiceEntry, settingsOf, textOf, withOnetool, withRaw } from "./helpers.js";

const WITH_PRACTICE = (onetool = { deny: ["practice.wipe"], timeoutSeconds: 10 }) =>
  settingsOf({ practice: practiceEntry() }, onetool);

describe("what the server says of itself and of its tools", () => {
  test("it names itself onetool, with a version, and offers tools and one prompt (since step 8)", async () => {
    await withRaw(WITH_PRACTICE(), async (raw) => {
      const res = await raw.initialize();
      assert.equal(res.result.serverInfo.name, "onetool");
      assert.match(res.result.serverInfo.version, /^\d+\.\d+\.\d+/);
      assert.ok(res.result.capabilities.tools);
      assert.equal(res.result.capabilities.resources, undefined);
      // since step 8 (the meeting point of server, "The prompt `tidy-library`"): one more key, `prompts`
      assert.deepEqual(res.result.capabilities.prompts, {});
    });
  });

  test("tools/list gives exactly run and search, in this order, with the schemas of the text", async () => {
    await withRaw(WITH_PRACTICE(), async (raw) => {
      await raw.initialize();
      const { result } = await raw.request("tools/list", {});
      assert.deepEqual(result.tools.map((t) => t.name), ["run", "search"]);
      const [run, search] = result.tools;
      assert.equal(run.inputSchema.type, "object");
      // since step 6 (the meeting point of server, "The input schema of `run`"): five properties in this order, and no `required`
      assert.deepEqual(Object.keys(run.inputSchema.properties), ["code", "background", "job", "stop", "jobs"]);
      assert.equal(run.inputSchema.properties.code.type, "string");
      assert.equal(Object.hasOwn(run.inputSchema, "required"), false);
      assert.equal(search.inputSchema.type, "object");
      assert.deepEqual(Object.keys(search.inputSchema.properties), ["words"]);
      assert.equal(search.inputSchema.properties.words.type, "string");
      assert.equal(search.inputSchema.required, undefined);
    });
  });

  test("the descriptions: fixed, under 1,500 characters together, and the run one holds what the text says", async () => {
    const lists = [];
    for (const settings of [
      WITH_PRACTICE(),
      settingsOf({}),
      settingsOf({ practice: practiceEntry(), fake: fakeEntry() }, { allow: ["fake.*"] }),
    ]) {
      await withRaw(settings, async (raw) => {
        await raw.initialize();
        lists.push((await raw.request("tools/list", {})).result.tools);
      });
    }
    assert.deepEqual(lists[1], lists[0], "the same whatever the settings hold");
    assert.deepEqual(lists[2], lists[0], "the same whatever the settings hold");
    const [run, search] = lists[0];
    const texts = [
      run.description,
      run.inputSchema.properties.code.description,
      run.inputSchema.properties.background.description,
      run.inputSchema.properties.job.description,
      run.inputSchema.properties.stop.description,
      run.inputSchema.properties.jobs.description,
      search.description,
      search.inputSchema.properties.words.description,
    ];
    for (const t of texts) assert.ok(typeof t === "string" && t.length > 0, "every description is a text");
    assert.ok(texts.join("").length < 1500, `the descriptions are ${texts.join("").length} characters`);
    for (const t of texts) {
      assert.doesNotMatch(t, /practice|wipe|fake/i, "no real server and no real tool is named");
    }
    for (const needle of ["tools.<server>.<tool>(", "await", "console.log", "search"]) {
      assert.ok(run.description.includes(needle), `the description of run holds ${needle}`);
    }
    // assumed: "says that the answer is the value of the last expression" is read as the words "last expression"
    assert.match(run.description, /last expression/i);
  });

  test("a tool of another name is answered with a JSON-RPC error that holds unknown tool: <name>", async () => {
    await withRaw(WITH_PRACTICE(), async (raw) => {
      await raw.initialize();
      const res = await raw.callTool("nothing-here", {});
      assert.equal(res.result, undefined);
      assert.ok(res.error, "an error object");
      assert.ok(res.error.message.includes("unknown tool: nothing-here"), res.error.message);
    });
  });
});

describe("search", () => {
  test("with no words it counts the visible tools of each server (wipe is denied, so 4)", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      const res = await ctx.call("search", {});
      assert.notEqual(res.isError, true);
      assert.equal(textOf(res), "practice: 4 tools");
      assert.equal(textOf(await ctx.call("search", { words: "   " })), "practice: 4 tools");
      assert.equal(textOf(await ctx.client.callTool({ name: "search" })), "practice: 4 tools");
    });
  });

  test("a word shows the lines of the matching tools, highest score first", async () => {
    // "rows": practice.rows has it in its id (2), practice.count in its description (1), no other tool has it.
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", { words: "rows" })), [LINE.rows, LINE.count].join("\n"));
    });
  });

  test("a denied tool is not in the catalog that search shows", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", { words: "wipe" })), "No tool matches.");
    });
  });

  test("the limit is settings.searchLimit, and the line that says how many more match", async () => {
    // "practice" is in the id of each of the 4 visible tools: equal scores, so the order of the catalog.
    await withOnetool(WITH_PRACTICE({ deny: ["practice.wipe"], searchLimit: 2 }), async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", { words: "practice" })),
        [LINE.rows, LINE.count, "(2 more match: add a word)"].join("\n"),
      );
    });
    await withOnetool(WITH_PRACTICE({ deny: ["practice.wipe"], searchLimit: 4 }), async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", { words: "practice" })),
        [LINE.rows, LINE.count, LINE.echo, LINE.fail].join("\n"),
      );
    });
  });

  test("allow keeps only the tools that match a pattern; deny wins over allow", async () => {
    await withOnetool(WITH_PRACTICE({ allow: ["practice.rows", "practice.count"] }), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 2 tools");
      assert.equal(textOf(await ctx.call("search", { words: "practice" })), [LINE.rows, LINE.count].join("\n"));
    });
    await withOnetool(WITH_PRACTICE({ allow: ["practice.*"], deny: ["practice.echo", "practice.fail"] }), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 3 tools");
    });
  });

  test("words that are not a text: onetool: search takes \"words\", a text, as an error", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      for (const words of [5, ["rows"], { a: 1 }, true]) {
        const res = await ctx.call("search", { words });
        assert.equal(res.isError, true, JSON.stringify(words));
        assert.equal(textOf(res), 'onetool: search takes "words", a text');
      }
    });
  });

  test("other arguments are ignored", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      const res = await ctx.call("search", { words: "rows", code: "1 + 1", more: [1] });
      assert.notEqual(res.isError, true);
      assert.equal(textOf(res), [LINE.rows, LINE.count].join("\n"));
    });
  });

  test("the answer is cut to settings.answerLimit, the notice included", async () => {
    await withOnetool(WITH_PRACTICE({ deny: ["practice.wipe"], answerLimit: 100 }), async (ctx) => {
      const whole = [LINE.rows, LINE.count, LINE.echo, LINE.fail].join("\n");
      const notice = `\n[cut: the answer was ${whole.length} characters, the limit is 100]`;
      const text = textOf(await ctx.call("search", { words: "practice" }));
      assert.equal(text, whole.slice(0, 100 - notice.length) + notice);
      assert.equal(text.length, 100);
    });
  });
});

describe("run: the answer", () => {
  test("the value of the last expression, as formatRun writes it", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      assert.equal(okText(await ctx.run("1 + 1")), "2");
      assert.equal(okText(await ctx.run('"a"')), "a");
      assert.equal(okText(await ctx.run("({ a: 1, b: [true, null] })")), '{"a":1,"b":[true,null]}');
      assert.equal(okText(await ctx.run("const a = 1")), "undefined");
      assert.equal(okText(await ctx.run("")), "undefined");
    });
  });

  test("what the program printed follows the value", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      assert.equal(
        okText(await ctx.run('console.log("hi", 2); console.warn("w"); 5')),
        "5\n--- console.log ---\nhi 2\nw",
      );
    });
  });

  test("a program that throws: The program failed: <message>, with isError", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      const res = await ctx.run('throw new Error("x")');
      assert.equal(res.isError, true);
      assert.equal(textOf(res), "The program failed: Error: x");
    });
  });

  test("a program that is not JavaScript gives an error answer", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      const res = await ctx.run("let let let");
      assert.equal(res.isError, true);
      assert.ok(textOf(res).startsWith("The program failed: SyntaxError: "), textOf(res));
    });
  });

  test("a program that outlives settings.timeoutSeconds is stopped, and onetool goes on", async () => {
    await withOnetool(WITH_PRACTICE({ deny: ["practice.wipe"], timeoutSeconds: 0.5 }), async (ctx) => {
      const res = await ctx.run("while (true) {}");
      assert.equal(res.isError, true);
      assert.equal(textOf(res), "The program was stopped after 0.5 seconds.");
      assert.equal(okText(await ctx.run("1 + 1")), "2");
      assert.equal(textOf(await ctx.call("search", {})), "practice: 4 tools");
    });
  });

  test("a program that crashes its process gives an answer, and onetool goes on", async () => {
    await withOnetool(WITH_PRACTICE({ deny: ["practice.wipe"], timeoutSeconds: 30 }), async (ctx) => {
      // memoryMb is left at its default (256): a program that keeps 2 GB of numbers cannot stay in it.
      const res = await ctx.run("const keep = []; while (true) keep.push(new Array(1000000).fill(1))");
      assert.equal(res.isError, true);
      assert.ok(textOf(res).startsWith("The program's process ended before it answered ("), textOf(res));
      assert.equal(okText(await ctx.run("1 + 1")), "2");
    });
  });

  test("a call is cut to settings.answerLimit, notice included, and keeps its isError", async () => {
    await withOnetool(WITH_PRACTICE({ deny: ["practice.wipe"], answerLimit: 100 }), async (ctx) => {
      const long = await ctx.run('"x".repeat(500)');
      const notice = "\n[cut: the answer was 500 characters, the limit is 100]";
      assert.equal(okText(long), "x".repeat(100 - notice.length) + notice);

      const failed = await ctx.run('throw new Error("y".repeat(500))');
      const whole = `The program failed: Error: ${"y".repeat(500)}`;
      const failNotice = `\n[cut: the answer was ${whole.length} characters, the limit is 100]`;
      assert.equal(failed.isError, true);
      assert.equal(textOf(failed), whole.slice(0, 100 - failNotice.length) + failNotice);
    });
  });

  test("code absent or not a text: onetool: run needs \"code\", a text, as an error", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      const variants = [{}, { code: 5 }, { code: null }, { code: ["1"] }, { words: "1 + 1" }];
      for (const args of variants) {
        const res = await ctx.call("run", args);
        assert.equal(res.isError, true, JSON.stringify(args));
        assert.equal(textOf(res), 'onetool: run needs "code", a text');
      }
      const none = await ctx.client.callTool({ name: "run" });
      assert.equal(none.isError, true);
      assert.equal(textOf(none), 'onetool: run needs "code", a text');
    });
  });

  test("other arguments are ignored", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      assert.equal(okText(await ctx.call("run", { code: "1 + 1", words: 3, extra: {} })), "2");
    });
  });

  test("nothing is kept from one call to the next", async () => {
    await withOnetool(WITH_PRACTICE(), async (ctx) => {
      assert.equal(okText(await ctx.run("globalThis.kept = 7; kept")), "7");
      assert.equal(okText(await ctx.run("typeof globalThis.kept")), "undefined");
    });
  });
});
