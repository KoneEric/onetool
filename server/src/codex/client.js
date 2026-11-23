// Codex app-server uses newline-delimited requests and responses on stdio.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class CodexClient {
  pending = new Map();
  nextId = 0;

  constructor(binary, cwd) {
    this.child = spawn(binary, ["app-server", "--stdio"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
    const fail = (error) => this.close(error);
    this.child.once("error", fail);
    this.child.stdin.on("error", fail);
    this.child.once("exit", (code, signal) => fail(new Error(`Codex exited (${signal ?? code}).`)));
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.method && Object.hasOwn(message, "id")) {
          // No interactive approval UI here. Never accept a request on the user's behalf.
          this.send({ id: message.id, error: { code: -32601, message: "Interactive requests are unavailable in this adapter." } });
        } else if (!message.method) {
          this.pending.get(message.id)?.(message);
        }
      } catch (error) {
        fail(error);
      }
    });
    this.ready = this.request("initialize", {
      clientInfo: { name: "onetool_codex_adapter", version: "1" },
      capabilities: { experimentalApi: true },
    }).then(() => this.send({ method: "initialized" }));
  }

  send(message) {
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  request(method, params) {
    if (this.closed) return Promise.reject(this.closed);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error(`Codex timed out on ${method}.`)), 55_000);
      this.pending.set(id, ({ result, error }) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(new Error(`${method}: ${error.message}`));
        else resolve(result);
      });
      this.send({ id, method, params });
    });
  }

  close(reason = new Error("Codex adapter closed.")) {
    if (this.closed) return;
    this.closed = reason;
    for (const settle of this.pending.values()) settle({ error: reason });
    this.child.stdin.destroy();
    this.child.kill();
  }
}
