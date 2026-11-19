// the meeting point of guide, "Step 10: signing in": what the page holds now, in the new section `Signing in` and in the
// three sections that changed. Nothing here starts a process. The length (860), the fourteen headings and the page with
// no `steps/` and none of the four words are checked in page.test.js and step9.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSettings } from "../../core/src/index.js";
import { HEADINGS, parsePage, readPage, sectionOf, jsonBlocks, tmpFile } from "./helpers.js";

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

const SIGNING = "Signing in";
const SETTINGS = "The settings file";
const TROUBLE = "When something does not work";
const NOT_DO = "What onetool does not do";
const COMMAND = "node /absolute/path/to/onetool/bin/onetool.js login notes --config /absolute/path/to/settings.json";

// ---- the headings ------------------------------------------------------------------------------------------------

test("the sixteen headings: the first five as in step 11, then Signing in, then the nine others in their order", () => {
  const top = page().headings.filter((heading) => heading.level === 2).map((heading) => heading.text);
  assert.equal(top.length, 16);
  assert.deepEqual(top.slice(0, 5), ["What you need", "Start with onetool init", "Try it first", "Add onetool to your host program", "The settings file"]);
  assert.equal(top[5], SIGNING);
  assert.deepEqual(top.slice(6), [
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

// ---- The settings file -------------------------------------------------------------------------------------------

test("The settings file names the key `oauth` between backquotes and points to the section Signing in", () => {
  holds(SETTINGS, "`oauth`", SIGNING);
});

// ---- When something does not work --------------------------------------------------------------------------------

test("When something does not work holds sign in needed, the sign-in could not be started, and no answer in", () => {
  holds(TROUBLE, "sign in needed", "the sign-in could not be started", "no answer in");
});

test("When something does not work keeps the texts of before", () => {
  holds(
    TROUBLE,
    "usage: onetool --config <settings file>",
    "settings file not found",
    "not connected (could not start)",
    "not connected (could not connect)",
    "not connected (refused the connection)",
    "not connected (bad entry:",
  );
});

// ---- What onetool does not do ------------------------------------------------------------------------------------

test("What onetool does not do: onetool login, SSE and the folder of the sign-ins; the point on OAuth is gone", () => {
  holds(NOT_DO, "onetool login", "SSE", "~/.onetool/auth");
  assert.ok(!/not sign in by OAuth/i.test(readPage()), "the page still says that onetool does not sign in by OAuth");
});

test("What onetool does not do: onetool never opens a browser by itself", () => {
  // assumed: "never opens a browser by itself" is checked as the word browser in the section
  assert.ok(/browser/i.test(section(NOT_DO).text), "no point on the browser");
});

// ---- ## Signing in -----------------------------------------------------------------------------------------------

test("Signing in: the first fenced block is the json block with the server notes", () => {
  const first = section(SIGNING).blocks[0];
  assert.ok(first, "the section has no fenced block");
  assert.equal(first.tag, "json");
  assert.deepEqual(JSON.parse(first.text), { mcpServers: { notes: { url: "https://example.com/mcp" } } });
});

test("Signing in: when it applies and what you see before", () => {
  holds(SIGNING, "`Authorization`", "sign in needed");
});

test("Signing in: the command, in a fenced sh block, and what it does", () => {
  const body = section(SIGNING);
  assert.ok(
    body.blocks.some((block) => block.tag === "sh" && block.text.includes(COMMAND)),
    `no fenced sh block of "${SIGNING}" holds ${COMMAND}`,
  );
  holds(SIGNING, "npx @koneeric/onetool login notes --config", "127.0.0.1", "300 seconds", "--no-browser", "--wait");
});

test("Signing in: where the sign-in is, and how to forget it", () => {
  holds(SIGNING, "`~/.onetool/auth`", "600", "logout notes --config");
});

test("Signing in: a server that does not let a client register itself", () => {
  holds(SIGNING, "`clientId`", "`clientSecret`", "`scopes`", "`port`", "http://127.0.0.1:<port>/callback");
});

test("Signing in: the second fenced json block is the tracker with its oauth key", () => {
  const second = jsonBlocks(section(SIGNING).blocks)[1];
  assert.ok(second, "the section has no second json block");
  assert.deepEqual(JSON.parse(second.text), {
    mcpServers: {
      tracker: {
        url: "https://example.com/tracker/mcp",
        oauth: { clientId: "your-client-id", scopes: ["read"], port: 8765 },
      },
    },
  });
});

test("Signing in: the connectors a host program signs in to itself", () => {
  holds(SIGNING, "The connectors a host program signs in to itself cannot be put behind onetool.");
});

// ---- the examples ------------------------------------------------------------------------------------------------

test("there are at least fifteen json blocks in the page, each read by readSettings", () => {
  const blocks = jsonBlocks(page().blocks);
  assert.ok(blocks.length >= 15, `${blocks.length} json blocks`);
  for (const block of blocks) {
    let settings;
    try {
      settings = readSettings(tmpFile("block.json", block.text));
    } catch (error) {
      assert.fail(`the json block at line ${block.line + 1} is refused: ${error.problems ?? error.message}`);
    }
    assert.deepEqual(settings.bad, [], `the json block at line ${block.line + 1}`);
  }
});

test("the two new json blocks of Signing in are whole settings files that readSettings accepts", () => {
  const blocks = jsonBlocks(section(SIGNING).blocks);
  assert.ok(blocks.length >= 2, `${blocks.length} json blocks`);
  for (const block of blocks) {
    const settings = readSettings(tmpFile("block.json", block.text));
    assert.deepEqual(settings.bad, []);
    assert.ok(settings.servers.length >= 1);
  }
});
