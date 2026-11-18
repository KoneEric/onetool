// the meeting point of guide, "Step 9: the page in the public copy": what "Try it first" and "Rules: allow, deny, ask"
// say now, the page that names no script of the steps, and the four words no file of the two folders holds.
// Nothing here starts a process. The four words are built from halves, so that this file does not hold them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE, PAGES, ROOT, parsePage, readPage, sectionOf } from "./helpers.js";

const page = () => parsePage(readPage());
const section = (name) => {
  const found = sectionOf(page(), name);
  assert.ok(found, `the page has no section "## ${name}"`);
  return found;
};

const TRY = "Try it first";
const RULES = "Rules: allow, deny, ask";
const COMMAND = "node bin/onetool.js --config guide/pages/settings.example.json";

// ---- Try it first ------------------------------------------------------------------------------------------------

test("Try it first holds npm test, the example file, 625, and the start by hand in a fenced sh block", () => {
  const body = section(TRY);
  for (const text of ["npm test", "guide/pages/settings.example.json", "625"]) {
    assert.ok(body.text.includes(text), `"${TRY}" does not hold ${JSON.stringify(text)}`);
  }
  assert.ok(
    body.blocks.some((block) => block.tag === "sh" && block.text.includes(COMMAND)),
    `no fenced sh block of "${TRY}" holds ${COMMAND}`,
  );
});

test("Try it first says its four points in order: npm test, the example file, the start by hand, 625", () => {
  const body = section(TRY);
  const text = body.text;
  const block = body.blocks.find((one) => one.tag === "sh" && one.text.includes(COMMAND));
  assert.ok(block, "no fenced sh block with the start by hand");
  const blockAt = text.indexOf(COMMAND);
  const npmAt = text.indexOf("npm test");
  const fileAt = text.indexOf("guide/pages/settings.example.json");
  assert.ok(npmAt >= 0 && fileAt >= 0 && blockAt >= 0);
  assert.ok(npmAt < fileAt, "the example file is named before npm test");
  assert.ok(fileAt <= blockAt, "the start by hand comes before the example file is named");
  assert.ok(text.lastIndexOf("625") > blockAt, "625 does not come after the start by hand");
});

test("Try it first names no script of the steps", () => {
  const body = section(TRY).text;
  assert.ok(!body.includes("steps/"), "Try it first holds steps/");
  assert.ok(!/\bsh steps\b/.test(body));
});

// ---- Rules: allow, deny, ask -------------------------------------------------------------------------------------

test("Rules: the sentence on which host programs can ask names no script and stops at 'versions'", () => {
  const body = section(RULES).text;
  assert.ok(!body.includes("steps/"), "Rules: allow, deny, ask holds steps/");
  const start = body.indexOf("This page does not say which host programs can ask");
  assert.ok(start >= 0, "the sentence is not there");
  const paragraph = body.slice(start).split("\n\n")[0].trim();
  assert.ok(paragraph.includes("that changes with their versions"), paragraph);
  assert.ok(paragraph.endsWith("versions."), `the paragraph does not end at "versions.": ${paragraph}`);
});

// ---- the whole page ----------------------------------------------------------------------------------------------

test("the page holds the text steps/ nowhere", () => {
  assert.ok(!readPage().includes("steps/"));
});

test("the page keeps its thirteen headings of level 2", () => {
  const top = page().headings.filter((heading) => heading.level === 2);
  assert.equal(top.length, 13);
});

// ---- four words no file of this part holds -----------------------------------------------------------------------

const WORDS = [
  ["Er", "ic"],
  ["Ground", "Zero"],
  ["fact", "ory"],
  ["MEE", "TS"],
].map((halves) => halves.join(""));

const holdsWord = (text, word) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`).test(text);

/** Every file under a folder, with its path, folders entered. */
function filesUnder(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(folder, entry.name)) : [join(folder, entry.name)],
  );
}

test("the word rule: the word alone is held, a longer word or a file name is read as the rule says", () => {
  const [first, , , fourth] = WORDS;
  assert.ok(holdsWord(`see ${first}.`, first));
  assert.ok(holdsWord(`a/${fourth}.md`, fourth));
  assert.ok(!holdsWord(`Kone${first}`, first));
  assert.ok(!holdsWord(`${first}2`, first));
  assert.ok(!holdsWord(`${first}_x`, first));
  assert.ok(!holdsWord(fourth.toLowerCase(), fourth));
});

test("no file under guide/pages and guide/test holds one of the four words", () => {
  const files = [...filesUnder(PAGES), ...filesUnder(join(ROOT, "guide", "test"))];
  assert.ok(files.length >= 10, `only ${files.length} files read`);
  assert.ok(files.includes(PAGE));
  const found = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const word of WORDS) if (holdsWord(text, word)) found.push(`${file.slice(ROOT.length + 1)}: ${word}`);
  }
  assert.deepEqual(found, []);
});
