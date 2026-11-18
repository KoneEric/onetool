import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as lib from "../src/index.js";
import { ISO, archiveIn, fileText, libraryIn, list, put, putStats, readText, tmpRoot } from "./helpers.js";

const P1 = "library.restore failed: the name must be 1 to 40 letters, digits or _, starting with a letter";
const missingP = (n) => `library.restore failed: no program named ${n} is in the archive`;
const sameP = (n) => `library.restore failed: a program named ${n} is saved already: remove it first`;
const twinP = (n, twin) => `library.restore failed: the name ${n} differs from the saved program ${twin} only by case`;
const fullP = (n, cap) =>
  `library.restore failed: the library holds ${n} programs, the limit is ${cap} (onetool.libraryCap). Remove one with library.remove(name) first.`;
const notProgramP = (n) => `library.restore failed: the archived file of ${n} is not a saved program`;

const refused = (got, missing, problem) => assert.deepEqual(got, { restored: false, missing, problem });

// Stamps worked out by hand, as `new Date(ms).toISOString()` with `:` and `.` replaced by `-`.
const S1 = "2026-11-17T09-30-00-000Z";
const S2 = "2026-11-18T10-00-00-000Z";
const S3 = "2026-11-18T10-00-00-001Z";

const archiveOf = (folder) => join(dirname(folder), "archive");
const archived = (folder) => list(archiveOf(folder)) ?? [];
const putArchived = (folder, name, stamp, text) => {
  mkdirSync(archiveOf(folder), { recursive: true });
  writeFileSync(join(archiveOf(folder), `${name}.${stamp}.js`), text);
};

const cannotBeWritten = (err) => {
  assert.ok(err instanceof lib.LibraryError, "a LibraryError");
  assert.equal(err.name, "LibraryError");
  assert.equal(err.message, "the library cannot be written");
  return true;
};

test("restoreProgram: a name that is not a program name is refused first, nothing moved", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  for (const bad of ["1a", "a-b", "a b", "é"]) putArchived(folder, bad, S1, fileText());
  putArchived(folder, "a".repeat(41), S1, fileText());
  const before = archived(folder);
  for (const name of ["", "a b", "a.b", "a-b", "1a", "é", "a".repeat(41), undefined, null, 5, {}, ["a"]]) {
    refused(await lib.restoreProgram(folder, name), false, P1);
  }
  assert.deepEqual(archived(folder), before);
  assert.equal(existsSync(join(folder, "a-b.js")), false);
  assert.equal(existsSync(join(folder, "1a.js")), false);
});

test("restoreProgram: no archive folder, an empty one, or one that cannot be listed: missing, true", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  refused(await lib.restoreProgram(folder, "nope"), true, "library.restore failed: no program named nope is in the archive");
  mkdirSync(archiveOf(folder), { recursive: true });
  refused(await lib.restoreProgram(folder, "nope"), true, missingP("nope"));
  const other = libraryIn(join(root, "second"));
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(archiveOf(other), "a file where the archive should be");
  refused(await lib.restoreProgram(other, "nope"), true, missingP("nope"));
});

test("restoreProgram: an archived file of the name is `<name>.<stamp>.js` with that stamp, name counted exactly", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  const text = fileText();
  putArchived(folder, "citycount", S1, text); // another case
  putArchived(folder, "cityCountry", S1, text);
  putArchived(folder, "xcityCount", S1, text);
  for (const odd of [
    "cityCount.2026-11-18.js",
    `cityCount.${S1}.txt`,
    `cityCount.${S1}.js.bak`,
    `cityCount.${S1}x.js`,
    `cityCount.${S1}.old.js`,
    "cityCount.2026-11-18T10-00-00-00Z.js",
    "cityCount.2026-11-18T10-00-00-0000Z.js",
    "cityCount.js",
    "cityCount..js",
    "cityCount.x.js",
    `cityCount${S1}.js`,
  ]) {
    writeFileSync(join(archiveOf(folder), odd), text);
  }
  const before = archived(folder);
  refused(await lib.restoreProgram(folder, "cityCount"), true, missingP("cityCount"));
  refused(await lib.restoreProgram(folder, "city"), true, missingP("city"));
  refused(await lib.restoreProgram(folder, "a"), true, missingP("a"));
  assert.deepEqual(archived(folder), before);
  assert.equal(existsSync(join(folder, "cityCount.js")), false);
});

test("restoreProgram: an archived name of another program with dots in it is not of a shorter name", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  putArchived(folder, "a.b", S1, fileText());
  refused(await lib.restoreProgram(folder, "a"), true, missingP("a"));
});

test("restoreProgram: test 2 comes before test 3: a saved program with nothing in the archive is `missing`", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "cityCount");
  refused(await lib.restoreProgram(folder, "cityCount"), true, missingP("cityCount"));
});

test("restoreProgram: a program of that name is saved already (test 3, before the cap), nothing moved", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "cityCount", { about: "The saved one.", code: "saved()\n" });
  putArchived(folder, "cityCount", S1, fileText({ about: "The archived one." }));
  const before = archived(folder);
  refused(await lib.restoreProgram(folder, "cityCount"), false, sameP("cityCount"));
  refused(await lib.restoreProgram(folder, "cityCount", { cap: 1 }), false, sameP("cityCount"));
  assert.deepEqual(archived(folder), before);
  assert.equal(readText(join(folder, "cityCount.js")), fileText({ about: "The saved one.", code: "saved()\n" }));
});

test("restoreProgram: a name that differs only by case from a saved program (test 4, before the cap)", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "citycount");
  putArchived(folder, "cityCount", S1, fileText());
  const before = archived(folder);
  refused(await lib.restoreProgram(folder, "cityCount"), false, twinP("cityCount", "citycount"));
  refused(await lib.restoreProgram(folder, "cityCount", { cap: 1 }), false, twinP("cityCount", "citycount"));
  assert.deepEqual(archived(folder), before);
});

test("restoreProgram: a twin with another case in the other direction", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "FOO");
  putArchived(folder, "foo", S1, fileText());
  refused(await lib.restoreProgram(folder, "foo"), false, twinP("foo", "FOO"));
});

test("restoreProgram: exactly cap programs refuse (test 5, before test 6), fewer than cap do not", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "one");
  put(folder, "two");
  putArchived(folder, "cityCount", S1, "not a program file at all\n");
  refused(await lib.restoreProgram(folder, "cityCount", { cap: 2 }), false, fullP(2, 2));
  const second = libraryIn(tmpRoot(t));
  put(second, "one");
  putArchived(second, "cityCount", S1, fileText());
  refused(await lib.restoreProgram(second, "cityCount", { cap: 1 }), false, fullP(1, 1));
  assert.equal(existsSync(join(second, "cityCount.js")), false);
  assert.deepEqual(archived(second), [`cityCount.${S1}.js`]);
  const third = libraryIn(tmpRoot(t));
  put(third, "one");
  put(third, "two");
  putArchived(third, "cityCount", S1, fileText());
  const got = await lib.restoreProgram(third, "cityCount", { cap: 3 });
  assert.deepEqual(got, { restored: true, file: `cityCount.${S1}.js` });
});

test("restoreProgram: cap is 50 when it is not passed", async (t) => {
  const full = libraryIn(tmpRoot(t));
  for (let i = 0; i < 50; i++) put(full, `p${i}`);
  putArchived(full, "extra", S1, fileText());
  refused(await lib.restoreProgram(full, "extra"), false, fullP(50, 50));
  refused(await lib.restoreProgram(full, "extra", {}), false, fullP(50, 50));
  const room = libraryIn(tmpRoot(t));
  for (let i = 0; i < 49; i++) put(room, `p${i}`);
  putArchived(room, "extra", S1, fileText());
  assert.deepEqual(await lib.restoreProgram(room, "extra"), { restored: true, file: `extra.${S1}.js` });
});

test("restoreProgram: the newest archived file that is not a saved program refuses, and an older one is not taken", async (t) => {
  const junk = [
    "",
    "hello\n",
    "// about: A.\n// params:",
    "// about: \n// params:\nx\n",
    "// about: A.\n// params: a, a\nx\n",
    "// about: A.\n// params:\n   \n",
    "// params:\n// about: A.\nx\n",
  ];
  for (const text of junk) {
    const folder = libraryIn(tmpRoot(t));
    putArchived(folder, "cityCount", S3, text);
    putArchived(folder, "cityCount", S1, fileText({ about: "The older one." }));
    const before = archived(folder);
    refused(await lib.restoreProgram(folder, "cityCount"), false, notProgramP("cityCount"));
    assert.deepEqual(archived(folder), before, JSON.stringify(text));
    assert.equal(existsSync(join(folder, "cityCount.js")), false);
  }
});

test("restoreProgram: 200000 bytes are read, 200001 are not", async (t) => {
  const head = "// about: A.\n// params:\n";
  const exact = head + "x".repeat(200000 - head.length);
  assert.equal(Buffer.byteLength(exact), 200000);
  const folder = libraryIn(tmpRoot(t));
  putArchived(folder, "big", S1, exact);
  assert.deepEqual(await lib.restoreProgram(folder, "big"), { restored: true, file: `big.${S1}.js` });
  assert.equal(readText(join(folder, "big.js")), exact);

  const over = libraryIn(tmpRoot(t));
  putArchived(over, "big", S1, exact + "x");
  refused(await lib.restoreProgram(over, "big"), false, notProgramP("big"));
  assert.deepEqual(archived(over), [`big.${S1}.js`]);
});

test("restoreProgram: the newest is the greatest file name, whatever order the files were made in", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  const A = fileText({ about: "Newest.", code: "newest()\n" });
  putArchived(folder, "cityCount", "2026-01-01T00-00-00-001Z", A);
  putArchived(folder, "cityCount", "2025-12-31T23-59-59-999Z", fileText({ about: "Oldest.", code: "oldest()\n" }));
  putArchived(folder, "cityCount", "2026-01-01T00-00-00-000Z", fileText({ about: "Middle.", code: "middle()\n" }));
  putArchived(folder, "cityCountX", "2027-01-01T00-00-00-000Z", fileText({ about: "Another name." }));
  putArchived(folder, "citycount", "2027-01-01T00-00-00-000Z", fileText({ about: "Another case." }));
  const before = archived(folder);
  const got = await lib.restoreProgram(folder, "cityCount");
  assert.deepEqual(got, { restored: true, file: "cityCount.2026-01-01T00-00-00-001Z.js" });
  assert.equal(readText(join(folder, "cityCount.js")), A);
  assert.deepEqual(
    archived(folder),
    before.filter((f) => f !== "cityCount.2026-01-01T00-00-00-001Z.js"),
  );
});

test("restoreProgram: the file comes back as it is, the older ones stay, the folder is made", async (t) => {
  const root = tmpRoot(t);
  const folder = join(root, "my lib é", "deeper", "library");
  const newer = "// about: Ünï — rows.\n// params: city, n\nconst s = '😀é';\n\n\n  rows  ";
  putArchived(folder, "cityCount", S1, fileText({ about: "Older." }));
  putArchived(folder, "cityCount", S2, newer);
  assert.equal(existsSync(folder), false);
  const got = await lib.restoreProgram(folder, "cityCount");
  assert.deepEqual(got, { restored: true, file: `cityCount.${S2}.js` });
  assert.deepEqual(Object.keys(got).sort(), ["file", "restored"]);
  assert.equal(readText(join(folder, "cityCount.js")), newer);
  assert.deepEqual(archived(folder), [`cityCount.${S1}.js`]);
});

test("restoreProgram: a second call at once is refused as saved already; the older stays in the archive", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  const older = fileText({ about: "Older." });
  putArchived(folder, "cityCount", S1, older);
  putArchived(folder, "cityCount", S2, fileText({ about: "Newer." }));
  assert.deepEqual(await lib.restoreProgram(folder, "cityCount"), { restored: true, file: `cityCount.${S2}.js` });
  refused(await lib.restoreProgram(folder, "cityCount"), false, sameP("cityCount"));
  assert.deepEqual(archived(folder), [`cityCount.${S1}.js`]);
  assert.equal(readText(join(archiveOf(folder), `cityCount.${S1}.js`)), older);
});

test("restoreProgram: a restored program is read by readLibrary with no count, whatever stats.json held", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  putStats(folder, { cityCount: { uses: 7, lastUse: ISO, failures: 5 } });
  putArchived(folder, "cityCount", S1, fileText({ about: "Counts.", params: ["city"], code: "rows\n" }));
  assert.equal((await lib.restoreProgram(folder, "cityCount")).restored, true);
  const { programs, bad } = await lib.readLibrary(folder);
  assert.deepEqual(bad, []);
  assert.deepEqual(programs, [
    { name: "cityCount", about: "Counts.", params: ["city"], code: "rows\n", uses: 0, lastUse: null, failures: 0 },
  ]);
});

test("restoreProgram: the library folder cannot be made: a LibraryError, nothing moved", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  mkdirSync(dirname(folder), { recursive: true });
  writeFileSync(folder, "a file where the library folder should be");
  putArchived(folder, "cityCount", S1, fileText());
  await assert.rejects(lib.restoreProgram(folder, "cityCount"), cannotBeWritten);
  assert.deepEqual(archived(folder), [`cityCount.${S1}.js`]);
  assert.equal(readText(folder), "a file where the library folder should be");
});

test("restoreProgram: gives a promise, and does not change its options", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  putArchived(folder, "a", S1, fileText());
  const options = Object.freeze({ cap: 5 });
  const pending = lib.restoreProgram(folder, "a", options);
  assert.ok(pending instanceof Promise);
  assert.equal((await pending).restored, true);
  assert.deepEqual(options, { cap: 5 });
});
