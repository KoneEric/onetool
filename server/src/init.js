// The command `onetool init`: sets up the settings file and proposes Claude Code as a server behind onetool.
import { accessSync, appendFileSync, chmodSync, constants, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const INIT_USAGE = "usage: onetool init [--config <settings file>] [--yes] [--no-claude] [--no-rules] [--codex <project folder>]";

// the two paragraphs of standing instructions, and the two marker lines that hold them in a file of a host program
export const STANDING_RULES =
  "When you use onetool, group the work. Before the first run, list the steps of the task. Put every step that needs no decision into one program: loops, filters, several tools. " +
  "Return only the small result you need to decide what comes next, and keep large results in state. Never use run for one tool call when the next call is already known." +
  "\n\n" +
  "Before the first call of a task, list every tool the task will need that is not loaded yet, and load them together in one request. " +
  "Each extra request is one more model call that reads the whole context again.";
export const RULES_BEGIN = "<!-- onetool: begin (added by onetool init) -->";
export const RULES_END = "<!-- onetool: end -->";
const RULES_BLOCK = `${RULES_BEGIN}\n${STANDING_RULES}\n${RULES_END}\n`;

/** The known host programs, in the order of everything printed: its name, the command looked for, its file of standing instructions. */
const HOST_PROGRAMS = [
  { name: "Claude Code", command: "claude", file: (home) => join(home, ".claude", "CLAUDE.md") },
  { name: "Codex", command: "codex", file: (home) => join(home, ".codex", "AGENTS.md") },
];

const ONETOOL_BIN = fileURLToPath(new URL("../../bin/onetool.js", import.meta.url));
const SIX = ["Bash", "Read", "Edit", "Write", "Grep", "Glob"];
const PACKAGE_NAME = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).name;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** The arguments after `init`: `{ config, yes, noClaude, noRules }` (`config` is `null` when not given), or `null` when they are wrong. */
export function parseInitArgs(argv) {
  const parsed = { config: null, yes: false, noClaude: false, noRules: false };
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
    } else if (option === "--no-rules" && !parsed.noRules) {
      parsed.noRules = true;
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

/** The one reader of standard input: its lines wait in a queue, and `null` answers every call after the end of the input. */
let reader = null;

function stdinReader() {
  if (reader !== null) return reader;
  const lines = [];
  const waiting = [];
  let ended = false;
  const input = createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else lines.push(line);
  });
  input.on("close", () => {
    ended = true;
    for (const next of waiting.splice(0)) next(null);
  });
  reader = {
    next: () =>
      new Promise((done) => {
        if (lines.length > 0) return done(lines.shift());
        if (ended) return done(null);
        waiting.push(done);
        input.resume();
        process.stdin.resume();
      }),
    rest: () => {
      // nothing keeps the process alive between two questions, nor after the last
      input.pause();
      process.stdin.pause();
    },
  };
  return reader;
}

/** Asks on standard output and reads the next line of standard input; `null` at the end of the input. */
async function askStdin(question) {
  process.stdout.write(question);
  const source = stdinReader();
  const line = await source.next();
  source.rest();
  return line;
}

/** Whether the person said yes: empty, `y` or `yes`, trimmed and in lower case; anything else, `null` and an `ask` that rejects included, is no. */
async function saysYes(ask, question) {
  let answer;
  try {
    answer = await ask(question);
  } catch {
    answer = null;
  }
  const said = typeof answer === "string" ? answer.trim().toLowerCase() : null;
  return said === "" || said === "y" || said === "yes";
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

  const rulesFault = parsed.noRules ? false : await proposeRules(parsed, { home, pathText, terminal, ask, out, err });

  out("onetool: init: add this entry to the MCP settings of your host program:");
  const hostEntry = parsed.codexRoot
    ? { command: process.execPath, args: [ONETOOL_BIN, "--config", P] }
    : { command: "npx", args: ["-y", PACKAGE_NAME, "--config", P] };
  out(JSON.stringify({ mcpServers: { onetool: hostEntry } }, null, 2));
  return rulesFault ? 1 : 0;
}

/** "The proposal, one host program after the other". Gives whether a file of standing instructions could not be read or written. */
async function proposeRules({ yes }, { home, pathText, terminal, ask, out, err }) {
  let fault = false;
  let nobody = false;
  for (const host of HOST_PROGRAMS) {
    if (findCommand(host.command, pathText) === null) continue;
    const file = host.file(home);
    let old = null;
    try {
      old = readFileSync(file);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        err(`onetool: init: ${file}: cannot be read`);
        fault = true;
        continue;
      }
    }
    if (old !== null && old.includes(RULES_BEGIN)) {
      out(`onetool: init: ${file} already has the paragraphs of onetool, nothing is proposed`);
      continue;
    }
    out(`onetool: init: ${host.name} can be told to group its work and to load its tools in one request: two paragraphs at the end of ${file}, its file of standing instructions.`);
    if (!yes) {
      if (terminal !== true) {
        out(`onetool: init: nobody to ask, nothing is added to ${file}. To add the paragraphs, run the same command with --yes`);
        nobody = true;
        continue;
      }
      if (!(await saysYes(ask, `Add the two paragraphs to ${file}? [Y/n] `))) {
        out(`onetool: init: nothing is added to ${file}`);
        continue;
      }
    }
    // one write, at the end of the file, in place: the old bytes stay, one empty line stands before the block
    const gap = old === null || old.length === 0 ? "" : old.at(-1) === 0x0a ? "\n" : "\n\n";
    try {
      if (old === null) mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${gap}${RULES_BLOCK}`);
    } catch {
      err(`onetool: init: ${file}: cannot be written`);
      fault = true;
      continue;
    }
    out(`onetool: init: added the two paragraphs to ${file}`);
  }
  if (nobody) {
    out("onetool: init: the two paragraphs:");
    out(STANDING_RULES);
  }
  return fault;
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
    if (!(await saysYes(ask, `Add the server claude to ${P}? [Y/n] `))) {
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
