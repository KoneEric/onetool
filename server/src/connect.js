// The connection to one listed server: start its process, speak MCP to it, read its list of tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

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
 * One listed server. `tools` is its list once connected; `error` the reason when it is not. `connect()` never
 * rejects: it settles `tools` or `error`.
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
  }

  /** Whether it is reached at an address: it then has no process of its own. */
  get remote() {
    return Object.hasOwn(this.entry, "url");
  }

  get connected() {
    return this.tools !== null && (this.remote || !this.transport.ended);
  }

  makeTransport() {
    if (this.remote) {
      const { url, headers } = this.entry;
      return new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
    }
    const { command, args, env } = this.entry;
    return new Transport({ command, args, env, stderr: "inherit" });
  }

  async connect() {
    const ms = this.connectSeconds * 1000;
    try {
      this.transport = this.makeTransport();
    } catch {
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
        this.error = `no answer in ${String(this.connectSeconds)} seconds`;
      } else {
        this.tools = got;
      }
    } catch (err) {
      if (this.remote) {
        this.error = isServerError(err) ? "refused the connection" : "could not connect";
      } else {
        const refused = err instanceof McpError && !this.transport.ended;
        this.error = refused ? "refused the connection" : "could not start";
      }
    } finally {
      clearTimeout(timer);
    }
    if (this.error !== null) this.close();
    return this;
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
