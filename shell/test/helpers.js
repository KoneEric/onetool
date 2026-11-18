import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ShellError } from "../src/index.js";

export const SRC_URL = pathToFileURL(join(import.meta.dirname, "..", "src", "index.js")).href;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls `fn` until it gives something truthy, or gives up after `ms`.
export async function waitFor(fn, ms = 3000, step = 20) {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() >= end) return got;
    await sleep(step);
  }
}

// Gives the promise's value, or fails the test when it is not settled after `ms`.
export function within(promise, ms, what = "the promise") {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} was not settled after ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== "ESRCH";
  }
}

// Reads the process numbers a command wrote (`echo "$$ $!" > file`), once there are `count` of them.
export async function pidsIn(file, count) {
  const got = await waitFor(() => {
    if (!existsSync(file)) return null;
    const pids = readFileSync(file, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
    return pids.length >= count && pids.every(Number.isInteger) ? pids : null;
  });
  assert.ok(got, `the command did not write ${count} process numbers to ${file}`);
  return got;
}

// All of the pids are gone (`kill(pid, 0)` throws ESRCH) within `ms`.
export async function allGone(pids, ms = 2000) {
  const gone = await waitFor(() => pids.every((pid) => !alive(pid)), ms, 10);
  assert.ok(gone, `still alive after ${ms} ms: ${pids.filter(alive).join(", ")}`);
}

// Kills what a failed test left behind, by the numbers the test itself collected.
export function reap(pids) {
  for (const pid of pids) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

// A folder tree in the system's temporary folder (on macOS the folder itself is reached through a link):
//   root/work (W), root/extra (X), root/work2, root/outside
export function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "shell-"));
  const dirs = { root, W: join(root, "work"), X: join(root, "extra"), W2: join(root, "work2"), O: join(root, "outside") };
  for (const dir of [dirs.W, dirs.X, dirs.W2, dirs.O]) mkdirSync(dir);
  writeFileSync(join(dirs.W, "a.txt"), "A");
  writeFileSync(join(dirs.X, "x.txt"), "X");
  writeFileSync(join(dirs.W2, "a.txt"), "A2");
  writeFileSync(join(dirs.O, "secret.txt"), "SECRET");
  mkdirSync(join(dirs.O, "dir"));
  writeFileSync(join(dirs.O, "dir", "a.txt"), "OUT");
  const tree = {
    ...dirs,
    folders: [dirs.W, dirs.X],
    realW: realpathSync(dirs.W),
    realX: realpathSync(dirs.X),
    cleanup() {
      spawnSync("chmod", ["-R", "u+rwx", root]);
      rmSync(root, { recursive: true, force: true });
    },
  };
  return tree;
}

// A test that gets its own tree, removed at the end.
export function treeTest(name, fn, options) {
  test(
    name,
    options,
    async () => {
      const tree = makeTree();
      try {
        await fn(tree);
      } finally {
        tree.cleanup();
      }
    },
  );
}

// The ShellError a promise rejects with, after the checks every fault of the part has.
export async function fault(promise, message, outside = false) {
  let got;
  try {
    await promise;
  } catch (err) {
    got = err;
  }
  assert.ok(got, `expected a rejection with ${JSON.stringify(message)}, the promise resolved`);
  assert.ok(got instanceof ShellError, `expected a ShellError, got ${got && got.stack}`);
  assert.ok(got instanceof Error);
  assert.equal(got.name, "ShellError");
  assert.equal(got.outside, outside);
  assert.equal(got.message, message);
  return got;
}

// Runs `body` (the source of an async function of `{ m, args }`) in a fresh node process that imports the
// part, and gives what it returned. The child prints nothing of its own: its result goes through a file.
export function inChild(dir, body, args = {}) {
  const script = join(dir, `child-${Math.random().toString(36).slice(2)}.mjs`);
  const out = `${script}.out`;
  writeFileSync(
    script,
    `import { writeFileSync } from "node:fs";
const args = JSON.parse(process.argv[2]);
const run = async (args) => {
${body}
};
const result = await run(args);
writeFileSync(${JSON.stringify(out)}, JSON.stringify(result ?? null));
`,
  );
  const r = spawnSync(process.execPath, [script, JSON.stringify({ ...args, src: SRC_URL })], {
    encoding: "utf8",
    timeout: 30000,
  });
  const result = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : undefined;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, result };
}
