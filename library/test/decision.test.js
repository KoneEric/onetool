import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../src/index.js";
import { deepFreeze, program, toSave } from "./helpers.js";

const ROWS = "const r = await tools.practice.rows({});\nr.rows.length";
const CITY = { name: "cityCount", code: ROWS, uses: 4, lastUse: 1000 };

const decide = (saved, prog, opts) => lib.saveDecision(deepFreeze(saved), deepFreeze(prog), opts);

const exists = (name) => `library.save failed: a program named ${name} is saved already; replace: true updates it`;
const caseOnly = (name, twin) => `library.save failed: the name ${name} differs from the saved program ${twin} only by case`;
const same = (like) =>
  `library.save failed: lib.${like} calls the same tools in the same order: call it, or save with replace: true to put this program in its place`;
const full = (n, cap, names) =>
  `library.save failed: the library holds ${n} programs, the limit is ${cap} (onetool.libraryCap). The least used: ${names}. Remove one with library.remove(name), or replace one.`;

test("saveDecision: the examples of the meeting point", () => {
  const saved = [program(CITY.name, CITY)];
  const rowsOf = toSave("rowsOf", { code: "const x = await tools.practice.rows({}); x" });
  assert.deepEqual(decide(saved, rowsOf, { cap: 50 }), { save: false, problem: same("cityCount") });
  assert.deepEqual(decide(saved, rowsOf, { replace: true, cap: 50 }), { save: true, replaces: "cityCount" });
  assert.deepEqual(decide(saved, toSave("citycount", { code: "2" })), { save: false, problem: caseOnly("citycount", "cityCount") });
  assert.deepEqual(decide(saved, toSave("share", { code: "(await lib.cityCount({ city })) / 5000" })), {
    save: true,
    replaces: null,
  });
});

test("saveDecision: an empty library and the defaults", () => {
  assert.deepEqual(decide([], toSave("a", { code: "tools.x.y()" })), { save: true, replaces: null });
  assert.deepEqual(decide([], toSave("a"), {}), { save: true, replaces: null });
  assert.deepEqual(decide([], toSave("a"), { replace: true }), { save: true, replaces: null });
});

test("saveDecision: test 1, the same name", () => {
  const saved = [program("a", { code: "tools.x.y()" })];
  assert.deepEqual(decide(saved, toSave("a", { code: "2" })), { save: false, problem: exists("a") });
  assert.deepEqual(decide(saved, toSave("a", { code: "2" }), { replace: false }), { save: false, problem: exists("a") });
  assert.deepEqual(decide(saved, toSave("a", { code: "2" }), { replace: true }), { save: true, replaces: "a" });
});

test("saveDecision: with replace the same name is nothing else tested, not the cap nor a same sequence", () => {
  const saved = [program("b", { code: "tools.x.y()" }), program("a", { code: "tools.q.r()" })];
  // the program has the sequence of b, and the library is at its cap: the same name still decides
  assert.deepEqual(decide(saved, toSave("a", { code: "tools.x.y()" }), { replace: true, cap: 2 }), { save: true, replaces: "a" });
});

test("saveDecision: the same name beats a twin by case", () => {
  const saved = [program("Foo", { code: "1" }), program("foo", { code: "2" })];
  assert.deepEqual(decide(saved, toSave("foo", { code: "3" })), { save: false, problem: exists("foo") });
  assert.deepEqual(decide(saved, toSave("foo", { code: "3" }), { replace: true }), { save: true, replaces: "foo" });
});

test("saveDecision: test 2, a name that differs only by case, whatever replace is", () => {
  const saved = [program("cityCount", { code: "1" })];
  for (const replace of [false, true]) {
    assert.deepEqual(decide(saved, toSave("CITYCOUNT", { code: "2" }), { replace }), {
      save: false,
      problem: caseOnly("CITYCOUNT", "cityCount"),
    });
  }
});

test("saveDecision: test 2 names the first twin in the order of saved", () => {
  const saved = [program("zed", { code: "1" }), program("CITYCOUNT", { code: "2" }), program("cityCount", { code: "3" })];
  assert.deepEqual(decide(saved, toSave("citycount", { code: "4" })), {
    save: false,
    problem: caseOnly("citycount", "CITYCOUNT"),
  });
});

test("saveDecision: test 2 comes before tests 3 and 4", () => {
  const saved = [program("a", { code: "tools.x.y()" }), program("Bb", { code: "tools.q.r()" })];
  assert.deepEqual(decide(saved, toSave("bB", { code: "tools.x.y()" }), { replace: true, cap: 1 }), {
    save: false,
    problem: caseOnly("bB", "Bb"),
  });
});

test("saveDecision: test 3, the same tools in the same order, the first in saved", () => {
  const saved = [
    program("a", { code: "tools.x.y(); tools.p.q()" }),
    program("b", { code: "tools.x.y(); tools.p.q(); // twice\n" }),
    program("c", { code: "tools.x.y(); tools.p.q()" }),
  ];
  const wanted = toSave("d", { code: "await tools.x.y(); await tools.p.q()" });
  assert.deepEqual(decide(saved, wanted), { save: false, problem: same("a") });
  assert.deepEqual(decide(saved, wanted, { replace: true }), { save: true, replaces: "a" });
  assert.deepEqual(decide(saved.slice(1), wanted, { replace: true }), { save: true, replaces: "b" });
});

test("saveDecision: a sequence is the same only in the same order, the same length, none empty", () => {
  const saved = [program("a", { code: "tools.x.y(); tools.p.q()" })];
  for (const code of [
    "tools.p.q(); tools.x.y()",
    "tools.x.y()",
    "tools.x.y(); tools.p.q(); tools.p.q()",
    "tools.x.y(); tools.x.y()",
    "tools.x.z(); tools.p.q()",
  ]) {
    assert.deepEqual(decide(saved, toSave("d", { code })), { save: true, replaces: null }, code);
  }
});

test("saveDecision: two empty sequences are not the same", () => {
  const saved = [program("a", { code: "1 + 1" }), program("b", { code: "lib.a()" })];
  assert.deepEqual(decide(saved, toSave("c", { code: "3" })), { save: true, replaces: null });
  assert.deepEqual(decide(saved, toSave("c", { code: "3" }), { replace: true }), { save: true, replaces: null });
});

test("saveDecision: with replace a same sequence needs no room", () => {
  const saved = [program("a", { code: "tools.x.y()" }), program("b", { code: "2" })];
  assert.deepEqual(decide(saved, toSave("c", { code: "tools.x.y()" }), { replace: true, cap: 2 }), { save: true, replaces: "a" });
  assert.deepEqual(decide(saved, toSave("c", { code: "tools.x.y()" }), { cap: 2 }), { save: false, problem: same("a") });
});

test("saveDecision: test 4, the cap is inclusive", () => {
  const saved = [program("a", { uses: 3 }), program("b", { uses: 2 }), program("c", { uses: 1 })];
  assert.deepEqual(decide(saved, toSave("d", { code: "9" }), { cap: 4 }), { save: true, replaces: null });
  assert.deepEqual(decide(saved, toSave("d", { code: "9" }), { cap: 3 }), { save: false, problem: full(3, 3, "c, b, a") });
  assert.deepEqual(decide(saved, toSave("d", { code: "9" }), { cap: 2 }), { save: false, problem: full(3, 2, "c, b, a") });
});

test("saveDecision: test 4 whatever replace is when nothing is replaced, and the word programs is always plural", () => {
  const saved = [program("a")];
  const want = { save: false, problem: full(1, 1, "a") };
  assert.deepEqual(decide(saved, toSave("d", { code: "9" }), { cap: 1 }), want);
  assert.deepEqual(decide(saved, toSave("d", { code: "9" }), { cap: 1, replace: true }), want);
});

test("saveDecision: the default cap is 50", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => program(`p${String(i).padStart(2, "0")}`, { uses: 100 - i }));
  const got = decide(fifty, toSave("new", { code: "9" }));
  // the three least used: p49 (uses 51), p48 (52), p47 (53)
  assert.deepEqual(got, { save: false, problem: full(50, 50, "p49, p48, p47") });
  assert.deepEqual(decide(fifty.slice(1), toSave("new", { code: "9" })), { save: true, replaces: null });
});

test("saveDecision: the least used are by uses, then lastUse with null first, then name", () => {
  const saved = [
    program("z1", { uses: 0, lastUse: 500 }),
    program("b", { uses: 0, lastUse: null }),
    program("a2", { uses: 0, lastUse: 500 }),
    program("B", { uses: 0, lastUse: null }),
    program("m", { uses: 0, lastUse: 100 }),
    program("low", { uses: 7, lastUse: null }),
  ];
  // uses 0 first; among them null before numbers; null: "B" < "b"; so B, b, then lastUse 100: m
  assert.deepEqual(decide(saved, toSave("n", { code: "9" }), { cap: 6 }), { save: false, problem: full(6, 6, "B, b, m") });
});

test("saveDecision: ties on uses and lastUse go by name as < compares strings", () => {
  const saved = [
    program("b", { uses: 1, lastUse: 5 }),
    program("a", { uses: 1, lastUse: 5 }),
    program("C", { uses: 1, lastUse: 5 }),
    program("a1", { uses: 1, lastUse: 5 }),
  ];
  // "C" < "a" < "a1" < "b"
  assert.deepEqual(decide(saved, toSave("n", { code: "9" }), { cap: 4 }), { save: false, problem: full(4, 4, "C, a, a1") });
});

test("saveDecision: fewer than three programs name them all", () => {
  const saved = [program("y", { uses: 2 }), program("x", { uses: 9 })];
  assert.deepEqual(decide(saved, toSave("n", { code: "9" }), { cap: 2 }), { save: false, problem: full(2, 2, "y, x") });
});

test("saveDecision: uses of a different sort order than lastUse", () => {
  const saved = [
    program("old", { uses: 2, lastUse: 1 }),
    program("new", { uses: 1, lastUse: 9999 }),
    program("mid", { uses: 2, lastUse: 5 }),
    program("most", { uses: 3, lastUse: null }),
  ];
  // new (uses 1), then uses 2 by lastUse: old (1), mid (5)
  assert.deepEqual(decide(saved, toSave("n", { code: "9" }), { cap: 4 }), { save: false, problem: full(4, 4, "new, old, mid") });
});

test("saveDecision: test 3 comes before test 4", () => {
  const saved = [program("a", { code: "tools.x.y()" }), program("b", { code: "2" })];
  assert.deepEqual(decide(saved, toSave("c", { code: "tools.x.y()" }), { cap: 2 }), { save: false, problem: same("a") });
});

test("saveDecision: a replace of true that found nothing is a plain save", () => {
  const saved = [program("a", { code: "tools.x.y()" })];
  assert.deepEqual(decide(saved, toSave("n", { code: "5" }), { replace: true }), { save: true, replaces: null });
});

test("saveDecision: the result has exactly its keys", () => {
  assert.deepEqual(Object.keys(decide([], toSave("a"))).sort(), ["replaces", "save"]);
  assert.deepEqual(Object.keys(decide([program("a")], toSave("a"))).sort(), ["problem", "save"]);
});

test("logArgs: save", () => {
  assert.deepEqual(lib.logArgs("save", { name: "cityCount", about: "x", params: ["a"], code: "abcde", replace: true }), {
    name: "cityCount",
    codeSize: 5,
    replace: true,
  });
  assert.deepEqual(lib.logArgs("save", { name: "n", code: "" }), { name: "n", codeSize: 0, replace: false });
  assert.deepEqual(lib.logArgs("save", {}), { name: null, codeSize: null, replace: false });
  assert.deepEqual(lib.logArgs("save", { name: 5, code: 5, replace: "true" }), { name: null, codeSize: null, replace: false });
  assert.deepEqual(lib.logArgs("save", { name: null, code: null, replace: 1 }), { name: null, codeSize: null, replace: false });
  assert.deepEqual(lib.logArgs("save", { name: "bad name!", code: "é😀", replace: false }), {
    name: "bad name!",
    codeSize: 3, // "é" is 1 and the emoji 2 UTF-16 code units: args.code.length
    replace: false,
  });
});

test("logArgs: save never keeps the text of the program", () => {
  const got = lib.logArgs("save", { name: "n", about: "secret about", params: ["secret"], code: "secret code", replace: true });
  assert.equal(JSON.stringify(got).includes("secret"), false);
});

test("logArgs: remove", () => {
  assert.deepEqual(lib.logArgs("remove", { name: "cityCount", extra: 1 }), { name: "cityCount" });
  assert.deepEqual(lib.logArgs("remove", { name: 5 }), { name: null });
  assert.deepEqual(lib.logArgs("remove", {}), { name: null });
  assert.deepEqual(lib.logArgs("remove", { name: "" }), { name: "" });
});

test("logArgs: args that is not a plain object, or another tool, gives null", () => {
  for (const tool of ["save", "remove"]) {
    for (const args of [null, undefined, [], ["a"], "text", 5, true]) assert.equal(lib.logArgs(tool, args), null);
  }
  for (const tool of ["run", "list", "Save", "", undefined, null, 5]) {
    assert.equal(lib.logArgs(tool, { name: "n", code: "c" }), null);
  }
});

test("logArgs: does not change its argument", () => {
  const args = deepFreeze({ name: "n", code: "c", replace: true });
  assert.deepEqual(lib.logArgs("save", args), { name: "n", codeSize: 1, replace: true });
});
