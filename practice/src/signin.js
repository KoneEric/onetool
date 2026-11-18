import { createHash, randomBytes } from "node:crypto";

const MAX_BODY = 1024 * 1024;

/** 32 characters of `A-Z`, `a-z`, `0-9`, `_`, `-` after `prefix`. */
const drawn = (prefix) => prefix + randomBytes(24).toString("base64url");

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { ...(body === undefined ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > MAX_BODY ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
    req.on("aborted", () => resolve(undefined));
  });
}

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** `{id, secret}` of an `Authorization: Basic` header, or `undefined`. */
function basicCredentials(header) {
  if (header === undefined || !/^basic /i.test(header)) return undefined;
  const pair = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const colon = pair.indexOf(":");
  if (colon < 0) return undefined;
  return { id: decoded(pair.slice(0, colon)), secret: decoded(pair.slice(colon + 1)) };
}

const isLocalHttp = (text) => {
  try {
    const url = new URL(text);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
};

/**
 * The sign-in server: `{handle(req, res, next)}` for `--signin`, `--expires`, `--client` and `--secret`.
 * Everything is kept in memory.
 */
export function createSignin({ expires, client, secret }) {
  const clients = new Map();
  const codes = new Map();
  const accessTokens = new Map();
  const refreshTokens = new Map();
  const counts = { registrations: 0, authorizations: 0, tokens: 0, refreshes: 0, refused: 0 };

  const known = (id) => (client !== undefined ? id === client : clients.has(id));

  function issue(client_id) {
    const access_token = drawn("practice-at-");
    const refresh_token = drawn("practice-rt-");
    accessTokens.set(access_token, { client_id, expiresAt: Date.now() + expires * 1000, refresh_token });
    refreshTokens.set(refresh_token, { client_id, access_token });
    return { access_token, token_type: "Bearer", expires_in: expires, refresh_token };
  }

  /** True when the `Authorization` header is `Bearer` and an access token that is good. */
  function mcpAllowed(header) {
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
    const entry = accessTokens.get(header.slice(7));
    if (entry === undefined) return false;
    if (Date.now() >= entry.expiresAt) {
      accessTokens.delete(header.slice(7));
      return false;
    }
    return true;
  }

  function documents(origin, path) {
    if (path === "/.well-known/oauth-protected-resource/mcp" || path === "/.well-known/oauth-protected-resource") {
      return { resource: `${origin}/mcp`, authorization_servers: [origin] };
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        ...(client === undefined ? { registration_endpoint: `${origin}/register` } : {}),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: secret === undefined ? ["none"] : ["client_secret_basic", "client_secret_post"],
      };
    }
    return undefined;
  }

  async function register(req, res) {
    const text = await readBody(req);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    const uris = body?.redirect_uris;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !Array.isArray(uris) ||
      uris.length === 0 ||
      !uris.every((u) => typeof u === "string")
    ) {
      send(res, 400, { error: "invalid_client_metadata" });
      return;
    }
    const client_id = `practice-client-${clients.size + 1}`;
    clients.set(client_id, { redirect_uris: uris });
    counts.registrations++;
    const { client_secret: _dropped, ...held } = body;
    send(res, 201, { ...held, client_id });
  }

  function authorize(query, res) {
    const get = (key) => query.get(key) ?? "";
    const client_id = get("client_id");
    const redirect_uri = get("redirect_uri");
    const code_challenge = get("code_challenge");
    let target;
    try {
      target = new URL(redirect_uri);
    } catch {
      target = undefined;
    }
    const addressOk =
      target !== undefined &&
      (client !== undefined ? isLocalHttp(redirect_uri) : clients.get(client_id)?.redirect_uris.includes(redirect_uri));
    if (
      get("response_type") !== "code" ||
      !known(client_id) ||
      !addressOk ||
      code_challenge === "" ||
      get("code_challenge_method") !== "S256"
    ) {
      send(res, 400, { error: "invalid_request" });
      return;
    }
    const code = drawn("practice-code-");
    codes.set(code, { client_id, redirect_uri, code_challenge });
    target.searchParams.append("code", code);
    if (query.has("state")) target.searchParams.append("state", query.get("state"));
    counts.authorizations++;
    res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store" });
    res.end();
  }

  async function tokenEndpoint(req, res) {
    const text = await readBody(req);
    const isForm = /^application\/x-www-form-urlencoded\s*(;|$)/i.test(req.headers["content-type"] ?? "");
    const body = new URLSearchParams(isForm && text !== undefined ? text : "");
    const basic = basicCredentials(req.headers.authorization);
    const client_id = basic?.id ?? body.get("client_id") ?? "";
    if (secret !== undefined) {
      const given = basic !== undefined ? basic.secret : body.get("client_secret");
      if (given !== secret) {
        send(res, 401, { error: "invalid_client" });
        return;
      }
    }
    const grant = body.get("grant_type");
    if (grant === "authorization_code") {
      const code = body.get("code") ?? "";
      const entry = codes.get(code);
      const verifier = body.get("code_verifier");
      const good =
        entry !== undefined &&
        entry.client_id === client_id &&
        entry.redirect_uri === body.get("redirect_uri") &&
        verifier !== null &&
        createHash("sha256").update(verifier).digest("base64url") === entry.code_challenge;
      if (entry !== undefined) codes.delete(code);
      if (!good) {
        send(res, 400, { error: "invalid_grant" });
        return;
      }
      counts.tokens++;
      send(res, 200, issue(client_id));
    } else if (grant === "refresh_token") {
      const old = body.get("refresh_token") ?? "";
      const entry = refreshTokens.get(old);
      if (entry === undefined || entry.client_id !== client_id) {
        send(res, 400, { error: "invalid_grant" });
        return;
      }
      refreshTokens.delete(old);
      accessTokens.delete(entry.access_token);
      counts.refreshes++;
      send(res, 200, issue(client_id));
    } else {
      send(res, 400, { error: "unsupported_grant_type" });
    }
  }

  /** Answers the requests of points 1 to 7 and 9; `next()` is called for `/mcp`, after the sign-in check of point 8. */
  async function handle(req, res, next) {
    const [path, ...rest] = (req.url ?? "").split("?");
    const query = new URLSearchParams(rest.join("?"));
    const origin = `http://127.0.0.1:${req.socket.localPort}`;
    const { method } = req;
    const document = method === "GET" ? documents(origin, path) : undefined;
    if (document !== undefined) return send(res, 200, document);
    if (path === "/register" && method === "POST" && client === undefined) return register(req, res);
    if (path === "/authorize" && method === "GET") return authorize(query, res);
    if (path === "/token" && method === "POST") return tokenEndpoint(req, res);
    if (path === "/forget" && method === "POST") {
      codes.clear();
      accessTokens.clear();
      refreshTokens.clear();
      return send(res, 204);
    }
    if (path === "/seen" && method === "GET") return send(res, 200, counts);
    if (path === "/mcp") {
      if (mcpAllowed(req.headers.authorization)) return next();
      counts.refused++;
      return send(res, 401, undefined, {
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
    }
    return send(res, 404);
  }

  return { handle };
}
