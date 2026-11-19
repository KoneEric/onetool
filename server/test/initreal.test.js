// Step 11, through the real thing, points 1 to 9 (the meeting point of server, "Step 11, through the real thing"). Nothing is replaced: the real command
// started as a process with `process.execPath`, standard input no terminal, a folder `H` as `HOME` and a folder `B` as the whole `PATH`, in `B` the
// stand-in `claude` (a /bin/sh script that starts a fixture server of eight tools, which refuses to start unless its arguments are `mcp serve`), in
// `H` the settings file of the host program with one deny rule. Point 10 (`redirectHost`) is in initredirect.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSettings } from "../../core/src/index.js";
import { PRACTICE, tmpDir } from "./helpers.js";
import {
  ENTRY_HEAD,
  INIT_USAGE,
  NOT_FOUND_LINE,
  PROPOSAL,
  SIX,
  addedLine,
  alreadyLine,
  entryValue,
  foundLine,
  initProcess,
  madeLine,
  nobodyLine,
  put,
  settingsAt,
  splitOutput,
  standIn,
  withHost,
} from "./inithelpers.js";

const read = (file) => readFileSync(file, "utf8");
const FILE_OF_HOST = { permissions: { deny: ["Bash(rm *)"] } };

function world() {
  const H = tmpDir();
  put(join(H, ".claude", "settings.json"), FILE_OF_HOST);
  const stand = standIn();
  return { H, B: stand.dir, stand, P: join(H, ".config", "onetool", "settings.json"), hostFile: join(H, ".claude", "settings.json") };
}

test("1, 2 and 3: init --yes with no --config, then the server command on a copy of the file, and the rule of the host program", async () => {
  const { H, B, stand, P, hostFile } = world();

  // 1.
  const first = await initProcess(["--yes"], { home: H, path: B });
  assert.equal(first.code, 0);
  assert.equal(first.stderr, "");
  const { said, entry } = splitOutput(first.stdout);
  assert.deepEqual(said, [madeLine(P), ...PROPOSAL, addedLine(P), ENTRY_HEAD]);
  assert.deepEqual(entry, entryValue(P));
  assert.equal(entry.mcpServers.onetool.args.at(-1), P);
  assert.equal(statSync(P).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(read(P)), {
    mcpServers: { claude: { command: join(B, "claude"), args: ["mcp", "serve"], tools: SIX } },
    onetool: { hostServers: ["claude"] },
  });
  const settings = readSettings(P);
  assert.deepEqual(settings.bad, []);
  assert.equal(stand.started(), false, "init did not start the stand-in");

  // 2.
  const copy = settingsAt({ ...JSON.parse(read(P)), onetool: { ...JSON.parse(read(P)).onetool, log: false } });
  const root = tmpDir();
  await withHost(copy, { home: H, path: B, root, name: "claude-code" }, async (host) => {
    assert.deepEqual(await host.tools(), ["run", "search"]);
    assert.equal(await host.search(), "claude: 6 tools");
    const grep = await host.search("Grep");
    assert.ok(grep.split("\n").some((line) => line.startsWith("claude.Grep(")), grep);
    assert.ok(!(await host.search("Agent")).includes("claude.Agent"));
    const ran = await host.run('await tools.claude.Grep({ pattern: "x" })');
    assert.equal(ran.isError, false, ran.text);
    assert.equal(ran.lines[0], "Grep ran");
    const types = await host.run("[typeof tools.claude.Bash, typeof tools.claude.Agent].join(' ')");
    assert.equal(types.lines[0], "function undefined");
    assert.equal(stand.started(), true, "the stand-in was started by the server command");

    // 3.
    const denied = await host.run('await tools.claude.Bash({ command: "rm x" })');
    assert.equal(denied.isError, true);
    assert.equal(
      denied.lines[0],
      `The program failed: Error: onetool: claude.Bash is denied by the rule deny "Bash(rm *)" of the host program (${hostFile})`,
    );
  });
});

test("4: init --config on a path with nothing at it, no --yes: the proposal, the line to run, the file is { mcpServers: {} }", async () => {
  const { H, B, stand } = world();
  const S2 = join(tmpDir(), "settings.json");
  const r = await initProcess(["--config", S2], { home: H, path: B });
  assert.equal(r.code, 0);
  assert.deepEqual(splitOutput(r.stdout).said, [madeLine(S2), ...PROPOSAL, nobodyLine(S2), ENTRY_HEAD]);
  assert.deepEqual(JSON.parse(read(S2)), { mcpServers: {} });
  assert.equal(stand.started(), false);
});

describe("5 and 6: init --yes on a file that holds a server, then a second time", () => {
  const OLD = (command) => ({
    mcpServers: { practice: { command, args: [PRACTICE] } },
    onetool: { deny: ["practice.wipe"], log: false },
  });

  test("the keys keep their order, the server is added last, the server command offers both, and a second init changes nothing", async () => {
    const { H, B } = world();
    const S3 = settingsAt(OLD(process.execPath));
    const r = await initProcess(["--config", S3, "--yes"], { home: H, path: B });
    assert.equal(r.code, 0, r.stderr);
    const after = JSON.parse(read(S3));
    assert.deepEqual(Object.keys(after.mcpServers), ["practice", "claude"]);
    assert.deepEqual(after.mcpServers.practice, OLD(process.execPath).mcpServers.practice);
    assert.deepEqual(after.onetool.deny, ["practice.wipe"]);
    assert.equal(after.onetool.log, false);
    assert.deepEqual(Object.keys(after.onetool), ["deny", "log", "hostServers"]);

    await withHost(S3, { home: H, path: B, root: tmpDir() }, async (host) => {
      assert.equal(await host.search(), "practice: 4 tools\nclaude: 6 tools");
      const count = await host.run('(await tools.practice.count({ city: "Lyon" })).count');
      assert.equal(count.lines[0], "625");
    });

    // 6.
    const bytes = read(S3);
    const second = await initProcess(["--config", S3, "--yes"], { home: H, path: B });
    assert.equal(second.code, 0);
    assert.equal(read(S3), bytes);
    const { said, entry } = splitOutput(second.stdout);
    assert.deepEqual(said, [foundLine(S3), alreadyLine(S3, "claude"), ENTRY_HEAD]);
    assert.deepEqual(entry, entryValue(S3));
    for (const line of PROPOSAL) assert.ok(!second.stdout.includes(line));
  });
});

test("7: with PATH set to an empty folder: exit 0, the line that claude was not found, the file is { mcpServers: {} }", async () => {
  const { H } = world();
  const S4 = join(tmpDir(), "settings.json");
  const r = await initProcess(["--config", S4, "--yes"], { home: H, path: tmpDir() });
  assert.equal(r.code, 0);
  assert.deepEqual(splitOutput(r.stdout).said, [madeLine(S4), NOT_FOUND_LINE, ENTRY_HEAD]);
  assert.deepEqual(JSON.parse(read(S4)), { mcpServers: {} });
});

test("8: --no-claude with the stand-in in PATH: the file is { mcpServers: {} } and no line of standard output holds Claude Code", async () => {
  const { H, B, stand } = world();
  const S5 = join(tmpDir(), "settings.json");
  const r = await initProcess(["--config", S5, "--no-claude"], { home: H, path: B });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(read(S5)), { mcpServers: {} });
  assert.ok(!r.stdout.split("\n").some((line) => line.includes("Claude Code")), r.stdout);
  assert.equal(stand.started(), false);
});

describe("9: the usage line, and a file that is not JSON", () => {
  test("init --config (no path) and init extra: the usage line of init on standard error, exit code 2, no file made", async () => {
    const { H, B } = world();
    const before = existsSync(join(H, ".config"));
    for (const args of [["--config"], ["extra"]]) {
      const r = await initProcess(args, { home: H, path: B });
      assert.equal(r.code, 2);
      assert.equal(r.stderr, `${INIT_USAGE}\n`);
      assert.equal(r.stdout, "");
    }
    assert.equal(existsSync(join(H, ".config")), before);
  });

  test("init --config <S6> on a file whose text is not json: its line, exit code 1, the bytes as they were", async () => {
    const { H, B } = world();
    const S6 = settingsAt("not json");
    const r = await initProcess(["--config", S6], { home: H, path: B });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `onetool: init: ${S6}: not JSON\n`);
    assert.equal(read(S6), "not json");
  });
});
