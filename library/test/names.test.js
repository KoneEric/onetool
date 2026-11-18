import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../src/index.js";
import { deepFreeze } from "./helpers.js";

const P1 = "library.save failed: it takes a name and { about, params, code }";
const P2 = "library.save failed: the name must be 1 to 40 letters, digits or _, starting with a letter";
const P3 = 'library.save failed: "about" must be one sentence on one line, at most 200 characters';
const P4 = 'library.save failed: "params" must be a list of at most 20 argument names, each once';
const P5 = 'library.save failed: "code" must be the text of the program, at most 100000 characters';
const P6 = 'library.save failed: "replace" must be true or false';

const ok = (over = {}) => ({ name: "cityCount", about: "Counts the rows.", params: ["city"], code: "1 + 1", ...over });

test("the module exports what the meeting point lists", () => {
  for (const name of [
    "isProgramName", "checkSave", "callSequence", "saveDecision", "logArgs", "formatProgram", "parseProgram",
    "joinLibraries", "archiveFolder", "readLibrary", "saveProgram", "removeProgram", "noteUses",
    "restoreProgram", "sequenceLine", "readSequences", "reportText",
  ]) {
    assert.equal(typeof lib[name], "function", name);
  }
  assert.equal(typeof lib.LibraryError, "function");
  const err = new lib.LibraryError("x");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "LibraryError");
});

test("isProgramName: valid names", () => {
  for (const name of ["a", "Z", "cityCount", "a1", "A_b_9", "x_", "a".repeat(40), "a" + "_".repeat(39)]) {
    assert.equal(lib.isProgramName(name), true, JSON.stringify(name));
  }
});

test("isProgramName: everything else is false", () => {
  const bad = ["", " ", "a b", "a.b", "a-b", "a$", "$a", "1a", "9", "_a", "é", "aé", "éa", "a".repeat(41), "a\n", "\na", " a", "a "];
  for (const name of bad) assert.equal(lib.isProgramName(name), false, JSON.stringify(name));
  for (const value of [undefined, null, 5, true, {}, [], ["a"], () => "a", Symbol("a"), new String("a")]) {
    assert.equal(lib.isProgramName(value), false);
  }
});

test("checkSave: all pass gives exactly program and replace", () => {
  assert.deepEqual(lib.checkSave(ok()), {
    program: { name: "cityCount", about: "Counts the rows.", params: ["city"], code: "1 + 1" },
    replace: false,
  });
  assert.deepEqual(Object.keys(lib.checkSave(ok())).sort(), ["program", "replace"]);
  assert.deepEqual(Object.keys(lib.checkSave(ok()).program).sort(), ["about", "code", "name", "params"]);
});

test("checkSave: about is trimmed, code is kept as given, other keys are ignored", () => {
  const got = lib.checkSave(ok({ about: "  \t Counts.  ", code: "  x \n\n", extra: 1, uses: 5 }));
  assert.deepEqual(got, {
    program: { name: "cityCount", about: "Counts.", params: ["city"], code: "  x \n\n" },
    replace: false,
  });
});

test("checkSave: params absent or undefined is an empty new list", () => {
  const { name, about, code } = ok();
  assert.deepEqual(lib.checkSave({ name, about, code }).program.params, []);
  assert.deepEqual(lib.checkSave({ name, about, code, params: undefined }).program.params, []);
  const a = lib.checkSave({ name, about, code }).program.params;
  const b = lib.checkSave({ name, about, code }).program.params;
  assert.notEqual(a, b);
});

test("checkSave: params is a new list, not the one given", () => {
  const given = ["a", "b"];
  const got = lib.checkSave(ok({ params: given })).program.params;
  assert.deepEqual(got, ["a", "b"]);
  assert.notEqual(got, given);
});

test("checkSave: replace is true only when exactly true", () => {
  assert.equal(lib.checkSave(ok({ replace: true })).replace, true);
  assert.equal(lib.checkSave(ok({ replace: false })).replace, false);
  assert.equal(lib.checkSave(ok({ replace: undefined })).replace, false);
  assert.equal(lib.checkSave(ok({ replace: undefined })).problem, undefined);
});

test("checkSave: test 1, args is not a plain object", () => {
  for (const args of [null, undefined, [], [ok()], "text", 5, true, () => ok()]) {
    assert.deepEqual(lib.checkSave(args), { problem: P1 });
  }
});

test("checkSave: test 2, the name", () => {
  assert.deepEqual(lib.checkSave({}), { problem: P2 });
  for (const name of [undefined, null, "", "1a", "a b", "a-b", "é", "a".repeat(41), 5, ["a"]]) {
    assert.deepEqual(lib.checkSave(ok({ name })), { problem: P2 }, JSON.stringify(name));
  }
  assert.equal(lib.checkSave(ok({ name: "a".repeat(40) })).program.name, "a".repeat(40));
});

test("checkSave: test 3, about", () => {
  for (const about of [undefined, null, 5, ["x"], "", "   ", "\t \n", "one\ntwo", "one\rtwo", "a\r\nb", "x".repeat(201), "  " + "x".repeat(201) + "  "]) {
    assert.deepEqual(lib.checkSave(ok({ about })), { problem: P3 }, JSON.stringify(about));
  }
  const edge = "x".repeat(200);
  assert.equal(lib.checkSave(ok({ about: edge })).program.about, edge);
  // trimmed it is exactly 200 characters: valid
  assert.equal(lib.checkSave(ok({ about: "  " + edge + "\t " })).program.about, edge);
});

test("checkSave: test 4, params", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `p${i}`);
  assert.deepEqual(lib.checkSave(ok({ params: twenty })).program.params, twenty);
  assert.deepEqual(lib.checkSave(ok({ params: [] })).program.params, []);
  const bad = [
    null, "city", 5, {}, { 0: "a", length: 1 },
    [...twenty, "p20"],
    ["a", "a"],
    [5], [null], [["a"]], [undefined],
    [""], ["1a"], ["a-b"], ["a b"], ["a.b"], ["é"], ["a".repeat(41)],
  ];
  for (const params of bad) {
    assert.deepEqual(lib.checkSave(ok({ params })), { problem: P4 }, JSON.stringify(params));
  }
  for (const name of ["a", "_", "$", "$x", "_x", "a$_9", "A".repeat(40), "class", "await"]) {
    assert.deepEqual(lib.checkSave(ok({ params: [name] })).program.params, [name], name);
  }
});

test("checkSave: test 5, code", () => {
  for (const code of [undefined, null, 5, ["x"], "", "   ", " \n\t\r\n ", " ﻿", "x".repeat(100001)]) {
    assert.deepEqual(lib.checkSave(ok({ code })), { problem: P5 }, JSON.stringify(code));
  }
  const edge = "x".repeat(100000);
  assert.equal(lib.checkSave(ok({ code: edge })).program.code, edge);
  assert.equal(lib.checkSave(ok({ code: "\n\n x" })).program.code, "\n\n x");
});

test("checkSave: test 6, replace", () => {
  for (const replace of [null, "true", "false", 1, 0, {}, []]) {
    assert.deepEqual(lib.checkSave(ok({ replace })), { problem: P6 }, JSON.stringify(replace));
  }
});

test("checkSave: the first test that fails decides", () => {
  const worst = { name: "1", about: "", params: "x", code: "", replace: null };
  assert.deepEqual(lib.checkSave(worst), { problem: P2 });
  assert.deepEqual(lib.checkSave({ ...worst, name: "n" }), { problem: P3 });
  assert.deepEqual(lib.checkSave({ ...worst, name: "n", about: "a" }), { problem: P4 });
  assert.deepEqual(lib.checkSave({ ...worst, name: "n", about: "a", params: [] }), { problem: P5 });
  assert.deepEqual(lib.checkSave({ ...worst, name: "n", about: "a", params: [], code: "c" }), { problem: P6 });
});

test("checkSave: null is a value like any other and nothing throws", () => {
  assert.deepEqual(lib.checkSave(ok({ params: null })), { problem: P4 });
  assert.deepEqual(lib.checkSave(ok({ replace: null })), { problem: P6 });
  assert.doesNotThrow(() => lib.checkSave({ name: Symbol("x"), about: {}, params: Symbol("y"), code: 1n, replace: () => 1 }));
});

test("checkSave: does not change its argument", () => {
  const args = deepFreeze(ok({ about: "  padded  ", params: ["a"], replace: true }));
  assert.deepEqual(lib.checkSave(args).program.about, "padded");
  assert.equal(args.about, "  padded  ");
});
