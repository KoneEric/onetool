// Helpers of the tests of "Step 4: the record of every call" (the meeting point of server): settings with a log folder, the log
// read back, and the trail cut from an answer. The file names and the line keys are those of the meeting point of core,
// "Step 4: the log: `shellLogArgs`, `logLine`, `logFileName`".
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { settingsOf } from "./helpers.js";

export const KEYS = ["time", "session", "id", "args", "decision", "ms", "size", "fault"];
export const FILE_NAME = /^calls-\d{4}-\d{2}-\d{2}\.jsonl$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Settings with the log folder `L`; `onetool` holds the other keys of `onetool` (the trail is off unless said). */
export function logSettings(L, servers, onetool = {}) {
  return settingsOf(servers, { trail: false, logFolder: L, ...onetool });
}

/** The names of the files of the folder `L`, sorted; `[]` when it is not there. */
export function logFiles(L) {
  return existsSync(L) ? readdirSync(L).sort() : [];
}

/** Every line of every file of `L` read together, as parsed objects, in the order of the file names. */
export function logEntries(L) {
  const entries = [];
  for (const name of logFiles(L)) {
    for (const line of readFileSync(join(L, name), "utf8").split("\n")) {
      if (line === "") continue;
      entries.push(JSON.parse(line));
    }
  }
  return entries;
}

/** The whole text of the files of `L`. */
export function logText(L) {
  return logFiles(L).map((name) => readFileSync(join(L, name), "utf8")).join("");
}

/** The entries of `L` of the call `id`. */
export const entriesOf = (L, id) => logEntries(L).filter((entry) => entry.id === id);

/** One entry is exactly one record of the log, with the eight keys in their order. */
export function assertShape(entry) {
  assert.deepEqual(Object.keys(entry), KEYS);
  assert.equal(typeof entry.time, "string");
  assert.equal(new Date(entry.time).toISOString(), entry.time);
  assert.match(entry.session, UUID);
  assert.equal(typeof entry.id, "string");
  assert.equal(typeof entry.decision, "string");
  assert.ok(Number.isInteger(entry.ms) && entry.ms >= 0, `ms is a whole number of 0 or more: ${entry.ms}`);
  assert.ok(entry.size === null || Number.isInteger(entry.size));
  assert.ok(entry.fault === null || typeof entry.fault === "string");
}

/** The answer of `run` split in what the program said and its trail: the text before "--- calls ---", the lines after. */
export function splitTrail(text) {
  const at = text.indexOf("\n--- calls ---\n");
  if (at < 0) return { body: text, lines: null };
  return { body: text.slice(0, at), lines: text.slice(at + 1).split("\n") };
}

/** The line of a trail for `id`, as a pattern: `<id> <ms> ms <rest>`. */
export const trailLine = (id, rest) => new RegExp(`^${id.replace(/\./g, "\\.")} \\d+ ms ${rest}$`);

/** The lines of a trail (after its header) match `rests`, a list of [id, rest] in order. */
export function assertTrail(lines, rests) {
  assert.ok(lines, "the answer has a trail");
  assert.equal(lines[0], "--- calls ---");
  assert.equal(lines.length, rests.length + 1, `the trail has ${rests.length} lines: ${JSON.stringify(lines)}`);
  rests.forEach(([id, rest], at) => assert.match(lines[at + 1], trailLine(id, rest)));
}

/** The date a record of today is filed under, by the rule of `logFileName` (UTC, the first ten characters). */
export const todayFile = () => `calls-${new Date().toISOString().slice(0, 10)}.jsonl`;
