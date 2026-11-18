import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { allRows } from "./rows.js";
import { createSignin } from "./signin.js";

const str = { type: "string" };

const TOOLS = [
  {
    name: "rows",
    description: "Returns the practice table: 5,000 rows of id, name, city and amount. Use it to try programs on a large result.",
    inputSchema: { type: "object", properties: { city: str } },
  },
  {
    name: "count",
    description: "Counts the rows of the practice table. Answers as JSON text.",
    inputSchema: { type: "object", properties: { city: str } },
  },
  {
    name: "echo",
    description: "Answers with the text it was given. Plain text.",
    inputSchema: { type: "object", properties: { text: str }, required: ["text"] },
  },
  {
    name: "fail",
    description: "Always fails. Use it to try what a program does with a failing tool.",
    inputSchema: { type: "object", properties: { reason: str } },
  },
  {
    name: "wipe",
    description: "Pretends to delete the practice table. It deletes nothing.",
    inputSchema: { type: "object", properties: {} },
  },
];

const text = (t) => ({ content: [{ type: "text", text: t }] });
const failed = (t) => ({ isError: true, ...text(t) });

/** The rows of the table, or those of the city given; `undefined` when `city` is given and is not a string. */
function chosen(args) {
  if (args.city !== undefined && typeof args.city !== "string") return undefined;
  const rows = allRows();
  return args.city === undefined ? rows : rows.filter((r) => r.city === args.city);
}

const notString = (property) => failed(`practice: ${property} must be a string`);

const HANDLERS = {
  rows(args) {
    const rows = chosen(args);
    if (rows === undefined) return notString("city");
    return { content: [{ type: "text", text: JSON.stringify({ rows }) }], structuredContent: { rows } };
  },
  count(args) {
    const rows = chosen(args);
    if (rows === undefined) return notString("city");
    return text(JSON.stringify({ count: rows.length }));
  },
  echo(args) {
    if (typeof args.text !== "string") return notString("text");
    return text(args.text);
  },
  fail(args) {
    if (args.reason !== undefined && typeof args.reason !== "string") return notString("reason");
    return failed(`practice failure: ${args.reason ?? "asked to fail"}`);
  },
  wipe() {
    return text("wiped");
  },
};

function createServer() {
  const server = new Server({ name: "practice", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: given } = request.params;
    if (!Object.hasOwn(HANDLERS, name)) throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${name}`);
    const args = given !== null && typeof given === "object" ? given : {};
    return HANDLERS[name](args);
  });
  return server;
}

const USAGE =
  "usage: node practice/src/server.js [--port <number> [--token <text>] [--signin [--expires <seconds>] [--client <id> [--secret <text>]]]]";

const WITH_WORD = ["--port", "--token", "--expires", "--client", "--secret"];

/**
 * `{port, token, signin}` from the arguments (`port` and `token` are `undefined` when not given; `signin` is
 * `undefined` or `{expires, client, secret}`); `undefined` when they are not a form of the usage.
 */
function parseArguments(argv) {
  const given = {};
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (Object.hasOwn(given, option)) return undefined;
    if (option === "--signin") given[option] = true;
    else if (WITH_WORD.includes(option) && i + 1 < argv.length) given[option] = argv[++i];
    else return undefined;
  }
  const { "--port": port, "--token": token, "--signin": signin, "--expires": expires, "--client": client, "--secret": secret } = given;
  if (argv.length === 0) return { port: undefined, token: undefined, signin: undefined };
  if (port === undefined || !/^[0-9]+$/.test(port) || Number(port) > 65535) return undefined;
  if (token === "") return undefined;
  if (signin === undefined) {
    if (expires !== undefined || client !== undefined || secret !== undefined) return undefined;
    return { port: Number(port), token, signin: undefined };
  }
  if (token !== undefined) return undefined;
  if (expires !== undefined && (!/^[0-9]+$/.test(expires) || Number(expires) < 1 || Number(expires) > 86400)) return undefined;
  if (client === "" || secret === "" || (secret !== undefined && client === undefined)) return undefined;
  return { port: Number(port), token: undefined, signin: { expires: expires === undefined ? 3600 : Number(expires), client, secret } };
}

/** The header may reach us as Latin-1 text of the bytes a client wrote in UTF-8; both spellings of the token are accepted. */
function authorized(header, token) {
  if (header === undefined) return false;
  return header === `Bearer ${token}` || Buffer.from(header, "latin1").toString("utf8") === `Bearer ${token}`;
}

async function serveRequest(req, res) {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function listen(port, token, signin) {
  const sign = signin === undefined ? undefined : createSignin(signin);
  const mcp = (req, res) =>
    serveRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  const httpServer = http.createServer((req, res) => {
    if (sign !== undefined) {
      sign.handle(req, res, () => mcp(req, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (token !== undefined && !authorized(req.headers.authorization, token)) {
      res.writeHead(401).end();
      return;
    }
    mcp(req, res);
  });
  const cannot = () => {
    process.stderr.write(`practice: cannot listen on port ${port}\n`);
    process.exit(1);
  };
  httpServer.once("error", cannot);
  httpServer.listen(port, "127.0.0.1", () => {
    httpServer.off("error", cannot);
    process.stdout.write(`practice: listening on http://127.0.0.1:${httpServer.address().port}/mcp\n`);
  });
}

const options = parseArguments(process.argv.slice(2));
if (options === undefined) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
} else if (options.port !== undefined) {
  listen(options.port, options.token, options.signin);
} else {
  const server = createServer();
  process.stdin.on("end", () => {
    server.close().catch(() => {});
  });
  await server.connect(new StdioServerTransport());
}
