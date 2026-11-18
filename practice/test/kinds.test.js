import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { McpError, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { withServer, expectedRows } from "./helpers.js";
import { startAddress, withClient } from "./address-helpers.js";

const textOf = (r) => r.content[0].text;

/** Not a string: the values of the table "Step 2: null and wrong kinds", and the two that are falsy. */
const NOT_STRINGS = [null, 0, 5, 1.5, false, true, [], ["a"], {}, { a: 1 }];

/** The `tools/call` request as it is sent, with `params` exactly as given. */
const call = (client, params) => client.request({ method: "tools/call", params }, CallToolResultSchema);

function assertJsonRpcError(promise, what, includes) {
  return assert.rejects(
    () => promise,
    (err) => {
      assert.ok(err instanceof McpError, `${what}: expected a JSON-RPC error, got ${err}`);
      if (includes !== undefined) assert.ok(err.message.includes(includes), `${what}: ${err.message}`);
      return true;
    },
    what,
  );
}

async function noArguments(client) {
  const rows = await call(client, { name: "rows" });
  assert.ok(!rows.isError);
  assert.deepEqual(rows.structuredContent, { rows: expectedRows() });
  assert.deepEqual(JSON.parse(textOf(rows)), { rows: expectedRows() });

  const count = await call(client, { name: "count" });
  assert.ok(!count.isError);
  assert.equal(textOf(count), '{"count":5000}');
  assert.equal(count.structuredContent, undefined);

  const echo = await call(client, { name: "echo" });
  assert.equal(echo.isError, true);
  assert.equal(echo.content.length, 1);
  assert.equal(textOf(echo), "practice: text must be a string");

  const fail = await call(client, { name: "fail" });
  assert.equal(fail.isError, true);
  assert.equal(textOf(fail), "practice failure: asked to fail");

  const wipe = await call(client, { name: "wipe" });
  assert.ok(!wipe.isError);
  assert.equal(textOf(wipe), "wiped");
}

async function wrongKinds(client) {
  for (const [name, property] of [
    ["rows", "city"],
    ["count", "city"],
    ["echo", "text"],
    ["fail", "reason"],
  ]) {
    for (const value of NOT_STRINGS) {
      const res = await client.callTool({ name, arguments: { [property]: value } });
      const what = `${name} with ${property} = ${JSON.stringify(value)}`;
      assert.equal(res.isError, true, what);
      assert.equal(res.content.length, 1, what);
      assert.equal(res.content[0].type, "text", what);
      assert.equal(textOf(res), `practice: ${property} must be a string`, what);
    }
  }
  // Still the server of before: the same call with a string works.
  assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: "fine" } })), "fine");
}

async function argumentsNotAnObject(client) {
  const kinds = [null, [], ["x"], [1, 2], "text", "", "{}", 0, 7, 1.5];
  for (const name of ["rows", "count", "echo", "fail", "wipe"]) {
    for (const value of kinds) {
      await assertJsonRpcError(call(client, { name, arguments: value }), `${name} with arguments ${JSON.stringify(value)}`);
      // The server goes on and answers the next call.
      assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Nice" } })), '{"count":625}');
    }
  }
}

async function unknownName(client) {
  const bad = [{}, { city: 5 }, { text: null }, { reason: [] }, { text: 5, city: false, reason: {} }];
  for (const args of bad) {
    await assertJsonRpcError(call(client, { name: "nope", arguments: args }), `nope with ${JSON.stringify(args)}`, "unknown tool: nope");
  }
  await assertJsonRpcError(call(client, { name: "nope" }), "nope with no arguments", "unknown tool: nope");
  await assertJsonRpcError(call(client, { name: "" , arguments: { text: 5 } }), "empty name with a number", "unknown tool: ");
  // Not an object at all: an error from the package, whose message is left open.
  for (const value of [null, [], "x", 3]) {
    await assertJsonRpcError(call(client, { name: "nope", arguments: value }), `nope with arguments ${JSON.stringify(value)}`);
  }
  assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: "ok" } })), "ok");
}

/** Every check of the section "Step 2: null and wrong kinds", on a client connected either way. */
function suite(run) {
  test("tools/call with no arguments is the same as arguments {}", async () => {
    await run(noArguments);
  });
  test("null, a number, true, a list or an object as city, text or reason is 'given and not a string'", async () => {
    await run(wrongKinds);
  });
  test("arguments that is null, a list, a string or a number is a JSON-RPC error and the server goes on", async () => {
    await run(argumentsNotAnObject);
  });
  test("an unknown tool name together with bad arguments: the unknown name wins", async () => {
    await run(unknownName);
  });
}

describe("Step 2: null and wrong kinds, on standard input and output", () => {
  suite((check) => withServer((client) => check(client)));
});

describe("Step 2: null and wrong kinds, at an address", () => {
  suite(async (check) => {
    const srv = await startAddress(["--port", "0"]);
    try {
      await withClient(srv.url, undefined, check);
      assert.equal(srv.stderr(), "");
    } finally {
      srv.stop();
    }
  });
  test("the same, behind a token", async () => {
    const srv = await startAddress(["--port", "0", "--token", "t"]);
    try {
      await withClient(srv.url, "t", async (client) => {
        await noArguments(client);
        await wrongKinds(client);
        await unknownName(client);
      });
    } finally {
      srv.stop();
    }
  });
});
