// the meeting point of guide, "What people may read", "`INSTALL.md`": the headings, what each section holds, the examples, the
// white space. Nothing here starts a process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readSettings, askRefusal } from "../../core/src/index.js";
import { HEADINGS, PAGES, PAGE, EXAMPLE, parsePage, readPage, sectionOf, jsonBlocks, tmpFile } from "./helpers.js";

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

// ---- what people may read ---------------------------------------------------------------------------------------

test("guide/pages holds the two files and nothing else", () => {
  assert.deepEqual(readdirSync(PAGES).sort(), ["INSTALL.md", "settings.example.json"]);
});

test("the page is UTF-8, has at most 960 lines (the meeting point of guide, 'Step 11': 960 since step 11), no tab and no carriage return", () => {
  const bytes = readFileSync(PAGE);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // lines as split at \n; a last empty piece after the final \n is not a line
  const count = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  assert.ok(count <= 960, `${count} lines`);
  assert.ok(!text.includes("\t"), "a tab character");
  assert.ok(!text.includes("\r"), "a carriage return");
});

test("the example settings file holds no tab", () => {
  assert.ok(!readFileSync(EXAMPLE, "utf8").includes("\t"));
});

// ---- headings ----------------------------------------------------------------------------------------------------

test("the first line is the title, and the headings of level 1 and 2 are exactly the sixteen, in order", () => {
  const parsed = page();
  assert.equal(parsed.lines[0], "# Installing onetool");
  const top = parsed.headings.filter((heading) => heading.level <= 2);
  assert.deepEqual(
    top.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`),
    ["# Installing onetool", ...HEADINGS.map((name) => `## ${name}`)],
  );
  assert.equal(top[0].line, 0);
});

// ---- what each section says --------------------------------------------------------------------------------------

test("What you need: Node 22 and npm ci", () => {
  holds("What you need", "Node 22", "npm ci");
});

test("Try it first: the example file", () => {
  holds("Try it first", "guide/pages/settings.example.json");
});

test("Add onetool to your host program: the first fenced block is the entry to paste", () => {
  const first = section("Add onetool to your host program").blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: {
      onetool: {
        command: "node",
        args: ["/absolute/path/to/onetool/bin/onetool.js", "--config", "/absolute/path/to/settings.json"],
      },
    },
  });
});

test("Add onetool to your host program: the file of Claude desktop", () => {
  holds(
    "Add onetool to your host program",
    "claude_desktop_config.json",
    "~/Library/Application Support/Claude/",
    "%APPDATA%\\Claude\\",
  );
});

test("The settings file: the two kinds of entry, each with a json block", () => {
  const body = section("The settings file");
  for (const word of ["mcpServers", "onetool", "command", "args", "env", "url", "headers"]) {
    assert.ok(body.text.includes(word), `"The settings file" does not hold ${word}`);
  }
  const entries = jsonBlocks(body.blocks).flatMap((block) => Object.values(JSON.parse(block.text).mcpServers ?? {}));
  assert.ok(entries.some((entry) => typeof entry.command === "string" && !("url" in entry)), "no block with a command entry");
  assert.ok(entries.some((entry) => typeof entry.url === "string" && !("command" in entry)), "no block with a url entry");
});

test("The settings file: a table with each key of onetool and its default", () => {
  const body = section("The settings file");
  const rows = body.lines.filter((line) => line.startsWith("|"));
  const defaults = { answerLimit: 8000, timeoutSeconds: 60, connectSeconds: 30, searchLimit: 10, stateLimit: 10000000, libraryCap: 50 };
  for (const [key, number] of Object.entries(defaults)) {
    const row = rows.find((line) => line.includes(`\`${key}\``));
    assert.ok(row, `no table row for \`${key}\``);
    // the number in digits, standing alone: not part of a longer number
    assert.ok(new RegExp(`(?<![\\d.,_])${number}(?!\\d|[.,_]\\d)`).test(row), `the row of ${key} lacks ${number}: ${row}`);
  }
  for (const key of ["allow", "deny", "ask"]) {
    assert.ok(rows.some((line) => line.includes(`\`${key}\``)), `no table row for \`${key}\``);
  }
  // digits with no separator: no 8,000 / 8 000 / 10_000_000 / 10.000.000 ...
  for (const number of ["8000", "10000000"]) {
    for (const separator of [",", " ", "_", ".", "'", " ", " "]) {
      const spelled = number.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
      assert.ok(!body.text.includes(spelled), `${JSON.stringify(spelled)} is written with a separator`);
    }
  }
});

test("Rules: allow, deny, ask: the four causes and one block with the three lists", () => {
  holds(
    "Rules: allow, deny, ask",
    "timeoutSeconds",
    "the host program cannot ask the person",
    "the person said no",
    "the person gave no answer",
    "the question failed",
  );
  // the causes are the ones askRefusal of part core writes (the meeting point of core, "askRefusal")
  const causes = ["unsupported", "decline", "cancel", "failed"].map((why) => askRefusal("a.b", "a.*", why).split(": ").pop());
  assert.deepEqual(causes, [
    "the host program cannot ask the person",
    "the person said no",
    "the person gave no answer",
    "the question failed",
  ]);
  const blocks = jsonBlocks(section("Rules: allow, deny, ask").blocks);
  const shown = blocks.filter((block) => {
    const rules = JSON.parse(block.text).onetool ?? {};
    return ["allow", "deny", "ask"].every((key) => Array.isArray(rules[key]));
  });
  assert.ok(shown.length >= 1, "no json block shows allow, deny and ask together");
});

test("When something does not work: the texts onetool writes", () => {
  holds(
    "When something does not work",
    "usage: onetool --config <settings file>",
    "settings file not found",
    "not connected (could not start)",
    "not connected (could not connect)",
    "not connected (refused the connection)",
    "not connected (bad entry:",
    "no answer in",
  );
});

test("What onetool does not do: SSE (the point on OAuth is replaced since step 10)", () => {
  holds("What onetool does not do", "SSE");
});

// ---- the examples ------------------------------------------------------------------------------------------------

test("there are at least eleven json blocks, and every one is a whole settings file that readSettings accepts", () => {
  const blocks = jsonBlocks(page().blocks);
  assert.ok(blocks.length >= 11, `${blocks.length} json blocks`);
  for (const block of blocks) {
    const path = tmpFile("block.json", block.text);
    let settings;
    try {
      settings = readSettings(path);
    } catch (error) {
      assert.fail(`the json block at line ${block.line + 1} is refused: ${error.problems ?? error.message}`);
    }
    assert.deepEqual(settings.bad, [], `the json block at line ${block.line + 1}`);
  }
});

test("a block that looks like json is tagged json, in lower case", () => {
  for (const block of page().blocks) {
    const tag = block.tag.trim();
    if (/json/i.test(tag)) assert.equal(tag, "json");
  }
});

test("a json block holds no `...`", () => {
  for (const block of jsonBlocks(page().blocks)) {
    assert.ok(!block.text.includes("..."), `the json block at line ${block.line + 1} holds ...`);
  }
});

test("the only host names are example.com and 127.0.0.1", () => {
  const text = readPage();
  const found = new Set();
  for (const match of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^\s/:"'`)\]>]+)/gi)) found.add(match[1].toLowerCase());
  for (const match of text.matchAll(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|app|co|edu|gov|me|info|xyz)\b/gi)) {
    found.add(match[0].toLowerCase());
  }
  for (const match of text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) found.add(match[0]);
  // since step 11 the word `localhost` stands in the page as text, in the section `Signing in`, and in no json block
  const word = /\blocalhost\b/i;
  const parsed = parsePage(text);
  assert.ok(!word.test(jsonBlocks(parsed.blocks).map((block) => block.text).join("\n")), "localhost in a json block");
  if (word.test(text)) assert.ok(word.test(sectionOf(parsed, "Signing in")?.text ?? ""), "localhost stands outside the section Signing in");
  found.delete("localhost");
  for (const host of found) assert.ok(["example.com", "127.0.0.1"].includes(host), `host name ${host}`);
});

test("the page holds no real key or token", () => {
  const text = readPage();
  assert.ok(!/\b(?:sk-|ghp_|gho_|github_pat_|xox[abp]-|AKIA)[A-Za-z0-9_-]{10,}/.test(text), "a key of a known kind");
  for (const match of text.matchAll(/[A-Za-z0-9]{32,}/g)) {
    assert.ok(!/\d/.test(match[0]) || !/[A-Za-z]/.test(match[0]), `a long run that looks like a key: ${match[0]}`);
  }
});
