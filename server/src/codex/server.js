import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { CodexClient } from "./client.js";

const string = { type: "string" };
const nonempty = { type: "string", minLength: 1 };
function tool(name, description, properties, required) {
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

const definitions = [
  tool("Bash", "Run a bash command from the project using Codex permissions. Returns stdout, stderr and exitCode.", { command: nonempty }, ["command"]),
  tool("Read", "Read a UTF-8 project file, up to 1 MiB. Returns content.", { file_path: nonempty }, ["file_path"]),
  tool("Write", "Create or replace a UTF-8 project file in an existing directory.", { file_path: nonempty, content: string }, ["file_path", "content"]),
  tool("Edit", "Replace literal text in a UTF-8 project file. The match must be unique unless replace_all is true.", { file_path: nonempty, old_string: nonempty, new_string: string, replace_all: { type: "boolean" } }, ["file_path", "old_string", "new_string"]),
  tool("Grep", "Search project file contents by regular expression with rg. Returns matching lines in stdout.", { pattern: nonempty, path: nonempty, glob: nonempty }, ["pattern"]),
  tool("Glob", "Find project files whose paths match an rg glob. Returns paths in stdout.", { pattern: nonempty, path: nonempty }, ["pattern"]),
  tool("GitHubLookup", "Read repository details through the GitHub connection in Codex.", { repository_full_name: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" } }, ["repository_full_name"]),
];
const validator = new AjvJsonSchemaValidator();
const validate = new Map(definitions.map((t) => [t.name, validator.getValidator(t.inputSchema)]));
const helper = fileURLToPath(new URL("./file.js", import.meta.url));

export async function serveCodex(rootPath, binary) {
  const root = realpathSync(rootPath);
  if (!statSync(root).isDirectory()) throw new Error("Codex project path must be a directory.");
  const server = new Server({ name: "onetool-codex", version: "1" }, { capabilities: { tools: {} } });
  let client;
  let thread;
  let writes = Promise.resolve();

  function searchPath(path) {
    const resolved = realpathSync(resolve(root, path ?? "."));
    const rel = relative(root, resolved);
    if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("Search path must be inside the project.");
    return rel ? "./" + rel : ".";
  }

  async function invoke(name, args) {
    // Lazy startup also allows Codex to discover onetool in its own MCP configuration.
    if (!client || client.closed) {
      client = new CodexClient(binary, root);
      thread = undefined;
    }
    const rpc = client;
    await rpc.ready;
    if (name === "GitHubLookup") {
      thread ??= rpc.request("thread/start", { ephemeral: true, cwd: root }).catch((error) => {
        if (client === rpc) thread = undefined;
        throw error;
      });
      const { thread: { id } } = await thread;
      return rpc.request("mcpServer/tool/call", {
        threadId: id, server: "codex_apps", tool: "github.get_repo", arguments: args,
      });
    }
    let command;
    if (name === "Bash") command = ["bash", "-c", args.command];
    else if (name === "Glob") command = ["rg", "--files", "--glob", args.pattern, "--", searchPath(args.path)];
    else if (name === "Grep") command = ["rg", "--no-heading", "--line-number", "--with-filename", ...(args.glob ? ["--glob", args.glob] : []), "-e", args.pattern, "--", searchPath(args.path)];
    else command = [process.execPath, helper, name, JSON.stringify(args)];
    const file = ["Read", "Edit", "Write"].includes(name);
    const run = async () => {
      const res = await rpc.request("command/exec", { command, cwd: root, permissionProfile: process.env.ONETOOL_CODEX_PERMISSIONS || ":workspace", timeoutMs: 30_000, outputBytesCap: file ? 7_000_000 : 128_000 });
      if (file && res.exitCode !== 0) throw new Error(res.stderr.trim() || `${name} failed (${res.exitCode}).`);
      if ((name === "Glob" || name === "Grep") && res.exitCode !== 0 && res.exitCode !== 1) throw new Error(res.stderr.trim() || `${name} failed.`);
      const value = file ? JSON.parse(res.stdout) : res;
      return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
    };
    if (name !== "Edit" && name !== "Write") return run();
    const result = writes.then(run);
    writes = result.catch(() => {});
    return result;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args } }) => {
    try {
      const check = validate.get(name);
      if (!check) throw new Error(`Unknown tool: ${name}`);
      const result = check(args);
      if (!result.valid) throw new Error(result.errorMessage);
      return await invoke(name, args);
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
  });
  const close = () => { client?.close(); void server.close(); };
  process.stdin.once("end", close);
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  server.onclose = () => client?.close();
  await server.connect(new StdioServerTransport());
}
