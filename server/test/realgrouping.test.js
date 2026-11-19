// Step 12 through the real thing (the meeting point of server, "Grouping, through the real thing"): the command started as a process
// with a home of the test, the client of the MCP package on its standard input and output, nothing replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BIN, PRACTICE, ROOT, textOf, tmpDir, writeSettings } from "./helpers.js";
import { ECHO, INSTRUCTIONS, LYON, ONE_CALL_NOTE, PARIS, ROWS, SENTENCE, THREE, WIPE, callLine, linesOf } from "./grouphelpers.js";

/** One onetool process for the settings file `path`, with HOME a folder the test made; `fn` gets the client. */
async function withClient(path, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", path],
    cwd: ROOT,
    env: { HOME: tmpDir() },
    stderr: "pipe",
  });
  const client = new Client({ name: "real-grouping", version: "0.0.0" });
  await client.connect(transport, { timeout: 10000 });
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 10000 });
  const it = {
    client,
    run: async (code) => {
      const result = await call("run", { code });
      assert.notEqual(result.isError, true, JSON.stringify(result.content));
      return linesOf(textOf(result));
    },
    search: async () => textOf(await call("search", {})),
  };
  try {
    return await fn(it);
  } finally {
    await client.close().catch(() => {});
  }
}

const SETTINGS = (onetool = {}) => ({
  mcpServers: { practice: { command: process.execPath, args: [PRACTICE] } },
  onetool: { trail: true, log: false, timeoutSeconds: 10, ...onetool },
});
const NOT_IN_PARENTHESES = (lines) => lines.every((line) => !line.startsWith("("));

test("grouping through the real thing: the instructions, the line of the trail, the numbers of the session, and the switch", async () => {
  let first;
  await withClient(writeSettings(SETTINGS()), async (it) => {
    // 1. the instructions, the two tools, the sentence
    assert.equal(it.client.getInstructions(), INSTRUCTIONS);
    assert.ok(it.client.getInstructions().length <= 600);
    const { tools } = await it.client.listTools(undefined, { timeout: 10000 });
    assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
    assert.ok(tools[0].description.includes(SENTENCE));
    const all = tools.flatMap((tool) => [tool.description, ...Object.values(tool.inputSchema.properties).map((property) => property.description)]);
    assert.ok(all.join("").length < 1500, `the descriptions are ${all.join("").length} characters`);
    first = tools;

    // 2. search with no words, before any program
    assert.equal(await it.search(), "practice: 5 tools");

    // 3. three programs of one call each
    const lyon = await it.run(LYON);
    assert.equal(lyon.length, 3, lyon.join("\n"));
    assert.deepEqual(lyon.slice(0, 2), ["625", "--- calls ---"]);
    assert.match(lyon[2], callLine("practice.count", "13 chars"));
    const echo = await it.run(ECHO("a"));
    assert.equal(echo.length, 3, echo.join("\n"));
    assert.equal(echo[0], "a");
    const wipe = await it.run(WIPE);
    assert.equal(wipe.length, 4, wipe.join("\n"));
    assert.deepEqual(wipe.slice(0, 2), ["wiped", "--- calls ---"]);
    assert.match(wipe[2], callLine("practice.wipe", "5 chars"));
    assert.equal(wipe[3], "(the last 3 programs each made one call: they could have been one program)");
    assert.equal(wipe[3], ONE_CALL_NOTE);

    // 4. search with no words
    assert.equal(await it.search(), "practice: 5 tools\nthis session: 3 programs, 3 calls, 1.0 calls per program");

    // 5. one program with three calls: no line
    const grouped = await it.run(THREE);
    assert.equal(grouped.length, 5, grouped.join("\n"));
    assert.deepEqual(grouped.slice(0, 2), ["1250", "--- calls ---"]);
    for (const line of grouped.slice(2)) assert.match(line, /^practice\.(count|echo) \d+ ms \d+ chars$/);
    assert.ok(NOT_IN_PARENTHESES(grouped));

    // 6. the numbers
    assert.equal(linesOf(await it.search()).at(-1), "this session: 4 programs, 6 calls, 1.5 calls per program");

    // 7. said again after three more
    const rows = await it.run(ROWS);
    assert.equal(rows[0], "625");
    assert.ok(NOT_IN_PARENTHESES(rows));
    assert.ok(NOT_IN_PARENTHESES(await it.run(PARIS)));
    const again = await it.run(WIPE);
    assert.equal(again.at(-1), ONE_CALL_NOTE);
    assert.equal(linesOf(await it.search()).at(-1), "this session: 7 programs, 9 calls, 1.3 calls per program");
  });

  // 8. a second process with "instructions": false
  await withClient(writeSettings(SETTINGS({ instructions: false })), async (it) => {
    assert.equal(it.client.getInstructions(), undefined);
    const { tools } = await it.client.listTools(undefined, { timeout: 10000 });
    assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
    assert.equal(tools[0].description, first[0].description);
  });
});
