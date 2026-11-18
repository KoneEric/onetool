// Step 3: the run through the real thing. The command is a process, the practice server is a process behind it,
// and the client of the package speaks to it, twice. Nothing is replaced. The points are those of the meeting point of server,
// "Step 3: `ask`", "The run through the real thing".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BIN, PRACTICE, ROOT, settingsOf, textOf, tmpDir, writeSettings } from "./helpers.js";

const REAL = () => settingsOf({ practice: { command: "node", args: [PRACTICE] } }, { ask: ["practice.wipe"] });

// the meeting point of core, "`askMessage(id, rule, args, { limit })`", for askMessage("practice.wipe", "practice.wipe", {})
const QUESTION = [
  "onetool: a program wants to call practice.wipe.",
  "Arguments: {}",
  'The rule ask "practice.wipe" asks for your consent. Allow this call?',
].join("\n");
const refusal = (cause) =>
  `The program failed: Error: onetool: practice.wipe is refused by the rule ask "practice.wipe": ${cause}`;

/** The command, and a client of the package with `capabilities`; `fn(client)` runs, and the client is closed after. */
async function withClient(capabilities, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", writeSettings(REAL())],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), HOME: tmpDir() },
    stderr: "pipe",
  });
  const client = new Client({ name: "real3", version: "0.0.0" }, { capabilities });
  await client.connect(transport, { timeout: 10000 });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

const run = async (client, code) => {
  const result = await client.callTool({ name: "run", arguments: { code } }, undefined, { timeout: 20000 });
  return { text: textOf(result), isError: result.isError === true };
};

const WIPE = "await tools.practice.wipe({})";
const COUNT = '(await tools.practice.count({ city: "Lyon" })).count';

test("the run through the real thing, with a host program that can be asked", async () => {
  await withClient({ elicitation: {} }, async (client) => {
    const requests = [];
    let action = "accept";
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      requests.push(request.params);
      return { action };
    });

    // 1. tools/list gives exactly run and search; search with no words counts the five tools of practice
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
    const found = await client.callTool({ name: "search", arguments: {} });
    assert.equal(textOf(found), "practice: 5 tools");

    // 2. the person says yes
    assert.deepEqual(await run(client, WIPE), { text: "wiped", isError: false });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].message, QUESTION);
    assert.deepEqual(requests[0].requestedSchema, { type: "object", properties: {} });

    // 3. the person says no
    action = "decline";
    assert.deepEqual(await run(client, WIPE), { text: refusal("the person said no"), isError: true });

    // 4. a tool that no rule of ask covers
    const before = requests.length;
    assert.deepEqual(await run(client, COUNT), { text: "625", isError: false });
    assert.equal(requests.length, before, "no request for it");
  });
});

test("the run through the real thing, with a host program that cannot be asked", async () => {
  await withClient({}, async (client) => {
    // 5. the refusal says so
    assert.deepEqual(await run(client, WIPE), {
      text: refusal("the host program cannot ask the person"),
      isError: true,
    });
    // 6. the other tools work
    assert.deepEqual(await run(client, COUNT), { text: "625", isError: false });
  });
});
