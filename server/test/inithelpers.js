// Helpers of the tests of "Step 11: `onetool init`, the tools a server keeps, and `oauth.redirectHost`" (the meeting point of
// server): the stand-in command `claude` (a /bin/sh script in a folder the test made, which leaves a mark when it is started),
// `runInit` called in the test with its answers collected, `onetool init` as a process whose whole `PATH` and `HOME` are
// folders the test made, and the host program in front of the server command. No test lets `init` find a real `claude`.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runInit } from "../src/init.js";
import { BIN, ROOT, textOf, tmpDir } from "./helpers.js";

export const INIT_USAGE = "usage: onetool init [--config <settings file>] [--yes] [--no-claude]";
export const SERVER_USAGE = "usage: onetool --config <settings file>";
export const SIX = ["Bash", "Read", "Edit", "Write", "Grep", "Glob"];
export const PROPOSAL = [
  "onetool: init: Claude Code can be a server behind onetool: the assistant's programs can then run commands and read, search and edit files through Claude Code's own tools.",
  "onetool: init: Claude Code as a server asks no permission question: the rules of onetool are the control.",
];
export const ENTRY_HEAD = "onetool: init: add this entry to the MCP settings of your host program:";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude-eight.mjs");
const PACKAGE_NAME = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;

// ---- the texts of `init` ---------------------------------------------------------------------------------------------

export const defaultPath = (home) => join(home, ".config", "onetool", "settings.json");
export const madeLine = (P) => `onetool: init: made ${P}`;
export const foundLine = (P) => `onetool: init: found ${P}`;
export const addedEmptyLine = (P) => `onetool: init: added an empty mcpServers to ${P}`;
export const addedLine = (P) => `onetool: init: added the server claude to ${P} (claude mcp serve), with the tools Bash, Read, Edit, Write, Grep, Glob`;
export const allowLine = (P) => `onetool: init: onetool.allow of ${P} is not empty: add "claude.*" to it to open these tools`;
export const alreadyLine = (P, name = "claude") => `onetool: init: ${P} already has Claude Code as the server ${name}, nothing is proposed`;
export const anotherLine = (P) => `onetool: init: ${P} has another server named claude, nothing is proposed`;
export const NOT_FOUND_LINE = "onetool: init: the command claude was not found on this machine, Claude Code is not proposed";
export const nobodyLine = (P) => `onetool: init: nobody to ask, nothing is added. To add it, run: onetool init --config ${P} --yes`;
export const NOT_ADDED_LINE = "onetool: init: Claude Code is not added";
export const questionOf = (P) => `Add the server claude to ${P}? [Y/n] `;
export const faultLine = (P, reason) => `onetool: init: ${P}: ${reason}`;

/** `JSON.stringify(<entry>, null, 2)` of "`onetool init`: the entry, and the end". */
export const entryValue = (P) => ({ mcpServers: { onetool: { command: "npx", args: ["-y", PACKAGE_NAME, "--config", P] } } });
export const entryText = (P) => JSON.stringify(entryValue(P), null, 2);

/** The value `init` writes for the server `claude`, `place` being the full path where `claude` was found. */
export const claudeEntry = (place) => ({ command: place, args: ["mcp", "serve"], tools: SIX });

/** The text of a file written by `init`: two-space JSON and one line break. */
export const textOfValue = (value) => `${JSON.stringify(value, null, 2)}\n`;

// ---- files -----------------------------------------------------------------------------------------------------------

/** Writes `text` (or a value turned to JSON) at `file`, making the folders above it. */
export function put(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof text === "string" ? text : JSON.stringify(text), "utf8");
  return file;
}

/** A settings path in a folder of its own, holding `content` (text or value) when one is given. */
export function settingsAt(content) {
  const file = join(tmpDir(), "settings.json");
  if (content !== undefined) put(file, content);
  return file;
}

// ---- the stand-in claude ---------------------------------------------------------------------------------------------

/**
 * A folder `dir` that holds a `claude`: a /bin/sh script, mode 0o755, that leaves a mark when it is started and then starts
 * the fixture server with `process.execPath`, given in full. `started()` says whether it was ever started.
 */
export function standIn() {
  const dir = tmpDir();
  const mark = join(tmpDir(), "started");
  const place = join(dir, "claude");
  writeFileSync(place, `#!/bin/sh\necho started >> '${mark}'\nexec '${process.execPath}' '${FIXTURE}' "$@"\n`, "utf8");
  chmodSync(place, 0o755);
  return { dir, place, mark, started: () => existsSync(mark) };
}

// ---- runInit, called in the test ---------------------------------------------------------------------------------------

/**
 * `runInit(argv, ...)` with its answers collected: `{ code, out, err, asked, events, said }`. `out` and `err` are the texts
 * given to the two functions; `events` holds them in order with the questions (`["out" | "err" | "ask", text]`); `said` is
 * everything given to `out`, as lines. `ask` is the test's answer (a function of the question; `null` when absent).
 */
export async function runIn(argv, { home, pathText = "", terminal = false, ask } = {}) {
  if (home === undefined) throw new Error("a test of step 11 passes the home it made");
  const out = [];
  const err = [];
  const asked = [];
  const events = [];
  const code = await runInit(argv, {
    home,
    pathText,
    terminal,
    ask: async (question) => {
      asked.push(question);
      events.push(["ask", question]);
      return ask === undefined ? null : await ask(question);
    },
    out: (text) => {
      out.push(text);
      events.push(["out", text]);
    },
    err: (text) => {
      err.push(text);
      events.push(["err", text]);
    },
  });
  return { code, out, err, asked, events, said: out.join("\n").split("\n") };
}

/** What `out` must have been given in full: `lines`, then the line and the text of the entry. */
export const wholeOut = (lines, P) => [...lines, ENTRY_HEAD, entryText(P)].join("\n");

// ---- onetool init, as a process --------------------------------------------------------------------------------------

/**
 * `node bin/onetool.js init ...args` with `HOME` `home` and the whole `PATH` `path` (both folders of the test), its standard
 * input a pipe that is never written nor closed (it is no terminal): `{ code, signal, stdout, stderr }`. Gives up after `ms`.
 */
export function initProcess(args, { home, path, cwd = tmpDir(), ms = 10000 } = {}) {
  if (home === undefined || path === undefined) throw new Error("a test of step 11 passes the home and the PATH it made");
  const child = spawn(process.execPath, [BIN, "init", ...args], { cwd, env: { HOME: home, PATH: path }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`init was still there after ${ms} ms; stdout: ${stdout}; stderr: ${stderr}`));
    }, ms);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, cwd });
    });
  });
}

/** The lines of a standard output of `init` before the object, and the object (`undefined` when there is none). */
export function splitOutput(stdout) {
  const lines = stdout.split("\n");
  const brace = lines.indexOf("{");
  if (brace === -1) return { said: lines.filter((line) => line !== ""), entry: undefined };
  return { said: lines.slice(0, brace), entry: JSON.parse(lines.slice(brace).join("\n")) };
}

// ---- a host program in front of the server command -----------------------------------------------------------------------

/**
 * The client of the package, named `name`, giving the one root `root`, in front of the real command on `settingsFile`, with
 * `HOME` `home` and `PATH` `path`. `search(words?)` is the text, `run(code)` is `{ text, lines, isError }`.
 */
export async function withHost(settingsFile, { home, path, root, name = "step11-host" }, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", settingsFile],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), HOME: home, PATH: path },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += String(chunk)));
  const client = new Client({ name, version: "1.0.0" }, { capabilities: root === undefined ? {} : { roots: { listChanged: true } } });
  if (root !== undefined) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(root).href }] }));
  }
  await client.connect(transport, { timeout: 10000 });
  const call = (toolName, args) => client.callTool({ name: toolName, arguments: args }, undefined, { timeout: 20000 });
  const host = {
    client,
    stderr: () => stderr,
    stderrLines: () => stderr.split("\n").filter((line) => line !== ""),
    tools: async () => (await client.listTools()).tools.map((tool) => tool.name),
    search: async (words) => textOf(await call("search", words === undefined ? {} : { words })),
    run: async (code) => {
      const result = await call("run", { code });
      const text = textOf(result);
      return { text, lines: text.split("\n"), isError: result.isError === true };
    },
  };
  try {
    return await fn(host);
  } finally {
    await client.close().catch(() => {});
  }
}
