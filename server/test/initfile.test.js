// Step 11, `runInit` (the meeting point of server, "The four commands", "`runInit`", "`onetool init`: the file", "What a write is"):
// the arguments, the settings path, the file that is made, the faults, and what a write keeps. `runInit` is called in the test with
// a `home` and a `pathText` of folders the test made; the question is never asked of anybody.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsError, readSettings } from "../../core/src/index.js";
import { tmpDir } from "./helpers.js";
import {
  INIT_USAGE,
  addedEmptyLine,
  claudeEntry,
  faultLine,
  foundLine,
  madeLine,
  runIn,
  settingsAt,
  standIn,
  textOfValue,
  wholeOut,
  PROPOSAL,
  addedLine,
  nobodyLine,
} from "./inithelpers.js";

const read = (file) => readFileSync(file, "utf8");
const MODE = (file) => statSync(file).mode & 0o777;
const EMPTY_FILE = '{\n  "mcpServers": {}\n}\n';

describe("the arguments", () => {
  const WRONG = (P) => ({
    "another word": ["extra"],
    "the word init again": ["init"],
    "a word after the options": ["--config", P, "extra"],
    "another option": ["--config", P, "--verbose"],
    "--config with no word after it": ["--config"],
    "--config with no word after it, after another option": ["--yes", "--config"],
    "--config with an empty word": ["--config", ""],
    "--config=<path> in one word": [`--config=${P}`],
    "--config twice": ["--config", P, "--config", P],
    "--yes twice": ["--yes", "--yes", "--config", P],
    "--no-claude twice": ["--config", P, "--no-claude", "--no-claude"],
    "an option in another case": ["--config", P, "--Yes"],
  });

  for (const what of Object.keys(WRONG("/absolute/path/to/settings.json"))) {
    test(`${what}: the usage line of init on the error output, exit code 2, nothing read or written`, async () => {
      const home = tmpDir();
      const P = join(tmpDir(), "settings.json");
      const stand = standIn();
      const r = await runIn(WRONG(P)[what], { home, pathText: stand.dir });
      assert.equal(r.code, 2);
      assert.deepEqual(r.err, [INIT_USAGE]);
      assert.deepEqual(r.out, []);
      assert.equal(existsSync(P), false);
      assert.deepEqual(readdirSync(home), [], "the default settings path was not made either");
      assert.equal(stand.started(), false);
    });
  }

  test("the options come in any order, and --yes with --no-claude together are valid: nothing is proposed", async () => {
    const stand = standIn();
    for (const order of [
      (P) => ["--yes", "--no-claude", "--no-rules", "--config", P],
      (P) => ["--no-claude", "--no-rules", "--config", P, "--yes"],
      (P) => ["--config", P, "--no-claude", "--yes", "--no-rules"],
    ]) {
      const P = join(tmpDir(), "settings.json");
      const r = await runIn(order(P), { home: tmpDir(), pathText: stand.dir });
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([madeLine(P)], P));
      assert.equal(read(P), EMPTY_FILE);
    }
  });

  test("the word after --config is the path whatever it holds: a leading --, the word --yes", async () => {
    const dir = tmpDir();
    const P = join(dir, "--yes");
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.out[0], madeLine(P));
    assert.equal(read(P), EMPTY_FILE);
  });
});

describe("the settings path", () => {
  test("with no --config it is <home>/.config/onetool/settings.json, and the folders it lacks are made", async () => {
    const home = tmpDir();
    const P = join(home, ".config", "onetool", "settings.json");
    const r = await runIn(["--no-claude"], { home });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P)], P));
    assert.equal(read(P), EMPTY_FILE);
    assert.deepEqual(readdirSync(home), [".config"]);
  });

  test("with --config the path is made a full path (path.resolve), and every line names it", async () => {
    const dir = tmpDir();
    const P = join(dir, "a", "b", "c", "settings.json");
    const r = await runIn(["--config", join(dir, "a", "..", "a", "b", "c", "settings.json"), "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P)], P));
  });
});

describe("nothing at the path: the file is made", () => {
  test("the text is exactly the two-space JSON of { mcpServers: {} } and one line break, and the line is made", async () => {
    const P = join(tmpDir(), "settings.json");
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(read(P), '{\n  "mcpServers": {}\n}\n');
    assert.deepEqual(r.err, []);
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P)], P));
  });

  test("its mode is 600 exactly, whatever the umask", async () => {
    for (const mask of [0o000, 0o022, 0o077]) {
      const before = process.umask(mask);
      try {
        const P = join(tmpDir(), "deep", "er", "settings.json");
        const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
        assert.equal(r.code, 0);
        assert.equal(MODE(P).toString(8), "600", `umask ${mask.toString(8)}`);
      } finally {
        process.umask(before);
      }
    }
  });

  test("a folder that is in the way of the path: the path is not there, the folders are made", async () => {
    const dir = tmpDir();
    const P = join(dir, "missing", "settings.json");
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.out[0], madeLine(P));
    assert.ok(statSync(join(dir, "missing")).isDirectory());
  });

  test("a write that fails (the folder cannot be made): the line cannot be written on the error output, exit code 1, no entry", async (t) => {
    if (process.getuid?.() === 0) return t.skip("a superuser can write anywhere");
    const dir = tmpDir();
    chmodSync(dir, 0o500);
    try {
      const P = join(dir, "sub", "settings.json");
      const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
      assert.equal(r.code, 1);
      assert.deepEqual(r.err, [`onetool: init: ${P}: cannot be written`]);
      assert.ok(!r.out.join("\n").includes("add this entry"), "the entry is not printed");
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  test("the file it made is read by readSettings with no SettingsError and nothing in bad", async () => {
    const P = join(tmpDir(), "settings.json");
    await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.deepEqual(readSettings(P).bad, []);
  });
});

describe("something at the path: what is checked, in order", () => {
  const SECRET = "secret-ZZZ";
  const FAULTS = [
    ["a folder", () => null, "cannot be read"],
    ["an empty file", () => "", "not JSON"],
    ["text that is not JSON", () => `{ ${SECRET}`, "not JSON"],
    ["JSON null", () => "null", "not a JSON object"],
    ["a JSON list", () => `["${SECRET}"]`, "not a JSON object"],
    ["a JSON number", () => "3", "not a JSON object"],
    ["a JSON string", () => `"${SECRET}"`, "not a JSON object"],
    ["mcpServers null", () => '{"mcpServers": null}', "mcpServers is not an object"],
    ["mcpServers a list", () => '{"mcpServers": []}', "mcpServers is not an object"],
    ["mcpServers a string", () => `{"mcpServers": "${SECRET}"}`, "mcpServers is not an object"],
    ["onetool null", () => '{"onetool": null}', "onetool is not an object"],
    ["onetool a list", () => '{"onetool": []}', "onetool is not an object"],
    ["onetool a string", () => `{"onetool": "${SECRET}"}`, "onetool is not an object"],
    ["hostServers null", () => '{"onetool": {"hostServers": null}}', "onetool.hostServers is not a list"],
    ["hostServers a string", () => `{"onetool": {"hostServers": "${SECRET}"}}`, "onetool.hostServers is not a list"],
    ["hostServers an object", () => '{"onetool": {"hostServers": {}}}', "onetool.hostServers is not a list"],
    ["mcpServers and onetool both wrong: mcpServers first", () => '{"onetool": 1, "mcpServers": 1}', "mcpServers is not an object"],
    ["onetool wrong after a good mcpServers", () => '{"mcpServers": {}, "onetool": []}', "onetool is not an object"],
  ];

  for (const [what, text, reason] of FAULTS) {
    test(`${what}: one line on the error output, exit code 1, nothing written, nothing else printed`, async () => {
      const dir = tmpDir();
      const P = join(dir, "settings.json");
      const content = text();
      if (content === null) mkdirSync(P);
      else writeFileSync(P, content, "utf8");
      const stand = standIn();
      const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir, terminal: true });
      assert.equal(r.code, 1);
      assert.deepEqual(r.err, [faultLine(P, reason)]);
      assert.deepEqual(r.out, []);
      assert.deepEqual(r.asked, []);
      if (content !== null) assert.equal(read(P), content);
      assert.ok(!r.err.join("\n").includes(SECRET), "no value of the file in the reason");
      assert.deepEqual(readdirSync(dir), ["settings.json"]);
    });
  }

  test("a file readSettings would refuse (unknown keys, bad limits) is not refused by init: it reads only what the text names", async () => {
    const value = { mcpServers: {}, onetool: { bogus: 1, answerLimit: 5 }, other: true };
    const P = settingsAt(JSON.stringify(value));
    const before = read(P);
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P)], P));
    assert.equal(read(P), before);
    assert.throws(() => readSettings(P), SettingsError);
  });
});

describe("a file that is found", () => {
  test("a file that has mcpServers is not written: its bytes, white space included, are what they were (also its mode)", async () => {
    const text = '{"mcpServers":{},"keep":[1,2,3]}';
    const P = settingsAt(text);
    chmodSync(P, 0o644);
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P)], P));
    assert.equal(read(P), text);
    assert.equal(MODE(P).toString(8), "644");
  });

  test("a file with no mcpServers gets it, as its last key, with {}: the file is written, and the second line is said", async () => {
    const P = settingsAt('{ "b": 1,\n "a": { "z": null, "y": [1, {"k": "é"}] } }');
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), addedEmptyLine(P)], P));
    assert.equal(read(P), textOfValue({ b: 1, a: { z: null, y: [1, { k: "é" }] }, mcpServers: {} }));
  });

  test("an existing file keeps its mode", async () => {
    const P = settingsAt({ b: 1 });
    chmodSync(P, 0o640);
    await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(MODE(P).toString(8), "640");
    assert.equal(read(P), textOfValue({ b: 1, mcpServers: {} }));
  });

  test("a symbolic link at the path stays a link, and what it points to is what is written", async () => {
    const real = settingsAt({ b: 1 });
    const P = join(tmpDir(), "link.json");
    symlinkSync(real, P);
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(lstatSync(P).isSymbolicLink(), true);
    assert.equal(read(real), textOfValue({ b: 1, mcpServers: {} }));
  });

  test("a file read by readSettings with no SettingsError before is read so after, with nothing more in bad", async () => {
    const stand = standIn();
    const P = settingsAt({
      mcpServers: { practice: { command: process.execPath, args: ["/absolute/path/to/server.js"] } },
      onetool: { log: false, deny: ["practice.wipe"] },
    });
    const before = readSettings(P).bad.length;
    const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.code, 0);
    const after = readSettings(P);
    assert.equal(after.bad.length, before);
    assert.deepEqual(after.servers.map((server) => server.name), ["practice", "claude"]);
  });
});

describe("what a write keeps", () => {
  const OLD = {
    top: "first",
    mcpServers: {
      practice: { command: "/absolute/path/to/node", args: ["/absolute/path/to/server.js", "--x"], env: { A: "1", B: null } },
      web: { url: "http://127.0.0.1:9/mcp", headers: { "X-Key": "v" }, tools: ["a", "b"] },
    },
    onetool: { deny: ["practice.wipe"], log: false, hostServers: ["other"], allow: [], shell: { folders: ["/absolute/path/to/a"] } },
    extra: { nested: [1, 2.5, { a: null, b: [true, "é", " "] }], z: "last", empty: {} },
    tail: null,
  };

  test("every key at every depth is still there, equal and in its order; the new ones come last; hostServers grows by one item", async () => {
    const stand = standIn();
    const P = settingsAt(JSON.stringify(OLD));
    const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.code, 0);
    const expected = structuredClone(OLD);
    expected.mcpServers.claude = claudeEntry(stand.place);
    expected.onetool.hostServers.push("claude");
    assert.equal(read(P), textOfValue(expected));
  });

  test("a file with no onetool gets it last, with hostServers [claude]", async () => {
    const stand = standIn();
    const P = settingsAt({ extra: 1, mcpServers: { a: { command: "x" } }, after: 2 });
    await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(
      read(P),
      textOfValue({ extra: 1, mcpServers: { a: { command: "x" }, claude: claudeEntry(stand.place) }, after: 2, onetool: { hostServers: ["claude"] } }),
    );
  });

  test("an onetool with no hostServers gets it last in it", async () => {
    const stand = standIn();
    const P = settingsAt({ mcpServers: {}, onetool: { log: false, deny: [] } });
    await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(
      read(P),
      textOfValue({ mcpServers: { claude: claudeEntry(stand.place) }, onetool: { log: false, deny: [], hostServers: ["claude"] } }),
    );
  });

  test("hostServers that is a list without claude gets it as its last item, an empty one gets it alone", async () => {
    const stand = standIn();
    for (const [list, expected] of [
      [["a", "b"], ["a", "b", "claude"]],
      [[], ["claude"]],
    ]) {
      const P = settingsAt({ mcpServers: {}, onetool: { hostServers: list } });
      await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
      assert.equal(read(P), textOfValue({ mcpServers: { claude: claudeEntry(stand.place) }, onetool: { hostServers: expected } }));
    }
  });

  test("hostServers that holds claude already, with no entry of that name: nothing is added to it", async () => {
    const stand = standIn();
    const P = settingsAt({ mcpServers: { a: { command: "x" } }, onetool: { hostServers: ["x", "claude"] } });
    const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.code, 0);
    assert.equal(
      read(P),
      textOfValue({ mcpServers: { a: { command: "x" }, claude: claudeEntry(stand.place) }, onetool: { hostServers: ["x", "claude"] } }),
    );
  });

  test("a file with no mcpServers and no onetool gets both, mcpServers first, in one valid file", async () => {
    const stand = standIn();
    const P = settingsAt({ b: 1 });
    const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.code, 0);
    assert.equal(
      r.out.join("\n"),
      wholeOut([foundLine(P), addedEmptyLine(P), ...PROPOSAL, addedLine(P)], P),
    );
    assert.equal(read(P), textOfValue({ b: 1, mcpServers: { claude: claudeEntry(stand.place) }, onetool: { hostServers: ["claude"] } }));
    assert.deepEqual(readSettings(P).bad, []);
  });

  test("the entry is added with the full path where claude was found, not the bare word", async () => {
    const stand = standIn();
    const P = join(tmpDir(), "settings.json");
    await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    const written = JSON.parse(read(P));
    assert.equal(written.mcpServers.claude.command, stand.place);
    assert.ok(written.mcpServers.claude.command.startsWith("/"));
    assert.deepEqual(Object.keys(written.mcpServers.claude), ["command", "args", "tools"]);
  });

  test("a write is not kept when nothing is added: a nobody-to-ask run leaves an existing file byte for byte", async () => {
    const stand = standIn();
    const text = '{"mcpServers": {"a": {"command": "x"}},   "onetool": {}}';
    const P = settingsAt(text);
    const r = await runIn(["--config", P, "--no-rules"], { home: tmpDir(), pathText: stand.dir, terminal: false });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, nobodyLine(P)], P));
    assert.equal(read(P), text);
  });
});

describe("what it prints and does not do", () => {
  test("no value of the settings file is printed: the names of the servers and the path only", async () => {
    const stand = standIn();
    const P = settingsAt({
      mcpServers: {
        "srv-a": { command: "/absolute/path/to/value-ZZZ", args: ["arg-ZZZ"], env: { K: "env-ZZZ" } },
        "srv-b": { url: "http://host-ZZZ/mcp", headers: { Authorization: "header-ZZZ" } },
      },
      onetool: { allow: ["allow-ZZZ.x"], deny: ["deny-ZZZ.x"], hostServers: ["host-ZZZ"] },
    });
    const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.code, 0);
    const all = [...r.out, ...r.err].join("\n");
    assert.ok(!all.includes("ZZZ"), all);
  });

  test("no text given to out or err ends with a line break", async () => {
    const stand = standIn();
    const P = join(tmpDir(), "settings.json");
    const r = await runIn(["--config", P, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    for (const text of [...r.out, ...r.err]) assert.ok(!text.endsWith("\n"), JSON.stringify(text));
    const wrong = await runIn(["extra"], { home: tmpDir() });
    for (const text of [...wrong.out, ...wrong.err]) assert.ok(!text.endsWith("\n"), JSON.stringify(text));
  });

  test("the entry of the host program: one line, then JSON.stringify(entry, null, 2), and the exit code is 0", async () => {
    const P = join(tmpDir(), "settings.json");
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir() });
    assert.equal(r.code, 0);
    const at = r.said.indexOf("{");
    assert.ok(at > 0);
    assert.ok(r.said.slice(0, at).every((line) => line.startsWith("onetool: init: ")));
    assert.equal(r.said[at - 1], "onetool: init: add this entry to the MCP settings of your host program:");
    const entry = JSON.parse(r.said.slice(at).join("\n"));
    assert.deepEqual(entry.mcpServers.onetool.args.slice(-2), ["--config", P]);
    assert.equal(entry.mcpServers.onetool.command, "npx");
    assert.equal(entry.mcpServers.onetool.args[0], "-y");
  });

  test("it installs no handler of SIGINT or SIGTERM, and never calls process.exit", async () => {
    const stand = standIn();
    const counts = () => ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal));
    const before = counts();
    const exits = [];
    const realExit = process.exit;
    process.exit = (code) => {
      exits.push(code);
      throw new Error("process.exit was called");
    };
    try {
      await runIn(["--config", join(tmpDir(), "settings.json"), "--yes"], { home: tmpDir(), pathText: stand.dir });
      await runIn(["extra"], { home: tmpDir() });
      await runIn(["--config", settingsAt("not json")], { home: tmpDir() });
    } finally {
      process.exit = realExit;
    }
    assert.deepEqual(exits, []);
    assert.deepEqual(counts(), before);
  });
});
