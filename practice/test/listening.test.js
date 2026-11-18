import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import { startAddress, runToEnd, endWith, withClient, freePort, rawRequest, INIT_BODY, MCP_HEADERS } from "./address-helpers.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True when nothing answers at `host:port` within a second: refused, unreachable or silent. */
function connectFails(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const timer = setTimeout(() => {
      s.destroy();
      resolve(true);
    }, 1000);
    s.on("connect", () => {
      clearTimeout(timer);
      s.destroy();
      resolve(false);
    });
    s.on("error", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe("Step 2: listening", () => {
  let srv;
  before(async () => {
    srv = await startAddress(["--port", "0"]);
  });
  after(() => srv?.stop());

  test("prints one line with the true port, ended by a line break, and nothing else on either output", async () => {
    assert.match(srv.line, /^practice: listening on http:\/\/127\.0\.0\.1:[1-9][0-9]*\/mcp\n$/);
    assert.ok(srv.port > 0 && srv.port <= 65535);
    await withClient(srv.url, undefined, async (client) => {
      await client.ping();
      await client.listTools();
      await client.callTool({ name: "count", arguments: {} });
      await client.callTool({ name: "fail", arguments: {} });
    });
    await rawRequest(srv.port, { path: "/nope" });
    await wait(50);
    assert.equal(srv.stdout(), srv.line);
    assert.equal(srv.stderr(), "");
  });

  test("listens on 127.0.0.1 only", async () => {
    await withClient(srv.url, undefined, async (client) => {
      await client.ping();
    });
    assert.equal(await connectFails("::1", srv.port), true, "::1 must be refused");
    const external = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i.address);
    for (const address of external) {
      assert.equal(await connectFails(address, srv.port), true, `${address} must be refused`);
    }
  });
});

describe("Step 2: listening, the address asked for", () => {
  test("the line holds the port that was asked for", async () => {
    const port = await freePort();
    const srv = await startAddress(["--port", String(port)]);
    try {
      assert.equal(srv.line, `practice: listening on http://127.0.0.1:${port}/mcp\n`);
      const r = await rawRequest(port, { headers: MCP_HEADERS, body: INIT_BODY });
      assert.equal(r.status, 200);
    } finally {
      srv.stop();
    }
  });

  test("a port that cannot be listened on: one line on standard error, exit code 1, nothing on standard output", async () => {
    const holder = net.createServer();
    await new Promise((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const port = holder.address().port;
    try {
      const r = await runToEnd(["--port", String(port)]);
      assert.equal(r.signal, null);
      assert.equal(r.code, 1);
      assert.equal(r.stderr, `practice: cannot listen on port ${port}\n`);
      assert.equal(r.stdout, "");
      const withToken = await runToEnd(["--port", String(port), "--token", "t"]);
      assert.equal(withToken.code, 1);
      assert.equal(withToken.stderr, `practice: cannot listen on port ${port}\n`);
      assert.equal(withToken.stdout, "");
    } finally {
      await new Promise((resolve) => holder.close(resolve));
    }
  });
});

describe("Step 2: listening, standard input and signals", () => {
  test("a closed standard input does not end it", async () => {
    const srv = await startAddress(["--port", "0"]);
    try {
      srv.child.stdin.end();
      await wait(300);
      assert.equal(srv.child.exitCode, null);
      assert.equal(srv.child.signalCode, null);
      await withClient(srv.url, undefined, async (client) => {
        await client.ping();
        const res = await client.callTool({ name: "echo", arguments: { text: "still here" } });
        assert.equal(res.content[0].text, "still here");
      });
      assert.equal(srv.stdout(), srv.line);
      assert.equal(srv.stderr(), "");
    } finally {
      srv.stop();
    }
  });

  for (const sig of ["SIGTERM", "SIGINT"]) {
    test(`${sig} with no request in progress ends it as the system does: the process dies of it`, async () => {
      const srv = await startAddress(["--port", "0"]);
      try {
        await withClient(srv.url, undefined, async (client) => {
          await client.ping();
        });
        const { code, signal } = await endWith(srv, sig);
        assert.equal(signal, sig);
        assert.equal(code, null);
      } finally {
        srv.stop();
      }
    });

    test(`${sig} with a request in progress ends it as the system does: the process dies of it`, async () => {
      const srv = await startAddress(["--port", "0", "--token", "t"]);
      const socket = net.connect({ host: "127.0.0.1", port: srv.port });
      socket.on("error", () => {});
      try {
        await new Promise((resolve, reject) => {
          socket.on("connect", resolve);
          socket.on("error", reject);
        });
        // The head of a request whose body never comes: it is in progress when the signal arrives.
        await new Promise((resolve) =>
          socket.write(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer t\r\nContent-Type: application/json\r\n" +
              "Accept: application/json, text/event-stream\r\nContent-Length: 100000\r\n\r\n{",
            resolve,
          ),
        );
        await wait(100);
        const { code, signal } = await endWith(srv, sig);
        assert.equal(signal, sig);
        assert.equal(code, null);
      } finally {
        socket.destroy();
        srv.stop();
      }
    });
  }
});
