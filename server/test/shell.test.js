// Step 4: the built-in server `shell` (the meeting point of server, "Step 4: the built-in server `shell`"): the start, the
// description of `run`, the catalog, `callTool("shell", ...)` and the shell switched off. Every settings file that
// switches the shell on says "trail": false and "log": false (the trail and the log are the next step's).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FAKE_TOOL_COUNT,
  fakeEntry,
  practiceEntry,
  rawOnetool,
  textOf,
  tmpDir,
  tmpPath,
  withOnetool,
  withRaw,
} from "./helpers.js";
import { OFF_HINT, SHELL_LINES, caughtOf, failed, offSettings, ran, shellSettings, workFolder } from "./shellhelpers.js";

/** What `tools/list` answers for `settings`. */
async function listOf(settings) {
  return withRaw(settings, async (raw) => {
    await raw.initialize();
    return (await raw.request("tools/list", {})).result.tools;
  });
}

const search = async (ctx, words) => textOf(await ctx.call("search", words === undefined ? {} : { words }));

describe("Start", () => {
  test("a listed folder that is not a folder: one line per position counted from 1, then exit code 2, nothing connected", async () => {
    const { W } = workFolder({ "f.txt": "x" });
    const gone = join(tmpDir(), "gone");
    const aFile = join(W, "f.txt");
    const pidFile = tmpPath("pid");
    // positions 1 (W) is a folder; 2 is nothing; 3 is a file
    const raw = rawOnetool(shellSettings([W, gone, aFile], { servers: { fake: fakeEntry({ pidFile }) } }));
    try {
      const ended = await raw.within(5000);
      assert.equal(ended.code, 2);
      const lines = raw.stderrLines().filter((line) => line.includes("onetool.shell.folders"));
      assert.deepEqual(lines, [
        "onetool: onetool.shell.folders: item 2 is not a folder",
        "onetool: onetool.shell.folders: item 3 is not a folder",
      ]);
      for (const place of [W, gone, aFile]) assert.ok(!raw.stderr().includes(place), "no line holds a folder");
      assert.deepEqual(raw.lines, [], "the host was not answered");
      assert.equal(existsSync(pidFile), false, "no listed server was started");
    } finally {
      raw.kill();
      await raw.exited;
    }
  });

  test("the first folder missing is item 1", async () => {
    const { W } = workFolder();
    const raw = rawOnetool(shellSettings([join(tmpDir(), "gone"), W]));
    try {
      assert.equal((await raw.within(5000)).code, 2);
      assert.deepEqual(
        raw.stderrLines().filter((line) => line.includes("onetool.shell.folders")),
        ["onetool: onetool.shell.folders: item 1 is not a folder"],
      );
    } finally {
      raw.kill();
      await raw.exited;
    }
  });

  test("a folder that goes away after the start is not looked for again: a command fails, a path is outside", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    await withOnetool(shellSettings([W]), async (ctx) => {
      assert.equal((await ran(ctx, 'await read("a.txt")')).text, "hello\n");
      rmSync(W, { recursive: true, force: true });
      // the meeting point of shell: `cwd` is not a folder -> `the command could not be started`
      assert.deepEqual(await ran(ctx, "await $`echo hi`"), {
        text: failed("Error: shell.run failed: the command could not be started"),
        isError: true,
      });
      // the meeting point of shell: a listed folder whose realpath fails holds nothing -> outside
      assert.deepEqual(await ran(ctx, 'await read("a.txt")'), {
        text: failed("Error: onetool: shell.read is refused: a.txt is outside the listed folders"),
        isError: true,
      });
    });
  });
});

describe("The description of `run`", () => {
  test("shell off: tools/list is what it was, and the description holds none of the four names", async () => {
    const [run, searchTool] = await listOf(offSettings());
    assert.deepEqual([run.name, searchTool.name], ["run", "search"]);
    for (const needle of ["$`", "read(", "write(", "edit("]) {
      assert.ok(!run.description.includes(needle), `the description of run does not hold ${needle}`);
    }
  });

  test("shell on: the description of the shell off, one space, then a fixed text under 300 characters", async () => {
    const { W } = workFolder();
    const off = await listOf(offSettings());
    const on = await listOf(shellSettings([W]));
    const again = await listOf(shellSettings([W], { shell: { deny: ["rm *"] }, onetool: { deny: ["shell.write"] } }));
    assert.deepEqual(on.map((tool) => tool.name), ["run", "search"]);
    assert.ok(on[0].description.startsWith(`${off[0].description} `), "the old description, then one space");
    const added = on[0].description.slice(off[0].description.length);
    assert.ok(added.length > 1 && added.length < 300, `the space and the text are ${added.length} characters`);
    for (const needle of ["$`command`", ".text()", ".nothrow()", "read(path)", "write(path, text)", "edit(path, old, new)"]) {
      assert.ok(added.includes(needle), `the added text holds ${needle}`);
    }
    // assumed: "says that they work in the listed folders" is read as the word "folder" in the added text
    assert.match(added, /folder/i);
    // nothing else of tools/list differs
    assert.deepEqual(on[0].inputSchema, off[0].inputSchema);
    assert.deepEqual(on[1], off[1]);
    assert.deepEqual(again, on, "the same whatever the rules of the shell hold");
    const texts = [
      on[0].description,
      on[0].inputSchema.properties.code.description,
      on[0].inputSchema.properties.background.description,
      on[0].inputSchema.properties.job.description,
      on[0].inputSchema.properties.stop.description,
      on[0].inputSchema.properties.jobs.description,
      on[1].description,
      on[1].inputSchema.properties.words.description,
    ];
    assert.ok(texts.join("").length < 1500, `the descriptions are ${texts.join("").length} characters`);
  });
});

describe("The catalog, `search`, and the names in a program", () => {
  test("the shell is the last entry: search with no words ends with `shell: 4 tools`", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W], { servers: { practice: practiceEntry() } }), async (ctx) => {
      assert.equal(await search(ctx), "practice: 5 tools\nshell: 4 tools");
    });
    await withOnetool(shellSettings([W]), async (ctx) => {
      assert.equal(await search(ctx), "shell: 4 tools");
    });
  });

  test("search with the word `shell` shows the four lines of toolLine, in the order of the four tools", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W], { servers: { practice: practiceEntry() } }), async (ctx) => {
      assert.equal(await search(ctx, "shell"), SHELL_LINES.join("\n"));
    });
  });

  test("an entry named `shell` is a bad entry, so the name is in the catalog twice, the built-in one last", async () => {
    const { W } = workFolder();
    const settings = shellSettings([W], { servers: { shell: fakeEntry(), practice: practiceEntry() } });
    await withOnetool(settings, async (ctx) => {
      assert.equal(
        await search(ctx),
        [
          "practice: 5 tools",
          "shell: not connected (bad entry: the name is taken by the built-in shell)",
          "shell: 4 tools",
        ].join("\n"),
      );
      // the program finds the built-in server and not the entry
      const names = await ran(ctx, "JSON.stringify(Object.keys(tools.shell).sort())");
      assert.equal(names.text, JSON.stringify(["edit", "read", "run", "write"]));
      assert.ok(
        ctx.stderrLines().includes("onetool: server shell: not connected (bad entry: the name is taken by the built-in shell)"),
      );
    });
  });

  test("a denied tool is not in the visible catalog; an allow list decides as for any tool", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W], { onetool: { deny: ["shell.write"] } }), async (ctx) => {
      assert.equal(await search(ctx), "shell: 3 tools");
      assert.equal(await search(ctx, "shell"), [SHELL_LINES[0], SHELL_LINES[1], SHELL_LINES[3]].join("\n"));
    });
    await withOnetool(shellSettings([W], { onetool: { allow: ["shell.read"] } }), async (ctx) => {
      assert.equal(await search(ctx), "shell: 1 tools");
    });
  });

  test("run hands the program the four names and `tools.shell`, denied or not", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W], { onetool: { deny: ["shell.write"] } }), async (ctx) => {
      const names = await ran(ctx, "[typeof $, typeof read, typeof write, typeof edit].join(',')");
      assert.equal(names.text, "function,function,function,function");
      const listed = await ran(ctx, "JSON.stringify(Object.keys(tools.shell).sort())");
      assert.equal(listed.text, JSON.stringify(["edit", "read", "run", "write"]));
      // a refused tool exists in the program, so that calling it gives the refusal and not a TypeError
      assert.equal((await ran(ctx, "typeof tools.shell.write")).text, "function");
    });
  });
});

describe("`callTool(\"shell\", tool, args)` when the shell is on", () => {
  test("`$`, read, write and edit do their work in the first folder", async () => {
    const { W } = workFolder({ "a.txt": "alpha\n" });
    await withOnetool(shellSettings([W]), async (ctx) => {
      assert.deepEqual(await ran(ctx, "await $`echo hello`.text()"), { text: "hello\n", isError: false });
      assert.deepEqual(await ran(ctx, 'await read("a.txt")'), { text: "alpha\n", isError: false });
      assert.deepEqual(await ran(ctx, 'await write("b.txt", "x"); await read("b.txt")'), { text: "x", isError: false });
      assert.equal(readFileSync(join(W, "b.txt"), "utf8"), "x");
      // write and edit resolve with undefined
      const none = await ran(ctx, 'JSON.stringify([typeof (await write("c.txt", "one two")), typeof (await edit("c.txt", "one", "1"))])');
      assert.equal(none.text, '["undefined","undefined"]');
      assert.equal(readFileSync(join(W, "c.txt"), "utf8"), "1 two");
    });
  });

  test("a command starts in the first listed folder; a path of another listed folder is read by its full path", async () => {
    const { W } = workFolder({ "a.txt": "in W\n" });
    const X = tmpDir();
    writeFileSync(join(X, "x.txt"), "in X\n");
    await withOnetool(shellSettings([W, X]), async (ctx) => {
      assert.equal((await ran(ctx, "await $`pwd -P`.text()")).text, `${W}\n`);
      assert.equal((await ran(ctx, 'await read("a.txt")')).text, "in W\n");
      assert.equal((await ran(ctx, `await read(${JSON.stringify(join(X, "x.txt"))})`)).text, "in X\n");
      assert.equal((await ran(ctx, 'await read("x.txt")')).isError, true, "a relative path starts in the first folder");
    });
  });

  test("tools.shell.run gives { exitCode, stdout, stderr }, also for an exit code that is not 0", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W]), async (ctx) => {
      const ok = await ran(ctx, 'JSON.stringify(await tools.shell.run({ command: "echo hi; echo err >&2" }))');
      assert.deepEqual(JSON.parse(ok.text), { exitCode: 0, stdout: "hi\n", stderr: "err\n" });
      const bad = await ran(ctx, 'JSON.stringify(await tools.shell.run({ command: "echo hi; echo err >&2; exit 4" }))');
      assert.deepEqual(JSON.parse(bad.text), { exitCode: 4, stdout: "hi\n", stderr: "err\n" });
    });
  });

  test("a command that fails is the program's to judge: `$` throws, uncaught it is the answer", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W]), async (ctx) => {
      assert.deepEqual(await ran(ctx, "await $`exit 1`"), {
        text: failed("Error: the command failed with exit code 1"),
        isError: true,
      });
      assert.deepEqual(await ran(ctx, "await $`echo oops >&2; exit 2`"), {
        text: failed("Error: the command failed with exit code 2: oops"),
        isError: true,
      });
      assert.deepEqual(await ran(ctx, "(await $`exit 3`.nothrow()).exitCode"), { text: "3", isError: false });
      assert.deepEqual(await ran(ctx, "await $`echo out; exit 1`.nothrow().text()"), { text: "out\n", isError: false });
    });
  });

  test("step 2: arguments that are not an object are refused, with the real `callTool` of the program", async () => {
    const { W } = workFolder({ "a.txt": "x" });
    await withOnetool(shellSettings([W]), async (ctx) => {
      for (const [tool, arg] of [["read", '"x"'], ["write", "null"], ["edit", "[1]"], ["run", "5"]]) {
        assert.deepEqual(await caughtOf(ctx, `tools.shell.${tool}(${arg})`), [
          true,
          `onetool: the arguments of shell.${tool} must be an object`,
        ]);
      }
    });
  });

  test("step 3, for run: a command that is not a text, or only white space, is refused", async () => {
    const { W } = workFolder();
    const marker = join(W, "marker");
    await withOnetool(shellSettings([W], { shell: { deny: ["*"] } }), async (ctx) => {
      // the test of the text comes before the rules of the commands: the deny of `*` is not what answers
      for (const args of ["{}", "{ command: 5 }", '{ command: "  \\n\\t " }', '{ command: "" }', "{ command: null }"]) {
        assert.deepEqual(await caughtOf(ctx, `tools.shell.run(${args})`), [
          true,
          "shell.run failed: the command must be a text that is not empty",
        ]);
      }
      const denied = await caughtOf(ctx, `tools.shell.run({ command: "touch marker" })`);
      assert.deepEqual(denied, [true, 'onetool: shell.run is denied by the rule deny "*" of onetool.shell']);
      assert.equal(existsSync(marker), false);
    });
  });

  test("step 6: a fault of part shell that is not a path outside is `<id> failed: <message>`", async () => {
    const { W } = workFolder({ "a.txt": "hello\n", "dup.txt": "x x\n" });
    await withOnetool(shellSettings([W]), async (ctx) => {
      // the messages are those of the meeting point of shell
      const cases = [
        ["tools.shell.read({})", "shell.read failed: the path must be a text that is not empty"],
        ['read("nope.txt")', "shell.read failed: nope.txt: no such file"],
        ['read(".")', "shell.read failed: .: not a file"],
        ['write("nodir/x.txt", "x")', "shell.write failed: nodir/x.txt: its folder does not exist"],
        ['write("x.txt", 5)', "shell.write failed: the text must be a text"],
        ['edit("a.txt", "zzz", "y")', "shell.edit failed: a.txt: the old text is not in the file"],
        ['edit("dup.txt", "x", "y")', "shell.edit failed: dup.txt: the old text is in the file 2 times, it must be there once"],
        ['edit("a.txt", "", "y")', "shell.edit failed: the old text must be a text that is not empty"],
      ];
      for (const [call, message] of cases) assert.deepEqual(await caughtOf(ctx, call), [true, message], call);
      assert.equal(readFileSync(join(W, "a.txt"), "utf8"), "hello\n");
      assert.equal(readFileSync(join(W, "dup.txt"), "utf8"), "x x\n");
    });
  });

  test("a path outside the listed folders, by `..`, a full path or a symbolic link: refused, nothing read or written", async () => {
    const { parent, W } = workFolder({ "a.txt": "inside\n" });
    const outside = join(parent, "outside.txt");
    writeFileSync(outside, "secret\n");
    const O = tmpDir();
    writeFileSync(join(O, "o.txt"), "other\n");
    symlinkSync(outside, join(W, "link.txt"));
    symlinkSync(O, join(W, "linkdir"));
    await withOnetool(shellSettings([W]), async (ctx) => {
      const outsides = ["../outside.txt", outside, "link.txt", "linkdir/o.txt", "../W/../outside.txt"];
      for (const path of outsides) {
        const refused = `onetool: shell.read is refused: ${path} is outside the listed folders`;
        assert.deepEqual(await caughtOf(ctx, `read(${JSON.stringify(path)})`), [true, refused], path);
        assert.deepEqual(await caughtOf(ctx, `tools.shell.read({ path: ${JSON.stringify(path)} })`), [true, refused]);
      }
      assert.deepEqual(await ran(ctx, 'await read("../outside.txt")'), {
        text: failed("Error: onetool: shell.read is refused: ../outside.txt is outside the listed folders"),
        isError: true,
      });
      for (const path of ["../new.txt", "link.txt", "linkdir/new.txt", join(parent, "new.txt")]) {
        const refused = `onetool: shell.write is refused: ${path} is outside the listed folders`;
        assert.deepEqual(await caughtOf(ctx, `write(${JSON.stringify(path)}, "changed")`), [true, refused], path);
      }
      for (const path of ["../outside.txt", "link.txt", outside]) {
        const refused = `onetool: shell.edit is refused: ${path} is outside the listed folders`;
        assert.deepEqual(await caughtOf(ctx, `edit(${JSON.stringify(path)}, "secret", "changed")`), [true, refused], path);
      }
      assert.equal(readFileSync(outside, "utf8"), "secret\n");
      assert.equal(existsSync(join(parent, "new.txt")), false);
      assert.equal(existsSync(join(O, "new.txt")), false);
      assert.equal(readFileSync(join(O, "o.txt"), "utf8"), "other\n");
      // no answer and no line on standard error holds a listed folder, unless the program wrote the path
      const failedAnswers = [
        await ran(ctx, 'await read("nope.txt")'),
        await ran(ctx, 'await read("../outside.txt")'),
        await ran(ctx, "await $`exit 1`"),
        await ran(ctx, 'await write("nodir/x", "x")'),
      ];
      for (const one of failedAnswers) assert.ok(!one.text.includes(parent), one.text);
      assert.ok(!ctx.stderr().includes(parent), "standard error holds no folder");
    });
  });

  test("deny of a tool of the shell: the tool is refused, no file is made, the others work", async () => {
    const { W } = workFolder({ "a.txt": "alpha\n" });
    await withOnetool(shellSettings([W], { onetool: { deny: ["shell.write"] } }), async (ctx) => {
      assert.deepEqual(await ran(ctx, 'await write("b.txt", "x")'), {
        text: failed('Error: onetool: shell.write is denied by the rule deny "shell.write"'),
        isError: true,
      });
      assert.equal(existsSync(join(W, "b.txt")), false);
      assert.equal((await ran(ctx, 'await read("a.txt")')).text, "alpha\n");
    });
  });

  test("the rules come before the test of the arguments: a denied tool says it is denied", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W], { onetool: { deny: ["shell.run"], allow: ["shell.*"] } }), async (ctx) => {
      assert.deepEqual(await caughtOf(ctx, "tools.shell.run(5)"), [true, 'onetool: shell.run is denied by the rule deny "shell.run"']);
    });
    await withOnetool(shellSettings([W], { onetool: { allow: ["shell.read"] } }), async (ctx) => {
      assert.deepEqual(await caughtOf(ctx, 'write("b.txt", "x")'), [true, "onetool: shell.write is not allowed: it matches no rule of allow"]);
      assert.equal(existsSync(join(W, "b.txt")), false);
    });
  });

  test("deny of a command: it is refused with the rule and of onetool.shell, and it is not run", async () => {
    const { W } = workFolder({ "a.txt": "alpha\n" });
    await withOnetool(shellSettings([W], { shell: { deny: ["rm *"] } }), async (ctx) => {
      const refusal = failed('Error: onetool: shell.run is denied by the rule deny "rm *" of onetool.shell');
      assert.deepEqual(await ran(ctx, "await $`rm a.txt`"), { text: refusal, isError: true });
      assert.equal(existsSync(join(W, "a.txt")), true);
      // the text matched is the trimmed command
      assert.deepEqual(await ran(ctx, 'await $("  rm a.txt  ")'), { text: refusal, isError: true });
      assert.equal(existsSync(join(W, "a.txt")), true);
      assert.deepEqual(await caughtOf(ctx, 'tools.shell.run({ command: "rm a.txt" })'), [
        true,
        'onetool: shell.run is denied by the rule deny "rm *" of onetool.shell',
      ]);
      assert.equal((await ran(ctx, "await $`echo fine`.text()")).text, "fine\n");
    });
  });

  test("allow of commands: a command that matches no rule is refused", async () => {
    const { W } = workFolder();
    await withOnetool(shellSettings([W], { shell: { allow: ["echo *"] } }), async (ctx) => {
      assert.equal((await ran(ctx, "await $`echo hi`.text()")).text, "hi\n");
      assert.deepEqual(await ran(ctx, "await $`ls`"), {
        text: failed("Error: onetool: shell.run is not allowed: the command matches no rule of allow of onetool.shell"),
        isError: true,
      });
    });
  });
});

describe("When the shell is off", () => {
  test("`$`, read, write and edit give the ReferenceError with the sentence that says why", async () => {
    await withOnetool(offSettings(), async (ctx) => {
      assert.deepEqual(await ran(ctx, "await $`ls`"), {
        text: `The program failed: ReferenceError: $ is not defined ${OFF_HINT}`,
        isError: true,
      });
      for (const name of ["read", "write", "edit"]) {
        assert.deepEqual(await ran(ctx, `await ${name}("a.txt", "b", "c")`), {
          text: `The program failed: ReferenceError: ${name} is not defined ${OFF_HINT}`,
          isError: true,
        });
      }
      assert.equal(
        (await ran(ctx, "[typeof $, typeof read, typeof write, typeof edit, typeof tools.shell].join(',')")).text,
        "undefined,undefined,undefined,undefined,undefined",
      );
    });
  });

  test("any other message is unchanged; with the shell on, the text is not added", async () => {
    const { W } = workFolder();
    await withOnetool(offSettings(), async (ctx) => {
      assert.deepEqual(await ran(ctx, "nothing()"), { text: failed("ReferenceError: nothing is not defined"), isError: true });
      assert.deepEqual(await ran(ctx, 'throw new Error("$ is not defined")'), {
        text: failed("Error: $ is not defined"),
        isError: true,
      });
      assert.deepEqual(await ran(ctx, 'throw new ReferenceError("$ is not defined")'), {
        text: `The program failed: ReferenceError: $ is not defined ${OFF_HINT}`,
        isError: true,
      });
    });
    await withOnetool(shellSettings([W]), async (ctx) => {
      assert.deepEqual(await ran(ctx, 'throw new ReferenceError("$ is not defined")'), {
        text: failed("ReferenceError: $ is not defined"),
        isError: true,
      });
    });
  });

  test("a server named `shell` is a server like any other", async () => {
    await withOnetool(offSettings({ servers: { shell: fakeEntry() } }), async (ctx) => {
      assert.equal(await search(ctx), `shell: ${FAKE_TOOL_COUNT} tools`);
      assert.deepEqual(await ran(ctx, "await tools.shell.plain({})"), { text: "hello world", isError: false });
      assert.equal((await ran(ctx, "typeof $")).text, "undefined");
    });
  });

  test("the catalog has no entry `shell` and the program has no name added", async () => {
    await withOnetool(offSettings({ servers: { practice: practiceEntry() } }), async (ctx) => {
      assert.equal(await search(ctx), "practice: 5 tools");
      assert.equal((await ran(ctx, "JSON.stringify(Object.keys(tools))")).text, '["practice"]');
    });
  });
});
