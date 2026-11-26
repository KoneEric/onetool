// "Step 13: `onetool init` proposes the standing instructions" (the meeting point of server), through `runInit` called in the test:
// the three texts, the option `--no-rules`, the four cases of the proposal, what is added and how, the order of what is printed.
// `home` and `pathText` are folders the test made; the stand-ins are started never (a mark would show it).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import * as init from "../src/init.js";
import { tmpDir } from "./helpers.js";
import { ENTRY_HEAD, PROPOSAL, addedLine, entryValue, foundLine, madeLine, runIn, settingsAt, wholeOut } from "./inithelpers.js";
import {
  BEGIN, BLOCK, END, FIRST, RULES, SECOND, SUPER_USER, USAGE,
  PARAGRAPHS_HEAD, addedRules, alreadyRules, askRules, bytesOf, cannotRead, cannotWrite, fileA, fileC, listing, nobodyRules,
  notAddedRules, proposalA, proposalC, putBytes, standIns,
} from "./ruleshelpers.js";

const settingsPath = () => join(tmpDir(), "settings.json");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

describe("the three texts", () => {
  test("STANDING_RULES, RULES_BEGIN and RULES_END are exactly those of the section; the second paragraph has 208 characters", () => {
    assert.equal(init.RULES_BEGIN, BEGIN);
    assert.equal(init.RULES_END, END);
    assert.equal(init.STANDING_RULES, `${FIRST}\n\n${SECOND}`);
    assert.equal(SECOND.length, 208);
    assert.ok(!init.STANDING_RULES.endsWith("\n"));
    assert.ok(!SECOND.includes("\n") && !FIRST.includes("\n"));
  });

  test("the second paragraph is a general rule: it names neither onetool nor a host program", () => {
    assert.doesNotMatch(init.STANDING_RULES.split("\n\n")[1] ?? "", /onetool|claude|codex/i);
  });

  test("the module still exports what it exported", () => {
    for (const name of ["INIT_USAGE", "parseInitArgs", "findClaude", "runInit"]) assert.equal(typeof init[name] !== "undefined", true, name);
    assert.equal(init.INIT_USAGE, USAGE);
  });
});

describe("the option --no-rules", () => {
  test("a second --no-rules and any other word give the usage line of the six commands, code 2, nothing made", async () => {
    for (const args of [["--no-rules", "--no-rules"], ["--no-rules", "--yes", "--no-rules"], ["extra"], ["--no-rules", "extra"]]) {
      const P = settingsPath();
      const stand = standIns("claude", "codex");
      const home = tmpDir();
      const r = await runIn([...args, "--config", P], { home, pathText: stand.dir });
      assert.equal(r.code, 2, args.join(" "));
      assert.deepEqual(r.err, [USAGE], args.join(" "));
      assert.deepEqual(r.out, []);
      assert.deepEqual(listing(home), []);
      assert.equal(stand.started(), false);
    }
  });

  test("with --yes, --no-claude, --codex or --config, in any place: valid, nothing of the section is printed or done", async () => {
    const stand = standIns("claude", "codex");
    const folder = tmpDir();
    const cases = [
      (P) => ["--no-rules", "--yes", "--config", P],
      (P) => ["--yes", "--no-rules", "--config", P],
      (P) => ["--config", P, "--yes", "--no-rules"],
      (P) => ["--no-rules", "--no-claude", "--config", P],
      (P) => ["--no-claude", "--config", P, "--no-rules"],
      (P) => ["--config", P, "--no-rules", "--no-claude", "--yes"],
      (P) => ["--no-rules", "--codex", folder, "--yes", "--config", P],
      (P) => ["--config", P, "--yes", "--codex", folder, "--no-rules"],
    ];
    for (const make of cases) {
      const P = settingsPath();
      const home = tmpDir();
      const r = await runIn(make(P), { home, pathText: stand.dir, terminal: true });
      assert.equal(r.code, 0, make(P).join(" "));
      assert.deepEqual(r.err, []);
      assert.deepEqual(r.asked, []);
      assert.ok(!r.out.some((line) => /paragraph|standing instructions/.test(line)), r.out.join("\n"));
      assert.deepEqual(listing(home), [], "no file of standing instructions, no folder");
    }
    assert.equal(stand.started(), false);
  });

  test("with --no-rules the output is the output of step 11, line for line", async () => {
    const stand = standIns("claude", "codex");
    const P = settingsPath();
    const r = await runIn(["--config", P, "--no-rules", "--no-claude"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P)], P));
  });

  test("with --no-rules no file of standing instructions is read: a folder where one would be is no fault", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    mkdirSync(fileC(home), { recursive: true });
    mkdirSync(fileA(home), { recursive: true });
    const r = await runIn(["--config", settingsPath(), "--yes", "--no-claude", "--no-rules"], { home, pathText: stand.dir });
    assert.equal(r.code, 0);
    assert.deepEqual(r.err, []);
  });
});

describe("the proposal: which host programs, which cases", () => {
  test("no known host program is found: nothing of the section is printed, also with --yes", async () => {
    for (const terminal of [false, true]) {
      const P = settingsPath();
      const home = tmpDir();
      const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: tmpDir(), terminal });
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([madeLine(P)], P));
      assert.deepEqual(r.err, []);
      assert.deepEqual(listing(home), []);
    }
  });

  test("with claude only: Claude Code gets the proposal and the file; nothing is said or made for Codex", async () => {
    const stand = standIns("claude");
    const P = settingsPath();
    const home = tmpDir();
    const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P), proposalC(home), addedRules(fileC(home))], P));
    assert.deepEqual(listing(home), [".claude/", ".claude/CLAUDE.md"]);
    assert.ok(!r.out.some((line) => line.includes("Codex")));
  });

  test("with codex only: Codex gets the proposal and the file; nothing is said or made for Claude Code", async () => {
    const stand = standIns("codex");
    const P = settingsPath();
    const home = tmpDir();
    const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P), proposalA(home), addedRules(fileA(home))], P));
    assert.deepEqual(listing(home), [".codex/", ".codex/AGENTS.md"]);
  });

  test("a host program is found by reading the folders: a command that is not executable, or a folder, is not found", async () => {
    const dir = tmpDir();
    putBytes(join(dir, "claude"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(dir, "claude"), 0o644);
    mkdirSync(join(dir, "codex"));
    const home = tmpDir();
    const r = await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: dir });
    assert.deepEqual(listing(home), []);
    assert.ok(!r.out.some((line) => line.includes("paragraphs")));
  });

  test("case 3: a file that holds the first marker, anywhere, gets one line; no proposal, no question, no change", async () => {
    for (const body of [`${BEGIN}\n`, `before\n${BEGIN}\nafter`, `x${BEGIN}y`, `${BLOCK}`, `a\n\n${BLOCK}\nmore\n`]) {
      const stand = standIns("claude", "codex");
      const home = tmpDir();
      putBytes(fileC(home), body);
      putBytes(fileA(home), body);
      const P = settingsPath();
      const r = await runIn(["--config", P, "--no-claude"], { home, pathText: stand.dir, terminal: true });
      assert.equal(r.code, 0);
      assert.equal(r.out.join("\n"), wholeOut([madeLine(P), alreadyRules(fileC(home)), alreadyRules(fileA(home))], P));
      assert.deepEqual(r.asked, []);
      assert.equal(bytesOf(fileC(home)).toString("latin1"), body);
      assert.equal(bytesOf(fileA(home)).toString("latin1"), body);
    }
  });

  test("case 2: a file that cannot be read (a folder, or a path through a file) is one line through err, code 1; the next host is looked at and the entry is printed", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    mkdirSync(fileC(home), { recursive: true });
    const P = settingsPath();
    const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(r.code, 1);
    assert.deepEqual(r.err, [cannotRead(fileC(home))]);
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P), proposalA(home), addedRules(fileA(home))], P));
    assert.deepEqual(listing(home).filter((rel) => rel.startsWith(".claude")), [".claude/", ".claude/CLAUDE.md/"]);
    assert.equal(bytesOf(fileA(home)).toString("utf8"), BLOCK);

    const home2 = tmpDir();
    putBytes(join(home2, ".claude"), "a file, where a folder should be");
    const r2 = await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home: home2, pathText: stand.dir });
    assert.equal(r2.code, 1);
    assert.deepEqual(r2.err, [cannotRead(fileC(home2))]);
    assert.equal(bytesOf(join(home2, ".claude")).toString("utf8"), "a file, where a folder should be");
    assert.equal(bytesOf(fileA(home2)).toString("utf8"), BLOCK);
    assert.ok(r2.out.includes(ENTRY_HEAD));
  });

  test("case 4 with --yes: the proposal line, then the file is added to; nothing is asked, whatever terminal is", async () => {
    for (const terminal of [false, true]) {
      const stand = standIns("claude", "codex");
      const home = tmpDir();
      const P = settingsPath();
      const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir, terminal });
      assert.equal(r.code, 0);
      assert.equal(
        r.out.join("\n"),
        wholeOut([madeLine(P), proposalC(home), addedRules(fileC(home)), proposalA(home), addedRules(fileA(home))], P),
      );
      assert.deepEqual(r.asked, []);
      assert.deepEqual(r.err, []);
    }
  });

  test("case 4 with no --yes and nobody to ask: nothing is added; the paragraphs are printed once, after the lines that name each file", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const r = await runIn(["--config", P, "--no-claude"], { home, pathText: stand.dir, terminal: false });
    assert.equal(r.code, 0);
    assert.deepEqual(r.out, [
      madeLine(P), proposalC(home), nobodyRules(fileC(home)), proposalA(home), nobodyRules(fileA(home)),
      PARAGRAPHS_HEAD, RULES, ENTRY_HEAD, JSON.stringify(entryValue(P), null, 2),
    ]);
    assert.deepEqual(r.asked, []);
    assert.deepEqual(listing(home), []);
    // the standard output still ends with a JSON object that starts at the first line that is exactly `{`
    const lines = r.out.join("\n").split("\n");
    assert.deepEqual(JSON.parse(lines.slice(lines.indexOf("{")).join("\n")), entryValue(P));
    assert.equal(lines.filter((line) => line === "{").length, 1);
  });

  test("the paragraphs are printed when only one file got the line `nobody to ask`, and not at all when none did", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    putBytes(fileC(home), `${BEGIN}\n`);
    const P = settingsPath();
    const r = await runIn(["--config", P, "--no-claude"], { home, pathText: stand.dir });
    assert.deepEqual(r.out.slice(1, -2), [alreadyRules(fileC(home)), proposalA(home), nobodyRules(fileA(home)), PARAGRAPHS_HEAD, RULES]);

    const home2 = tmpDir();
    putBytes(fileC(home2), `${BEGIN}\n`);
    putBytes(fileA(home2), `${BEGIN}\n`);
    const r2 = await runIn(["--config", settingsPath(), "--no-claude"], { home: home2, pathText: stand.dir });
    assert.ok(!r2.out.includes(PARAGRAPHS_HEAD) && !r2.out.includes(RULES));
    const r3 = await runIn(["--config", settingsPath(), "--no-claude", "--yes"], { home: tmpDir(), pathText: stand.dir });
    assert.ok(!r3.out.includes(PARAGRAPHS_HEAD) && !r3.out.includes(RULES));
  });

  test("the paragraphs and the line before them are printed through out, the paragraphs in one call", async () => {
    const stand = standIns("codex");
    const home = tmpDir();
    const r = await runIn(["--config", settingsPath(), "--no-claude"], { home, pathText: stand.dir });
    const at = r.events.findIndex(([kind, text]) => kind === "out" && text === PARAGRAPHS_HEAD);
    assert.notEqual(at, -1);
    assert.deepEqual(r.events[at + 1], ["out", RULES]);
    assert.equal(r.events[at + 2][1], ENTRY_HEAD);
  });
});

describe("the question: one per file, each with its own answer", () => {
  const answers = async (replies, extra = []) => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const given = [...replies];
    const r = await runIn(["--config", P, "--no-claude", ...extra], {
      home, pathText: stand.dir, terminal: true, ask: async () => given.shift(),
    });
    return { r, home, P, stand };
  };

  test("ask is called with the exact question, a space at its end, for Claude Code then for Codex; empty is yes, `n` is no", async () => {
    const { r, home, P } = await answers(["", "n"]);
    assert.deepEqual(r.asked, [askRules(fileC(home)), askRules(fileA(home))]);
    assert.ok(askRules(fileC(home)).endsWith("[Y/n] "));
    assert.equal(r.out.join("\n"), wholeOut([madeLine(P), proposalC(home), addedRules(fileC(home)), proposalA(home), notAddedRules(fileA(home))], P));
    assert.equal(bytesOf(fileC(home)).toString("utf8"), BLOCK);
    assert.deepEqual(listing(home), [".claude/", ".claude/CLAUDE.md"]);
    assert.ok(!r.out.includes(PARAGRAPHS_HEAD));
    assert.equal(r.code, 0);
  });

  test("a no for the first does not stop the next", async () => {
    const { r, home } = await answers(["n", ""]);
    assert.deepEqual(listing(home), [".codex/", ".codex/AGENTS.md"]);
    assert.ok(r.out.includes(notAddedRules(fileC(home))));
    assert.ok(r.out.includes(addedRules(fileA(home))));
  });

  test("the answer is read trimmed and in lower case: empty, y and yes are yes; anything else, null and a rejection are no", async () => {
    for (const [reply, yes] of [["", true], ["y", true], ["yes", true], [" Y ", true], ["YES", true], ["\tyEs  ", true], ["   ", true],
      ["n", false], ["no", false], ["yess", false], ["ok", false], ["sure", false], ["0", false], [null, false], [undefined, false]]) {
      const { home } = await answers([reply, reply]);
      assert.deepEqual(listing(home), yes ? [".claude/", ".claude/CLAUDE.md", ".codex/", ".codex/AGENTS.md"] : [], JSON.stringify(reply));
    }
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const r = await runIn(["--config", settingsPath(), "--no-claude"], {
      home, pathText: stand.dir, terminal: true, ask: async () => { throw new Error("the input broke"); },
    });
    assert.deepEqual(listing(home), []);
    assert.ok(r.out.includes(notAddedRules(fileC(home))) && r.out.includes(notAddedRules(fileA(home))));
    assert.equal(r.code, 0);
  });

  test("each call of ask waits for the one before, and the lines come in the order of the output", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    let waiting = false;
    let overlapped = false;
    const r = await runIn(["--config", settingsPath(), "--no-claude"], {
      home, pathText: stand.dir, terminal: true,
      ask: async () => {
        if (waiting) overlapped = true;
        waiting = true;
        await sleep(30);
        waiting = false;
        return "";
      },
    });
    assert.equal(overlapped, false);
    const kinds = r.events.map(([kind, text]) => (kind === "ask" ? `ask ${text}` : text));
    const at = kinds.indexOf(proposalC(home));
    assert.deepEqual(kinds.slice(at, at + 6), [
      proposalC(home), `ask ${askRules(fileC(home))}`, addedRules(fileC(home)),
      proposalA(home), `ask ${askRules(fileA(home))}`, addedRules(fileA(home)),
    ]);
  });

  test("a question for a file that is not asked: --yes, the marker, no host program found: ask is not called", async () => {
    const stand = standIns("claude");
    const home = tmpDir();
    putBytes(fileC(home), BLOCK);
    const r = await runIn(["--config", settingsPath(), "--no-claude"], { home, pathText: stand.dir, terminal: true, ask: async () => "" });
    assert.deepEqual(r.asked, []);
  });

  test("without --no-claude and with Claude Code not a server yet: ask is called three times, the question of step 11 first", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const r = await runIn(["--config", P], { home, pathText: stand.dir, terminal: true, ask: async () => "" });
    assert.deepEqual(r.asked, [`Add the server claude to ${P}? [Y/n] `, askRules(fileC(home)), askRules(fileA(home))]);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(addedRules(fileC(home))) && r.out.includes(addedRules(fileA(home))));
  });

  test("ask is called at most once for each file: a second run asks nothing for the files that hold the marker", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    await runIn(["--config", P, "--no-claude"], { home, pathText: stand.dir, terminal: true, ask: async () => "" });
    const again = await runIn(["--config", P, "--no-claude"], { home, pathText: stand.dir, terminal: true, ask: async () => "" });
    assert.deepEqual(again.asked, []);
  });
});

describe("what added means", () => {
  const OLD = "# My rules\n\nAlways answer in French.";

  test("the file is not there: the folders it lacks are made and the file holds exactly the block", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(bytesOf(fileC(home)).toString("utf8"), BLOCK);
    assert.equal(bytesOf(fileA(home)).toString("utf8"), BLOCK);
    assert.equal(BLOCK.split("\n").length, 6, "five lines and the end of the last");
    assert.equal(BLOCK.split("\n")[2], "");
  });

  test("the block is RULES_BEGIN, a line break, the paragraphs, a line break, RULES_END, a line break", async () => {
    const stand = standIns("codex");
    const home = tmpDir();
    await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    const text = bytesOf(fileA(home)).toString("utf8");
    assert.equal(text, `${init.RULES_BEGIN}\n${init.STANDING_RULES}\n${init.RULES_END}\n`);
  });

  test("the file is there: its bytes stay, then nothing (empty), one line break (it ended with one) or two, then the block", async () => {
    const cases = [
      ["empty", Buffer.alloc(0), ""],
      ["no line break at its end", Buffer.from(OLD), "\n\n"],
      ["a line break at its end", Buffer.from(`${OLD}\n`), "\n"],
      ["two line breaks at its end", Buffer.from(`${OLD}\n\n`), "\n"],
      ["not UTF-8", Buffer.from([0xff, 0xfe, 0x80, 0xc3, 0x28, 0x41]), "\n\n"],
      ["not UTF-8, a line break at its end", Buffer.from([0xff, 0xfe, 0x80, 0x0a]), "\n"],
      ["a carriage return and a line break at its end", Buffer.from(`${OLD}\r\n`), "\n"],
    ];
    for (const [what, old, gap] of cases) {
      const stand = standIns("claude", "codex");
      const home = tmpDir();
      putBytes(fileC(home), old);
      putBytes(fileA(home), old);
      const r = await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
      const expected = Buffer.concat([old, Buffer.from(gap + BLOCK)]);
      assert.deepEqual(bytesOf(fileC(home)), expected, what);
      assert.deepEqual(bytesOf(fileA(home)), expected, what);
      assert.ok(r.out.includes(addedRules(fileC(home))), what);
    }
  });

  test("the 36 bytes of the example: the old bytes, a blank line, the block", async () => {
    const stand = standIns("claude");
    const home = tmpDir();
    putBytes(fileC(home), OLD);
    assert.equal(Buffer.byteLength(OLD), 36);
    await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(bytesOf(fileC(home)).toString("utf8"), `${OLD}\n\n${BLOCK}`);
  });

  test("an existing file keeps its mode", async () => {
    const stand = standIns("claude");
    const home = tmpDir();
    putBytes(fileC(home), OLD);
    chmodSync(fileC(home), 0o640);
    await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(statSync(fileC(home)).mode & 0o777, 0o640);
    assert.equal(bytesOf(fileC(home)).toString("utf8"), `${OLD}\n\n${BLOCK}`);
  });

  test("a symbolic link at the file stays a link, and what it points to gets the bytes", async () => {
    const stand = standIns("claude");
    const home = tmpDir();
    const target = join(tmpDir(), "rules.md");
    putBytes(target, OLD);
    mkdirSync(join(home, ".claude"));
    symlinkSync(target, fileC(home));
    await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(lstatSync(fileC(home)).isSymbolicLink(), true);
    assert.equal(readlinkSync(fileC(home)), target);
    assert.equal(bytesOf(target).toString("utf8"), `${OLD}\n\n${BLOCK}`);
  });

  test("nothing else of any host program is read or written: only the two files are in the home, and its other files are as they were", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    putBytes(join(home, ".claude", "settings.json"), '{"permissions":{}}');
    putBytes(join(home, ".codex", "config.toml"), 'model = "x"\n');
    putBytes(join(home, "AGENTS.md"), "not of the host");
    await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.deepEqual(listing(home), [".claude/", ".claude/CLAUDE.md", ".claude/settings.json", ".codex/", ".codex/AGENTS.md", ".codex/config.toml", "AGENTS.md"]);
    assert.equal(bytesOf(join(home, ".claude", "settings.json")).toString("utf8"), '{"permissions":{}}');
    assert.equal(bytesOf(join(home, ".codex", "config.toml")).toString("utf8"), 'model = "x"\n');
    assert.equal(bytesOf(join(home, "AGENTS.md")).toString("utf8"), "not of the host");
  });

  // assumed: the bytes are added in place ("in place" of the section), so a file the system refuses to write is refused, not replaced beside
  test("a write that fails (a file the system refuses): one line through err, code 1; the old bytes are kept; the next host and the entry follow", { skip: SUPER_USER }, async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    putBytes(fileC(home), OLD);
    chmodSync(fileC(home), 0o444);
    const P = settingsPath();
    const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.equal(r.code, 1);
    assert.deepEqual(r.err, [cannotWrite(fileC(home))]);
    assert.ok(bytesOf(fileC(home)).toString("utf8").startsWith(OLD), "never fewer bytes than it held");
    assert.ok(!r.out.includes(addedRules(fileC(home))));
    assert.ok(r.out.includes(proposalA(home)) && r.out.includes(addedRules(fileA(home))));
    assert.equal(r.out.at(-2), ENTRY_HEAD);
    assert.equal(bytesOf(fileA(home)).toString("utf8"), BLOCK);
  });

  // assumed: a folder that exists but refuses a new file is a write that fails ("the system refuses")
  test("a write that fails for a file that is not there (a folder the system refuses): the same line and code", { skip: SUPER_USER }, async () => {
    const stand = standIns("codex");
    const home = tmpDir();
    mkdirSync(join(home, ".codex"));
    chmodSync(join(home, ".codex"), 0o555);
    try {
      const r = await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
      assert.equal(r.code, 1);
      assert.deepEqual(r.err, [cannotWrite(fileA(home))]);
      assert.ok(r.out.includes(proposalA(home)));
      assert.ok(!r.out.includes(addedRules(fileA(home))));
      assert.ok(r.out.includes(ENTRY_HEAD));
    } finally {
      chmodSync(join(home, ".codex"), 0o755);
    }
    assert.deepEqual(listing(home), [".codex/"]);
  });
});

describe("what follows, and must hold", () => {
  test("again: a second run adds nothing: the bytes are as they were, one line of case 3 for each file, no proposal, no question", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    putBytes(fileC(home), "# mine");
    const P = settingsPath();
    await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    const c = bytesOf(fileC(home));
    const a = bytesOf(fileA(home));
    const r = await runIn(["--config", P, "--no-claude"], { home, pathText: stand.dir, terminal: true, ask: async () => "" });
    assert.equal(r.out.join("\n"), wholeOut([foundLine(P), alreadyRules(fileC(home)), alreadyRules(fileA(home))], P));
    assert.deepEqual(r.asked, []);
    assert.deepEqual(bytesOf(fileC(home)), c);
    assert.deepEqual(bytesOf(fileA(home)), a);
    const third = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.deepEqual(bytesOf(fileC(home)), c);
    assert.deepEqual(third.out.slice(1, 3), [alreadyRules(fileC(home)), alreadyRules(fileA(home))]);
  });

  test("a file removed between two runs, or whose marker a person removed, is proposed again", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    const { rmSync } = await import("node:fs");
    rmSync(fileC(home));
    putBytes(fileA(home), "# the person removed the two marker lines\n");
    const r = await runIn(["--config", P, "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.deepEqual(r.out.slice(1, -2), [proposalC(home), addedRules(fileC(home)), proposalA(home), addedRules(fileA(home))]);
    assert.equal(bytesOf(fileC(home)).toString("utf8"), BLOCK);
    assert.equal(bytesOf(fileA(home)).toString("utf8"), `# the person removed the two marker lines\n\n${BLOCK}`);
  });

  test("the settings file gets nothing from the section: it is the same with and without --no-rules", async () => {
    const stand = standIns("claude", "codex");
    const start = { mcpServers: { other: { command: "x" } }, onetool: { log: false } };
    const withRules = settingsAt(start);
    const without = settingsAt(start);
    await runIn(["--config", withRules, "--yes", "--no-claude"], { home: tmpDir(), pathText: stand.dir });
    await runIn(["--config", without, "--yes", "--no-claude", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.deepEqual(bytesOf(withRules), bytesOf(without));
    assert.deepEqual(JSON.parse(bytesOf(withRules)), start);
    // with the server claude too
    const a = settingsAt(start);
    const b = settingsAt(start);
    await runIn(["--config", a, "--yes"], { home: tmpDir(), pathText: stand.dir });
    await runIn(["--config", b, "--yes", "--no-rules"], { home: tmpDir(), pathText: stand.dir });
    assert.deepEqual(bytesOf(a), bytesOf(b));
  });

  test("the order of everything printed: the file, Claude Code as a server, then each host program, then the entry", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const r = await runIn(["--config", P, "--yes"], { home, pathText: stand.dir });
    assert.equal(
      r.out.join("\n"),
      wholeOut([madeLine(P), ...PROPOSAL, addedLine(P), proposalC(home), addedRules(fileC(home)), proposalA(home), addedRules(fileA(home))], P),
    );
    assert.equal(r.code, 0);
  });

  test("a fault of the file of step 11 ends before the section: nothing is proposed, nothing is read", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsAt("not json");
    const r = await runIn(["--config", P, "--yes"], { home, pathText: stand.dir });
    assert.equal(r.code, 1);
    assert.deepEqual(r.out.filter((line) => /paragraphs|standing/.test(line)), []);
    assert.deepEqual(listing(home), []);
  });

  test("init starts no program: neither stand-in is started, with --yes, with questions, or with the two paragraphs printed", async () => {
    const stand = standIns("claude", "codex");
    const folder = tmpDir();
    await runIn(["--config", settingsPath(), "--yes"], { home: tmpDir(), pathText: stand.dir });
    await runIn(["--config", settingsPath()], { home: tmpDir(), pathText: stand.dir, terminal: true, ask: async () => "" });
    await runIn(["--config", settingsPath()], { home: tmpDir(), pathText: stand.dir });
    await runIn(["--config", settingsPath(), "--codex", folder, "--yes"], { home: tmpDir(), pathText: stand.dir });
    assert.equal(stand.started(), false);
  });

  test("with --codex the proposal is made as well, and Claude Code as a server is not proposed", async () => {
    const stand = standIns("claude", "codex");
    const folder = tmpDir();
    const home = tmpDir();
    const P = settingsPath();
    const r = await runIn(["--config", P, "--codex", folder, "--yes"], { home, pathText: stand.dir });
    assert.equal(r.code, 0);
    assert.deepEqual(r.out.slice(0, 2), [madeLine(P), `onetool: init: added Codex for ${folder}`]);
    assert.deepEqual(r.out.slice(2, 6), [proposalC(home), addedRules(fileC(home)), proposalA(home), addedRules(fileA(home))]);
    assert.equal(r.out[6], ENTRY_HEAD);
    assert.equal(r.out.length, 8);
    assert.equal(bytesOf(fileC(home)).toString("utf8"), BLOCK);
    assert.equal(bytesOf(fileA(home)).toString("utf8"), BLOCK);
    const servers = JSON.parse(bytesOf(P)).mcpServers;
    assert.deepEqual(Object.keys(servers), ["codex"]);
  });

  test("with --codex and nobody to ask: the question lines and the paragraphs come between the line of codex and the entry", async () => {
    const stand = standIns("codex");
    const folder = tmpDir();
    const home = tmpDir();
    const P = settingsPath();
    const r = await runIn(["--config", P, "--codex", folder], { home, pathText: stand.dir });
    assert.deepEqual(r.out.slice(0, -2), [
      madeLine(P), `onetool: init: added Codex for ${folder}`, proposalA(home), nobodyRules(fileA(home)), PARAGRAPHS_HEAD, RULES,
    ]);
    assert.deepEqual(listing(home), []);
  });

  test("with --codex: the faults of the folder and of codex come before the section: nothing is made, nothing proposed", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    const P = settingsPath();
    const missing = join(tmpDir(), "absent");
    const r = await runIn(["--config", P, "--codex", missing, "--yes"], { home, pathText: stand.dir });
    assert.equal(r.code, 1);
    assert.deepEqual(r.err, [`onetool: init: ${P}: Codex project folder does not exist`]);
    assert.deepEqual(r.out, []);
    assert.deepEqual(listing(home), []);
    const none = standIns("claude");
    const r2 = await runIn(["--config", P, "--codex", tmpDir(), "--yes"], { home, pathText: none.dir });
    assert.equal(r2.code, 1);
    assert.deepEqual(r2.err, [`onetool: init: ${P}: codex was not found on PATH`]);
    assert.deepEqual(r2.out, []);
    assert.deepEqual(listing(home), []);
  });

  test("the output holds the paths and the paragraphs only: nothing of what a file of standing instructions held", async () => {
    const stand = standIns("claude", "codex");
    const home = tmpDir();
    putBytes(fileC(home), "SECRET-TEXT-OF-THE-PERSON");
    const r = await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
    assert.ok(![...r.out, ...r.err].some((text) => text.includes("SECRET-TEXT")));
  });

  test("no environment variable changes the files: CLAUDE_CONFIG_DIR and CODEX_HOME are not read", async () => {
    const other = tmpDir();
    const saved = [process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME];
    process.env.CLAUDE_CONFIG_DIR = join(other, "c");
    process.env.CODEX_HOME = join(other, "x");
    try {
      const stand = standIns("claude", "codex");
      const home = tmpDir();
      await runIn(["--config", settingsPath(), "--yes", "--no-claude"], { home, pathText: stand.dir });
      assert.equal(bytesOf(fileC(home)).toString("utf8"), BLOCK);
      assert.equal(bytesOf(fileA(home)).toString("utf8"), BLOCK);
      assert.deepEqual(listing(other), []);
    } finally {
      for (const [name, value] of [["CLAUDE_CONFIG_DIR", saved[0]], ["CODEX_HOME", saved[1]]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("no line of the output is exactly `{` before the entry, and nothing ends with a line break", async () => {
    const stand = standIns("claude", "codex");
    const r = await runIn(["--config", settingsPath()], { home: tmpDir(), pathText: stand.dir });
    const at = r.out.indexOf(ENTRY_HEAD);
    assert.ok(at > 0);
    assert.ok(!r.out.slice(0, at).join("\n").split("\n").includes("{"));
    for (const text of r.out) assert.ok(text === RULES || !text.endsWith("\n"), JSON.stringify(text));
  });
});
