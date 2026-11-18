import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  alive,
  fakeEntry,
  okText,
  practiceEntry,
  serverLines,
  settingsOf,
  textOf,
  tmpDir,
  tmpPath,
  waitFor,
  withOnetool,
  withRaw,
} from "./helpers.js";

// Texts that stand for the command, an argument, an environment value and the text of a server's error: none of
// them may reach an answer or standard error.
const SECRET_CMD = "/no/such/command-ZZZcmd";
const SECRET_ARG = "--arg-ZZZarg";
const SECRET_ENV = "env-ZZZenv";
const SECRET_ERR = "error-ZZZerr";

function noSecret(text) {
  assert.doesNotMatch(text, /ZZZ/);
}

describe("the start", () => {
  test("it answers initialize and tools/list at once, without waiting for the listed servers", async () => {
    // The server that never lists is given up only after 20 seconds; the raw request waits at most 10.
    const settings = settingsOf(
      { hang: fakeEntry({ listHang: true }), "b.ad": { command: "x" } },
      { connectSeconds: 20 },
    );
    await withRaw(settings, async (raw) => {
      await raw.initialize();
      const { result } = await raw.request("tools/list", {});
      assert.deepEqual(result.tools.map((t) => t.name), ["run", "search"]);
      // the entries of settings.bad are reported before any connection is tried, so while this one is pending
      await waitFor(() => serverLines({ stderrLines: raw.stderrLines }).length > 0, 3000, "the line of the bad entry");
      assert.deepEqual(serverLines({ stderrLines: raw.stderrLines }), [
        "onetool: server b.ad: not connected (bad entry: the name holds a dot)",
      ]);
      raw.child.stdin.end();
      const ended = await raw.within(5000);
      assert.equal(ended.code, 0);
    });
  });

  test("a call that arrives before a server is connected waits for it", async () => {
    const settings = settingsOf({ slow: fakeEntry({ tools: ["hello"], listDelayMs: 600 }) }, { timeoutSeconds: 10 });
    await withOnetool(settings, async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "slow: 1 tools");
    });
    await withOnetool(settings, async (ctx) => {
      assert.equal(okText(await ctx.run("typeof tools.slow.hello")), "function");
    });
  });

  test("a call waits for a server that is given up too: connectSeconds, then the reason", async () => {
    const settings = settingsOf(
      { hang: fakeEntry({ listHang: true }), hang2: fakeEntry({ initHang: true }) },
      { connectSeconds: 0.5 },
    );
    await withOnetool(settings, async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", {})),
        "hang: not connected (no answer in 0.5 seconds)\nhang2: not connected (no answer in 0.5 seconds)",
      );
      assert.deepEqual(
        serverLines(ctx).sort(),
        [
          "onetool: server hang2: not connected (no answer in 0.5 seconds)",
          "onetool: server hang: not connected (no answer in 0.5 seconds)",
        ],
      );
    });
  });

  test("a server that gave no answer in time has its process ended", async () => {
    const pidFile = tmpPath("pid");
    const settings = settingsOf({ hang: fakeEntry({ listHang: true, pidFile }) }, { connectSeconds: 0.5 });
    await withOnetool(settings, async (ctx) => {
      await ctx.call("search", {});
      const pid = Number(await waitFor(() => existsSync(pidFile) && readFileSync(pidFile, "utf8"), 3000, "its pid"));
      await waitFor(() => !alive(pid), 3000, "the process to end");
    });
  });

  test("every server is connected at the same time", async () => {
    const logs = [tmpPath("a"), tmpPath("b"), tmpPath("c")];
    const settings = settingsOf(
      Object.fromEntries(logs.map((startLog, i) => [`s${i}`, fakeEntry({ tools: ["hello"], listDelayMs: 1500, startLog })])),
    );
    await withOnetool(settings, async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "s0: 1 tools\ns1: 1 tools\ns2: 1 tools");
    });
    // One after the other, the second would start 1.5 seconds after the first.
    const starts = logs.map((file) => Number(readFileSync(file, "utf8").trim()));
    assert.ok(Math.max(...starts) - Math.min(...starts) < 1000, `starts spread over ${Math.max(...starts) - Math.min(...starts)} ms`);
  });

  test("the list of tools is followed through its pages, in order", async () => {
    const tools = ["p1", "p2", "p3", "p4", "p5"];
    const settings = settingsOf({ fake: fakeEntry({ tools, pageSize: 2 }) });
    await withOnetool(settings, async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "fake: 5 tools");
      // "fake" is in the id of each tool: equal scores, so the order the server listed them in
      assert.equal(
        textOf(await ctx.call("search", { words: "fake" })),
        tools.map((t) => `fake.${t}() - The ${t} tool.`).join("\n"),
      );
      assert.equal(okText(await ctx.run("typeof tools.fake.p5")), "function");
    });
  });
});

describe("the process of a listed server", () => {
  test("it gets the default environment with the entry's env on top, and nothing of onetool's own; it starts in onetool's folder", async () => {
    const cwd = tmpDir();
    const entryEnv = { HOME: "/nowhere-ZZ", KEY: "value", EMPTY: "" };
    const odd = ["--odd arg", "", "x  y"];
    const entry = fakeEntry({ tools: ["env"] }, { env: entryEnv, args: odd });
    await withOnetool(
      settingsOf({ fake: entry }, { timeoutSeconds: 10 }),
      async (ctx) => {
        const seen = JSON.parse(okText(await ctx.run("await tools.fake.env({})")));
        // macOS itself adds this one to every process it starts
        delete seen.env.__CF_USER_TEXT_ENCODING;
        assert.deepEqual(seen.env, { ...getDefaultEnvironment(), ...entry.env });
        assert.equal(seen.env.HOME, "/nowhere-ZZ");
        assert.equal(seen.env.ONETOOL_LEAK, undefined);
        assert.deepEqual(seen.argv, odd);
        assert.equal(realpathSync(seen.cwd), realpathSync(cwd));
      },
      { cwd, env: { ONETOOL_LEAK: "leak" } },
    );
  });

  test("the tools of a server are listed as a catalog entry whose tools keep their order", async () => {
    const tools = [
      { name: "second-listed", description: "B.", inputSchema: { type: "object", properties: {} } },
      { name: "first-alphabet", description: "A.", inputSchema: { type: "object", properties: {} } },
    ];
    await withOnetool(settingsOf({ fake: fakeEntry({ tools }) }), async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", { words: "fake" })),
        "fake.second-listed() - B.\nfake.first-alphabet() - A.",
      );
    });
  });
});

describe("a server that is not connected", () => {
  const settingsWithFailures = () =>
    settingsOf(
      {
        gone: { command: SECRET_CMD, args: [SECRET_ARG], env: { TOKEN: SECRET_ENV } },
        early: fakeEntry({ exitAtStart: true }, { args: [SECRET_ARG], env: { TOKEN: SECRET_ENV } }),
        early2: fakeEntry({ exitOnList: true }),
        refused: fakeEntry({ initError: true, errorText: SECRET_ERR }),
        refused2: fakeEntry({ listError: true, errorText: SECRET_ERR }),
        ok: fakeEntry({ tools: ["hello"] }),
      },
      { timeoutSeconds: 10 },
    );

  test("each one is in the catalog with its reason, and each has its line on standard error", async () => {
    await withOnetool(settingsWithFailures(), async (ctx) => {
      const expected = [
        "gone: not connected (could not start)",
        "early: not connected (could not start)",
        "early2: not connected (could not start)",
        "refused: not connected (refused the connection)",
        "refused2: not connected (refused the connection)",
        "ok: 1 tools",
      ];
      const answer = textOf(await ctx.call("search", {}));
      assert.equal(answer, expected.join("\n"));
      const lines = expected.slice(0, 5).map((l) => `onetool: server ${l}`);
      await waitFor(() => serverLines(ctx).length >= 5, 3000, "the five lines");
      // their order among themselves is open
      assert.deepEqual(serverLines(ctx).sort(), [...lines].sort());
      noSecret(answer);
      noSecret(ctx.stderr());
    });
  });

  test("the others and onetool go on", async () => {
    await withOnetool(settingsWithFailures(), async (ctx) => {
      assert.equal(okText(await ctx.run("await tools.ok.hello({})")), "called hello");
      assert.equal(textOf(await ctx.call("search", { words: "hello" })), "ok.hello() - The hello tool.");
    });
  });

  test("even when it is every server", async () => {
    const settings = settingsOf({ gone: { command: SECRET_CMD }, early: fakeEntry({ exitAtStart: true }) });
    await withOnetool(settings, async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", {})),
        "gone: not connected (could not start)\nearly: not connected (could not start)",
      );
      assert.equal(textOf(await ctx.call("search", { words: "x" })), "No tool matches.");
      assert.equal(okText(await ctx.run("1 + 1")), "2");
    });
  });

  test("no server is listed", async () => {
    await withOnetool(settingsOf({}), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "No server is listed.");
      assert.equal(okText(await ctx.run("1 + 1")), "2");
    });
  });

  test("the entries of settings.bad come first on standard error, in order, then the catalog lists them after the servers", async () => {
    const settings = settingsOf({
      "b.ad": { command: "x" },
      gone: { command: SECRET_CMD },
      nocmd: {},
      ok: fakeEntry({ tools: ["hello"] }),
    });
    await withOnetool(settings, async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", {})),
        [
          "gone: not connected (could not start)",
          "ok: 1 tools",
          "b.ad: not connected (bad entry: the name holds a dot)",
          "nocmd: not connected (bad entry: no command)",
        ].join("\n"),
      );
      await waitFor(() => serverLines(ctx).length >= 3, 3000, "the three lines");
      assert.deepEqual(serverLines(ctx), [
        "onetool: server b.ad: not connected (bad entry: the name holds a dot)",
        "onetool: server nocmd: not connected (bad entry: no command)",
        "onetool: server gone: not connected (could not start)",
      ]);
    });
  });
});

describe("no value of the settings file", () => {
  test("none reaches an answer or standard error", async () => {
    const settings = settingsOf(
      {
        fake: fakeEntry({}, { args: [SECRET_ARG], env: { TOKEN: SECRET_ENV } }),
        gone: { command: SECRET_CMD, args: [SECRET_ARG], env: { TOKEN: SECRET_ENV } },
      },
      { timeoutSeconds: 10, deny: ["fake.rec", "fake.die"] },
    );
    await withOnetool(settings, async (ctx) => {
      const texts = [
        textOf(await ctx.call("search", {})),
        textOf(await ctx.call("search", { words: "rec" })),
        textOf(await ctx.run("1 + 1")),
        textOf(await ctx.run("await tools.fake.rec({})")),
        textOf(await ctx.run("await tools.gone.anything({})")),
        textOf(await ctx.run("await tools.fake.toolerr({})")),
      ];
      for (const t of texts) noSecret(t);
      noSecret(ctx.stderr());
    });
  });
});
