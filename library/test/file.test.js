import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../src/index.js";
import { deepFreeze } from "./helpers.js";

const head = "// about: Counts.\n// params: city\n";

test("formatProgram: the two header lines, the code, one newline", () => {
  assert.equal(
    lib.formatProgram({ about: "Counts the rows of one city.", params: ["city"], code: "rows.length" }),
    "// about: Counts the rows of one city.\n// params: city\nrows.length\n",
  );
});

test("formatProgram: the names are joined by a comma and a space", () => {
  assert.equal(lib.formatProgram({ about: "A.", params: ["a", "b", "c"], code: "x\n" }), "// about: A.\n// params: a, b, c\nx\n");
});

test("formatProgram: no params is exactly `// params:`", () => {
  assert.equal(lib.formatProgram({ about: "A.", params: [], code: "x\n" }), "// about: A.\n// params:\nx\n");
});

test("formatProgram: a code that ends with a newline gets none more", () => {
  assert.equal(lib.formatProgram({ about: "A.", params: [], code: "x\n" }), "// about: A.\n// params:\nx\n");
  assert.equal(lib.formatProgram({ about: "A.", params: [], code: "x\n\n" }), "// about: A.\n// params:\nx\n\n");
  assert.equal(lib.formatProgram({ about: "A.", params: [], code: "\n" }), "// about: A.\n// params:\n\n");
});

test("formatProgram: the code is as it is", () => {
  assert.equal(lib.formatProgram({ about: "A.", params: [], code: "  x  " }), "// about: A.\n// params:\n  x  \n");
  assert.equal(lib.formatProgram({ about: "A é.", params: [], code: "a\r\nb 😀" }), "// about: A é.\n// params:\na\r\nb 😀\n");
});

test("formatProgram: does not change its argument", () => {
  const p = deepFreeze({ about: "A.", params: ["a"], code: "x" });
  assert.equal(lib.formatProgram(p), "// about: A.\n// params: a\nx\n");
});

test("parseProgram: reads what formatProgram writes", () => {
  assert.deepEqual(lib.parseProgram(head + "rows.length\n"), { about: "Counts.", params: ["city"], code: "rows.length\n" });
  assert.deepEqual(Object.keys(lib.parseProgram(head + "x\n")).sort(), ["about", "code", "params"]);
});

test("parseProgram: gives back what formatProgram was given, save one newline added", () => {
  const cases = [
    { about: "Counts the rows.", params: ["city", "limit"], code: "const x = 1;\nx\n" },
    { about: "No params é.", params: [], code: "  indented\n\n\nafter blank lines\n" },
    { about: "Ends bare.", params: ["a"], code: "no newline at the end" },
    { about: "Crlf inside.", params: [], code: "a\r\nb\r\n" },
    { about: "Looks like a header.", params: [], code: "// about: not this\n// params: nor this\nx\n" },
  ];
  for (const p of cases) {
    const back = lib.parseProgram(lib.formatProgram(p));
    assert.deepEqual(back, { ...p, code: p.code.endsWith("\n") ? p.code : p.code + "\n" });
  }
});

test("parseProgram: forgiving: white space around the header lines and the about", () => {
  assert.deepEqual(lib.parseProgram("  // about:   Hi there  \n\t// params:  \nx"), { about: "Hi there", params: [], code: "x" });
  assert.deepEqual(lib.parseProgram("// about:Hi\n// params:a\nx"), { about: "Hi", params: ["a"], code: "x" });
});

test("parseProgram: the params are split at commas, trimmed, the empty pieces dropped", () => {
  assert.deepEqual(lib.parseProgram("// about: A\n// params: a, b ,, c ,\nx").params, ["a", "b", "c"]);
  assert.deepEqual(lib.parseProgram("// about: A\n// params:\nx").params, []);
  assert.deepEqual(lib.parseProgram("// about: A\n// params: , ,\nx").params, []);
  assert.deepEqual(lib.parseProgram("// about: A\n// params: $a,_b\nx").params, ["$a", "_b"]);
});

test("parseProgram: the code is everything after the second line break, as it is", () => {
  assert.equal(lib.parseProgram("// about: A\n// params:\n\n\n  x  \n\n").code, "\n\n  x  \n\n");
  assert.equal(lib.parseProgram("// about: A\n// params:\nx").code, "x");
  assert.equal(lib.parseProgram("// about: A\n// params:\nline1\nline2\n").code, "line1\nline2\n");
});

test("parseProgram: the length of about and of code is not tested", () => {
  const about = "x".repeat(500);
  const code = "y".repeat(150000);
  assert.deepEqual(lib.parseProgram(`// about: ${about}\n// params:\n${code}`), { about, params: [], code });
});

test("parseProgram: the first line must be the about, not empty", () => {
  for (const text of [
    "// params:\n// about: A\nx",
    "//about: A\n// params:\nx",
    "// About: A\n// params:\nx",
    "about: A\n// params:\nx",
    "\n// about: A\n// params:\nx",
    "// about:\n// params:\nx",
    "// about:    \n// params:\nx",
  ]) {
    assert.equal(lib.parseProgram(text), null, JSON.stringify(text));
  }
});

test("parseProgram: the second line must be the params", () => {
  for (const text of [
    "// about: A\n\n// params:\nx",
    "// about: A\n// param: a\nx",
    "// about: A\nparams: a\nx",
    "// about: A\nx\ny",
  ]) {
    assert.equal(lib.parseProgram(text), null, JSON.stringify(text));
  }
});

test("parseProgram: a name of params that does not fit, twice, or more than twenty", () => {
  for (const names of ["1a", "a-b", "a b", "a.b", "é", "a".repeat(41), "a, b, a"]) {
    assert.equal(lib.parseProgram(`// about: A\n// params: ${names}\nx`), null, names);
  }
  const twenty = Array.from({ length: 20 }, (_, i) => `p${i}`);
  assert.deepEqual(lib.parseProgram(`// about: A\n// params: ${twenty.join(", ")}\nx`).params, twenty);
  assert.equal(lib.parseProgram(`// about: A\n// params: ${[...twenty, "p20"].join(", ")}\nx`), null);
  assert.deepEqual(lib.parseProgram(`// about: A\n// params: ${"a".repeat(40)}\nx`).params, ["a".repeat(40)]);
});

test("parseProgram: the code must hold something that is not white space, and there must be three lines", () => {
  for (const text of [
    "// about: A\n// params:\n",
    "// about: A\n// params:\n   \n\t\n",
    "// about: A\n// params:\n ",
    "// about: A\n// params:",
    "// about: A\n",
    "// about: A",
    "",
  ]) {
    assert.equal(lib.parseProgram(text), null, JSON.stringify(text));
  }
});

test("parseProgram: not a string gives null", () => {
  for (const text of [undefined, null, 5, {}, [], ["// about: A", "// params:", "x"], true]) {
    assert.equal(lib.parseProgram(text), null);
  }
});
