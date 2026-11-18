import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toolValue, ToolError, formatRun, cutAnswer } from "../src/index.js";
import { deepFreeze, printedBy } from "./helpers.js";

const text = (s) => ({ type: "text", text: s });
const image = { type: "image", data: "AAAA", mimeType: "image/png" };

const toolError = (result) => {
  try {
    toolValue(result);
  } catch (err) {
    assert.ok(err instanceof ToolError, `expected a ToolError, got ${err}`);
    return err;
  }
  assert.fail("expected toolValue to throw");
};

describe("toolValue: isError", () => {
  test("throws a ToolError whose message is the text", () => {
    const err = toolError({ isError: true, content: [text("no such row")] });
    assert.ok(err instanceof Error);
    assert.equal(err.name, "ToolError");
    assert.equal(err.message, "no such row");
  });

  test("the text of several items is joined by a line break; other items are left out", () => {
    assert.equal(toolError({ isError: true, content: [text("one"), image, text("two")] }).message, "one\ntwo");
  });

  test("no text: `the tool failed`", () => {
    for (const result of [
      { isError: true },
      { isError: true, content: [] },
      { isError: true, content: [image] },
      { isError: true, content: [text("")] },
      { isError: true, content: [text("")] , structuredContent: { a: 1 } },
    ]) {
      assert.equal(toolError(result).message, "the tool failed", JSON.stringify(result));
    }
  });

  test("isError wins over structuredContent and over a text that is JSON", () => {
    assert.equal(toolError({ isError: true, structuredContent: { a: 1 }, content: [text("12")] }).message, "12");
  });

  test("isError false or absent is not an error", () => {
    assert.equal(toolValue({ isError: false, content: [text("ok")] }), "ok");
    assert.equal(toolValue({ content: [text("ok")] }), "ok");
  });
});

describe("toolValue: the value", () => {
  test("structuredContent that is an object is the value, over the text", () => {
    assert.deepEqual(toolValue({ structuredContent: { a: 1, b: [2] }, content: [text("other")] }), { a: 1, b: [2] });
    assert.deepEqual(toolValue({ structuredContent: { a: 1 } }), { a: 1 });
    assert.deepEqual(toolValue({ structuredContent: {}, content: [text("12")] }), {});
  });

  test("structuredContent null or absent: the content decides", () => {
    assert.equal(toolValue({ structuredContent: null, content: [text("12")] }), 12);
    assert.equal(toolValue({ content: [text("12")] }), 12);
    assert.equal(toolValue({ structuredContent: null }), null);
  });

  test("no text item: null", () => {
    assert.equal(toolValue({}), null);
    assert.equal(toolValue({ content: [] }), null);
    assert.equal(toolValue({ content: [image] }), null);
    assert.equal(toolValue({ content: [image, image] }), null);
    assert.equal(toolValue({ isError: false }), null);
  });

  test("a text that JSON.parse reads gives its value", () => {
    assert.strictEqual(toolValue({ content: [text("12")] }), 12);
    assert.strictEqual(toolValue({ content: [text('"a"')] }), "a");
    assert.deepEqual(toolValue({ content: [text('{"a":[1,2,{"b":null}]}')] }), { a: [1, 2, { b: null }] });
    assert.deepEqual(toolValue({ content: [text("[1, 2, 3]")] }), [1, 2, 3]);
    assert.strictEqual(toolValue({ content: [text("null")] }), null);
    assert.strictEqual(toolValue({ content: [text("true")] }), true);
    assert.strictEqual(toolValue({ content: [text("-1.5e2")] }), -150);
    assert.strictEqual(toolValue({ content: [text(" 12 \n")] }), 12);
  });

  test("a text that JSON.parse does not read is the text", () => {
    assert.strictEqual(toolValue({ content: [text("hello")] }), "hello");
    assert.strictEqual(toolValue({ content: [text("12abc")] }), "12abc");
    assert.strictEqual(toolValue({ content: [text("{'a': 1}")] }), "{'a': 1}");
    assert.strictEqual(toolValue({ content: [text("a\nb")] }), "a\nb");
    assert.strictEqual(toolValue({ content: [text("undefined")] }), "undefined");
  });

  test("a text item whose text is empty is a text item: its text, the empty text", () => {
    assert.strictEqual(toolValue({ content: [text("")] }), "");
  });

  test("several text items are joined by a line break before the text is read", () => {
    assert.deepEqual(toolValue({ content: [text("[1,"), text("2]")] }), [1, 2]);
    assert.strictEqual(toolValue({ content: [text("first"), text("second")] }), "first\nsecond");
    assert.strictEqual(toolValue({ content: [text("a"), image, text("b")] }), "a\nb");
    assert.strictEqual(toolValue({ content: [image, text("7")] }), 7);
  });

  test("an item that is not of type text is left out even when it has a text field", () => {
    assert.strictEqual(toolValue({ content: [{ type: "resource", text: "no" }, text("yes")] }), "yes");
    assert.strictEqual(toolValue({ content: [{ type: "image", text: "no" }] }), null);
  });
});

describe("formatRun: the value", () => {
  const ok = (value, logs = []) => ({ ok: true, value, logs });

  test("undefined", () => {
    assert.equal(formatRun(ok(undefined)), "undefined");
    assert.equal(formatRun({ ok: true, logs: [] }), "undefined");
  });

  test("a string is the string itself, with no quotes", () => {
    assert.equal(formatRun(ok("hello")), "hello");
    assert.equal(formatRun(ok("")), "");
    assert.equal(formatRun(ok("a\nb \"c\"")), 'a\nb "c"');
  });

  test("anything else is JSON.stringify of it, with no added white space", () => {
    assert.equal(formatRun(ok(5)), "5");
    assert.equal(formatRun(ok(-1.5)), "-1.5");
    assert.equal(formatRun(ok(true)), "true");
    assert.equal(formatRun(ok(null)), "null");
    assert.equal(formatRun(ok([1, "a", null])), '[1,"a",null]');
    assert.equal(formatRun(ok({ a: 1, b: [1, 2], c: { d: "x" } })), '{"a":1,"b":[1,2],"c":{"d":"x"}}');
    assert.equal(formatRun(ok({})), "{}");
    assert.equal(formatRun(ok([])), "[]");
  });
});

describe("formatRun: the failures", () => {
  const fail = (kind, message, logs = []) => ({ ok: false, error: { kind, message }, logs });

  test("kind error", () => {
    assert.equal(formatRun(fail("error", "boom")), "The program failed: boom");
    assert.equal(formatRun(fail("error", "TypeError: x is not a function")), "The program failed: TypeError: x is not a function");
    assert.equal(formatRun(fail("error", "two\nlines")), "The program failed: two\nlines");
  });

  test("kind timeout: the seconds are String(timeoutSeconds), always `seconds`", () => {
    assert.equal(formatRun(fail("timeout", "ignored")), "The program was stopped after 60 seconds.");
    assert.equal(formatRun(fail("timeout", "ignored"), {}), "The program was stopped after 60 seconds.");
    assert.equal(formatRun(fail("timeout", "ignored"), { timeoutSeconds: 0.5 }), "The program was stopped after 0.5 seconds.");
    assert.equal(formatRun(fail("timeout", "ignored"), { timeoutSeconds: 1 }), "The program was stopped after 1 seconds.");
    assert.equal(formatRun(fail("timeout", "ignored"), { timeoutSeconds: 90 }), "The program was stopped after 90 seconds.");
    assert.equal(formatRun(fail("timeout", "ignored"), { timeoutSeconds: 3600 }), "The program was stopped after 3600 seconds.");
  });

  test("kind crash", () => {
    assert.equal(formatRun(fail("crash", "exit code 1")), "The program's process ended before it answered (exit code 1).");
    assert.equal(formatRun(fail("crash", "signal SIGKILL")), "The program's process ended before it answered (signal SIGKILL).");
  });

  test("the timeout does not change the other texts", () => {
    assert.equal(formatRun(fail("error", "boom"), { timeoutSeconds: 5 }), "The program failed: boom");
    assert.equal(formatRun({ ok: true, value: 1, logs: [] }, { timeoutSeconds: 5 }), "1");
  });
});

describe("formatRun: the logs", () => {
  test("only when logs is not empty: a line break, the line, a line break, the logs joined by a line break", () => {
    assert.equal(formatRun({ ok: true, value: 5, logs: ["a", "b"] }), "5\n--- console.log ---\na\nb");
    assert.equal(formatRun({ ok: true, value: 5, logs: ["only"] }), "5\n--- console.log ---\nonly");
  });

  test("empty logs add nothing", () => {
    assert.equal(formatRun({ ok: true, value: 5, logs: [] }), "5");
    assert.equal(formatRun({ ok: false, error: { kind: "error", message: "m" }, logs: [] }), "The program failed: m");
  });

  test("the logs follow every kind of result", () => {
    assert.equal(formatRun({ ok: true, value: undefined, logs: ["x"] }), "undefined\n--- console.log ---\nx");
    assert.equal(formatRun({ ok: true, value: "s", logs: ["x"] }), "s\n--- console.log ---\nx");
    assert.equal(formatRun({ ok: true, value: { a: 1 }, logs: ["x"] }), '{"a":1}\n--- console.log ---\nx');
    assert.equal(
      formatRun({ ok: false, error: { kind: "error", message: "boom" }, logs: ["before"] }),
      "The program failed: boom\n--- console.log ---\nbefore",
    );
    assert.equal(
      formatRun({ ok: false, error: { kind: "timeout", message: "m" }, logs: ["l1", "l2"] }, { timeoutSeconds: 2 }),
      "The program was stopped after 2 seconds.\n--- console.log ---\nl1\nl2",
    );
    assert.equal(
      formatRun({ ok: false, error: { kind: "crash", message: "gone" }, logs: ["l"] }),
      "The program's process ended before it answered (gone).\n--- console.log ---\nl",
    );
  });

  test("each log is kept as it is, an empty log included", () => {
    assert.equal(formatRun({ ok: true, value: 1, logs: ["a b", "", "c"] }), "1\n--- console.log ---\na b\n\nc");
  });
});

describe("cutAnswer", () => {
  const notice = (n, limit) => `\n[cut: the answer was ${n} characters, the limit is ${limit}]`;
  const digits = (n) => Array.from({ length: n }, (_, i) => String(i % 10)).join("");

  test("a text no longer than the limit is returned unchanged", () => {
    assert.equal(cutAnswer("", 100), "");
    assert.equal(cutAnswer("short", 100), "short");
    const exact = digits(100);
    assert.equal(cutAnswer(exact, 100), exact);
    const exactDefault = digits(8000);
    assert.equal(cutAnswer(exactDefault), exactDefault);
  });

  test("one character over: cut to exactly the limit, the start of the text then the notice", () => {
    const long = digits(101);
    const n = notice(101, 100);
    assert.equal(cutAnswer(long, 100), long.slice(0, 100 - n.length) + n);
    assert.equal(cutAnswer(long, 100).length, 100);
  });

  test("a longer text: exactly the limit characters, the notice at the end", () => {
    const long = digits(300);
    const n = notice(300, 100);
    const got = cutAnswer(long, 100);
    assert.equal(got.length, 100);
    assert.equal(got, long.slice(0, 100 - n.length) + n);
    assert.ok(got.endsWith("\n[cut: the answer was 300 characters, the limit is 100]"));
  });

  test("another limit", () => {
    const long = digits(2500);
    const n = notice(2500, 1000);
    assert.equal(cutAnswer(long, 1000), long.slice(0, 1000 - n.length) + n);
    assert.equal(cutAnswer(long, 1000).length, 1000);
  });

  test("the default limit is 8000", () => {
    const long = digits(8001);
    const n = notice(8001, 8000);
    const got = cutAnswer(long);
    assert.equal(got.length, 8000);
    assert.equal(got, long.slice(0, 8000 - n.length) + n);
  });

  test("n is text.length in digits, with no separator", () => {
    const long = digits(1234567);
    const n = notice(1234567, 100);
    assert.equal(n.includes("1234567"), true);
    assert.equal(cutAnswer(long, 100), long.slice(0, 100 - n.length) + n);
  });

  test("the notice starts with a single line break", () => {
    const got = cutAnswer(digits(500), 100);
    const at = got.indexOf("[cut:");
    assert.equal(got[at - 1], "\n");
    assert.notEqual(got[at - 2], "\n");
  });

  test("characters are counted as String.prototype.length counts them", () => {
    // 60 emoji are 120 units: longer than 100, though 60 characters to the eye
    const emoji = "😀".repeat(60);
    assert.equal(emoji.length, 120);
    const got = cutAnswer(emoji, 100);
    assert.equal(got.length, 100);
    assert.ok(got.endsWith(notice(120, 100)));
    // 50 emoji are exactly 100 units: not cut
    assert.equal(cutAnswer("😀".repeat(50), 100), "😀".repeat(50));
  });

  test("a text that is not a string throws TypeError", () => {
    for (const bad of [5, null, undefined, {}, ["a"], true, Symbol.iterator]) {
      assert.throws(() => cutAnswer(bad, 100), TypeError, String(typeof bad));
    }
    assert.throws(() => cutAnswer(undefined), TypeError);
  });
});

describe("purity", () => {
  test("none of them changes its arguments or prints", () => {
    const result = deepFreeze({ isError: false, structuredContent: null, content: [text("[1,2]"), image] });
    const run = deepFreeze({ ok: true, value: { a: [1] }, logs: ["x"] });
    const opts = deepFreeze({ timeoutSeconds: 2 });
    const printed = printedBy(() => {
      toolValue(result);
      formatRun(run, opts);
      cutAnswer("x".repeat(500), 100);
      try {
        toolValue(deepFreeze({ isError: true, content: [text("e")] }));
      } catch {}
    });
    assert.deepEqual(printed, []);
  });
});
