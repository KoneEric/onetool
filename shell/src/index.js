import { spawn } from "node:child_process";
import { constants } from "node:os";
import { lstat, stat, realpath, readFile as readBytes, writeFile as writeBytes } from "node:fs/promises";
import { resolve, join, dirname, basename, sep } from "node:path";

export class ShellError extends Error {
  constructor(message, outside = false) {
    super(message);
    this.name = "ShellError";
    this.outside = outside;
  }
}

const DEFAULT_LIMIT = 10000000;

// ---- folders and the real place of a path

export async function realPlace(path, folders) {
  if (typeof path !== "string" || path === "") throw new ShellError("the path must be a text that is not empty");
  const full = resolve(folders[0], path);
  const outside = () => new ShellError(`${path} is outside the listed folders`, true);

  let found = full;
  const names = [];
  for (;;) {
    try {
      await lstat(found);
      break;
    } catch {
      const parent = dirname(found);
      if (parent === found) throw outside();
      names.unshift(basename(found));
      found = parent;
    }
  }

  let real;
  try {
    real = join(await realpath(found), ...names);
  } catch {
    throw outside();
  }

  for (const folder of folders) {
    let realFolder;
    try {
      realFolder = await realpath(folder);
    } catch {
      continue;
    }
    if (real === realFolder || real.startsWith(realFolder.endsWith(sep) ? realFolder : realFolder + sep)) return real;
  }
  throw outside();
}

export async function missingFolders(folders) {
  const missing = [];
  try {
    for (let i = 0; i < folders.length; i++) {
      try {
        if (!(await stat(folders[i])).isDirectory()) missing.push(i);
      } catch {
        missing.push(i);
      }
    }
  } catch {
    // not a list: undefined by the meeting point
  }
  return missing;
}

// ---- the three file functions

const isGone = (err) => err && (err.code === "ENOENT" || err.code === "ENOTDIR");

// The real place and the text of the file, with the faults of `readFile`.
async function load(path, folders, limit) {
  const real = await realPlace(path, folders);
  let info;
  try {
    info = await stat(real);
  } catch (err) {
    throw new ShellError(isGone(err) ? `${path}: no such file` : `${path}: cannot be read`);
  }
  if (!info.isFile()) throw new ShellError(`${path}: not a file`);
  const over = () => new ShellError(`${path}: the file is over ${limit} bytes`);
  if (info.size > limit) throw over();
  let bytes;
  try {
    bytes = await readBytes(real);
  } catch {
    throw new ShellError(`${path}: cannot be read`);
  }
  if (bytes.length > limit) throw over();
  return { real, text: bytes.toString("utf8") };
}

export async function readFile(path, { folders, limit = DEFAULT_LIMIT } = {}) {
  return (await load(path, folders, limit)).text;
}

export async function writeFile(path, text, { folders } = {}) {
  if (typeof text !== "string") throw new ShellError("the text must be a text");
  const real = await realPlace(path, folders);
  let info = null;
  try {
    info = await stat(real);
  } catch (err) {
    if (!isGone(err)) throw new ShellError(`${path}: cannot be written`);
  }
  if (info) {
    if (!info.isFile()) throw new ShellError(`${path}: not a file`);
  } else {
    let parent = null;
    try {
      parent = await stat(dirname(real));
    } catch {
      // handled below
    }
    if (!parent || !parent.isDirectory()) throw new ShellError(`${path}: its folder does not exist`);
  }
  try {
    await writeBytes(real, text, "utf8");
  } catch {
    throw new ShellError(`${path}: cannot be written`);
  }
}

export async function editFile(path, oldText, newText, { folders, limit = DEFAULT_LIMIT } = {}) {
  if (typeof oldText !== "string" || oldText === "") {
    throw new ShellError("the old text must be a text that is not empty");
  }
  if (typeof newText !== "string") throw new ShellError("the new text must be a text");
  const { real, text } = await load(path, folders, limit);
  const count = text.split(oldText).length - 1;
  if (count === 0) throw new ShellError(`${path}: the old text is not in the file`);
  if (count > 1) {
    throw new ShellError(`${path}: the old text is in the file ${count} times, it must be there once`);
  }
  const at = text.indexOf(oldText);
  const edited = text.slice(0, at) + newText + text.slice(at + oldText.length);
  try {
    await writeBytes(real, edited, "utf8");
  } catch {
    throw new ShellError(`${path}: cannot be written`);
  }
}

// ---- running one command

// The process groups of the commands still running, by the number of their shell.
const running = new Set();
let exitListener = false;

function killGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // the group is already gone
  }
}

function listenForExit() {
  if (exitListener) return;
  exitListener = true;
  process.on("exit", () => {
    for (const pid of running) killGroup(pid);
    running.clear();
  });
}

export function runCommand(command, { cwd, signal, env = process.env, outputLimit = DEFAULT_LIMIT } = {}) {
  if (typeof command !== "string" || command.trim() === "") {
    return Promise.reject(new ShellError("the command must be a text that is not empty"));
  }
  if (signal && signal.aborted) return Promise.reject(new ShellError("the command was stopped"));

  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn("/bin/sh", ["-c", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      rejectPromise(new ShellError("the command could not be started"));
      return;
    }
    const notStarted = new ShellError("the command could not be started");
    let pid = null;
    let killed = false;
    let stopError = null;
    let exited = false;
    let closed = false;
    let exitCode = 0;
    let settled = false;
    const chunks = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };

    const kill = () => {
      if (killed || pid === null) return;
      killed = true;
      killGroup(pid);
    };
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      if (pid !== null) running.delete(pid);
      if (child.stdout) child.stdout.destroy();
      if (child.stderr) child.stderr.destroy();
      settle(value);
    };
    const check = () => {
      if (!exited) return;
      if (stopError) finish(rejectPromise, stopError);
      else if (closed) {
        finish(resolvePromise, {
          exitCode,
          stdout: Buffer.concat(chunks.stdout).toString("utf8"),
          stderr: Buffer.concat(chunks.stderr).toString("utf8"),
        });
      }
    };
    const stop = (error) => {
      if (settled || stopError) return;
      stopError = error;
      kill();
      check();
    };
    function onAbort() {
      stop(new ShellError("the command was stopped"));
    }

    child.on("error", () => {
      // only a shell that never started is a fault here; one that ran is judged by its end
      if (child.pid === undefined) finish(rejectPromise, notStarted);
    });
    if (child.pid === undefined) return;
    pid = child.pid;
    running.add(pid);
    listenForExit();

    for (const name of ["stdout", "stderr"]) {
      child[name].on("data", (chunk) => {
        if (stopError) return;
        sizes[name] += chunk.length;
        if (sizes[name] > outputLimit) {
          stop(new ShellError(`the output is over ${outputLimit} bytes`));
          return;
        }
        chunks[name].push(chunk);
      });
    }
    child.on("exit", (code, sig) => {
      exited = true;
      exitCode = code !== null ? code : 128 + (constants.signals[sig] ?? 0);
      // nothing the command started outlives it; a stop that came while the shell was forking
      // may have missed a child, so the group is swept once more now that the shell is gone
      if (pid !== null) killGroup(pid);
      check();
    });
    child.on("close", () => {
      closed = true;
      check();
    });

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
  });
}
