import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

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

// Every live process on the machine, except zombies, processes caught while they exit (macOS shows a killed
// one for a moment with a stat like `?NE`), and the `ps` that lists them.
export function psRows() {
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,ppid=,stat=,command="], { encoding: "utf8" });
  return r.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], command: m[4] }))
    .filter((row) => row.pid !== r.pid && !/^[Z?]/.test(row.stat) && !row.stat.includes("E"));
}

// The processes this process started and that still run.
export function childRows() {
  return psRows().filter((row) => row.ppid === process.pid);
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The environment of a live process of this user as text, or null where the platform does not show it.
export function environmentOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/environ`, "latin1");
  } catch {
    // not Linux
  }
  const r = spawnSync("ps", ["-E", "-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

const KEYS_OK = ["logs", "ok", "value"];
const KEYS_FAIL = ["error", "logs", "ok"];

export function expectOk(result, value, logs = []) {
  assert.deepStrictEqual(Object.keys(result).sort(), KEYS_OK);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value, value);
  assert.deepStrictEqual(result.logs, logs);
}

// `message` is a string (exact) or a RegExp.
export function expectFail(result, kind, message, logs) {
  assert.deepStrictEqual(Object.keys(result).sort(), KEYS_FAIL);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(Object.keys(result.error).sort(), ["kind", "message"]);
  assert.strictEqual(result.error.kind, kind);
  assert.strictEqual(typeof result.error.message, "string");
  if (message instanceof RegExp) assert.match(result.error.message, message);
  else if (message !== undefined) assert.strictEqual(result.error.message, message);
  assert.ok(Array.isArray(result.logs) && result.logs.every((l) => typeof l === "string"));
  if (logs !== undefined) assert.deepStrictEqual(result.logs, logs);
}

// A stand-in for `callTool`: records the calls, answers with `impl`.
export function recorder(impl = async () => null) {
  const calls = [];
  const fn = async (...args) => {
    calls.push(args);
    return impl(...args);
  };
  fn.calls = calls;
  return fn;
}
