import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Two instants worked out by hand: 2026-11-18 10:00:00.000 UTC, and the same one as the archive writes it.
export const NOW = Date.UTC(2026, 10, 18, 10, 0, 0, 0);
export const ISO = "2026-11-18T10:00:00.000Z";
export const STAMP = "2026-11-18T10-00-00-000Z";

// A folder made in the system's temporary folder, removed when the test ends.
export function tmpRoot(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "library-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// The library folder of a test, `<root>/proj/.onetool/library`; its archive is `<root>/proj/.onetool/archive`.
export const libraryIn = (root) => join(root, "proj", ".onetool", "library");
export const archiveIn = (root) => join(root, "proj", ".onetool", "archive");

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// The text of a program file, written by hand here and not by the code under test.
export function fileText({ about = "About it.", params = [], code = "1 + 1\n" } = {}) {
  const list = params.join(", ");
  return `// about: ${about}\n// params:${list === "" ? "" : " " + list}\n${code}`;
}

export function put(folder, name, fields = {}) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.js`), fileText(fields));
}

export function putStats(folder, stats) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "stats.json"), JSON.stringify(stats));
}

export const readStats = (folder) => JSON.parse(readFileSync(join(folder, "stats.json"), "utf8"));
export const readText = (path) => readFileSync(path, "utf8");

// The sorted entries of a folder, or null when it is not there.
export function list(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return null;
  }
}

// A program as `readLibrary` gives it.
export function program(name, over = {}) {
  return {
    name,
    about: `About ${name}.`,
    params: [],
    code: "1\n",
    uses: 0,
    lastUse: null,
    failures: 0,
    ...over,
  };
}

// A program as `checkSave` gives it.
export const toSave = (name, over = {}) => ({
  name,
  about: `About ${name}.`,
  params: [],
  code: "1\n",
  ...over,
});
