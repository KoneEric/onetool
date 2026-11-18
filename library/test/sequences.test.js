import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as lib from "../src/index.js";
import { deepFreeze, tmpRoot } from "./helpers.js";

const at = Date.UTC(2026, 10, 18, 10);

test("sequenceLine: the example of the meeting point", () => {
  assert.equal(
    lib.sequenceLine(["practice.rows", "practice.count"], { time: at, session: "s1" }),
    '{"time":"2026-11-18T10:00:00.000Z","session":"s1","sequence":["practice.rows","practice.count"]}',
  );
});

test("sequenceLine: the keys are time, session, sequence in that order; the time keeps its milliseconds", () => {
  const line = lib.sequenceLine(["a.b"], { time: Date.UTC(2026, 0, 2, 3, 4, 5, 123), session: "x" });
  assert.deepEqual(Object.keys(JSON.parse(line)), ["time", "session", "sequence"]);
  assert.equal(JSON.parse(line).time, "2026-01-02T03:04:05.123Z");
  assert.ok(line.indexOf('"time"') < line.indexOf('"session"'));
  assert.ok(line.indexOf('"session"') < line.indexOf('"sequence"'));
});

test("sequenceLine: one line, no line break in it or after it, whatever the session and the ids hold", () => {
  const sequence = ["my server.get-rows", 'q"uote.t', "back\\slash.t", "é.ü😀", "line\nbreak.t"];
  const line = lib.sequenceLine(sequence, { time: at, session: "a\nb\r\nc" });
  assert.equal(typeof line, "string");
  assert.equal(/[\r\n]/.test(line), false);
  assert.deepEqual(JSON.parse(line), { time: "2026-11-18T10:00:00.000Z", session: "a\nb\r\nc", sequence });
});

test("sequenceLine: a sequence of one item, and the same id twice", () => {
  assert.equal(
    lib.sequenceLine(["a.b"], { time: 0, session: "s" }),
    '{"time":"1970-01-01T00:00:00.000Z","session":"s","sequence":["a.b"]}',
  );
  assert.deepEqual(JSON.parse(lib.sequenceLine(["a.b", "a.b"], { time: 0, session: "s" })).sequence, ["a.b", "a.b"]);
});

test("sequenceLine: does not change its arguments", () => {
  const sequence = deepFreeze(["a.b", "c.d"]);
  const options = deepFreeze({ time: at, session: "s" });
  assert.deepEqual(JSON.parse(lib.sequenceLine(sequence, options)).sequence, ["a.b", "c.d"]);
});

test("readSequences: the lists of the lines, in the order of the lines", () => {
  const a = ["practice.rows", "practice.count"];
  const b = ["x.y"];
  const o = { time: at, session: "s" };
  assert.deepEqual(lib.readSequences(lib.sequenceLine(a, o) + "\n" + lib.sequenceLine(b, o) + "\n"), [a, b]);
  assert.deepEqual(lib.readSequences(lib.sequenceLine(b, o) + "\n" + lib.sequenceLine(a, o) + "\n"), [b, a]);
});

test("readSequences: a last line with no line break is read", () => {
  assert.deepEqual(lib.readSequences('{"sequence":["a.b"]}\n{"sequence":["c.d"]}'), [["a.b"], ["c.d"]]);
});

test("readSequences: an empty text, and a text that is not a string, give an empty list", () => {
  assert.deepEqual(lib.readSequences(""), []);
  assert.deepEqual(lib.readSequences("\n\n"), []);
  for (const text of [undefined, null, 5, {}, ["a"], true, Buffer.from('{"sequence":["a"]}')]) {
    assert.deepEqual(lib.readSequences(text), []);
  }
});

test("readSequences: every line that does not fit is passed over in silence, the others are kept", () => {
  const lines = [
    "",
    "   ",
    '{"time":"2026-11-18T10:00:00.000Z","session":"s","sequence":["a.b","c',
    "this is not JSON",
    "null",
    "5",
    '"a.b"',
    '["a.b"]',
    "[1]",
    '{"time":"x","session":"y"}',
    '{"sequence":[]}',
    '{"sequence":["a.b",5]}',
    '{"sequence":[5]}',
    '{"sequence":["a.b",null]}',
    '{"sequence":[["a.b"]]}',
    '{"sequence":"a.b"}',
    '{"sequence":null}',
    '{"sequence":{"0":"a.b"}}',
    '{"sequence":["ok.one"]}',
    "{",
    '{"sequence":["ok.two","ok.three"],"time":5,"extra":true}',
  ];
  assert.deepEqual(lib.readSequences(lines.join("\n")), [["ok.one"], ["ok.two", "ok.three"]]);
});

test("readSequences: time and session are not read, and a line may have neither", () => {
  assert.deepEqual(lib.readSequences('{"sequence":["a.b"]}\n{"session":5,"time":[],"sequence":["c.d"]}\n'), [["a.b"], ["c.d"]]);
});

test("readSequences: a final carriage return of a line does no harm", () => {
  assert.deepEqual(lib.readSequences('{"sequence":["a.b"]}\r\n{"sequence":["c.d"]}\r\n'), [["a.b"], ["c.d"]]);
});

test("readSequences: gives new lists, and a text of the same line twice gives it twice", () => {
  const line = lib.sequenceLine(["a.b"], { time: at, session: "s" });
  const got = lib.readSequences(`${line}\n${line}\n`);
  assert.deepEqual(got, [["a.b"], ["a.b"]]);
  assert.notEqual(got[0], got[1]);
  assert.notEqual(lib.readSequences(line), lib.readSequences(line));
});

test("readSequences: ids with spaces and non-ASCII characters are read as they were written", () => {
  const sequence = ["my server.get-rows", "é.ü😀", 'q"uote.t'];
  assert.deepEqual(lib.readSequences(lib.sequenceLine(sequence, { time: at, session: "é" }) + "\n"), [sequence]);
});

// The part prints nothing and keeps nothing alive: a process that uses the step 8 functions ends by itself, silent.
const SRC = pathToFileURL(join(import.meta.dirname, "..", "src", "index.js")).href;
const SCENARIO = `
const lib = await import(process.argv[1]);
const root = process.argv[2];
const folder = root + "/proj/.onetool/library";
const prog = { name: "a", about: "A.", params: [], code: "tools.p.q()\\n" };
await lib.saveProgram(folder, prog, { now: 0 });
await lib.removeProgram(folder, "a", { now: 1 });
await lib.restoreProgram(folder, "a", { cap: 2 });
await lib.restoreProgram(folder, "a");
await lib.restoreProgram(folder, "zz");
await lib.restoreProgram(folder + "/a.js/inner", "a").catch(() => {});
const line = lib.sequenceLine(["p.q"], { time: 0, session: "s" });
lib.readSequences(line + "\\n{");
lib.reportText((await lib.readLibrary(folder)).programs.map((p) => ({ ...p, where: "user" })), { sequences: [["p.q"]], now: 5 });
lib.reportText([]);
lib.logArgs("report", {}); lib.logArgs("restore", { name: "a" }); lib.logArgs("read", { name: "a" });
`;

test("the step 8 functions print nothing, and a process that used them ends by itself", (t) => {
  const root = tmpRoot(t);
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", SCENARIO, SRC, root], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "");
});
