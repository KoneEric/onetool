import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SERVER, ROOT, CITIES, expectedRows } from "./helpers.js";

export const USAGE = "usage: node practice/src/server.js [--port <number> [--token <text>]]";
export const NAMES = ["rows", "count", "echo", "fail", "wipe"];

const children = new Set();
process.on("exit", () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
});

function launch(args) {
  const child = spawn(process.execPath, [SERVER, ...args], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  const seen = { out: "", err: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => (seen.out += c));
  child.stderr.on("data", (c) => (seen.err += c));
  const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  exited.then(() => children.delete(child));
  const kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  return { child, seen, exited, kill };
}

/** Waits for `promise`, or gives up after `ms`. */
function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gave up after ${ms} ms: ${what}`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Runs the command with `args` and waits for it to end by itself: `{code, signal, stdout, stderr}`. */
export async function runToEnd(args, ms = 5000) {
  const run = launch(args);
  try {
    const { code, signal } = await within(run.exited, ms, `the command ${args.join(" ")} did not end`);
    return { code, signal, stdout: run.seen.out, stderr: run.seen.err };
  } finally {
    run.kill();
  }
}

/**
 * Starts the command at an address and waits for its first line of standard output.
 * `{child, url, port, stdout(), stderr(), exited, stop()}`; `stop()` ends it with SIGKILL.
 */
export async function startAddress(args, ms = 4000) {
  const run = launch(args);
  const line = new Promise((resolve, reject) => {
    const check = () => {
      const i = run.seen.out.indexOf("\n");
      if (i >= 0) resolve(run.seen.out.slice(0, i + 1));
    };
    run.child.stdout.on("data", check);
    run.exited.then(({ code, signal }) =>
      reject(new Error(`the command ended (code ${code}, signal ${signal}) before it printed a line; stderr: ${run.seen.err}`)),
    );
  });
  let first;
  try {
    first = await within(line, ms, `no line of standard output from ${args.join(" ")}`);
  } catch (e) {
    run.kill();
    throw e;
  }
  const m = /^practice: listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp\n$/.exec(first);
  assert.ok(m, `the first line is not the listening line: ${JSON.stringify(first)}`);
  return {
    child: run.child,
    line: first,
    port: Number(m[1]),
    url: new URL(`http://127.0.0.1:${m[1]}/mcp`),
    stdout: () => run.seen.out,
    stderr: () => run.seen.err,
    exited: run.exited,
    stop: run.kill,
  };
}

/** Ends a started command with `signal` and returns how it ended. */
export async function endWith(srv, signal, ms = 5000) {
  srv.child.kill(signal);
  try {
    return await within(srv.exited, ms, `the command did not end on ${signal}`);
  } finally {
    srv.stop();
  }
}

/** Runs `fn(client)` with the package's own client connected to `url`, sending `Authorization` when `token` is given. */
export async function withClient(url, token, fn) {
  const opts = token === undefined ? {} : { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
  const client = new Client({ name: "practice-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url, opts));
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** One request by hand, path and headers exactly as given: `{status}`. The body is not read. */
export function rawRequest(port, { method = "POST", path = "/mcp", headers = {}, body } = {}, ms = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      resolve({ status: res.statusCode });
      res.destroy();
    });
    const timer = setTimeout(() => req.destroy(new Error(`no answer to ${method} ${path}`)), ms);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    // A string body would be written together with the head, as UTF-8; the head is Latin-1.
    req.end(body === undefined ? undefined : Buffer.from(body));
  });
}

/** An `initialize` request as a client sends it, to put in the body of a request by hand. */
export const INIT_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0.0.0" } },
});
export const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/** A port nobody listens on at the moment. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const textOf = (r) => r.content[0].text;

/** The five tools and their answers, as "Step 2: at an address" says they are the same as on standard input and output. */
export async function checkSameAnswers(client) {
  assert.equal(client.getServerVersion()?.name, "practice");
  assert.equal(client.getServerVersion()?.version, "1.0.0");
  const caps = client.getServerCapabilities();
  assert.ok(caps.tools);
  assert.equal(caps.resources, undefined);
  assert.equal(caps.prompts, undefined);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), NAMES);
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(by.rows.description, "Returns the practice table: 5,000 rows of id, name, city and amount. Use it to try programs on a large result.");
  assert.equal(by.count.description, "Counts the rows of the practice table. Answers as JSON text.");
  assert.equal(by.echo.description, "Answers with the text it was given. Plain text.");
  assert.equal(by.fail.description, "Always fails. Use it to try what a program does with a failing tool.");
  assert.equal(by.wipe.description, "Pretends to delete the practice table. It deletes nothing.");
  const shape = { rows: ["city"], count: ["city"], echo: ["text"], fail: ["reason"], wipe: [] };
  for (const name of NAMES) {
    const schema = by[name].inputSchema;
    assert.equal(schema.type, "object", name);
    assert.deepEqual(Object.keys(schema.properties), shape[name], name);
    assert.equal(by[name].outputSchema, undefined, name);
    if (name === "echo") assert.deepEqual(schema.required, ["text"]);
    else assert.ok(schema.required === undefined, `${name} has no required list`);
  }

  const all = await client.callTool({ name: "rows", arguments: {} });
  assert.ok(!all.isError);
  const expected = expectedRows();
  assert.deepEqual(all.structuredContent, { rows: expected });
  assert.equal(all.content.length, 1);
  assert.equal(all.content[0].type, "text");
  assert.deepEqual(JSON.parse(textOf(all)), { rows: expected });

  const lyon = await client.callTool({ name: "rows", arguments: { city: "Lyon" } });
  assert.deepEqual(lyon.structuredContent, { rows: expectedRows("Lyon") });
  assert.deepEqual(JSON.parse(textOf(lyon)), { rows: expectedRows("Lyon") });
  for (const city of ["lyon", "Berlin", ""]) {
    const none = await client.callTool({ name: "rows", arguments: { city } });
    assert.deepEqual(none.structuredContent, { rows: [] }, JSON.stringify(city));
    assert.deepEqual(JSON.parse(textOf(none)), { rows: [] }, JSON.stringify(city));
  }

  const count = await client.callTool({ name: "count", arguments: {} });
  assert.equal(textOf(count), '{"count":5000}');
  assert.equal(count.content.length, 1);
  assert.equal(count.structuredContent, undefined);
  for (const city of CITIES) {
    assert.equal(textOf(await client.callTool({ name: "count", arguments: { city } })), '{"count":625}', city);
  }
  assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "" } })), '{"count":0}');
  assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Paris", extra: 1 } })), '{"count":625}');

  for (const text of ["hello", "  padded \n with\tspace  ", "héllo ✓ 日本", ""]) {
    const res = await client.callTool({ name: "echo", arguments: { text } });
    assert.ok(!res.isError);
    assert.equal(res.content.length, 1);
    assert.equal(res.content[0].text, text);
    assert.equal(res.structuredContent, undefined);
  }
  const big = "x".repeat(100000);
  assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: big } })), big);

  const failed = await client.callTool({ name: "fail", arguments: { reason: "disk on fire" } });
  assert.equal(failed.isError, true);
  assert.equal(failed.content.length, 1);
  assert.equal(textOf(failed), "practice failure: disk on fire");
  assert.equal(textOf(await client.callTool({ name: "fail", arguments: {} })), "practice failure: asked to fail");
  assert.equal(textOf(await client.callTool({ name: "fail", arguments: { reason: "" } })), "practice failure: ");

  const wiped = await client.callTool({ name: "wipe", arguments: { table: "all" } });
  assert.ok(!wiped.isError);
  assert.equal(wiped.content.length, 1);
  assert.equal(textOf(wiped), "wiped");
  assert.equal(wiped.structuredContent, undefined);
  assert.equal(textOf(await client.callTool({ name: "count", arguments: {} })), '{"count":5000}');
}

/** The faults of the section "Faults", as the client sees them. */
export async function checkFaults(client, McpError) {
  for (const [name, property, args] of [
    ["rows", "city", { city: 5 }],
    ["count", "city", { city: true }],
    ["echo", "text", { text: ["a"] }],
    ["echo", "text", {}],
    ["fail", "reason", { reason: { a: 1 } }],
  ]) {
    const res = await client.callTool({ name, arguments: args });
    assert.equal(res.isError, true, name);
    assert.equal(res.content.length, 1);
    assert.equal(res.content[0].type, "text");
    assert.equal(textOf(res), `practice: ${property} must be a string`);
  }
  for (const name of ["nope", "Rows", ""]) {
    await assert.rejects(
      () => client.callTool({ name, arguments: {} }),
      (err) => {
        assert.ok(err instanceof McpError, `expected a JSON-RPC error, got ${err}`);
        assert.ok(err.message.includes(`unknown tool: ${name}`), err.message);
        return true;
      },
    );
  }
  assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: "still here" } })), "still here");
}
