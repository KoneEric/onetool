import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { login, authFile, signInStamp, quietProvider } from "../src/index.js";
import { startPractice, fakeServer, beginLogin, hit, ping, listening, freePort, tmpHome, within, readJson } from "./helpers.js";

// Step 11 of the meeting point of auth: `oauth.redirectHost`.
// No request of these tests goes to the name `localhost` itself: every address that names it is
// requested at 127.0.0.1 with the same port, path and query.

let practice;
const fakes = [];
before(async () => {
  practice = await startPractice(["--client", "fixed"]);
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

/** The same address with its host name replaced by 127.0.0.1; only the two names of the text are let through. */
function loopback(address) {
  const u = new URL(address);
  assert.ok(u.hostname === "localhost" || u.hostname === "127.0.0.1", `the host of ${u.origin}`);
  u.hostname = "127.0.0.1";
  return u;
}

/** The browser comes back to the callback address of `l`, by 127.0.0.1; `state` is the true one unless `query` has the key. */
async function come(l, query = {}) {
  const a = await l.address();
  const cb = loopback(a.searchParams.get("redirect_uri"));
  return hit(cb.href, { query: { state: a.searchParams.get("state"), ...query } });
}

/** One request to 127.0.0.1:`port` that names `host` in its `Host` header. */
function rawRequest(port, { host, method = "GET", target }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: target, headers: { host: `${host}:${port}` }, agent: false, timeout: 8000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("no answer")));
    req.on("error", reject);
    req.end();
  });
}

const withHost = (host, extra = {}) => ({ clientId: "my-client", ...(host !== undefined ? { redirectHost: host } : {}), ...extra });
const expectedHost = (host) => host ?? "127.0.0.1";
const portOf = (cb) => Number(new URL(cb).port);

describe("redirectHost: bad arguments", () => {
  const url = "http://127.0.0.1:1/mcp";
  const bad = [
    "",
    "LOCALHOST",
    "Localhost",
    " localhost",
    "localhost ",
    "127.0.0.2",
    "0.0.0.0",
    "::1",
    "[::1]",
    "localhost:8765",
    "127.0.0.1:8765",
    "example.org",
    5,
    true,
    null,
    undefined,
    {},
    ["localhost"],
  ];

  test("quietProvider throws a TypeError for a redirectHost that is given and is not one of the two strings", () => {
    const home = tmpHome();
    for (const redirectHost of bad) {
      assert.throws(() => quietProvider("far", url, { home, oauth: { clientId: "x", redirectHost } }), TypeError, String(redirectHost));
    }
    assert.deepEqual(fs.readdirSync(home), [], "nothing was done");
  });

  test("login rejects with a TypeError and does nothing", async () => {
    const home = tmpHome();
    const port = await freePort();
    let said = 0;
    for (const redirectHost of bad) {
      await within(
        assert.rejects(
          () => login({ name: "far", url, oauth: { clientId: "x", port, redirectHost } }, { home, waitSeconds: 5, say: () => said++ }),
          TypeError,
          String(redirectHost),
        ),
        8000,
        "a bad argument is refused at once",
      );
      assert.equal(await listening(port), false, "nothing listens");
    }
    assert.equal(said, 0);
    assert.deepEqual(fs.readdirSync(home), [], "nothing was written");
  });

  test("the two strings are good arguments, with the other keys of oauth", () => {
    const home = tmpHome();
    for (const redirectHost of ["localhost", "127.0.0.1"]) {
      assert.doesNotThrow(() => quietProvider("far", url, { home, oauth: { clientId: "x", clientSecret: "s", scopes: ["a"], port: 8765, redirectHost } }));
    }
  });
});

describe("redirectHost: the callback address", () => {
  for (const host of ["localhost", "127.0.0.1", undefined]) {
    test(`redirectHost ${host === undefined ? "absent" : host}: the address given to say and open has redirect_uri http://${expectedHost(host)}:<port>/callback, the exchange sends the same`, async () => {
      const home = tmpHome();
      const f = await fake();
      const l = beginLogin({ name: "far", url: f.url, oauth: withHost(host) }, { home });
      const a = await l.address();
      const cb = a.searchParams.get("redirect_uri");
      const m = /^http:\/\/([^:/]+):(\d+)\/callback$/.exec(cb);
      assert.ok(m, `the callback address ${cb}`);
      assert.equal(m[1], expectedHost(host));
      assert.ok(portOf(cb) > 0);
      assert.equal(cb, `http://${expectedHost(host)}:${portOf(cb)}/callback`);
      assert.equal(l.calls.say.length, 1);
      assert.equal(l.calls.open.length, 1);
      assert.equal(l.calls.say[0], l.calls.open[0]);
      assert.equal(await listening(portOf(cb)), true, "it listens on 127.0.0.1 at that port");
      const r = await come(l, { code: "the-code" });
      assert.equal(r.status, 200);
      assert.ok(r.text.includes("signed in, you can close this page"));
      assert.deepEqual(await l.result(), { ok: true });
      assert.equal(f.tokens.length, 1);
      assert.equal(f.tokens[0].params.grant_type, "authorization_code");
      assert.equal(f.tokens[0].params.redirect_uri, cb);
      assert.notEqual(signInStamp("far", f.url, { home }), null);
      assert.equal(await listening(portOf(cb)), false, "nothing listens any more");
    });
  }

  test("with oauth.port the port of the callback address is that port, the host is redirectHost", async () => {
    const home = tmpHome();
    const f = await fake();
    const port = await freePort();
    const l = beginLogin({ name: "far", url: f.url, oauth: withHost("localhost", { port }) }, { home });
    assert.equal(await l.callback(), `http://localhost:${port}/callback`);
    assert.equal(await listening(port), true);
    await come(l, { error: "access_denied" });
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
    assert.equal(await listening(port), false);
  });

  test("nothing else of the address changes: the same parameters, the same client, scope and path as with no redirectHost", async () => {
    const f = await fake();
    const addresses = [];
    for (const host of [undefined, "localhost"]) {
      const home = tmpHome();
      const l = beginLogin({ name: "far", url: f.url, oauth: withHost(host, { clientSecret: "s3cret-value", scopes: ["read", "write"] }) }, { home });
      const a = await l.address();
      addresses.push(a);
      assert.ok(!a.href.includes("s3cret-value"));
      await come(l, { error: "access_denied" });
      assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
    }
    const [plain, named] = addresses;
    assert.match(plain.searchParams.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.match(named.searchParams.get("redirect_uri"), /^http:\/\/localhost:\d+\/callback$/);
    assert.equal(named.origin + named.pathname, plain.origin + plain.pathname);
    assert.deepEqual([...named.searchParams.keys()].sort(), [...plain.searchParams.keys()].sort());
    for (const key of plain.searchParams.keys()) {
      if (key === "state" || key === "code_challenge" || key === "redirect_uri") continue;
      assert.equal(named.searchParams.get(key), plain.searchParams.get(key), key);
    }
    assert.equal(named.searchParams.get("client_id"), "my-client");
    assert.equal(named.searchParams.get("scope"), "read write");
    assert.equal(f.registers.length, 0);
  });

  test("it listens on 127.0.0.1 only, whatever redirectHost says", async () => {
    const f = await fake();
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: f.url, oauth: withHost("localhost") }, { home });
    const port = portOf(await l.callback());
    assert.equal(await listening(port), true);
    const connects = (host) =>
      new Promise((resolve) => {
        const s = net.connect({ host, port });
        s.setTimeout(2000, () => {
          s.destroy();
          resolve(false);
        });
        s.once("connect", () => {
          s.destroy();
          resolve(true);
        });
        s.once("error", () => resolve(false));
      });
    assert.equal(await connects("::1"), false, "not on ::1");
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list ?? []) {
        if (i.family === "IPv4" && !i.internal) assert.equal(await connects(i.address), false, "not on an address of this machine's network");
      }
    }
    await come(l, { error: "access_denied" });
    await l.result();
  });
});

describe("redirectHost: the requests it answers", () => {
  for (const host of ["localhost", undefined]) {
    test(`redirectHost ${host === undefined ? "absent" : host}: the table does not look at the Host header, the two names are answered alike`, async () => {
      const f = await fake();
      const home = tmpHome();
      const l = beginLogin({ name: "far", url: f.url, oauth: withHost(host) }, { home });
      const a = await l.address();
      const port = portOf(a.searchParams.get("redirect_uri"));
      const state = a.searchParams.get("state");
      for (const named of ["localhost", "127.0.0.1"]) {
        const other = await rawRequest(port, { host: named, target: `/other?state=${state}&code=x` });
        assert.equal(other.status, 404, `${named}: another path`);
        const post = await rawRequest(port, { host: named, method: "POST", target: `/callback?state=${state}&code=x` });
        assert.equal(post.status, 404, `${named}: another method`);
        const wrong = await rawRequest(port, { host: named, target: "/callback?state=not-the-state&code=x" });
        assert.equal(wrong.status, 400, `${named}: another state`);
        const none = await rawRequest(port, { host: named, target: "/callback?code=x" });
        assert.equal(none.status, 400, `${named}: no state`);
      }
      assert.equal(f.tokens.length, 0, "nothing was exchanged");
      assert.equal(l.calls.say.length, 1);
      const done = await rawRequest(port, { host: "localhost", target: `/callback?state=${state}&code=the-code` });
      assert.equal(done.status, 200);
      assert.ok(done.text.includes("signed in, you can close this page"));
      assert.deepEqual(await l.result(), { ok: true });
    });
  }

  test("a request that names localhost and comes back with error is refused like any other", async () => {
    const f = await fake();
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: f.url, oauth: withHost("127.0.0.1") }, { home });
    const a = await l.address();
    const port = portOf(a.searchParams.get("redirect_uri"));
    const r = await rawRequest(port, { host: "localhost", target: `/callback?state=${a.searchParams.get("state")}&error=access_denied` });
    assert.equal(r.status, 400);
    assert.ok(r.text.includes("not signed in"));
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
  });
});

describe("redirectHost: the reasons and the file", () => {
  test("cannot listen on port <port> is unchanged and never names the host", async () => {
    const taker = net.createServer();
    await new Promise((resolve) => taker.listen(0, "127.0.0.1", resolve));
    const port = taker.address().port;
    try {
      const home = tmpHome();
      for (const host of ["localhost", "127.0.0.1"]) {
        const l = beginLogin({ name: "far", url: practice.url, oauth: { clientId: "fixed", port, redirectHost: host } }, { home });
        assert.deepEqual(await l.result(), { ok: false, reason: `cannot listen on port ${port}` });
        assert.equal(l.calls.say.length, 0);
      }
      assert.equal(fs.existsSync(authFile("far", { home })), false);
    } finally {
      await new Promise((resolve) => taker.close(resolve));
    }
  });

  test("the file of a sign-in is as before: the same keys, and never redirectHost", async () => {
    const f = await fake();
    const docs = [];
    for (const host of [undefined, "localhost"]) {
      const home = tmpHome();
      const l = beginLogin({ name: "far", url: f.url, oauth: withHost(host) }, { home });
      const r = await come(l, { code: "any-code" });
      assert.equal(r.status, 200);
      assert.deepEqual(await l.result(), { ok: true });
      const text = fs.readFileSync(authFile("far", { home }), "utf8");
      assert.ok(!text.includes("redirectHost"));
      assert.ok(!text.includes("localhost"));
      docs.push(readJson(authFile("far", { home })));
    }
    assert.deepEqual(Object.keys(docs[1]).sort(), Object.keys(docs[0]).sort());
    assert.equal(docs[1].server, "far");
    assert.equal(docs[1].url, f.url);
  });

  test("a sign-in that was there is as it was after a failed login with redirectHost", async () => {
    const f = await fake();
    const home = tmpHome();
    const first = beginLogin({ name: "far", url: f.url, oauth: withHost("localhost") }, { home });
    await come(first, { code: "any-code" });
    assert.deepEqual(await first.result(), { ok: true });
    const text = fs.readFileSync(authFile("far", { home }));
    const stamp = signInStamp("far", f.url, { home });
    const l = beginLogin({ name: "far", url: f.url, oauth: withHost("localhost") }, { home });
    await come(l, { error: "access_denied" });
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
    assert.deepEqual(fs.readFileSync(authFile("far", { home })), text);
    assert.equal(signInStamp("far", f.url, { home }), stamp);
  });
});

describe("redirectHost: quietProvider", () => {
  test("it changes nothing that can be observed: what the package reads, and a refresh that sends no redirect address", async () => {
    const f = await fake();
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: f.url, oauth: withHost(undefined) }, { home });
    await come(l, { code: "any-code" });
    assert.deepEqual(await l.result(), { ok: true });
    const t1 = f.issued.at(-1);

    const plain = quietProvider("far", f.url, { home, oauth: withHost(undefined) });
    const named = quietProvider("far", f.url, { home, oauth: withHost("localhost") });
    assert.equal(named.redirectUrl, plain.redirectUrl);
    assert.deepEqual(named.clientMetadata, plain.clientMetadata);
    assert.deepEqual(named.clientInformation(), plain.clientInformation());
    assert.deepEqual(named.tokens(), plain.tokens());

    const stamp = signInStamp("far", f.url, { home });
    f.expireAll();
    await ping(f.url, named);
    const refresh = f.tokens.at(-1).params;
    assert.equal(refresh.grant_type, "refresh_token");
    assert.equal(refresh.refresh_token, t1.refresh_token);
    assert.equal(refresh.redirect_uri, undefined);
    assert.equal(f.mcp.at(-1), `Bearer ${f.issued.at(-1).access_token}`);
    assert.notEqual(signInStamp("far", f.url, { home }), stamp);
    assert.equal(f.registers.length, 0);
    assert.ok(!fs.readFileSync(authFile("far", { home }), "utf8").includes("redirectHost"));
  });
});

describe("the run through the real thing: point 9, the practice server with --client fixed as a process", () => {
  /** `login` with a browser that is the test: it checks the address, asks for it without following the redirect, comes back at 127.0.0.1. */
  async function point9(redirectHost) {
    const home = tmpHome();
    const host = expectedHost(redirectHost);
    let browser;
    let said = 0;
    const say = (address) => {
      said++;
      browser = (async () => {
        const a = new URL(address);
        const redirectUri = a.searchParams.get("redirect_uri");
        const m = /^http:\/\/([^:/]+):(\d+)\/callback$/.exec(redirectUri);
        assert.ok(m, `redirect_uri ${redirectUri}`);
        assert.match(m[2], /^\d+$/);
        assert.equal(redirectUri, `http://${host}:${m[2]}/callback`);
        const r = await fetch(a, { redirect: "manual", signal: AbortSignal.timeout(8000) });
        await r.arrayBuffer();
        const location = r.headers.get("location");
        assert.ok(location, "a Location");
        assert.ok(location.startsWith(`http://${host}:${m[2]}/callback?`), `Location ${location}`);
        const back = new URL(location);
        const target = new URL(`${back.pathname}${back.search}`, `http://127.0.0.1:${m[2]}`);
        const done = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(8000) });
        await done.arrayBuffer();
        assert.equal(done.status, 200);
      })();
      browser.catch(() => {});
    };
    const oauth = { clientId: "fixed", ...(redirectHost !== undefined ? { redirectHost } : {}) };
    assert.equal(signInStamp("far", practice.url, { home }), null);
    const res = await within(login({ name: "far", url: practice.url, oauth }, { home, waitSeconds: 10, say }), 12000, "login");
    assert.deepEqual(res, { ok: true });
    assert.equal(said, 1);
    await within(browser, 8000, "the browser of the test");
    assert.notEqual(signInStamp("far", practice.url, { home }), null);
    assert.ok(!fs.readFileSync(authFile("far", { home }), "utf8").includes("redirectHost"));
  }

  test("redirectHost localhost: the redirect_uri, the Location and the callback all name localhost, the request goes to 127.0.0.1", async () => {
    await point9("localhost");
    assert.equal((await practice.seen()).registrations, 0);
  });

  test("redirectHost 127.0.0.1: the redirect_uri is exactly http://127.0.0.1:<port>/callback", async () => {
    await point9("127.0.0.1");
  });

  test("no redirectHost: the redirect_uri is exactly http://127.0.0.1:<port>/callback", async () => {
    await point9(undefined);
  });
});
