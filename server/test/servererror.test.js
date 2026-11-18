// Step 3: `isServerError`, the one place that tells whose error it is (the meeting point of server, "Step 3: `isServerError`...").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { isServerError } from "../src/connect.js";
import { fakeEntry, serverLines, settingsOf, textOf, waitFor, withOnetool } from "./helpers.js";
import { urlEntry, withHttp } from "./httpfixture.js";

const CLOSED = "Connection closed";
const CAUGHT = (call) => `try { await ${call}; return 'answered'; } catch (e) { return e.message; }`;

describe("isServerError(err)", () => {
  test("an McpError is the server's own, except a request given up and the package's own closed connection", () => {
    assert.equal(isServerError(new McpError(-32603, "boom")), true);
    assert.equal(isServerError(new McpError(ErrorCode.InvalidParams, "unknown tool: x")), true);
    assert.equal(isServerError(new McpError(ErrorCode.MethodNotFound, "no method")), true);
    // a request given up after its timeout
    assert.equal(isServerError(new McpError(ErrorCode.RequestTimeout, "Request timed out")), false);
    // the package's own: the code -32000 and the message "MCP error -32000: Connection closed"
    assert.equal(isServerError(new McpError(ErrorCode.ConnectionClosed, CLOSED)), false);
  });

  test("-32000 with another message, and Connection closed with another code, are the server's own", () => {
    assert.equal(isServerError(new McpError(ErrorCode.ConnectionClosed, "boom")), true);
    assert.equal(isServerError(new McpError(ErrorCode.ConnectionClosed, "Connection closed by the server")), true);
    assert.equal(isServerError(new McpError(-32603, CLOSED)), true);
    assert.equal(isServerError(new McpError(ErrorCode.InvalidRequest, CLOSED)), true);
  });

  test("anything that is not an McpError is not the server's own", () => {
    assert.equal(isServerError(new Error("boom")), false);
    assert.equal(isServerError(new Error(`MCP error -32603: boom`)), false);
    assert.equal(isServerError(new TypeError("fetch failed")), false);
    assert.equal(isServerError({ code: -32603, message: "boom" }), false);
    assert.equal(isServerError("boom"), false);
    assert.equal(isServerError(null), false);
    assert.equal(isServerError(undefined), false);
  });
});

describe("a server that itself answers -32000 Connection closed: the four lines", () => {
  /** What `search` and standard error say for a server `far` at an address, that fails as `config` says. */
  async function atAddress(config) {
    return withHttp(config, async (server) =>
      withOnetool(settingsOf({ far: urlEntry(server) }, { timeoutSeconds: 10, connectSeconds: 20 }), async (ctx) => {
        const answer = textOf(await ctx.call("search", {}));
        await waitFor(() => serverLines(ctx).length >= 1, 3000, "its line");
        return { answer, lines: serverLines(ctx) };
      }),
    );
  }

  for (const [when, config] of [
    ["initialize", { initError: true }],
    ["the tool list", { listError: true }],
  ]) {
    test(`reached at an address, on ${when}: not connected (could not connect)`, async () => {
      const { answer, lines } = await atAddress({ ...config, errorText: CLOSED });
      assert.equal(answer, "far: not connected (could not connect)");
      assert.deepEqual(lines, ["onetool: server far: not connected (could not connect)"]);
    });
  }

  test("reached at an address, on a call of a tool: <id> failed: no answer from the server", async () => {
    await withHttp({ errorText: CLOSED }, async (server) => {
      await withOnetool(settingsOf({ far: urlEntry(server) }, { timeoutSeconds: 10 }), async (ctx) => {
        const said = (await ctx.run(CAUGHT("tools.far.rpcerr({})"))).content[0].text;
        assert.equal(said, "far.rpcerr failed: no answer from the server");
        // the connection is not lost: the next call is tried on it
        assert.equal((await ctx.run(CAUGHT("tools.far.hello({})"))).content[0].text, "answered");
      });
    });
  });

  for (const [when, config] of [
    ["initialize", { initError: true }],
    ["the tool list", { listError: true }],
  ]) {
    test(`started by a command, on ${when}: not connected (refused the connection)`, async () => {
      const settings = settingsOf({ fake: fakeEntry({ ...config, errorText: CLOSED }) }, { timeoutSeconds: 10 });
      await withOnetool(settings, async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), "fake: not connected (refused the connection)");
        await waitFor(() => serverLines(ctx).length >= 1, 3000, "its line");
        assert.deepEqual(serverLines(ctx), ["onetool: server fake: not connected (refused the connection)"]);
      });
    });
  }

  test("started by a command, on a call of a tool: <id> failed: MCP error -32000: Connection closed", async () => {
    const settings = settingsOf({ fake: fakeEntry({ errorText: CLOSED }) }, { timeoutSeconds: 10 });
    await withOnetool(settings, async (ctx) => {
      const said = (await ctx.run(CAUGHT("tools.fake.rpcerr({})"))).content[0].text;
      assert.equal(said, "fake.rpcerr failed: MCP error -32000: Connection closed");
    });
  });
});

describe("a server at an address that answers another message, or another code: its own error", () => {
  const OWN = [
    ["-32000 with the message boom", { errorText: "boom" }, "MCP error -32000: boom"],
    ["the message Connection closed with the code -32603", { errorText: CLOSED, errorCode: -32603 }, "MCP error -32603: Connection closed"],
  ];

  for (const [what, config, text] of OWN) {
    test(`${what}: refused the connection on initialize and on the tool list, and the error is passed on for a call`, async () => {
      for (const failing of [{ initError: true }, { listError: true }]) {
        await withHttp({ ...config, ...failing }, async (server) => {
          const settings = settingsOf({ far: urlEntry(server) }, { timeoutSeconds: 10, connectSeconds: 20 });
          await withOnetool(settings, async (ctx) => {
            assert.equal(textOf(await ctx.call("search", {})), "far: not connected (refused the connection)");
          });
        });
      }
      await withHttp(config, async (server) => {
        await withOnetool(settingsOf({ far: urlEntry(server) }, { timeoutSeconds: 10 }), async (ctx) => {
          const said = (await ctx.run(CAUGHT("tools.far.rpcerr({})"))).content[0].text;
          assert.equal(said, `far.rpcerr failed: ${text}`);
        });
      });
    });
  }
});
