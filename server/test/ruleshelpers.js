// Helpers of the tests of "Step 13: `onetool init` proposes the standing instructions" (the meeting point of server): the texts the
// section fixes, written out in full (never taken from the code under test), the stand-ins `claude` and `codex` (/bin/sh scripts,
// mode 0o755, that leave a mark when started), and the files of standing instructions of a home the test made.
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpDir } from "./helpers.js";
import { ENTRY_HEAD, entryText } from "./inithelpers.js";

export const FIRST =
  "When you use onetool, group the work. Before the first run, list the steps of the task. Put every step that needs no decision into one program: loops, filters, several tools. Return only the small result you need to decide what comes next, and keep large results in state. Never use run for one tool call when the next call is already known.";
export const SECOND =
  "Before the first call of a task, list every tool the task will need that is not loaded yet, and load them together in one request. Each extra request is one more model call that reads the whole context again.";
export const BEGIN = "<!-- onetool: begin (added by onetool init) -->";
export const END = "<!-- onetool: end -->";
export const RULES = `${FIRST}\n\n${SECOND}`;
export const BLOCK = `${BEGIN}\n${FIRST}\n\n${SECOND}\n${END}\n`;

export const USAGE = "usage: onetool init [--config <settings file>] [--yes] [--no-claude] [--no-rules] [--codex <project folder>]";

// ---- the files of standing instructions, in a home --------------------------------------------------------------------------

export const fileC = (home) => join(home, ".claude", "CLAUDE.md");
export const fileA = (home) => join(home, ".codex", "AGENTS.md");

// ---- the lines of the section ---------------------------------------------------------------------------------------------

export const proposalLine = (H, F) =>
  `onetool: init: ${H} can be told to group its work and to load its tools in one request: two paragraphs at the end of ${F}, its file of standing instructions.`;
export const proposalC = (home) => proposalLine("Claude Code", fileC(home));
export const proposalA = (home) => proposalLine("Codex", fileA(home));
export const addedRules = (F) => `onetool: init: added the two paragraphs to ${F}`;
export const alreadyRules = (F) => `onetool: init: ${F} already has the paragraphs of onetool, nothing is proposed`;
export const nobodyRules = (F) => `onetool: init: nobody to ask, nothing is added to ${F}. To add the paragraphs, run the same command with --yes`;
export const notAddedRules = (F) => `onetool: init: nothing is added to ${F}`;
export const cannotRead = (F) => `onetool: init: ${F}: cannot be read`;
export const cannotWrite = (F) => `onetool: init: ${F}: cannot be written`;
export const askRules = (F) => `Add the two paragraphs to ${F}? [Y/n] `;
export const PARAGRAPHS_HEAD = "onetool: init: the two paragraphs:";

/** The lines of the entry of `init` when the command is the published package (no `--codex`). */
export const wholeText = (lines, P) => [...lines, ENTRY_HEAD, entryText(P)].join("\n");

// ---- the stand-ins ----------------------------------------------------------------------------------------------------

/**
 * A folder that holds the stand-ins named in `names` (`claude`, `codex`): each a /bin/sh script, mode 0o755, that writes a mark in a
 * file of the test (outside the folder) and exits 1. `started()` says whether any was ever started.
 */
export function standIns(...names) {
  const dir = tmpDir();
  const mark = join(tmpDir(), "started");
  for (const name of names) {
    const place = join(dir, name);
    writeFileSync(place, `#!/bin/sh\necho ${name} >> '${mark}'\nexit 1\n`, "utf8");
    chmodSync(place, 0o755);
  }
  return { dir, mark, started: () => existsSync(mark), place: (name) => join(dir, name) };
}

// ---- files ----------------------------------------------------------------------------------------------------------

/** Writes `bytes` (a string or a buffer) at `file`, making the folders above it. */
export function putBytes(file, bytes) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}

export const bytesOf = (file) => readFileSync(file);

/** Every file under `dir`, as paths relative to it, sorted; folders are listed with a trailing `/`. */
export function listing(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(`${rel}/`, ...listing(dir, rel));
    else found.push(rel);
  }
  return found.sort();
}

/** Whether the person who runs the tests can be refused by file modes (a test of a refused write skips for the super-user). */
export const SUPER_USER = typeof process.getuid === "function" && process.getuid() === 0;
