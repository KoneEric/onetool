// Helpers of the tests of "Step 10: signing in by OAuth to a listed server" (the meeting point of server): the practice server
// that asks for a sign-in, as a process; the commands `login` and `logout` as processes; and onetool in front of a
// client of the package that counts the notifications `tools/list_changed`. Every process is started with a HOME the
// test made, `login` always with `--no-browser` (unless the test is about the browser, with stand-ins first in PATH),
// and every wait has a limit of 10 seconds or less.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { BIN, PRACTICE, ROOT, practiceEntry, settingsOf, sleep, textOf, tmpDir, waitFor, writeSettings } from "./helpers.js";

export const LOGIN_USAGE = "usage: onetool login <server> --config <settings file> [--no-browser] [--wait <seconds>]";
export const LOGOUT_USAGE = "usage: onetool logout <server> --config <settings file>";
export const SERVER_USAGE = "usage: onetool --config <settings file>";

/** What a program gets for a tool of a sign-in server that is sign in needed, after `<id> failed: `. */
export const needed = (settingsPath, server = "far") => `sign in needed: run "onetool login ${server} --config ${settingsPath}" in a terminal`;
/** The whole first line of the answer of a program that called `<id>` of such a server. */
export const failedLine = (settingsPath, id = "far.count", server = "far") => `The program failed: Error: ${id} failed: ${needed(settingsPath, server)}`;
export const NEEDED_LINE = "onetool: server far: sign in needed";
export const COUNT_LYON = '(await tools.far.count({ city: "Lyon" })).count';

/** What a sign-in hands out, by its first letters (the meeting point of practice, "What it hands out"). */
export const SECRET_MARKS = ["practice-at-", "practice-rt-", "practice-code-"];

const children = new Set();
process.on("exit", () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
});

/** The path of the file of the sign-in of `name` in the home `home`. */
export const authPath = (home, name = "far") => join(home, ".onetool", "auth", `${encodeURIComponent(name)}.json`);

/** Whether the file of a sign-in is there. */
export const hasSignIn = (home, name = "far") => existsSync(authPath(home, name));

// ---- the practice server that asks for a sign-in ---------------------------------------------------------------------

/** `node practice/src/server.js --port 0 --signin ...extra`, read to its line: `{ origin, url, host, seen(), forget(), stop() }`. */
export async function startPractice(extra = []) {
  const child = spawn(process.execPath, [PRACTICE, "--port", "0", "--signin", ...extra], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (err += chunk));
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no line of the practice server in 8 seconds; stderr: ${err}`)), 8000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const m = /^practice: listening on (http:\/\/127\.0\.0\.1:\d+)\/mcp\n/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      reject(new Error(`the practice server ended (code ${code}) before its line; stderr: ${err}`));
    });
  }).catch((error) => {
    child.kill("SIGKILL");
    throw error;
  });
  const get = async (path, method = "GET") => {
    const response = await fetch(`${origin}${path}`, { method, signal: AbortSignal.timeout(8000) });
    const text = await response.text();
    return { status: response.status, text };
  };
  return {
    origin,
    url: `${origin}/mcp`,
    host: new URL(origin).host,
    seen: async () => JSON.parse((await get("/seen")).text),
    forget: async () => assert.equal((await get("/forget", "POST")).status, 204),
    stop: () => child.kill("SIGKILL"),
  };
}

/** Runs `fn(practice)` against a practice server started with `extra`, and ends it after. */
export async function withPractice(extra, fn) {
  const practice = await startPractice(extra);
  try {
    return await fn(practice);
  } finally {
    practice.stop();
  }
}

/** The settings file of a test: `practice` by command, `far` at the address of `practice` (or `url`), and the short limits. */
export function signSettings(practice, { onetool = {}, far = {}, others = {}, withCommand = true } = {}) {
  const url = typeof practice === "string" ? practice : practice.url;
  return writeSettings(
    settingsOf(
      { ...(withCommand ? { practice: practiceEntry() } : {}), far: { url, ...far }, ...others },
      { connectSeconds: 5, timeoutSeconds: 10, ...onetool },
    ),
  );
}

// ---- the commands `login` and `logout` as processes ------------------------------------------------------------------

/**
 * `node bin/onetool.js ...args`, its standard input left open (they end by themselves). `env` is added to the environment;
 * `HOME` is `home`. `stdout()`, `stderr()`, `exited` ({ code, signal }), `line(regex)` waits for a match in standard
 * output, `within(ms)` waits for the end.
 */
export function command(args, { home, env = {}, cwd = ROOT } = {}) {
  const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, HOME: home, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  child.stdin.on("error", () => {});
  const exited = new Promise((resolve) =>
    child.on("close", (code, signal) => {
      children.delete(child);
      resolve({ code, signal });
    }),
  );
  const api = {
    child,
    exited,
    stdout: () => out,
    stderr: () => err,
    line: async (regex, ms = 10000) => {
      const end = Date.now() + ms;
      for (;;) {
        const found = regex.exec(out);
        if (found) return found;
        if (child.exitCode !== null || child.signalCode !== null) {
          assert.fail(`the command ended (code ${child.exitCode}, signal ${child.signalCode}) with no line that matches ${regex}; stdout: ${out}; stderr: ${err}`);
        }
        if (Date.now() >= end) assert.fail(`gave up waiting for a line of standard output that matches ${regex}; stdout: ${out}`);
        await sleep(20);
      }
    },
    /** How it ended, failing when it is still there after `ms`. */
    async within(ms = 10000) {
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the command was still there after ${ms} ms; stdout: ${out}; stderr: ${err}`)), ms);
      });
      try {
        return await Promise.race([exited, late]);
      } finally {
        clearTimeout(timer);
      }
    },
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
  };
  return api;
}

/** The command run to its end: `{ code, signal, stdout, stderr }`. */
export async function runCommand(args, options) {
  const c = command(args, options);
  try {
    const { code, signal } = await c.within(options?.ms ?? 10000);
    return { code, signal, stdout: c.stdout(), stderr: c.stderr() };
  } finally {
    c.kill();
  }
}

export const ADDRESS_LINE = (server = "far") => new RegExp(`^onetool: to sign in to ${server}, open (\\S+)\\n`);

/** What a browser does with an address: it asks for it, and follows the redirect to the callback address. */
export async function open(address) {
  const response = await fetch(address, { signal: AbortSignal.timeout(8000) });
  await response.arrayBuffer();
  return response.status;
}

/**
 * `login <server> --config <settings> --no-browser --wait 10` started; `fn(c, address)` runs once the address line is
 * there (the command still waits); `fn` opens the address itself. Gives what `fn` gives.
 */
export async function withLogin(settingsPath, home, fn, { server = "far", extra = [] } = {}) {
  const c = command(["login", server, "--config", settingsPath, "--no-browser", "--wait", "10", ...extra], { home });
  try {
    const [, address] = await c.line(ADDRESS_LINE(server));
    return await fn(c, address);
  } finally {
    c.kill();
  }
}

/** A complete sign-in by the command: the address is opened, the command must end with code 0. Gives `{ stdout, stderr }`. */
export async function signIn(settingsPath, home, options) {
  return withLogin(
    settingsPath,
    home,
    async (c, address) => {
      await open(address);
      const { code } = await c.within(10000);
      assert.equal(code, 0, `login: ${c.stdout()} ${c.stderr()}`);
      return { stdout: c.stdout(), stderr: c.stderr() };
    },
    options,
  );
}

/** `logout <server> --config <settings>` run to its end. */
export const signOut = (settingsPath, home, server = "far") => runCommand(["logout", server, "--config", settingsPath], { home });

// ---- onetool in front of a client of the package ----------------------------------------------------------------------

/**
 * Runs `fn(host)` against the real command with HOME `home`. `host` has `client`, `search(words?)` (the text), `run(code)`
 * (`{ text, lines, isError }`), `call(name, args)` (the result), `changed()` (how many `notifications/tools/list_changed`
 * came), `questions` (the questions the person was asked, when `canAsk`), `stderr()`, `stderrLines()`, `needed()` (how many
 * lines `NEEDED_LINE` there are) and `answers` (every text answered, for the search of secrets).
 */
export async function withSignin(settingsPath, home, fn, { canAsk = false, cwd = ROOT, configArg = settingsPath, env = {} } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", configArg],
    cwd,
    env: { ...getDefaultEnvironment(), HOME: home, ...env },
    stderr: "pipe",
  });
  let err = "";
  transport.stderr?.on("data", (chunk) => (err += String(chunk)));
  const client = new Client({ name: "sign-test", version: "0.0.0" }, { capabilities: canAsk ? { elicitation: {} } : {} });
  let changed = 0;
  const questions = [];
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    changed += 1;
  });
  if (canAsk) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      questions.push(request.params);
      return { action: "accept" };
    });
  }
  await client.connect(transport, { timeout: 10000 });
  const answers = [];
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
    answers.push(JSON.stringify(result));
    return result;
  };
  const host = {
    client,
    call,
    answers,
    questions,
    changed: () => changed,
    stderr: () => err,
    stderrLines: () => err.split("\n").filter((line) => line !== ""),
    needed: () => err.split("\n").filter((line) => line === NEEDED_LINE).length,
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

/** Waits until the line `NEEDED_LINE` has been written `n` times. */
export const waitNeeded = (host, n = 1) => waitFor(() => host.needed() >= n, 10000, `the line ${NEEDED_LINE} ${n} time(s)`);

export { sleep };

/** The text of the file at `path`. */
export const read = (path) => readFileSync(path, "utf8");

/** Two stand-ins, `open` and `xdg-open`, in a folder (`bin`, to put first in PATH) that each leave a mark with their arguments. */
export function standIns() {
  const bin = tmpDir();
  const marks = tmpDir();
  for (const name of ["open", "xdg-open"]) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$1" >'${join(marks, name)}'\n`);
    chmodSync(file, 0o755);
  }
  return { bin, mark: (name) => join(marks, name), marked: () => existsSync(join(marks, "open")) || existsSync(join(marks, "xdg-open")) };
}
