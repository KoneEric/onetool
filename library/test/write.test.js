import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as lib from "../src/index.js";
import { ISO, NOW, STAMP, archiveIn, deepFreeze, fileText, libraryIn, list, put, putStats, readStats, readText, toSave, tmpRoot } from "./helpers.js";

const CANNOT = "the library cannot be written";

const cannotBeWritten = (err) => {
  assert.ok(err instanceof lib.LibraryError, "a LibraryError");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "LibraryError");
  assert.equal(err.message, CANNOT);
  return true;
};

// The entries of the archive folder, or [] when it is not there.
const archived = (root) => list(archiveIn(root)) ?? [];

// The instant a stamp of an archived name says, in milliseconds.
const stampTime = (file, name) => {
  const m = new RegExp(`^${name}\\.(\\d{4}-\\d\\d-\\d\\d)T(\\d\\d)-(\\d\\d)-(\\d\\d)-(\\d{3})Z\\.js$`).exec(file);
  assert.ok(m, `${file} is an archived name`);
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
};

test("saveProgram: a library folder that is not there is made, with the folders above it", async (t) => {
  const root = tmpRoot(t);
  const folder = join(root, "deep", "er", "and deeper", ".onetool", "library");
  const got = await lib.saveProgram(folder, toSave("cityCount", { about: "Counts.", params: ["city"], code: "rows\n" }), { now: NOW });
  assert.equal(got, undefined);
  assert.deepEqual(list(folder), ["cityCount.js", "stats.json"]);
  assert.equal(readText(join(folder, "cityCount.js")), "// about: Counts.\n// params: city\nrows\n");
  assert.deepEqual(readStats(folder), { cityCount: { uses: 0, lastUse: null, failures: 0 } });
});

test("saveProgram: no params and a code without a final newline", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  await lib.saveProgram(folder, toSave("a", { about: "A é.", params: [], code: "x + 1" }), { now: NOW });
  assert.equal(readText(join(folder, "a.js")), "// about: A é.\n// params:\nx + 1\n");
});

test("saveProgram: a folder with spaces and non-ASCII characters is a folder like any other", async (t) => {
  const folder = join(tmpRoot(t), "my lib é ü", "library");
  await lib.saveProgram(folder, toSave("a"), { now: NOW });
  assert.deepEqual(list(folder), ["a.js", "stats.json"]);
});

test("saveProgram: it is read back by readLibrary", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  await lib.saveProgram(folder, toSave("b", { about: "B.", params: ["x", "y"], code: "x + y" }), { now: NOW });
  await lib.saveProgram(folder, toSave("a", { about: "A.", params: [], code: "1\n" }), { now: NOW });
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got, {
    programs: [
      { name: "a", about: "A.", params: [], code: "1\n", uses: 0, lastUse: null, failures: 0 },
      { name: "b", about: "B.", params: ["x", "y"], code: "x + y\n", uses: 0, lastUse: null, failures: 0 },
    ],
    bad: [],
  });
});

test("saveProgram: replaces another name: its file goes to the archive, its counts to the new program", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "old", { about: "Old one.", code: "tools.x.y()\n" });
  put(folder, "other", { about: "Other." });
  putStats(folder, {
    old: { uses: 7, lastUse: ISO, failures: 3 },
    other: { uses: 2, lastUse: ISO, failures: 1 },
  });
  const oldText = fileText({ about: "Old one.", code: "tools.x.y()\n" });
  const got = await lib.saveProgram(folder, toSave("new", { about: "New one.", code: "tools.x.y()\n" }), { replaces: "old", now: NOW });
  assert.equal(got, undefined);
  assert.deepEqual(list(folder), ["new.js", "other.js", "stats.json"]);
  assert.equal(readText(join(folder, "new.js")), "// about: New one.\n// params:\ntools.x.y()\n");
  assert.deepEqual(archived(root), [`old.${STAMP}.js`]);
  assert.equal(readText(join(archiveIn(root), `old.${STAMP}.js`)), oldText);
  const stats = readStats(folder);
  assert.deepEqual(stats, {
    new: { uses: 7, lastUse: ISO, failures: 0 },
    other: { uses: 2, lastUse: ISO, failures: 1 },
  });
  assert.deepEqual(Object.keys(stats), ["new", "other"]);
});

test("saveProgram: replaces its own name: the old file is archived, the new one written", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a", { about: "Before.", code: "1\n" });
  putStats(folder, { a: { uses: 7, lastUse: ISO, failures: 3 } });
  await lib.saveProgram(folder, toSave("a", { about: "After.", code: "2\n" }), { replaces: "a", now: NOW });
  assert.equal(readText(join(folder, "a.js")), "// about: After.\n// params:\n2\n");
  assert.deepEqual(archived(root), [`a.${STAMP}.js`]);
  assert.equal(readText(join(archiveIn(root), `a.${STAMP}.js`)), fileText({ about: "Before.", code: "1\n" }));
  assert.deepEqual(readStats(folder), { a: { uses: 7, lastUse: ISO, failures: 0 } });
  assert.deepEqual(list(folder), ["a.js", "stats.json"]);
});

test("saveProgram: a replaced program with no entry in stats.json passes on 0 and null", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "old");
  await lib.saveProgram(folder, toSave("new"), { replaces: "old", now: NOW });
  assert.deepEqual(archived(root), [`old.${STAMP}.js`]);
  assert.deepEqual(readStats(folder), { new: { uses: 0, lastUse: null, failures: 0 } });
});

test("saveProgram: replaces names a program with no file: nothing is moved", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "other");
  putStats(folder, { other: { uses: 2, lastUse: ISO, failures: 1 } });
  await lib.saveProgram(folder, toSave("new"), { replaces: "ghost", now: NOW });
  assert.deepEqual(archived(root), []);
  assert.deepEqual(list(folder), ["new.js", "other.js", "stats.json"]);
  const stats = readStats(folder);
  assert.deepEqual(stats.new, { uses: 0, lastUse: null, failures: 0 });
  assert.deepEqual(stats.other, { uses: 2, lastUse: ISO, failures: 1 });
});

test("saveProgram: a file of the same name without replaces is written over, its counts start again", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a", { about: "Before.", code: "1\n" });
  putStats(folder, { a: { uses: 5, lastUse: ISO, failures: 2 } });
  await lib.saveProgram(folder, toSave("a", { about: "After.", code: "2\n" }), { now: NOW });
  assert.equal(readText(join(folder, "a.js")), "// about: After.\n// params:\n2\n");
  assert.deepEqual(readStats(folder), { a: { uses: 0, lastUse: null, failures: 0 } });
  assert.deepEqual(archived(root), []);
});

test("saveProgram: replaces null and omitted options are the defaults", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "old");
  await lib.saveProgram(folder, toSave("a"), { replaces: null, now: NOW });
  await lib.saveProgram(folder, toSave("b"));
  await lib.saveProgram(folder, toSave("c"), {});
  assert.deepEqual(list(folder), ["a.js", "b.js", "c.js", "old.js", "stats.json"]);
  assert.deepEqual(archived(root), []);
});

test("saveProgram: the other keys of the program are not read", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  await lib.saveProgram(folder, toSave("a", { uses: 99, failures: 4, lastUse: 5, where: "user" }), { now: NOW });
  assert.equal(readText(join(folder, "a.js")), "// about: About a.\n// params:\n1\n");
  assert.deepEqual(readStats(folder), { a: { uses: 0, lastUse: null, failures: 0 } });
});

test("saveProgram: the stamp is `now` with : and . replaced by -, and now defaults to the clock at the call", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "old");
  const before = Date.now();
  await lib.saveProgram(folder, toSave("new"), { replaces: "old" });
  const after = Date.now();
  const [file] = archived(root);
  const at = stampTime(file, "old");
  assert.ok(at >= before && at <= after, `${at} is within ${before}..${after}`);
});

test("saveProgram: does not change its arguments", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  const prog = deepFreeze(toSave("a", { params: ["x"] }));
  await lib.saveProgram(folder, prog, deepFreeze({ replaces: null, now: NOW }));
  assert.deepEqual(list(folder), ["a.js", "stats.json"]);
});

test("saveProgram: a folder that cannot be made rejects with a LibraryError and no path", async (t) => {
  const root = tmpRoot(t);
  writeFileSync(join(root, "afile"), "x");
  await assert.rejects(lib.saveProgram(join(root, "afile", "lib"), toSave("a"), { now: NOW }), cannotBeWritten);
});

test("saveProgram: a file that cannot be written rejects, and the archive move already done stays done", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "old", { about: "Old." });
  mkdirSync(join(folder, "new.js"));
  await assert.rejects(lib.saveProgram(folder, toSave("new"), { replaces: "old", now: NOW }), cannotBeWritten);
  assert.equal(existsSync(join(folder, "old.js")), false);
  assert.deepEqual(archived(root), [`old.${STAMP}.js`]);
  assert.equal(readText(join(archiveIn(root), `old.${STAMP}.js`)), fileText({ about: "Old." }));
});

test("saveProgram: a file that cannot be moved rejects, and the old file stays", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "old", { about: "Old." });
  writeFileSync(archiveIn(root), "the archive is a file");
  await assert.rejects(lib.saveProgram(folder, toSave("new"), { replaces: "old", now: NOW }), cannotBeWritten);
  assert.equal(readText(join(folder, "old.js")), fileText({ about: "Old." }));
});

test("removeProgram: moves the file to the archive and removes its entry", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a", { about: "Gone.", code: "tools.x.y()\n" });
  put(folder, "b");
  putStats(folder, { a: { uses: 3, lastUse: ISO, failures: 1 }, b: { uses: 2, lastUse: ISO, failures: 0 } });
  assert.equal(await lib.removeProgram(folder, "a", { now: NOW }), true);
  assert.deepEqual(list(folder), ["b.js", "stats.json"]);
  assert.deepEqual(archived(root), [`a.${STAMP}.js`]);
  assert.equal(readText(join(archiveIn(root), `a.${STAMP}.js`)), fileText({ about: "Gone.", code: "tools.x.y()\n" }));
  assert.deepEqual(readStats(folder), { b: { uses: 2, lastUse: ISO, failures: 0 } });
});

test("removeProgram: gives false for a program that is not there, and the others stay", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "b");
  assert.equal(await lib.removeProgram(folder, "a", { now: NOW }), false);
  assert.equal(existsSync(join(folder, "b.js")), true);
  assert.deepEqual(archived(root), []);
});

test("removeProgram: a folder that is not there gives false and is not made", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  assert.equal(await lib.removeProgram(folder, "a", { now: NOW }), false);
  assert.equal(existsSync(folder), false);
  assert.equal(existsSync(archiveIn(root)), false);
});

test("removeProgram: a name that is not a program name gives false and nothing is touched", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a");
  // a file that "../beside" would reach from the library folder
  const beside = join(dirname(folder), "beside.js");
  writeFileSync(beside, fileText());
  for (const name of ["../beside", "a/../a", "", "a.js", "1a", undefined, null, 5, {}]) {
    assert.equal(await lib.removeProgram(folder, name, { now: NOW }), false, String(name));
  }
  assert.equal(existsSync(beside), true);
  assert.deepEqual(list(folder), ["a.js"]);
  assert.equal(existsSync(archiveIn(root)), false);
});

test("removeProgram: a move the system refuses rejects with a LibraryError", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a");
  writeFileSync(archiveIn(root), "the archive is a file");
  await assert.rejects(lib.removeProgram(folder, "a", { now: NOW }), cannotBeWritten);
  assert.equal(existsSync(join(folder, "a.js")), true);
});

test("removeProgram: now defaults to the clock at the call", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  put(folder, "a");
  const before = Date.now();
  assert.equal(await lib.removeProgram(folder, "a"), true);
  const after = Date.now();
  const at = stampTime(archived(root)[0], "a");
  assert.ok(at >= before && at <= after);
});

test("removeProgram: a program saved again can be removed again, each archived under its own stamp", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  await lib.saveProgram(folder, toSave("a", { about: "One." }), { now: NOW });
  await lib.removeProgram(folder, "a", { now: NOW });
  await lib.saveProgram(folder, toSave("a", { about: "Two." }), { now: NOW + 1000 });
  await lib.removeProgram(folder, "a", { now: NOW + 1000 });
  assert.deepEqual(archived(root), [`a.${STAMP}.js`, "a.2026-11-18T10-00-01-000Z.js"]);
  assert.equal(readText(join(archiveIn(root), `a.${STAMP}.js`)), "// about: One.\n// params:\n1\n");
  assert.equal(readText(join(archiveIn(root), "a.2026-11-18T10-00-01-000Z.js")), "// about: Two.\n// params:\n1\n");
});
