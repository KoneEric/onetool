import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { authFile, authFolder, signInStamp, quietProvider } from "../src/index.js";
import { startPractice, fakeServer, signInFake, signIn, ping, is401, tmpHome, mode, connect, textOf, wait } from "./helpers.js";

const fakes = [];
let practice;
before(async () => {
  practice = await startPractice();
});
after(() => {
  practice?.stop();
  for (const f of fakes) f.stop();
});
const fake = async (opts) => {
  const f = await fakeServer(opts);
  fakes.push(f);
  return f;
};
const bearer = (t) => `Bearer ${t.access_token}`;

describe("the quiet provider: what the package is given", () => {
  test("it is returned at once, touches nothing on the disk and its redirect does nothing", async () => {
    const home = tmpHome();
    const p = quietProvider("far", "http://127.0.0.1:1/mcp", { home });
    assert.equal(typeof p.then, "undefined", "not a promise");
    assert.equal(typeof p.tokens, "function");
    assert.equal(typeof p.saveTokens, "function");
    assert.equal(typeof p.clientInformation, "function");
    assert.equal(typeof p.redirectToAuthorization, "function");
    assert.equal(await p.redirectToAuthorization(new URL("http://127.0.0.1:1/authorize?x=1")), undefined);
    assert.deepEqual(fs.readdirSync(home), []);
  });
});

describe("the quiet provider with the transport of the package", () => {
  test("1. every request carries the access token of the file at that moment, also one written after the provider was made", async () => {
    const home = tmpHome();
    const f = await fake();
    const p = quietProvider("far", f.url, { home });
    const t1 = await signInFake(f, { home });
    await ping(f.url, p);
    assert.equal(f.mcp.at(-1), bearer(t1));
    await ping(f.url, p);
    assert.equal(f.mcp.at(-1), bearer(t1));
    const t2 = await signInFake(f, { home });
    assert.notEqual(t1.access_token, t2.access_token);
    await ping(f.url, p);
    assert.equal(f.mcp.at(-1), bearer(t2));
    assert.deepEqual(f.mcp, [bearer(t1), bearer(t1), bearer(t2)], "no request without the token, no extra request");
  });

  test("2. a 401 and a refresh token: new tokens are asked, written (mode 600, a new stamp), and the request is made again", async () => {
    const home = tmpHome();
    const f = await fake();
    const t1 = await signInFake(f, { home });
    const registered = f.registers.length;
    const stamp = signInStamp("far", f.url, { home });
    const file = authFile("far", { home });
    fs.chmodSync(file, 0o644);
    f.expireAll();
    const p = quietProvider("far", f.url, { home });
    await ping(f.url, p);
    const t2 = f.issued.at(-1);
    assert.notEqual(t2.access_token, t1.access_token);
    assert.deepEqual(f.mcp, [bearer(t1), bearer(t2)]);
    const refresh = f.tokens.at(-1).params;
    assert.equal(refresh.grant_type, "refresh_token");
    assert.equal(refresh.refresh_token, t1.refresh_token);
    assert.equal(f.registers.length, registered, "no new registration");
    assert.equal(mode(file), 0o600);
    assert.ok(fs.readFileSync(file, "utf8").includes(t2.access_token), "the new access token is in the file");
    const renewed = signInStamp("far", f.url, { home });
    assert.ok(renewed && renewed !== stamp);
    assert.deepEqual(fs.readdirSync(authFolder({ home })), ["far.json"]);
    await ping(f.url, p);
    assert.equal(f.mcp.at(-1), bearer(t2), "the next request uses the new token");
  });

  test("the refresh uses the client the file holds, with nothing asked", async () => {
    const home = tmpHome();
    const f = await fake();
    const t1 = await signInFake(f, { home });
    f.expireAll();
    await ping(f.url, quietProvider("far", f.url, { home }));
    const { params } = f.tokens.at(-1);
    assert.equal(params.client_id, "fake-client-1", "the client of the file");
    assert.equal(params.refresh_token, t1.refresh_token);
  });

  test("5. with oauth: its clientId and clientSecret are the client, whatever the file holds", async () => {
    const home = tmpHome();
    const f = await fake();
    await signInFake(f, { home });
    f.expireAll();
    const oauth = { clientId: "chosen-client", clientSecret: "chosen-secret" };
    await ping(f.url, quietProvider("far", f.url, { home, oauth }));
    const { params, headers } = f.tokens.at(-1);
    assert.equal(params.grant_type, "refresh_token");
    const basic = `Basic ${Buffer.from("chosen-client:chosen-secret").toString("base64")}`;
    assert.ok(params.client_id === "chosen-client" || headers.authorization === basic, "the client id");
    assert.ok(params.client_secret === "chosen-secret" || headers.authorization === basic, "the client secret");
    const text = fs.readFileSync(authFile("far", { home }), "utf8");
    assert.ok(!text.includes("chosen-secret"), "no client secret in the file");
  });

  test("3. a refused refresh (invalid_grant): the request rejects with 401 and the file is no usable sign-in any more", async () => {
    const home = tmpHome();
    const f = await fake();
    await signInFake(f, { home });
    f.expireAll();
    f.refreshMode = "invalid_grant";
    await assert.rejects(() => ping(f.url, quietProvider("far", f.url, { home })), is401);
    assert.equal(signInStamp("far", f.url, { home }), null);
  });

  test("3. no refresh token: the request rejects, no refresh is asked, the file is left as it is", async () => {
    const home = tmpHome();
    const f = await fake({ noRefresh: true });
    await signInFake(f, { home });
    f.expireAll();
    const file = authFile("far", { home });
    const text = fs.readFileSync(file);
    const stamp = signInStamp("far", f.url, { home });
    const asked = f.tokens.length;
    await assert.rejects(() => ping(f.url, quietProvider("far", f.url, { home })), is401);
    assert.equal(f.tokens.length, asked, "nothing was asked of the sign-in server");
    assert.deepEqual(fs.readFileSync(file), text);
    assert.equal(signInStamp("far", f.url, { home }), stamp);
  });

  test("3. the server still answers 401 with the new token: the request rejects with 401", async () => {
    const home = tmpHome();
    const f = await fake({ deny401: true });
    await signInFake(f, { home });
    await assert.rejects(() => ping(f.url, quietProvider("far", f.url, { home })), is401);
    assert.notEqual(signInStamp("far", f.url, { home }), null);
    assert.equal(f.tokens.filter((t) => t.params.grant_type === "refresh_token").length, 1, "one refresh, not a loop");
  });

  test("4. with no sign-in: the request rejects, nothing is registered, nothing is opened", async () => {
    const home = tmpHome();
    const f = await fake();
    const p = quietProvider("far", f.url, { home });
    await assert.rejects(() => ping(f.url, p));
    assert.equal(f.registers.length, 0);
    assert.equal(f.tokens.length, 0);
    assert.deepEqual(fs.readdirSync(home), []);
    const q = quietProvider("far", f.url, { home, oauth: { clientId: "given" } });
    await assert.rejects(() => ping(f.url, q));
    assert.equal(f.registers.length, 0);
  });

  test("4. on the practice server with no sign-in: refused, nothing registered, nothing authorized", async () => {
    const home = tmpHome();
    const before = await practice.seen();
    await assert.rejects(() => ping(practice.url, quietProvider("far", practice.url, { home })));
    const now = await practice.seen();
    assert.equal(now.registrations, before.registrations);
    assert.equal(now.authorizations, before.authorizations);
    assert.ok(now.refused > before.refused, "the request was refused with 401");
  });

  test("a sign-in of another address is not used: no token is sent", async () => {
    const home = tmpHome();
    const f = await fake();
    await signInFake(f, { home });
    const g = await fake();
    await assert.rejects(() => ping(g.url, quietProvider("far", g.url, { home })));
    assert.ok(g.mcp.every((a) => a === undefined), "no Authorization header");
  });

  test("6. nothing is printed by the provider or the package", async () => {
    const home = tmpHome();
    const f = await fake();
    await signInFake(f, { home });
    f.expireAll();
    const seen = [];
    const names = ["log", "info", "warn", "error", "debug"];
    const saved = names.map((n) => console[n]);
    names.forEach((n) => (console[n] = (...a) => seen.push([n, ...a])));
    try {
      await ping(f.url, quietProvider("far", f.url, { home }));
      f.refreshMode = "invalid_grant";
      f.expireAll();
      await ping(f.url, quietProvider("far", f.url, { home })).catch(() => {});
    } finally {
      names.forEach((n, i) => (console[n] = saved[i]));
    }
    assert.deepEqual(seen, []);
  });
});

describe("the quiet provider with the practice server, the MCP client and a sign-in that expires", () => {
  test("it refreshes by itself; a call after the expiry still answers; /seen counts the refresh", async () => {
    const short = await startPractice(["--expires", "1"]);
    try {
      const home = tmpHome();
      await signIn({ name: "far", url: short.url, home });
      const stamp = signInStamp("far", short.url, { home });
      const client = await connect(short.url, quietProvider("far", short.url, { home }));
      try {
        await client.listTools();
        await wait(1500);
        assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Lyon" } })), '{"count":625}');
      } finally {
        await client.close().catch(() => {});
      }
      assert.ok((await short.seen()).refreshes >= 1);
      const now = signInStamp("far", short.url, { home });
      assert.ok(now && now !== stamp);
      assert.equal(mode(authFile("far", { home })), 0o600);
    } finally {
      short.stop();
    }
  });

  test("with a client given by oauth and a secret, the refresh answers", async () => {
    const fixed = await startPractice(["--expires", "1", "--client", "fixed", "--secret", "s3"]);
    try {
      const home = tmpHome();
      const oauth = { clientId: "fixed", clientSecret: "s3" };
      await signIn({ name: "far", url: fixed.url, home, oauth });
      const text = fs.readFileSync(authFile("far", { home }), "utf8");
      assert.ok(!/(^|[^A-Za-z0-9])s3([^A-Za-z0-9]|$)/.test(text), "no client secret in the file");
      const client = await connect(fixed.url, quietProvider("far", fixed.url, { home, oauth }));
      try {
        await wait(1500);
        assert.equal(textOf(await client.callTool({ name: "count", arguments: { city: "Lyon" } })), '{"count":625}');
      } finally {
        await client.close().catch(() => {});
      }
      const seen = await fixed.seen();
      assert.ok(seen.refreshes >= 1);
      assert.equal(seen.registrations, 0);
    } finally {
      fixed.stop();
    }
  });
});
