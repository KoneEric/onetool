import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, USAGE, ROOT, fakeEntry, practiceEntry, settingsOf, tmpDir, tmpPath, withOnetool, withRaw, writeSettings, textOf } from "./helpers.js";

/** The command run to its end, its standard input already closed. */
function runCommand(args) {
  return spawnSync(process.execPath, [BIN, ...args], { input: "", encoding: "utf8", timeout: 15000, cwd: ROOT, env: { ...process.env, HOME: tmpDir() } });
}

describe("the command line", () => {
  test("bin/onetool.js starts with #!/usr/bin/env node", () => {
    assert.equal(readFileSync(BIN, "utf8").split("\n")[0], "#!/usr/bin/env node");
  });

  const WRONG = {
    "no argument": [],
    "--config with no path": ["--config"],
    "--config twice": ["--config", "a.json", "--config", "b.json"],
    "another word after the path": ["--config", "a.json", "extra"],
    "another option after the path": ["--config", "a.json", "--verbose"],
    "an option alone": ["--verbose"],
    "a path without --config": ["a.json"],
    "--config=<path> in one word": ["--config=a.json"],
  };
  for (const [what, args] of Object.entries(WRONG)) {
    test(`${what}: usage on standard error, exit code 2`, () => {
      const r = runCommand(args);
      assert.equal(r.status, 2);
      assert.equal(r.stderr.trim(), USAGE);
      assert.equal(r.stdout, "");
    });
  }

  test("--config and a path alone: the server runs, and ends with code 0 when standard input closes", () => {
    const r = runCommand(["--config", writeSettings(settingsOf({}))]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});

describe("a settings file that readSettings refuses", () => {
  test("no file: one line, onetool: settings file not found: <path>, exit code 2", () => {
    const path = tmpPath("missing.json");
    const r = runCommand(["--config", path]);
    assert.equal(r.status, 2);
    assert.deepEqual(r.stderr.split("\n").filter(Boolean), [`onetool: settings file not found: ${path}`]);
    assert.equal(r.stdout, "");
  });

  test("a file that is not JSON: one line, and nothing of the file in it", () => {
    const r = runCommand(["--config", writeSettings("{ secret-ZZZ")]);
    assert.equal(r.status, 2);
    assert.deepEqual(r.stderr.split("\n").filter(Boolean), ["onetool: settings file is not JSON"]);
    assert.equal(r.stdout, "");
  });

  test("one line per problem, in the order of core's table", () => {
    const path = writeSettings({ mcpServers: {}, onetool: { answerLimit: 5, searchLimit: 0, bogus: 1 } });
    const r = runCommand(["--config", path]);
    assert.equal(r.status, 2);
    assert.deepEqual(r.stderr.split("\n").filter(Boolean), [
      "onetool: onetool.bogus: unknown key",
      "onetool: onetool.answerLimit: must be a whole number from 100 to 1000000",
      "onetool: onetool.searchLimit: must be a whole number from 1 to 100",
    ]);
    assert.equal(r.stdout, "");
  });

  test("no server of the file is started", () => {
    const pidFile = tmpPath("pid");
    const path = writeSettings({
      mcpServers: { fake: fakeEntry({ pidFile }) },
      onetool: { answerLimit: 5 },
    });
    const r = runCommand(["--config", path]);
    assert.equal(r.status, 2);
    assert.deepEqual(readdirSync(pidFile.slice(0, pidFile.lastIndexOf("/"))), []);
  });
});

describe("the settings file is read once", () => {
  test("a change or the removal of the file after the start changes nothing", async () => {
    await withOnetool(settingsOf({ practice: practiceEntry() }), async (ctx) => {
      assert.equal(textOf(await ctx.call("search", {})), "practice: 5 tools");
      writeFileSync(ctx.path, "not json at all");
      assert.equal(textOf(await ctx.call("search", {})), "practice: 5 tools");
      rmSync(ctx.path);
      assert.equal(textOf(await ctx.call("search", {})), "practice: 5 tools");
    });
  });
});

describe("standard output and files", () => {
  test("standard output carries MCP messages and nothing else", async () => {
    const settings = settingsOf(
      { practice: practiceEntry(), gone: { command: "/no/such/command-zzz" }, "b.ad": { command: "x" } },
      { timeoutSeconds: 10 },
    );
    await withRaw(settings, async (raw) => {
      await raw.initialize();
      await raw.request("tools/list", {});
      await raw.callTool("search", {});
      await raw.callTool("run", { code: 'console.log("out"); await tools.practice.echo({ text: "x y" })' });
      await raw.callTool("run", { code: "throw new Error('x')" });
      await raw.callTool("search", { words: 5 });
      raw.child.stdin.end();
      const { code } = await raw.within(5000);
      assert.equal(code, 0);
      assert.ok(raw.lines.length >= 6, "the answers came");
      for (const line of raw.lines) {
        const msg = JSON.parse(line);
        assert.equal(msg.jsonrpc, "2.0", line);
      }
      assert.equal(raw.unfinishedLine(), "");
    });
  });

  test("it writes no file but its log: the working folder and the settings folder hold what they held, the log is in its `logFolder`", async () => {
    const marker = `marker-${Math.random().toString(36).slice(2)}`;
    const cwd = tmpDir();
    const logs = join(tmpDir(), "logs");
    const path = writeSettings(
      settingsOf({ practice: practiceEntry(), gone: { command: "/no/such/command-zzz" } }, { timeoutSeconds: 10, logFolder: logs }),
    );
    const settingsFolder = path.slice(0, path.lastIndexOf("/"));
    await withOnetool(
      path,
      async (ctx) => {
        await ctx.call("search", {});
        await ctx.run("const r = await tools.practice.rows({}); r.rows.length");
        await ctx.run("throw new Error('x')");
        await ctx.run(`await tools.practice.echo({ text: ${JSON.stringify(marker)} })`);
      },
      { cwd },
    );
    assert.deepEqual(readdirSync(cwd), []);
    assert.deepEqual(readdirSync(settingsFolder), ["settings.json"]);
    // the log is written: one line per call, in the folder the settings name
    const lines = readdirSync(logs)
      .filter((name) => /^calls-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .flatMap((name) => readFileSync(join(logs, name), "utf8").split("\n"))
      .filter((line) => line.includes(marker));
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).id, "practice.echo");
  });
});
