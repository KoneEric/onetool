// the meeting point of guide, "After step 3: what "the person gave no answer" can mean": one paragraph added to "Rules: allow, deny,
// ask", after the list of the four causes and before the paragraph that starts `This page does not say which host
// programs can ask`. Since step 4 the page changes again; the paragraph, its place and the list stay.
// Nothing here starts a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE, parsePage, readPage, sectionOf } from "./helpers.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
// INSTALL.md and settings.example.json as they were before this piece
const before = readFileSync(join(fixtures, "INSTALL.before.md"), "utf8");

const NEXT = "This page does not say which host programs can ask";
const paragraphs = (text) => text.split("\n\n");
const nextIndex = (list) => list.findIndex((paragraph) => paragraph.startsWith(NEXT));

/** The paragraph that stands between the list of the four causes and the paragraph that starts NEXT. */
function added() {
  const now = paragraphs(readPage());
  const index = nextIndex(now);
  assert.ok(index > 1, `no paragraph starts ${JSON.stringify(NEXT)}`);
  return { now, index, paragraph: now[index - 1] };
}

// word for word, as the page of before step 4's last piece has it (the meeting point of guide, "Step 4", "What changes in what is
// built": the paragraph, its place and the list of the four causes stay as they are)
const PARAGRAPH = [
  "`the person gave no answer` is also what a program gets when the host program closes the question",
  "without showing it to anyone. The usual case is a host program run with no person in front of it, such as a",
  "script or a scheduled run: it says it can ask, then closes the question at once. The call was not made: the",
  "tool behind the rule did nothing. For runs with no person, take the tool out of `ask` and put it under `allow` or `deny`",
  "in the settings file of those runs.",
].join("\n");

test("the paragraph stands word for word, right before 'This page does not say...'", () => {
  const { now, index, paragraph } = added();
  assert.equal(paragraph, PARAGRAPH);
  assert.equal(now.filter((one) => one === PARAGRAPH).length, 1, "the paragraph is in the page once");
  assert.ok(index > 1);
});

test("the paragraph comes after the list of the four causes, which is unchanged", () => {
  const { now, index } = added();
  const list = now[index - 2];
  assert.equal(
    list,
    [
      "- `the host program cannot ask the person`",
      "- `the person said no`",
      "- `the person gave no answer`",
      "- `the question failed`",
    ].join("\n"),
  );
  assert.ok(before.includes(`${list}\n\n`), "the list is the old one");
});

test("the paragraph holds the exact texts: the cause, 'without showing', and ask, allow, deny in backquotes", () => {
  const { paragraph } = added();
  for (const text of ["`the person gave no answer`", "without showing", "`ask`", "`allow`", "`deny`"]) {
    assert.ok(paragraph.includes(text), `the paragraph does not hold ${JSON.stringify(text)}`);
  }
});

test("the paragraph is one paragraph: no heading, no list, no fenced block", () => {
  const { paragraph } = added();
  assert.ok(paragraph.trim().length > 0);
  for (const line of paragraph.split("\n")) {
    assert.ok(!/^\s*#/.test(line), `a heading: ${line}`);
    assert.ok(!/^\s*([-*+]|\d+[.)])\s/.test(line), `a list item: ${line}`);
    assert.ok(!line.startsWith("```"), `a fence: ${line}`);
    assert.ok(line.trim() !== "", "a blank line inside the paragraph");
  }
});

test("the paragraph is in 'Rules: allow, deny, ask'", () => {
  const { paragraph } = added();
  const body = sectionOf(parsePage(readPage()), "Rules: allow, deny, ask");
  assert.ok(body, "the section is missing");
  assert.ok(body.text.includes(paragraph));
});

test("settings.example.json and the other lines of the page are as before", () => {
  assert.equal(readFileSync(EXAMPLE, "utf8"), readFileSync(join(fixtures, "settings.example.before.json"), "utf8"));
});
