// the meeting point of guide, "Step 6: background jobs": what the page holds in the new section and in the places that change.
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

const JOBS = "Background jobs";

// ---- the places that change ----------------------------------------------------------------------------------------

test("The settings file: two more rows, backgroundSeconds (7200) and maxJobs (3), each with what it is", () => {
  for (const [key, number] of [
    ["backgroundSeconds", "7200"],
    ["maxJobs", "3"],
  ]) {
    const row = rowOf(key);
    const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
    assert.ok(cells.length >= 3, `the row of ${key} has no what and no default: ${row}`);
    assert.ok(alone(number).test(row), `the row of ${key} lacks ${number}: ${row}`);
  }
  // digits with no separator
  const row = rowOf("backgroundSeconds");
  for (const separator of [",", " ", "_", ".", "'", " ", " "]) {
    assert.ok(!row.includes(`7${separator}200`), `7200 is written with a separator ${JSON.stringify(separator)}: ${row}`);
  }
});

test("The settings file: the fourteen rows of before stay", () => {
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
  ]) {
    rowOf(key);
  }
});

test("When something does not work holds the two new texts", () => {
  holds("When something does not work", "jobs may run at once", "no job");
});

test("What onetool does not do holds the sentence on the end of the jobs, and keeps the old texts", () => {
  holds("What onetool does not do", "Jobs end when onetool ends.", "SSE", "OAuth", "approvals given during the session", "the permission mode", "hooks");
});

test("the sentences of the earlier sections stay, word for word", () => {
  holds("The shell and files", "The listed folders do not wall a shell command.", "Rules on the text of a command are weak.");
  holds("Folders and rules from the host program", "A host rule can only tighten.", "The matching is onetool's own close copy of the host program's.");
  holds("The shell and files", "No permission question was shown in the try.");
});

// ---- ## Background jobs --------------------------------------------------------------------------------------------

test("Background jobs: what it is for, background: true, and the tools stay two", () => {
  holds(JOBS, "background: true", "`run`", "`search`");
  // assumed: "says the tools stay two" is checked as the word two (or the digit) and the word tools in the section
  const body = section(JOBS).text;
  assert.ok(/\b(two|2)\b/i.test(body) && /\btools\b/i.test(body), "the section does not say that the tools stay two");
});

test("Background jobs: the first fenced block is the json block of the meeting point", () => {
  const first = section(JOBS).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { backgroundSeconds: 7200, maxJobs: 3 },
  });
});

test("Background jobs: readSettings reads the first block, no bad entry, the two limits kept", () => {
  const settings = readSettings(tmpFile("jobs.json", section(JOBS).blocks[0].text));
  assert.deepEqual(settings.bad, []);
  assert.equal(settings.backgroundSeconds, 7200);
  assert.equal(settings.maxJobs, 3);
});

test("Background jobs: asking, the four states between backquotes, and progress(text)", () => {
  holds(JOBS, 'job: "j1"', "`running`", "`done`", "`failed`", "`stopped`", "progress(text)");
  // assumed: "the last 10 lines", "cut like any other answer" and "asking again gives the answer again" are checked as
  // the number 10, the word cut and the word again, in the text outside the fenced blocks
  const body = outsideBlocks(JOBS);
  assert.ok(alone("10").test(body), "the section does not say how many lines are shown (10)");
  assert.ok(/\bcut\b/i.test(body), "the section does not say that the answer is cut");
  assert.ok(/\bagain\b/i.test(body), "the section does not say that asking again gives the answer again");
});

test("Background jobs: one fenced block that is not json shows what asking answers for a job that has ended", () => {
  // assumed: "<n>" in the first line may be written as digits or as <n>
  const form = /^job j1: done, (\d+|<n>) s$/;
  const shown = section(JOBS).blocks.filter((block) => {
    if (block.tag === "json") return false;
    const lines = block.text.split("\n");
    return form.test(lines[0]) && lines.includes("--- progress ---") && lines.includes("--- answer ---");
  });
  assert.ok(shown.length >= 1, "no fenced block that is not json with a first line `job j1: done, <n> s`, `--- progress ---` and `--- answer ---`");
});

test("Background jobs: stopping and listing", () => {
  holds(JOBS, "stop: true", "jobs: true");
});

test("Background jobs: the limits, the three keys between backquotes, the defaults, 0 and the 20 kept jobs", () => {
  holds(JOBS, "`backgroundSeconds`", "`maxJobs`", "`timeoutSeconds`");
  // assumed: the defaults, the 0 and the 20 are checked as digits standing alone in the text outside the fenced blocks
  const body = outsideBlocks(JOBS);
  assert.ok(alone("7200").test(body), "the section does not say the default of backgroundSeconds (7200)");
  assert.ok(alone("3").test(body), "the section does not say the default of maxJobs (3)");
  assert.ok(alone("0").test(body), "the section does not say what 0 does");
  assert.ok(alone("20").test(body), "the section does not say that the last 20 ended jobs are kept");
});

test("Background jobs: what stays the same, the rules, the trail and the log, ask, state", () => {
  holds(JOBS, "`allow`", "`deny`", "`ask`", "state");
  // assumed: "the trail and the log apply to a job's calls" is checked as the words trail and log in the section
  const body = outsideBlocks(JOBS);
  assert.ok(/\btrail\b/i.test(body) && /\blog\b/i.test(body), "the section does not say that the trail and the log apply");
});

test("Background jobs: the end", () => {
  holds(JOBS, "Jobs end when onetool ends.");
});

// ---- the examples --------------------------------------------------------------------------------------------------

test("the json blocks of the new section are whole settings files that readSettings accepts", () => {
  const blocks = jsonBlocks(section(JOBS).blocks);
  assert.ok(blocks.length >= 1, `${blocks.length} json blocks`);
  for (const block of blocks) {
    assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, []);
  }
});

test("there are at least nine json blocks in the page, each read by readSettings", () => {
  const blocks = jsonBlocks(page().blocks);
  assert.ok(blocks.length >= 9, `${blocks.length} json blocks`);
  for (const block of blocks) {
    assert.deepEqual(readSettings(tmpFile("block.json", block.text)).bad, [], `the json block at line ${block.line + 1}`);
  }
});
