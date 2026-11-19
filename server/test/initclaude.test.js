// Step 11, `onetool init`: Claude Code (the meeting point of server, "Words", "`onetool init`: Claude Code", "`onetool init`: the entry, and
// the end"): which entry is Claude Code, how `claude` is found in a text of folders, the proposal, the question and its answers.
// `runInit` is called in the test; `pathText` is always a text of folders the test made, and the stand-in `claude` is never started.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpDir } from "./helpers.js";
import {
  NOT_ADDED_LINE,
  NOT_FOUND_LINE,
  PROPOSAL,
  addedLine,
  alreadyLine,
  allowLine,
  anotherLine,
  claudeEntry,
  foundLine,
  madeLine,
  nobodyLine,
  questionOf,
  runIn,
  settingsAt,
  standIn,
  textOfValue,
  wholeOut,
} from "./inithelpers.js";

const read = (file) => readFileSync(file, "utf8");
/** The settings that `init --yes` writes for a file that held `{ mcpServers: {} }`. */
const ADDED = (place) => textOfValue({ mcpServers: { claude: claudeEntry(place) }, onetool: { hostServers: ["claude"] } });

describe("an entry is Claude Code", () => {
  // a path with no claude in it: an entry that is Claude Code ends the command with case 1, any other gives case 3
  const IS = (name, mcpServers, onetool) => ({ name, mcpServers, onetool });
  const CASES = [
    IS("a key of onetool.hostServers", { mine: { command: "anything" } }, { hostServers: ["mine"] }),
    IS("a key of hostServers whose entry is not an object", { mine: 5 }, { hostServers: ["mine"] }),
    IS("a command whose base name is claude, with the args mcp serve", { k: { command: "/absolute/path/to/claude", args: ["mcp", "serve"] } }, undefined),
    IS("the bare command claude", { k: { command: "claude", args: ["mcp", "serve"] } }, undefined),
    IS("more args after mcp serve", { k: { command: "claude", args: ["mcp", "serve", "--debug"] } }, undefined),
  ];
  const NOT = [
    IS("a command whose base name is another word", { k: { command: "/absolute/path/to/claude-code", args: ["mcp", "serve"] } }, undefined),
    IS("a command that is claude.exe", { k: { command: "claude.exe", args: ["mcp", "serve"] } }, undefined),
    IS("args that are only mcp", { k: { command: "claude", args: ["mcp"] } }, undefined),
    IS("args in the other order", { k: { command: "claude", args: ["serve", "mcp"] } }, undefined),
    IS("args that start with another item", { k: { command: "claude", args: ["--x", "mcp", "serve"] } }, undefined),
    IS("args that are one text", { k: { command: "claude", args: "mcp serve" } }, undefined),
    IS("no args", { k: { command: "claude" } }, undefined),
    IS("a command that is not a text", { k: { command: 5, args: ["mcp", "serve"] } }, undefined),
    IS("a url entry", { k: { url: "http://127.0.0.1:9/mcp" } }, undefined),
    IS("a key that hostServers does not hold", { k: { command: "anything" } }, { hostServers: ["other"] }),
  ];

  for (const c of CASES) {
    test(`${c.name}: nothing is proposed, the line names its key, and the file is not written`, async () => {
      const stand = standIn();
      const text = JSON.stringify({ mcpServers: c.mcpServers, ...(c.onetool === undefined ? {} : { onetool: c.onetool }) });
      const P = settingsAt(text);
      const r = await runIn(["--config", P], { home: tmpDir(), pathText: stand.dir, terminal: true });
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), alreadyLine(P, "k" in c.mcpServers ? "k" : "mine")], P));
      assert.deepEqual(r.asked, []);
      assert.equal(read(P), text);
    });
  }

  for (const c of NOT) {
    test(`${c.name}: it is not Claude Code, so with no claude on the PATH the line says it was not found`, async () => {
      const text = JSON.stringify({ mcpServers: c.mcpServers, ...(c.onetool === undefined ? {} : { onetool: c.onetool }) });
      const P = settingsAt(text);
      const r = await runIn(["--config", P], { home: tmpDir(), pathText: tmpDir() });
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), NOT_FOUND_LINE], P));
    });
  }

  test("the first one in the order of the file is named", async () => {
    const P = settingsAt({
      mcpServers: {
        a: { command: "x" },
        z1: { command: "claude", args: ["mcp", "serve"] },
        b: { command: "y" },
        a2: { command: "claude", args: ["mcp", "serve"] },
      },
      onetool: { hostServers: ["b", "a2"] },
    });
    const r = await runIn(["--config", P], { home: tmpDir(), pathText: tmpDir() });
    assert.equal(r.out[1], alreadyLine(P, "z1"));
  });

  test("an entry named claude that is Claude Code is case 1, with its name", async () => {
    const P = settingsAt({ mcpServers: { claude: { command: "claude", args: ["mcp", "serve"] } } });
    const r = await runIn(["--config", P], { home: tmpDir(), pathText: standIn().dir });
    assert.equal(r.out[1], alreadyLine(P, "claude"));
  });

  test("a key that is exactly claude and is not Claude Code: another server named claude, nothing is proposed", async () => {
    const stand = standIn();
    const text = '{"mcpServers": {"claude": {"command": "something-else"}}}';
    const P = settingsAt(text);
    const r = await runIn(["--config", P], { home: tmpDir(), pathText: stand.dir, terminal: true });
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), anotherLine(P)], P));
    assert.deepEqual(r.asked, []);
    assert.equal(read(P), text);
  });

  test("a key Claude (another case) is not named claude: the proposal goes on", async () => {
    const stand = standIn();
    const P = settingsAt({ mcpServers: { Claude: { command: "something-else" } } });
    const r = await runIn(["--config", P, "--yes"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.out[1], PROPOSAL[0]);
    assert.deepEqual(Object.keys(JSON.parse(read(P)).mcpServers), ["Claude", "claude"]);
  });
});

describe("the command claude is found in a text of folders", () => {
  const found = async (pathText) => {
    const P = settingsAt({ mcpServers: {} });
    const r = await runIn(["--config", P, "--yes"], { home: tmpDir(), pathText });
    const written = JSON.parse(read(P));
    return { r, place: written.mcpServers.claude?.command, P };
  };
  const executable = (dir) => {
    const file = join(dir, "claude");
    writeFileSync(file, "#!/bin/sh\n");
    chmodSync(file, 0o755);
    return file;
  };

  test("an empty text, and a text of empty items: not found, and the line says so", async () => {
    for (const pathText of ["", delimiter, `${delimiter}${delimiter}`]) {
      const P = settingsAt({ mcpServers: {} });
      const r = await runIn(["--config", P, "--yes"], { home: tmpDir(), pathText, terminal: true });
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), NOT_FOUND_LINE], P));
      assert.equal(read(P), '{"mcpServers":{}}');
      assert.deepEqual(r.asked, []);
    }
  });

  test("the first folder that has it wins, and the empty items are passed over", async () => {
    const first = tmpDir();
    const second = tmpDir();
    executable(first);
    executable(second);
    assert.equal((await found([first, second].join(delimiter))).place, join(first, "claude"));
    assert.equal((await found(["", second, "", first].join(delimiter))).place, join(second, "claude"));
  });

  test("a folder without claude, a file that is not executable, a folder named claude, an item that is no folder: passed over", async () => {
    const nothing = tmpDir();
    const notExecutable = tmpDir();
    writeFileSync(join(notExecutable, "claude"), "#!/bin/sh\n");
    chmodSync(join(notExecutable, "claude"), 0o644);
    const aFolder = tmpDir();
    mkdirSync(join(aFolder, "claude"));
    const aFile = join(tmpDir(), "not-a-folder");
    writeFileSync(aFile, "x");
    const stand = standIn();
    const { place } = await found([nothing, notExecutable, aFolder, aFile, join(tmpDir(), "missing"), stand.dir].join(delimiter));
    assert.equal(place, stand.place);
  });

  test("none of those alone: not found", async () => {
    const notExecutable = tmpDir();
    writeFileSync(join(notExecutable, "claude"), "#!/bin/sh\n");
    chmodSync(join(notExecutable, "claude"), 0o644);
    const aFolder = tmpDir();
    mkdirSync(join(aFolder, "claude"));
    const { r, place } = await found([notExecutable, aFolder, tmpDir()].join(delimiter));
    assert.equal(place, undefined);
    assert.ok(r.out.includes(NOT_FOUND_LINE));
  });

  test("a symbolic link to an executable file counts, and the place is the link in the folder", async () => {
    const stand = standIn();
    const dir = tmpDir();
    symlinkSync(stand.place, join(dir, "claude"));
    const { place } = await found(dir);
    assert.equal(place, join(dir, "claude"));
  });

  test("it is only looked for, never started: the stand-in leaves no mark", async () => {
    const stand = standIn();
    await found(stand.dir);
    assert.equal(stand.started(), false);
  });
});

describe("the proposal", () => {
  test("with --yes: the two lines, the server is added, nothing is asked whatever terminal is", async () => {
    for (const terminal of [true, false]) {
      const stand = standIn();
      const P = settingsAt({ mcpServers: {} });
      const r = await runIn(["--config", P, "--yes"], { home: tmpDir(), pathText: stand.dir, terminal });
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, addedLine(P)], P));
      assert.deepEqual(r.asked, []);
      assert.equal(read(P), ADDED(stand.place));
    }
  });

  test("with no --yes and nobody to ask: nothing is added, one line says how to add it, and nothing is asked", async () => {
    const stand = standIn();
    const P = settingsAt({ mcpServers: {} });
    const r = await runIn(["--config", P], { home: tmpDir(), pathText: stand.dir, terminal: false });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, nobodyLine(P)], P));
    assert.deepEqual(r.asked, []);
    assert.equal(read(P), '{"mcpServers":{}}');
  });

  test("with --no-claude nothing of the subsection is done or printed, and nothing is asked", async () => {
    const stand = standIn();
    const text = '{"mcpServers": {}}';
    const P = settingsAt(text);
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir(), pathText: stand.dir, terminal: true });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P)], P));
    assert.ok(!r.out.join("\n").includes("Claude Code"));
    assert.deepEqual(r.asked, []);
    assert.equal(read(P), text);
  });

  test("with --no-claude even a file that holds Claude Code, or another claude, says nothing of it", async () => {
    const P = settingsAt({ mcpServers: { claude: { command: "other" } } });
    const r = await runIn(["--config", P, "--no-claude"], { home: tmpDir(), pathText: standIn().dir });
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P)], P));
  });

  test("when onetool.allow is a list that is not empty, one more line says to add claude.*", async () => {
    const stand = standIn();
    const P = settingsAt({ mcpServers: {}, onetool: { allow: ["practice.count"] } });
    const r = await runIn(["--config", P, "--yes"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, addedLine(P), allowLine(P)], P));
    assert.deepEqual(JSON.parse(read(P)).onetool.allow, ["practice.count"], "allow is not touched");
  });

  test("an empty allow, or none: the line is not printed", async () => {
    const stand = standIn();
    for (const onetool of [{ allow: [] }, { deny: ["a.b"] }, {}]) {
      const P = settingsAt({ mcpServers: {}, onetool });
      const r = await runIn(["--config", P, "--yes"], { home: tmpDir(), pathText: stand.dir });
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, addedLine(P)], P));
    }
  });
});

describe("the question", () => {
  const ask = async (answer, { argv = [] } = {}) => {
    const stand = standIn();
    const P = settingsAt({ mcpServers: {} });
    const r = await runIn(["--config", P, ...argv], { home: tmpDir(), pathText: stand.dir, terminal: true, ask: typeof answer === "function" ? answer : async () => answer });
    return { r, P, stand };
  };

  test("it is asked once, with the text Add the server claude to <P>? [Y/n] , after the two lines of the proposal", async () => {
    const { r, P } = await ask("");
    assert.deepEqual(r.asked, [questionOf(P)]);
    const at = r.events.findIndex(([kind]) => kind === "ask");
    const before = r.events.slice(0, at);
    assert.ok(before.every(([kind]) => kind === "out"));
    assert.ok(before.map(([, text]) => text).join("\n").endsWith(PROPOSAL.join("\n")));
  });

  for (const answer of ["", "y", "Y", " YES ", "yes", "  ", "\ty\n"]) {
    test(`the answer ${JSON.stringify(answer)} is yes: the server is added, and the line says so`, async () => {
      const { r, P, stand } = await ask(answer);
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, addedLine(P)], P));
      assert.equal(read(P), ADDED(stand.place));
    });
  }

  for (const answer of ["n", "no", "maybe", "yy", "ye", "nope", "0", null]) {
    test(`the answer ${JSON.stringify(answer)} is no: nothing is added, the line says Claude Code is not added, exit code 0`, async () => {
      const { r, P } = await ask(answer);
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, NOT_ADDED_LINE], P));
      assert.deepEqual(JSON.parse(read(P)), { mcpServers: {} });
    });
  }

  test("an ask that rejects counts as an answer null: no, and runInit does not reject", async () => {
    const { r, P } = await ask(async () => {
      throw new Error("the input broke");
    });
    assert.equal(r.code, 0);
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), ...PROPOSAL, NOT_ADDED_LINE], P));
    assert.deepEqual(r.err, []);
  });

  test("the question is asked once, also when the file was made by this run", async () => {
    const stand = standIn();
    const P = join(tmpDir(), "settings.json");
    const r = await runIn(["--config", P], { home: tmpDir(), pathText: stand.dir, terminal: true, ask: async () => "y" });
    assert.deepEqual(r.asked, [questionOf(P)]);
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P), ...PROPOSAL, addedLine(P)], P));
    assert.equal(read(P), ADDED(stand.place));
  });

  test("it is never asked in the cases 1, 2 and 3, nor with --yes, nor with --no-claude, nor with nobody to ask", async () => {
    const stand = standIn();
    const runs = [
      [{ mcpServers: { k: { command: "claude", args: ["mcp", "serve"] } } }, [], true, stand.dir],
      [{ mcpServers: { claude: { command: "other" } } }, [], true, stand.dir],
      [{ mcpServers: {} }, [], true, tmpDir()],
      [{ mcpServers: {} }, ["--yes"], true, stand.dir],
      [{ mcpServers: {} }, ["--no-claude"], true, stand.dir],
      [{ mcpServers: {} }, [], false, stand.dir],
    ];
    for (const [value, argv, terminal, pathText] of runs) {
      const P = settingsAt(value);
      const r = await runIn(["--config", P, ...argv], { home: tmpDir(), pathText, terminal });
      assert.deepEqual(r.asked, [], JSON.stringify(argv));
      assert.equal(r.code, 0);
    }
  });
});
