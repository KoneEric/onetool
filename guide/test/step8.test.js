// the meeting point of guide, "Step 8: tidying the library": what the page holds in the new section and in the places that change.
// Nothing here starts a process.
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

const LIBRARY = "The library";
const TIDYING = "Tidying the library";
const TRAIL = "The trail and the log";
const TROUBLE = "When something does not work";
const NOT_DO = "What onetool does not do";

// ---- the places that change ----------------------------------------------------------------------------------------

test("The library, point 7: it holds library.restore(name), points to Tidying the library, and no longer says to move the file", () => {
  holds(LIBRARY, "library.restore(name)", TIDYING);
  // assumed: "no longer says that a person brings a program back by moving the file" is checked as no sentence of the
  // section that holds the word back, then move or moving, then file
  const sentences = section(LIBRARY).text.replace(/^```[^\n]*\n[\s\S]*?\n```$/gm, "").split(/(?<=[.!?])\s+/);
  const old = sentences.filter((sentence) => /\bback\b[^.]*\bmov(e|es|ing)\b[^.]*\bfile\b/i.test(sentence));
  assert.deepEqual(old, [], "the section still says a person brings a program back by moving the file");
});

test("The library: what it held before stays", () => {
  holds(
    LIBRARY,
    "library.save(name, { about, params, code })",
    "await lib.<name>(args)",
    "`.onetool/library`",
    "`~/.onetool/library`",
    "library: <n> programs",
    "`stats.json`",
    "replace: true",
    "The same tools in the same order is read from the text, not from a run.",
    "save it as a program",
    "does this",
    "library.remove(name)",
    "`archive`",
    "Nothing is saved without a call of library.save.",
  );
});

test("The trail and the log: the file of the sequences, and that \"log\": false switches it off", () => {
  holds(TRAIL, "`~/.onetool/sequences.jsonl`", '"log": false', "library.save", "The library");
});

test("When something does not work holds the two new texts, and the four of step 7", () => {
  holds(
    TROUBLE,
    "is in the archive",
    "remove it first",
    "calls the same tools in the same order",
    "the limit is",
    "is not a saved program",
    "the name is taken by the built-in library",
  );
});

test("What onetool does not do names the file of the sequences, holds the sentence on the model, and keeps the old texts", () => {
  holds(
    NOT_DO,
    "sequences.jsonl",
    "onetool has no model of its own.",
    "Nothing is saved without a call of library.save.",
    "SSE",
    "OAuth",
    "Jobs end when onetool ends.",
  );
});

test("the sentences of the earlier sections stay, word for word", () => {
  holds("The shell and files", "The listed folders do not wall a shell command.", "Rules on the text of a command are weak.", "No permission question was shown in the try.");
  holds("Folders and rules from the host program", "A host rule can only tighten.", "The matching is onetool's own close copy of the host program's.");
  holds("Background jobs", "Jobs end when onetool ends.");
});

// ---- ## Tidying the library ----------------------------------------------------------------------------------------

test("Tidying the library: how the work is split", () => {
  holds(TIDYING, "onetool has no model of its own.");
});

test("Tidying the library: the report", () => {
  holds(TIDYING, "library.report()", "6,000", "30 days");
});

test("Tidying the library: one fenced block that is not json shows a report", () => {
  const shown = section(TIDYING).blocks.filter((block) => {
    if (block.tag === "json") return false;
    const lines = block.text.split("\n");
    return lines.some((line) => line.startsWith("Library report: ")) && lines.includes("--- not used for 30 days ---");
  });
  assert.ok(shown.length >= 1, "no fenced block that is not json with a line `Library report: ` and the line `--- not used for 30 days ---`");
});

test("Tidying the library: where the sequences come from", () => {
  holds(TIDYING, "`~/.onetool/sequences.jsonl`");
});

test("Tidying the library: reading one program", () => {
  holds(TIDYING, "library.read(name)");
});

test("Tidying the library: the prompt tidy-library, and the sentence that nothing is changed before a yes", () => {
  holds(TIDYING, "`tidy-library`", "library.save", "library.remove", "Nothing is changed before you say yes.");
});

test("Tidying the library: bringing one back", () => {
  holds(TIDYING, "library.restore(name)", "`archive`");
});

test("Tidying the library: the rules, the three new ids between backquotes", () => {
  holds(TIDYING, "`library.report`", "`library.restore`", "`library.read`", "`allow`", "`deny`", "`ask`");
});

test("Tidying the library: the first fenced block is the json block of the meeting point", () => {
  const first = section(TIDYING).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { ask: ["library.save", "library.remove", "library.restore"] },
  });
});

test("Tidying the library: readSettings reads the first block, no bad entry, the three rules kept", () => {
  const settings = readSettings(tmpFile("tidying.json", section(TIDYING).blocks[0].text));
  assert.deepEqual(settings.bad, []);
  assert.deepEqual(settings.ask, ["library.save", "library.remove", "library.restore"]);
});

// ---- the examples --------------------------------------------------------------------------------------------------

test("the json blocks of the new section are whole settings files that readSettings accepts", () => {
  const blocks = jsonBlocks(section(TIDYING).blocks);
  assert.ok(blocks.length >= 1, `${blocks.length} json blocks`);
  for (const block of blocks) {
    assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, []);
  }
});

test("there are at least eleven json blocks in the page, each read by readSettings", () => {
  const blocks = jsonBlocks(page().blocks);
  assert.ok(blocks.length >= 11, `${blocks.length} json blocks`);
  for (const block of blocks) {
    assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, [], `the json block at line ${block.line + 1}`);
  }
});
