import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.js";
import { decide, nextState } from "../src/index.js";

const askMessage = (...args) => core.askMessage(...args);
const askRefusal = (...args) => core.askRefusal(...args);
import { settingsOf, faultOf, deepFreeze, printedBy } from "./helpers.js";

const ALLOWED = { allowed: true };
const asked = (rule) => ({ allowed: true, ask: rule });
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

describe("step 3: the exports", () => {
  test("askMessage and askRefusal are functions of core/src/index.js", () => {
    assert.equal(typeof core.askMessage, "function");
    assert.equal(typeof core.askRefusal, "function");
  });
});

describe("step 3: ask in the settings file", () => {
  const MSG = "onetool.ask: must be a list of patterns";
  const one = (value) => settingsOf({ mcpServers: {}, onetool: { ask: value } }).ask;
  const problemsOf = (onetool) => faultOf({ mcpServers: {}, onetool }).problems;

  test("absent, with onetool absent, empty or given: the default []", () => {
    assert.deepEqual(settingsOf({ mcpServers: {} }).ask, []);
    assert.deepEqual(settingsOf({ mcpServers: {}, onetool: {} }).ask, []);
    assert.deepEqual(settingsOf({ mcpServers: {}, onetool: { searchLimit: 3 } }).ask, []);
  });

  test("a list of patterns, the empty list included, comes back as written: order and repeats kept", () => {
    assert.deepEqual(one([]), []);
    assert.deepEqual(one(["*"]), ["*"]);
    assert.deepEqual(one(["b.*", "a.*", "b.*"]), ["b.*", "a.*", "b.*"]);
    assert.deepEqual(one(["Ünï.*", "*.delete*"]), ["Ünï.*", "*.delete*"]);
  });

  test("readSettings has the key ask, and the keys of before", () => {
    const got = settingsOf({ mcpServers: {}, onetool: { ask: ["p.*"] } });
    assert.ok(Object.hasOwn(got, "ask"));
    assert.deepEqual(Object.keys(got).sort(), [
      "allow",
      "ask",
      "answerLimit",
      "backgroundSeconds",
      "bad",
      "connectSeconds",
      "deny",
      "hostRules",
      "hostServers",
      "libraryCap",
      "log",
      "logFolder",
      "maxJobs",
      "searchLimit",
      "servers",
      "shell",
      "stateLimit",
      "timeoutSeconds",
      "trail",
    ].sort());
  });

  test("the other keys are as before when ask is given", () => {
    const got = settingsOf({
      mcpServers: { s: { command: "node" } },
      onetool: { ask: ["s.*"], allow: ["s.*"], deny: ["s.wipe"], searchLimit: 3 },
    });
    assert.deepEqual(got, {
      servers: [{ name: "s", command: "node", args: [], env: {} }],
      bad: [],
      answerLimit: 8000,
      timeoutSeconds: 60,
      connectSeconds: 30,
      searchLimit: 3,
      stateLimit: 10000000,
      allow: ["s.*"],
      deny: ["s.wipe"],
      ask: ["s.*"],
      shell: null,
      trail: false,
      log: true,
      logFolder: null,
      hostRules: true,
      hostServers: [],
      backgroundSeconds: 7200,
      maxJobs: 3,
      libraryCap: 50,
    });
  });

  test("ask is not an unknown key", () => {
    assert.ok(!problemsOf({ ask: 5, foo: 1 }).includes("onetool.ask: unknown key"));
  });

  test("null, a string, or a list with an item that is not a pattern: the problem", () => {
    const bad = [
      null,
      "x",
      "a.b",
      "",
      5,
      true,
      {},
      [""],
      ["a b"],
      [" a"],
      ["a\tb"],
      ["a\nb"],
      ["ok", ""],
      ["ok", 5],
      ["ok", null],
      ["ok", true],
      [["a"]],
      [{}],
    ];
    for (const v of bad) assert.deepEqual(problemsOf({ ask: v }), [MSG], JSON.stringify(v));
  });

  test("its problem comes last, after the one of deny", () => {
    assert.deepEqual(problemsOf({ ask: 5, deny: 5 }), ["onetool.deny: must be a list of patterns", MSG]);
    assert.deepEqual(problemsOf({ ask: null, deny: "x", answerLimit: 0 }), [
      "onetool.answerLimit: must be a whole number from 100 to 1000000",
      "onetool.deny: must be a list of patterns",
      MSG,
    ]);
  });

  test("it comes last of all the problems of the file", () => {
    const got = faultOf({
      onetool: { ask: 5, deny: 5, allow: 5, stateLimit: 0, searchLimit: 0, zzz: 1 },
    });
    assert.deepEqual(got.problems.slice(0, 3), [
      "mcpServers: missing",
      "onetool.zzz: unknown key",
      "onetool.searchLimit: must be a whole number from 1 to 100",
    ]);
    assert.equal(got.problems.at(-1), MSG);
    assert.equal(got.problems.length, 7);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("the problem holds no value of the file", () => {
    const [p] = problemsOf({ ask: ["SECRET 1"] });
    assert.ok(!p.includes("SECRET"));
    const [q] = problemsOf({ ask: "SECRET-2" });
    assert.ok(!q.includes("SECRET"));
  });

  test("`state` stays an unknown key", () => {
    assert.deepEqual(problemsOf({ state: 1 }), ["onetool.state: unknown key"]);
  });
});

describe("step 3: decide, the rules ask", () => {
  test("the four examples of the meeting point", () => {
    assert.deepEqual(decide({ ask: ["p.*"] }, "p", "wipe"), { allowed: true, ask: "p.*" });
    assert.deepEqual(decide({ deny: ["p.wipe"], ask: ["p.*"] }, "p", "wipe"), denied("p.wipe", "p.wipe"));
    assert.deepEqual(decide({ allow: ["q.*"], ask: ["p.*"] }, "p", "wipe"), notAllowed("p.wipe"));
    assert.deepEqual(decide({ ask: ["*.rows", "p.*"] }, "p", "rows"), asked("*.rows"));
  });

  test("ask empty, absent or undefined, or no pattern matching: { allowed: true }, exactly that key", () => {
    for (const rules of [{}, { ask: [] }, { ask: undefined }, { ask: ["q.*"] }, { ask: ["p.row"], allow: ["p.*"] }]) {
      const got = decide(rules, "p", "rows");
      assert.deepEqual(got, ALLOWED, JSON.stringify(rules));
      assert.deepEqual(Object.keys(got), ["allowed"]);
    }
  });

  test("a match gives exactly the keys allowed and ask", () => {
    const got = decide({ ask: ["p.*"] }, "p", "rows");
    assert.deepEqual(Object.keys(got).sort(), ["allowed", "ask"]);
    assert.equal(got.allowed, true);
    assert.equal(got.ask, "p.*");
  });

  test("the patterns are matched as those of allow and deny: whole id, case counting, stars", () => {
    assert.deepEqual(decide({ ask: ["p.rows"] }, "p", "rows"), asked("p.rows"));
    assert.deepEqual(decide({ ask: ["p.row"] }, "p", "rows"), ALLOWED);
    assert.deepEqual(decide({ ask: ["P.rows"] }, "p", "rows"), ALLOWED);
    assert.deepEqual(decide({ ask: ["*"] }, "p", "rows"), asked("*"));
    assert.deepEqual(decide({ ask: ["*.delete*"] }, "a", "delete_it"), asked("*.delete*"));
    assert.deepEqual(decide({ ask: ["*.delete*"] }, "a", "undelete"), ALLOWED);
    assert.deepEqual(decide({ ask: ["a.*"] }, "a", "b.c.d"), asked("a.*"));
    assert.deepEqual(decide({ ask: ["p.a+b"] }, "p", "aab"), ALLOWED);
    assert.deepEqual(decide({ ask: ["p.a+b"] }, "p", "a+b"), asked("p.a+b"));
    assert.deepEqual(decide({ ask: ["日本.*"] }, "日本", "rows"), asked("日本.*"));
  });

  test("the first pattern of the list that matches is named, as written", () => {
    assert.deepEqual(decide({ ask: ["x.*", "p.*", "*.wipe", "*"] }, "p", "wipe"), asked("p.*"));
    assert.deepEqual(decide({ ask: ["*.wipe", "p.*"] }, "p", "wipe"), asked("*.wipe"));
    assert.deepEqual(decide({ ask: ["*", "p.wipe"] }, "p", "wipe"), asked("*"));
    assert.deepEqual(decide({ ask: ["p.*", "p.*"] }, "p", "wipe"), asked("p.*"));
  });

  test("an allowed call (allow not empty and matching) is asked about when ask matches", () => {
    assert.deepEqual(decide({ allow: ["p.*"], ask: ["p.wipe"] }, "p", "wipe"), asked("p.wipe"));
    assert.deepEqual(decide({ allow: ["p.*"], ask: ["p.wipe"] }, "p", "rows"), ALLOWED);
  });

  test("a deny that does not match, and an ask that does: asked", () => {
    assert.deepEqual(decide({ deny: ["q.*"], ask: ["p.*"] }, "p", "rows"), asked("p.*"));
  });

  test("a refusal by deny or by allow is the same as before, whatever ask holds", () => {
    for (const ask of [[], ["p.*"], ["*"], ["q.*"]]) {
      assert.deepEqual(decide({ deny: ["p.wipe"], ask }, "p", "wipe"), denied("p.wipe", "p.wipe"));
      assert.deepEqual(decide({ allow: ["q.*"], ask }, "p", "wipe"), notAllowed("p.wipe"));
      assert.deepEqual(decide({ allow: ["q.*"], deny: ["p.*"], ask }, "p", "wipe"), denied("p.wipe", "p.*"));
    }
    assert.deepEqual(Object.keys(decide({ deny: ["*"], ask: ["*"] }, "a", "b")).sort(), ["allowed", "list", "message", "rule"]);
    assert.deepEqual(Object.keys(decide({ allow: ["x"], ask: ["*"] }, "a", "b")).sort(), ["allowed", "list", "message", "rule"]);
  });

  test("ask null, or not a list: TypeError", () => {
    for (const bad of [null, "p.*", "", "*", 5, true, {}, { 0: "p.*", length: 1 }]) {
      assert.throws(() => decide({ ask: bad }, "p", "wipe"), TypeError, JSON.stringify(bad));
    }
  });

  test("a string for ask is not read letter by letter, and not taken as one pattern", () => {
    assert.throws(() => decide({ ask: "p.wipe" }, "p", "wipe"), TypeError);
    assert.throws(() => decide({ ask: "p.wipe" }, "p", "rows"), TypeError);
  });

  test("it does not change its arguments and prints nothing", () => {
    const rules = deepFreeze({ allow: ["a.*"], deny: ["a.x*"], ask: ["a.y*", "*"] });
    const printed = printedBy(() => {
      assert.deepEqual(decide(rules, "a", "y1"), asked("a.y*"));
      assert.deepEqual(decide(rules, "a", "z"), asked("*"));
      assert.deepEqual(decide(rules, "a", "x1"), denied("a.x1", "a.x*"));
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(rules, { allow: ["a.*"], deny: ["a.x*"], ask: ["a.y*", "*"] });
  });
});

describe("step 3: askMessage", () => {
  test("the example of the meeting point", () => {
    assert.equal(
      askMessage("practice.wipe", "practice.*", {}),
      [
        "onetool: a program wants to call practice.wipe.",
        "Arguments: {}",
        'The rule ask "practice.*" asks for your consent. Allow this call?',
      ].join("\n"),
    );
  });

  test("three lines, no line break at the end", () => {
    const text = askMessage("a.b", "*", { x: 1 });
    assert.equal(text.split("\n").length, 3);
    assert.ok(!text.endsWith("\n"));
    assert.equal(text, 'onetool: a program wants to call a.b.\nArguments: {"x":1}\nThe rule ask "*" asks for your consent. Allow this call?');
  });

  test("the arguments are JSON.stringify(args), with no added white space", () => {
    const args = { city: "Paris", n: [1, 2, { z: null }], ok: true, s: "é \"q\"" };
    assert.equal(askMessage("p.rows", "p.*", args).split("\n")[1], `Arguments: ${JSON.stringify(args)}`);
    assert.equal(askMessage("p.rows", "p.*", { a: 1 }).split("\n")[1], 'Arguments: {"a":1}');
  });

  test("the id and the rule are named as given", () => {
    const lines = askMessage("My Server.do it", "My*.do*", {}).split("\n");
    assert.equal(lines[0], "onetool: a program wants to call My Server.do it.");
    assert.equal(lines[2], 'The rule ask "My*.do*" asks for your consent. Allow this call?');
  });

  test("a JSON text of exactly limit characters is not cut (default 300)", () => {
    // {"k":"<v>"} is 6 + len(v) + 2 characters: 8 + 292 = 300
    const args = { k: "y".repeat(292) };
    assert.equal(JSON.stringify(args).length, 300);
    assert.equal(askMessage("a.b", "*", args).split("\n")[1], `Arguments: ${JSON.stringify(args)}`);
  });

  test("one character over the default limit of 300: cut to 300, then `... (301 characters)`", () => {
    // 8 + 293 = 301
    const args = { k: "y".repeat(293) };
    const json = JSON.stringify(args);
    assert.equal(json.length, 301);
    assert.equal(askMessage("a.b", "*", args).split("\n")[1], `Arguments: ${json.slice(0, 300)}... (301 characters)`);
  });

  test("a long JSON text with the default limit: the first 300 characters, then the whole length", () => {
    // 8 + 400 = 408; first 300 = {"k":" (6) + 294 y
    const args = { k: "y".repeat(400) };
    const expected = `Arguments: {"k":"${"y".repeat(294)}... (408 characters)`;
    assert.equal(askMessage("a.b", "*", args).split("\n")[1], expected);
  });

  test("a limit given: exactly limit is not cut, one over is", () => {
    // {"a":1} is 7 characters
    assert.equal(askMessage("a.b", "*", { a: 1 }, { limit: 7 }).split("\n")[1], 'Arguments: {"a":1}');
    assert.equal(askMessage("a.b", "*", { a: 1 }, { limit: 8 }).split("\n")[1], 'Arguments: {"a":1}');
    assert.equal(askMessage("a.b", "*", { a: 1 }, { limit: 6 }).split("\n")[1], 'Arguments: {"a":1... (7 characters)');
    assert.equal(askMessage("a.b", "*", { a: 1 }, { limit: 1 }).split("\n")[1], "Arguments: {... (7 characters)");
  });

  test("a cut message is still three lines, the first and the last unchanged", () => {
    const lines = askMessage("practice.wipe", "practice.*", { k: "y".repeat(500) }, { limit: 20 }).split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "onetool: a program wants to call practice.wipe.");
    // {"k":" (6) + 14 y = 20 characters; the whole text is 8 + 500 = 508
    assert.equal(lines[1], `Arguments: {"k":"${"y".repeat(14)}... (508 characters)`);
    assert.equal(lines[2], 'The rule ask "practice.*" asks for your consent. Allow this call?');
  });

  test("an empty options object gives the default limit", () => {
    const args = { k: "y".repeat(400) };
    assert.equal(askMessage("a.b", "*", args, {}), askMessage("a.b", "*", args));
  });

  test("it does not change its arguments and prints nothing", () => {
    const args = deepFreeze({ a: [1, { b: 2 }], c: "x".repeat(50) });
    const printed = printedBy(() => {
      askMessage("a.b", "*", args);
      askMessage("a.b", "*", args, { limit: 5 });
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(args, { a: [1, { b: 2 }], c: "x".repeat(50) });
  });
});

describe("step 3: askRefusal", () => {
  const CAUSES = {
    unsupported: "the host program cannot ask the person",
    decline: "the person said no",
    cancel: "the person gave no answer",
    failed: "the question failed",
  };

  test("the example of the meeting point", () => {
    assert.equal(
      askRefusal("practice.wipe", "practice.*", "decline"),
      'onetool: practice.wipe is refused by the rule ask "practice.*": the person said no',
    );
  });

  test("each cause, exact", () => {
    for (const [why, cause] of Object.entries(CAUSES)) {
      assert.equal(askRefusal("a.b", "a.*", why), `onetool: a.b is refused by the rule ask "a.*": ${cause}`, why);
    }
  });

  test("the id and the rule are named as given", () => {
    assert.equal(
      askRefusal("My Server.do it", "*.do*", "cancel"),
      'onetool: My Server.do it is refused by the rule ask "*.do*": the person gave no answer',
    );
  });

  test("any other why: TypeError", () => {
    for (const why of [undefined, null, "accept", "Decline", "DECLINE", " decline", "decline ", "", "other", 5, true, {}, ["decline"]]) {
      assert.throws(() => askRefusal("a.b", "a.*", why), TypeError, String(why));
    }
    assert.throws(() => askRefusal("a.b", "a.*"), TypeError);
  });

  test("it prints nothing", () => {
    assert.deepEqual(printedBy(() => askRefusal("a.b", "a.*", "failed")), []);
  });
});

describe("step 3: two cases stated", () => {
  test("decide with a list as first argument: TypeError", () => {
    assert.throws(() => decide([], "p", "t"), TypeError);
    assert.throws(() => decide(["p.*"], "p", "t"), TypeError);
    assert.throws(() => decide([{ allow: ["p.*"] }], "p", "t"), TypeError);
  });

  test("nextState, an added key that kept already has: it keeps its place and takes the value of after", () => {
    const got = nextState({ a: 1, n: 5, z: 9 }, { a: 1 }, { a: 1, n: 7 });
    assert.deepEqual(got, { state: { a: 1, n: 7, z: 9 }, problem: null });
    assert.deepEqual(Object.keys(got.state), ["a", "n", "z"]);
  });

  test("nextState, that key is not added a second time at the end", () => {
    const got = nextState({ z: 9, n: 5 }, {}, { n: 7, q: 1 });
    // keys of kept in its order (z, n) with n taking after's value, then the added key kept lacks (q)
    assert.deepEqual(Object.keys(got.state), ["z", "n", "q"]);
    assert.deepEqual(got.state, { z: 9, n: 7, q: 1 });
    assert.equal(got.problem, null);
  });

  test("nextState, an added key that kept has with the same value: the key stays in its place", () => {
    const got = nextState({ n: 5, z: 9 }, {}, { n: 5 });
    assert.deepEqual(Object.keys(got.state), ["n", "z"]);
    assert.deepEqual(got.state, { n: 5, z: 9 });
  });

  test("nextState, the limit counts the new object as JSON", () => {
    // {"n":7} is 7 characters: kept at limit 7, refused at limit 6 with the state of kept
    assert.deepEqual(nextState({ n: 5 }, {}, { n: 7 }, { limit: 7 }), { state: { n: 7 }, problem: null });
    assert.deepEqual(nextState({ n: 5 }, {}, { n: 7 }, { limit: 6 }), {
      state: { n: 5 },
      problem: "state was not kept: it is 7 characters as JSON, the limit is 6",
    });
  });

  test("nextState does not change its arguments when it holds this case", () => {
    const kept = deepFreeze({ a: 1, n: 5, z: 9 });
    const before = deepFreeze({ a: 1 });
    const after = deepFreeze({ a: 1, n: 7 });
    nextState(kept, before, after);
    assert.deepEqual(kept, { a: 1, n: 5, z: 9 });
    assert.deepEqual(before, { a: 1 });
    assert.deepEqual(after, { a: 1, n: 7 });
  });
});
