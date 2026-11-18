// the meeting point of guide, "Step 4: the shell, the trail and the log": what the page holds in the new sections and in the
// places that change. Nothing here starts a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage, readPage, sectionOf, jsonBlocks } from "./helpers.js";

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
// the text of a section without its fenced blocks tagged json
const outsideJson = (name) => section(name).text.replace(/^```json\n[\s\S]*?\n```$/gm, "");

const SHELL = "The shell and files";
const TRAIL = "The trail and the log";

// ---- The settings file: four more rows ---------------------------------------------------------------------------

test("The settings file: four more rows hold shell, trail, log and logFolder, each with what it is and a default", () => {
  const rows = section("The settings file").lines.filter((line) => line.startsWith("|"));
  for (const key of ["shell", "trail", "log", "logFolder"]) {
    const row = rows.find((line) => line.includes(`\`${key}\``));
    assert.ok(row, `no table row for \`${key}\``);
    const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
    assert.ok(cells.length >= 3, `the row of ${key} has no what and no default: ${row}`);
  }
});

test("The settings file: the row of trail says on when the shell is on, off otherwise", () => {
  // assumed: "says: on when the shell is on, off otherwise" is checked as the words on and off in the row
  const row = section("The settings file").lines.find((line) => line.startsWith("|") && line.includes("`trail`"));
  assert.ok(row, "no row for `trail`");
  assert.ok(/\bon\b/i.test(row) && /\boff\b/i.test(row) && /shell/i.test(row), row);
});

// ---- Try it first, When something does not work, What onetool does not do ---------------------------------------

test("When something does not work holds the four new texts", () => {
  holds(
    "When something does not work",
    "the shell is not switched on",
    "is outside the listed folders",
    "is not a folder",
    "onetool: the log cannot be written",
  );
});

test("What onetool does not do: it no longer says it writes no file, and says what it writes", () => {
  const body = section("What onetool does not do").text;
  assert.ok(!/writes no file/i.test(body), "the point 'it writes no file' is still there");
  assert.ok(/\blog\b/i.test(body), "no point on the log");
  assert.ok(body.includes("listed folders"), "no point on what programs write in the listed folders");
  assert.ok(/wall/i.test(body), "no point that it does not wall a shell command");
  holds("What onetool does not do", "SSE", "OAuth");
});

// ---- ## The shell and files --------------------------------------------------------------------------------------

test("The shell and files: onetool.shell and folders", () => {
  holds(SHELL, "onetool.shell", "folders");
});

test("The shell and files: the first fenced block is the json block of the meeting point", () => {
  const first = section(SHELL).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
    onetool: { shell: { folders: ["/absolute/path/to/project"], deny: ["rm *"], ask: ["git push*"] } },
  });
});

test("The shell and files: what a program gets", () => {
  const body = outsideJson(SHELL);
  for (const text of ["$`command`", ".text()", ".nothrow()", "read(path)", "write(path, text)", "edit(path, old, new)"]) {
    assert.ok(body.includes(text), `"## ${SHELL}" does not hold ${JSON.stringify(text)} outside its json blocks`);
  }
});

test("The shell and files: the folders limit read, write and edit", () => {
  holds(SHELL, "is outside the listed folders");
});

test("The shell and files: a shell command is not walled", () => {
  holds(SHELL, "The listed folders do not wall a shell command.");
});

test("The shell and files: the ids and the weak rules", () => {
  holds(SHELL, "shell.run", "shell.read", "shell.write", "shell.edit", "Rules on the text of a command are weak.");
});

test("The shell and files: limits", () => {
  holds(SHELL, "macOS and Linux");
});

// ---- ## The trail and the log ------------------------------------------------------------------------------------

test("The trail and the log: the trail", () => {
  holds(TRAIL, "--- calls ---", "`trail`");
});

test("The trail and the log: one fenced block that is not json shows a trail of at least two lines", () => {
  // the form of a line is the one of the runs 3 and 4: <id> <n> ms <m> chars, or refused, failed, unfinished
  const form = /^\S+\.\S+ \d+ ms (\d+ chars|refused|failed|unfinished)$/;
  const shown = section(TRAIL).blocks.filter(
    (block) => block.tag !== "json" && block.text.split("\n").filter((line) => form.test(line)).length >= 2,
  );
  assert.ok(shown.length >= 1, "no fenced block that is not json with two lines of a trail");
});

test("The trail and the log: the log", () => {
  holds(TRAIL, "calls-<date>.jsonl", "`logFolder`", '"log": false');
  for (const key of ["time", "session", "id", "args", "decision", "ms", "size", "fault"]) {
    assert.ok(section(TRAIL).text.includes(`\`${key}\``), `"## ${TRAIL}" does not hold \`${key}\``);
  }
});

test("The trail and the log: one json block is the one of the meeting point", () => {
  const blocks = jsonBlocks(section(TRAIL).blocks).map((block) => JSON.parse(block.text));
  assert.deepEqual(
    blocks.filter((value) => value.onetool?.logFolder !== undefined),
    [
      {
        mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } },
        onetool: { trail: true, log: true, logFolder: "/absolute/path/to/logs" },
      },
    ],
  );
});
