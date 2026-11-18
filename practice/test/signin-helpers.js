import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { startAddress, INIT_BODY, MCP_HEADERS } from "./address-helpers.js";

export const CB = "http://127.0.0.1:8765/callback";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `promise`, or gives up after `ms` (10 seconds at most for any wait of these tests). */
export function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gave up after ${ms} ms: ${what}`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** One request by hand: `{status, headers, text, json}`; headers are in lower case. With `head`, the body is not read. */
export function call(srv, { method = "GET", path = "/", headers = {}, body, head = false } = {}, ms = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: srv.port, method, path, headers, agent: false }, (res) => {
      const done = (text) => {
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      };
      if (head) {
        res.destroy();
        done("");
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new Error(`no answer to ${method} ${path}`)), ms);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(body === undefined ? undefined : Buffer.from(body));
  });
}

/** Starts the command with `--signin`, runs `fn(srv)` and ends the command. `srv.origin` is `O` of the meeting point. */
export async function withSignin(extra, fn) {
  const srv = await startAddress(["--port", "0", "--signin", ...extra]);
  srv.origin = `http://127.0.0.1:${srv.port}`;
  try {
    return await fn(srv);
  } finally {
    srv.stop();
  }
}

export const form = (obj) => new URLSearchParams(obj).toString();
export const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

/** A verifier and its challenge, the challenge being the base64url SHA-256 of the verifier. */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export const seen = async (srv) => (await call(srv, { path: "/seen" })).json;

export async function register(srv, redirect_uris = [CB], extra = {}) {
  const r = await call(srv, {
    method: "POST",
    path: "/register",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris, ...extra }),
  });
  assert.equal(r.status, 201, r.text);
  return r.json;
}

/** `GET /authorize`: `{status, location, code, state}`; the redirect is not followed. */
export async function authorize(srv, params) {
  const query = form(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)));
  const r = await call(srv, { path: `/authorize?${query}` });
  const location = r.headers.location;
  const url = location === undefined ? undefined : new URL(location);
  return { status: r.status, location, code: url?.searchParams.get("code") ?? undefined, state: url?.searchParams.get("state") ?? undefined, url };
}

/** `POST /token` with a form body; `auth` is an `Authorization` header value. */
export function token(srv, params, auth) {
  return call(srv, {
    method: "POST",
    path: "/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...(auth === undefined ? {} : { Authorization: auth }) },
    body: form(params),
  });
}

/** A code for `client_id` (through `/authorize`) and its verifier. */
export async function newCode(srv, client_id, redirect_uri = CB) {
  const { verifier, challenge } = pkce();
  const a = await authorize(srv, {
    response_type: "code",
    client_id,
    redirect_uri,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  assert.equal(a.status, 302);
  assert.ok(a.code, "a code in Location");
  return { code: a.code, verifier, redirect_uri };
}

/** The whole sign-in by hand: `{access_token, refresh_token, expires_in, response}`. */
export async function signInByHand(srv, client_id, { redirect_uri = CB, auth, secret } = {}) {
  const c = await newCode(srv, client_id, redirect_uri);
  const params = { grant_type: "authorization_code", code: c.code, redirect_uri, code_verifier: c.verifier };
  if (auth === undefined) params.client_id = client_id;
  if (secret !== undefined) params.client_secret = secret;
  const r = await token(srv, params, auth);
  assert.equal(r.status, 200, r.text);
  return { ...r.json, response: r };
}

/** An `initialize` request to `/mcp` with the header given: `{status, headers}`. */
export function mcp(srv, authorization, path = "/mcp", method = "POST") {
  const headers = { ...MCP_HEADERS, ...(authorization === undefined ? {} : { Authorization: authorization }) };
  return call(srv, { method, path, headers, body: method === "POST" ? INIT_BODY : undefined, head: true });
}

/** A provider the test keeps in memory for the package's client: a plain object. */
export function memoryProvider({ client, redirect = CB } = {}) {
  const provider = {
    redirects: [],
    saved: { client, tokens: undefined, verifier: undefined },
    get redirectUrl() {
      return redirect;
    },
    get clientMetadata() {
      return {
        client_name: "practice-test",
        redirect_uris: [redirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },
    state: () => "state-" + randomBytes(6).toString("hex"),
    clientInformation: () => provider.saved.client,
    saveClientInformation(info) {
      provider.saved.client = info;
    },
    tokens: () => provider.saved.tokens,
    saveTokens(t) {
      provider.saved.tokens = t;
    },
    redirectToAuthorization(url) {
      provider.redirects.push(url);
    },
    saveCodeVerifier(v) {
      provider.saved.verifier = v;
    },
    codeVerifier: () => provider.saved.verifier,
  };
  return provider;
}

/** A client of the package, not connected, on `provider`. */
export function newClient(srv, provider) {
  const client = new Client({ name: "practice-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(srv.url, { authProvider: provider });
  return { client, transport };
}

/** Connects with `provider`, runs `fn(client)` and closes. */
export async function connected(srv, provider, fn) {
  const { client, transport } = newClient(srv, provider);
  await within(client.connect(transport), 10000, "connect");
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * The first connection, refused by the package with the address to open; the test opens it without following
 * the redirect, reads the code in `Location` and hands it to `finishAuth`. Returns `{address, location, code}`.
 */
export async function signIn(srv, provider) {
  const { client, transport } = newClient(srv, provider);
  try {
    await within(
      assert.rejects(() => client.connect(transport), (e) => e instanceof UnauthorizedError),
      10000,
      "the first connection",
    );
    const address = provider.redirects.at(-1);
    assert.ok(address instanceof URL, "the package gave the address to open");
    const r = await call(srv, { path: address.pathname + address.search });
    assert.equal(r.status, 302);
    const location = new URL(r.headers.location);
    const code = location.searchParams.get("code");
    assert.ok(code, "a code in Location");
    await within(transport.finishAuth(code), 10000, "finishAuth");
    return { address, location, code };
  } finally {
    await client.close().catch(() => {});
  }
}
