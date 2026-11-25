// The command `onetool init`: sets up the settings file and proposes Claude Code as a server behind onetool.
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const INIT_USAGE = "usage: onetool init [--config <settings file>] [--yes] [--no-claude] [--codex <project folder>]";

const ONETOOL_BIN = fileURLToPath(new URL("../../bin/onetool.js", import.meta.url));
const SIX = ["Bash", "Read", "Edit", "Write", "Grep", "Glob"];
const PACKAGE_NAME = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).name;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** The arguments after `init`: `{ config, yes, noClaude }` (`config` is `null` when not given), or `null` when they are wrong. */
export function parseInitArgs(argv) {
  const parsed = { config: null, yes: false, noClaude: false };
  for (let i = 0; i < argv.length; i += 1) {
    const option = argv[i];
    if (option === "--config" && parsed.config === null) {
      if (i + 1 >= argv.length || argv[i + 1] === "") return null;
      parsed.config = argv[(i += 1)];
    } else if (option === "--codex" && !parsed.codexRoot) {
      const folder = argv[++i];
      if (!folder || folder.startsWith("--")) return null;
      parsed.codexRoot = resolve(folder);
    } else if (option === "--yes" && !parsed.yes) {
      parsed.yes = true;
    } else if (option === "--no-claude" && !parsed.noClaude) {
      parsed.noClaude = true;
    } else {
      return null;
    }
  }
  return parsed;
}

/** The place of `claude` in a text of folders, found by reading, never by starting anything; `null` when it is not found. */
export function findClaude(pathText) {
  return findCommand("claude", pathText);
}

function findCommand(name, pathText) {
  for (const item of pathText.split(delimiter)) {
    if (item === "") continue;
    const candidate = join(resolve(item), name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // passed over
    }
  }
  return null;
}

/** Whether an entry of `mcpServers` is `claude mcp serve`. */
function startsClaudeCode(entry) {
  return (
    isObject(entry) &&
    typeof entry.command === "string" &&
    basename(entry.command) === "claude" &&
    Array.isArray(entry.args) &&
    entry.args[0] === "mcp" &&
    entry.args[1] === "serve"
  );
}

/** The key of the first entry of `mcpServers` that is Claude Code, or `null`. */
function claudeCodeKey(mcpServers, hostServers) {
  const named = Array.isArray(hostServers) ? hostServers : [];
  return Object.keys(mcpServers).find((key) => named.includes(key) || startsClaudeCode(mcpServers[key])) ?? null;
}

/** The text at `path`, or `null` when nothing is there; throws for any other fault. */
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

/** Writes `text` at `path`, which exists: beside it and renamed over it when that can be, else in place. A link stays a link. */
function rewrite(path, text) {
  const real = realpathSync(path);
  const mode = statSync(real).mode & 0o7777;
  const beside = join(dirname(real), `.${basename(real)}.${process.pid}.tmp`);
  try {
    writeFileSync(beside, text, { mode });
    chmodSync(beside, mode);
    renameSync(beside, real);
  } catch {
    try {
      unlinkSync(beside);
    } catch {
      // there was none
    }
    writeFileSync(real, text, "utf8");
  }
}

/** Makes the file, with the folders it lacks, and gives it the mode 600 whatever the umask. */
function make(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

const textOf = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Asks on standard output, reads one line of standard input, then lets go of it; `null` at the end of the input. */
function askStdin(question) {
  return new Promise((done) => {
    process.stdout.write(question);
    const lines = createInterface({ input: process.stdin });
    let answered = false;
    lines.once("line", (line) => {
      answered = true;
      lines.close();
      process.stdin.pause();
      done(line);
    });
    lines.once("close", () => {
      if (!answered) done(null);
    });
  });
}

const outDefault = (text) => process.stdout.write(`${text}\n`);
const errDefault = (text) => process.stderr.write(`${text}\n`);

/** `onetool init`: `argv` is what follows the word. Resolves with the exit code. */
export async function runInit(
  argv,
  { home = homedir(), pathText = process.env.PATH ?? "", terminal = process.stdin.isTTY === true, ask = askStdin, out = outDefault, err = errDefault } = {},
) {
  const parsed = parseInitArgs(argv);
  if (parsed === null) {
    err(INIT_USAGE);
    return 2;
  }
  const P = parsed.config === null ? join(home, ".config", "onetool", "settings.json") : resolve(parsed.config);
  const fault = (reason) => {
    err(`onetool: init: ${P}: ${reason}`);
    return 1;
  };

  let codex;
  if (parsed.codexRoot) {
    if (!statSync(parsed.codexRoot, { throwIfNoEntry: false })?.isDirectory()) return fault("Codex project folder does not exist");
    codex = findCommand("codex", pathText);
    if (!codex) return fault("codex was not found on PATH");
  }
  let text;
  try {
    text = readText(P);
  } catch {
    return fault("cannot be read");
  }

  let value;
  if (text === null) {
    value = { mcpServers: {} };
    try {
      make(P, textOf(value));
    } catch {
      return fault("cannot be written");
    }
    out(`onetool: init: made ${P}`);
  } else {
    try {
      value = JSON.parse(text);
    } catch {
      return fault("not JSON");
    }
    if (!isObject(value)) return fault("not a JSON object");
    if (Object.hasOwn(value, "mcpServers") && !isObject(value.mcpServers)) return fault("mcpServers is not an object");
    if (Object.hasOwn(value, "onetool") && !isObject(value.onetool)) return fault("onetool is not an object");
    if (isObject(value.onetool) && Object.hasOwn(value.onetool, "hostServers") && !Array.isArray(value.onetool.hostServers)) {
      return fault("onetool.hostServers is not a list");
    }
    out(`onetool: init: found ${P}`);
    if (!Object.hasOwn(value, "mcpServers")) {
      value.mcpServers = {};
      try {
        rewrite(P, textOf(value));
      } catch {
        return fault("cannot be written");
      }
      out(`onetool: init: added an empty mcpServers to ${P}`);
    }
  }

  if (parsed.codexRoot) {
    const entry = {
      command: process.execPath,
      args: [ONETOOL_BIN, "codex-server", "--root", parsed.codexRoot],
      env: { ONETOOL_CODEX_BIN: codex },
    };
    if (Object.hasOwn(value.mcpServers, "codex")) {
      out("onetool: init: kept the existing codex entry. To change its project, edit its --root argument.");
    } else {
      value.mcpServers.codex = entry;
      try { rewrite(P, textOf(value)); } catch { return fault("cannot be written"); }
      out(`onetool: init: added Codex for ${parsed.codexRoot}`);
    }
  } else if (!parsed.noClaude) {
    const code = await proposeClaude(P, value, parsed, { pathText, terminal, ask, out });
    if (code !== 0) return fault("cannot be written");
  }

  out("onetool: init: add this entry to the MCP settings of your host program:");
  const hostEntry = parsed.codexRoot
    ? { command: process.execPath, args: [ONETOOL_BIN, "--config", P] }
    : { command: "npx", args: ["-y", PACKAGE_NAME, "--config", P] };
  out(JSON.stringify({ mcpServers: { onetool: hostEntry } }, null, 2));
  return 0;
}

/** "`onetool init`: Claude Code". Gives 0, or 1 when the write failed. */
async function proposeClaude(P, value, { yes }, { pathText, terminal, ask, out }) {
  const named = claudeCodeKey(value.mcpServers, value.onetool?.hostServers);
  if (named !== null) {
    out(`onetool: init: ${P} already has Claude Code as the server ${named}, nothing is proposed`);
    return 0;
  }
  if (Object.hasOwn(value.mcpServers, "claude")) {
    out(`onetool: init: ${P} has another server named claude, nothing is proposed`);
    return 0;
  }
  const place = findClaude(pathText);
  if (place === null) {
    out("onetool: init: the command claude was not found on this machine, Claude Code is not proposed");
    return 0;
  }
  out("onetool: init: Claude Code can be a server behind onetool: the assistant's programs can then run commands and read, search and edit files through Claude Code's own tools.");
  out("onetool: init: Claude Code as a server asks no permission question: the rules of onetool are the control.");

  if (!yes) {
    if (terminal !== true) {
      out(`onetool: init: nobody to ask, nothing is added. To add it, run: onetool init --config ${P} --yes`);
      return 0;
    }
    let answer;
    try {
      answer = await ask(`Add the server claude to ${P}? [Y/n] `);
    } catch {
      answer = null;
    }
    const said = typeof answer === "string" ? answer.trim().toLowerCase() : null;
    if (said !== "" && said !== "y" && said !== "yes") {
      out("onetool: init: Claude Code is not added");
      return 0;
    }
  }

  value.mcpServers.claude = { command: place, args: ["mcp", "serve"], tools: SIX };
  if (!Object.hasOwn(value, "onetool")) value.onetool = { hostServers: ["claude"] };
  else if (!Object.hasOwn(value.onetool, "hostServers")) value.onetool.hostServers = ["claude"];
  else if (!value.onetool.hostServers.includes("claude")) value.onetool.hostServers.push("claude");
  try {
    rewrite(P, textOf(value));
  } catch {
    return 1;
  }
  out(`onetool: init: added the server claude to ${P} (claude mcp serve), with the tools ${SIX.join(", ")}`);
  if (Array.isArray(value.onetool.allow) && value.onetool.allow.length > 0) {
    out(`onetool: init: onetool.allow of ${P} is not empty: add "claude.*" to it to open these tools`);
  }
  return 0;
}
