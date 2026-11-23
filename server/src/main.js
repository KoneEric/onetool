// The command: arguments, settings, the server on standard input and output, the end.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { INSTRUCTIONS, readSettings, SettingsError } from "../../core/src/index.js";
import { missingFolders } from "../../shell/src/index.js";
import { Connection } from "./connect.js";
import { makeHost } from "./host.js";
import { runInit } from "./init.js";
import { TIDY_DESCRIPTION, TIDY_NAME, TIDY_TEXT } from "./prompt.js";
import { LOGIN_USAGE, LOGOUT_USAGE, parseSignArgs, runLogin, runLogout } from "./sign.js";
import { makeTools } from "./tools.js";

const USAGE = "usage: onetool --config <settings file>";
const END_MS = 4500;

const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

const say = (line) => process.stderr.write(`${line}\n`);

/** The settings of the file at `path`, or `null` once its problems are written (the exit code is then 2). */
function settingsOf(path) {
  try {
    return readSettings(path);
  } catch (err) {
    if (!(err instanceof SettingsError)) throw err;
    for (const problem of err.problems) say(`onetool: ${problem}`);
    process.exitCode = 2;
    return null;
  }
}

/** `login` or `logout`: one thing is done, and the process ends. */
async function signCommand(word, rest) {
  const parsed = parseSignArgs(word, rest);
  if (parsed === null) {
    say(word === "login" ? LOGIN_USAGE : LOGOUT_USAGE);
    process.exitCode = 2;
    return;
  }
  const settings = settingsOf(parsed.config);
  if (settings === null) return;
  if (word === "login") await runLogin(parsed.server, settings, parsed);
  else runLogout(parsed.server);
}

export async function main(argv) {
  if (argv[0] === "codex-server") {
    if (argv.length !== 3 || argv[1] !== "--root") {
      say("usage: onetool codex-server --root <project folder>");
      process.exitCode = 2;
      return;
    }
    const { serveCodex } = await import("./codex/server.js");
    try { await serveCodex(argv[2], process.env.ONETOOL_CODEX_BIN || "codex"); }
    catch (error) { say(error.message); process.exitCode = 1; }
    return;
  }
  if (argv[0] === "init") {
    process.exitCode = await runInit(argv.slice(1));
    return;
  }
  if (argv[0] === "login" || argv[0] === "logout") return signCommand(argv[0], argv.slice(1));
  if (argv.length !== 2 || argv[0] !== "--config") {
    say(USAGE);
    process.exitCode = 2;
    return;
  }
  const settings = settingsOf(argv[1]);
  if (settings === null) return;

  if (settings.shell !== null && settings.shell.folders !== null) {
    const missing = await missingFolders(settings.shell.folders);
    for (const position of missing) say(`onetool: onetool.shell.folders: item ${position + 1} is not a folder`);
    if (missing.length > 0) {
      process.exitCode = 2;
      return;
    }
  }

  const connections = settings.servers.map(
    (entry) => new Connection(entry.name, entry, settings.connectSeconds, version),
  );
  // a list of tools that can change: the description of `run` follows the folders of the host program
  const listChanged = settings.shell !== null && settings.shell.folders === null;
  // ... and so does what a sign-in server offers, once the person has signed in or out
  const signIns = connections.some((connection) => connection.signIn);
  const server = new Server(
    { name: "onetool", version },
    {
      capabilities: { tools: listChanged || signIns ? { listChanged: true } : {}, prompts: {} },
      ...(settings.instructions ? { instructions: INSTRUCTIONS } : {}),
    },
  );
  const host = makeHost(settings, server);
  const tools = makeTools(settings, connections, server, host, resolve(argv[1]));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    host.start();
    if (listChanged) await host.idle();
    return { tools: await tools.list() };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    tools.call(request.params.name, request.params.arguments),
  );

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: TIDY_NAME, description: TIDY_DESCRIPTION }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== TIDY_NAME) throw new McpError(ErrorCode.InvalidParams, `unknown prompt: ${request.params.name}`);
    return { description: TIDY_DESCRIPTION, messages: [{ role: "user", content: { type: "text", text: TIDY_TEXT } }] };
  });

  let ending = false;
  const end = async () => {
    if (ending) return;
    ending = true;
    const hard = setTimeout(() => {
      for (const connection of connections) connection.kill();
      process.exit(0);
    }, END_MS);
    await Promise.allSettled([server.close(), ...connections.map((connection) => connection.close())]);
    clearTimeout(hard);
    process.exit(0);
  };
  process.on("SIGINT", end);
  process.on("SIGTERM", end);
  process.stdout.on("error", () => {});

  await server.connect(new StdioServerTransport());
  process.stdin.on("end", end);
  process.stdin.on("close", end);

  // the entries that cannot be used are told first, before any connection is tried
  for (const { name, reason } of settings.bad) say(`onetool: server ${name}: not connected (bad entry: ${reason})`);
  tools.ready = Promise.all(
    connections.map(async (connection) => {
      await connection.connect();
      if (connection.error !== null) say(`onetool: server ${connection.name}: not connected (${connection.error})`);
      else if (connection.needed) say(`onetool: server ${connection.name}: sign in needed`);
    }),
  );
}
