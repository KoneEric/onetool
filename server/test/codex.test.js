import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { makeRecords } from "../src/record.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BIN, ROOT, textOf, tmpDir } from "./helpers.js";

test("Codex file edits require an unambiguous literal match and stay inside the project", () => {
  const dir = tmpDir();
  const path = join(dir, "target");
  const helper = join(ROOT, "server/src/codex/file.js");
  const edit = (args) => spawnSync(process.execPath, [helper, "Edit", JSON.stringify({
    file_path: "target", old_string: "cat", new_string: "$&", ...args,
  })], { cwd: dir, encoding: "utf8" });
  writeFileSync(path, "cat cat");
  assert.match(edit({}).stderr, /more than once/);
  assert.match(edit({ old_string: "absent" }).stderr, /not found/);
  assert.equal(readFileSync(path, "utf8"), "cat cat");
  assert.equal(edit({ replace_all: true }).status, 0);
  assert.equal(readFileSync(path, "utf8"), "$& $&");
  const outside = join(tmpDir(), "other");
  writeFileSync(outside, "cat");
  symlinkSync(outside, join(dir, "link"));
  assert.notEqual(edit({ file_path: "link" }).status, 0);
  assert.notEqual(edit({ file_path: outside }).status, 0);
  assert.equal(readFileSync(outside, "utf8"), "cat");
});

test("Codex writes and edits keep file contents out of the call log, including under a custom server name", () => {
  const records = makeRecords({ log: false, servers: [{ name: "coding", args: [BIN, "codex-server", "--root", "/project"] }] }).program();
  assert.deepEqual(records.begin("coding", "Write", { file_path: "notes.txt", content: "first" }).args,
    { path: "notes.txt", size: 5 });
  assert.deepEqual(records.begin("coding", "Edit", { file_path: "notes.txt", old_string: "first", new_string: "second" }).args,
    { path: "notes.txt", oldSize: 5, newSize: 6 });
});

test("Codex setup preserves existing servers and repeat setup preserves the chosen entry", () => {
  const dir = tmpDir();
  const path = join(dir, "config.json");
  writeFileSync(join(dir, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const original = { command: "original" };
  writeFileSync(path, JSON.stringify({ mcpServers: { claude: original } }));
  const setup = () => execFileSync(process.execPath, [BIN, "init", "--config", path, "--codex", dir], { env: { ...process.env, PATH: dir } });
  setup();
  const contents = readFileSync(path, "utf8");
  const { mcpServers } = JSON.parse(contents);
  assert.deepEqual(mcpServers.claude, original);
  assert.deepEqual(mcpServers.codex.args, [BIN, "codex-server", "--root", dir]);
  assert.equal(mcpServers.codex.env.ONETOOL_CODEX_BIN, join(dir, "codex"));
  setup();
  assert.equal(readFileSync(path, "utf8"), contents);
});

test("live Codex through onetool: six tools and GitHub repository lookup", { skip: process.env.ONETOOL_LIVE_CODEX !== "1", timeout: 120_000 }, async () => {
  const root = tmpDir(), path = join(tmpDir(), "settings.json");
  writeFileSync(path, JSON.stringify({ mcpServers: {}, onetool: { log: false, trail: false } }));
  execFileSync(process.execPath, [BIN, "init", "--config", path, "--codex", root]);
  const client = new Client({ name: "onetool-live-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "--config", path], stderr: "inherit" });
  try {
    await client.connect(transport);
    const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 65_000 });
    assert.match(textOf(await call("search", {})), /codex: 7 tools/);
    const run = async (code) => {
      const result = await call("run", { code });
      const answer = textOf(result);
      assert.notEqual(result.isError, true, answer);
      return answer;
    };
    const local = await run(`
      const c = tools.codex;
      await c.Write({file_path:"note.txt",content:"one token"});
      const before = (await c.Read({file_path:"note.txt"})).content;
      await c.Edit({file_path:"note.txt",old_string:"one",new_string:"two"});
      const grep = await c.Grep({pattern:"two token"});
      const glob = await c.Glob({pattern:"*.txt"});
      const bash = await c.Bash({command:"printf onetool-ok"});
      ({before, grep:grep.stdout, glob:glob.stdout, bash:bash.stdout, exit:bash.exitCode})
    `);
    const result = JSON.parse(local);
    assert.equal(result.before, "one token");
    assert.equal(readFileSync(join(root, "note.txt"), "utf8"), "two token");
    assert.match(result.grep, /note\.txt:1:two token/);
    assert.match(result.glob, /note\.txt/);
    assert.equal(result.bash, "onetool-ok");
    assert.equal(result.exit, 0);
    const github = await run('await tools.codex.GitHubLookup({repository_full_name:"KoneEric/onetool"})');
    assert.match(github, /KoneEric\/onetool/i);
    assert.match(github, /github\.com\/KoneEric\/onetool/i);
  } finally {
    await client.close();
  }
});
