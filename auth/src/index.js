// The sign-in by OAuth to a listed server reached at an address. See the meeting point of auth.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

const isText = (v) => typeof v === "string" && v.length > 0;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function checkName(name) {
  if (!isText(name)) throw new TypeError("name must be a non-empty string");
}

function checkUrl(url) {
  if (!isText(url)) throw new TypeError("url must be a non-empty string");
}

function checkOauth(oauth) {
  if (oauth === undefined) return;
  if (!isObject(oauth) || typeof oauth.clientId !== "string") throw new TypeError("oauth must be an object with a string clientId");
  if ("redirectHost" in oauth && oauth.redirectHost !== "127.0.0.1" && oauth.redirectHost !== "localhost") throw new TypeError("oauth.redirectHost must be 127.0.0.1 or localhost");
}

export function authFolder({ home = os.homedir() } = {}) {
  return path.join(home, ".onetool", "auth");
}

export function authFile(name, { home = os.homedir() } = {}) {
  checkName(name);
  return path.join(authFolder({ home }), encodeURIComponent(name) + ".json");
}

/** The parsed file when it belongs to `(name, url)`, whatever else it holds; else `null`. Never throws. */
function readDoc(name, url, home) {
  try {
    const doc = JSON.parse(fs.readFileSync(authFile(name, { home }), "utf8"));
    if (isObject(doc) && doc.server === name && doc.url === url) return doc;
  } catch {}
  return null;
}

const usableTokens = (doc) => (doc && isObject(doc.tokens) && isText(doc.tokens.access_token) ? doc.tokens : undefined);

/** Writes the file whole: beside it, then renamed over it. Throws when it cannot. */
function writeDoc(name, doc, home) {
  const folder = authFolder({ home });
  const made = fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (made !== undefined) fs.chmodSync(folder, 0o700);
  const file = authFile(name, { home });
  const temp = path.join(folder, `.${crypto.randomBytes(8).toString("hex")}.tmp`);
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeSync(fd, JSON.stringify({ ...doc, stamp: crypto.randomUUID() }, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
  } catch (e) {
    try {
      fs.unlinkSync(temp);
    } catch {}
    throw e;
  }
}

export function signInStamp(name, url, { home = os.homedir() } = {}) {
  checkName(name);
  checkUrl(url);
  const doc = readDoc(name, url, home);
  if (!usableTokens(doc)) return null;
  if (isText(doc.stamp)) return doc.stamp;
  try {
    const st = fs.statSync(authFile(name, { home }));
    return `m-${st.mtimeMs}-${st.size}-${st.ino}`;
  } catch {
    return null;
  }
}

export function logout(name, { home = os.homedir() } = {}) {
  checkName(name);
  try {
    fs.unlinkSync(authFile(name, { home }));
    return true;
  } catch (e) {
    if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return false;
    throw new Error("the sign-in could not be removed");
  }
}

const clientOf = (oauth) => ({ client_id: oauth.clientId, ...(oauth.clientSecret !== undefined ? { client_secret: oauth.clientSecret } : {}) });
const scopeOf = (oauth) => (Array.isArray(oauth?.scopes) && oauth.scopes.length > 0 ? oauth.scopes.join(" ") : undefined);

export function quietProvider(name, url, { home = os.homedir(), oauth } = {}) {
  checkName(name);
  checkUrl(url);
  checkOauth(oauth);
  const redirect = "http://127.0.0.1/callback";
  return {
    get redirectUrl() {
      return redirect;
    },
    get clientMetadata() {
      return { client_name: "onetool", redirect_uris: [redirect], scope: scopeOf(oauth) };
    },
    clientInformation() {
      if (oauth) return clientOf(oauth);
      const doc = readDoc(name, url, home);
      return isObject(doc?.client) ? doc.client : undefined;
    },
    tokens() {
      return usableTokens(readDoc(name, url, home));
    },
    saveTokens(tokens) {
      const doc = readDoc(name, url, home) ?? { server: name, url };
      writeDoc(name, { ...doc, tokens }, home);
    },
    saveCodeVerifier() {},
    codeVerifier() {
      throw new Error("no code verifier");
    },
    redirectToAuthorization() {},
    invalidateCredentials(scope) {
      if (scope !== "all" && scope !== "tokens") return;
      // The tokens go, the client stays: the request that follows ends as a plain 401, not as a refused registration.
      const doc = readDoc(name, url, home);
      if (!doc || !("tokens" in doc)) return;
      const { tokens: _gone, ...rest } = doc;
      try {
        writeDoc(name, rest, home);
      } catch {}
    },
  };
}

export function browserCommand(address, platform = process.platform) {
  if (platform === "darwin") return ["open", address];
  if (platform === "linux") return ["xdg-open", address];
  return null;
}

const MAX_TIMER_MS = 2 ** 31 - 1;
const PLAIN = { "content-type": "text/plain; charset=utf-8", connection: "close" };

export async function login({ name, url, oauth } = {}, { home = os.homedir(), waitSeconds = 300, say, open } = {}) {
  checkName(name);
  checkUrl(url);
  checkOauth(oauth);
  if (typeof waitSeconds !== "number" || !Number.isFinite(waitSeconds) || waitSeconds <= 0) throw new TypeError("waitSeconds must be a finite number above 0");
  if (say !== undefined && typeof say !== "function") throw new TypeError("say must be a function");
  if (open !== undefined && typeof open !== "function") throw new TypeError("open must be a function");

  return new Promise((resolve) => {
    const state = crypto.randomBytes(16).toString("base64url");
    const abort = new AbortController();
    const server = http.createServer();
    let settled = false;
    let started = false;
    let exchanging = false;
    let written = false;
    let keepFailed = false;
    let timer;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abort.abort();
      server.close();
      server.closeIdleConnections?.();
      setImmediate(() => server.closeAllConnections?.());
      resolve(result);
    };
    const fail = (reason) => finish({ ok: false, reason });
    const fetchFn = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal });
    const answer = (res, status, text, then) => {
      res.writeHead(status, PLAIN);
      res.end(text, then);
    };

    let port = 0;
    const callback = () => `http://${oauth?.redirectHost ?? "127.0.0.1"}:${port}/callback`;
    let client;
    let verifier;
    let discovery;
    let tokens;
    const provider = {
      get redirectUrl() {
        return callback();
      },
      get clientMetadata() {
        return {
          client_name: "onetool",
          redirect_uris: [callback()],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: oauth?.clientSecret !== undefined ? "client_secret_post" : "none",
          scope: scopeOf(oauth),
        };
      },
      state: () => state,
      clientInformation: () => (oauth ? clientOf(oauth) : client),
      tokens: () => tokens,
      saveTokens(t) {
        if (settled) throw new Error("late");
        const doc = { server: name, url, tokens: t, ...(client && !oauth ? { client } : {}) };
        try {
          writeDoc(name, doc, home);
        } catch (e) {
          keepFailed = true;
          throw e;
        }
        written = true;
        tokens = t;
      },
      saveCodeVerifier(v) {
        verifier = v;
      },
      codeVerifier: () => verifier,
      discoveryState: () => discovery,
      saveDiscoveryState(d) {
        discovery = d;
      },
      invalidateCredentials() {},
      redirectToAuthorization(address) {
        started = true;
        if (settled) return;
        const text = String(address);
        for (const fn of [say, open]) {
          if (!fn) continue;
          try {
            const r = fn(text);
            if (r && typeof r.then === "function") r.then(undefined, () => {});
          } catch {}
        }
      },
    };
    // The client is the one `oauth` names, or one registered now: never the one of an earlier sign-in.
    if (!oauth) {
      provider.saveClientInformation = (info) => {
        client = info;
      };
    }
    const scope = scopeOf(oauth);

    const exchange = async (code, res) => {
      try {
        const r = await auth(provider, { serverUrl: url, authorizationCode: code, scope, fetchFn });
        if (settled) return;
        if (r !== "AUTHORIZED") throw new Error("not authorized");
        answer(res, 200, "signed in, you can close this page", () => finish({ ok: true }));
      } catch {
        if (settled) return;
        answer(res, 400, "not signed in", () => fail(keepFailed ? "the sign-in could not be kept" : "the sign-in could not be finished"));
      }
    };

    server.on("request", (req, res) => {
      if (settled) {
        answer(res, 404, "");
        return;
      }
      let u;
      try {
        u = new URL(req.url, "http://127.0.0.1");
      } catch {
        answer(res, 404, "");
        return;
      }
      if (u.pathname !== "/callback" || req.method !== "GET") return answer(res, 404, "");
      if (u.searchParams.get("state") !== state) return answer(res, 400, "not signed in");
      if (exchanging) return answer(res, 400, "not signed in");
      const code = u.searchParams.get("code");
      if (u.searchParams.has("error") || !code) {
        exchanging = true;
        return answer(res, 400, "not signed in", () => fail("the sign-in was refused"));
      }
      exchanging = true;
      exchange(code, res);
    });

    timer = setTimeout(() => finish(written ? { ok: true } : { ok: false, reason: `no answer in ${String(waitSeconds)} seconds` }), Math.min(waitSeconds * 1000, MAX_TIMER_MS));
    server.once("error", () => fail(`cannot listen on port ${oauth?.port ?? 0}`));
    server.listen({ port: oauth?.port ?? 0, host: "127.0.0.1" }, async () => {
      server.removeAllListeners("error");
      server.on("error", () => {});
      port = server.address().port;
      try {
        const r = await auth(provider, { serverUrl: url, scope, fetchFn });
        if (r !== "REDIRECT" || !started) fail("the sign-in could not be started");
      } catch {
        if (!started) fail("the sign-in could not be started");
      }
    });
  });
}
