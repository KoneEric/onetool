import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { login } from "../src/index.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
export const INDEX = path.join(ROOT, "auth", "src", "index.js");
const PRACTICE = path.join(ROOT, "practice", "src", "server.js");

const children = new Set();
const homes = new Set();
process.on("exit", () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  for (const h of homes) {
    try {
      fs.rmSync(h, { recursive: true, force: true });
    } catch {}
  }
});

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `promise`, or gives up after `ms` (10 seconds at most for any wait of these tests). */
export function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gave up after ${ms} ms: ${what}`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** A new empty folder under the system's temporary folder, used as `home`; removed when the process ends. */
export function tmpHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
  homes.add(h);
  return h;
}

export const mode = (p) => fs.statSync(p).mode & 0o777;
export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/** A port the system gave and that is free again now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** True when something accepts a connection on 127.0.0.1:`port`. */
export function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

/** The practice server of the part `practice`, as a process: `{origin, url, seen(), forget(), stop()}`. */
export async function startPractice(extra = []) {
  const child = spawn(process.execPath, [PRACTICE, "--port", "0", "--signin", ...extra], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => (err += c));
  const line = new Promise((resolve, reject) => {
    child.stdout.on("data", (c) => {
      out += c;
      const m = /^practice: listening on (http:\/\/127\.0\.0\.1:\d+)\/mcp\n/.exec(out);
      if (m) resolve(m[1]);
    });
    child.on("close", (code) => {
      children.delete(child);
      reject(new Error(`the practice server ended (code ${code}) before its line; stderr: ${err}`));
    });
  });
  line.catch(() => {});
  let origin;
  try {
    origin = await within(line, 8000, "the line of the practice server");
  } catch (e) {
    child.kill("SIGKILL");
    throw e;
  }
  return {
    origin,
    url: `${origin}/mcp`,
    seen: async () => (await fetch(`${origin}/seen`)).json(),
    forget: async () => {
      const r = await fetch(`${origin}/forget`, { method: "POST" });
      await r.arrayBuffer();
      assert.equal(r.status, 204);
    },
    stop: () => child.kill("SIGKILL"),
  };
}

/** What a browser does with the address: it asks for it and follows the redirect to the callback address. */
export function browser(address) {
  fetch(address).then(
    (r) => r.arrayBuffer(),
    () => {},
  );
}

/** One request to the listening port of `login`. `query` entries with an `undefined` value are left out. */
export async function hit(callback, { method = "GET", pathname, query = {} } = {}) {
  const u = new URL(callback);
  if (pathname !== undefined) u.pathname = pathname;
  for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, v);
  const r = await fetch(u, { method, redirect: "manual", signal: AbortSignal.timeout(8000) });
  return { status: r.status, text: await r.text() };
}

/**
 * `login` with an `open`/`say` the test keeps: `{promise, calls, address(), callback(), come(query), result()}`.
 * `address()` waits for the address given to `say`, as a URL.
 */
export function beginLogin(args, opts = {}) {
  const calls = { say: [], open: [], log: [] };
  let first;
  const got = new Promise((resolve) => (first = resolve));
  const say = (a) => {
    calls.say.push(a);
    calls.log.push("say");
    first(a);
  };
  const open = (a) => {
    calls.open.push(a);
    calls.log.push("open");
  };
  const o = { waitSeconds: 10, say, open, ...opts };
  if (opts.say === null) delete o.say;
  if (opts.open === null) delete o.open;
  const promise = login(args, o);
  const settled = promise.then(
    (r) => ({ r }),
    (e) => ({ e }),
  );
  const api = {
    promise,
    calls,
    address: async () =>
      new URL(
        await within(
          Promise.race([
            got,
            settled.then((x) => {
              throw new Error(`login ended before an address was said: ${JSON.stringify(x.r ?? String(x.e))}`);
            }),
          ]),
          10000,
          "the address to open",
        ),
      ),
    callback: async () => (await api.address()).searchParams.get("redirect_uri"),
    /** The browser comes back with `query`; `state` is the true one unless `query` has the key. */
    come: async (query = {}, extra = {}) => {
      const a = await api.address();
      const q = { state: a.searchParams.get("state"), ...query };
      return hit(a.searchParams.get("redirect_uri"), { query: q, ...extra });
    },
    result: () => within(promise, 12000, "the end of login"),
  };
  return api;
}

/** A complete sign-in by a browser that follows the redirect; the result of `login` must be `{ ok: true }`. */
export async function signIn({ name = "far", url, home, oauth, waitSeconds = 10 }) {
  const r = await within(login({ name, url, oauth }, { home, waitSeconds, say: browser }), 12000, "login");
  assert.deepEqual(r, { ok: true });
}

/** The `Location` the address to open leads to, the redirect not followed. */
export async function locationOf(address) {
  const r = await fetch(address, { redirect: "manual", signal: AbortSignal.timeout(8000) });
  await r.arrayBuffer();
  return new URL(r.headers.get("location"));
}

/** A client of the package, connected through `provider`. */
export async function connect(url, provider) {
  const client = new Client({ name: "auth-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
  await within(client.connect(transport), 8000, "connect");
  return client;
}

export const textOf = (r) => r.content[0].text;
export const is401 = (e) => e instanceof UnauthorizedError || e?.code === 401;

/** One request of the package's transport (a ping) through `provider`, without the MCP client on top. */
export async function ping(url, provider) {
  const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider: provider });
  transport.onerror = () => {};
  await transport.start();
  try {
    await within(transport.send({ jsonrpc: "2.0", id: 1, method: "ping" }), 8000, "a request of the transport");
  } finally {
    await transport.close().catch(() => {});
  }
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });

/**
 * A small MCP-and-sign-in server of the test, on one port, to see what the part sends.
 * Options: `hangAll` (never answers), `blank` (404 to everything), `noRegister` (no registration endpoint),
 * `noRefresh` (no refresh token given), `deny401` (the tokens it gives are never good at `/mcp`).
 * It records `registers`, `tokens` (each `{params, headers}`), `mcp` (the `Authorization` of each request
 * to `/mcp`) and `issued`; `expireAll()` makes every token given so far no good at `/mcp`;
 * `refreshMode` is `"ok"` or `"invalid_grant"`; `hold()` stops the exchange of a code until `release()`.
 */
export async function fakeServer(opts = {}) {
  const state = { registers: [], tokens: [], mcp: [], issued: [], good: new Set(), refreshMode: "ok", held: null };
  const sockets = new Set();
  let count = 0;
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const u = new URL(req.url, origin);
    const body = await readBody(req);
    if (opts.hangAll) return;
    const json = (status, obj, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(obj));
    };
    if (opts.blank) return json(404, {});
    const p = u.pathname;
    if (req.method === "GET" && (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp")) {
      return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    }
    if (req.method === "GET" && p === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        ...(opts.noRegister ? {} : { registration_endpoint: `${origin}/register` }),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      });
    }
    if (req.method === "POST" && p === "/register") {
      const doc = JSON.parse(body);
      state.registers.push(doc);
      return json(201, { ...doc, client_id: `fake-client-${state.registers.length}` });
    }
    if (req.method === "POST" && p === "/token") {
      const params = Object.fromEntries(new URLSearchParams(body));
      state.tokens.push({ params, headers: req.headers });
      if (params.grant_type === "refresh_token" && state.refreshMode === "invalid_grant") return json(400, { error: "invalid_grant" });
      if (params.grant_type === "authorization_code" && state.held) {
        state.held.reached();
        await state.held.released;
      }
      if (params.grant_type === "authorization_code" && params.code === "bad-code") return json(400, { error: "invalid_grant" });
      const k = ++count;
      const t = { access_token: `fake-at-${k}`, token_type: "Bearer", expires_in: 3600 };
      if (!opts.noRefresh) t.refresh_token = `fake-rt-${k}`;
      state.issued.push(t);
      if (!opts.deny401) state.good.add(t.access_token);
      return json(200, t);
    }
    if (p === "/mcp") {
      const auth = req.headers.authorization;
      state.mcp.push(auth);
      const bearer = /^Bearer (.+)$/.exec(auth ?? "")?.[1];
      if (bearer !== undefined && state.good.has(bearer)) {
        let id = 1;
        try {
          id = JSON.parse(body).id ?? 1;
        } catch {}
        return json(200, { jsonrpc: "2.0", id, result: {} });
      }
      return json(401, { error: "unauthorized" }, { "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
    }
    return json(404, {});
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  children.add({
    exitCode: null,
    signalCode: null,
    kill() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  });
  return Object.assign(state, {
    origin,
    url: `${origin}/mcp`,
    expireAll: () => state.good.clear(),
    hold() {
      let reached;
      let release;
      const h = {
        reachedP: new Promise((r) => (reached = r)),
        released: new Promise((r) => (release = r)),
        reached: () => reached(),
        release: () => release(),
      };
      state.held = h;
      return h;
    },
    stop() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  });
}

/** Signs in to the fake server through `login`, the browser being the test. Returns what the exchange gave. */
export async function signInFake(fake, { name = "far", home, oauth } = {}) {
  const l = beginLogin({ name, url: fake.url, oauth }, { home });
  const r = await l.come({ code: "any-code" });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(await l.result(), { ok: true });
  return fake.issued.at(-1);
}

/** Every string anywhere in a parsed JSON value. */
export function strings(v, acc = []) {
  if (typeof v === "string") acc.push(v);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, acc);
  return acc;
}

/** The same value with every property whose value is a string matching `re` removed (or set to `to`). */
export function without(v, re, to) {
  if (Array.isArray(v)) return v.map((x) => without(x, re, to));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && re.test(x)) {
        if (to !== undefined) out[k] = to;
      } else out[k] = without(x, re, to);
    }
    return out;
  }
  return v;
}
