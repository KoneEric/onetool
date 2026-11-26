// "Step 13, through the real thing" (the meeting point of server), points 1 to 8: the real command started as a process with
// `process.execPath`, standard input not a terminal; a folder `B` as the whole `PATH` with two stand-ins, `claude` and `codex`
// (/bin/sh scripts, mode 0o755, that write a mark and exit 1); `E`, an empty folder; a new folder `H` as `HOME` for each point.
// Then the default `ask` (a process that calls `runInit` with `terminal: true` and its own standard input), the signals while init
// waits for an answer, and the server command, which never reads or writes a file of standing instructions.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { INSTRUCTIONS } from "../../core/src/index.js";
import { BIN, ROOT, tmpDir } from "./helpers.js";
import { ENTRY_HEAD, SIX, claudeEntry, entryValue, foundLine, initProcess, madeLine, settingsAt, splitOutput, withHost } from "./inithelpers.js";
import {
  BLOCK, FIRST, PARAGRAPHS_HEAD, SECOND, USAGE, addedRules, alreadyRules, askRules, bytesOf, fileA, fileC, listing, nobodyRules,
  notAddedRules, proposalA, proposalC, putBytes, standIns,
} from "./ruleshelpers.js";

const OLD = "# My rules\n\nAlways answer in French.";
const settingsPath = () => join(tmpDir(), "settings.json");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

describe("Step 13, through the real thing", () => {
  const B = standIns("claude", "codex");

  test("1: --yes --no-claude, a file there and a file not there", async () => {
    const H = tmpDir();
    putBytes(fileC(H), OLD);
    assert.equal(Buffer.byteLength(OLD), 36);
    const S1 = settingsPath();
    const r = await initProcess(["--config", S1, "--yes", "--no-claude"], { home: H, path: B.dir });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    const { said } = splitOutput(r.stdout);
    assert.deepEqual(said, [madeLine(S1), proposalC(H), addedRules(fileC(H)), proposalA(H), addedRules(fileA(H)), ENTRY_HEAD]);
    assert.deepEqual(bytesOf(fileC(H)), Buffer.concat([Buffer.from(OLD), Buffer.from(`\n\n${BLOCK}`)]));
    assert.deepEqual(bytesOf(fileA(H)), Buffer.from(BLOCK));
    assert.deepEqual(readJson(S1), { mcpServers: {} });
    assert.equal(B.started(), false, "no stand-in was started");
  });

  test("2: the same command a second time: the bytes are what they were, a line of case 3 for each file", async () => {
    const H = tmpDir();
    putBytes(fileC(H), OLD);
    const S1 = settingsPath();
    const args = ["--config", S1, "--yes", "--no-claude"];
    await initProcess(args, { home: H, path: B.dir });
    const c = bytesOf(fileC(H));
    const a = bytesOf(fileA(H));
    const r = await initProcess(args, { home: H, path: B.dir });
    assert.equal(r.code, 0);
    assert.deepEqual(splitOutput(r.stdout).said, [foundLine(S1), alreadyRules(fileC(H)), alreadyRules(fileA(H)), ENTRY_HEAD]);
    assert.deepEqual(bytesOf(fileC(H)), c);
    assert.deepEqual(bytesOf(fileA(H)), a);
    assert.equal(B.started(), false);
  });

  test("3: nobody to ask and no --yes: nothing is made; the two paragraphs are printed, the entry is read as JSON from the first line `{`", async () => {
    const H = tmpDir();
    const S2 = settingsPath();
    const r = await initProcess(["--config", S2, "--no-claude"], { home: H, path: B.dir });
    assert.equal(r.code, 0);
    const { said, entry } = splitOutput(r.stdout);
    assert.deepEqual(said, [
      madeLine(S2), proposalC(H), nobodyRules(fileC(H)), proposalA(H), nobodyRules(fileA(H)),
      PARAGRAPHS_HEAD, FIRST, "", SECOND, ENTRY_HEAD,
    ]);
    assert.deepEqual(entry, entryValue(S2));
    assert.deepEqual(listing(H), []);
    assert.equal(B.started(), false);
  });

  test("4: --yes --no-rules: the server claude as step 11 says, no file of standing instructions, no line with `paragraphs`", async () => {
    const H = tmpDir();
    const S3 = settingsPath();
    const r = await initProcess(["--config", S3, "--yes", "--no-rules"], { home: H, path: B.dir });
    assert.equal(r.code, 0);
    assert.deepEqual(readJson(S3), { mcpServers: { claude: claudeEntry(join(B.dir, "claude")) }, onetool: { hostServers: ["claude"] } });
    assert.deepEqual(readJson(S3).mcpServers.claude.tools, SIX);
    assert.deepEqual(listing(H), []);
    assert.ok(!r.stdout.split("\n").some((line) => line.includes("paragraphs")), r.stdout);
    assert.equal(B.started(), false);
  });

  test("5: PATH set to an empty folder: --yes exits 0, no file, no line with `paragraphs`", async () => {
    const H = tmpDir();
    const S4 = settingsPath();
    const r = await initProcess(["--config", S4, "--yes"], { home: H, path: tmpDir() });
    assert.equal(r.code, 0);
    assert.deepEqual(listing(H), []);
    assert.ok(!r.stdout.split("\n").some((line) => line.includes("paragraphs")), r.stdout);
  });

  test("6: --codex <D> --yes: the line of codex, then the four lines of point 1, then the entry; both files are the block", async () => {
    const H = tmpDir();
    const D = tmpDir();
    const S5 = settingsPath();
    const r = await initProcess(["--config", S5, "--codex", D, "--yes"], { home: H, path: B.dir });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, "");
    const { said, entry } = splitOutput(r.stdout);
    assert.deepEqual(said, [
      madeLine(S5), `onetool: init: added Codex for ${D}`, proposalC(H), addedRules(fileC(H)), proposalA(H), addedRules(fileA(H)), ENTRY_HEAD,
    ]);
    assert.deepEqual(entry, { mcpServers: { onetool: { command: process.execPath, args: [BIN, "--config", S5] } } });
    assert.deepEqual(bytesOf(fileC(H)), Buffer.from(BLOCK));
    assert.deepEqual(bytesOf(fileA(H)), Buffer.from(BLOCK));
    assert.deepEqual(readJson(S5), {
      mcpServers: { codex: { command: process.execPath, args: [BIN, "codex-server", "--root", D], env: { ONETOOL_CODEX_BIN: join(B.dir, "codex") } } },
    });
    assert.equal(B.started(), false);
  });

  test("7: `init --no-rules --no-rules` and `init extra`: the usage line, code 2, nothing made", async () => {
    for (const args of [["--no-rules", "--no-rules"], ["extra"]]) {
      const H = tmpDir();
      const S = settingsPath();
      const r = await initProcess([...args, "--config", S], { home: H, path: B.dir });
      assert.equal(r.code, 2, args.join(" "));
      assert.equal(r.stderr, `${USAGE}\n`);
      assert.equal(r.stdout, "");
      assert.deepEqual(listing(H), []);
      assert.deepEqual(listing(join(S, "..")), []);
    }
  });

  test("8: only `claude` in the PATH: its file is added to; no file or folder for Codex, no line names Codex", async () => {
    const only = standIns("claude");
    const H = tmpDir();
    const S6 = settingsPath();
    const r = await initProcess(["--config", S6, "--yes", "--no-claude"], { home: H, path: only.dir });
    assert.equal(r.code, 0);
    assert.deepEqual(bytesOf(fileC(H)), Buffer.from(BLOCK));
    assert.deepEqual(listing(H), [".claude/", ".claude/CLAUDE.md"]);
    assert.ok(!r.stdout.includes("Codex"), r.stdout);
    assert.equal(only.started(), false);
  });
});

// ---- the default `ask`: a process that calls `runInit` with `terminal: true` and the standard input it is given -----------------

const SCRIPT = `
import { runInit } from ${JSON.stringify(pathToFileURL(join(ROOT, "server", "src", "init.js")).href)};
const [argv, home, pathText] = JSON.parse(process.argv[2]);
process.exitCode = await runInit(argv, { home, pathText, terminal: true });
`;

/** Starts that process; `until(text)` waits (10 s at most) for `text` on its standard output; `done` is its end. */
function askProcess(argv, { home, pathText }) {
  const dir = tmpDir();
  const file = join(dir, "run.mjs");
  writeFileSync(file, SCRIPT);
  const child = spawn(process.execPath, [file, JSON.stringify([argv, home, pathText])], { cwd: dir, env: { HOME: home, PATH: dir }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const watchers = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    for (const watcher of watchers) watcher();
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {});
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: "timeout", signal: null, stdout, stderr });
    }, 10000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
  const until = (text) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${JSON.stringify(text)} after 10 s; stdout: ${stdout}`)), 10000);
      const check = () => {
        if (!stdout.includes(text)) return;
        clearTimeout(timer);
        resolve();
      };
      watchers.push(check);
      child.on("close", () => {
        clearTimeout(timer);
        if (!stdout.includes(text)) reject(new Error(`the process ended before ${JSON.stringify(text)}; stdout: ${stdout}; stderr: ${stderr}`));
      });
      check();
    });
  return { child, done, until, stdout: () => stdout };
}

describe("the default ask, called once for each file", () => {
  test("two answers in one chunk of standard input: each call resolves with the next line, `` adds the first file, `n` refuses the second", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const run = askProcess(["--config", P, "--no-claude"], { home, pathText: stand.dir });
    run.child.stdin.end("\nn\n");
    const r = await run.done;
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, "");
    assert.ok(r.stdout.includes(askRules(fileC(home))) && r.stdout.includes(askRules(fileA(home))), r.stdout);
    assert.ok(r.stdout.indexOf(askRules(fileC(home))) < r.stdout.indexOf(askRules(fileA(home))));
    assert.ok(r.stdout.includes(addedRules(fileC(home))));
    assert.ok(r.stdout.includes(notAddedRules(fileA(home))));
    assert.deepEqual(bytesOf(fileC(home)), Buffer.from(BLOCK));
    assert.deepEqual(listing(home), [".claude/", ".claude/CLAUDE.md"]);
    assert.equal(stand.started(), false);
  });

  test("answers that come one at a time, each after its question is written", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const run = askProcess(["--config", settingsPath(), "--no-claude"], { home, pathText: stand.dir });
    await run.until(askRules(fileC(home)));
    run.child.stdin.write("yes\n");
    await run.until(askRules(fileA(home)));
    run.child.stdin.write("Y\n");
    const r = await run.done;
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(bytesOf(fileC(home)), Buffer.from(BLOCK));
    assert.deepEqual(bytesOf(fileA(home)), Buffer.from(BLOCK));
  });

  test("the question of Claude Code as a server, then one for each file: three answers", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const run = askProcess(["--config", P], { home, pathText: stand.dir });
    run.child.stdin.end("\n\n\n");
    const r = await run.done;
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    const asked = [`Add the server claude to ${P}? [Y/n] `, askRules(fileC(home)), askRules(fileA(home))].map((q) => r.stdout.indexOf(q));
    assert.ok(asked.every((at) => at !== -1) && asked[0] < asked[1] && asked[1] < asked[2], r.stdout);
    assert.deepEqual(Object.keys(readJson(P).mcpServers), ["claude"]);
    assert.deepEqual(bytesOf(fileA(home)), Buffer.from(BLOCK));
  });

  test("the end of the input: every call that follows resolves with null, which is a no; the process ends by itself", async () => {
    const stand = standIns("claude", "codex");
    for (const input of ["", "\n"]) {
      const home = tmpDir();
      const run = askProcess(["--config", settingsPath(), "--no-claude"], { home, pathText: stand.dir });
      run.child.stdin.end(input);
      const r = await run.done;
      assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
      assert.ok(r.stdout.includes(notAddedRules(fileA(home))));
      assert.equal(listing(home).includes(".claude/CLAUDE.md"), input === "\n");
      assert.equal(listing(home).includes(".codex/AGENTS.md"), false);
      if (input === "") assert.ok(r.stdout.includes(notAddedRules(fileC(home))));
    }
  });

  test("SIGTERM and SIGINT while init waits for an answer end it as the system does; a file made before stays whole, nothing is added after", async () => {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const stand = standIns("claude", "codex");
      const home = tmpDir();
      const run = askProcess(["--config", settingsPath(), "--no-claude"], { home, pathText: stand.dir });
      await run.until(askRules(fileC(home)));
      run.child.stdin.write("\n");
      await run.until(askRules(fileA(home)));
      run.child.kill(signal);
      const r = await run.done;
      assert.equal(r.signal, signal, `${r.stdout}${r.stderr}`);
      assert.deepEqual(bytesOf(fileC(home)), Buffer.from(BLOCK));
      assert.deepEqual(listing(home), [".claude/", ".claude/CLAUDE.md"]);
      assert.ok(!r.stdout.includes(ENTRY_HEAD));
    }
  });

  test("a signal at the first question: nothing is made", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const run = askProcess(["--config", settingsPath(), "--no-claude"], { home, pathText: stand.dir });
    await run.until(askRules(fileC(home)));
    run.child.kill("SIGTERM");
    const r = await run.done;
    assert.equal(r.signal, "SIGTERM");
    assert.deepEqual(listing(home), []);
  });
});

describe("the server command never reads or writes a file of standing instructions", () => {
  test("a host program connects: the instructions are INSTRUCTIONS of part core, two tools; the home gets no file; nothing is started", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    putBytes(fileC(home), OLD);
    const settings = settingsAt({ mcpServers: {}, onetool: { log: false, trail: false } });
    await withHost(settings, { home, path: stand.dir, name: "step13-host" }, async (host) => {
      assert.deepEqual(await host.tools(), ["run", "search"]);
      assert.equal(host.client.getInstructions(), INSTRUCTIONS);
      assert.ok(INSTRUCTIONS.length <= 600);
      assert.match(await host.search(), /./);
    });
    assert.deepEqual(listing(home), [".claude/", ".claude/CLAUDE.md"]);
    assert.equal(bytesOf(fileC(home)).toString("utf8"), OLD);
    assert.equal(stand.started(), false);
  });
});
