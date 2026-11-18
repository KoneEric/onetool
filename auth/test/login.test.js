import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { login, authFile, authFolder, signInStamp } from "../src/index.js";
import {
  startPractice,
  fakeServer,
  beginLogin,
  signIn,
  tmpHome,
  freePort,
  listening,
  locationOf,
  hit,
  browser,
  within,
  readJson,
} from "./helpers.js";

let srv;
let other;
const fakes = [];
before(async () => {
  srv = await startPractice();
  other = await startPractice();
});
after(() => {
  srv?.stop();
  other?.stop();
  for (const f of fakes) f.stop();
});
const fake = async (opts) => {
  const f = await fakeServer(opts);
  fakes.push(f);
  return f;
};

/** The browser of the person: asks for the address, does not follow the redirect, comes back to the callback by hand. */
async function finish(l) {
  const loc = await locationOf(await l.address());
  return hit(loc.origin + loc.pathname, { query: Object.fromEntries(loc.searchParams) });
}

const portOf = (callback) => Number(new URL(callback).port);

describe("login: the sign-in from the start to the end", () => {
  test("resolves with exactly { ok: true }; the file is written; the address has the client, the state and the challenge", async () => {
    const home = tmpHome();
    const before = signInStamp("far", srv.url, { home });
    assert.equal(before, null);
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const a = await l.address();
    assert.equal(a.origin, srv.origin);
    assert.equal(a.pathname, "/authorize");
    const cb = a.searchParams.get("redirect_uri");
    assert.match(cb, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.ok(portOf(cb) > 0);
    assert.match(a.searchParams.get("client_id"), /^practice-client-\d+$/);
    assert.ok(a.searchParams.get("state"), "a state");
    assert.ok(a.searchParams.get("code_challenge"), "a code challenge");
    assert.ok(!/client_secret|code_verifier/.test(a.href), "no secret in the address");
    assert.equal(await listening(portOf(cb)), true, "listening on the callback port while it waits");
    const r = await finish(l);
    assert.equal(r.status, 200);
    const res = await l.result();
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(Object.keys(res), ["ok"]);
    assert.notEqual(signInStamp("far", srv.url, { home }), null);
    const doc = readJson(authFile("far", { home }));
    assert.equal(doc.server, "far");
    assert.equal(doc.url, srv.url);
    assert.equal(await listening(portOf(cb)), false, "nothing listens any more");
  });

  test("say is called once with the address as a string, then open once with the same", async () => {
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const a = await l.address();
    await finish(l);
    await l.result();
    assert.equal(l.calls.say.length, 1);
    assert.equal(typeof l.calls.say[0], "string");
    assert.equal(new URL(l.calls.say[0]).href, a.href);
    assert.deepEqual(l.calls.open, l.calls.say);
    assert.deepEqual(l.calls.log, ["say", "open"]);
  });

  test("say and open are independent: either alone works", async () => {
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: srv.url }, { home, open: null });
    await finish(l);
    assert.deepEqual(await l.result(), { ok: true });
    assert.equal(l.calls.open.length, 0);
    const home2 = tmpHome();
    const done = within(login({ name: "far", url: srv.url }, { home: home2, waitSeconds: 10, open: browser }), 12000, "login with open only");
    assert.deepEqual(await done, { ok: true });
  });

  test("what say or open throws is ignored; neither is awaited", async () => {
    const home = tmpHome();
    let opened = 0;
    const r1 = await within(
      login(
        { name: "far", url: srv.url },
        {
          home,
          waitSeconds: 10,
          say: () => {
            throw new Error("say fails");
          },
          open: (a) => {
            opened++;
            browser(a);
          },
        },
      ),
      12000,
      "say throws",
    );
    assert.deepEqual(r1, { ok: true });
    assert.equal(opened, 1, "open is called although say threw");
    const home2 = tmpHome();
    const r2 = await within(
      login(
        { name: "far", url: srv.url },
        {
          home: home2,
          waitSeconds: 10,
          say: browser,
          open: () => {
            throw new Error("open fails");
          },
        },
      ),
      12000,
      "open throws",
    );
    assert.deepEqual(r2, { ok: true });
    const home3 = tmpHome();
    const r3 = await within(
      login(
        { name: "far", url: srv.url },
        {
          home: home3,
          waitSeconds: 10,
          say: (a) => {
            browser(a);
            return new Promise(() => {});
          },
        },
      ),
      12000,
      "say returns a promise that never settles",
    );
    assert.deepEqual(r3, { ok: true });
  });

  test("the state is random: two sign-ins do not give the same one; each registers a new client", async () => {
    const home = tmpHome();
    const states = [];
    const clients = [];
    const seenBefore = (await srv.seen()).registrations;
    for (let i = 0; i < 2; i++) {
      const l = beginLogin({ name: "far", url: srv.url }, { home });
      const a = await l.address();
      states.push(a.searchParams.get("state"));
      clients.push(a.searchParams.get("client_id"));
      await finish(l);
      assert.deepEqual(await l.result(), { ok: true });
    }
    assert.notEqual(states[0], states[1]);
    assert.notEqual(clients[0], clients[1]);
    assert.equal((await srv.seen()).registrations, seenBefore + 2);
  });

  test("a sign-in that was there is replaced: a new stamp; another address replaces it too", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const s1 = signInStamp("far", srv.url, { home });
    await signIn({ name: "far", url: srv.url, home });
    const s2 = signInStamp("far", srv.url, { home });
    assert.ok(s1 && s2 && s1 !== s2);
    await signIn({ name: "far", url: other.url, home });
    assert.equal(readJson(authFile("far", { home })).url, other.url);
    assert.equal(signInStamp("far", srv.url, { home }), null);
    assert.notEqual(signInStamp("far", other.url, { home }), null);
    assert.deepEqual(fs.readdirSync(authFolder({ home })), ["far.json"]);
  });
});

describe("login: the requests to what it listens on", () => {
  test("not exactly /callback, or not GET: 404, and it goes on waiting", async () => {
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const cb = await l.callback();
    const state = (await l.address()).searchParams.get("state");
    const good = { state, code: "x" };
    for (const t of [
      { pathname: "/" },
      { pathname: "/other" },
      { pathname: "/callback/" },
      { pathname: "/callbackx" },
      { pathname: "/Callback" },
      { pathname: "/a/callback" },
      { method: "POST", pathname: "/callback" },
      { method: "PUT", pathname: "/callback" },
      { method: "DELETE", pathname: "/callback" },
    ]) {
      const r = await hit(cb, { query: good, ...t });
      assert.equal(r.status, 404, JSON.stringify(t));
    }
    const r = await finish(l);
    assert.equal(r.status, 200);
    assert.deepEqual(await l.result(), { ok: true });
  });

  test("the state absent or not the true one: 400, and it goes on waiting (this is tested before error and code)", async () => {
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const cb = await l.callback();
    for (const query of [
      {},
      { code: "x" },
      { error: "access_denied" },
      { state: "not-the-state", code: "x" },
      { state: "not-the-state", error: "access_denied" },
      { state: "", code: "x" },
    ]) {
      const r = await hit(cb, { query });
      assert.equal(r.status, 400, JSON.stringify(query));
    }
    const r = await finish(l);
    assert.equal(r.status, 200);
    assert.deepEqual(await l.result(), { ok: true });
  });

  describe("error given, or no code, or an empty code: 400 with `not signed in`, the sign-in was refused", () => {
    for (const [what, query] of [
      ["error", { error: "access_denied" }],
      ["error and a code", { error: "access_denied", code: "x" }],
      ["no code", {}],
      ["an empty code", { code: "" }],
    ]) {
      test(what, async () => {
        const home = tmpHome();
        const l = beginLogin({ name: "far", url: srv.url }, { home });
        const cb = await l.callback();
        const r = await l.come(query);
        assert.equal(r.status, 400);
        assert.ok(r.text.includes("not signed in"), r.text);
        assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
        assert.equal(signInStamp("far", srv.url, { home }), null);
        assert.equal(fs.existsSync(authFile("far", { home })), false);
        assert.equal(await listening(portOf(cb)), false, "nothing listens any more");
      });
    }
  });

  test("a refused sign-in leaves the sign-in that was there, still usable", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const file = authFile("far", { home });
    const text = fs.readFileSync(file);
    const stamp = signInStamp("far", srv.url, { home });
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    await l.come({ error: "access_denied" });
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
    assert.deepEqual(fs.readFileSync(file), text);
    assert.equal(signInStamp("far", srv.url, { home }), stamp);
  });

  test("a code: 200 and `signed in, you can close this page`, after the file is written; the body holds nothing of the address", async () => {
    const home = tmpHome();
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const a = await l.address();
    const loc = await locationOf(a);
    const code = loc.searchParams.get("code");
    const r = await hit(loc.origin + loc.pathname, { query: Object.fromEntries(loc.searchParams) });
    assert.equal(r.status, 200);
    assert.ok(r.text.includes("signed in, you can close this page"), r.text);
    assert.notEqual(signInStamp("far", srv.url, { home }), null, "the file is there when the browser has its answer");
    for (const s of [code, a.searchParams.get("state"), a.searchParams.get("client_id"), a.searchParams.get("code_challenge"), a.href, "practice-at-", "practice-rt-"]) {
      assert.ok(!r.text.includes(s), `the body holds ${s}`);
    }
    assert.deepEqual(await l.result(), { ok: true });
  });

  test("a code that cannot be exchanged: 400 and `not signed in`, the sign-in could not be finished, the file as it was", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const file = authFile("far", { home });
    const text = fs.readFileSync(file);
    const stamp = signInStamp("far", srv.url, { home });
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const r = await l.come({ code: "practice-code-not-a-true-one" });
    assert.equal(r.status, 400);
    assert.ok(r.text.includes("not signed in"), r.text);
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in could not be finished" });
    assert.deepEqual(fs.readFileSync(file), text);
    assert.equal(signInStamp("far", srv.url, { home }), stamp);
  });

  test("tokens that cannot be written: 400 and `not signed in`, the sign-in could not be kept; nothing written outside the folder", async () => {
    const home = tmpHome();
    fs.writeFileSync(path.join(home, ".onetool"), "in the way");
    const l = beginLogin({ name: "far", url: srv.url }, { home });
    const loc = await locationOf(await l.address());
    const r = await hit(loc.origin + loc.pathname, { query: Object.fromEntries(loc.searchParams) });
    assert.equal(r.status, 400);
    assert.ok(r.text.includes("not signed in"), r.text);
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in could not be kept" });
    assert.deepEqual(fs.readdirSync(home), [".onetool"]);
    assert.equal(fs.readFileSync(path.join(home, ".onetool"), "utf8"), "in the way");
  });

  test("a second request with a code while the exchange is in progress: 400, and it changes nothing", async () => {
    const home = tmpHome();
    const f = await fake();
    const h = f.hold();
    const l = beginLogin({ name: "far", url: f.url }, { home });
    const first = l.come({ code: "first-code" });
    await within(h.reachedP, 8000, "the exchange of the code");
    const second = await l.come({ code: "second-code" });
    assert.equal(second.status, 400);
    assert.equal(f.tokens.length, 1, "one exchange only");
    h.release();
    const r = await first;
    assert.equal(r.status, 200);
    assert.ok(r.text.includes("signed in, you can close this page"));
    assert.deepEqual(await l.result(), { ok: true });
    assert.equal(f.tokens.length, 1);
    assert.equal(f.tokens[0].params.code, "first-code");
  });
});

describe("login: the port", () => {
  test("oauth.port is the port of the callback address, and nothing listens after", async () => {
    const home = tmpHome();
    const port = await freePort();
    const l = beginLogin({ name: "far", url: srv.url, oauth: { clientId: "x", port } }, { home });
    const a = await l.address();
    assert.equal(a.searchParams.get("redirect_uri"), `http://127.0.0.1:${port}/callback`);
    assert.equal(await listening(port), true);
    await l.come({ error: "access_denied" });
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
    assert.equal(await listening(port), false);
  });

  test("a port that is taken: cannot listen on port <port>; say is not called; the first reason that applies", async () => {
    const taker = net.createServer();
    await new Promise((resolve) => taker.listen(0, "127.0.0.1", resolve));
    const port = taker.address().port;
    try {
      const home = tmpHome();
      const closed = await freePort();
      for (const url of [srv.url, `http://127.0.0.1:${closed}/mcp`]) {
        const l = beginLogin({ name: "far", url, oauth: { clientId: "x", port } }, { home });
        assert.deepEqual(await l.result(), { ok: false, reason: `cannot listen on port ${port}` });
        assert.equal(l.calls.say.length, 0);
      }
      assert.equal(await listening(port), true, "the other one still listens");
      assert.equal(fs.existsSync(authFile("far", { home })), false);
    } finally {
      await new Promise((resolve) => taker.close(resolve));
    }
  });
});

describe("login: the sign-in could not be started", () => {
  const started = { ok: false, reason: "the sign-in could not be started" };

  test("the server cannot be reached", async () => {
    const home = tmpHome();
    const closed = await freePort();
    const l = beginLogin({ name: "far", url: `http://127.0.0.1:${closed}/mcp` }, { home });
    assert.deepEqual(await l.result(), started);
    assert.equal(l.calls.say.length, 0);
    assert.equal(l.calls.open.length, 0);
    assert.equal(fs.existsSync(authFile("far", { home })), false);
  });

  test("the server names no sign-in server, and nothing can be registered", async () => {
    const home = tmpHome();
    const f = await fake({ blank: true });
    const l = beginLogin({ name: "far", url: f.url }, { home });
    assert.deepEqual(await l.result(), started);
    assert.equal(l.calls.say.length, 0);
  });

  test("the sign-in server does not let a client register itself and no oauth is given", async () => {
    const home = tmpHome();
    const f = await fake({ noRegister: true });
    const l = beginLogin({ name: "far", url: f.url }, { home });
    assert.deepEqual(await l.result(), started);
    assert.equal(l.calls.say.length, 0);
    assert.equal(f.registers.length, 0);
  });
});

describe("login: the client, the scopes and the exchange", () => {
  test("with no oauth: a new client named onetool, the callback address as its only redirect address, no secret asked", async () => {
    const home = tmpHome();
    const f = await fake();
    for (let i = 1; i <= 2; i++) {
      const l = beginLogin({ name: "far", url: f.url }, { home });
      const cb = await l.callback();
      assert.equal(f.registers.length, i);
      const body = f.registers[i - 1];
      assert.equal(body.client_name, "onetool");
      assert.deepEqual(body.redirect_uris, [cb]);
      assert.equal(body.client_secret, undefined);
      if (body.token_endpoint_auth_method !== undefined) assert.equal(body.token_endpoint_auth_method, "none");
      assert.equal((await l.address()).searchParams.get("client_id"), `fake-client-${i}`);
      await l.come({ error: "access_denied" });
      await l.result();
    }
  });

  test("with oauth: that client, nothing sent to a registration address, the scopes joined by one space, no secret in the address", async () => {
    const home = tmpHome();
    const f = await fake();
    const l = beginLogin({ name: "far", url: f.url, oauth: { clientId: "my-client", clientSecret: "s3cret-value", scopes: ["read", "write"] } }, { home });
    const a = await l.address();
    assert.equal(a.searchParams.get("client_id"), "my-client");
    assert.equal(a.searchParams.get("scope"), "read write");
    assert.ok(!a.href.includes("s3cret-value"));
    assert.equal(f.registers.length, 0);
    await l.come({ error: "access_denied" });
    assert.deepEqual(await l.result(), { ok: false, reason: "the sign-in was refused" });
    assert.equal(f.registers.length, 0);
  });

  test("the exchange: the code, the callback address, a verifier and the client; the file holds neither the secret nor the verifier", async () => {
    const home = tmpHome();
    const f = await fake();
    const l = beginLogin({ name: "far", url: f.url, oauth: { clientId: "my-client", clientSecret: "s3cret-value" } }, { home });
    const cb = await l.callback();
    const r = await l.come({ code: "the-code" });
    assert.equal(r.status, 200);
    assert.deepEqual(await l.result(), { ok: true });
    assert.equal(f.tokens.length, 1);
    const { params, headers } = f.tokens[0];
    assert.equal(params.grant_type, "authorization_code");
    assert.equal(params.code, "the-code");
    assert.equal(params.redirect_uri, cb);
    assert.ok(params.code_verifier, "a verifier");
    const basic = `Basic ${Buffer.from("my-client:s3cret-value").toString("base64")}`;
    assert.ok(params.client_secret === "s3cret-value" || headers.authorization === basic, "the secret goes with the exchange");
    assert.ok(params.client_id === "my-client" || headers.authorization === basic);
    const text = fs.readFileSync(authFile("far", { home }), "utf8");
    assert.ok(!text.includes("s3cret-value"), "no client secret in the file");
    assert.ok(!text.includes(params.code_verifier), "no code verifier in the file");
    assert.ok(text.includes(f.issued[0].access_token), "the access token is in the file");
    assert.equal(readJson(authFile("far", { home })).url, f.url);
  });
});

describe("login: the limit, the one period", () => {
  test("no browser comes back: no answer in <waitSeconds> seconds, at most one second after the limit", async () => {
    const home = tmpHome();
    const t0 = Date.now();
    const l = beginLogin({ name: "far", url: srv.url }, { home, waitSeconds: 0.5 });
    const cb = await l.callback();
    const res = await within(l.promise, 3000, "the limit");
    const took = Date.now() - t0;
    assert.deepEqual(res, { ok: false, reason: "no answer in 0.5 seconds" });
    assert.ok(took >= 400 && took <= 1500, `took ${took} ms`);
    assert.equal(await listening(portOf(cb)), false, "nothing listens any more");
    assert.equal(fs.existsSync(authFile("far", { home })), false);
  });

  test("say and open absent: nothing is said, the sign-in ends by the limit", async () => {
    const home = tmpHome();
    const res = await within(login({ name: "far", url: srv.url }, { home, waitSeconds: 0.5 }), 3000, "the limit");
    assert.deepEqual(res, { ok: false, reason: "no answer in 0.5 seconds" });
  });

  test("the limit holds for the requests of the first step too", async () => {
    const home = tmpHome();
    const f = await fake({ hangAll: true });
    const t0 = Date.now();
    const l = beginLogin({ name: "far", url: f.url }, { home, waitSeconds: 0.5 });
    const res = await within(l.promise, 3000, "the limit");
    assert.deepEqual(res, { ok: false, reason: "no answer in 0.5 seconds" });
    assert.ok(Date.now() - t0 <= 1500);
    assert.equal(l.calls.say.length, 0);
  });

  test("a sign-in that was there is still there and still usable after the limit", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const text = fs.readFileSync(authFile("far", { home }));
    const stamp = signInStamp("far", srv.url, { home });
    const res = await within(login({ name: "far", url: srv.url }, { home, waitSeconds: 0.5, say: () => {} }), 3000, "the limit");
    assert.equal(res.ok, false);
    assert.deepEqual(fs.readFileSync(authFile("far", { home })), text);
    assert.equal(signInStamp("far", srv.url, { home }), stamp);
  });
});
