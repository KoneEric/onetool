import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as lib from "../src/index.js";
import { ISO, NOW, deepFreeze, fileText, libraryIn, program, put, putStats, tmpRoot } from "./helpers.js";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

test("archiveFolder: a folder beside the library", () => {
  assert.equal(lib.archiveFolder("/a/b/.onetool/library"), "/a/b/.onetool/archive");
  assert.equal(lib.archiveFolder("/x/y z/é/library"), "/x/y z/é/archive");
});

test("joinLibraries: the project's wins on a same name, each program gets where", () => {
  const project = deepFreeze([program("b", { about: "From project." }), program("a", { about: "Project a." })]);
  const user = deepFreeze([program("c", { about: "User c." }), program("b", { about: "From user." }), program("a0", { uses: 3 })]);
  const got = lib.joinLibraries(project, user);
  assert.deepEqual(got, [
    { ...program("a", { about: "Project a." }), where: "project" },
    { ...program("a0", { uses: 3 }), where: "user" },
    { ...program("b", { about: "From project." }), where: "project" },
    { ...program("c", { about: "User c." }), where: "user" },
  ]);
});

test("joinLibraries: the keys of a program and where, and nothing else", () => {
  const [one] = lib.joinLibraries([program("a")], []);
  assert.deepEqual(Object.keys(one).sort(), ["about", "code", "failures", "lastUse", "name", "params", "uses", "where"]);
});

test("joinLibraries: case counts in the names, and the order is the order of strings", () => {
  const got = lib.joinLibraries([program("foo"), program("B")], [program("Foo"), program("a"), program("foo")]);
  assert.deepEqual(
    got.map((p) => `${p.name}:${p.where}`),
    ["B:project", "Foo:user", "a:user", "foo:project"],
  );
});

test("joinLibraries: empty libraries, and a new list of new objects", () => {
  assert.deepEqual(lib.joinLibraries([], []), []);
  const project = deepFreeze([program("a")]);
  const user = deepFreeze([program("b")]);
  const got = lib.joinLibraries(project, user);
  assert.notEqual(got[0], project[0]);
  assert.notEqual(got[1], user[0]);
  assert.equal("where" in project[0], false);
  assert.equal("where" in user[0], false);
  assert.deepEqual(lib.joinLibraries([], user).map((p) => p.where), ["user"]);
  assert.deepEqual(lib.joinLibraries(project, []).map((p) => p.where), ["project"]);
});

test("readLibrary: nothing at the folder, or a file, or a folder the system refuses", async (t) => {
  const root = tmpRoot(t);
  assert.deepEqual(await lib.readLibrary(join(root, "nowhere")), { programs: [], bad: [] });
  writeFileSync(join(root, "afile"), "x");
  assert.deepEqual(await lib.readLibrary(join(root, "afile")), { programs: [], bad: [] });
  assert.deepEqual(await lib.readLibrary(join(root, "afile", "inside")), { programs: [], bad: [] });
  if (!isRoot) {
    const locked = join(root, "locked");
    mkdirSync(locked);
    put(locked, "a");
    chmodSync(locked, 0o000);
    try {
      assert.deepEqual(await lib.readLibrary(locked), { programs: [], bad: [] });
    } finally {
      chmodSync(locked, 0o755);
    }
  }
});

test("readLibrary: an empty folder", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  mkdirSync(folder, { recursive: true });
  assert.deepEqual(await lib.readLibrary(folder), { programs: [], bad: [] });
});

test("readLibrary: programs in the order of their names, with the defaults of the counts", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "zeta", { about: "Last.", params: ["a", "b"], code: "a + b\n" });
  put(folder, "Alpha", { about: "First.", params: [], code: "tools.x.y()" });
  put(folder, "beta", { about: "Mid é.", params: ["city"], code: "\n  x\n\n" });
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got, {
    programs: [
      { name: "Alpha", about: "First.", params: [], code: "tools.x.y()", uses: 0, lastUse: null, failures: 0 },
      { name: "beta", about: "Mid é.", params: ["city"], code: "\n  x\n\n", uses: 0, lastUse: null, failures: 0 },
      { name: "zeta", about: "Last.", params: ["a", "b"], code: "a + b\n", uses: 0, lastUse: null, failures: 0 },
    ],
    bad: [],
  });
  for (const p of got.programs) assert.deepEqual(Object.keys(p).sort(), ["about", "code", "failures", "lastUse", "name", "params", "uses"]);
});

test("readLibrary: reads the folder anew at each call and gives new lists", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  const first = await lib.readLibrary(folder);
  assert.deepEqual(first.programs.map((p) => p.name), ["a"]);
  first.programs.length = 0;
  put(folder, "b");
  const second = await lib.readLibrary(folder);
  assert.deepEqual(second.programs.map((p) => p.name), ["a", "b"]);
  assert.notEqual(second.programs, first.programs);
  assert.notEqual(second.bad, first.bad);
});

test("readLibrary: entries that are not candidates are left out in silence", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  putStats(folder, {});
  writeFileSync(join(folder, "README.md"), "# hi\n");
  writeFileSync(join(folder, ".DS_Store"), "x");
  writeFileSync(join(folder, ".gitkeep"), "");
  writeFileSync(join(folder, "notes.txt"), "// about: X\n// params:\nx\n");
  writeFileSync(join(folder, "a.js.bak"), fileText());
  mkdirSync(join(folder, "sub"));
  mkdirSync(join(folder, "sub.d"));
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got.programs.map((p) => p.name), ["a"]);
  assert.deepEqual(got.bad, []);
});

test("readLibrary: a candidate that is not a program is in bad, by its full path, in the order of the entries", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "good");
  put(folder, "1abc");
  put(folder, "a-b");
  put(folder, "a b");
  put(folder, "é");
  put(folder, "a".repeat(41));
  put(folder, "a".repeat(40));
  writeFileSync(join(folder, "empty.js"), "");
  writeFileSync(join(folder, "text.js"), "hello\n");
  writeFileSync(join(folder, "noparams.js"), "// about: A\nx\ny\n");
  writeFileSync(join(folder, "twolines.js"), "// about: A\n// params:\n");
  mkdirSync(join(folder, "dir.js"));
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got.programs.map((p) => p.name), ["a".repeat(40), "good"]);
  const badNames = ["1abc", "a b", "a".repeat(41), "a-b", "dir", "empty", "noparams", "text", "twolines", "é"].map((n) => join(folder, `${n}.js`));
  assert.deepEqual(got.bad, badNames.sort());
});

test("readLibrary: a file of 200000 bytes is read, one of 200001 is bad", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  mkdirSync(folder, { recursive: true });
  const header = "// about: A\n// params:\n";
  writeFileSync(join(folder, "edge.js"), header + "x".repeat(200000 - header.length));
  writeFileSync(join(folder, "over.js"), header + "x".repeat(200001 - header.length));
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got.programs.map((p) => p.name), ["edge"]);
  assert.equal(got.programs[0].code.length, 200000 - header.length);
  assert.deepEqual(got.bad, [join(folder, "over.js")]);
});

test("readLibrary: a symbolic link to a regular file counts, one to nothing or to a folder does not", async (t) => {
  const root = tmpRoot(t);
  const folder = libraryIn(root);
  mkdirSync(folder, { recursive: true });
  const real = join(root, "elsewhere.txt");
  writeFileSync(real, fileText({ about: "Linked.", code: "7\n" }));
  symlinkSync(real, join(folder, "linked.js"));
  symlinkSync(join(root, "missing.txt"), join(folder, "dangling.js"));
  mkdirSync(join(root, "somedir"));
  symlinkSync(join(root, "somedir"), join(folder, "tofolder.js"));
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got.programs.map((p) => [p.name, p.about, p.code]), [["linked", "Linked.", "7\n"]]);
  assert.deepEqual(got.bad, [join(folder, "dangling.js"), join(folder, "tofolder.js")]);
});

test("readLibrary: a file that cannot be read is bad", { skip: isRoot }, async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "ok");
  put(folder, "locked");
  chmodSync(join(folder, "locked.js"), 0o000);
  try {
    const got = await lib.readLibrary(folder);
    assert.deepEqual(got.programs.map((p) => p.name), ["ok"]);
    assert.deepEqual(got.bad, [join(folder, "locked.js")]);
  } finally {
    chmodSync(join(folder, "locked.js"), 0o644);
  }
});

test("readLibrary: two files that differ only by case are both programs, on a system that keeps both", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "Aa.js"), fileText({ about: "Upper." }));
  writeFileSync(join(folder, "aa.js"), fileText({ about: "Lower." }));
  if (!existsSync(join(folder, "Aa.js")) || (await lib.readLibrary(folder)).programs.length < 2) {
    // a system that folds case keeps one file; nothing to say there
    const one = await lib.readLibrary(folder);
    assert.equal(one.programs.length, 1);
    return;
  }
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got.programs.map((p) => [p.name, p.about]), [["Aa", "Upper."], ["aa", "Lower."]]);
});

test("readLibrary: a folder with spaces and non-ASCII characters is a folder like any other", async (t) => {
  const folder = join(tmpRoot(t), "my lib é ü", "library");
  put(folder, "a", { about: "Here." });
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got.programs.map((p) => p.about), ["Here."]);
});

test("readLibrary: the counts come from stats.json", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  put(folder, "b");
  put(folder, "c");
  putStats(folder, {
    a: { uses: 3, lastUse: ISO, failures: 2 },
    b: { uses: 0, lastUse: null, failures: 0 },
    ghost: { uses: 9, lastUse: ISO, failures: 9 },
  });
  const got = await lib.readLibrary(folder);
  assert.deepEqual(
    got.programs.map((p) => [p.name, p.uses, p.lastUse, p.failures]),
    [["a", 3, Date.parse(ISO), 2], ["b", 0, null, 0], ["c", 0, null, 0]],
  );
  assert.equal(Date.parse(ISO), NOW);
});

test("readLibrary: a field that does not fit is its own default", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  for (const n of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) put(folder, n);
  putStats(folder, {
    a: { uses: -1, lastUse: ISO, failures: -3 },
    b: { uses: 1.5, lastUse: "not a date", failures: 2.5 },
    c: { uses: "3", lastUse: 1000, failures: "1" },
    d: { uses: null, lastUse: null, failures: null },
    e: { uses: 4 },
    f: 7,
    g: null,
    h: "text",
    i: [],
  });
  const got = await lib.readLibrary(folder);
  const by = Object.fromEntries(got.programs.map((p) => [p.name, [p.uses, p.lastUse, p.failures]]));
  assert.deepEqual(by, {
    a: [0, Date.parse(ISO), 0],
    b: [0, null, 0],
    c: [0, null, 0],
    d: [0, null, 0],
    e: [4, null, 0],
    f: [0, null, 0],
    g: [0, null, 0],
    h: [0, null, 0],
    i: [0, null, 0],
  });
});

test("readLibrary: lastUse is a string that Date.parse reads, given back as milliseconds", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  put(folder, "b");
  putStats(folder, { a: { uses: 1, lastUse: "2026-01-02", failures: 0 }, b: { uses: 1, lastUse: "2026-01-02T03:04:05.678Z", failures: 0 } });
  const got = await lib.readLibrary(folder);
  assert.equal(got.programs[0].lastUse, Date.parse("2026-01-02"));
  assert.equal(got.programs[1].lastUse, Date.UTC(2026, 0, 2, 3, 4, 5, 678));
});

test("readLibrary: a stats.json that is not a JSON object is never a fault and never in bad", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  for (const text of ["", "garbage{", "[]", "3", "null", '"text"', "true", '{"a": '])  {
    writeFileSync(join(folder, "stats.json"), text);
    const got = await lib.readLibrary(folder);
    assert.deepEqual(got.programs.map((p) => [p.name, p.uses, p.lastUse, p.failures]), [["a", 0, null, 0]], text);
    assert.deepEqual(got.bad, [], text);
  }
});

test("readLibrary: a stats.json that is a folder is no fault either", async (t) => {
  const folder = libraryIn(tmpRoot(t));
  put(folder, "a");
  mkdirSync(join(folder, "stats.json"));
  const got = await lib.readLibrary(folder);
  assert.deepEqual(got, { programs: [{ name: "a", about: "About it.", params: [], code: "1 + 1\n", uses: 0, lastUse: null, failures: 0 }], bad: [] });
});
