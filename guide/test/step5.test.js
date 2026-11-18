// the meeting point of guide, "Step 5: the host program's folders and rules, and Claude Code as a server": what the page holds in the
// new section, in the new part of "The shell and files" and in the places that change. Nothing here starts a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSettings } from "../../core/src/index.js";
import { jsonBlocks, parsePage, readPage, sectionOf, tmpFile } from "./helpers.js";

const page = () => parsePage(readPage());
const section = (name) => {
  const found = sectionOf(page(), name);
  assert.ok(found, `the page has no section "## ${name}"`);
  return found;
};
const holds = (name, ...texts) => {
  const body = section(name).text;
  for (const text of texts) assert.ok(body.includes(text), `"## ${name}" does not hold ${JSON.stringify(text)}`);
};
const rowOf = (key) => {
  const row = section("The settings file").lines.find((line) => line.startsWith("|") && line.includes(`\`${key}\``));
  assert.ok(row, `no table row for \`${key}\``);
  return row;
};

const SHELL = "The shell and files";
const HOST = "Folders and rules from the host program";
const ANOTHER = "### Another way: Claude Code as a listed server";
const NO_FOLDER = "no folder: onetool.shell.folders is not set and the host program gave none";
// "may be left out" in the words of the meeting point, or the usual ones for the same thing
const LEFT_OUT = /left out|omitted|optional|not required|can be left/i;

/** The lines of the part "Another way" of the section "The shell and files": its heading to the end of the section. */
function another() {
  const lines = section(SHELL).lines;
  const start = lines.indexOf(ANOTHER);
  assert.ok(start >= 0, `"## ${SHELL}" has no line ${JSON.stringify(ANOTHER)}`);
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return { lines: lines.slice(start, end), start };
}

// ---- Try it first, The settings file ----------------------------------------------------------------------------

test("The settings file: two more rows, hostRules (default on) and hostServers (default none), each with what it is", () => {
  for (const [key, word] of [
    ["hostRules", /\bon\b/i],
    ["hostServers", /\bnone\b/i],
  ]) {
    const row = rowOf(key);
    const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
    assert.ok(cells.length >= 3, `the row of ${key} has no what and no default: ${row}`);
    assert.ok(word.test(cells[cells.length - 1]), `the default of ${key} is not ${word}: ${row}`);
  }
});

test("The settings file: the twelve rows of before and the row of trail stay", () => {
  for (const key of ["answerLimit", "timeoutSeconds", "connectSeconds", "searchLimit", "stateLimit", "allow", "deny", "ask", "shell", "trail", "log", "logFolder"]) {
    rowOf(key);
  }
  const trail = rowOf("trail");
  assert.ok(/\|\s*on\s*\|\s*$/.test(trail) && !/shell/i.test(trail), trail);
});

test("The settings file: the row of shell says that folders may be left out", () => {
  // assumed: "says that `folders` may be left out" is checked as `folders` and one of the words in LEFT_OUT in the row
  const row = rowOf("shell");
  assert.ok(row.includes("folders"), row);
  assert.ok(LEFT_OUT.test(row), row);
});

// ---- The shell and files -----------------------------------------------------------------------------------------

test("The shell and files: folders may be left out, and the section points to the new section", () => {
  // assumed: the same words as in the row of shell
  const body = section(SHELL).text;
  assert.ok(LEFT_OUT.test(body), "the section does not say that folders may be left out");
  assert.ok(body.includes(HOST), `the section does not point to "${HOST}"`);
  assert.ok(body.includes("host program"), "the section does not say that the host program gives the folders");
});

test("The shell and files: its first fenced block is unchanged", () => {
  const first = section(SHELL).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { shell: { folders: ["/absolute/path/to/project"], deny: ["rm *"], ask: ["git push*"] } },
  });
});

// ---- When something does not work, What onetool does not do ------------------------------------------------------

test("When something does not work holds the three new texts", () => {
  holds(
    "When something does not work",
    NO_FOLDER,
    "onetool: host rules: this host program is not known",
    "cannot be read, its rules are not applied",
  );
});

test("What onetool does not do holds what is not copied of the host program's permissions", () => {
  holds("What onetool does not do", "approvals given during the session", "the permission mode", "hooks", "SSE");
});

// ---- ## Folders and rules from the host program -----------------------------------------------------------------

test("Folders and rules: folders from the roots of the host program", () => {
  holds(HOST, "roots", "onetool.shell", "folders", NO_FOLDER);
});

test("Folders and rules: the first fenced block is a json block with the shell and no folders", () => {
  const first = section(HOST).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { shell: {} },
  });
});

test("Folders and rules: the rules only tighten, and are on by default", () => {
  holds(HOST, "A host rule can only tighten.", '"hostRules": false', "`deny`", "`ask`", "`allow`");
});

test("Folders and rules: which host, which files", () => {
  holds(
    HOST,
    "Claude Code",
    "permissions",
    "`~/.claude/settings.json`",
    "`.claude/settings.json`",
    "`.claude/settings.local.json`",
  );
});

test("Folders and rules: what the rules apply to, four pairs of names between backquotes, and hostServers", () => {
  holds(
    HOST,
    "`Bash`",
    "`shell.run`",
    "`Read`",
    "`shell.read`",
    "`Edit`",
    "`shell.edit`",
    "`Write`",
    "`shell.write`",
    "hostServers",
  );
});

test("Folders and rules: how far to trust it", () => {
  holds(
    HOST,
    "The matching is onetool's own close copy of the host program's.",
    "Rules on the text of a command are weak.",
    "approvals given during the session",
    "the permission mode",
    "hooks",
  );
});

test("the sentence on the weak rules is also in The shell and files", () => {
  holds(SHELL, "Rules on the text of a command are weak.", "The listed folders do not wall a shell command.");
});

// ---- ### Another way: Claude Code as a listed server --------------------------------------------------------------

test("Another way: a heading of level 3, the last part of The shell and files, after its seven points", () => {
  const parsed = page();
  const heading = parsed.headings.find((one) => `${"#".repeat(one.level)} ${one.text}` === ANOTHER);
  assert.ok(heading, `no heading ${JSON.stringify(ANOTHER)}`);
  assert.equal(heading.level, 3);
  const lines = section(SHELL).lines;
  const start = lines.indexOf(ANOTHER);
  assert.ok(start >= 0, `the heading is not in "## ${SHELL}"`);
  assert.ok(!lines.slice(start + 1).some((line) => /^#{1,6} /.test(line)), "a heading comes after it in the section");
  // the seven points come before it: the last of them is the one on the limits
  const before = lines.slice(0, start).join("\n");
  for (const text of ["macOS and Linux", "The listed folders do not wall a shell command.", "Rules on the text of a command are weak."]) {
    assert.ok(before.includes(text), `${JSON.stringify(text)} does not come before the heading`);
  }
});

test("Another way: at most 40 lines, the heading and its fenced block included", () => {
  const { lines } = another();
  assert.ok(lines.length <= 40, `${lines.length} lines`);
});

test("Another way: one fenced block, the json block of the meeting point", () => {
  const { lines } = another();
  const inside = parsePage(lines.join("\n"));
  assert.equal(inside.blocks.length, 1, `${inside.blocks.length} fenced blocks`);
  assert.equal(inside.blocks[0].tag, "json");
  assert.deepEqual(JSON.parse(inside.blocks[0].text), {
    mcpServers: { claude: { command: "claude", args: ["mcp", "serve"] } },
    onetool: {
      allow: ["claude.Bash", "claude.Read", "claude.Edit", "claude.Write", "claude.Grep", "claude.Glob"],
      hostServers: ["claude"],
    },
  });
});

test("Another way: readSettings reads the block, no bad entry, hostServers kept", () => {
  const { lines } = another();
  const block = parsePage(lines.join("\n")).blocks[0];
  const settings = readSettings(tmpFile("claude.json", block.text));
  assert.deepEqual(settings.bad, []);
  assert.deepEqual(settings.hostServers, ["claude"]);
  assert.deepEqual(settings.servers, [{ name: "claude", command: "claude", args: ["mcp", "serve"], env: {} }]);
});

test("Another way: the allow list, the question not shown, the rules, the host, which to prefer", () => {
  const text = another().lines.join("\n");
  for (const wanted of [
    "Agent",
    "WebFetch",
    "No permission question was shown in the try.",
    "`allow`",
    "`deny`",
    "`ask`",
    "hostServers",
    "Bash",
    "Read",
    "Edit",
    "Write",
    "needs Claude Code installed",
  ]) {
    assert.ok(text.includes(wanted), `the part does not hold ${JSON.stringify(wanted)}`);
  }
});

// ---- the examples ------------------------------------------------------------------------------------------------

test("the json blocks of the new places are whole settings files that readSettings accepts", () => {
  const blocks = [...jsonBlocks(section(HOST).blocks), ...jsonBlocks(parsePage(another().lines.join("\n")).blocks)];
  assert.ok(blocks.length >= 2, `${blocks.length} json blocks`);
  for (const block of blocks) {
    const settings = readSettings(tmpFile("block.json", block.text));
    assert.deepEqual(settings.bad, []);
  }
});
