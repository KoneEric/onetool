import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/index.js";
import { deepFreeze, printedBy } from "./helpers.js";

const ALLOWED = { allowed: true };
const denied = (id, rule) => ({
  allowed: false,
  list: "deny",
  rule,
  message: `onetool: ${id} is denied by the rule deny "${rule}"`,
});
const notAllowed = (id) => ({
  allowed: false,
  list: "allow",
  rule: null,
  message: `onetool: ${id} is not allowed: it matches no rule of allow`,
});

const isAllowed = (pattern, server, tool) => decide({ allow: [pattern] }, server, tool).allowed;
const isDenied = (pattern, server, tool) => !decide({ deny: [pattern] }, server, tool).allowed;

describe("decide: no rules", () => {
  test("empty lists allow", () => {
    assert.deepEqual(decide({ allow: [], deny: [] }, "practice", "rows"), ALLOWED);
  });

  test("lists left out allow; each default is an empty list", () => {
    assert.deepEqual(decide({}, "practice", "rows"), ALLOWED);
    assert.deepEqual(decide({ allow: [] }, "practice", "rows"), ALLOWED);
    assert.deepEqual(decide({ deny: [] }, "practice", "rows"), ALLOWED);
    assert.deepEqual(decide({ allow: undefined, deny: undefined }, "practice", "rows"), ALLOWED);
  });
});

describe("decide: the patterns", () => {
  test("a pattern with no star must be the whole id", () => {
    assert.ok(isAllowed("practice.rows", "practice", "rows"));
    assert.ok(!isAllowed("practice.row", "practice", "rows"));
    assert.ok(!isAllowed("practice", "practice", "rows"));
    assert.ok(!isAllowed("rows", "practice", "rows"));
    assert.ok(!isAllowed("ractice.rows", "practice", "rows"));
    assert.ok(!isAllowed("practice.rows.x", "practice", "rows"));
    assert.ok(!isAllowed("", "practice", "rows"));
  });

  test("case counts", () => {
    assert.ok(!isAllowed("Practice.rows", "practice", "rows"));
    assert.ok(!isAllowed("practice.ROWS", "practice", "rows"));
    assert.ok(!isAllowed("practice.rows", "Practice", "rows"));
    assert.ok(isAllowed("Practice.Rows", "Practice", "Rows"));
    assert.ok(isDenied("practice.rows", "practice", "rows"));
    assert.ok(!isDenied("PRACTICE.*", "practice", "rows"));
  });

  test("`practice.*` is every tool of practice", () => {
    assert.ok(isAllowed("practice.*", "practice", "rows"));
    assert.ok(isAllowed("practice.*", "practice", "wipe"));
    assert.ok(!isAllowed("practice.*", "other", "rows"));
    assert.ok(!isAllowed("practice.*", "practice2", "rows"));
    assert.ok(!isAllowed("practice.*", "my-practice", "rows"));
  });

  test("`*.delete*` is every tool whose name starts with delete", () => {
    assert.ok(isAllowed("*.delete*", "practice", "delete"));
    assert.ok(isAllowed("*.delete*", "practice", "delete_row"));
    assert.ok(isAllowed("*.delete*", "a", "deleteAll"));
    assert.ok(!isAllowed("*.delete*", "practice", "undelete"));
    assert.ok(!isAllowed("*.delete*", "practice", "rows"));
    assert.ok(!isAllowed("*.delete*", "practice", "Delete"));
  });

  test("`*` is everything", () => {
    assert.ok(isAllowed("*", "practice", "rows"));
    assert.ok(isAllowed("*", "a", "b"));
    assert.ok(isDenied("*", "practice", "rows"));
  });

  test("a star stands for the empty run too", () => {
    assert.ok(isAllowed("practice.rows*", "practice", "rows"));
    assert.ok(isAllowed("practice*.rows", "practice", "rows"));
    assert.ok(isAllowed("pr*actice.rows", "practice", "rows"));
    assert.ok(isAllowed("**", "a", "b"));
    assert.ok(isAllowed("a.b*", "a", "b"));
  });

  test("a star stands for dots too", () => {
    assert.ok(isAllowed("a.*", "a", "b.c.d"));
    assert.ok(isAllowed("*.d", "a", "b.c.d"));
    assert.ok(isAllowed("*.c.*", "a", "b.c.d"));
    assert.ok(isAllowed("*d", "a.b", "c.d"));
  });

  test("a star in the middle: the rest must still match", () => {
    assert.ok(isAllowed("p*s", "practice", "rows"));
    assert.ok(!isAllowed("p*x", "practice", "rows"));
    assert.ok(isAllowed("p*.*s", "practice", "rows"));
    assert.ok(!isAllowed("p*.*x", "practice", "rows"));
    assert.ok(!isAllowed("*rows*x", "practice", "rows"));
    assert.ok(isAllowed("*ice.ro*", "practice", "rows"));
  });

  test("every other character stands for itself: a dot is not a wildcard", () => {
    assert.ok(isAllowed("a.b.t", "a", "b.t"));
    assert.ok(!isAllowed("a.b.t", "axb", "t"));
    assert.ok(isDenied("a.b.t", "a", "b.t"));
    assert.ok(!isDenied("a.b.t", "axb", "t"));
  });

  test("characters that mean something in a regular expression stand for themselves", () => {
    assert.ok(isAllowed("p.a+b", "p", "a+b"));
    assert.ok(!isAllowed("p.a+b", "p", "aab"));
    assert.ok(isAllowed("p.a?", "p", "a?"));
    assert.ok(!isAllowed("p.a?", "p", "a"));
    assert.ok(isAllowed("p.[ab]", "p", "[ab]"));
    assert.ok(!isAllowed("p.[ab]", "p", "a"));
    assert.ok(isAllowed("p.(a)", "p", "(a)"));
    assert.ok(!isAllowed("p.(a)", "p", "a"));
    assert.ok(isAllowed("p.a|b", "p", "a|b"));
    assert.ok(!isAllowed("p.a|b", "p", "a"));
    assert.ok(!isAllowed("p.a|b", "p", "b"));
    assert.ok(isAllowed("p.^x$", "p", "^x$"));
    assert.ok(!isAllowed("p.^x$", "p", "x"));
    assert.ok(isAllowed("p.a{2}", "p", "a{2}"));
    assert.ok(!isAllowed("p.a{2}", "p", "aa"));
    assert.ok(isAllowed("p.a\\d", "p", "a\\d"));
    assert.ok(!isAllowed("p.a\\d", "p", "a1"));
    assert.ok(isDenied("p.a+b", "p", "a+b"));
    assert.ok(!isDenied("p.a+b", "p", "aab"));
  });

  test("non-ASCII characters stand for themselves", () => {
    assert.ok(isAllowed("日本.*", "日本", "rows"));
    assert.ok(!isAllowed("日本.*", "本日", "rows"));
    assert.ok(isAllowed("ü.é*", "ü", "école"));
  });
});

describe("decide: deny, then allow", () => {
  test("refused by deny: the pattern is named", () => {
    assert.deepEqual(decide({ deny: ["practice.wipe"] }, "practice", "wipe"), denied("practice.wipe", "practice.wipe"));
    assert.deepEqual(decide({ deny: ["practice.*"] }, "practice", "wipe"), denied("practice.wipe", "practice.*"));
    assert.deepEqual(decide({ deny: ["*.delete*"] }, "a", "delete_it"), denied("a.delete_it", "*.delete*"));
  });

  test("a deny that does not match changes nothing", () => {
    assert.deepEqual(decide({ deny: ["practice.wipe", "other.*"] }, "practice", "rows"), ALLOWED);
  });

  test("the first pattern of deny that matches is named", () => {
    assert.deepEqual(decide({ deny: ["x.*", "practice.*", "*.wipe", "*"] }, "practice", "wipe"), denied("practice.wipe", "practice.*"));
    assert.deepEqual(decide({ deny: ["*.wipe", "practice.*"] }, "practice", "wipe"), denied("practice.wipe", "*.wipe"));
    assert.deepEqual(decide({ deny: ["*", "practice.wipe"] }, "practice", "wipe"), denied("practice.wipe", "*"));
  });

  test("allow not empty and no pattern matches", () => {
    assert.deepEqual(decide({ allow: ["practice.rows"] }, "practice", "wipe"), notAllowed("practice.wipe"));
    assert.deepEqual(decide({ allow: ["a.*", "b.*"] }, "c", "d"), notAllowed("c.d"));
  });

  test("allow not empty and at least one pattern matches", () => {
    assert.deepEqual(decide({ allow: ["a.*", "practice.rows"] }, "practice", "rows"), ALLOWED);
    assert.deepEqual(decide({ allow: ["x.y", "a.*", "practice.*"] }, "practice", "rows"), ALLOWED);
    assert.deepEqual(decide({ allow: ["*"] }, "practice", "rows"), ALLOWED);
  });

  test("deny wins over allow", () => {
    assert.deepEqual(decide({ allow: ["practice.*"], deny: ["practice.wipe"] }, "practice", "wipe"), denied("practice.wipe", "practice.wipe"));
    assert.deepEqual(decide({ allow: ["*"], deny: ["*"] }, "a", "b"), denied("a.b", "*"));
  });

  test("a tool in deny and outside allow is refused by deny, not by allow", () => {
    assert.deepEqual(decide({ allow: ["other.*"], deny: ["practice.wipe"] }, "practice", "wipe"), denied("practice.wipe", "practice.wipe"));
  });

  test("a tool outside deny and inside allow is allowed", () => {
    assert.deepEqual(decide({ allow: ["practice.*"], deny: ["practice.wipe"] }, "practice", "rows"), ALLOWED);
  });

  test("a tool outside deny and outside allow is refused by allow", () => {
    assert.deepEqual(decide({ allow: ["other.*"], deny: ["practice.wipe"] }, "practice", "rows"), notAllowed("practice.rows"));
  });

  test("the result has exactly the keys of its case", () => {
    assert.deepEqual(Object.keys(decide({}, "a", "b")), ["allowed"]);
    assert.deepEqual(Object.keys(decide({ deny: ["*"] }, "a", "b")).sort(), ["allowed", "list", "message", "rule"]);
    assert.deepEqual(Object.keys(decide({ allow: ["x"] }, "a", "b")).sort(), ["allowed", "list", "message", "rule"]);
  });

  test("the id in the message is server, one dot, tool", () => {
    assert.equal(decide({ deny: ["*"] }, "My Server", "do it").message, 'onetool: My Server.do it is denied by the rule deny "*"');
    assert.equal(decide({ allow: ["z"] }, "s", "t.u").message, "onetool: s.t.u is not allowed: it matches no rule of allow");
  });
});

describe("decide: purity", () => {
  test("it does not change its arguments and prints nothing", () => {
    const rules = deepFreeze({ allow: ["a.*", "b.c"], deny: ["a.x*"] });
    const printed = printedBy(() => {
      decide(rules, "a", "x1");
      decide(rules, "a", "y");
      decide(rules, "b", "d");
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(rules, { allow: ["a.*", "b.c"], deny: ["a.x*"] });
  });
});
