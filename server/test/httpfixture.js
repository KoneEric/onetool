// A small MCP server at an address, spoken in plain JSON answers (Streamable HTTP without sessions), run inside the
// test. Its behaviour is the object `config`, which a test may change while onetool is connected:
//   tools         the list it answers tools/list with (names, or full tools)
//   pageSize      answer the list in pages of this size
//   status        every request gets this HTTP status, with a body that quotes a secret
//   wwwAuth       the WWW-Authenticate header sent with a 401
//   redirectTo    every request to /mcp gets a 307 to this address
//   notMcp        every request to /mcp is answered 200 with a text that is not JSON-RPC
//   initError, listError   JSON-RPC errors for initialize / tools/list
//   initHang, listHang     no answer to initialize / tools/list
//   listDelayMs   the list is answered after this many milliseconds
//   callMode      what a tools/call gets: "normal" (default), "status", "redirect", "notMcp", "hang"
//   hangAll       no answer to anything (the connection stays open)
//   stream        a GET is answered by an event stream that never ends
//   errorText, errorCode   the message and the code of the JSON-RPC errors
// Everything it receives is in `requests`.
import http from "node:http";

export const SECRET_BODY = "body-ZZZbody";

const defaultTools = ["hello", "rec", "calls", "rpcerr", "hang", "plain"];

function listed(tool) {
  return typeof tool === "string"
    ? { name: tool, description: `The ${tool} tool.`, inputSchema: { type: "object", properties: {} } }
    : tool;
}

/** Starts the server on a free port of 127.0.0.1. */
export async function httpServer(initial = {}) {
  const config = { ...initial };
  const requests = [];
  const recorded = [];
  const sockets = new Set();
  let aborted = 0;

  const json = (res, message, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", ...message }));
  };
  const text = (value, extra = {}) => ({ content: [{ type: "text", text: value }], ...extra });

  function listTools(res, id, params) {
    const answer = () => {
      if (config.listError) return json(res, { id, error: { code: config.errorCode ?? -32000, message: config.errorText ?? "list refused" } });
      const all = (config.tools ?? defaultTools).map(listed);
      if (!config.pageSize) return json(res, { id, result: { tools: all } });
      const start = params?.cursor ? Number(params.cursor) : 0;
      const end = start + config.pageSize;
      return json(res, { id, result: { tools: all.slice(start, end), ...(end < all.length ? { nextCursor: String(end) } : {}) } });
    };
    if (config.listHang) return;
    if (config.listDelayMs) setTimeout(answer, config.listDelayMs);
    else answer();
  }

  function callTool(res, id, name, args) {
    const mode = config.callMode ?? "normal";
    if (mode === "hang") return;
    if (mode === "status") {
      res.writeHead(500, { "content-type": "text/plain" });
      return res.end(SECRET_BODY);
    }
    if (mode === "redirect") {
      res.writeHead(307, { location: config.redirectTo });
      return res.end();
    }
    if (mode === "notMcp") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<html>${SECRET_BODY}</html>`);
    }
    if (name === "calls") return json(res, { id, result: text(JSON.stringify(recorded)) });
    recorded.push({ name, arguments: args });
    switch (name) {
      case "rpcerr":
        return json(res, { id, error: { code: config.errorCode ?? -32000, message: config.errorText ?? "boom" } });
      case "hang":
        return undefined;
      case "plain":
        return json(res, { id, result: text("hello world") });
      default:
        return json(res, { id, result: text(`called ${name}`) });
    }
  }

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    res.on("close", () => {
      if (!res.writableFinished) aborted += 1;
    });
    req.on("end", () => {
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {}
      requests.push({ method: req.method, path, url: req.url, headers: req.headers, body, at: Date.now() });
      if (config.hangAll) return;
      if (path === "/old") {
        res.writeHead(307, { location: "/mcp" });
        return res.end();
      }
      if (path !== "/mcp") {
        res.writeHead(404);
        return res.end();
      }
      if (config.status) {
        res.writeHead(config.status, {
          "content-type": "text/plain",
          ...(config.wwwAuth ? { "www-authenticate": config.wwwAuth } : {}),
        });
        return res.end(SECRET_BODY);
      }
      if (config.redirectTo && (config.callMode ?? "normal") === "normal") {
        res.writeHead(307, { location: config.redirectTo });
        return res.end();
      }
      if (config.notMcp) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<html>${SECRET_BODY}</html>`);
      }
      if (req.method === "GET") {
        if (config.stream) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          return res.write(": open\n\n");
        }
        res.writeHead(405);
        return res.end();
      }
      if (req.method === "DELETE") {
        res.writeHead(200);
        return res.end();
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.writeHead(400);
        return res.end();
      }
      const { id, method, params } = body;
      if (id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      if (method === "initialize") {
        if (config.initHang) return;
        if (config.initError) return json(res, { id, error: { code: config.errorCode ?? -32000, message: config.errorText ?? "init refused" } });
        return json(res, {
          id,
          result: {
            protocolVersion: params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "fake-http", version: "0.0.0" },
          },
        });
      }
      if (method === "ping") return json(res, { id, result: {} });
      if (method === "tools/list") return listTools(res, id, params);
      if (method === "tools/call") return callTool(res, id, params.name, params.arguments);
      return json(res, { id, error: { code: -32601, message: `no method ${method}` } });
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    config,
    port,
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    /** The JSON-RPC methods received, in order. */
    methods: () => requests.filter((r) => r.body && r.body.method).map((r) => r.body.method),
    /** How many requests ended before they were answered (the client gave up). */
    aborted: () => aborted,
    /** What the tool calls recorded. */
    recorded,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A port on which nobody listens. */
export async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Runs `fn` with a server at an address, and closes it after. */
export async function withHttp(config, fn) {
  const server = await httpServer(config);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

/** An entry of mcpServers for a server at an address. */
export const urlEntry = (server, headers) => (headers === undefined ? { url: server.url } : { url: server.url, headers });
