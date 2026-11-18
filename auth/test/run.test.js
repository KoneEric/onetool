import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { authFile, authFolder, signInStamp, quietProvider, login, logout } from "../src/index.js";
import { startPractice, signIn, connect, textOf, is401, wait, within, tmpHome, mode, readJson, browser } from "./helpers.js";

describe("the run through the real thing: the practice server as a process, nothing replaced", () => {
  test("points 1 to 3 and 6: no sign-in, login, the file, the tools, another address", async () => {
    const srv = await startPractice();
    try {
      const home = tmpHome();
      assert.equal(signInStamp("far", srv.url, { home }), null);

      const res = await within(login({ name: "far", url: srv.url }, { home, waitSeconds: 10, say: browser }), 12000, "login");
      assert.deepEqual(res, { ok: true });
      const file = authFile("far", { home });
      assert.equal(mode(file), 0o600);
      const doc = readJson(file);
      assert.equal(doc.server, "far");
      assert.equal(doc.url, srv.url);
      assert.equal(mode(authFolder({ home })), 0o700);
      assert.notEqual(signInStamp("far", srv.url, { home }), null);

      const client = await connect(srv.url, quietProvider("far", srv.url, { home }));
      try {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 5);
        assert.ok(tools.some((t) => t.name === "count"));
        assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Lyon" } })), '{"count":625}');
      } finally {
        await client.close().catch(() => {});
      }

      assert.equal(signInStamp("far", srv.url.replace("/mcp", "/mcp/"), { home }), null);
      assert.equal(signInStamp("far", srv.url + "?x", { home }), null);
      const seen = await srv.seen();
      assert.equal(seen.registrations, 1);
      assert.equal(seen.tokens, 1);
      assert.equal(seen.refreshes, 0);
    } finally {
      srv.stop();
    }
  });

  test("point 4: with --expires 1 a call after 1.5 seconds still answers, a refresh is counted, the stamp changed", async () => {
    const srv = await startPractice(["--expires", "1"]);
    try {
      const home = tmpHome();
      await signIn({ name: "far", url: srv.url, home });
      const stamp = signInStamp("far", srv.url, { home });
      assert.ok(stamp);
      const client = await connect(srv.url, quietProvider("far", srv.url, { home }));
      try {
        await client.listTools();
        await wait(1500);
        assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Lyon" } })), '{"count":625}');
      } finally {
        await client.close().catch(() => {});
      }
      assert.ok((await srv.seen()).refreshes >= 1);
      const now = signInStamp("far", srv.url, { home });
      assert.ok(now);
      assert.notEqual(now, stamp);
    } finally {
      srv.stop();
    }
  });

  test("point 5: after POST /forget a call rejects with 401 and the stamp is null", async () => {
    const srv = await startPractice();
    try {
      const home = tmpHome();
      await signIn({ name: "far", url: srv.url, home });
      const client = await connect(srv.url, quietProvider("far", srv.url, { home }));
      try {
        await client.listTools();
        await srv.forget();
        await assert.rejects(() => within(client.callTool({ name: "count", arguments: { city: "Lyon" } }), 8000, "the call after forget"), is401);
      } finally {
        await client.close().catch(() => {});
      }
      assert.equal(signInStamp("far", srv.url, { home }), null);
    } finally {
      srv.stop();
    }
  });

  test("point 5, with the file only: after forget the first request of a new connection rejects and the stamp is null", async () => {
    const srv = await startPractice();
    try {
      const home = tmpHome();
      await signIn({ name: "far", url: srv.url, home });
      await srv.forget();
      await assert.rejects(() => connect(srv.url, quietProvider("far", srv.url, { home })), is401);
      assert.equal(signInStamp("far", srv.url, { home }), null);
    } finally {
      srv.stop();
    }
  });

  test("point 7: a server with --client fixed: no oauth, could not be started; with oauth, signed in and nothing registered", async () => {
    const srv = await startPractice(["--client", "fixed"]);
    try {
      const home = tmpHome();
      const first = await within(login({ name: "far", url: srv.url }, { home, waitSeconds: 10, say: browser }), 12000, "login without oauth");
      assert.deepEqual(first, { ok: false, reason: "the sign-in could not be started" });
      assert.equal(signInStamp("far", srv.url, { home }), null);
      const second = await within(
        login({ name: "far", url: srv.url, oauth: { clientId: "fixed" } }, { home, waitSeconds: 10, say: browser }),
        12000,
        "login with oauth",
      );
      assert.deepEqual(second, { ok: true });
      assert.notEqual(signInStamp("far", srv.url, { home }), null);
      assert.equal((await srv.seen()).registrations, 0);
      const client = await connect(srv.url, quietProvider("far", srv.url, { home, oauth: { clientId: "fixed" } }));
      try {
        assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Lyon" } })), '{"count":625}');
      } finally {
        await client.close().catch(() => {});
      }
    } finally {
      srv.stop();
    }
  });

  test("point 7 with a secret: the client fixed with its secret signs in", async () => {
    const srv = await startPractice(["--client", "fixed", "--secret", "s3"]);
    try {
      const home = tmpHome();
      const bad = await within(login({ name: "far", url: srv.url, oauth: { clientId: "fixed" } }, { home, waitSeconds: 10, say: browser }), 12000, "login without the secret");
      assert.deepEqual(bad, { ok: false, reason: "the sign-in could not be finished" });
      assert.equal(signInStamp("far", srv.url, { home }), null);
      await signIn({ name: "far", url: srv.url, home, oauth: { clientId: "fixed", clientSecret: "s3" } });
      assert.notEqual(signInStamp("far", srv.url, { home }), null);
    } finally {
      srv.stop();
    }
  });

  test("point 8: logout gives true, the file is gone, then false", async () => {
    const srv = await startPractice();
    try {
      const home = tmpHome();
      await signIn({ name: "far", url: srv.url, home });
      assert.equal(logout("far", { home }), true);
      assert.equal(fs.existsSync(authFile("far", { home })), false);
      assert.equal(signInStamp("far", srv.url, { home }), null);
      assert.equal(logout("far", { home }), false);
    } finally {
      srv.stop();
    }
  });
});
