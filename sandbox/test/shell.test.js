import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runProgram } from "../src/index.js";
import { expectOk, expectFail, recorder, childRows, alive, waitFor, sleep } from "./helpers.js";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const isKill = (signal) => signal === "SIGKILL" || signal === 9;
const REFUSED = { read: "refused", write: "refused", spawn: "refused", worker: "refused" };

const OK = { exitCode: 0, stdout: "a\n", stderr: "" };
const TYPEOF_PROCESS = "return typeof process";
const T = JSON.stringify(TYPEOF_PROCESS);

let folder;
let probePath;
before(() => {
  folder = mkdtempSync(join(tmpdir(), "onetool-shell-"));
  probePath = join(folder, "probe-target.txt");
  writeFileSync(probePath, "secret text of the probe file\n");
});
after(() => rmSync(folder, { recursive: true, force: true }));

const settle = async () => assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs");

// A callTool that answers every call with `answer`, and records the calls.
const answering = (answer = OK) => recorder(async () => answer);

const withShell = (code, callTool = answering(), options = {}) => runProgram(code, { shell: true, callTool, ...options });

// The command text of the one call a program makes.
async function commandOf(code) {
  const callTool = answering();
  const r = await withShell(code, callTool);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(callTool.calls.length, 1, `calls: ${JSON.stringify(callTool.calls)}`);
  const [server, tool, args] = callTool.calls[0];
  assert.strictEqual(server, "shell");
  assert.strictEqual(tool, "run");
  assert.deepStrictEqual(Object.keys(args), ["command"]);
  return args.command;
}

function runFixture(...args) {
  const r = spawnSync(process.execPath, [fixture("shell.mjs"), ...args], { encoding: "utf8", timeout: 60000 });
  assert.strictEqual(r.error, undefined, String(r.error));
  return r;
}

function fixtureJson(scenario) {
  const r = runFixture(scenario, probePath);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe("without the argument shell, the sections above hold", () => {
  const names = ["$", "read", "write", "edit"];
  const options = [
    ["no options", undefined],
    ["shell absent", { callTool: answering() }],
    ["shell undefined", { shell: undefined, callTool: answering() }],
    ["shell false", { shell: false, callTool: answering() }],
    ["shell false with tools", { shell: false, tools: { s: ["t"] }, callTool: answering() }],
  ];
  for (const [name, opts] of options) {
    test(`${name}: the four names are undefined`, async () => {
      expectOk(await runProgram("return [typeof $, typeof read, typeof write, typeof edit]", opts), Array(4).fill("undefined"));
      expectOk(
        await runProgram('return ["$", "read", "write", "edit"].map((n) => [typeof globalThis[n], n in globalThis])', opts),
        Array(4).fill(["undefined", false]),
      );
    });
  }

  const uses = [
    ["$", "$`ls`", "$"],
    ["$ as a function", '$("ls")', "$"],
    ["read", 'await read("p")', "read"],
    ["write", 'await write("p", "t")', "write"],
    ["edit", 'await edit("p", "o", "n")', "edit"],
  ];
  for (const [name, code, missing] of uses) {
    test(`a program that uses ${name} fails with the usual ReferenceError`, async () => {
      for (const opts of [undefined, { shell: false }]) {
        const callTool = answering();
        const r = await runProgram(code, { ...opts, callTool });
        expectFail(r, "error", `ReferenceError: ${missing} is not defined`, []);
        assert.strictEqual(callTool.calls.length, 0);
      }
    });
  }

  test("the result has the same keys as before", async () => {
    expectOk(await runProgram("1 + 1", { shell: false }), 2);
    expectOk(await runProgram("console.log('x'); 1 + 1"), 2, ["x"]);
  });

  test("tools with a key shell is an ordinary tool, as before", async () => {
    for (const opts of [{}, { shell: false }]) {
      const callTool = answering("got");
      const r = await runProgram('return await tools.shell.run({ command: "x" })', {
        ...opts,
        tools: { shell: ["run"] },
        callTool,
      });
      expectOk(r, "got");
      assert.deepStrictEqual(callTool.calls, [["shell", "run", { command: "x" }]]);
    }
  });
});

describe("shell true: the four names are made", () => {
  test("each is a function", async () => {
    expectOk(await withShell("return [typeof $, typeof read, typeof write, typeof edit]"), Array(4).fill("function"));
  });

  test("they are globals the program may hide with a declaration of its own", async () => {
    const callTool = answering();
    const r = await withShell(
      "const read = 1; let write = 'w'; const $ = [3]; const edit = { e: 4 };\nreturn [read, write, $, edit]",
      callTool,
    );
    expectOk(r, [1, "w", [3], { e: 4 }]);
    assert.strictEqual(callTool.calls.length, 0);
  });

  test("hiding one leaves the others", async () => {
    const callTool = answering("x");
    const r = await withShell('const read = 1; return [read, await write("p", "t")]', callTool);
    expectOk(r, [1, "x"]);
    assert.deepStrictEqual(callTool.calls, [["shell", "write", { path: "p", text: "t" }]]);
  });

  test("no tool is added to tools, and tools is as the caller gave it", async () => {
    expectOk(await withShell("return [Object.keys(tools), typeof tools.shell, typeof read]"), [[], "undefined", "function"]);
    expectOk(
      await withShell("return [Object.keys(tools), typeof tools.shell, typeof read]", answering(), { tools: { a: ["x"] } }),
      [["a"], "undefined", "function"],
    );
  });

  test("with a key shell in tools, tools.shell.run and a command object reach callTool the same way", async () => {
    const callTool = answering();
    const r = await withShell('await tools.shell.run({ command: "ls" });\nawait $`ls`;\nawait $("ls");\nreturn 1', callTool, {
      tools: { shell: ["run", "read"] },
    });
    expectOk(r, 1);
    assert.deepStrictEqual(callTool.calls, [
      ["shell", "run", { command: "ls" }],
      ["shell", "run", { command: "ls" }],
      ["shell", "run", { command: "ls" }],
    ]);
  });

  test("with a key shell in tools, tools.shell.read and read reach callTool the same way", async () => {
    const callTool = answering("x");
    await withShell('await tools.shell.read({ path: "p" });\nawait read("p")', callTool, { tools: { shell: ["read"] } });
    assert.deepStrictEqual(callTool.calls, [
      ["shell", "read", { path: "p" }],
      ["shell", "read", { path: "p" }],
    ]);
  });
});

describe("shell true: read, write and edit make one tool call each", () => {
  const cases = [
    ["read(path)", 'await read("a.txt")', ["shell", "read", { path: "a.txt" }]],
    ["write(path, text)", 'await write("a.txt", "hi\\n")', ["shell", "write", { path: "a.txt", text: "hi\n" }]],
    ["edit(path, old, new)", 'await edit("a.txt", "x", "y")', ["shell", "edit", { path: "a.txt", old: "x", new: "y" }]],
    ["read with no argument", "await read()", ["shell", "read", {}]],
    ["read with undefined", "await read(undefined)", ["shell", "read", {}]],
    ["write with no text", 'await write("p")', ["shell", "write", { path: "p" }]],
    ["write with text undefined", 'await write("p", undefined)', ["shell", "write", { path: "p" }]],
    ["edit with no new", 'await edit("p", "o")', ["shell", "edit", { path: "p", old: "o" }]],
    ["edit with old undefined", 'await edit("p", undefined, "n")', ["shell", "edit", { path: "p", new: "n" }]],
    ["more arguments than read names", 'await read("p", "q", 3)', ["shell", "read", { path: "p" }]],
    ["more arguments than write names", 'await write("p", "t", "x")', ["shell", "write", { path: "p", text: "t" }]],
    ["more arguments than edit names", 'await edit("p", "o", "n", "z", 5)', ["shell", "edit", { path: "p", old: "o", new: "n" }]],
    ["a text with line breaks, quotes and characters outside the basic plane", 'await write("p", "a\\nb \\"q\\" \\\\ \\u{1F600}")', ["shell", "write", { path: "p", text: 'a\nb "q" \\ \u{1F600}' }]],
    ["arguments go through JSON", 'await write("p", new Date(0))', ["shell", "write", { path: "p", text: "1970-01-01T00:00:00.000Z" }]],
    ["a value that is not a string goes through JSON", 'await write("p", { a: [1, undefined, NaN] })', ["shell", "write", { path: "p", text: { a: [1, null, null] } }]],
  ];
  for (const [name, code, expected] of cases) {
    test(name, async () => {
      const callTool = answering("x");
      const r = await withShell(code, callTool);
      expectOk(r, "x");
      assert.deepStrictEqual(callTool.calls, [expected]);
    });
  }

  test("each is an async function: the call gives a promise", async () => {
    const callTool = answering("x");
    const r = await withShell(
      'const ps = [read("p"), write("p", "t"), edit("p", "o", "n")];\nconst kinds = ps.map((p) => typeof p.then);\nawait Promise.all(ps);\nkinds',
      callTool,
    );
    expectOk(r, ["function", "function", "function"]);
    assert.strictEqual(callTool.calls.length, 3);
  });

  test("arguments JSON cannot hold: the call throws in the program and callTool is not called", async () => {
    const callTool = answering();
    const r = await withShell(
      [
        "const c = {}; c.c = c;",
        "const out = [];",
        "const tries = [() => read(c), () => write('p', c), () => write('p', 1n), () => edit('p', c, 'n'), () => edit('p', 'o', { n: 2n })];",
        "for (const t of tries) {",
        "  try { await t(); out.push('no throw') }",
        "  catch (e) { out.push([e instanceof Error, e.message]) }",
        "}",
        "return out",
      ].join("\n"),
      callTool,
    );
    const one = [true, "the arguments cannot be sent as JSON"];
    expectOk(r, [one, one, one, one, one]);
    assert.strictEqual(callTool.calls.length, 0);
  });

  test("callTool is called once per call, in order", async () => {
    const callTool = answering("x");
    await withShell('await read("a"); await write("b", "t"); await edit("c", "o", "n"); await read("d")', callTool);
    assert.deepStrictEqual(
      callTool.calls.map(([server, tool, args]) => [server, tool, args.path]),
      [
        ["shell", "read", "a"],
        ["shell", "write", "b"],
        ["shell", "edit", "c"],
        ["shell", "read", "d"],
      ],
    );
  });
});

describe("shell true: what a call resolves with and throws", () => {
  const calls = [
    ["read", 'await read("p")'],
    ["write", 'await write("p", "t")'],
    ["edit", 'await edit("p", "o", "n")'],
  ];

  for (const [name, code] of calls) {
    test(`${name} resolves with what callTool resolved with, after a JSON round trip`, async () => {
      const callTool = answering({ a: 1, d: new Date(0), u: undefined, n: NaN, list: [1, "x"] });
      expectOk(await withShell("return " + code, callTool), {
        a: 1,
        d: "1970-01-01T00:00:00.000Z",
        n: null,
        list: [1, "x"],
      });
    });

    test(`${name}: undefined stays undefined, null stays null, a string stays whole`, async () => {
      const answers = [undefined, null, 0, "", "é \u{1F600}\n"];
      let i = 0;
      const callTool = recorder(async () => answers[i++]);
      const r = await withShell(
        `const out = [];\nfor (let i = 0; i < 5; i++) { const v = ${code}; out.push(typeof v === 'undefined' ? 'undef' : v) }\nreturn out`,
        callTool,
      );
      expectOk(r, ["undef", null, 0, "", "é \u{1F600}\n"]);
    });

    test(`${name} throws what a tool call throws: an Error with the message`, async () => {
      const thrown = [new Error("boom"), new TypeError("typed"), { message: "plain object" }, "a string", 42];
      let i = 0;
      const callTool = recorder(async () => {
        throw thrown[i++];
      });
      const r = await withShell(
        `const out = [];\nfor (let i = 0; i < 5; i++) { try { ${code}; out.push('no throw') } catch (e) { out.push([e instanceof Error, e.message]) } }\nreturn out`,
        callTool,
      );
      expectOk(r, [
        [true, "boom"],
        [true, "typed"],
        [true, "plain object"],
        [true, "a string"],
        [true, "42"],
      ]);
    });

    test(`${name}: a callTool that throws at once is the same, and an uncaught error ends the program as kind error`, async () => {
      const callTool = () => {
        throw new Error("at once");
      };
      expectOk(await withShell(`try { ${code} } catch (e) { return e.message }`, callTool), "at once");
      expectFail(await withShell(code, callTool), "error", "Error: at once");
    });
  }

  test("a large answer comes back whole", async () => {
    const big = "z".repeat(1000000);
    expectOk(await withShell('return (await read("p")).big.length', answering({ big })), 1000000);
  });

  test("calls may run at the same time, and each gets its own answer", async () => {
    const callTool = recorder(async (server, tool, args) => {
      await sleep(args.command === "slow" ? 90 : 10);
      return tool === "run" ? { exitCode: 0, stdout: "out:" + args.command, stderr: "" } : "tool:" + tool;
    });
    const r = await withShell(
      'return await Promise.all([$`slow`.text(), read("p"), write("p", "t"), edit("p", "o", "n"), $("quick").text()])',
      callTool,
    );
    expectOk(r, ["out:slow", "tool:read", "tool:write", "tool:edit", "out:quick"]);
    assert.strictEqual(callTool.calls.length, 5);
  });

  test("calls that wait for each other are all in flight at once", async () => {
    let arrived = 0;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const giveUp = setTimeout(() => release("gave up"), 10000);
    const callTool = recorder(async (server, tool) => {
      arrived++;
      if (arrived === 4) release("open");
      const how = await gate;
      return tool === "run" ? { exitCode: 0, stdout: how, stderr: "" } : how + ":" + tool;
    });
    const r = await withShell(
      'return await Promise.all([read("p"), write("p", "t"), edit("p", "o", "n"), $`x`.text()])',
      callTool,
      { timeoutMs: 20000 },
    );
    clearTimeout(giveUp);
    expectOk(r, ["open:read", "open:write", "open:edit", "open"]);
  });
});

describe("$ as a tag: the command text", () => {
  test("the pieces as written, and nothing else", async () => {
    assert.strictEqual(await commandOf("await $`ls`"), "ls");
    assert.strictEqual(await commandOf("await $`ls -l | wc -l`"), "ls -l | wc -l");
    assert.strictEqual(await commandOf("await $`echo \"x\" 'y' $HOME *.txt`"), "echo \"x\" 'y' $HOME *.txt");
    assert.strictEqual(await commandOf("await $`ls\n  -l\n`"), "ls\n  -l\n");
  });

  test("the raw text of a piece: a backslash stays a backslash", async () => {
    assert.strictEqual(await commandOf("await $`printf a\\nb`"), "printf a\\nb");
    assert.strictEqual(await commandOf("await $`echo \\x41 \\\\ \\$HOME`"), "echo \\x41 \\\\ \\$HOME");
    assert.strictEqual(await commandOf("await $`echo \\unicode`"), "echo \\unicode");
  });

  test("the examples of the text", async () => {
    assert.strictEqual(await commandOf("await $`echo ${'a b'} ${[1, \"c'd\"]}`"), "echo 'a b' '1' 'c'\\''d'");
  });

  const strings = [
    ["a b", "'a b'"],
    ["", "''"],
    ["$HOME", "'$HOME'"],
    ["*.txt", "'*.txt'"],
    ["a\nb", "'a\nb'"],
    ["'", "''\\'''"],
    ["it's", "'it'\\''s'"],
    ["''", "''\\'''\\'''"],
    ["a;b|c&d>e", "'a;b|c&d>e'"],
    ['"q" \\ back', "'\"q\" \\ back'"],
    ["`x` $(y)", "'`x` $(y)'"],
    ["\u{1F600} é", "'\u{1F600} é'"],
  ];
  for (const [value, quoted] of strings) {
    test(`a string ${JSON.stringify(value)}`, async () => {
      assert.strictEqual(await commandOf("await $`echo ${" + JSON.stringify(value) + "}`"), "echo " + quoted);
    });
  }

  test("a number or a boolean: String(value), quoted the same way", async () => {
    assert.strictEqual(await commandOf("await $`n ${5}`"), "n '5'");
    assert.strictEqual(await commandOf("await $`n ${-2.5}`"), "n '-2.5'");
    assert.strictEqual(await commandOf("await $`n ${0}`"), "n '0'");
    assert.strictEqual(await commandOf("await $`b ${true} ${false}`"), "b 'true' 'false'");
  });

  test("a list: each item as above, joined by one space", async () => {
    assert.strictEqual(await commandOf("await $`ls ${['a b', 2, true, \"it's\"]}`"), "ls 'a b' '2' 'true' 'it'\\''s'");
    assert.strictEqual(await commandOf("await $`ls ${['only']}`"), "ls 'only'");
    assert.strictEqual(await commandOf("await $`ls ${['', '']}`"), "ls '' ''");
  });

  test("an empty list puts in nothing", async () => {
    assert.strictEqual(await commandOf("await $`x${[]}y`"), "xy");
    assert.strictEqual(await commandOf("await $`ls ${[]}-l`"), "ls -l");
  });

  test("several values among the pieces", async () => {
    assert.strictEqual(
      await commandOf('await $`cp ${"a"} ${"b"} && ls ${["c", "d"]} | wc -l ${3}`'),
      "cp 'a' 'b' && ls 'c' 'd' | wc -l '3'",
    );
  });

  test("a value is evaluated once, from the program's variables", async () => {
    assert.strictEqual(
      await commandOf('const word = "it\'s"; const files = ["a.txt", "b c.txt"]; await $`grep -l ${word} ${files}`'),
      "grep -l 'it'\\''s' 'a.txt' 'b c.txt'",
    );
  });

  const refused = [
    ["null", "null"],
    ["undefined", "undefined"],
    ["an object", "{ a: 1 }"],
    ["an empty object", "{}"],
    ["a date", "new Date(0)"],
    ["a function", "() => 1"],
    ["a list holding null", "['a', null]"],
    ["a list holding undefined", "[undefined]"],
    ["a list holding an object", "[{}]"],
    ["a list holding a function", "[function () {}]"],
  ];
  for (const [name, value] of refused) {
    test(`${name} as a value: $ throws a TypeError and no command object is made`, async () => {
      const callTool = answering();
      const r = await withShell(
        `let made = false;\ntry { const c = $\`echo \${${value}}\`; made = true; await c } catch (e) { return [e instanceof TypeError, e.name, made] }\nreturn "no throw"`,
        callTool,
      );
      expectOk(r, [true, "TypeError", false]);
      assert.strictEqual(callTool.calls.length, 0);
    });
  }

  test("the TypeError is thrown at the tag, not later, and the program may go on", async () => {
    const callTool = answering();
    const r = await withShell(
      'let c; let caught; try { c = $`a ${null}` } catch (e) { caught = e.name }\nawait new Promise((r) => setTimeout(r, 50));\nreturn [caught, typeof c]',
      callTool,
    );
    expectOk(r, ["TypeError", "undefined"]);
    assert.strictEqual(callTool.calls.length, 0);
  });
});

describe("$ as a function", () => {
  test("the command text is the string, as it is", async () => {
    assert.strictEqual(await commandOf('await $("ls -l | wc -l")'), "ls -l | wc -l");
    assert.strictEqual(await commandOf("await $(\"echo 'x' \\\"y\\\" $HOME *.txt\\n\")"), "echo 'x' \"y\" $HOME *.txt\n");
    assert.strictEqual(await commandOf('const w = "a b"; await $("echo " + w)'), "echo a b");
  });

  for (const [name, call] of [
    ["no argument", "$()"],
    ["a number", "$(5)"],
    ["null", "$(null)"],
    ["an object", "$({})"],
    ["a boolean", "$(true)"],
  ]) {
    test(`${name}: a TypeError, and no call`, async () => {
      const callTool = answering();
      const r = await withShell(
        `try { const c = ${call}; await c; return "no throw" } catch (e) { return [e instanceof TypeError, e.name] }`,
        callTool,
      );
      expectOk(r, [true, "TypeError"]);
      assert.strictEqual(callTool.calls.length, 0);
    });
  }
});

describe("the command object: when the command starts", () => {
  test("a command object that is neither awaited nor asked for its text makes no call", async () => {
    const callTool = answering();
    const r = await withShell(
      '$`ls`; $("ls"); const c = $`ls ${"x"}`; c.nothrow(); $`ls`.nothrow();\nawait new Promise((r) => setTimeout(r, 150));\nreturn 1',
      callTool,
    );
    expectOk(r, 1);
    assert.strictEqual(callTool.calls.length, 0);
  });

  test("it has then, text and nothrow, and nothrow gives the same object back", async () => {
    const callTool = answering();
    const r = await withShell(
      "const c = $`ls`;\nreturn [typeof c.then, typeof c.text, typeof c.nothrow, c.nothrow() === c, c.nothrow().nothrow() === c]",
      callTool,
    );
    expectOk(r, ["function", "function", "function", true, true]);
    assert.strictEqual(callTool.calls.length, 0);
  });

  test("text() starts the command, even when its promise is not awaited", async () => {
    const callTool = answering();
    const r = await withShell("const p = $`ls`.text();\nawait new Promise((r) => setTimeout(r, 150));\nreturn typeof p.then", callTool);
    expectOk(r, "function");
    assert.deepStrictEqual(callTool.calls, [["shell", "run", { command: "ls" }]]);
  });

  test("then starts the command", async () => {
    const callTool = answering();
    const r = await withShell("let got;\n$`ls`.then((v) => (got = v));\nawait new Promise((r) => setTimeout(r, 150));\nreturn got", callTool);
    expectOk(r, OK);
    assert.deepStrictEqual(callTool.calls, [["shell", "run", { command: "ls" }]]);
  });

  test("the command is started once: every later then and text() waits for the same call", async () => {
    const callTool = answering();
    const r = await withShell(
      "const c = $`ls`;\nconst a = await c; const b = await c; const t1 = await c.text(); const t2 = await c.text();\nreturn [a, b, t1, t2]",
      callTool,
    );
    expectOk(r, [OK, OK, "a\n", "a\n"]);
    assert.strictEqual(callTool.calls.length, 1);
  });

  test("the command is started once when it is asked for at the same time", async () => {
    const callTool = recorder(async () => {
      await sleep(50);
      return OK;
    });
    const r = await withShell("const c = $`ls`;\nreturn await Promise.all([c, c.text(), c.text(), c])", callTool);
    expectOk(r, [OK, "a\n", "a\n", OK]);
    assert.strictEqual(callTool.calls.length, 1);
  });

  test("two command objects are two calls", async () => {
    const callTool = answering();
    await withShell("await $`ls`; await $`ls`; const c = $`pwd`; await c; await c", callTool);
    assert.deepStrictEqual(
      callTool.calls.map((c) => c[2].command),
      ["ls", "ls", "pwd"],
    );
  });

  test("then(onDone, onFail) settles like a promise", async () => {
    const r = await withShell("return await new Promise((res, rej) => $`ls`.then(res, rej))");
    expectOk(r, OK);
  });

  test("then(onDone, onFail): onFail gets the error of a failed command and of a refusal", async () => {
    let n = 0;
    const callTool = recorder(async () => {
      if (++n === 1) return { exitCode: 4, stdout: "", stderr: "no\n" };
      throw new Error("refused");
    });
    const r = await withShell(
      "const a = await new Promise((res) => $`x`.then(() => res('done'), (e) => res(e.message)));\nconst b = await new Promise((res) => $`y`.then(() => res('done'), (e) => res(e.message)));\nreturn [a, b]",
      callTool,
    );
    expectOk(r, ["the command failed with exit code 4: no", "refused"]);
  });
});

describe("the command object: what await gives", () => {
  test("await gives the object { exitCode, stdout, stderr }", async () => {
    expectOk(await withShell("return await $`ls`"), OK);
    expectOk(await withShell("const r = await $`ls`; return Object.keys(r).sort()"), ["exitCode", "stderr", "stdout"]);
  });

  test("await on text() gives stdout, unchanged", async () => {
    for (const stdout of ["a\n", "", "no line break", "  two \n\n", "é \u{1F600}\n", "x".repeat(100000) + "\n"]) {
      expectOk(await withShell("return await $`ls`.text()", answering({ exitCode: 0, stdout, stderr: "" })), stdout);
    }
  });

  test("the examples of the text: text() gives a\\n and callTool got shell, run, { command: ls }", async () => {
    const callTool = answering();
    expectOk(await withShell("return await $`ls`.text()", callTool), "a\n");
    assert.deepStrictEqual(callTool.calls, [["shell", "run", { command: "ls" }]]);
  });

  test("a successful command with something on stderr does not throw", async () => {
    const answer = { exitCode: 0, stdout: "o", stderr: "warning\n" };
    expectOk(await withShell("return await $`ls`", answering(answer)), answer);
  });

  test("text() gives a promise", async () => {
    expectOk(await withShell("const p = $`ls`.text(); const k = typeof p.then; await p; return k"), "function");
  });
});

describe("the command object: a failed command", () => {
  const failures = [
    [{ exitCode: 1, stdout: "out\n", stderr: "bad\n" }, "the command failed with exit code 1: bad"],
    [{ exitCode: 2, stdout: "", stderr: "" }, "the command failed with exit code 2"],
    [{ exitCode: 3, stdout: "o", stderr: " \n\t  " }, "the command failed with exit code 3"],
    [{ exitCode: 127, stdout: "", stderr: "  sh: x: not found\n  second line \n\n" }, "the command failed with exit code 127: sh: x: not found\n  second line"],
    [{ exitCode: 255, stdout: "x", stderr: "ab".repeat(300) }, "the command failed with exit code 255: " + "ab".repeat(250)],
    [{ exitCode: 1, stdout: "", stderr: "  " + "e".repeat(500) + "  " }, "the command failed with exit code 1: " + "e".repeat(500)],
  ];
  const ways = [
    ["await on the object", "await $`x`"],
    ["await on text()", "await $`x`.text()"],
  ];
  for (const [answer, message] of failures) {
    for (const [way, expr] of ways) {
      test(`${way}: exit code ${answer.exitCode}, stderr of ${answer.stderr.length} characters`, async () => {
        const r = await withShell(
          `try { ${expr}; return "no throw" } catch (e) { return [e instanceof Error, e.message, Object.keys(e).sort(), e.exitCode, e.stdout, e.stderr] }`,
          answering(answer),
        );
        expectOk(r, [true, message, ["exitCode", "stderr", "stdout"], answer.exitCode, answer.stdout, answer.stderr]);
      });
    }
  }

  test("the first 500 characters of stderr.trim(): a longer one is cut, a shorter one is whole", async () => {
    const message = (stderr) => `the command failed with exit code 1${stderr.trim() ? ": " + stderr.trim().slice(0, 500) : ""}`;
    for (const stderr of ["x".repeat(499), "x".repeat(500), "x".repeat(501), "y".repeat(2000)]) {
      const r = await withShell("try { await $`x` } catch (e) { return e.message }", answering({ exitCode: 1, stdout: "", stderr }));
      expectOk(r, message(stderr));
    }
    expectOk(
      await withShell("try { await $`x` } catch (e) { return e.message.length }", answering({ exitCode: 1, stdout: "", stderr: "y".repeat(2000) })),
      "the command failed with exit code 1: ".length + 500,
    );
  });

  test("a failure that the program does not catch ends it as kind error", async () => {
    const answer = { exitCode: 1, stdout: "", stderr: "bad\n" };
    expectFail(await withShell("await $`x`", answering(answer)), "error", "Error: the command failed with exit code 1: bad", []);
    expectFail(await withShell("await $`x`.text()", answering(answer)), "error", "Error: the command failed with exit code 1: bad", []);
  });

  test("a failed command object throws for every later await too, and the command ran once", async () => {
    const callTool = answering({ exitCode: 9, stdout: "", stderr: "no" });
    const r = await withShell(
      "const c = $`x`; const out = [];\nfor (const f of [() => c, () => c.text(), () => c, () => c.text()]) { try { await f(); out.push('no throw') } catch (e) { out.push(e.message) } }\nreturn out",
      callTool,
    );
    expectOk(r, Array(4).fill("the command failed with exit code 9: no"));
    assert.strictEqual(callTool.calls.length, 1);
  });

  test("an exit code of 0 is no failure, and any other number is", async () => {
    for (const exitCode of [0, 1, -1, 2, 130]) {
      const r = await withShell(
        "try { await $`x`; return 'ok' } catch (e) { return e.exitCode }",
        answering({ exitCode, stdout: "", stderr: "" }),
      );
      expectOk(r, exitCode === 0 ? "ok" : exitCode);
    }
  });
});

describe("the command object: nothrow()", () => {
  const failed = { exitCode: 1, stdout: "partial", stderr: "bad\n" };

  test("a failed command does not throw: the exit code is there", async () => {
    expectOk(await withShell("return (await $`false`.nothrow()).exitCode", answering({ exitCode: 1, stdout: "", stderr: "" })), 1);
    expectOk(await withShell("return await $`false`.nothrow()", answering(failed)), failed);
  });

  test("text() of a failed command is its stdout, the empty string when there is none", async () => {
    expectOk(await withShell("return await $`false`.nothrow().text()", answering({ exitCode: 1, stdout: "", stderr: "" })), "");
    expectOk(await withShell("return await $`false`.nothrow().text()", answering(failed)), "partial");
  });

  test("nothrow() before the command started, on the same object", async () => {
    const callTool = answering(failed);
    const r = await withShell("const c = $`false`;\nc.nothrow();\nreturn [(await c).exitCode, await c.text()]", callTool);
    expectOk(r, [1, "partial"]);
    assert.strictEqual(callTool.calls.length, 1);
  });

  test("nothrow() of a command that succeeds changes nothing", async () => {
    expectOk(await withShell("return await $`ls`.nothrow()"), OK);
    expectOk(await withShell("return await $`ls`.nothrow().text()"), "a\n");
  });

  test("nothrow() starts nothing: the one call is made by the await", async () => {
    const callTool = answering(failed);
    await withShell("const c = $`false`.nothrow();\nawait new Promise((r) => setTimeout(r, 100));\nawait c", callTool);
    assert.strictEqual(callTool.calls.length, 1);
  });
});

describe("the command object: when callTool rejects", () => {
  const ways = [
    ["await on the object", "await $`x`"],
    ["await on text()", "await $`x`.text()"],
    ["await with nothrow()", "await $`x`.nothrow()"],
    ["await on text() with nothrow()", "await $`x`.nothrow().text()"],
    ["await on a function call", 'await $("x")'],
  ];
  for (const [name, expr] of ways) {
    test(`${name}: an Error with the message of what was thrown`, async () => {
      const thrown = [new Error("refused"), { message: "plain" }, "a string"];
      let i = 0;
      const callTool = recorder(async () => {
        throw thrown[i++ % 3];
      });
      const r = await withShell(
        `const out = [];\nfor (let i = 0; i < 3; i++) { try { ${expr}; out.push('no throw') } catch (e) { out.push([e instanceof Error, e.message]) } }\nreturn out`,
        callTool,
      );
      expectOk(r, [
        [true, "refused"],
        [true, "plain"],
        [true, "a string"],
      ]);
    });
  }

  test("a callTool that throws at once is the same", async () => {
    const callTool = () => {
      throw new Error("at once");
    };
    expectOk(await withShell("try { await $`x` } catch (e) { return e.message }", callTool), "at once");
    expectOk(await withShell("try { await $`x`.nothrow().text() } catch (e) { return e.message }", callTool), "at once");
  });

  test("a rejected command object throws for every later await, and the command ran once", async () => {
    const callTool = recorder(async () => {
      throw new Error("refused");
    });
    const r = await withShell(
      "const c = $`x`; const out = [];\nfor (const f of [() => c, () => c.text(), () => c]) { try { await f(); out.push('no throw') } catch (e) { out.push(e.message) } }\nreturn out",
      callTool,
    );
    expectOk(r, ["refused", "refused", "refused"]);
    assert.strictEqual(callTool.calls.length, 1);
  });

  test("a refusal that the program does not catch ends it as kind error", async () => {
    const callTool = recorder(async () => {
      throw new Error("refused");
    });
    expectFail(await withShell("await $`x`", callTool), "error", "Error: refused", []);
  });
});

describe("the walls hold with shell true", () => {
  test("typeof process, require, fetch, module, Buffer and WebSocket, and on globalThis", async () => {
    expectOk(
      await withShell(
        "return [[typeof process, typeof require, typeof fetch, typeof module, typeof Buffer, typeof WebSocket], typeof read]",
      ),
      [Array(6).fill("undefined"), "function"],
    );
    expectOk(
      await withShell(
        'return [["process", "require", "fetch", "module", "Buffer", "WebSocket"].map((n) => typeof globalThis[n]), typeof $]',
      ),
      [Array(6).fill("undefined"), "function"],
    );
  });

  test("import() rejects, and a static import line is a syntax error", async () => {
    expectOk(
      await withShell(
        [
          "const out = [];",
          'for (const spec of ["node:fs", "fs", "./x.js", "data:text/javascript,export default 1", "node:child_process"]) {',
          '  try { await import(spec); out.push("loaded") } catch (e) { out.push("rejected") }',
          "}",
          "return [out, typeof edit]",
        ].join("\n"),
      ),
      [Array(5).fill("rejected"), "function"],
    );
    expectFail(await withShell('import fs from "node:fs";\n1'), "error", /^SyntaxError: /);
  });

  test("the function constructor, Function and eval reach no more", async () => {
    expectOk(
      await withShell(
        `return [(function () {}).constructor(${T})(), Function(${T})(), eval("typeof process"), await (async () => {}).constructor(${T})(), typeof write]`,
      ),
      [...Array(4).fill("undefined"), "function"],
    );
  });

  describe("the function constructor through each of the four names and a command object", () => {
    const paths = [
      ["read", `read.constructor(${T})()`],
      ["write", `write.constructor(${T})()`],
      ["edit", `edit.constructor(${T})()`],
      ["$", `$.constructor(${T})()`],
      ["the prototype of read", `Object.getPrototypeOf(read).constructor(${T})()`],
      ["the prototype of $", `Object.getPrototypeOf($).constructor(${T})()`],
      ["the constructor of the constructor of $", `$.constructor.constructor(${T})()`],
      ["a command object", `$\`ls\`.constructor.constructor(${T})()`],
      ["the prototype of a command object", `Object.getPrototypeOf($\`ls\`).constructor.constructor(${T})()`],
      ["then of a command object", `$\`ls\`.then.constructor(${T})()`],
      ["text of a command object", `$\`ls\`.text.constructor(${T})()`],
      ["nothrow of a command object", `$\`ls\`.nothrow.constructor(${T})()`],
      ["the promise of text()", `$\`ls\`.text().constructor.constructor(${T})()`],
      ["a command object made by a function call", `$("ls").constructor.constructor(${T})()`],
    ];
    for (const [name, expr] of paths) {
      test(name, async () => {
        const callTool = answering();
        expectOk(await withShell("return " + expr + ";", callTool), "undefined");
      });
    }
  });

  test("an error a call of read, write or edit throws", async () => {
    const callTool = recorder(async () => {
      throw new Error("x");
    });
    for (const call of ['read("p")', 'write("p", "t")', 'edit("p", "o", "n")']) {
      const r = await withShell(
        `try { await ${call} } catch (e) { return [e.constructor.constructor(${T})(), Object.getPrototypeOf(e).constructor.constructor(${T})(), e.message] }`,
        callTool,
      );
      expectOk(r, ["undefined", "undefined", "x"]);
    }
  });

  test("an error that is thrown by a call and is no Error", async () => {
    const callTool = recorder(async () => {
      throw { message: "m", constructor: process.constructor };
    });
    for (const call of ['read("p")', 'write("p", "t")', 'edit("p", "o", "n")', "$`x`", "$`x`.text()", "$`x`.nothrow()"]) {
      const r = await withShell(`try { await ${call} } catch (e) { return [e.constructor.constructor(${T})(), e.message] }`, callTool);
      expectOk(r, ["undefined", "m"]);
    }
  });

  test("an error a failed command throws, and what it holds", async () => {
    const callTool = answering({ exitCode: 1, stdout: "o", stderr: "e" });
    for (const call of ["$`x`", "$`x`.text()"]) {
      const r = await withShell(
        `try { await ${call} } catch (e) { return [e.constructor.constructor(${T})(), Object.getPrototypeOf(e).constructor.constructor(${T})(), e.stdout.constructor.constructor(${T})(), e.stderr.constructor.constructor(${T})(), e.exitCode] }`,
        callTool,
      );
      expectOk(r, [...Array(4).fill("undefined"), 1]);
    }
  });

  test("the TypeError that $ throws", async () => {
    for (const bad of ["$()", "$(5)", "$`a ${null}`", "$`a ${{}}`"]) {
      const r = await withShell(
        `try { ${bad} } catch (e) { return [e.constructor.constructor(${T})(), Object.getPrototypeOf(e).constructor.constructor(${T})(), e.name] }`,
      );
      expectOk(r, ["undefined", "undefined", "TypeError"]);
    }
  });

  test("a value a call returned", async () => {
    const callTool = answering({ a: 1, list: [1], exitCode: 0, stdout: "s", stderr: "" });
    const r = await withShell(
      [
        `const T = ${T};`,
        'const vs = [await read("p"), await write("p", "t"), await edit("p", "o", "n"), await $`x`, await $`x`.nothrow()];',
        "return vs.map((v) => [v.constructor.constructor(T)(), v.__proto__.constructor.constructor(T)(), v.stdout.constructor.constructor(T)()]);",
      ].join("\n"),
      callTool,
    );
    expectOk(r, Array(5).fill(["undefined", "undefined", "undefined"]));
  });

  test("the text of a command's stdout", async () => {
    expectOk(await withShell(`return (await $\`x\`.text()).constructor.constructor(${T})()`), "undefined");
  });
});

describe("shell true: the process of the program is started the very same way", () => {
  const options = (args) => {
    const flags = [];
    const reads = [];
    const scripts = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--allow-fs-read") reads.push(args[++i]);
      else if (a.startsWith("--allow-fs-read=")) reads.push(a.slice("--allow-fs-read=".length));
      else if (a.startsWith("-")) flags.push(a);
      else scripts.push(a);
    }
    return { flags, reads, scripts };
  };
  const inSrc = (path) => resolve(path).startsWith(resolve(srcDir) + sep);

  test("the same Node, command line, environment and standard streams, with shell false and true", () => {
    const got = fixtureJson("argv");
    assert.deepStrictEqual(got.results[0], { ok: true, value: 2, logs: [] });
    assert.deepStrictEqual(got.results[1], { ok: true, value: 2, logs: [] });
    assert.deepStrictEqual(got.results[2], {
      ok: true,
      value: ["ok:read", "ok:write", "ok:edit", "out\n"],
      logs: ["ok:read ok:write ok:edit out\n"],
    });
    for (const spawned of got.spawns) assert.strictEqual(spawned.length, 1, "one process for one program, whatever it calls");
    const [[plain], [quiet], [four]] = got.spawns;
    for (const other of [quiet, four]) {
      assert.strictEqual(other.file, plain.file);
      assert.deepStrictEqual(other.args, plain.args);
      assert.deepStrictEqual(other.envPairs, plain.envPairs);
      assert.strictEqual(other.stdio, plain.stdio);
    }
    assert.strictEqual(plain.file, process.execPath);
    for (const s of [plain, quiet, four]) assert.deepStrictEqual(s.envPairs, []);
  });

  test("the permission model, no right to write, to spawn, to start a worker, and no file but those of sandbox/src", () => {
    const got = fixtureJson("argv");
    for (const [spawned] of got.spawns) {
      const o = options(spawned.args);
      assert.ok(o.flags.includes("--permission"));
      assert.ok(o.flags.includes("--max-old-space-size=256"));
      for (const flag of o.flags) assert.doesNotMatch(flag, /^--allow-(fs-write|child-process|worker)/);
      assert.ok(!o.reads.includes("*"));
      for (const read of o.reads) assert.ok(inSrc(read), `a file outside sandbox/src may be read: ${read}`);
      assert.strictEqual(o.scripts.length, 1);
    }
  });

  test("checkWalls gives the same, in a caller that has run programs with shell true", () => {
    const got = fixtureJson("argv");
    assert.strictEqual(got.results[2].ok, true);
    assert.deepStrictEqual(got.walls, REFUSED);
  });

  async function whileRunning(options = {}) {
    await settle();
    const running = withShell("while (true) {}", answering(), { timeoutMs: 1500, ...options });
    const row = await waitFor(() => childRows()[0], 3000);
    const result = await running;
    assert.ok(row, "no process of the program was seen");
    return { row, result };
  }

  test("a running process: the permission model, and no right to write, to spawn or to start a worker", async () => {
    const { row, result } = await whileRunning();
    expectFail(result, "timeout", "stopped after 1500 ms");
    assert.match(row.command, /(^|\s)--permission(\s|=|$)/);
    assert.doesNotMatch(row.command, /--allow-fs-write/);
    assert.doesNotMatch(row.command, /--allow-child-process/);
    assert.doesNotMatch(row.command, /--allow-worker/);
    assert.doesNotMatch(row.command, /--allow-fs-read[= ]\*/);
  });

  test("when the promise resolves, the process has ended or was sent SIGKILL", async () => {
    const { row } = await whileRunning({ timeoutMs: 300 });
    assert.ok(await waitFor(() => !alive(row.pid), 2000), "the process of the program still runs");
    await settle();
    expectOk(await withShell('return await read("p")', answering("x")), "x");
    assert.ok(await waitFor(() => childRows().length === 0, 2000), "a process of the program still runs");
  });
});

describe("shell true: the time limit passes while a call waits", () => {
  const pendingCalls = [
    ["read", 'await read("p")'],
    ["write", 'await write("p", "t")'],
    ["edit", 'await edit("p", "o", "n")'],
    ["$", "await $`ls`"],
    ["$ asked for its text", 'await $("ls").text()'],
    ["a command object with nothrow()", "await $`ls`.nothrow()"],
  ];

  async function watched(body) {
    const failures = [];
    const onBad = (e) => failures.push(e);
    process.on("unhandledRejection", onBad);
    process.on("uncaughtException", onBad);
    try {
      await body(failures);
    } finally {
      process.off("unhandledRejection", onBad);
      process.off("uncaughtException", onBad);
    }
  }

  for (const how of ["resolves", "rejects"]) {
    test(`the process is killed, the result is kind timeout, and an answer that ${how} later is dropped`, async () => {
      await watched(async (failures) => {
        const settlers = [];
        const callTool = recorder(
          () => new Promise((resolve, reject) => settlers.push(() => (how === "resolves" ? resolve(OK) : reject(new Error("too late"))))),
        );
        const results = await Promise.all(pendingCalls.map(([, code]) => withShell(code, callTool, { timeoutMs: 1500 })));
        results.forEach((r) => expectFail(r, "timeout", "stopped after 1500 ms"));
        assert.strictEqual(callTool.calls.length, pendingCalls.length);
        const before = callTool.calls.length;
        settlers.forEach((go) => go());
        await sleep(200);
        assert.strictEqual(callTool.calls.length, before, "callTool was called after the promise resolved");
        assert.deepStrictEqual(failures, []);
        assert.ok(await waitFor(() => childRows().length === 0, 3000), "a process still runs");
      });
    });
  }

  for (const [name, code] of pendingCalls.slice(0, 4)) {
    test(`callTool is never called after the promise has resolved: a program that calls ${name} for ever`, async () => {
      let resolved = false;
      let late = 0;
      const callTool = recorder(async () => {
        if (resolved) late++;
        return OK;
      });
      const loop = code.replace(/^await /, "while (true) { await ") + " }";
      const r = await withShell(loop, callTool, { timeoutMs: 400 });
      resolved = true;
      expectFail(r, "timeout", "stopped after 400 ms");
      assert.ok(callTool.calls.length > 0);
      await sleep(300);
      assert.strictEqual(late, 0);
    });
  }

  test("a call of $ still waiting when the program returns: its answer is dropped", async () => {
    await watched(async (failures) => {
      let resolved = false;
      let late = 0;
      let finish;
      const callTool = recorder(async () => {
        if (resolved) late++;
        await new Promise((resolve) => (finish = resolve));
        return OK;
      });
      try {
        const r = await withShell("$`ls`.text().catch(() => {});\nread('p');\nawait new Promise((r) => setTimeout(r, 250));\nreturn 'ended'", callTool);
        resolved = true;
        expectOk(r, "ended");
        assert.strictEqual(callTool.calls.length, 2);
        finish();
        await sleep(200);
        assert.strictEqual(late, 0);
        assert.deepStrictEqual(failures, []);
      } finally {
        finish?.();
      }
    });
  });

  test("the process is sent only SIGKILL, and only the process of the program; the caller's handlers are not touched", () => {
    const got = fixtureJson("timeout");
    assert.strictEqual(got.result.ok, false);
    assert.strictEqual(got.result.error.kind, "timeout");
    assert.strictEqual(got.result.error.message, "stopped after 300 ms");
    assert.strictEqual(got.called, 1);
    assert.ok(got.children.length >= 1);
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.children.includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
    assert.ok(got.kills.length >= 1, "no signal was sent to a program that was stopped");
  });

  test("a limit that passes as a call is answered: one result, the value or the timeout", async () => {
    await settle();
    await watched(async (failures) => {
      const limits = [];
      for (let ms = 20; ms <= 300; ms += 20) limits.push(ms);
      const codes = ['await read("p");\n7', "await $`ls`.text();\n7"];
      const callTool = recorder(async (server, tool) => (tool === "run" ? OK : "x"));
      const results = await Promise.all(
        limits.flatMap((ms) => codes.map((code) => withShell(code, callTool, { timeoutMs: ms }).then((r) => [ms, r]))),
      );
      for (const [ms, r] of results) {
        if (r.ok) expectOk(r, 7);
        else expectFail(r, "timeout", `stopped after ${ms} ms`);
      }
      await sleep(200);
      assert.deepStrictEqual(failures, []);
    });
  });
});

describe("shell true: signals and the exit of the caller", () => {
  test("a caller with handlers of its own, and one that ignores signals, is not touched", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.results, [true, true, false, true]);
    assert.deepStrictEqual(got.changed, []);
  });

  test("one listener of the caller's exit event is added, once however many calls are made", () => {
    const got = fixtureJson("signals");
    assert.deepStrictEqual(got.results, [true, true, false, true]);
    assert.deepStrictEqual(got.exits, Array(4).fill(got.exitBefore + 1));
  });

  test("when the caller exits while a program waits for a call, the exit listener kills it", async () => {
    let pid;
    try {
      const got = fixtureJson("exit-kills");
      pid = got.pid;
      assert.ok(pid, "the fixture saw no process of the program");
      assert.strictEqual(got.called, 1);
      assert.ok(await waitFor(() => !alive(pid), 3000), "the program's process outlived its caller");
      for (const k of got.kills) assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
    } finally {
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  test("when nothing runs, the caller exits with no signal sent", () => {
    assert.deepStrictEqual(fixtureJson("idle-exit"), {
      values: [["ok:read", "ok:write", "ok:edit", "out\n"], "Error: the command failed with exit code 1: no"],
      killsAtExit: [],
    });
  });

  test("no signal is sent for the calls themselves: a program that ends well is sent SIGKILL at most", () => {
    const got = fixtureJson("argv");
    assert.strictEqual(got.results[2].ok, true);
    for (const k of got.kills) {
      assert.ok(isKill(k.signal), `a signal that is not SIGKILL: ${JSON.stringify(k)}`);
      assert.ok(got.spawns.flat().map((s) => s.pid).includes(k.pid), `a signal to a process it did not start: ${JSON.stringify(k)}`);
      assert.notStrictEqual(k.pid, got.self);
    }
  });
});

describe("shell true: standard output and standard error of the caller", () => {
  test("nothing is written, by the sandbox or by the program, whatever happens to it", () => {
    const r = runFixture("silent", probePath);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
});

describe("shell: the argument is checked", () => {
  const callTool = async () => OK;
  const bad = [
    ["a string", "x"],
    ["the string true", "true"],
    ["the empty string", ""],
    ["the number 1", 1],
    ["the number 0", 0],
    ["null", null],
    ["an object", {}],
    ["a list", [true]],
  ];
  for (const [name, shell] of bad) {
    test(`shell is ${name}: a TypeError and no process is started`, async () => {
      await settle();
      let promise;
      assert.doesNotThrow(() => {
        promise = runProgram("1", { shell, callTool });
      }, "the call is rejected, never thrown at once");
      assert.ok(promise instanceof Promise);
      await assert.rejects(promise, TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  const noCallTool = [
    ["callTool is missing", {}],
    ["callTool is undefined", { callTool: undefined }],
    ["callTool is null", { callTool: null }],
    ["callTool is a string", { callTool: "x" }],
    ["callTool is an object", { callTool: {} }],
    ["callTool is missing and tools names nothing", { tools: {} }],
    ["callTool is missing and tools names a server with no tool", { tools: { a: [] } }],
  ];
  for (const [name, extra] of noCallTool) {
    test(`shell true and ${name}: a TypeError and no process is started`, async () => {
      await settle();
      await assert.rejects(() => runProgram("1", { shell: true, ...extra }), TypeError);
      assert.deepStrictEqual(childRows(), []);
      await sleep(30);
      assert.deepStrictEqual(childRows(), []);
    });
  }

  test("shell true with a callTool that is a function is good, with or without tools", async () => {
    expectOk(await runProgram("1", { shell: true, callTool }), 1);
    expectOk(await runProgram("1", { shell: true, callTool, tools: {} }), 1);
    expectOk(await runProgram("1", { shell: true, callTool, tools: { a: ["b"] } }), 1);
  });

  test("shell false needs no callTool, as before", async () => {
    expectOk(await runProgram("1", { shell: false }), 1);
    expectOk(await runProgram("1", { shell: undefined }), 1);
    expectOk(await runProgram("1"), 1);
  });

  test("a bad argument besides shell still rejects with a TypeError", async () => {
    await assert.rejects(() => runProgram("1", { shell: true, callTool, timeoutMs: 0 }), TypeError);
    await assert.rejects(() => runProgram(5, { shell: true, callTool }), TypeError);
    await assert.rejects(() => runProgram("1", { shell: true, callTool, memoryMb: 15 }), TypeError);
  });
});
