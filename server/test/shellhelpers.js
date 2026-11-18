// Helpers of the tests of "Step 4: the built-in server `shell`": a folder to work in, the settings that switch the
// shell on, and the texts that part `core` fixes (the meeting point of core, "Step 4: ...").
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { settingsOf, textOf, tmpDir } from "./helpers.js";

/** A folder `W` (real path) in a folder of its own, holding `files` (name -> text); `parent` is beside `W`. */
export function workFolder(files = {}) {
  const parent = tmpDir();
  const W = join(parent, "W");
  mkdirSync(W);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(W, name), text, "utf8");
  return { parent, W };
}

/**
 * Settings with the shell on. `shell` holds the keys of `onetool.shell` besides `folders`, `onetool` the other keys of
 * `onetool`, `servers` the entries of `mcpServers`. The trail and the log are off: they are the next step's.
 */
export function shellSettings(folders, { shell = {}, onetool = {}, servers = {} } = {}) {
  return settingsOf(servers, { shell: { folders, ...shell }, trail: false, log: false, ...onetool });
}

/** The same without the key `shell`. */
export function offSettings({ onetool = {}, servers = {} } = {}) {
  return settingsOf(servers, { trail: false, log: false, ...onetool });
}

/** The result of `ctx.run(code)` as { text, isError }; fails when it is not one text item. */
export async function ran(ctx, code) {
  const result = await ctx.run(code);
  return { text: textOf(result), isError: result.isError === true };
}

/** What a program that catches the rejection of `call` says: [<it is an Error>, <its message>]. */
export const caughtOf = async (ctx, call) => {
  const answer = await ran(ctx, `try { await ${call}; return JSON.stringify(["answered"]); } catch (e) { return JSON.stringify([e instanceof Error, e.message]); }`);
  assert.equal(answer.isError, false, answer.text);
  return JSON.parse(answer.text);
};

/** The text of a failure of a program, the meeting point of core "`formatRun`". */
export const failed = (message) => `The program failed: ${message}`;

// the meeting point of core, "Step 4: `shellOffMessage(message)`"
export const OFF_HINT = "(the shell is not switched on: see onetool.shell in the settings file)";

// the meeting point of core, "`askMessage(id, rule, args, { limit })`"
export const question = (id, rule, argumentsText) =>
  [
    `onetool: a program wants to call ${id}.`,
    `Arguments: ${argumentsText}`,
    `The rule ask "${rule}" asks for your consent. Allow this call?`,
  ].join("\n");

// the meeting point of core, "`askRefusal(id, rule, why)`"
export const refusal = (id, rule, cause) => `onetool: ${id} is refused by the rule ask "${rule}": ${cause}`;
export const SAID_NO = "the person said no";
export const NO_ANSWER = "the person gave no answer";
export const QUESTION_FAILED = "the question failed";
export const CANNOT_ASK = "the host program cannot ask the person";

// the meeting point of core, "Step 4: `SHELL_TOOLS`" and "One line per tool"
export const SHELL_LINES = [
  "shell.run(command: string) - Runs a shell command in the first listed folder.",
  "shell.read(path: string) - Reads a text file of the listed folders.",
  "shell.write(path: string, text: string) - Writes a text file in the listed folders, replacing what it holds.",
  "shell.edit(path: string, old: string, new: string) - Replaces one text by another in a file of the listed folders.",
];

/**
 * A command that starts a child, writes the two process numbers (the shell's, the child's) to `pids` in the first
 * folder, and waits. As the text of a program: the command is a plain string there.
 */
export const WAITING_COMMAND = 'sleep 300 & echo "$! $$" > pids; wait';

/** The two process numbers a command of WAITING_COMMAND wrote, from the text of its file; null when not there yet. */
export function pidsIn(text) {
  const found = /^(\d+) (\d+)\n?$/.exec(text);
  return found ? [Number(found[1]), Number(found[2])] : null;
}
