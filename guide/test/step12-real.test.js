// the meeting point of guide, "Step 12", "The runs through the real thing", run 11: the real command, started with
// `process.execPath` in the root of the repository, the real practice server, the client of the package, `HOME` an empty folder
// of the test. Nothing is replaced. Every wait has a limit of 10 seconds or less.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { INSTRUCTIONS } from "../../core/src/index.js";
import { EXAMPLE, ROOT, jsonBlocks, parsePage, readPage, sectionOf, tmpDir, tmpFile } from "./helpers.js";

const GROUPING = "Grouping the work";
const BIN = join(ROOT, "bin", "onetool.js");

const textOf = (result) =>
  (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");

/** `promise`, or a failure after 10 seconds. */
const within = (promise, what) => {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer in 10 seconds`)), 10000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

/** One onetool process on the settings `settings`, the package's client in front of it, HOME a folder of the test. */
async function start(settings) {
  const file = tmpFile("settings.json", JSON.stringify(settings));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", file],
    cwd: ROOT,
    stderr: "pipe",
    env: { ...getDefaultEnvironment(), HOME: tmpDir("home") },
  });
  const client = new Client({ name: "guide-test", version: "1.0.0" }, { capabilities: {} });
  try {
    await within(client.connect(transport), "connect");
  } catch (error) {
    await transport.close().catch(() => {});
    throw error;
  }
  return {
    client,
    run: async (code) => {
      const result = await within(client.callTool({ name: "run", arguments: { code } }), "run");
      return { text: textOf(result), isError: result.isError === true };
    },
    search: async () => textOf(await within(client.callTool({ name: "search", arguments: {} }), "search")),
    close: async () => {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    },
  };
}

/** The line of a fenced block that is not json of the section, found by its start. */
const lineOfPage = (start) => {
  const section = sectionOf(parsePage(readPage()), GROUPING);
  assert.ok(section, `the page has no section "## ${GROUPING}"`);
  const found = section.blocks
    .filter((block) => block.tag !== "json")
    .flatMap((block) => block.text.split("\n"))
    .filter((line) => line.startsWith(start));
  assert.ok(found.length >= 1, `no line of a fenced block of the section starts with ${JSON.stringify(start)}`);
  return found[0];
};

test("run 11: the instructions, the line of the trail, the line of the session, and the block of the section with the instructions off", { timeout: 90000 }, async () => {
  const section = sectionOf(parsePage(readPage()), GROUPING);
  assert.ok(section, `the page has no section "## ${GROUPING}"`);
  const block = jsonBlocks(section.blocks)[0];
  assert.ok(block, `no json block in the section "## ${GROUPING}"`);
  const note = lineOfPage("(the last 3 programs");
  const numbers = lineOfPage("this session: ");

  // the block of the page: a copy of settings.example.json with the trail on, the log off, a time limit
  const example = JSON.parse(readFileSync(EXAMPLE, "utf8"));
  example.onetool = { ...example.onetool, log: false, trail: true, timeoutSeconds: 10 };
  const first = await start(example);
  try {
    const told = first.client.getInstructions();
    assert.equal(typeof told, "string");
    assert.ok(told.length > 0 && told.length <= 600, `${told.length} characters`);
    assert.equal(told, INSTRUCTIONS);

    const one = await first.run('(await tools.practice.count({ city: "Lyon" })).count');
    const two = await first.run('await tools.practice.echo({ text: "a" })');
    const three = await first.run('(await tools.practice.count({ city: "Paris" })).count');
    for (const answer of [one, two, three]) assert.equal(answer.isError, false, answer.text);
    assert.ok(!one.text.split("\n").includes(note), one.text);
    assert.ok(!two.text.split("\n").includes(note), two.text);
    assert.equal(three.text.split("\n").at(-1), note, three.text);

    assert.equal((await first.search()).split("\n").at(-1), numbers);
  } finally {
    await first.close();
  }

  // the json block of the section, with the log off: no instructions, and still the two tools
  const second = JSON.parse(block.text);
  second.onetool = { ...second.onetool, log: false };
  const off = await start(second);
  try {
    assert.equal(off.client.getInstructions(), undefined);
    const listed = await within(off.client.listTools(), "tools/list");
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["run", "search"]);
  } finally {
    await off.close();
  }
});
