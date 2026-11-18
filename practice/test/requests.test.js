import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  startAddress,
  withClient,
  rawRequest,
  checkSameAnswers,
  checkFaults,
  INIT_BODY,
  MCP_HEADERS,
} from "./address-helpers.js";
import { expectedRows } from "./helpers.js";

const BAD_PATHS = ["/", "/mcp/", "/mcpx", "/MCP", "/other", "/mcp/extra", "/mcp/?a=1", "/api/mcp", "/mcp.json"];

describe("Step 2: requests, open to every request", () => {
  let srv;
  before(async () => {
    srv = await startAddress(["--port", "0"]);
  });
  after(() => srv?.stop());

  test("a client of the package connects at the printed address, lists the five tools and calls them: the answers of the table", async () => {
    await withClient(srv.url, undefined, async (client) => {
      await checkSameAnswers(client);
      await checkFaults(client, McpError);
    });
  });

  test("a path that is not exactly /mcp is 404, whatever the method", async () => {
    for (const path of BAD_PATHS) {
      for (const method of ["POST", "GET", "DELETE"]) {
        const r = await rawRequest(srv.port, { method, path, headers: MCP_HEADERS, body: method === "POST" ? INIT_BODY : undefined });
        assert.equal(r.status, 404, `${method} ${path}`);
      }
    }
  });

  test("a query is not part of the path", async () => {
    for (const path of ["/mcp?x=1", "/mcp?"]) {
      const r = await rawRequest(srv.port, { path, headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(r.status, 200, path);
    }
    const r = await rawRequest(srv.port, { path: "/other?a=/mcp", headers: MCP_HEADERS, body: INIT_BODY });
    assert.equal(r.status, 404);
  });

  test("with no --token the Authorization header is not looked at", async () => {
    for (const authorization of ["Bearer anything", "Basic dXNlcjpwYXNz", "garbage", ""]) {
      const r = await rawRequest(srv.port, { headers: { ...MCP_HEADERS, Authorization: authorization }, body: INIT_BODY });
      assert.equal(r.status, 200, JSON.stringify(authorization));
    }
    await withClient(srv.url, "some token nobody asked for", async (client) => {
      const res = await client.callTool({ name: "count", arguments: { city: "Nice" } });
      assert.equal(res.content[0].text, '{"count":625}');
    });
  });

  test("several clients may be connected at once; each sees the same table", async () => {
    const cities = ["Paris", "Tours", "Brest", "Dijon"];
    const clients = [];
    try {
      for (let i = 0; i < cities.length; i++) {
        const client = new Client({ name: `c${i}`, version: "0.0.0" });
        await client.connect(new StreamableHTTPClientTransport(srv.url));
        clients.push(client);
      }
      const answers = await Promise.all(
        clients.map(async (client, i) => {
          const rows = await client.callTool({ name: "rows", arguments: { city: cities[i] } });
          const echo = await client.callTool({ name: "echo", arguments: { text: `from ${i}` } });
          const count = await client.callTool({ name: "count", arguments: {} });
          return { rows: rows.structuredContent, echo: echo.content[0].text, count: count.content[0].text };
        }),
      );
      answers.forEach((a, i) => {
        assert.deepEqual(a.rows, { rows: expectedRows(cities[i]) });
        assert.equal(a.echo, `from ${i}`);
        assert.equal(a.count, '{"count":5000}');
      });
    } finally {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    }
  });

  test("a client that leaves does not stop the next one from connecting", async () => {
    for (let i = 0; i < 3; i++) {
      await withClient(srv.url, undefined, async (client) => {
        const res = await client.callTool({ name: "echo", arguments: { text: `round ${i}` } });
        assert.equal(res.content[0].text, `round ${i}`);
      });
    }
  });

  test("a refused or malformed request leaves the server running and answering the next one", async () => {
    const attempts = [
      { path: "/nope", headers: MCP_HEADERS, body: INIT_BODY },
      { headers: MCP_HEADERS, body: "{not json" },
      { headers: MCP_HEADERS, body: "" },
      { headers: MCP_HEADERS, body: "[]" },
      { headers: MCP_HEADERS, body: '{"jsonrpc":"2.0"}' },
      { headers: { ...MCP_HEADERS, "Content-Type": "text/plain" }, body: INIT_BODY },
      { headers: { "Content-Type": "application/json" }, body: INIT_BODY },
      { method: "GET", headers: { Accept: "application/json" } },
      { method: "DELETE", headers: MCP_HEADERS },
      { method: "PUT", headers: MCP_HEADERS, body: INIT_BODY },
    ];
    for (const attempt of attempts) {
      // Whatever the answer is, or whether there is one, is left open; what follows is not.
      await rawRequest(srv.port, attempt, 1500).catch(() => {});
      await withClient(srv.url, undefined, async (client) => {
        const res = await client.callTool({ name: "echo", arguments: { text: "next" } });
        assert.equal(res.content[0].text, "next");
      });
    }
  });

  test("it prints nothing more on either output, whatever it was asked", async () => {
    assert.equal(srv.stdout(), srv.line);
    assert.equal(srv.stderr(), "");
  });
});

describe("Step 2: requests, with a token", () => {
  const TOKEN = "--sécret tok en";
  let srv;
  before(async () => {
    srv = await startAddress(["--port", "0", "--token", TOKEN]);
  });
  after(() => srv?.stop());

  test("a client sending the header connects, lists the five tools and calls them: the answers of the table", async () => {
    await withClient(srv.url, TOKEN, async (client) => {
      await checkSameAnswers(client);
      await checkFaults(client, McpError);
    });
  });

  test("a client without the header does not connect; nor one with another token", async () => {
    await assert.rejects(() => withClient(srv.url, undefined, async () => {}));
    await assert.rejects(() => withClient(srv.url, "not the token", async () => {}));
    await assert.rejects(() => withClient(srv.url, TOKEN.toUpperCase(), async () => {}));
  });

  test("the header must be exactly 'Bearer <text>': anything else is 401, whatever the method", async () => {
    const wrong = [
      undefined,
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(0, -1)}`,
      `Bearer x${TOKEN}`,
      `bearer ${TOKEN}`,
      `BEARER ${TOKEN}`,
      `Bearer ${TOKEN.toUpperCase()}`,
      `Bearer  ${TOKEN}`,
      TOKEN,
      `Basic ${TOKEN}`,
      "Bearer",
      "Bearer ",
      "Bearer null",
    ];
    for (const authorization of wrong) {
      const headers = { ...MCP_HEADERS };
      if (authorization !== undefined) headers.Authorization = authorization;
      for (const method of ["POST", "GET", "DELETE"]) {
        const r = await rawRequest(srv.port, { method, headers, body: method === "POST" ? INIT_BODY : undefined });
        assert.equal(r.status, 401, `${method} with ${JSON.stringify(authorization)}`);
      }
    }
    const ok = await rawRequest(srv.port, { headers: { ...MCP_HEADERS, Authorization: `Bearer ${TOKEN}` }, body: INIT_BODY });
    assert.equal(ok.status, 200);
  });

  test("the path is tested first: a wrong path is 404 with or without the token; a query is not part of the path", async () => {
    for (const path of ["/", "/mcp/", "/mcpx", "/other?x=1"]) {
      const without = await rawRequest(srv.port, { path, headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(without.status, 404, `${path} without the header`);
      const wrong = await rawRequest(srv.port, { path, headers: { ...MCP_HEADERS, Authorization: "Bearer nope" }, body: INIT_BODY });
      assert.equal(wrong.status, 404, `${path} with a wrong token`);
      const right = await rawRequest(srv.port, { path, headers: { ...MCP_HEADERS, Authorization: `Bearer ${TOKEN}` }, body: INIT_BODY });
      assert.equal(right.status, 404, `${path} with the token`);
    }
    const query = await rawRequest(srv.port, { path: "/mcp?x=1", headers: MCP_HEADERS, body: INIT_BODY });
    assert.equal(query.status, 401);
    const queryOk = await rawRequest(srv.port, { path: "/mcp?x=1", headers: { ...MCP_HEADERS, Authorization: `Bearer ${TOKEN}` }, body: INIT_BODY });
    assert.equal(queryOk.status, 200);
  });

  test("refused requests leave the server running and answering the next one", async () => {
    for (let i = 0; i < 3; i++) {
      await rawRequest(srv.port, { headers: MCP_HEADERS, body: INIT_BODY });
      await rawRequest(srv.port, { path: "/zzz", headers: MCP_HEADERS, body: INIT_BODY });
      await assert.rejects(() => withClient(srv.url, undefined, async () => {}));
      await withClient(srv.url, TOKEN, async (client) => {
        const res = await client.callTool({ name: "echo", arguments: { text: `after refusal ${i}` } });
        assert.equal(res.content[0].text, `after refusal ${i}`);
      });
    }
  });

  test("a malformed request that carries the token leaves the server running", async () => {
    const headers = { ...MCP_HEADERS, Authorization: `Bearer ${TOKEN}` };
    for (const body of ["{not json", "", "[]"]) {
      await rawRequest(srv.port, { headers, body }, 1500).catch(() => {});
      await withClient(srv.url, TOKEN, async (client) => {
        await client.ping();
      });
    }
  });

  test("it prints nothing more on either output, whatever it was asked", async () => {
    assert.equal(srv.stdout(), srv.line);
    assert.equal(srv.stderr(), "");
  });
});
