// the meeting point of guide, "Step 7: the library": what the page holds in the new section and in the places that change.
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
const rowOf = (key) => {
  const row = section("The settings file").lines.find((line) => line.startsWith("|") && line.includes(`\`${key}\``));
  assert.ok(row, `no table row for \`${key}\``);
  return row;
};
// the text of a section without its fenced blocks
const outsideBlocks = (name) => section(name).text.replace(/^```[^\n]*\n[\s\S]*?\n```$/gm, "");
// a number in digits, standing alone: not part of a longer number
const alone = (number) => new RegExp(`(?<![\\d.,_])${number}(?!\\d|[.,_]\\d)`);

const LIBRARY = "The library";
const TRAIL = "The trail and the log";

// ---- the places that change ----------------------------------------------------------------------------------------

test("The settings file: one more row, libraryCap (50), with what it is", () => {
  const row = rowOf("libraryCap");
  const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
  assert.ok(cells.length >= 3, `the row of libraryCap has no what and no default: ${row}`);
  assert.ok(alone("50").test(row), `the row of libraryCap lacks 50: ${row}`);
});

test("The settings file: the sixteen rows of before stay, and the five numbers", () => {
  for (const key of [
    "answerLimit",
    "timeoutSeconds",
    "connectSeconds",
    "searchLimit",
    "stateLimit",
    "allow",
    "deny",
    "ask",
    "shell",
    "trail",
    "log",
    "logFolder",
    "hostRules",
    "hostServers",
    "backgroundSeconds",
    "maxJobs",
  ]) {
    rowOf(key);
  }
  for (const [key, number] of Object.entries({ answerLimit: 8000, timeoutSeconds: 60, connectSeconds: 30, searchLimit: 10, stateLimit: 10000000 })) {
    assert.ok(alone(number).test(rowOf(key)), `the row of ${key} lacks ${number}`);
  }
});

test("The settings file: a server named library is not connected, the name is the built-in library's", () => {
  holds("The settings file", "`library`");
});

test("The trail and the log: a trail may end with a line of the library, the log keeps library.save", () => {
  // assumed: "points to the section `The library`" is checked as the name of the section standing in the text
  holds(TRAIL, "The library", "library.save");
});

test("When something does not work holds the four new texts", () => {
  holds(
    "When something does not work",
    "calls the same tools in the same order",
    "the limit is",
    "is not a saved program",
    "the name is taken by the built-in library",
  );
});

test("What onetool does not do holds the sentence on saving, names the library folders and archives, and keeps the old texts", () => {
  holds("What onetool does not do", "Nothing is saved without a call of library.save.", "SSE", "Jobs end when onetool ends.");
  // assumed: "names the library folders and their archives" is checked as the words library and archive in the section
  const body = section("What onetool does not do").text;
  assert.ok(/\blibrary\b/i.test(body) && /\barchive/i.test(body), "the section does not name the library folders and their archives");
});

test("the sentences of the earlier sections stay, word for word", () => {
  holds("The shell and files", "The listed folders do not wall a shell command.", "Rules on the text of a command are weak.", "No permission question was shown in the try.");
  holds("Folders and rules from the host program", "A host rule can only tighten.", "The matching is onetool's own close copy of the host program's.");
  holds("Background jobs", "Jobs end when onetool ends.");
});

// ---- ## The library ------------------------------------------------------------------------------------------------

test("The library: what it is for, library.save(...) and lib.<name>(args), a name of at most 40", () => {
  holds(LIBRARY, "library.save(name, { about, params, code })", "await lib.<name>(args)");
  // assumed: "a name (letters, digits and _, at most 40)" is checked as the number 40 in the text outside the blocks
  assert.ok(alone("40").test(outsideBlocks(LIBRARY)), "the section does not say the longest name (40)");
});

test("The library: the first fenced block is the json block of the meeting point", () => {
  const first = section(LIBRARY).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { libraryCap: 50, ask: ["library.save", "library.remove"] },
  });
});

test("The library: readSettings reads the first block, no bad entry, the cap and the two rules kept", () => {
  const settings = readSettings(tmpFile("library.json", section(LIBRARY).blocks[0].text));
  assert.deepEqual(settings.bad, []);
  assert.equal(settings.libraryCap, 50);
  assert.deepEqual(settings.ask, ["library.save", "library.remove"]);
});

test("The library: where the files are, the two folders between backquotes", () => {
  holds(LIBRARY, "`.onetool/library`", "`~/.onetool/library`");
});

test("The library: one fenced block that is not json shows a program file, with its about and params lines", () => {
  const shown = section(LIBRARY).blocks.filter((block) => {
    if (block.tag === "json") return false;
    const lines = block.text.split("\n");
    return lines.some((line) => line.startsWith("// about: ")) && lines.some((line) => line.startsWith("// params:"));
  });
  assert.ok(shown.length >= 1, "no fenced block that is not json with a line `// about: ` and a line `// params:`");
});

test("The library: finding them", () => {
  holds(LIBRARY, "library: <n> programs");
});

test("The library: what keeps it small", () => {
  holds(
    LIBRARY,
    "`stats.json`",
    "replace: true",
    "The same tools in the same order is read from the text, not from a run.",
  );
  // assumed: "libraryCap (50 by default)" and "failed 5 times in a row" are checked as the word libraryCap and the
  // digits 50 and 5 standing alone in the text outside the fenced blocks
  const body = outsideBlocks(LIBRARY);
  assert.ok(body.includes("libraryCap"), "the section does not name libraryCap in its text");
  assert.ok(alone("50").test(body), "the section does not say the default of libraryCap (50)");
  assert.ok(alone("5").test(body), "the section does not say after how many failures a program is moved (5)");
});

test("The library: the lines of the trail", () => {
  holds(LIBRARY, "save it as a program", "does this");
});

test("The library: removing, and the archive", () => {
  holds(LIBRARY, "library.remove(name)", "`archive`");
});

test("The library: the rules", () => {
  holds(
    LIBRARY,
    "Nothing is saved without a call of library.save.",
    "`library.save`",
    "`library.remove`",
    "`allow`",
    "`deny`",
    "`ask`",
  );
});

// ---- the examples --------------------------------------------------------------------------------------------------

test("the json blocks of the new section are whole settings files that readSettings accepts", () => {
  const blocks = jsonBlocks(section(LIBRARY).blocks);
  assert.ok(blocks.length >= 1, `${blocks.length} json blocks`);
  for (const block of blocks) {
    assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, []);
  }
});

test("there are at least ten json blocks in the page, each read by readSettings", () => {
  const blocks = jsonBlocks(page().blocks);
  assert.ok(blocks.length >= 10, `${blocks.length} json blocks`);
  for (const block of blocks) {
    assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, [], `the json block at line ${block.line + 1}`);
  }
});
