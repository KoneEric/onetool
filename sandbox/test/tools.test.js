import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, sleep } from "./helpers.js";

describe("what the program finds: tools", () => {
  test("an object per server, a function per listed name", async () => {
    const r = await runProgram(
      "return [typeof tools, Object.keys(tools), Object.keys(tools.a), Object.keys(tools.b), typeof tools.a.x, typeof tools.a.y, typeof tools.b.z]",
      { tools: { a: ["x", "y"], b: ["z"] }, callTool: recorder() },
    );
    expectOk(r, ["object", ["a", "b"], ["x", "y"], ["z"], "function", "function", "function"]);
  });

  test("tools is an object when no tool is named", async () => {
    expectOk(await runProgram("return [typeof tools, Object.keys(tools)]"), ["object", []]);
    expectOk(await runProgram("return [typeof tools, Object.keys(tools.a)]", { tools: { a: [] } }), [
      "object",
      [],
    ]);
  });

  test("a tool is an async function: its call gives a promise", async () => {
    const r = await runProgram("const p = tools.a.x({});\nconst isThenable = typeof p.then;\nawait p;\nisThenable", {
      tools: { a: ["x"] },
      callTool: recorder(),
    });
    expectOk(r, "function");
  });

  test("names that are no identifiers are reached with brackets", async () => {
    const callTool = recorder(async () => "got");
    const r = await runProgram('return await tools["my server"]["get-rows"]({ n: 1 })', {
      tools: { "my server": ["get-rows"] },
      callTool,
    });
    expectOk(r, "got");
    assert.deepStrictEqual(callTool.calls, [["my server", "get-rows", { n: 1 }]]);
  });

  test("a name that is not listed is undefined", async () => {
    const r = await runProgram(
      "return [typeof tools.a.nope, typeof tools.nope, typeof tools.b]",
      { tools: { a: ["x"] }, callTool: recorder() },
    );
    expectOk(r, ["undefined", "undefined", "undefined"]);
  });

  test("calling a name that is not listed is the usual TypeError", async () => {
    const callTool = recorder();
    const r = await runProgram("await tools.a.nope({})", { tools: { a: ["x"] }, callTool });
    expectFail(r, "error", /^TypeError: .*is not a function$/);
    assert.strictEqual(callTool.calls.length, 0);
    const r2 = await runProgram("const x = 1; x()");
    expectFail(r2, "error", "TypeError: x is not a function");
  });
});

describe("a tool call: the arguments", () => {
  async function receivedBy(code, tools = { s: ["t"] }) {
    const callTool = recorder(async () => undefined);
    const r = await runProgram(code, { tools, callTool });
    return { r, calls: callTool.calls };
  }

  test("callTool gets the server, the tool and the arguments", async () => {
    const { r, calls } = await receivedBy("await tools.s.t({ n: 1, s: 'x', nested: { a: [1, 2] } })");
    expectOk(r, undefined);
    assert.deepStrictEqual(calls, [["s", "t", { n: 1, s: "x", nested: { a: [1, 2] } }]]);
  });

  test("the arguments go through JSON", async () => {
    const { r, calls } = await receivedBy(
      "await tools.s.t({ d: new Date(0), u: undefined, f() {}, n: NaN, k: [undefined] })",
    );
    expectOk(r, undefined);
    assert.deepStrictEqual(calls, [["s", "t", { d: "1970-01-01T00:00:00.000Z", n: null, k: [null] }]]);
  });

  test("no argument and undefined arrive as {}", async () => {
    const { r, calls } = await receivedBy("await tools.s.t();\nawait tools.s.t(undefined)");
    expectOk(r, undefined);
    assert.deepStrictEqual(calls, [
      ["s", "t", {}],
      ["s", "t", {}],
    ]);
  });

  test("more arguments than one are dropped", async () => {
    const { r, calls } = await receivedBy("await tools.s.t({ a: 1 }, { b: 2 }, 3)");
    expectOk(r, undefined);
    assert.deepStrictEqual(calls, [["s", "t", { a: 1 }]]);
  });

  test("arguments with line breaks, quotes and characters outside the basic plane arrive whole", async () => {
    const s = 'a\nb c "q" \\ \u{1F600} \u0000';
    const { calls } = await receivedBy("await tools.s.t({ s: " + JSON.stringify(s) + " })");
    assert.deepStrictEqual(calls, [["s", "t", { s }]]);
  });

  test("arguments JSON cannot hold: the call throws in the program and callTool is not called", async () => {
    const { r, calls } = await receivedBy(
      [
        "const c = {}; c.c = c;",
        "const out = [];",
        "for (const bad of [c, 1n, { n: 2n }]) {",
        "  try { await tools.s.t(bad); out.push('no throw') }",
        "  catch (e) { out.push([e instanceof Error, e.message]) }",
        "}",
        "return out",
      ].join("\n"),
    );
    const one = [true, "the arguments cannot be sent as JSON"];
    expectOk(r, [one, one, one]);
    assert.strictEqual(calls.length, 0);
  });

  test("callTool is called once per call", async () => {
    const { calls } = await receivedBy(
      "await tools.s.t({ n: 1 }); await tools.s.u({ n: 2 }); await tools.s.t({ n: 3 })",
      { s: ["t", "u"] },
    );
    assert.deepStrictEqual(calls, [
      ["s", "t", { n: 1 }],
      ["s", "u", { n: 2 }],
      ["s", "t", { n: 3 }],
    ]);
  });
});

describe("a tool call: the answer", () => {
  const tools = { s: ["t"] };

  test("what callTool resolves with comes back through JSON", async () => {
    const callTool = recorder(async () => ({ a: 1, d: new Date(0), u: undefined, n: NaN, list: [1, "x"] }));
    const r = await runProgram("return await tools.s.t({})", { tools, callTool });
    expectOk(r, { a: 1, d: "1970-01-01T00:00:00.000Z", n: null, list: [1, "x"] });
  });

  test("undefined stays undefined, null stays null", async () => {
    const answers = [undefined, null, 0, "", "é \u{1F600}\n"];
    let i = 0;
    const callTool = recorder(async () => answers[i++]);
    const r = await runProgram(
      "const out = [];\nfor (let i = 0; i < 5; i++) { const v = await tools.s.t({}); out.push(typeof v === 'undefined' ? 'undef' : v) }\nreturn out",
      { tools, callTool },
    );
    expectOk(r, ["undef", null, 0, "", "é \u{1F600}\n"]);
  });

  test("a large answer comes back whole", async () => {
    const big = "z".repeat(1000000);
    const callTool = recorder(async () => ({ big }));
    const r = await runProgram("return (await tools.s.t({})).big.length", { tools, callTool });
    expectOk(r, 1000000);
  });

  test("a call that rejects throws in the program, with the message of what was thrown", async () => {
    const thrown = [new Error("boom"), new TypeError("typed"), { message: "plain object" }, "a string", 42];
    let i = 0;
    const callTool = recorder(async () => {
      throw thrown[i++];
    });
    const r = await runProgram(
      "const out = [];\nfor (let i = 0; i < 5; i++) { try { await tools.s.t({}); out.push('no throw') } catch (e) { out.push([e instanceof Error, e.message]) } }\nreturn out",
      { tools, callTool },
    );
    expectOk(r, [
      [true, "boom"],
      [true, "typed"],
      [true, "plain object"],
      [true, "a string"],
      [true, "42"],
    ]);
  });

  test("a callTool that throws at once, and not in a promise, is the same", async () => {
    const callTool = (server, tool, args) => {
      throw new Error("at once");
    };
    const r = await runProgram("try { await tools.s.t({}) } catch (e) { return e.message }", { tools, callTool });
    expectOk(r, "at once");
  });

  test("an error that the program does not catch ends it as kind error", async () => {
    const callTool = recorder(async () => {
      throw new Error("boom");
    });
    expectFail(await runProgram("await tools.s.t({})", { tools, callTool }), "error", "Error: boom");
  });

  test("calls may run at the same time, and each gets its own answer", async () => {
    const callTool = recorder(async (server, tool, args) => {
      await sleep(args.wait);
      return { echo: args.id };
    });
    const r = await runProgram(
      "const rs = await Promise.all([tools.s.t({ id: 'a', wait: 90 }), tools.s.t({ id: 'b', wait: 10 }), tools.s.t({ id: 'c', wait: 50 })]);\nreturn rs.map((x) => x.echo)",
      { tools, callTool },
    );
    expectOk(r, ["a", "b", "c"]);
    assert.strictEqual(callTool.calls.length, 3);
  });

  test("calls that wait for each other are all in flight at once", async () => {
    let arrived = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const giveUp = setTimeout(() => release("gave up"), 10000);
    const callTool = recorder(async (server, tool, args) => {
      arrived++;
      if (arrived === 3) release("open");
      const how = await gate;
      return how + args.id;
    });
    const r = await runProgram(
      "const rs = await Promise.all([1, 2, 3].map((id) => tools.s.t({ id }))); return rs",
      { tools, callTool, timeoutMs: 20000 },
    );
    clearTimeout(giveUp);
    expectOk(r, ["open1", "open2", "open3"]);
  });
});

describe("a tool call: calls still waiting at the end", () => {
  const tools = { s: ["t"] };

  test("callTool is never called after the promise has resolved, after a stop at the limit", async () => {
    let resolved = false;
    let late = 0;
    const callTool = recorder(async () => {
      if (resolved) late++;
      return 1;
    });
    const r = await runProgram("while (true) { await tools.s.t({}) }", { tools, callTool, timeoutMs: 400 });
    resolved = true;
    expectFail(r, "timeout", "stopped after 400 ms");
    assert.ok(callTool.calls.length > 0);
    await sleep(300);
    assert.strictEqual(late, 0);
  });

  test("a call still waiting when the program returns: its answer is dropped", async () => {
    let resolved = false;
    let late = 0;
    let finish;
    const callTool = recorder(async () => {
      if (resolved) late++;
      await new Promise((resolve) => (finish = resolve));
      return "late answer";
    });
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const r = await runProgram("tools.s.t({});\nawait new Promise((r) => setTimeout(r, 250));\nreturn 'ended'", {
        tools,
        callTool,
      });
      resolved = true;
      expectOk(r, "ended");
      assert.strictEqual(callTool.calls.length, 1);
      finish();
      await sleep(200);
      assert.strictEqual(late, 0);
      assert.deepStrictEqual(failures, []);
    } finally {
      finish?.();
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });

  test("a call still waiting when the program is stopped: its answer or its error is dropped", async () => {
    let rejectCall;
    const callTool = recorder(() => new Promise((_, reject) => (rejectCall = reject)));
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      const r = await runProgram("await tools.s.t({})", { tools, callTool, timeoutMs: 300 });
      expectFail(r, "timeout", "stopped after 300 ms");
      rejectCall(new Error("too late"));
      await sleep(150);
      assert.strictEqual(callTool.calls.length, 1);
      assert.deepStrictEqual(failures, []);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  });
});
