import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER = join(here, "..", "src", "server.js");
export const ROOT = join(here, "..", "..");

export const CITIES = ["Paris", "Lyon", "Lille", "Nantes", "Nice", "Brest", "Tours", "Dijon"];

/** The row of `id`, worked out by the rule of the meeting point. */
export function expectedRow(id) {
  return {
    id,
    name: `row-${String(id).padStart(4, "0")}`,
    city: CITIES[(id - 1) % 8],
    amount: (id * 37) % 1000,
  };
}

/** The 5,000 expected rows, or those of one city. */
export function expectedRows(city) {
  const all = [];
  for (let id = 1; id <= 5000; id++) all.push(expectedRow(id));
  return city === undefined ? all : all.filter((r) => r.city === city);
}

/** Runs `fn(client, stderrChunks)` against the real command, spoken to with the package's own client. */
export async function withServer(fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: ROOT, stderr: "pipe" });
  const stderr = [];
  transport.stderr?.on("data", (c) => stderr.push(String(c)));
  const client = new Client({ name: "practice-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client, stderr);
  } finally {
    await client.close();
  }
}

/** The command started by hand, spoken to in raw JSON-RPC lines. */
export function rawServer() {
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  const lines = [];
  const waiting = new Map();
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => (err += c));
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
  let nextId = 1;
  const api = {
    child,
    lines,
    exited,
    stderr: () => err,
    send(msg) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
    },
    request(method, params) {
      const id = nextId++;
      const answer = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 5000);
        waiting.set(id, (m) => {
          clearTimeout(timer);
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
    /** Ends the process: used by the tests that fail before they close it themselves. */
    kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
  return api;
}

/** The one text of a tool result, parsed as JSON. */
export function textOf(result) {
  return result.content[0].text;
}
