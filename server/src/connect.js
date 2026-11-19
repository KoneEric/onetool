// The connection to one listed server: start its process, speak MCP to it, read its list of tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { quietProvider, signInStamp } from "../../auth/src/index.js";
import { keptTools, signsIn } from "../../core/src/index.js";

/** The transport of the package, which also knows when the process of the server has ended. */
class Transport extends StdioClientTransport {
  ended = false;

  async start() {
    await super.start();
    this._process?.once("close", () => {
      this.ended = true;
    });
  }
}

/**
 * Whether `err` is a JSON-RPC error that the server itself answered, and not one the package makes when its own
 * request is given up or its connection is gone.
 */
export function isServerError(err) {
  if (!(err instanceof McpError)) return false;
  if (err.code === ErrorCode.RequestTimeout) return false;
  return !(err.code === ErrorCode.ConnectionClosed && err.message === `MCP error ${err.code}: Connection closed`);
}

/**
 * Whether `err` is the server asking for a sign-in that is not there or not good: the package's `UnauthorizedError`, or
 * the error of its transport for an HTTP status 401. Written against the package at 1.32.2.
 */
export function isSignInFailure(err) {
  return err instanceof UnauthorizedError || err?.code === 401;
}

/** The stamp of the sign-in of a sign-in server in the home folder: `null` when there is none usable. */
function stampOf(entry) {
  try {
    return signInStamp(entry.name, entry.url);
  } catch {
    return null;
  }
}

/**
 * One listed server. `tools` is its list once connected; `error` the reason when it is not; `needed` that it is a
 * sign-in server that needs a sign-in (neither `tools` nor `error` then). `connect()` never rejects: it settles one of
 * the three, and may be called again for a server that is sign in needed.
 */
export class Connection {
  constructor(name, entry, connectSeconds, version) {
    this.name = name;
    this.entry = entry;
    this.connectSeconds = connectSeconds;
    this.version = version;
    this.tools = null;
    this.error = null;
    this.client = null;
    this.transport = null;
    this.closing = null;
    this.needed = false;
    this.signIn = !Object.hasOwn(entry, "url") ? false : signsIn(entry);
    // the stamp of the sign-in the last connection used, and whether it was given a provider
    this.stampTried = null;
    this.withSignIn = false;
  }

  /** Whether it is reached at an address: it then has no process of its own. */
  get remote() {
    return Object.hasOwn(this.entry, "url");
  }

  get connected() {
    return this.tools !== null && (this.remote || !this.transport.ended);
  }

  /** The stamp of the sign-in file now; `null` for a server that is not a sign-in server or has none. */
  stamp() {
    return this.signIn ? stampOf(this.entry) : null;
  }

  makeTransport() {
    if (this.remote) {
      const { url, headers } = this.entry;
      const options = { requestInit: { headers } };
      if (this.signIn) {
        const stamp = stampOf(this.entry);
        this.stampTried = stamp;
        this.withSignIn = stamp !== null;
        if (stamp !== null) options.authProvider = quietProvider(this.entry.name, url, { oauth: this.entry.oauth });
      }
      return new StreamableHTTPClientTransport(new URL(url), options);
    }
    const { command, args, env } = this.entry;
    return new Transport({ command, args, env, stderr: "inherit" });
  }

  async connect() {
    const ms = this.connectSeconds * 1000;
    this.closing = null;
    let tools = null;
    let error = null;
    let needed = false;
    try {
      this.transport = this.makeTransport();
    } catch {
      this.tools = null;
      this.needed = false;
      this.error = "could not connect";
      return this;
    }
    this.client = new Client({ name: "onetool", version: this.version });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), ms);
    });
    // the package's own request limit is kept above ours, so that ours speaks first
    const options = { timeout: ms + 5000 };
    const work = (async () => {
      await this.client.connect(this.transport, options);
      const tools = [];
      let cursor;
      do {
        const page = await this.client.listTools(cursor === undefined ? undefined : { cursor }, options);
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
      return tools;
    })();
    work.catch(() => {});
    try {
      const got = await Promise.race([work, timeout]);
      if (got === "timeout") {
        error = `no answer in ${String(this.connectSeconds)} seconds`;
      } else {
        // an entry with `tools` offers only those tools
        tools = Object.hasOwn(this.entry, "tools") ? keptTools(got, this.entry.tools) : got;
      }
    } catch (err) {
      if (this.signIn && isSignInFailure(err)) {
        needed = true;
      } else if (this.remote) {
        error = isServerError(err) ? "refused the connection" : "could not connect";
      } else {
        const refused = err instanceof McpError && !this.transport.ended;
        error = refused ? "refused the connection" : "could not start";
      }
    } finally {
      clearTimeout(timer);
    }
    this.tools = tools;
    this.error = error;
    this.needed = needed;
    if (error !== null || needed) this.close();
    return this;
  }

  /**
   * The connection of a sign-in server is closed and its tools are forgotten: it is sign in needed, and `stamp` is the
   * stamp of the file that did not work.
   */
  goNeeded(stamp) {
    this.tools = null;
    this.error = null;
    this.needed = true;
    this.stampTried = stamp;
    return this.close();
  }

  /** Ends the connection and its process. Gives a promise that is settled once they are gone. */
  close() {
    if (!this.transport) return Promise.resolve();
    this.closing ??= this.transport.close().catch(() => {});
    return this.closing;
  }

  /** Ends the process at once, whatever it does. */
  kill() {
    const pid = this.transport?.pid;
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
}
