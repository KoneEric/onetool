// "Step 13: Codex as a listed server, as the code is" (the meeting point of server): paper only, so these checks hold of the code as it is. They never
// start a real `codex`: the stand-in is a /bin/sh script that leaves a mark when it is started and exits 1, and `HOME` is a folder the test made.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeRecords } from "../src/record.js";
import { BIN, textOf, tmpDir } from "./helpers.js";
import { ENTRY_HEAD, INIT_USAGE, foundLine, initProcess, madeLine, settingsAt, splitOutput } from "./inithelpers.js";
import { listing, standIns } from "./ruleshelpers.js";

const CODEX_USAGE = "usage: onetool codex-server --root <project folder>\n";
const read = (file) => readFileSync(file, "utf8");

/** `node bin/onetool.js ...args` with a `HOME` and a `PATH` the test made, standard input closed at once. */
function command(args, extra = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "", timeout: 10000, env: { HOME: tmpDir(), PATH: tmpDir(), ...extra },
  });
}

describe("the command codex-server: its arguments", () => {
  test("exactly `--root` and one word: anything else is the usage line of the command, exit code 2", () => {
    const stand = standIns("codex");
    for (const args of [[], ["--root"], ["--root", "a", "b"], ["--folder", "a"], ["a", "--root"], ["--root", "a", "--root", "a"]]) {
      const r = command(["codex-server", ...args], { ONETOOL_CODEX_BIN: stand.place("codex") });
      assert.equal(r.status, 2, args.join(" "));
      assert.equal(r.stderr, CODEX_USAGE);
      assert.equal(r.stdout, "");
    }
    assert.equal(stand.started(), false);
  });

  test("a folder that is not there, or is no folder: a message on standard error, exit code 1, no Codex started", () => {
    const stand = standIns("codex");
    const file = join(tmpDir(), "plain");
    writeFileSync(file, "x");
    for (const root of [join(tmpDir(), "absent"), file]) {
      const r = command(["codex-server", "--root", root], { ONETOOL_CODEX_BIN: stand.place("codex") });
      assert.equal(r.status, 1, root);
      assert.notEqual(r.stderr.trim(), "");
      assert.equal(r.stdout, "");
    }
    assert.equal(stand.started(), false);
  });
});

describe("the command codex-server: the tools", () => {
  const withAdapter = async (fn) => {
    const stand = standIns("codex");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, "codex-server", "--root", tmpDir()],
      env: { ...getDefaultEnvironment(), HOME: tmpDir(), PATH: tmpDir(), ONETOOL_CODEX_BIN: stand.place("codex") },
      stderr: "pipe",
    });
    const client = new Client({ name: "paper-host", version: "1" }, { capabilities: {} });
    await client.connect(transport, { timeout: 10000 });
    try {
      return await fn(client, stand);
    } finally {
      await client.close().catch(() => {});
    }
  };

  test("named onetool-codex, version 1, seven tools in order, each schema refusing other keys", async () => {
    await withAdapter(async (client, stand) => {
      assert.deepEqual(client.getServerVersion(), { name: "onetool-codex", version: "1" });
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "GitHubLookup"]);
      const keys = (tool) => Object.keys(tool.inputSchema.properties).sort();
      const expected = {
        Bash: ["command"], Read: ["file_path"], Write: ["content", "file_path"],
        Edit: ["file_path", "new_string", "old_string", "replace_all"], Grep: ["glob", "path", "pattern"],
        Glob: ["path", "pattern"], GitHubLookup: ["repository_full_name"],
      };
      for (const tool of tools) {
        assert.deepEqual(keys(tool), expected[tool.name], tool.name);
        assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      }
      assert.equal(stand.started(), false, "no call: no process");
    });
  });

  test("an unknown tool and arguments the schema refuses are a result with isError and one text, never a protocol error; Codex is not started", async () => {
    await withAdapter(async (client, stand) => {
      for (const [name, args] of [["Nothing", {}], ["Bash", {}], ["Bash", { command: "ls", more: 1 }], ["Read", { file_path: 3 }], ["Glob", {}], ["GitHubLookup", { repository_full_name: "no-slash" }]]) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, name);
        assert.equal(result.content.length, 1);
        assert.equal(result.content[0].type, "text");
        assert.notEqual(textOf(result), "");
      }
      assert.equal(stand.started(), false);
    });
  });
});

describe("onetool init --codex <folder>", () => {
  const world = () => {
    const stand = standIns("codex", "claude");
    return { stand, home: tmpDir(), folder: tmpDir() };
  };
  const entryOf = (folder, place) => ({
    command: process.execPath, args: [BIN, "codex-server", "--root", folder], env: { ONETOOL_CODEX_BIN: place },
  });

  test("--codex wants one word after it: none, an empty word, a word that starts with --, or --codex twice, is the usage line", async () => {
    const { stand, home, folder } = world();
    const S = join(tmpDir(), "settings.json");
    for (const args of [["--codex"], ["--codex", ""], ["--codex", "--yes"], ["--codex", folder, "--codex", folder]]) {
      const r = await initProcess(["--config", S, ...args], { home, path: stand.dir });
      assert.equal(r.code, 2, args.join(" "));
      assert.equal(r.stderr, `${INIT_USAGE}\n`);
      assert.equal(r.stdout, "");
    }
    assert.deepEqual(listing(home), []);
    assert.deepEqual(listing(join(S, "..")), []);
  });

  test("a folder that is not there, then no codex on the PATH: one line each, exit code 1, nothing made", async () => {
    const { stand, home, folder } = world();
    const S = join(tmpDir(), "settings.json");
    const absent = join(tmpDir(), "absent");
    const first = await initProcess(["--config", S, "--codex", absent, "--no-rules"], { home, path: stand.dir });
    assert.equal(first.code, 1);
    assert.equal(first.stderr, `onetool: init: ${S}: Codex project folder does not exist\n`);
    assert.equal(first.stdout, "");
    const second = await initProcess(["--config", S, "--codex", folder, "--no-rules"], { home, path: tmpDir() });
    assert.equal(second.code, 1);
    assert.equal(second.stderr, `onetool: init: ${S}: codex was not found on PATH\n`);
    assert.equal(second.stdout, "");
    // the folder is tested first
    const both = await initProcess(["--config", S, "--codex", absent, "--no-rules"], { home, path: tmpDir() });
    assert.equal(both.stderr, `onetool: init: ${S}: Codex project folder does not exist\n`);
    assert.deepEqual(listing(join(S, "..")), []);
    assert.deepEqual(listing(home), []);
  });

  test("the server codex is added last, with the entry of the section, one line says so, the entry of onetool is this checkout", async () => {
    const { stand, home, folder } = world();
    const S = settingsAt({ mcpServers: { claude: { command: "mine" }, other: { command: "x" } }, onetool: { log: false, hostServers: ["claude"] } });
    const r = await initProcess(["--config", S, "--codex", folder, "--no-rules"], { home, path: stand.dir });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    const { said, entry } = splitOutput(r.stdout);
    assert.deepEqual(said, [foundLine(S), `onetool: init: added Codex for ${folder}`, ENTRY_HEAD]);
    assert.deepEqual(entry, { mcpServers: { onetool: { command: process.execPath, args: [BIN, "--config", S] } } });
    const file = JSON.parse(read(S));
    assert.deepEqual(Object.keys(file.mcpServers), ["claude", "other", "codex"]);
    assert.deepEqual(file.mcpServers.codex, entryOf(folder, stand.place("codex")));
    assert.deepEqual(file.mcpServers.claude, { command: "mine" });
    assert.deepEqual(file.onetool, { log: false, hostServers: ["claude"] }, "nothing added to hostServers, no key tools");
    assert.equal(Object.hasOwn(file.mcpServers.codex, "tools"), false);
    assert.equal(stand.started(), false);
  });

  test("the file is made when it is not there; Claude Code is not proposed, with or without --yes", async () => {
    const { stand, home, folder } = world();
    for (const args of [[], ["--yes"], ["--yes", "--no-claude"]]) {
      const S = join(tmpDir(), "settings.json");
      const r = await initProcess(["--config", S, "--codex", folder, "--no-rules", ...args], { home, path: stand.dir });
      assert.equal(r.code, 0);
      assert.deepEqual(splitOutput(r.stdout).said, [madeLine(S), `onetool: init: added Codex for ${folder}`, ENTRY_HEAD]);
      assert.deepEqual(JSON.parse(read(S)), { mcpServers: { codex: entryOf(folder, stand.place("codex")) } });
    }
  });

  test("a key that is exactly codex is kept, whatever it holds: one line, the bytes as they were; a second run leaves the bytes", async () => {
    const { stand, home, folder } = world();
    const S = settingsAt({ mcpServers: { codex: { command: "mine" } } });
    const before = read(S);
    const r = await initProcess(["--config", S, "--codex", folder, "--no-rules"], { home, path: stand.dir });
    assert.deepEqual(splitOutput(r.stdout).said, [
      foundLine(S), "onetool: init: kept the existing codex entry. To change its project, edit its --root argument.", ENTRY_HEAD,
    ]);
    assert.equal(read(S), before);

    const T = join(tmpDir(), "settings.json");
    await initProcess(["--config", T, "--codex", folder, "--no-rules"], { home, path: stand.dir });
    const once = read(T);
    await initProcess(["--config", T, "--codex", folder, "--no-rules"], { home, path: stand.dir });
    assert.equal(read(T), once);
  });
});

describe("the log of a write or an edit through the adapter", () => {
  const record = (entry, tool, args) => makeRecords({ log: false, servers: [entry] }).program().begin(entry.name, tool, args).args;

  test("a server is an adapter by the second and third items of its args, whatever its name and its first item", () => {
    const entry = { name: "another-name", args: ["anything", "codex-server", "--root", "/data/project"] };
    assert.deepEqual(record(entry, "Write", { file_path: "notes.txt", content: "first" }), { path: "notes.txt", size: 5 });
    assert.deepEqual(record(entry, "Edit", { file_path: "notes.txt", old_string: "first", new_string: "second" }), { path: "notes.txt", oldSize: 5, newSize: 6 });
  });

  test("any other tool of an adapter is recorded with its arguments as given", () => {
    const entry = { name: "coding", args: [BIN, "codex-server", "--root", "/data/project"] };
    for (const [tool, args] of [["Read", { file_path: "notes.txt" }], ["Bash", { command: "ls" }], ["Grep", { pattern: "x", glob: "*.js" }]]) {
      assert.deepEqual(record(entry, tool, args), args, tool);
    }
  });

  test("a server whose args are not those of an adapter keeps the arguments of a Write as given, text included", () => {
    for (const args of [[BIN, "codex-server", "--other", "/data/project"], ["codex-server", "--root", "/data/project"], [BIN, "other", "--root", "/data/project"]]) {
      const entry = { name: "coding", args };
      assert.deepEqual(record(entry, "Write", { file_path: "notes.txt", content: "first" }), { file_path: "notes.txt", content: "first" }, args.join(" "));
    }
  });
});
