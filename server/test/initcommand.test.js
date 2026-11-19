// Step 11, `onetool init` as a command (the meeting point of server, "The four commands", "`onetool init`: the entry, and the end", "What follows,
// and must hold", "Step 11: what every test of this part sets"): `node bin/onetool.js init ...` started as a process with `process.execPath`,
// `HOME` and the whole `PATH` folders of the test, a standard input that is no terminal. The stand-in `claude` is found, never started.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./signhelpers.js";
import { settingsOf, tmpDir, withRaw } from "./helpers.js";
import {
  ENTRY_HEAD,
  INIT_USAGE,
  PROPOSAL,
  SERVER_USAGE,
  addedLine,
  claudeEntry,
  entryValue,
  initProcess,
  madeLine,
  nobodyLine,
  put,
  settingsAt,
  splitOutput,
  standIn,
  textOfValue,
} from "./inithelpers.js";

const read = (file) => readFileSync(file, "utf8");

/** Every path under `folder`, folders and files, relative to it, sorted. */
function listing(folder, prefix = "") {
  return readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) => {
      const name = join(prefix, entry.name);
      return entry.isDirectory() ? [name, ...listing(join(folder, entry.name), name)] : [name];
    })
    .sort();
}

describe("onetool init, with no --config", () => {
  test("the settings path is <HOME>/.config/onetool/settings.json; --yes adds the server; the output is the lines, then the entry", async () => {
    const H = tmpDir();
    const stand = standIn();
    const P = join(H, ".config", "onetool", "settings.json");
    const r = await initProcess(["--yes"], { home: H, path: stand.dir });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    const { said, entry } = splitOutput(r.stdout);
    assert.deepEqual(said, [madeLine(P), ...PROPOSAL, addedLine(P), ENTRY_HEAD]);
    assert.deepEqual(entry, entryValue(P));
    assert.equal(read(P), textOfValue({ mcpServers: { claude: claudeEntry(stand.place) }, onetool: { hostServers: ["claude"] } }));
    assert.equal(statSync(P).mode & 0o777, 0o600);
  });

  test("it is a command of its own: it ends by itself with standard input left open, starts no claude, and writes only the one file", async () => {
    const H = tmpDir();
    put(join(H, ".claude", "settings.json"), { permissions: { deny: ["Bash(rm *)"] } });
    const before = read(join(H, ".claude", "settings.json"));
    const stand = standIn();
    const cwd = tmpDir();
    const r = await initProcess(["--yes"], { home: H, path: stand.dir, cwd, ms: 10000 });
    assert.equal(r.code, 0);
    assert.equal(stand.started(), false, "the stand-in claude was started");
    assert.deepEqual(listing(H), [".claude", join(".claude", "settings.json"), ".config", join(".config", "onetool"), join(".config", "onetool", "settings.json")]);
    assert.equal(read(join(H, ".claude", "settings.json")), before);
    assert.deepEqual(readdirSync(cwd), [], "nothing in the working folder");
    assert.equal(existsSync(join(H, ".onetool")), false, "no log, no library, no sign-in folder");
  });

  test("with no claude on the PATH, and nobody to ask: the line says it was not found, the file is { mcpServers: {} }", async () => {
    const H = tmpDir();
    const P = join(H, ".config", "onetool", "settings.json");
    const r = await initProcess([], { home: H, path: tmpDir() });
    assert.equal(r.code, 0);
    const { said } = splitOutput(r.stdout);
    assert.deepEqual(said, [
      madeLine(P),
      "onetool: init: the command claude was not found on this machine, Claude Code is not proposed",
      ENTRY_HEAD,
    ]);
    assert.deepEqual(JSON.parse(read(P)), { mcpServers: {} });
  });

  test("with nobody to ask (standard input is no terminal): the proposal, the line to run, nothing is added", async () => {
    const H = tmpDir();
    const stand = standIn();
    const P = join(H, ".config", "onetool", "settings.json");
    const r = await initProcess([], { home: H, path: stand.dir });
    assert.equal(r.code, 0);
    assert.deepEqual(splitOutput(r.stdout).said, [madeLine(P), ...PROPOSAL, nobodyLine(P), ENTRY_HEAD]);
    assert.equal(read(P), '{\n  "mcpServers": {}\n}\n');
    assert.equal(stand.started(), false);
  });
});

describe("the path is made a full path", () => {
  test("a relative path is resolved against the working folder, and every line names the full path", async () => {
    const cwd = tmpDir();
    const P = join(cwd, "rel", "settings.json");
    const r = await initProcess(["--config", join("rel", "settings.json"), "--no-claude"], { home: tmpDir(), path: tmpDir(), cwd });
    assert.equal(r.code, 0);
    const { said, entry } = splitOutput(r.stdout);
    assert.deepEqual(said, [madeLine(P), ENTRY_HEAD]);
    assert.deepEqual(entry.mcpServers.onetool.args.slice(-2), ["--config", P]);
    assert.equal(read(P), '{\n  "mcpServers": {}\n}\n');
  });

  test("the word after --config is the path whatever it holds: --yes is a file name here", async () => {
    const cwd = tmpDir();
    const r = await initProcess(["--config", "--yes", "--no-claude"], { home: tmpDir(), path: tmpDir(), cwd });
    assert.equal(r.code, 0);
    assert.deepEqual(splitOutput(r.stdout).said, [madeLine(join(cwd, "--yes")), ENTRY_HEAD]);
    assert.deepEqual(readdirSync(cwd), ["--yes"]);
  });
});

describe("the arguments", () => {
  const WRONG = {
    "init extra": ["extra"],
    "init --config": ["--config"],
    "init --config with an empty path": ["--config", ""],
    "--config=<path> in one word": ["--config=settings.json"],
    "--yes twice": ["--yes", "--yes"],
    "--no-claude twice": ["--no-claude", "--no-claude"],
    "--config twice": ["--config", "a.json", "--config", "b.json"],
    "another option": ["--verbose"],
  };
  for (const [what, args] of Object.entries(WRONG)) {
    test(`${what}: the usage line of init on standard error, exit code 2, no file made`, async () => {
      const H = tmpDir();
      const cwd = tmpDir();
      const r = await initProcess(args, { home: H, path: standIn().dir, cwd });
      assert.equal(r.code, 2);
      assert.equal(r.stderr, `${INIT_USAGE}\n`);
      assert.equal(r.stdout, "");
      assert.deepEqual(readdirSync(H), []);
      assert.deepEqual(readdirSync(cwd), []);
    });
  }

  test("init is a word only as the first argument: after --config it is a wrong argument of the server command, whose usage line does not change", async () => {
    for (const args of [["--config", "a.json", "init"], ["--config", "init", "x"]]) {
      const r = await runCommand(args, { home: tmpDir() });
      assert.equal(r.code, 2);
      assert.equal(r.stderr, `${SERVER_USAGE}\n`);
      assert.equal(r.stdout, "");
    }
  });
});

describe("a fault of the file, through the command", () => {
  test("a file that is not JSON: its line on standard error, exit code 1, the bytes as they were, nothing on standard output", async () => {
    const P = settingsAt("not json");
    const r = await initProcess(["--config", P, "--yes"], { home: tmpDir(), path: standIn().dir });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `onetool: init: ${P}: not JSON\n`);
    assert.equal(r.stdout, "");
    assert.equal(read(P), "not json");
  });
});

describe("the server command", () => {
  test("it names itself onetool, with the version 0.3.0 of the root package file", async () => {
    await withRaw(settingsOf({}), async (raw) => {
      const answer = await raw.initialize();
      assert.deepEqual(answer.result.serverInfo.name, "onetool");
      assert.equal(answer.result.serverInfo.version, "0.3.0");
      raw.child.stdin.end();
      assert.equal((await raw.within(5000)).code, 0);
    });
  });
});
