import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runToEnd, startAddress, withClient, USAGE } from "./address-helpers.js";

describe("Step 2: arguments", () => {
  test("anything else than the three forms is the usage line on standard error, exit code 2", async () => {
    const bad = [
      ["--token", "x"],
      ["--token"],
      ["--port"],
      ["--port", "0", "--token"],
      ["--port", "0", "--port", "1"],
      ["--port", "0", "--token", "a", "--token", "b"],
      ["--port", "0", "--token", "a", "--port", "1"],
      ["--port", "0", "extra"],
      ["--port", "0", "--token", "a", "extra"],
      ["extra"],
      ["--bogus"],
      ["--port", "0", "--bogus", "x"],
      ["--port=8080"],
      ["--port=0"],
      ["--port", "0", "--token=x"],
      ["--port", "--token", "x"],
      ["--token", "--port", "0"],
      // `<number>` is digits only, from 0 to 65535
      ["--port", ""],
      ["--port", "abc"],
      ["--port", "-1"],
      ["--port", "+80"],
      ["--port", " 80"],
      ["--port", "80 "],
      ["--port", "1e3"],
      ["--port", "0x10"],
      ["--port", "80.5"],
      ["--port", "８０"],
      ["--port", "65536"],
      ["--port", "99999"],
      ["--port", "100000"],
      ["--port", "4294967296"],
      // `<text>` is not empty
      ["--port", "0", "--token", ""],
      ["--token", "", "--port", "0"],
    ];
    const failures = [];
    await Promise.all(
      bad.map(async (args) => {
        try {
          const r = await runToEnd(args);
          assert.equal(r.signal, null);
          assert.equal(r.code, 2);
          assert.equal(r.stderr.trimEnd(), USAGE);
          assert.equal(r.stderr.trimEnd().includes("\n"), false);
        } catch (e) {
          failures.push(`${JSON.stringify(args)}: ${e.message.split("\n")[0]}`);
        }
      }),
    );
    assert.deepEqual(failures, []);
  });

  test("a token is the word after --token, whatever it holds, and the pairs may come in either order", async () => {
    const odd = "--sécret tok en";
    for (const [args, token] of [
      [["--port", "0", "--token", odd], odd],
      [["--token", odd, "--port", "0"], odd],
      [["--token", "--", "--port", "0"], "--"],
      [["--port", "0", "--token", "--tok"], "--tok"],
    ]) {
      const srv = await startAddress(args);
      try {
        await withClient(srv.url, token, async (client) => {
          await client.ping();
        });
        await assert.rejects(() => withClient(srv.url, undefined, async () => {}), JSON.stringify(args));
      } finally {
        srv.stop();
      }
    }
  });

  test("a port of 65535, the largest, is not a usage error: it listens or cannot", async () => {
    let srv;
    try {
      srv = await startAddress(["--port", "65535"]);
      assert.equal(srv.port, 65535);
    } catch (e) {
      assert.ok(!e.message.includes("usage:"), e.message);
      assert.ok(e.message.includes("code 1"), e.message);
      assert.ok(e.message.includes("practice: cannot listen on port 65535"), e.message);
    } finally {
      srv?.stop();
    }
  });
});
