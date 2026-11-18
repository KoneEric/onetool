import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readSettings, SettingsError } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "core-test-"));
let counter = 0;
process.on("exit", () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

export function tmpPath(name = `f${counter++}.json`) {
  return join(dir, name);
}

/** Writes `content` (a string, or a value turned into JSON) to a new file and gives its path. */
export function writeSettings(content) {
  const path = tmpPath();
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content), "utf8");
  return path;
}

/** The settings read from a file holding `content`. */
export function settingsOf(content) {
  return readSettings(writeSettings(content));
}

/** The SettingsError thrown when `content` is read; fails when nothing is thrown. */
export function faultOf(content) {
  return faultAt(writeSettings(content));
}

export function faultAt(path) {
  try {
    readSettings(path);
  } catch (err) {
    assert.ok(err instanceof SettingsError, `expected a SettingsError, got ${err}`);
    return err;
  }
  assert.fail("expected readSettings to throw");
}

/** Freezes a value and everything inside it, to prove a function does not change its arguments. */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** Runs `fn` with console silenced and recorded; gives what was printed. */
export function printedBy(fn) {
  const names = ["log", "info", "warn", "error", "debug"];
  const saved = {};
  const printed = [];
  for (const name of names) {
    saved[name] = console[name];
    console[name] = (...args) => printed.push([name, ...args]);
  }
  try {
    fn();
  } finally {
    for (const name of names) console[name] = saved[name];
  }
  return printed;
}
