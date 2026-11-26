// the meeting point of guide, "Step 12: grouping the work": what the page holds now, in the new section `Grouping the work` and in
// the table of the keys of `onetool`. Nothing here starts a process. The length (960), the sixteen headings, the page with no
// `steps/` and none of the four words, and the json blocks (at least fifteen) are checked in page.test.js, step9.test.js and
// step10.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSettings } from "../../core/src/index.js";
import { HEADINGS, jsonBlocks, parsePage, readPage, sectionOf, tmpFile } from "./helpers.js";

const GROUPING = "Grouping the work";
const SETTINGS = "The settings file";

const SENTENCE = "Put every step that needs no decision into one program.";
const NOTE = "(the last 3 programs each made one call: they could have been one program)";
const NUMBERS = "this session: 3 programs, 3 calls, 1.0 calls per program";
const PASTE =
  "When you use onetool, group the work. Before the first run, list the steps of the task. Put every step that needs no decision into one program: loops, filters, several tools. Return only the small result you need to decide what comes next, and keep large results in state. Never use run for one tool call when the next call is already known.";

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
/** The fenced blocks of the section that are not `json`, each as the lines it holds. */
const plainLines = () => section(GROUPING).blocks.filter((block) => block.tag !== "json").map((block) => block.text.split("\n"));

// ---- the headings ------------------------------------------------------------------------------------------------

test("the sixteen headings: Grouping the work stands between Tidying the library and The trail and the log", () => {
  const top = page().headings.filter((heading) => heading.level === 2).map((heading) => heading.text);
  assert.equal(top.length, 16);
  const at = top.indexOf(GROUPING);
  assert.ok(at > 0, `no heading "## ${GROUPING}"`);
  assert.equal(top[at - 1], "Tidying the library");
  assert.equal(top[at + 1], "The trail and the log");
  assert.deepEqual(top, HEADINGS);
});

// ---- the table of the keys of onetool ----------------------------------------------------------------------------

test("The settings file: the last row of the table is `instructions`, true or false, on by default, with a pointer to Grouping the work", () => {
  const rows = section(SETTINGS).lines.filter((line) => line.startsWith("|"));
  const last = rows.at(-1);
  assert.ok(last.includes("`instructions`"), `the last row of the table is: ${last}`);
  assert.ok(last.includes("true") && last.includes("false"), `the row does not name true and false: ${last}`);
  assert.ok(last.includes(GROUPING), `the row does not point to the section "${GROUPING}": ${last}`);
  // assumed: the default is the last cell of the row, as in every other row
  const cells = last.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
  assert.ok(cells.length >= 3, `the row has no what and no default: ${last}`);
  assert.ok(/\b(on|true)\b/i.test(cells.at(-1)), `the default is not on: ${last}`);
});

test("The settings file: the rows of before stay", () => {
  const body = section(SETTINGS).lines;
  for (const key of [
    "answerLimit", "timeoutSeconds", "connectSeconds", "searchLimit", "stateLimit", "allow", "deny", "ask", "shell", "trail",
    "log", "logFolder", "hostRules", "hostServers", "backgroundSeconds", "maxJobs", "libraryCap",
  ]) {
    assert.ok(body.some((line) => line.startsWith("|") && line.includes(`\`${key}\``)), `no table row for \`${key}\``);
  }
});

// ---- ## Grouping the work ----------------------------------------------------------------------------------------

test("Grouping the work: at most 85 lines, its heading included (50 before step 13)", () => {
  const lines = readPage().split("\n");
  const start = lines.indexOf(`## ${GROUPING}`);
  assert.ok(start >= 0, `no heading "## ${GROUPING}"`);
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  assert.ok(end - start <= 85, `${end - start} lines`);
});

test("Grouping the work: holds the sentence of the description of run", () => {
  holds(GROUPING, SENTENCE);
});

test("Grouping the work: holds `\"instructions\": false`", () => {
  holds(GROUPING, '"instructions": false');
});

test("Grouping the work: a fenced block that is not json holds the line of the trail", () => {
  assert.ok(plainLines().some((lines) => lines.includes(NOTE)), `no fenced block that is not json has the line ${NOTE}`);
});

test("Grouping the work: a fenced block that is not json holds the line of the numbers", () => {
  assert.ok(plainLines().some((lines) => lines.includes(NUMBERS)), `no fenced block that is not json has the line ${NUMBERS}`);
});

test("Grouping the work: the one json block is the block of the meeting point, and readSettings accepts it", () => {
  const blocks = jsonBlocks(section(GROUPING).blocks);
  assert.equal(blocks.length, 1, `${blocks.length} json blocks`);
  assert.deepEqual(JSON.parse(blocks[0].text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { instructions: false },
  });
  const settings = readSettings(tmpFile("grouping.json", blocks[0].text));
  assert.deepEqual(settings.bad, []);
  assert.equal(settings.instructions, false);
});

// since step 13 the block holds two paragraphs (the meeting point of guide, "Step 13", "`## Grouping the work`: the points that change", point 6)
test("Grouping the work: the one fenced block with the tag text holds the first paragraph to paste, then a second one, white space aside", () => {
  const texts = section(GROUPING).blocks.filter((block) => block.tag === "text");
  assert.equal(texts.length, 1, `${texts.length} blocks with the tag text`);
  const pieces = texts[0].text.trim().split(/\n\s*\n/).map(squeeze);
  assert.equal(pieces.length, 2, `${pieces.length} paragraphs`);
  assert.equal(pieces[0], PASTE);
});

test("every json block of the page is read by readSettings with no problem, and there are at least fifteen", () => {
  const blocks = jsonBlocks(page().blocks);
  assert.ok(blocks.length >= 15, `${blocks.length} json blocks`);
  for (const block of blocks) {
    try {
      assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, [], `the json block at line ${block.line + 1}`);
    } catch (error) {
      if (error?.name === "AssertionError") throw error;
      assert.fail(`the json block at line ${block.line + 1} is refused: ${error.problems ?? error.message}`);
    }
  }
});
