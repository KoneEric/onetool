import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as lib from "../src/index.js";
import { ISO, NOW, STAMP, archiveIn, deepFreeze, fileText, libraryIn, list, put, putStats, readStats, readText, tmpRoot } from "./helpers.js";

const archived = (root) => list(archiveIn(root)) ?? [];
const call = (name, ok) => ({ name, ok });

test("noteUses: counts the items per name, lastUse is now, failures by the order of the items", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "alpha");
  put(folder, "beta");
  put(folder, "gamma");
  putStats(folder, {
    alpha: { uses: 3, lastUse: null, failures: 2 },
    gamma: { uses: 5, lastUse: "2026-01-01T00:00:00.000Z", failures: 1 },
  });
  const uses = [call("alpha", false), call("beta", true), call("alpha", false), call("alpha", true), call("alpha", false)];
  // alpha: failures 2, then +1 = 3, +1 = 4, ok = 0, +1 = 1; uses 3 + 4 = 7
  const got = await lib.noteUses(folder, uses, { now: NOW });
  assert.deepEqual(got, []);
  assert.deepEqual(readStats(folder), {
    alpha: { uses: 7, lastUse: ISO, failures: 1 },
    beta: { uses: 1, lastUse: ISO, failures: 0 },
    gamma: { uses: 5, lastUse: "2026-01-01T00:00:00.000Z", failures: 1 },
  });
  assert.deepEqual(Object.keys(readStats(folder)), ["alpha", "beta", "gamma"]);
  assert.deepEqual(list(folder), ["alpha.js", "beta.js", "gamma.js", "stats.json"]);
});

test("noteUses: stats.json is made when it is not there", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  assert.deepEqual(await lib.noteUses(folder, [call("a", true)], { now: NOW }), []);
  assert.deepEqual(readStats(folder), { a: { uses: 1, lastUse: ISO, failures: 0 } });
});

test("noteUses: a name with no file is passed over, and an entry with no file is dropped when stats.json is written", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  put(folder, "b");
  putStats(folder, { a: { uses: 1, lastUse: ISO, failures: 0 }, b: { uses: 4, lastUse: ISO, failures: 0 }, orphan: { uses: 9, lastUse: ISO, failures: 9 } });
  assert.deepEqual(await lib.noteUses(folder, [call("ghost", false), call("a", true), call("ghost", false)], { now: NOW }), []);
  assert.deepEqual(readStats(folder), {
    a: { uses: 2, lastUse: ISO, failures: 0 },
    b: { uses: 4, lastUse: ISO, failures: 0 },
  });
});

test("noteUses: the default limit is 5: failures reaching 5 move the program to the archive", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "alpha", { about: "Fails." });
  put(folder, "beta");
  put(folder, "gamma");
  putStats(folder, {
    alpha: { uses: 10, lastUse: ISO, failures: 4 },
    beta: { uses: 10, lastUse: ISO, failures: 3 },
    gamma: { uses: 10, lastUse: ISO, failures: 4 },
  });
  const got = await lib.noteUses(folder, [call("alpha", false), call("beta", false)], { now: NOW });
  assert.deepEqual(got, ["alpha"]);
  assert.deepEqual(list(folder), ["beta.js", "gamma.js", "stats.json"]);
  assert.deepEqual(archived(root), [`alpha.${STAMP}.js`]);
  assert.equal(readText(join(archiveIn(root), `alpha.${STAMP}.js`)), fileText({ about: "Fails." }));
  assert.deepEqual(readStats(folder), {
    beta: { uses: 11, lastUse: ISO, failures: 4 },
    gamma: { uses: 10, lastUse: ISO, failures: 4 },
  });
});

test("noteUses: failuresLimit is inclusive and can be set", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "one");
  put(folder, "two");
  putStats(folder, { one: { uses: 0, lastUse: null, failures: 1 }, two: { uses: 0, lastUse: null, failures: 0 } });
  // one: 1 + 1 = 2 = the limit, moved; two: 0 + 1 = 1 < 2, kept
  const got = await lib.noteUses(folder, [call("one", false), call("two", false)], { now: NOW, failuresLimit: 2 });
  assert.deepEqual(got, ["one"]);
  assert.deepEqual(list(folder), ["stats.json", "two.js"]);
  assert.deepEqual(readStats(folder), { two: { uses: 1, lastUse: ISO, failures: 1 } });
});

test("noteUses: a limit of 1 moves a program whose last item failed, not one that ended with an ok", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "bad");
  put(folder, "fine");
  const got = await lib.noteUses(folder, [call("bad", true), call("bad", false), call("fine", false), call("fine", true)], { now: NOW, failuresLimit: 1 });
  assert.deepEqual(got, ["bad"]);
  assert.deepEqual(list(folder), ["fine.js", "stats.json"]);
  assert.deepEqual(readStats(folder), { fine: { uses: 2, lastUse: ISO, failures: 0 } });
});

test("noteUses: the names moved are in the order of the names", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  for (const n of ["beta", "alpha", "Zed", "gamma"]) put(folder, n);
  const got = await lib.noteUses(folder, [call("gamma", false), call("beta", false), call("Zed", false), call("alpha", true)], { now: NOW, failuresLimit: 1 });
  assert.deepEqual(got, ["Zed", "beta", "gamma"]);
  assert.deepEqual(archived(root), [`Zed.${STAMP}.js`, `beta.${STAMP}.js`, `gamma.${STAMP}.js`]);
  assert.deepEqual(list(folder), ["alpha.js", "stats.json"]);
});

test("noteUses: an empty list or a folder that is not there writes nothing and gives []", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  assert.deepEqual(await lib.noteUses(folder, [call("a", true)], { now: NOW }), []);
  assert.equal(existsSync(folder), false);
  assert.equal(existsSync(archiveIn(root)), false);
  put(folder, "a");
  const stats = '{"a":{"uses":1,"lastUse":null,"failures":0},"orphan":{"uses":1,"lastUse":null,"failures":0}}';
  writeFileSync(join(folder, "stats.json"), stats);
  assert.deepEqual(await lib.noteUses(folder, [], { now: NOW }), []);
  assert.equal(readFileSync(join(folder, "stats.json"), "utf8"), stats);
});

test("noteUses: never rejects: a stats.json that cannot be written is left undone", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  mkdirSync(join(folder, "stats.json"));
  assert.deepEqual(await lib.noteUses(folder, [call("a", true)], { now: NOW }), []);
  assert.equal(readText(join(folder, "a.js")), fileText());
});

test("noteUses: never rejects: a file that cannot be moved stays, and its name is not in the result", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a");
  putStats(folder, { a: { uses: 0, lastUse: null, failures: 4 } });
  writeFileSync(archiveIn(root), "the archive is a file");
  assert.deepEqual(await lib.noteUses(folder, [call("a", false)], { now: NOW }), []);
  assert.equal(readText(join(folder, "a.js")), fileText());
});

test("noteUses: now defaults to the clock at the call", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  const before = Date.now();
  await lib.noteUses(folder, [call("a", true)]);
  const after = Date.now();
  const at = Date.parse(readStats(folder).a.lastUse);
  assert.ok(at >= before && at <= after);
});

test("noteUses: what it counts readLibrary gives back", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  await lib.noteUses(folder, [call("a", true), call("a", false)], { now: NOW });
  const [one] = (await lib.readLibrary(folder)).programs;
  assert.deepEqual([one.uses, one.lastUse, one.failures], [2, NOW, 1]);
});

test("noteUses: does not change its arguments", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  const uses = deepFreeze([call("a", true), call("a", false)]);
  await lib.noteUses(folder, uses, deepFreeze({ now: NOW, failuresLimit: 3 }));
  assert.deepEqual(readStats(folder), { a: { uses: 2, lastUse: ISO, failures: 1 } });
});
