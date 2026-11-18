// A small MCP server spoken in raw JSON-RPC lines, shaped by the JSON in the variable FAKE_CONFIG:
//   tools        the list it answers tools/list with
//   pageSize     answer the list in pages of this size
//   initError, listError, initHang, listHang, exitAtStart, exitOnList, listDelayMs
//   errorText, errorCode   the message and the code of the JSON-RPC errors it answers (by default boom, -32000)
//   pidFile, startLog, markFile   files it writes (its pid; a time per start; a line per call of `mark`)
// A tool is answered by its name whether or not it is listed (see `call` below).
import { appendFileSync, writeFileSync } from "node:fs";

const config = JSON.parse(process.env.FAKE_CONFIG ?? "{}");
if (config.pidFile) writeFileSync(config.pidFile, String(process.pid));
if (config.startLog) appendFileSync(config.startLog, `${Date.now()}\n`);
if (config.exitAtStart) process.exit(1);

const recorded = [];
const waiting = [];
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const text = (value, extra = {}) => ({ content: [{ type: "text", text: value }], ...extra });

function call(id, name, args) {
  if (name === "calls") return send({ id, result: text(JSON.stringify(recorded)) });
  recorded.push({ name, arguments: args });
  switch (name) {
    case "structured":
      return send({ id, result: text("ignored", { structuredContent: { x: 1 } }) });
    case "json":
      return send({ id, result: text('{"n":12}') });
    case "plain":
      return send({ id, result: text("hello world") });
    case "empty":
      return send({ id, result: { content: [] } });
    case "toolerr":
      return send({ id, result: text("bad things", { isError: true }) });
    case "rpcerr":
      return send({ id, error: { code: config.errorCode ?? -32000, message: config.errorText ?? "boom" } });
    case "die":
      return process.exit(0);
    case "env":
      return send({
        id,
        result: text(JSON.stringify({ env: process.env, cwd: process.cwd(), argv: process.argv.slice(2) })),
      });
    case "mark":
      appendFileSync(config.markFile, "m\n");
      return send({ id, result: text("marked") });
    case "barrier":
      waiting.push(id);
      if (waiting.length >= 2) {
        for (const waitingId of waiting.splice(0)) send({ id: waitingId, result: text("released") });
      }
      return undefined;
    default:
      return send({ id, result: text(`called ${name}`) });
  }
}

function handle(message) {
  const { id, method, params } = message;
  if (id === undefined) return;
  if (method === "initialize") {
    if (config.initHang) return;
    if (config.initError) return send({ id, error: { code: config.errorCode ?? -32000, message: config.errorText ?? "init refused" } });
    return send({
      id,
      result: {
        protocolVersion: params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0.0.0" },
      },
    });
  }
  if (method === "ping") return send({ id, result: {} });
  if (method === "tools/list") {
    if (config.exitOnList) process.exit(1);
    if (config.listHang) return;
    const answer = () => {
      if (config.listError) return send({ id, error: { code: config.errorCode ?? -32000, message: config.errorText ?? "list refused" } });
      const all = config.tools ?? [];
      if (!config.pageSize) return send({ id, result: { tools: all } });
      const start = params?.cursor ? Number(params.cursor) : 0;
      const end = start + config.pageSize;
      return send({ id, result: { tools: all.slice(start, end), ...(end < all.length ? { nextCursor: String(end) } : {}) } });
    };
    if (config.listDelayMs) setTimeout(answer, config.listDelayMs);
    else answer();
    return;
  }
  if (method === "tools/call") return call(id, params.name, params.arguments);
  return send({ id, error: { code: -32601, message: `no method ${method}` } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (line.trim() !== "") handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
