import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder } from "./helpers.js";

const TYPEOF_PROCESS = "return typeof process";

describe("how the text is run: its value", () => {
  const cases = [
    ["1 + 1", 2],
    ["const a = 2; a * 3", 6],
    ["return 5", 5],
    ["const a = 1", undefined],
    ["({ a: 1 })", { a: 1 }],
    ["", undefined],
    ["   \n\t  ", undefined],
    [" \n\t ﻿  ", undefined],
    ["1 + 1;", 2],
    ["const a = 1\nconst b = 2\na + b", 3],
    ["Math.max(\n  1,\n  5,\n  3\n)", 5],
    ["const a = 1;\nconst b = Math.max(\n  a,\n  4\n);\nb", 4],
    ["1 + 1 // two", 2],
    ["1 + 1 /* two */", 2],
    ["1 + 1; // two", 2],
    ["1 + 1\n// done\n/* more\n lines */", 2],
    ["const a = 4\na * 2 // double\n// end", 8],
    ['"a;b"', "a;b"],
    ['const u = "http://x"; u', "http://x"],
    ["let x; x = 5", 5],
    ["null", null],
    ["0", 0],
    ["false", false],
    ['""', ""],
    ["// only a comment", undefined],
    ["1\nconst a = 2", undefined],
    ["if (true) { return 1 }\n2", 1],
    ["if (false) { return 1 }\n2", 2],
    ["const f = () => { return 1 }; f() + 1", 2],
    ["Promise.resolve(7)", 7],
    ["const f = async () => 8; f()", 8],
    ["await Promise.resolve(3)", 3],
    ["const a = await Promise.resolve(3);\na + 1", 4],
    ["const f = () => 1; f", undefined],
    ['Symbol("x")', undefined],
  ];
  for (const [code, value] of cases) {
    test(JSON.stringify(code), async () => {
      expectOk(await runProgram(code), value);
    });
  }

  test("the value of the program is read from the tool answer, awaited, at the top level", async () => {
    const callTool = recorder(async () => ({ rows: [1, 2, 3] }));
    const r = await runProgram("const r = await tools.p.rows({});\nr.rows.length", {
      tools: { p: ["rows"] },
      callTool,
    });
    expectOk(r, 3);
  });

  test("a rejected last promise is a fault of kind error", async () => {
    expectFail(await runProgram('Promise.reject(new Error("nope"))'), "error", "Error: nope");
  });

  test("the second argument may be left out", async () => {
    expectOk(await runProgram("1 + 1"), 2);
    expectOk(await runProgram("1 + 1", {}), 2);
  });
});

describe("how the text is run: the value as JSON", () => {
  test("it is JSON.parse(JSON.stringify(value))", async () => {
    const r = await runProgram(
      "return { d: new Date(0), u: undefined, n: NaN, i: Infinity, a: [undefined, () => 1, 2], m: new Map([[1, 2]]), t: { toJSON() { return 5 } } }",
    );
    expectOk(r, { d: "1970-01-01T00:00:00.000Z", n: null, i: null, a: [null, null, 2], m: {}, t: 5 });
  });

  test("a function, a symbol and undefined give undefined", async () => {
    expectOk(await runProgram("return () => 1"), undefined);
    expectOk(await runProgram('return Symbol("s")'), undefined);
    expectOk(await runProgram("return undefined"), undefined);
  });

  test("a cycle cannot be sent", async () => {
    expectFail(
      await runProgram("const a = {}; a.a = a; return a"),
      "error",
      "the value cannot be sent as JSON",
    );
  });

  test("a BigInt cannot be sent", async () => {
    expectFail(await runProgram("return 1n"), "error", "the value cannot be sent as JSON");
  });

  test("a string with line breaks, quotes and characters outside the basic plane arrives whole", async () => {
    const s = 'a\nb\r\nc d e "q" \\ \u{1F600} \u0000 end';
    const r = await runProgram("return " + JSON.stringify(s) + ";");
    expectOk(r, s);
  });

  test("a large value arrives whole, and so do many lines", async () => {
    const r = await runProgram(
      'for (let i = 0; i < 2000; i++) console.log("line " + i + " " + "y".repeat(80));\nreturn "x".repeat(1000000)',
    );
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.length, 1000000);
    assert.strictEqual(r.logs.length, 2000);
    assert.strictEqual(r.logs[1999], "line 1999 " + "y".repeat(80));
  });
});

describe("what the program finds: the language", () => {
  test("every standard built-in", async () => {
    const names = [
      "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Date", "RegExp",
      "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
      "AggregateError", "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
      "Proxy", "Reflect", "JSON", "Math", "ArrayBuffer", "DataView", "Uint8Array", "Float64Array",
      "BigInt64Array", "Atomics", "globalThis", "parseInt", "parseFloat", "isNaN", "isFinite", "eval",
      "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "NaN", "Infinity", "undefined",
    ];
    const r = await runProgram(
      "const names = " + JSON.stringify(names) + ";\n" +
        'return names.filter((n) => typeof globalThis[n] === "undefined" && n !== "undefined");',
    );
    expectOk(r, []);
  });

  test("they work", async () => {
    const r = await runProgram(
      'return [JSON.stringify({ a: 1 }), Math.max(1, 2), new Date(0).getTime(), [...new Map([[1, 2]])].length, eval("1 + 1"), new Set([1, 1]).size, await Promise.all([1, 2])]',
    );
    expectOk(r, ['{"a":1}', 2, 0, 1, 2, 1, [1, 2]]);
  });

  test("setTimeout and clearTimeout", async () => {
    expectOk(await runProgram("await new Promise((r) => setTimeout(r, 20));\n'done'"), "done");
    expectOk(await runProgram("await new Promise((r) => setTimeout(r, 1, 9))"), 9);
    expectOk(
      await runProgram(
        "let hit = 0;\nconst t = setTimeout(() => { hit = 1 }, 10);\nclearTimeout(t);\nawait new Promise((r) => setTimeout(r, 60));\nhit",
      ),
      0,
    );
    expectOk(
      await runProgram(
        "const order = [];\nsetTimeout(() => order.push('b'), 30);\nsetTimeout(() => order.push('a'), 5);\nawait new Promise((r) => setTimeout(r, 80));\nreturn order",
      ),
      ["a", "b"],
    );
  });
});

describe("what the program finds: console", () => {
  test("log, info, warn, error and debug each add a line, in order", async () => {
    const r = await runProgram(
      'console.log("1"); console.info("2"); console.warn("3"); console.error("4"); console.debug("5"); console.log("6")',
    );
    expectOk(r, undefined, ["1", "2", "3", "4", "5", "6"]);
  });

  test("the arguments are turned to text and joined by one space", async () => {
    const r = await runProgram(
      [
        'console.log("a", undefined, { x: 1 }, 5, null, [1], true)',
        'console.log("a", "")',
        "console.log()",
        'console.log("")',
        "console.log(NaN)",
        'console.log(["s"])',
        "console.log(new Date(0))",
        'console.log("two\\nlines")',
        "console.log(undefined)",
        "console.log(() => 1)",
        'console.log(Symbol("s"))',
        "console.log(1n)",
        "const c = {}; c.c = c; console.log(c)",
        'console.log(new Error("x"))',
        'console.log("é\\u2028\\u{1F600}")',
      ].join("\n"),
    );
    expectOk(r, undefined, [
      'a undefined {"x":1} 5 null [1] true',
      "a ",
      "",
      "",
      "null",
      '["s"]',
      '"1970-01-01T00:00:00.000Z"',
      "two\nlines",
      "undefined",
      "() => 1",
      "Symbol(s)",
      "1",
      "[object Object]",
      "{}",
      "é \u{1F600}",
    ]);
  });

  test("the lines printed before a throw reach the caller", async () => {
    const r = await runProgram('console.log("a"); console.log("b", 2); throw new Error("x")');
    expectFail(r, "error", "Error: x", ["a", "b 2"]);
  });

  test("the lines printed by a program that ends well come with its value", async () => {
    expectOk(await runProgram('console.log("a");\n41 + 1'), 42, ["a"]);
  });
});

describe("what the program does not find", () => {
  test("typeof process, require, fetch, module, Buffer and WebSocket", async () => {
    const r = await runProgram(
      "return [typeof process, typeof require, typeof fetch, typeof module, typeof Buffer, typeof WebSocket]",
    );
    expectOk(r, Array(6).fill("undefined"));
  });

  test("they are not on globalThis either", async () => {
    const r = await runProgram(
      'return ["process", "require", "fetch", "module", "Buffer", "WebSocket"].map((n) => typeof globalThis[n])',
    );
    expectOk(r, Array(6).fill("undefined"));
  });

  test("import() of a module of Node rejects", async () => {
    const r = await runProgram(
      'try { await import("node:fs"); return "loaded" } catch (e) { return "rejected" }',
    );
    expectOk(r, "rejected");
  });

  test("any other import() rejects", async () => {
    const r = await runProgram(
      [
        "const out = [];",
        'for (const spec of ["fs", "./x.js", "data:text/javascript,export default 1", "node:child_process"]) {',
        '  try { await import(spec); out.push("loaded") } catch (e) { out.push("rejected") }',
        "}",
        "return out",
      ].join("\n"),
    );
    expectOk(r, Array(4).fill("rejected"));
  });

  test("an import() that is not caught is a fault of the program", async () => {
    const r = await runProgram('await import("node:fs")');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.kind, "error");
  });

  test("a static import line is a syntax error", async () => {
    expectFail(await runProgram('import fs from "node:fs";\n1'), "error", /^SyntaxError: /);
    expectFail(await runProgram('import { readFileSync } from "node:fs"'), "error", /^SyntaxError: /);
  });

  describe("the function constructor reaches no more", () => {
    const tools = { s: ["t"] };
    const paths = [
      ["a function of the program", "(function () {}).constructor(TYPEOF)()"],
      ["Function itself", 'Function("return typeof process")()'],
      ["eval", 'eval("typeof process")'],
      ["tools", "tools.constructor.constructor(TYPEOF)()"],
      ["a server object under tools", "tools.s.constructor.constructor(TYPEOF)()"],
      ["a function under tools", "tools.s.t.constructor(TYPEOF)()"],
      ["the prototype of a function under tools", "Object.getPrototypeOf(tools.s.t).constructor(TYPEOF)()"],
      ["console.log", "console.log.constructor(TYPEOF)()"],
      ["console", "console.constructor.constructor(TYPEOF)()"],
    ];
    for (const [name, expr] of paths) {
      test(name, async () => {
        const code = "return " + expr.replace(/TYPEOF/g, JSON.stringify(TYPEOF_PROCESS)) + ";";
        expectOk(await runProgram(code, { tools, callTool: recorder() }), "undefined");
      });
    }

    test("an async function made from the constructor", async () => {
      const r = await runProgram(
        `const AsyncFunction = (async () => {}).constructor;\nreturn await AsyncFunction(${JSON.stringify(TYPEOF_PROCESS)})();`,
      );
      expectOk(r, "undefined");
    });

    test("an error thrown by a tool call", async () => {
      const callTool = recorder(async () => {
        throw new Error("x");
      });
      const r = await runProgram(
        `try { await tools.s.t({}) } catch (e) { return [e.constructor.constructor(${JSON.stringify(TYPEOF_PROCESS)})(), Object.getPrototypeOf(e).constructor.constructor(${JSON.stringify(TYPEOF_PROCESS)})()] }`,
        { tools, callTool },
      );
      expectOk(r, ["undefined", "undefined"]);
    });

    test("an error thrown by a tool call that threw something that is no Error", async () => {
      const callTool = recorder(async () => {
        throw { message: "m", constructor: process.constructor };
      });
      const r = await runProgram(
        `try { await tools.s.t({}) } catch (e) { return e.constructor.constructor(${JSON.stringify(TYPEOF_PROCESS)})() }`,
        { tools, callTool },
      );
      expectOk(r, "undefined");
    });

    test("a value a tool call returned", async () => {
      const callTool = recorder(async () => ({ a: 1, list: [1] }));
      const r = await runProgram(
        `const v = await tools.s.t({});\nreturn [v.constructor.constructor(${JSON.stringify(TYPEOF_PROCESS)})(), v.list.constructor.constructor(${JSON.stringify(TYPEOF_PROCESS)})(), v.__proto__.constructor.constructor(${JSON.stringify(TYPEOF_PROCESS)})()]`,
        { tools, callTool },
      );
      expectOk(r, ["undefined", "undefined", "undefined"]);
    });
  });
});
