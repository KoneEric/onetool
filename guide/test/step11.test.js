// the meeting point of guide, "Step 11: `onetool init`, the key `tools`, and `redirectHost`": what the page holds now, in the
// new section `Start with onetool init` and in the places that changed. Nothing here starts a process. The length (960), the
// fifteen headings and the json blocks are checked in page.test.js, step9.test.js, step10.test.js and step5.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSettings } from "../../core/src/index.js";
import { HEADINGS, PAGES, ROOT, jsonBlocks, parsePage, readPage, sectionOf, tmpFile } from "./helpers.js";

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

const START = "Start with onetool init";
const ADD = "Add onetool to your host program";
const SETTINGS = "The settings file";
const SIGNING = "Signing in";
const TROUBLE = "When something does not work";
const NOT_DO = "What onetool does not do";
const FOLDERS = "Folders and rules from the host program";
const SIX = ["Bash", "Read", "Edit", "Write", "Grep", "Glob"];

// ---- the headings ------------------------------------------------------------------------------------------------

test("the sixteen headings: What you need, then Start with onetool init, then the fourteen others in the order they had", () => {
  const top = page().headings.filter((heading) => heading.level === 2).map((heading) => heading.text);
  assert.equal(top.length, 16);
  assert.equal(top[0], "What you need");
  assert.equal(top[1], START);
  assert.deepEqual(top.slice(2), [
    "Try it first",
    "Add onetool to your host program",
    "The settings file",
    "Signing in",
    "Rules: allow, deny, ask",
    "The shell and files",
    "Folders and rules from the host program",
    "Background jobs",
    "The library",
    "Tidying the library",
    "Grouping the work",
    "The trail and the log",
    "When something does not work",
    "What onetool does not do",
  ]);
  assert.deepEqual(top, HEADINGS);
});

// ---- ## Start with onetool init ----------------------------------------------------------------------------------

test("Start with onetool init: the command in a fenced sh block, and the same command from the repository", () => {
  const body = section(START);
  assert.ok(
    body.blocks.some((block) => block.tag === "sh" && block.text.includes("npx @koneeric/onetool init")),
    `no fenced sh block of "${START}" holds npx @koneeric/onetool init`,
  );
  holds(START, "node bin/onetool.js init");
});

test("Start with onetool init: the file, the option --config, and the sentence that it never removes or changes", () => {
  holds(START, "`~/.config/onetool/settings.json`", "--config", "It never removes or changes what the file already holds.");
});

test("Start with onetool init: Claude Code, what it costs, and the options --yes and --no-claude", () => {
  holds(
    START,
    "Claude Code",
    "Claude Code as a server asks no permission question: the rules of onetool are the control.",
    "`--yes`",
    "`--no-claude`",
  );
});

test("Start with onetool init: what it adds is the first json block of the section", () => {
  const first = jsonBlocks(section(START).blocks)[0];
  assert.ok(first, `"${START}" has no json block`);
  assert.deepEqual(JSON.parse(first.text), {
    mcpServers: {
      claude: { command: "/absolute/path/to/claude", args: ["mcp", "serve"], tools: SIX },
    },
    onetool: { hostServers: ["claude"] },
  });
});

test("Start with onetool init: readSettings reads that block, no bad entry, tools and hostServers kept", () => {
  const first = jsonBlocks(section(START).blocks)[0];
  assert.ok(first, `"${START}" has no json block`);
  const settings = readSettings(tmpFile("init.json", first.text));
  assert.deepEqual(settings.bad, []);
  assert.deepEqual(settings.hostServers, ["claude"]);
  assert.deepEqual(settings.servers, [
    { name: "claude", command: "/absolute/path/to/claude", args: ["mcp", "serve"], env: {}, tools: SIX },
  ]);
});

// since step 13 the text is `changes no settings file of your host program` (the meeting point of guide, "Step 13", "What changes in what is built")
test("Start with onetool init: the keys tools and hostServers, the section on the host program's rules, and no settings file of the host program", () => {
  holds(START, "`tools`", "`hostServers`", FOLDERS, "changes no settings file of your host program");
});

// ---- the places that changed -------------------------------------------------------------------------------------

test("Add onetool to your host program also says that onetool init prints the entry", () => {
  holds(ADD, "onetool init");
});

test("Add onetool to your host program: its first fenced json block and its two paths stay", () => {
  const first = section(ADD).blocks[0];
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

test("The settings file names the key `tools` between backquotes", () => {
  holds(SETTINGS, "`tools`");
});

test("Signing in holds `redirectHost` between backquotes and the address with localhost", () => {
  holds(SIGNING, "`redirectHost`", "localhost", "http://localhost:<port>/callback", "127.0.0.1");
});

test("Signing in: its two json blocks stay, and none of them holds localhost", () => {
  const blocks = jsonBlocks(section(SIGNING).blocks);
  assert.equal(blocks.length, 2, `${blocks.length} json blocks`);
  assert.deepEqual(JSON.parse(blocks[0].text), { mcpServers: { notes: { url: "https://example.com/mcp" } } });
  assert.deepEqual(JSON.parse(blocks[1].text), {
    mcpServers: {
      tracker: { url: "https://example.com/tracker/mcp", oauth: { clientId: "your-client-id", scopes: ["read"], port: 8765 } },
    },
  });
});

test("When something does not work holds nobody to ask, and the option --yes", () => {
  holds(TROUBLE, "nobody to ask", "--yes");
});

test("What onetool does not do names onetool init, and keeps the point on the settings file of another program", () => {
  holds(NOT_DO, "onetool init", "It does not change the settings file of another program.");
});

// ---- the public copy: what no file under guide/pages and guide/test holds -------------------------------------------

/** Every file under a folder, with its path, folders entered. */
function filesUnder(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(folder, entry.name)) : [join(folder, entry.name)],
  );
}

// the two folders of a home, built from halves so that this file does not hold them
const HOMES = [["/Us", "ers/"], ["/ho", "me/"]].map((halves) => halves.join(""));
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

test("no file under guide/pages and guide/test holds a home folder path or an e-mail address", () => {
  const files = [...filesUnder(PAGES), ...filesUnder(join(ROOT, "guide", "test"))];
  assert.ok(files.length >= 10, `only ${files.length} files read`);
  const found = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const home of HOMES) if (new RegExp(`${home}[A-Za-z0-9_]`).test(text)) found.push(`${file.slice(ROOT.length + 1)}: ${home}`);
    const email = EMAIL.exec(text);
    if (email) found.push(`${file.slice(ROOT.length + 1)}: ${email[0]}`);
  }
  assert.deepEqual(found, []);
});
