// Helpers of the tests of step 5 (the meeting point of server, "Step 5: the folders of the host program" and "Step 5: the rules of
// the host program"): the folders and the settings files of the host program that a test makes, the texts that part
// `core` fixes ("Step 5: the texts of a host program's rule", "Step 5: `SHELL_NO_FOLDERS`"), and the host programs.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { settingsOf, sleep, tmpDir } from "./helpers.js";
import { startHost } from "./askhost.js";

// the meeting point of core, "Step 5: `SHELL_NO_FOLDERS`, and `shellOffMessage(message, why)`"
export const NO_FOLDERS = "no folder: onetool.shell.folders is not set and the host program gave none";
export const NO_FOLDERS_LINE = `shell: not connected (${NO_FOLDERS})`;
export const NO_FOLDERS_ANSWER = `The program failed: ReferenceError: $ is not defined (the shell has ${NO_FOLDERS})`;
export const UNKNOWN_HOST_LINE = "onetool: host rules: this host program is not known, onetool's own rules only";

// the meeting point of core, "Step 5: the texts of a host program's rule"
export const hostDenial = (id, rule, file) => `onetool: ${id} is denied by the rule deny "${rule}" of the host program (${file})`;
export const hostQuestion = (id, rule, argumentsText, file) =>
  [
    `onetool: a program wants to call ${id}.`,
    `Arguments: ${argumentsText}`,
    `The rule ask "${rule}" of the host program (${file}) asks for your consent. Allow this call?`,
  ].join("\n");
export const hostRefusal = (id, rule, cause, file) => `onetool: ${id} is refused by the rule ask "${rule}" of the host program (${file}): ${cause}`;
export const unreadableLine = (file) => `onetool: host rules: ${file} cannot be read, its rules are not applied`;

/** The capabilities a host program declares. */
export const ROOTS = { roots: { listChanged: true } };
export const ROOTS_AND_ASK = { roots: { listChanged: true }, elicitation: {} };

const json = (value) => JSON.stringify(value);

/** Writes `text` (or a value turned to JSON) in `file`, making the folders above it. */
export function put(file, text) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof text === "string" ? text : json(text), "utf8");
}

/**
 * The folders and files of "Step 5: through the real thing", in the system's temporary folder: the home `H` of the
 * person, a folder `A` of a session with its settings file of the host program, a folder `B`, a folder `L` for the log.
 * `rules` is the `permissions` of `A/.claude/settings.json`.
 */
export function world({ rules } = {}) {
  const H = tmpDir();
  const A = tmpDir();
  const B = tmpDir();
  const L = tmpDir();
  put(join(H, ".claude", "settings.json"), { permissions: { deny: ["Bash(curl *)"] } });
  for (const [name, text] of [["one.txt", "alpha\n"], ["secret.txt", "hidden\n"], ["notes.txt", "draft\n"]]) put(join(A, name), text);
  put(join(B, "two.txt"), "beta\n");
  put(
    join(A, ".claude", "settings.json"),
    {
      permissions: rules ?? {
        deny: ["Bash(rm *)", "Read(./secret.txt)"],
        ask: ["Edit(./notes.txt)"],
        allow: ["Bash(*)", "Read(./secret.txt)"],
      },
    },
  );
  return {
    H,
    A,
    B,
    L,
    userFile: join(H, ".claude", "settings.json"),
    fileA: join(A, ".claude", "settings.json"),
    localA: join(A, ".claude", "settings.local.json"),
    fileB: join(B, ".claude", "settings.json"),
  };
}

/**
 * Settings with the shell on and no folder in the file (`shell` is `{}`: give `folders` in it, or `null` for no key
 * `shell`), `onetool` holding the other keys, `servers` the entries (trail and log off).
 */
export function shellOnly({ shell = {}, onetool = {}, servers = {} } = {}) {
  return settingsOf(servers, { ...(shell === null ? {} : { shell }), trail: false, log: false, ...onetool });
}

/**
 * A host program (askhost.js) in front of the command. It is named `name`, answers the roots `roots` (not declared when
 * `roots` is `undefined` and `capabilities` says nothing of them) and has the person's home `home`: no test starts the
 * command with a known host name and the home of the person who runs the tests.
 */
export function startProgram(settings, { home, name = "some-host", capabilities = {}, roots, ...rest } = {}) {
  if (home === undefined) throw new Error("a test of step 5 passes the home it made");
  return startHost(settings, { name, capabilities, roots, env: { HOME: home }, ...rest });
}

/** Claude Code as the host program: roots and questions declared, `roots` answered (`[w.A]` unless said, `undefined` for none). */
export function startClaude(settings, w, options = {}) {
  const { capabilities = ROOTS_AND_ASK, ...rest } = options;
  return startProgram(settings, { home: w.H, name: "claude-code", capabilities, ...("roots" in options ? {} : { roots: [w.A] }), ...rest });
}

/** What a program that catches the rejection of `call` says: the message, or `answered` (a text). */
export const messageOf = (call) =>
  `try { await ${call}; return "answered"; } catch (e) { return e instanceof Error ? e.message : "not an Error"; }`;

/** Waits at most `ms` for `promise`; gives `"pending"` when it is not settled by then. */
export async function settledWithin(promise, ms = 300) {
  let settled = false;
  const watched = promise.then(
    (value) => {
      settled = true;
      return value;
    },
    (error) => {
      settled = true;
      throw error;
    },
  );
  await Promise.race([watched.catch(() => {}), sleep(ms)]);
  return settled ? watched : "pending";
}

/** Every file under `folder` as { relative path: text }, for a test that holds that nothing was written. */
export function snapshot(folder) {
  const found = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else found[full] = readFileSync(full, "utf8");
    }
  };
  walk(folder);
  return found;
}

/** How many lines of `text` are exactly `line`. */
export const countLine = (text, line) => text.split("\n").filter((one) => one === line).length;

async function using(host, fn) {
  try {
    return await fn(host);
  } finally {
    host.kill();
    await host.exited;
  }
}

/** Runs `fn(host)` with `startProgram(...)`, and kills the process after it, whatever happens. */
export async function withProgram(settings, options, fn) {
  return using(await startProgram(settings, options), fn);
}

/** The same with `startClaude(...)`. */
export async function withClaude(settings, w, options, fn) {
  return using(await startClaude(settings, w, options), fn);
}

/** Waits until a program of the fake server's tool `barrier` is waiting in it: the program has started. */
export async function waitInBarrier(host, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    if ((await host.recorded()).some((call) => call.name === "barrier")) return;
    if (Date.now() >= end) throw new Error("gave up waiting for a program in the barrier");
    await sleep(20);
  }
}
