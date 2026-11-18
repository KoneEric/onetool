import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const BIN = join(ROOT, "bin", "onetool.js");
export const PRACTICE = join(ROOT, "practice", "src", "server.js");
export const FAKE = join(here, "fixtures", "fake-server.mjs");

export const USAGE = "usage: onetool --config <settings file>";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- files ---------------------------------------------------------------------------------------------------

const base = mkdtempSync(join(realpathSync(tmpdir()), "server-test-"));
let counter = 0;
process.on("exit", () => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {}
});

/** A new empty folder (its real path). */
export function tmpDir() {
  const dir = join(base, `d${counter++}`);
  mkdirSync(dir);
  return dir;
}

/** A path for a file that does not exist yet, in a folder of its own. */
export function tmpPath(name) {
  return join(tmpDir(), name);
}

/**
 * What every settings file of a test says (the meeting point of server, "Step 5: what every test of this part sets"): `"log": false`
 * unless the test gives a `logFolder` or a `log` of its own, and a `trail` (`false` unless the test says one). A text,
 * and a value whose `onetool` is not an object, are left as they are.
 */
function withStepFive(content) {
  const onetool = content.onetool;
  if (onetool !== undefined && (typeof onetool !== "object" || onetool === null || Array.isArray(onetool))) return content;
  const own = (key) => onetool !== undefined && Object.hasOwn(onetool, key);
  return {
    ...content,
    onetool: {
      ...(own("log") || own("logFolder") ? {} : { log: false }),
      ...(own("trail") ? {} : { trail: false }),
      ...onetool,
    },
  };
}

/** Writes a settings file (a text, or a value turned to JSON) and gives its path. */
export function writeSettings(content) {
  const path = tmpPath("settings.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(withStepFive(content)), "utf8");
  return path;
}

/** The settings of a test: the servers by name, and the `onetool` object when there is one. */
export function settingsOf(mcpServers, onetool) {
  return onetool === undefined ? { mcpServers } : { mcpServers, onetool };
}

// ---- the servers behind onetool --------------------------------------------------------------------------------

/** The practice server, the real one. */
export function practiceEntry(command = process.execPath) {
  return { command, args: [PRACTICE] };
}

const BEHAVIOURS = [
  "rec", "calls", "structured", "json", "plain", "empty", "toolerr", "rpcerr", "die", "env", "mark", "barrier", "hello",
];

/** A tool as a server lists it: a name alone gets a description and an empty schema. */
function listed(tool) {
  return typeof tool === "string"
    ? { name: tool, description: `The ${tool} tool.`, inputSchema: { type: "object", properties: {} } }
    : tool;
}

/** An entry of mcpServers that starts the fake server (fixtures/fake-server.mjs) shaped by `config`. */
export function fakeEntry(config = {}, { env = {}, args = [] } = {}) {
  const tools = (config.tools ?? BEHAVIOURS).map(listed);
  return {
    command: process.execPath,
    args: [FAKE, ...args],
    env: { FAKE_CONFIG: JSON.stringify({ ...config, tools }), ...env },
  };
}

export const FAKE_TOOL_COUNT = BEHAVIOURS.length;

// ---- polling -----------------------------------------------------------------------------------------------------

export async function waitFor(fn, ms = 3000, what = "the condition") {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() >= end) assert.fail(`gave up waiting for ${what}`);
    await sleep(20);
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** The pids of the live processes started by `pid`. */
export function childrenOf(pid) {
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,stat="], { encoding: "utf8" });
  return r.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line))
    .filter((m) => m && Number(m[2]) === pid && !m[3].startsWith("Z"))
    .map((m) => Number(m[1]));
}

// ---- onetool, spoken to with the package's own client ------------------------------------------------------------

/**
 * Runs `fn(ctx)` against the real command. `ctx` has `client`, `path` (of the settings file), `stderr()` (all of it
 * so far), `stderrLines()`, `call(name, args)` and `run(code)` (the result of the tool `run`).
 */
export async function withOnetool(settings, fn, { cwd, env } = {}) {
  const path = typeof settings === "string" ? settings : writeSettings(settings);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", path],
    cwd,
    // the meeting point of server, "Step 7: what every test of this part sets", 3: HOME is a folder the test made, never the person's own
    env: { HOME: tmpDir(), ...env },
    stderr: "pipe",
  });
  let err = "";
  transport.stderr?.on("data", (chunk) => (err += String(chunk)));
  const client = new Client({ name: "server-test", version: "0.0.0" });
  await client.connect(transport, { timeout: 10000 });
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
  const ctx = {
    client,
    path,
    stderr: () => err,
    stderrLines: () => err.split("\n").filter((line) => line !== ""),
    call,
    run: (code) => call("run", { code }),
  };
  try {
    return await fn(ctx);
  } finally {
    await client.close().catch(() => {});
  }
}

/** The one text of an answer of onetool; fails when the answer is not exactly one text item. */
export function textOf(result) {
  assert.ok(Array.isArray(result.content), "the answer has a content list");
  assert.equal(result.content.length, 1, "the answer is one item");
  assert.equal(result.content[0].type, "text");
  assert.equal(typeof result.content[0].text, "string");
  return result.content[0].text;
}

/** The text of a `run` that is not an error. */
export function okText(result) {
  assert.notEqual(result.isError, true, `the run failed: ${JSON.stringify(result.content)}`);
  return textOf(result);
}

/** The lines of `stderr()` that name a server. */
export function serverLines(ctx) {
  return ctx.stderrLines().filter((line) => line.startsWith("onetool: server "));
}

// ---- onetool as a process, spoken to in raw JSON-RPC lines -------------------------------------------------------------

export function rawOnetool(settings, { cwd = ROOT, env = {} } = {}) {
  const path = typeof settings === "string" ? settings : writeSettings(settings);
  // HOME is a folder the test made unless `env` says another one it made (the meeting point of server, "Step 7: what every test of this part sets")
  const child = spawn(process.execPath, [BIN, "--config", path], { cwd, env: { ...process.env, HOME: tmpDir(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  const waiting = new Map();
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => (err += c));
  child.stdin.on("error", () => {});
  child.stdout.on("data", (c) => {
    out += c;
    let i;
    while ((i = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, i);
      out = out.slice(i + 1);
      if (line === "") continue;
      lines.push(line);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      }
    }
  });
  const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  // a request that is waiting when the process ends will not be answered
  const rejects = new Map();
  exited.then(({ code, signal }) => {
    for (const reject of rejects.values()) reject(new Error(`the process ended (code ${code}, signal ${signal})`));
  });
  let nextId = 1;
  const api = {
    child,
    path,
    lines,
    exited,
    stderr: () => err,
    stderrLines: () => err.split("\n").filter((line) => line !== ""),
    unfinishedLine: () => out,
    send(msg) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
    },
    request(method, params, ms = 10000) {
      const id = nextId++;
      const answer = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), ms);
        rejects.set(id, (err) => {
          clearTimeout(timer);
          reject(err);
        });
        waiting.set(id, (m) => {
          clearTimeout(timer);
          rejects.delete(id);
          resolve(m);
        });
      });
      api.send({ id, method, params });
      return answer;
    },
    async initialize() {
      const res = await api.request("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "raw", version: "0.0.0" },
      });
      api.send({ method: "notifications/initialized" });
      return res;
    },
    callTool(name, args, ms) {
      return api.request("tools/call", { name, arguments: args }, ms);
    },
    /** Sends `signal`, and waits at most `ms` for the process to be gone; gives how it ended. */
    async endBy(signal, ms = 5000) {
      child.kill(signal);
      return api.within(ms);
    },
    /** The way the process ended, failing when it is still there after `ms`. */
    async within(ms = 5000) {
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the process was still there after ${ms} ms`)), ms);
      });
      try {
        return await Promise.race([exited, late]);
      } finally {
        clearTimeout(timer);
      }
    },
    /** Ends the process: for the tests that fail before they close it themselves. */
    kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
  return api;
}

/** Runs `fn(raw)` and kills the process after it, whatever happens. */
export async function withRaw(settings, fn, options) {
  const raw = rawOnetool(settings, options);
  try {
    return await fn(raw);
  } finally {
    raw.kill();
    await raw.exited;
  }
}

export function fileExists(path) {
  return existsSync(path);
}

export function fileText(path) {
  return readFileSync(path, "utf8");
}

// ---- the practice table, by the rule of the meeting point of practice --------------------------------------------------------------

const CITIES = ["Paris", "Lyon", "Lille", "Nantes", "Nice", "Brest", "Tours", "Dijon"];

/** The 5,000 rows: id, name `row-` and the id on four digits, city CITIES[(id - 1) % 8], amount (id * 37) % 1000. */
export function practiceRows() {
  const rows = [];
  for (let id = 1; id <= 5000; id++) {
    rows.push({ id, name: `row-${String(id).padStart(4, "0")}`, city: CITIES[(id - 1) % 8], amount: (id * 37) % 1000 });
  }
  return rows;
}

// The lines `search` shows for the tools of practice, by the rule of the meeting point of core ("One line per tool").
export const LINE = {
  rows: "practice.rows(city?: string) - Returns the practice table: 5,000 rows of id, name, city and amount.",
  count: "practice.count(city?: string) - Counts the rows of the practice table.",
  echo: "practice.echo(text: string) - Answers with the text it was given.",
  fail: "practice.fail(reason?: string) - Always fails.",
  wipe: "practice.wipe() - Pretends to delete the practice table.",
};
