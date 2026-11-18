import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.js";
import { deepFreeze, printedBy } from "./helpers.js";

const { decide, toolValue, ToolError } = core;
// looked up at call time, so that a missing nextState fails its own tests and not the whole file
const nextState = (...args) => core.nextState(...args);
const keysOf = (o) => Object.keys(o);

describe("nextState: the examples of the meeting point", () => {
  test("a key added by the call", () => {
    const got = nextState({ a: 1 }, { a: 1 }, { a: 1, b: 2 });
    assert.deepEqual(got, { state: { a: 1, b: 2 }, problem: null });
  });

  test("removed by this call, added by another, added by this one", () => {
    const got = nextState({ a: 1, c: 3 }, { a: 1 }, { b: 2 });
    assert.deepEqual(got.state, { c: 3, b: 2 });
    assert.deepEqual(keysOf(got.state), ["c", "b"]);
    assert.equal(got.problem, null);
  });

  test("a key the call did not change keeps the value kept has", () => {
    assert.deepEqual(nextState({ a: 5 }, { a: 1 }, { a: 1 }), { state: { a: 5 }, problem: null });
  });

  test("over the limit: nothing of the call is kept", () => {
    // {"big":"xxxxxxxxxx"} = { + "big" (5) + : + "xxxxxxxxxx" (12) + } = 1+5+1+12+1 = 20
    const got = nextState({}, {}, { big: "xxxxxxxxxx" }, { limit: 10 });
    assert.deepEqual(got, { state: {}, problem: "state was not kept: it is 20 characters as JSON, the limit is 10" });
  });
});

describe("nextState: which keys the call changed", () => {
  test("added, set and removed together; the others keep kept's value", () => {
    const kept = { a: 1, b: 2, c: 3, e: 5 };
    const before = { a: 1, b: 2, c: 3 };
    const after = { a: 9, c: 3, d: 4 }; // a set, b removed, d added, c not changed
    const got = nextState(kept, before, after);
    assert.deepEqual(got.state, { a: 9, c: 3, e: 5, d: 4 });
    assert.deepEqual(keysOf(got.state), ["a", "c", "e", "d"]);
  });

  test("a set key holds the value of after in its old place", () => {
    const got = nextState({ x: 1, a: 1, y: 2 }, { a: 1 }, { a: 2 });
    assert.deepEqual(keysOf(got.state), ["x", "a", "y"]);
    assert.deepEqual(got.state, { x: 1, a: 2, y: 2 });
  });

  test("keys kept does not have come last, in the order after has them", () => {
    const got = nextState({ k: 1 }, {}, { z: 1, y: 2, x: 3 });
    assert.deepEqual(keysOf(got.state), ["k", "z", "y", "x"]);
  });

  test("a key set by the call that kept has removed meanwhile is put back, after the keys of kept", () => {
    const got = nextState({ b: 2 }, { a: 1, b: 2 }, { a: 7, b: 2 });
    assert.deepEqual(keysOf(got.state), ["b", "a"]);
    assert.deepEqual(got.state, { b: 2, a: 7 });
  });

  test("a key the call did not change stays absent when another call removed it meanwhile", () => {
    const got = nextState({ b: 2 }, { a: 1, b: 2 }, { a: 1, b: 2 });
    assert.deepEqual(got, { state: { b: 2 }, problem: null });
  });

  test("a key the call did not change keeps kept's value when another call changed it", () => {
    const got = nextState({ a: "other", b: 2 }, { a: "mine", b: 2 }, { a: "mine", b: 3 });
    assert.deepEqual(got.state, { a: "other", b: 3 });
  });

  test("removed by the call: gone, also when kept changed it meanwhile", () => {
    const got = nextState({ a: 99, b: 2 }, { a: 1, b: 2 }, { b: 2 });
    assert.deepEqual(got.state, { b: 2 });
  });

  test("set is decided by JSON.stringify: equal values of another identity are not a change", () => {
    const got = nextState({ a: 5 }, { a: { x: [1, 2] } }, { a: { x: [1, 2] } });
    assert.deepEqual(got.state, { a: 5 });
  });

  test("set is decided by JSON.stringify: a nested change is a change of the top-level key", () => {
    const got = nextState({ a: { x: 1, y: 1 } }, { a: { x: 1, y: 1 } }, { a: { x: 1, y: 2 } });
    assert.deepEqual(got.state, { a: { x: 1, y: 2 } });
  });

  test("set is decided by JSON.stringify: the same members in another order are a change", () => {
    const got = nextState({ a: 0 }, { a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } });
    assert.equal(JSON.stringify(got.state.a), '{"y":2,"x":1}');
  });

  test("the value types of JSON", () => {
    const after = { n: 1, s: "t", b: true, z: null, l: [1, [2]], o: { p: { q: 1 } } };
    assert.deepEqual(nextState({}, {}, after).state, after);
    assert.deepEqual(nextState({ n: 0 }, { n: 0 }, { n: null }).state, { n: null });
    assert.deepEqual(nextState({ n: 0 }, { n: 0 }, { n: "0" }).state, { n: "0" });
  });

  test("nothing changed by the call: an object equal to kept", () => {
    assert.deepEqual(nextState({}, {}, {}), { state: {}, problem: null });
    const got = nextState({ a: 1, b: [2] }, { a: 1 }, { a: 1 });
    assert.deepEqual(got, { state: { a: 1, b: [2] }, problem: null });
    assert.deepEqual(keysOf(got.state), ["a", "b"]);
  });
});

describe("nextState: the limit", () => {
  test("exactly limit is kept", () => {
    // {"a":1,"b":2} = { "a" : 1 , "b" : 2 } = 1+3+1+1+1+3+1+1+1 = 13
    const got = nextState({ a: 1 }, { a: 1 }, { a: 1, b: 2 }, { limit: 13 });
    assert.deepEqual(got, { state: { a: 1, b: 2 }, problem: null });
  });

  test("one over: nothing is kept; both numbers in digits", () => {
    const got = nextState({ a: 1 }, { a: 1 }, { a: 1, b: 2 }, { limit: 12 });
    assert.deepEqual(got, { state: { a: 1 }, problem: "state was not kept: it is 13 characters as JSON, the limit is 12" });
  });

  test("n is the length of the new object, not of after", () => {
    // new object {"k":"xxxxxxxx","b":1}: 1+3+1+10+1+3+1+1+1 = 22; after alone would be {"b":1} = 7
    const got = nextState({ k: "xxxxxxxx" }, {}, { b: 1 }, { limit: 21 });
    assert.deepEqual(got, { state: { k: "xxxxxxxx" }, problem: "state was not kept: it is 22 characters as JSON, the limit is 21" });
    assert.deepEqual(nextState({ k: "xxxxxxxx" }, {}, { b: 1 }, { limit: 22 }).problem, null);
  });

  test("the call changed no key: the limit is not looked at", () => {
    const kept = { a: "x".repeat(50) };
    const got = nextState(kept, { a: "x".repeat(50) }, { a: "x".repeat(50) }, { limit: 2 });
    assert.deepEqual(got, { state: kept, problem: null });
    assert.deepEqual(nextState({ a: 1 }, { a: 1 }, { a: 1 }, { limit: 2 }), { state: { a: 1 }, problem: null });
  });

  test("a call that only removes is kept when the result fits", () => {
    const got = nextState({ a: 1, b: 2 }, { a: 1, b: 2 }, { b: 2 }, { limit: 7 }); // {"b":2} = 7
    assert.deepEqual(got, { state: { b: 2 }, problem: null });
  });

  test("the default is 10000000 characters", () => {
    // {"a":"<s>"} is 8 characters plus s
    const fits = nextState({}, {}, { a: "x".repeat(9999992) });
    assert.equal(fits.problem, null);
    assert.equal(JSON.stringify(fits.state).length, 10000000);
    const over = nextState({}, {}, { a: "x".repeat(9999993) });
    assert.deepEqual(over.state, {});
    assert.equal(over.problem, "state was not kept: it is 10000001 characters as JSON, the limit is 10000000");
  });

  test("limit given as an empty options object means the default", () => {
    assert.equal(nextState({}, {}, { a: 1 }, {}).problem, null);
  });
});

describe("nextState: the result and purity", () => {
  test("the result has exactly the keys state and problem", () => {
    assert.deepEqual(Object.keys(nextState({}, {}, { a: 1 })).sort(), ["problem", "state"]);
    assert.deepEqual(Object.keys(nextState({}, {}, { a: 1 }, { limit: 2 })).sort(), ["problem", "state"]);
    assert.deepEqual(Object.keys(nextState({}, {}, {})).sort(), ["problem", "state"]);
  });

  test("it changes none of its arguments and prints nothing", () => {
    const kept = deepFreeze({ a: { x: 1 }, c: [3] });
    const before = deepFreeze({ a: { x: 1 }, b: 2 });
    const after = deepFreeze({ a: { x: 2 }, d: { y: [1] } });
    const printed = printedBy(() => {
      nextState(kept, before, after);
      nextState(kept, before, after, { limit: 5 });
      nextState(kept, before, before);
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(kept, { a: { x: 1 }, c: [3] });
    assert.deepEqual(before, { a: { x: 1 }, b: 2 });
    assert.deepEqual(after, { a: { x: 2 }, d: { y: [1] } });
  });

  test("a result can be changed later without touching a frozen kept", () => {
    const kept = deepFreeze({ a: 1 });
    const got = nextState(kept, kept, { a: 1, b: 2 });
    assert.deepEqual(got.state, { a: 1, b: 2 });
  });
});

describe("step 2: decide, null and wrong kinds", () => {
  test("the first argument undefined: the default {}, everything is allowed", () => {
    assert.deepEqual(decide(undefined, "a", "b"), { allowed: true });
  });

  test("the first argument null, or not an object: TypeError", () => {
    for (const bad of [null, "x", "practice.wipe", 5, true, false]) {
      assert.throws(() => decide(bad, "a", "b"), TypeError, JSON.stringify(bad));
    }
  });

  test("allow or deny undefined or absent: the default []", () => {
    assert.deepEqual(decide({ allow: undefined }, "a", "b"), { allowed: true });
    assert.deepEqual(decide({ deny: undefined }, "a", "b"), { allowed: true });
    assert.deepEqual(decide({ allow: undefined, deny: ["a.b"] }, "a", "b").allowed, false);
    assert.deepEqual(decide({ deny: undefined, allow: ["a.b"] }, "a", "b"), { allowed: true });
  });

  test("allow or deny null, or not a list: TypeError", () => {
    for (const key of ["allow", "deny"]) {
      for (const bad of [null, "practice.wipe", "", "*", 5, true, {}, { 0: "a.b", length: 1 }]) {
        assert.throws(() => decide({ [key]: bad }, "practice", "wipe"), TypeError, `${key} ${JSON.stringify(bad)}`);
      }
    }
  });

  test("a string for deny is not read letter by letter, and not taken as one pattern", () => {
    assert.throws(() => decide({ deny: "practice.wipe" }, "practice", "wipe"), TypeError);
    assert.throws(() => decide({ deny: "practice.wipe" }, "practice", "rows"), TypeError);
  });

  test("one bad list throws whatever the other list holds", () => {
    assert.throws(() => decide({ allow: ["*"], deny: null }, "a", "b"), TypeError);
    assert.throws(() => decide({ allow: null, deny: ["x"] }, "a", "b"), TypeError);
    assert.throws(() => decide({ allow: "*", deny: [] }, "a", "b"), TypeError);
  });
});

describe("step 2: toolValue, null and wrong kinds", () => {
  const text = (s) => ({ type: "text", text: s });
  const image = { type: "image", data: "AAAA", mimeType: "image/png" };

  test("a result that is null, undefined, a list or not an object: TypeError", () => {
    for (const bad of [null, undefined, [], [text("a")], "text", "", 5, 0, true, false]) {
      assert.throws(() => toolValue(bad), TypeError, JSON.stringify(bad));
    }
  });

  test("isError counts only when it is exactly true", () => {
    for (const isError of ["true", 1, null, "yes", [], {}, 0, "false"]) {
      assert.equal(toolValue({ isError, content: [text("ok")] }), "ok", JSON.stringify(isError));
    }
    assert.throws(() => toolValue({ isError: true, content: [text("x")] }), ToolError);
  });

  test("structuredContent null, a string, a number or a boolean is passed over: the text decides", () => {
    for (const structuredContent of [null, "s", "", 5, 0, true, false]) {
      assert.strictEqual(toolValue({ structuredContent, content: [text("12")] }), 12, JSON.stringify(structuredContent));
      assert.strictEqual(toolValue({ structuredContent }), null, JSON.stringify(structuredContent));
      assert.strictEqual(toolValue({ structuredContent, content: [image] }), null, JSON.stringify(structuredContent));
    }
  });

  test("structuredContent that is a list counts as an object and is returned as it is", () => {
    const list = [1, { a: 2 }];
    assert.deepEqual(toolValue({ structuredContent: list, content: [text("other")] }), [1, { a: 2 }]);
    assert.deepEqual(toolValue({ structuredContent: [] }), []);
  });

  test("content that is not a list counts as empty", () => {
    for (const content of [null, "abc", { type: "text", text: "x" }, 5, true]) {
      assert.strictEqual(toolValue({ content }), null, JSON.stringify(content));
      assert.strictEqual(toolValue({ content, structuredContent: { a: 1 } }).a, 1, JSON.stringify(content));
      assert.throws(() => toolValue({ isError: true, content }), (err) => err instanceof ToolError && err.message === "the tool failed", JSON.stringify(content));
    }
  });

  test("an item of content that is null or not an object is left out", () => {
    assert.strictEqual(toolValue({ content: [null, 5, "text", true, text("a"), undefined, ["text"]] }), "a");
    assert.strictEqual(toolValue({ content: [null] }), null);
    assert.strictEqual(toolValue({ content: [5, "text"] }), null);
    assert.strictEqual(toolValue({ content: [text("x"), null, text("y")] }), "x\ny");
    assert.throws(() => toolValue({ isError: true, content: [null, text("bad")] }), (err) => err.message === "bad");
  });

  test("a text item whose text is absent or null counts as the empty string", () => {
    assert.strictEqual(toolValue({ content: [{ type: "text" }] }), "");
    assert.strictEqual(toolValue({ content: [{ type: "text", text: null }] }), "");
    assert.strictEqual(toolValue({ content: [text("a"), { type: "text", text: null }, text("b")] }), "a\n\nb");
    assert.throws(() => toolValue({ isError: true, content: [{ type: "text" }] }), (err) => err.message === "the tool failed");
  });

  test("any other text that is not a string counts as String(text)", () => {
    assert.strictEqual(toolValue({ content: [{ type: "text", text: 5 }] }), 5);
    assert.strictEqual(toolValue({ content: [{ type: "text", text: 1.5 }] }), 1.5);
    assert.strictEqual(toolValue({ content: [{ type: "text", text: true }] }), true);
    assert.strictEqual(toolValue({ content: [{ type: "text", text: [1, 2] }] }), "1,2");
    assert.throws(() => toolValue({ isError: true, content: [{ type: "text", text: 7 }] }), (err) => err.message === "7");
  });
});
