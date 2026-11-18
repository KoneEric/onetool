import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../src/index.js";

const seq = lib.callSequence;

test("callSequence: the examples of the meeting point", () => {
  assert.deepEqual(seq("const r = await tools.practice.rows({});\nr.rows.length"), ["practice.rows"]);
  assert.deepEqual(
    seq('await tools["my server"]["get-rows"](); await tools.a.b(); await tools.a.b()'),
    ["my server.get-rows", "a.b", "a.b"],
  );
  assert.deepEqual(seq("await $`ls`; await lib.x(); 1"), []);
});

test("callSequence: no place, or not a string, gives a new empty list", () => {
  assert.deepEqual(seq(""), []);
  assert.deepEqual(seq("1 + 1"), []);
  for (const code of [undefined, null, 5, {}, ["tools.a.b"], true]) assert.deepEqual(seq(code), []);
  assert.notEqual(seq("1"), seq("1"));
});

test("callSequence: the order of the places, the same id as often as it is named", () => {
  assert.deepEqual(seq("tools.b.y(); tools.a.x(); tools.b.y(); tools.a.x()"), ["b.y", "a.x", "b.y", "a.x"]);
});

test("callSequence: the word tools must not be preceded by a letter, digit, _, $ or .", () => {
  assert.deepEqual(seq("mytools.a.b"), []);
  assert.deepEqual(seq("x.tools.a.b"), []);
  assert.deepEqual(seq("_tools.a.b"), []);
  assert.deepEqual(seq("$tools.a.b"), []);
  assert.deepEqual(seq("1tools.a.b"), []);
  assert.deepEqual(seq("Tools.a.b"), []);
  assert.deepEqual(seq("toolsx.a.b"), []);
});

test("callSequence: other characters before the word are fine", () => {
  assert.deepEqual(seq("(tools.a.b)"), ["a.b"]);
  assert.deepEqual(seq("await tools.a.b()"), ["a.b"]);
  assert.deepEqual(seq("\ntools.a.b"), ["a.b"]);
  assert.deepEqual(seq("[tools.a.b]"), ["a.b"]);
  assert.deepEqual(seq("{tools.a.b}"), ["a.b"]);
  assert.deepEqual(seq("x=tools.a.b"), ["a.b"]);
});

test("callSequence: a place needs a server and a tool", () => {
  assert.deepEqual(seq("tools"), []);
  assert.deepEqual(seq("tools.a"), []);
  assert.deepEqual(seq("tools.a."), []);
  assert.deepEqual(seq("tools['a']"), []);
  assert.deepEqual(seq("Object.keys(tools)"), []);
  assert.deepEqual(seq("tools.1a.b"), []);
  assert.deepEqual(seq("tools.a.1b"), []);
});

test("callSequence: identifiers", () => {
  assert.deepEqual(seq("tools.$a._b()"), ["$a._b"]);
  assert.deepEqual(seq("tools.a1.b2()"), ["a1.b2"]);
  assert.deepEqual(seq("tools._.$()"), ["_.$"]);
  assert.deepEqual(seq("tools.Practice.Rows()"), ["Practice.Rows"]);
});

test("callSequence: the place ends with the tool", () => {
  assert.deepEqual(seq("tools.a.b.c.d"), ["a.b"]);
  assert.deepEqual(seq("tools.a.b(tools.c.d())"), ["a.b", "c.d"]);
});

test("callSequence: brackets with double or single quotes, in any mix", () => {
  assert.deepEqual(seq("tools['a']['b']"), ["a.b"]);
  assert.deepEqual(seq('tools["a"]["b"]'), ["a.b"]);
  assert.deepEqual(seq('tools.a["get-rows"]'), ["a.get-rows"]);
  assert.deepEqual(seq("tools['my server'].rows"), ["my server.rows"]);
  assert.deepEqual(seq("tools[\"a'b\"].c"), ["a'b.c"]);
  assert.deepEqual(seq("tools['a\"b'].c"), ['a"b.c']);
  assert.deepEqual(seq('tools["a.b"]["c d"]'), ["a.b.c d"]);
});

test("callSequence: a bracket text with a quote of its kind or a backslash is no place", () => {
  assert.deepEqual(seq('tools["a\\b"].c'), []);
  assert.deepEqual(seq("tools['a\\b'].c"), []);
  assert.deepEqual(seq('tools.a["b\\"c"]'), []);
});

test("callSequence: white space before and after each dot and bracket", () => {
  assert.deepEqual(seq("tools . a . b"), ["a.b"]);
  assert.deepEqual(seq("tools\n.a\n.b"), ["a.b"]);
  assert.deepEqual(seq("tools\t.\ta\t.\tb"), ["a.b"]);
  assert.deepEqual(seq("tools [ 'a' ] [ \"b\" ]"), ["a.b"]);
  assert.deepEqual(seq("tools\n[\n'a'\n]\n.\nb"), ["a.b"]);
  assert.deepEqual(seq("tools .a [ 'b' ]"), ["a.b"]);
});

test("callSequence: the text is not understood, strings and comments count", () => {
  assert.deepEqual(seq("// tools.a.b"), ["a.b"]);
  assert.deepEqual(seq("/* tools.a.b */ 1"), ["a.b"]);
  assert.deepEqual(seq('const s = "tools.a.b";'), ["a.b"]);
  assert.deepEqual(seq("const s = 'tools.a.b';"), ["a.b"]);
});

test("callSequence: a tool reached another way is not seen", () => {
  assert.deepEqual(seq("const p = tools.practice; p.rows()"), []);
  assert.deepEqual(seq("tools?.practice.rows"), []);
  assert.deepEqual(seq("tools[`a`][`b`]"), []);
  assert.deepEqual(seq("const k = 'a'; tools[k].b()"), []);
  assert.deepEqual(seq("tools[k][j]"), []);
});

test("callSequence: $, read, write, edit, lib and library.save are not places", () => {
  assert.deepEqual(seq("await $`ls`; await read('a'); await write('a', 'b'); await edit('a'); await lib.cityCount({}); await library.save({})"), []);
  assert.deepEqual(seq("await lib.a.b(); await library.save.x()"), []);
  assert.deepEqual(seq("await lib.cityCount(); await tools.a.b(); await library.save({})"), ["a.b"]);
});
