import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  call,
  mcp,
  wait,
  basic,
  token,
  register,
  authorize,
  newCode,
  pkce,
  seen,
  signInByHand,
  withSignin,
  CB,
} from "./signin-helpers.js";

const AT = /^practice-at-[A-Za-z0-9_-]{32}$/;
const RT = /^practice-rt-[A-Za-z0-9_-]{32}$/;
const CODE = /^practice-code-[A-Za-z0-9_-]{32}$/;
const JSON_HEADERS = { "Content-Type": "application/json" };
const postJson = (srv, path, body) => call(srv, { method: "POST", path, headers: JSON_HEADERS, body });
const refresh = (srv, params, auth) => token(srv, { grant_type: "refresh_token", ...params }, auth);

const query = (srv, params) => authorize(srv, { response_type: "code", code_challenge_method: "S256", code_challenge: pkce().challenge, ...params });

describe("Step 10: requests 1 and 2, the two documents", () => {
  test("the protected resource document is at both paths, with or without a query", async () => {
    await withSignin([], async (srv) => {
      for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource?x=1"]) {
        const r = await call(srv, { path });
        assert.equal(r.status, 200, path);
        assert.equal(r.json.resource, `${srv.origin}/mcp`, path);
        assert.deepEqual(r.json.authorization_servers, [srv.origin], path);
      }
    });
  });

  test("the authorization server document, without --client: with a registration endpoint and no secret", async () => {
    await withSignin([], async (srv) => {
      const r = await call(srv, { path: "/.well-known/oauth-authorization-server" });
      assert.equal(r.status, 200);
      const d = r.json;
      assert.equal(d.issuer, srv.origin);
      assert.equal(d.authorization_endpoint, `${srv.origin}/authorize`);
      assert.equal(d.token_endpoint, `${srv.origin}/token`);
      assert.deepEqual(d.response_types_supported, ["code"]);
      assert.deepEqual(d.grant_types_supported, ["authorization_code", "refresh_token"]);
      assert.deepEqual(d.code_challenge_methods_supported, ["S256"]);
      assert.deepEqual(d.token_endpoint_auth_methods_supported, ["none"]);
      assert.equal(d.registration_endpoint, `${srv.origin}/register`);
    });
  });

  test("with --client: no registration endpoint; with --secret: the two secret methods", async () => {
    await withSignin(["--client", "fixed"], async (srv) => {
      const d = (await call(srv, { path: "/.well-known/oauth-authorization-server" })).json;
      assert.equal(d.issuer, srv.origin);
      assert.equal(Object.hasOwn(d, "registration_endpoint"), false);
      assert.deepEqual(d.token_endpoint_auth_methods_supported, ["none"]);
    });
    await withSignin(["--client", "fixed", "--secret", "s3"], async (srv) => {
      const d = (await call(srv, { path: "/.well-known/oauth-authorization-server" })).json;
      assert.equal(d.token_endpoint, `${srv.origin}/token`);
      assert.equal(Object.hasOwn(d, "registration_endpoint"), false);
      assert.deepEqual(d.token_endpoint_auth_methods_supported, ["client_secret_basic", "client_secret_post"]);
    });
  });
});

describe("Step 10: request 3, /register", () => {
  test("a body with redirect_uris gives 201, what the body held, a new client_id and no secret", async () => {
    await withSignin([], async (srv) => {
      const first = await postJson(srv, "/register", JSON.stringify({ redirect_uris: [CB], client_name: "one" }));
      assert.equal(first.status, 201, first.text);
      assert.equal(first.json.client_id, "practice-client-1");
      assert.deepEqual(first.json.redirect_uris, [CB]);
      assert.equal(first.json.client_name, "one");
      assert.equal(Object.hasOwn(first.json, "client_secret"), false);
      const second = await postJson(srv, "/register", JSON.stringify({ redirect_uris: ["myapp://callback", "http://localhost:1/x"] }));
      assert.equal(second.status, 201, second.text);
      assert.equal(second.json.client_id, "practice-client-2");
      assert.deepEqual(second.json.redirect_uris, ["myapp://callback", "http://localhost:1/x"]);
      assert.equal(Object.hasOwn(second.json, "client_secret"), false);
    });
  });

  test("any other body gives 400 with invalid_client_metadata, and no client_id is used up", async () => {
    await withSignin([], async (srv) => {
      const bad = ["{}", '{"redirect_uris":[]}', '{"redirect_uris":"http://127.0.0.1/cb"}', '{"redirect_uris":[1]}', '{"redirect_uris":null}', "[]", '"text"', "null", "5", "{not json", "", '{"client_name":"x"}'];
      for (const body of bad) {
        const r = await postJson(srv, "/register", body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.deepEqual(r.json, { error: "invalid_client_metadata" }, JSON.stringify(body));
      }
      const ok = await register(srv);
      assert.equal(ok.client_id, "practice-client-1");
    });
  });

  test("with --client: 404, whatever the body", async () => {
    await withSignin(["--client", "fixed"], async (srv) => {
      for (const body of [JSON.stringify({ redirect_uris: [CB] }), "{}", ""]) {
        const r = await postJson(srv, "/register", body);
        assert.equal(r.status, 404, JSON.stringify(body));
      }
      assert.equal((await seen(srv)).registrations, 0);
    });
  });
});

describe("Step 10: request 4, /authorize", () => {
  test("all of it holds: 302 to the redirect_uri with the new code and the state, and nothing else", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv, [CB, "http://127.0.0.1:9/other?keep=1"]);
      const state = "a b&c=d/é?";
      const a = await query(srv, { client_id, redirect_uri: CB, state });
      assert.equal(a.status, 302);
      assert.equal(a.url.origin + a.url.pathname, CB);
      assert.match(a.code, CODE);
      assert.equal(a.state, state);
      assert.deepEqual([...a.url.searchParams.keys()].sort(), ["code", "state"]);

      const none = await query(srv, { client_id, redirect_uri: CB });
      assert.equal(none.status, 302);
      assert.match(none.code, CODE);
      assert.deepEqual([...none.url.searchParams.keys()], ["code"]);
      assert.notEqual(none.code, a.code);

      const kept = await query(srv, { client_id, redirect_uri: "http://127.0.0.1:9/other?keep=1", state: "s" });
      assert.equal(kept.status, 302);
      assert.equal(kept.url.origin + kept.url.pathname, "http://127.0.0.1:9/other");
      assert.equal(kept.url.searchParams.get("keep"), "1");
      assert.equal(kept.url.searchParams.get("state"), "s");
      assert.match(kept.url.searchParams.get("code"), CODE);
    });
  });

  test("it asks no question and sets no cookie", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const { challenge } = pkce();
      const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: "S256" });
      const r = await call(srv, { path: `/authorize?${q}` });
      assert.equal(r.status, 302);
      assert.equal(r.headers["set-cookie"], undefined);
      assert.equal(r.text, "");
    });
  });

  test("anything missing or wrong is 400, for a registered client", async () => {
    await withSignin([], async (srv) => {
      const a = await register(srv, [CB]);
      const b = await register(srv, ["http://127.0.0.1:9/b"]);
      const ok = { client_id: a.client_id, redirect_uri: CB };
      const cases = {
        "no response_type": { response_type: undefined },
        "response_type token": { response_type: "token" },
        "response_type CODE": { response_type: "CODE" },
        "no client_id": { client_id: undefined },
        "unknown client_id": { client_id: "practice-client-99" },
        "client_id of --client mode": { client_id: "fixed" },
        "no redirect_uri": { redirect_uri: undefined },
        "redirect_uri with a slash added": { redirect_uri: `${CB}/` },
        "redirect_uri with a query added": { redirect_uri: `${CB}?a=1` },
        "redirect_uri of another client": { redirect_uri: "http://127.0.0.1:9/b" },
        "redirect_uri not registered at all": { redirect_uri: "http://127.0.0.1:1/x" },
        "empty redirect_uri": { redirect_uri: "" },
        "no code_challenge": { code_challenge: "" },
        "no code_challenge_method": { code_challenge_method: "" },
        "method plain": { code_challenge_method: "plain" },
        "method s256": { code_challenge_method: "s256" },
      };
      for (const [what, change] of Object.entries(cases)) {
        const params = { ...ok, ...change };
        const q = { response_type: "code", code_challenge: pkce().challenge, code_challenge_method: "S256", ...params };
        const r = await authorize(srv, Object.fromEntries(Object.entries(q).filter(([k, v]) => !(k in change) || v !== undefined)));
        assert.equal(r.status, 400, what);
        assert.equal(r.code, undefined, what);
      }
      // The other client's own address is good for it.
      assert.equal((await query(srv, { client_id: b.client_id, redirect_uri: "http://127.0.0.1:9/b" })).status, 302);
      // Nothing at all.
      assert.equal((await call(srv, { path: "/authorize" })).status, 400);
    });
  });

  test("a missing code_challenge or method is 400 when the parameter is not sent at all", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const base = { response_type: "code", client_id, redirect_uri: CB };
      const { challenge } = pkce();
      assert.equal((await authorize(srv, { ...base, code_challenge_method: "S256" })).status, 400);
      assert.equal((await authorize(srv, { ...base, code_challenge: challenge })).status, 400);
      assert.equal((await authorize(srv, { ...base, code_challenge: challenge, code_challenge_method: "S256" })).status, 302);
    });
  });

  test("with --client: the client is known, and any http address on 127.0.0.1 or localhost is good", async () => {
    await withSignin(["--client", "fixed"], async (srv) => {
      for (const redirect_uri of ["http://127.0.0.1:5555/cb", "http://localhost:1/x", "http://127.0.0.1/cb?x=1", "http://localhost/"]) {
        const a = await query(srv, { client_id: "fixed", redirect_uri, state: "st" });
        assert.equal(a.status, 302, redirect_uri);
        assert.match(a.code, CODE);
        assert.equal(a.state, "st");
        assert.equal(a.url.origin + a.url.pathname, new URL(redirect_uri).origin + new URL(redirect_uri).pathname);
      }
      for (const redirect_uri of [
        "https://127.0.0.1/cb",
        "https://localhost/cb",
        "http://example.com/cb",
        "http://127.0.0.2/cb",
        "http://localhost.example.com/cb",
        "http://127.0.0.1:pw@evil-host/cb",
        "http://[::1]/cb",
        "ftp://127.0.0.1/cb",
        "myapp://callback",
        "not a url",
        "/cb",
        "",
      ]) {
        const a = await query(srv, { client_id: "fixed", redirect_uri });
        assert.equal(a.status, 400, JSON.stringify(redirect_uri));
      }
      assert.equal((await query(srv, { client_id: "practice-client-1", redirect_uri: CB })).status, 400);
      assert.equal((await query(srv, { client_id: "Fixed", redirect_uri: CB })).status, 400);
    });
  });
});

describe("Step 10: request 5, /token, the authorization code", () => {
  test("a code is exchanged once for the four keys, in the forms that are given", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const c = await newCode(srv, client_id);
      const r = await token(srv, { grant_type: "authorization_code", client_id, code: c.code, redirect_uri: CB, code_verifier: c.verifier });
      assert.equal(r.status, 200, r.text);
      assert.match(r.json.access_token, AT);
      assert.equal(r.json.token_type, "Bearer");
      assert.equal(r.json.expires_in, 3600);
      assert.match(r.json.refresh_token, RT);
      assert.match(r.headers["content-type"] ?? "", /json/);
      const again = await token(srv, { grant_type: "authorization_code", client_id, code: c.code, redirect_uri: CB, code_verifier: c.verifier });
      assert.equal(again.status, 400);
      assert.equal(again.json.error, "invalid_grant");
    });
  });

  test("each exchange gives a new access token and a new refresh token", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const one = await signInByHand(srv, client_id);
      const two = await signInByHand(srv, client_id);
      assert.notEqual(one.access_token, two.access_token);
      assert.notEqual(one.refresh_token, two.refresh_token);
      assert.equal((await mcp(srv, `Bearer ${one.access_token}`)).status, 200);
      assert.equal((await mcp(srv, `Bearer ${two.access_token}`)).status, 200);
    });
  });

  test("the client may be named by HTTP Basic", async () => {
    await withSignin(["--client", "fixed", "--secret", "s3"], async (srv) => {
      const t = await signInByHand(srv, "fixed", { auth: basic("fixed", "s3"), redirect_uri: "http://localhost:4/cb" });
      assert.match(t.access_token, AT);
      assert.equal((await mcp(srv, `Bearer ${t.access_token}`)).status, 200);
    });
  });

  test("the expires_in is the number of --expires: 3600 by default", async () => {
    for (const [extra, expected] of [[[], 3600], [["--expires", "7"], 7], [["--expires", "86400"], 86400]]) {
      await withSignin(extra, async (srv) => {
        const { client_id } = await register(srv);
        const t = await signInByHand(srv, client_id);
        assert.equal(t.expires_in, expected);
        const next = await refresh(srv, { client_id, refresh_token: t.refresh_token });
        assert.equal(next.json.expires_in, expected);
      });
    }
  });

  test("a code that is not known, not given to this client, for another address or with the wrong verifier is invalid_grant", async () => {
    await withSignin([], async (srv) => {
      const a = await register(srv, [CB, "http://127.0.0.1:9/second"]);
      const b = await register(srv, [CB]);
      const good = (c, client_id) => ({ grant_type: "authorization_code", client_id, code: c.code, redirect_uri: c.redirect_uri, code_verifier: c.verifier });
      const bad = async (what, params) => {
        const r = await token(srv, params);
        assert.equal(r.status, 400, what);
        assert.equal(r.json.error, "invalid_grant", what);
      };
      await bad("unknown code", { ...good(await newCode(srv, a.client_id), a.client_id), code: "practice-code-" + "A".repeat(32) });
      await bad("no code", { ...good(await newCode(srv, a.client_id), a.client_id), code: undefined });
      await bad("another client", good(await newCode(srv, a.client_id), b.client_id));
      await bad("another address", { ...good(await newCode(srv, a.client_id, "http://127.0.0.1:9/second"), a.client_id), redirect_uri: CB });
      await bad("wrong verifier", { ...good(await newCode(srv, a.client_id), a.client_id), code_verifier: pkce().verifier });
      await bad("no verifier", { ...good(await newCode(srv, a.client_id), a.client_id), code_verifier: undefined });
      // The address of the second /authorize is the one that works for its code.
      const c = await newCode(srv, a.client_id, "http://127.0.0.1:9/second");
      const ok = await token(srv, good(c, a.client_id));
      assert.equal(ok.status, 200, ok.text);
    });
  });

  test("the challenge is the base64url SHA-256 of the verifier: the verifier itself as the challenge does not work", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const { verifier } = pkce();
      const a = await authorize(srv, { response_type: "code", client_id, redirect_uri: CB, code_challenge: verifier, code_challenge_method: "S256" });
      assert.equal(a.status, 302);
      const r = await token(srv, { grant_type: "authorization_code", client_id, code: a.code, redirect_uri: CB, code_verifier: verifier });
      assert.equal(r.status, 400);
      assert.equal(r.json.error, "invalid_grant");
    });
  });

  test("another grant_type is unsupported_grant_type", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      for (const grant_type of ["client_credentials", "password", "implicit", "Authorization_Code", "urn:ietf:params:oauth:grant-type:device_code"]) {
        const r = await token(srv, { grant_type, client_id });
        assert.equal(r.status, 400, grant_type);
        assert.equal(r.json.error, "unsupported_grant_type", grant_type);
      }
    });
  });

  test("with --secret the secret must come with it, by HTTP Basic or in the body: else 401 invalid_client", async () => {
    await withSignin(["--client", "fixed", "--secret", "s3"], async (srv) => {
      const redirect_uri = "http://127.0.0.1:7/cb";
      const exchange = async (extra, auth) => {
        const c = await newCode(srv, "fixed", redirect_uri);
        return token(srv, { grant_type: "authorization_code", code: c.code, redirect_uri, code_verifier: c.verifier, ...extra }, auth);
      };
      for (const [what, extra, auth] of [
        ["no secret", { client_id: "fixed" }, undefined],
        ["wrong secret in the body", { client_id: "fixed", client_secret: "nope" }, undefined],
        ["empty secret in the body", { client_id: "fixed", client_secret: "" }, undefined],
        ["wrong secret by Basic", {}, basic("fixed", "nope")],
        ["Basic with no secret", {}, basic("fixed", "")],
      ]) {
        const r = await exchange(extra, auth);
        assert.equal(r.status, 401, what);
        assert.equal(r.json.error, "invalid_client", what);
      }
      const inBody = await exchange({ client_id: "fixed", client_secret: "s3" });
      assert.equal(inBody.status, 200, inBody.text);
      const byBasic = await exchange({}, basic("fixed", "s3"));
      assert.equal(byBasic.status, 200, byBasic.text);
      assert.equal((await seen(srv)).tokens, 2);
    });
  });

  test("with --secret the refresh grant asks for the secret too", async () => {
    await withSignin(["--client", "fixed", "--secret", "s3"], async (srv) => {
      const redirect_uri = "http://127.0.0.1:7/cb";
      const one = await signInByHand(srv, "fixed", { redirect_uri, secret: "s3" });
      const none = await refresh(srv, { client_id: "fixed", refresh_token: one.refresh_token });
      assert.equal(none.status, 401);
      assert.equal(none.json.error, "invalid_client");
      const two = await signInByHand(srv, "fixed", { redirect_uri, secret: "s3" });
      const wrong = await refresh(srv, { client_id: "fixed", refresh_token: two.refresh_token }, basic("fixed", "nope"));
      assert.equal(wrong.status, 401);
      const three = await signInByHand(srv, "fixed", { redirect_uri, secret: "s3" });
      const ok = await refresh(srv, { refresh_token: three.refresh_token }, basic("fixed", "s3"));
      assert.equal(ok.status, 200, ok.text);
      const four = await signInByHand(srv, "fixed", { redirect_uri, secret: "s3" });
      const okBody = await refresh(srv, { client_id: "fixed", client_secret: "s3", refresh_token: four.refresh_token });
      assert.equal(okBody.status, 200, okBody.text);
    });
  });
});

describe("Step 10: request 5, /token, the refresh token", () => {
  test("a refresh gives four keys, a new access token and a new refresh token; the old two no longer work", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const old = await signInByHand(srv, client_id);
      assert.equal((await mcp(srv, `Bearer ${old.access_token}`)).status, 200);
      const r = await refresh(srv, { client_id, refresh_token: old.refresh_token });
      assert.equal(r.status, 200, r.text);
      assert.match(r.json.access_token, AT);
      assert.equal(r.json.token_type, "Bearer");
      assert.equal(r.json.expires_in, 3600);
      assert.match(r.json.refresh_token, RT);
      assert.notEqual(r.json.access_token, old.access_token);
      assert.notEqual(r.json.refresh_token, old.refresh_token);
      assert.equal((await mcp(srv, `Bearer ${old.access_token}`)).status, 401);
      assert.equal((await mcp(srv, `Bearer ${r.json.access_token}`)).status, 200);
      const again = await refresh(srv, { client_id, refresh_token: old.refresh_token });
      assert.equal(again.status, 400);
      assert.equal(again.json.error, "invalid_grant");
      // The new refresh token goes on.
      const next = await refresh(srv, { client_id, refresh_token: r.json.refresh_token });
      assert.equal(next.status, 200, next.text);
      assert.equal((await mcp(srv, `Bearer ${r.json.access_token}`)).status, 401);
      assert.equal((await mcp(srv, `Bearer ${next.json.access_token}`)).status, 200);
    });
  });

  test("a refresh token that is not known, or belongs to another client, is invalid_grant", async () => {
    await withSignin([], async (srv) => {
      const a = await register(srv);
      const b = await register(srv);
      const t = await signInByHand(srv, a.client_id);
      for (const [what, params] of [
        ["unknown", { client_id: a.client_id, refresh_token: "practice-rt-" + "B".repeat(32) }],
        ["missing", { client_id: a.client_id }],
        ["an access token", { client_id: a.client_id, refresh_token: t.access_token }],
        ["another client", { client_id: b.client_id, refresh_token: t.refresh_token }],
      ]) {
        const r = await refresh(srv, params);
        assert.equal(r.status, 400, what);
        assert.equal(r.json.error, "invalid_grant", what);
      }
      const ok = await refresh(srv, { client_id: a.client_id, refresh_token: t.refresh_token });
      assert.equal(ok.status, 200, ok.text);
    });
  });

  test("an access token ends --expires seconds after it is given; a refresh token has no end of its own", async () => {
    await withSignin(["--expires", "1"], async (srv) => {
      const { client_id } = await register(srv);
      const t = await signInByHand(srv, client_id);
      assert.equal(t.expires_in, 1);
      await wait(1300);
      const gone = await mcp(srv, `Bearer ${t.access_token}`);
      assert.equal(gone.status, 401);
      const r = await refresh(srv, { client_id, refresh_token: t.refresh_token });
      assert.equal(r.status, 200, r.text);
      assert.equal((await mcp(srv, `Bearer ${r.json.access_token}`)).status, 200);
    });
  });
});

describe("Step 10: request 6, /forget", () => {
  test("it answers 204 and forgets every code, access token and refresh token; clients and counts stay", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const live = await signInByHand(srv, client_id);
      const other = await signInByHand(srv, client_id);
      const code = await newCode(srv, client_id);
      assert.equal((await mcp(srv, `Bearer ${live.access_token}`)).status, 200);
      const before = await seen(srv);

      const r = await call(srv, { method: "POST", path: "/forget" });
      assert.equal(r.status, 204);
      assert.deepEqual(await seen(srv), before);

      assert.equal((await mcp(srv, `Bearer ${live.access_token}`)).status, 401);
      assert.equal((await mcp(srv, `Bearer ${other.access_token}`)).status, 401);
      for (const refresh_token of [live.refresh_token, other.refresh_token]) {
        const x = await refresh(srv, { client_id, refresh_token });
        assert.equal(x.status, 400);
        assert.equal(x.json.error, "invalid_grant");
      }
      const y = await token(srv, { grant_type: "authorization_code", client_id, code: code.code, redirect_uri: CB, code_verifier: code.verifier });
      assert.equal(y.status, 400);
      assert.equal(y.json.error, "invalid_grant");

      // The client stays: it signs in again with no new registration, and a new one gets the next number.
      const again = await signInByHand(srv, client_id);
      assert.equal((await mcp(srv, `Bearer ${again.access_token}`)).status, 200);
      assert.equal((await register(srv)).client_id, "practice-client-2");
    });
  });

  test("it is asked with no sign-in, and may be asked again", async () => {
    await withSignin([], async (srv) => {
      for (let i = 0; i < 2; i++) {
        const r = await call(srv, { method: "POST", path: "/forget" });
        assert.equal(r.status, 204);
      }
    });
  });
});

describe("Step 10: request 7, /seen", () => {
  test("it counts what was answered, with exactly five keys", async () => {
    await withSignin([], async (srv) => {
      const r0 = await call(srv, { path: "/seen" });
      assert.equal(r0.status, 200);
      assert.deepEqual(Object.keys(r0.json).sort(), ["authorizations", "refreshes", "refused", "registrations", "tokens"]);
      assert.deepEqual(r0.json, { registrations: 0, authorizations: 0, tokens: 0, refreshes: 0, refused: 0 });

      const a = await register(srv);
      const b = await register(srv);
      await postJson(srv, "/register", "{}");
      assert.deepEqual(await seen(srv), { registrations: 2, authorizations: 0, tokens: 0, refreshes: 0, refused: 0 });

      const ca = await newCode(srv, a.client_id);
      const cb = await newCode(srv, b.client_id);
      assert.equal((await query(srv, { client_id: "practice-client-9", redirect_uri: CB })).status, 400);
      assert.deepEqual(await seen(srv), { registrations: 2, authorizations: 2, tokens: 0, refreshes: 0, refused: 0 });

      const grant = (c, client_id) => ({ grant_type: "authorization_code", client_id, code: c.code, redirect_uri: CB, code_verifier: c.verifier });
      const ta = await token(srv, grant(ca, a.client_id));
      const tb = await token(srv, grant(cb, b.client_id));
      assert.equal(ta.status, 200);
      assert.equal(tb.status, 200);
      assert.equal((await token(srv, grant(ca, a.client_id))).status, 400);
      assert.equal((await token(srv, { grant_type: "nope", client_id: a.client_id })).status, 400);
      assert.deepEqual(await seen(srv), { registrations: 2, authorizations: 2, tokens: 2, refreshes: 0, refused: 0 });

      const fresh = await refresh(srv, { client_id: a.client_id, refresh_token: ta.json.refresh_token });
      assert.equal(fresh.status, 200);
      assert.equal((await refresh(srv, { client_id: a.client_id, refresh_token: ta.json.refresh_token })).status, 400);
      assert.deepEqual(await seen(srv), { registrations: 2, authorizations: 2, tokens: 2, refreshes: 1, refused: 0 });

      assert.equal((await mcp(srv, undefined)).status, 401);
      assert.equal((await mcp(srv, "Bearer nope")).status, 401);
      assert.equal((await mcp(srv, `Bearer ${ta.json.access_token}`)).status, 401);
      assert.equal((await mcp(srv, `Bearer ${fresh.json.access_token}`)).status, 200);
      assert.equal((await call(srv, { path: "/nope" })).status, 404);
      assert.equal((await mcp(srv, "Bearer nope", "/mcp/")).status, 404);
      assert.deepEqual(await seen(srv), { registrations: 2, authorizations: 2, tokens: 2, refreshes: 1, refused: 3 });

      await call(srv, { method: "POST", path: "/forget" });
      assert.deepEqual(await seen(srv), { registrations: 2, authorizations: 2, tokens: 2, refreshes: 1, refused: 3 });
      assert.equal((await mcp(srv, `Bearer ${fresh.json.access_token}`)).status, 401);
      assert.equal((await seen(srv)).refused, 4);
      for (const v of Object.values(await seen(srv))) assert.ok(Number.isInteger(v) && v >= 0);
    });
  });
});

describe("Step 10: request 8, /mcp", () => {
  test("a request with exactly Bearer and a good access token is MCP's", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const t = await signInByHand(srv, client_id);
      assert.equal((await mcp(srv, `Bearer ${t.access_token}`)).status, 200);
      assert.equal((await mcp(srv, `Bearer ${t.access_token}`, "/mcp?x=1")).status, 200);
    });
  });

  test("else 401 with the WWW-Authenticate header, and the MCP server is not reached", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const t = await signInByHand(srv, client_id);
      const code = await newCode(srv, client_id);
      const expected = `Bearer resource_metadata="${srv.origin}/.well-known/oauth-protected-resource/mcp"`;
      const headers = [
        undefined,
        "",
        "Bearer",
        "Bearer ",
        "Bearer nope",
        t.access_token,
        `bearer ${t.access_token}`,
        `BEARER ${t.access_token}`,
        `Bearer  ${t.access_token}`,
        `Bearer ${t.access_token}x`,
        `Bearer ${t.access_token.slice(0, -1)}`,
        `Basic ${t.access_token}`,
        `Bearer ${t.refresh_token}`,
        `Bearer ${code.code}`,
        basic(client_id, t.access_token),
      ];
      for (const h of headers) {
        for (const method of ["POST", "GET"]) {
          const r = await mcp(srv, h, "/mcp", method);
          assert.equal(r.status, 401, `${method} ${JSON.stringify(h)}`);
          assert.equal(r.headers["www-authenticate"], expected, `${method} ${JSON.stringify(h)}`);
        }
      }
      // And the good token still works after all of that.
      assert.equal((await mcp(srv, `Bearer ${t.access_token}`)).status, 200);
    });
  });
});

describe("Step 10: request 9, any other path", () => {
  test("is 404, whatever the method", async () => {
    await withSignin([], async (srv) => {
      const paths = [
        "/",
        "/nope",
        "/mcp/",
        "/mcpx",
        "/MCP",
        "/register/",
        "/authorize/",
        "/token/",
        "/forget/",
        "/seen/",
        "/Seen",
        "/.well-known/oauth-protected-resource/",
        "/.well-known/oauth-protected-resource/other",
        "/.well-known/oauth-authorization-server/mcp",
        "/.well-known/openid-configuration",
        "/other?a=/mcp",
      ];
      for (const path of paths) {
        for (const method of ["GET", "POST"]) {
          const r = await call(srv, { method, path, body: method === "POST" ? "{}" : undefined, headers: JSON_HEADERS });
          assert.equal(r.status, 404, `${method} ${path}`);
        }
      }
    });
  });

  test("a /mcp/ with no sign-in is 404, not 401, and does not count as refused", async () => {
    await withSignin([], async (srv) => {
      assert.equal((await mcp(srv, undefined, "/mcp/")).status, 404);
      assert.equal((await seen(srv)).refused, 0);
    });
  });
});

describe("Step 10: a refused or malformed request leaves the server running", () => {
  test("whatever was sent, the next request is answered", async () => {
    await withSignin([], async (srv) => {
      const attempts = [
        { method: "POST", path: "/register", headers: JSON_HEADERS, body: "{not json" },
        { method: "POST", path: "/register", headers: { "Content-Type": "text/plain" }, body: "hello" },
        { method: "POST", path: "/token", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "%%%&&==" },
        { method: "POST", path: "/token", headers: JSON_HEADERS, body: "{not json" },
        { method: "POST", path: "/token", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic !!!" }, body: "grant_type=authorization_code" },
        { method: "GET", path: "/authorize?%" },
        { method: "GET", path: "/authorize?redirect_uri=%E0%A4%A" },
        { method: "POST", path: "/mcp", headers: { ...JSON_HEADERS, Authorization: "Bearer x" }, body: "{not json" },
        { method: "PUT", path: "/seen", body: "x" },
        { method: "DELETE", path: "/forget" },
      ];
      for (const attempt of attempts) {
        await call(srv, attempt, 1500).catch(() => {});
        const r = await call(srv, { path: "/seen" });
        assert.equal(r.status, 200, `after ${attempt.method} ${attempt.path}`);
      }
      const { client_id } = await register(srv);
      assert.equal((await mcp(srv, `Bearer ${(await signInByHand(srv, client_id)).access_token}`)).status, 200);
    });
  });
});
