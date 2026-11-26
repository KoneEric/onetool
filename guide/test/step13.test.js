// the meeting point of guide, "Step 13: Codex as a listed server, as the page is, and loading the tools in one request": what the
// page holds now in `Grouping the work`, in `Start with onetool init` (one more point, and the part `Codex as a listed server`
// as it is, with one new sentence) and in `What onetool does not do`. Nothing here starts a process. The length (960), the sixteen
// headings, the page with no `steps/` and none of the four words, and the json blocks (at least fifteen) are checked in
// page.test.js, step9.test.js, step12.test.js and step11.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSettings } from "../../core/src/index.js";
import { jsonBlocks, parsePage, readPage, sectionOf, tmpFile } from "./helpers.js";

const GROUPING = "Grouping the work";
const START = "Start with onetool init";
const NOT_DO = "What onetool does not do";
const CODEX = "Codex as a listed server";

const FIRST =
  "When you use onetool, group the work. Before the first run, list the steps of the task. Put every step that needs no decision into one program: loops, filters, several tools. Return only the small result you need to decide what comes next, and keep large results in state. Never use run for one tool call when the next call is already known.";
const SECOND =
  "Before the first call of a task, list every tool the task will need that is not loaded yet, and load them together in one request. Each extra request is one more model call that reads the whole context again.";
const BEGIN = "<!-- onetool: begin (added by onetool init) -->";
const END = "<!-- onetool: end -->";

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
const squeeze = (text) => text.replace(/\s+/g, " ").trim();

/**
 * The part `### Codex as a listed server` and the part of the section `Start with onetool init` that stands before it, read from
 * the lines of the page: { before, codex: { lines, blocks, text }, next } where `next` is the level 2 heading that follows it.
 */
function parts() {
  const parsed = page();
  const start = parsed.headings.find((heading) => heading.level === 2 && heading.text === START);
  assert.ok(start, `the page has no heading "## ${START}"`);
  const codex = parsed.headings.find((heading) => heading.level === 3 && heading.text === CODEX);
  assert.ok(codex, `the page has no heading "### ${CODEX}"`);
  const next = parsed.headings.find((heading) => heading.level <= 2 && heading.line > codex.line);
  const lines = parsed.lines.slice(codex.line + 1, next ? next.line : parsed.lines.length);
  return {
    parsed,
    start,
    codex,
    next,
    before: parsed.lines.slice(start.line + 1, codex.line).join("\n"),
    part: {
      lines,
      text: lines.join("\n"),
      blocks: parsed.blocks.filter((block) => block.line > codex.line && (!next || block.line < next.line)),
    },
  };
}

// ---- the part of Codex, as it is ----------------------------------------------------------------------------------

test("Codex: the heading of level 3 stands inside Start with onetool init, as its last part, and Try it first comes after it", () => {
  const { parsed, start, codex, next } = parts();
  const top = parsed.headings.filter((heading) => heading.level === 2);
  const at = top.findIndex((heading) => heading.line === start.line);
  assert.ok(codex.line > start.line);
  assert.equal(next?.text, "Try it first");
  assert.equal(next?.level, 2);
  assert.equal(top[at + 1]?.text, "Try it first", "Try it first is not the section after Start with onetool init");
  const inside = parsed.headings.filter((heading) => heading.level === 3 && heading.line > start.line && heading.line < next.line);
  assert.equal(inside.at(-1).text, CODEX, "the heading is not the last of level 3 of the section");
});

test("Codex: the page still has the heading of the other part of level 3, Another way: Claude Code as a listed server", () => {
  assert.ok(page().headings.some((heading) => heading.level === 3 && heading.text === "Another way: Claude Code as a listed server"));
});

test("Codex: a fenced sh block holds the command with --codex and a folder, and the part holds --config and says the folder must exist", () => {
  const { part } = parts();
  assert.ok(
    part.blocks.some((block) => block.tag === "sh" && block.text.includes('node bin/onetool.js init --codex "/absolute/path/to/project"')),
    'no fenced sh block holds node bin/onetool.js init --codex "/absolute/path/to/project"',
  );
  assert.ok(part.text.includes("--config"));
  // assumed: "says that the folder must exist" is read as the words "must exist" in the part (the page holds them today)
  assert.ok(part.text.includes("must exist"));
});

test("Codex: the part names the server codex between backquotes, keeps existing servers and leaves an entry named codex in place", () => {
  const { part } = parts();
  // assumed: the three sayings are read as these loose texts of the page as it is today
  assert.ok(part.text.includes("`codex`"));
  assert.ok(/existing servers/.test(part.text));
  assert.ok(/in place/.test(part.text));
});

test("Codex: the table has seven rows, Bash, Read, Write, Edit, Grep, Glob, GitHubLookup in this order, each with an example that starts await tools.codex.", () => {
  const { part } = parts();
  const rows = part.lines
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells[0] !== "Tool" && !/^:?-+:?$/.test(cells[0]));
  assert.deepEqual(rows.map((cells) => cells[0]), ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "GitHubLookup"]);
  for (const cells of rows) assert.ok(/^`await tools\.codex\./.test(cells[1]), `the example of ${cells[0]}: ${cells[1]}`);
});

test("Codex: the part holds ONETOOL_CODEX_PERMISSIONS, :workspace, 1 MiB and 30 seconds", () => {
  const { part } = parts();
  for (const text of ["ONETOOL_CODEX_PERMISSIONS", ":workspace", "1 MiB", "30 seconds"]) {
    assert.ok(part.text.includes(text), `the part does not hold ${JSON.stringify(text)}`);
  }
});

test("Codex: a fenced sh block holds the live test command, and the part has no fenced json block", () => {
  const { part } = parts();
  assert.ok(part.blocks.some((block) => block.tag === "sh" && block.text.includes("ONETOOL_LIVE_CODEX=1 node --test server/test/codex.test.js")));
  assert.deepEqual(jsonBlocks(part.blocks), []);
});

// ---- new in step 13: the one sentence of the part of Codex ---------------------------------------------------------

test("Codex: one more sentence says that init proposes the two paragraphs with --codex too: it holds --no-rules and points to Grouping the work", () => {
  const { part } = parts();
  assert.ok(part.text.includes("`--no-rules`"), "the part does not hold `--no-rules` between backquotes");
  assert.ok(part.text.includes(GROUPING), `the part does not point to the section "${GROUPING}"`);
});

// ---- ## Start with onetool init: the entry, and one more point -----------------------------------------------------

test("Start with onetool init: it holds changes no settings file of your host program, and no longer changes no file of your host program", () => {
  holds(START, "changes no settings file of your host program");
  assert.ok(!section(START).text.includes("changes no file of your host program"), "the old text is still there");
});

test("Start with onetool init: the point of the standing instructions stands before the Codex heading, holds --no-rules and points to Grouping the work", () => {
  const { before } = parts();
  assert.ok(before.includes("`--no-rules`"), "no `--no-rules` between backquotes before the heading of Codex");
  assert.ok(before.includes(GROUPING), `no pointer to "${GROUPING}" before the heading of Codex`);
});

// ---- ## Grouping the work: the points that change ------------------------------------------------------------------

test("Grouping the work: point 2 holds together, in one request, and still holds \"instructions\": false", () => {
  holds(GROUPING, "together, in one request", '"instructions": false');
});

test("Grouping the work: one fenced block with the tag text holds exactly two paragraphs, the two of the meeting point, white space aside", () => {
  const texts = section(GROUPING).blocks.filter((block) => block.tag === "text");
  assert.equal(texts.length, 1, `${texts.length} blocks with the tag text`);
  const pieces = texts[0].text.trim().split(/\n\s*\n/).map(squeeze);
  assert.deepEqual(pieces, [FIRST, SECOND]);
});

test("Grouping the work: point 7 holds `select:A,B,C` between backquotes", () => {
  holds(GROUPING, "`select:A,B,C`");
});

test("Grouping the work: point 8 holds onetool init, the two files of standing instructions and the options --yes and --no-rules between backquotes", () => {
  holds(GROUPING, "onetool init", "`~/.claude/CLAUDE.md`", "`~/.codex/AGENTS.md`", "`--yes`", "`--no-rules`");
});

test("Grouping the work: a fenced block that is neither json nor text holds the two marker lines, exact, the first before the second", () => {
  const blocks = section(GROUPING).blocks.filter((block) => block.tag !== "json" && block.tag !== "text");
  const found = blocks.find((block) => block.text.split("\n").includes(BEGIN) && block.text.split("\n").includes(END));
  assert.ok(found, "no fenced block that is neither json nor text has both marker lines");
  const lines = found.text.split("\n");
  assert.ok(lines.indexOf(BEGIN) < lines.indexOf(END));
});

test("Grouping the work: the one json block, the line of the trail and the line of the numbers stay (points 1, 3, 4 and 5)", () => {
  const body = section(GROUPING);
  assert.ok(body.text.includes("Put every step that needs no decision into one program."));
  const plain = body.blocks.filter((block) => block.tag !== "json").flatMap((block) => block.text.split("\n"));
  assert.ok(plain.includes("(the last 3 programs each made one call: they could have been one program)"));
  assert.ok(plain.includes("this session: 3 programs, 3 calls, 1.0 calls per program"));
  const blocks = jsonBlocks(body.blocks);
  assert.equal(blocks.length, 1);
  assert.deepEqual(JSON.parse(blocks[0].text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { instructions: false },
  });
  assert.deepEqual(readSettings(tmpFile("grouping.json", blocks[0].text)).bad, []);
});

// ---- ## What onetool does not do -----------------------------------------------------------------------------------

test("What onetool does not do: the point on what it writes names the two files of standing instructions, only on your yes to onetool init, at the end of the file", () => {
  const lines = section(NOT_DO).text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("- It writes"));
  assert.ok(at >= 0, 'no point that starts "- It writes"');
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("- ")) end += 1;
  const point = squeeze(lines.slice(at, end).join(" "));
  for (const text of ["`~/.claude/CLAUDE.md`", "`~/.codex/AGENTS.md`", "only on your yes to `onetool init`", "at the end of the file"]) {
    assert.ok(point.includes(text), `the point does not hold ${JSON.stringify(text)}: ${point}`);
  }
});

test("What onetool does not do: the two points of the settings files of other programs stay, word for word", () => {
  holds(
    NOT_DO,
    "It does not change the settings file of another program.",
    "It never writes a settings file of the host program. It only reads them.",
  );
});
