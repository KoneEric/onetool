// Step 4: the log file (the meeting point of server, "Step 4: the record of every call", "One record per call" and "The log").
// Every test reads the log straight after the answer of `run`: "When `run` answers, the line of every call of its program
// is in the file". The trail is off unless said. The keys, the file name and the arguments kept are those of
// the meeting point of core, "Step 4: the log".
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeEntry, settingsOf, sleep, tmpDir, tmpPath, waitFor, withOnetool, withRaw } from "./helpers.js";
import { withHost } from "./askhost.js";
import { ran, workFolder } from "./shellhelpers.js";
import { FILE_NAME, UUID, assertShape, entriesOf, logEntries, logFiles, logSettings, logText, todayFile } from "./recordhelpers.js";

const NAMES = ["rec", "plain", "json", "structured", "empty", "toolerr", "rpcerr", "die", "barrier", "wipe", "calls", "env"];
const FAKE = (config = {}, options) => fakeEntry({ tools: NAMES, ...config }, options);
const SERVERS = (config, options) => ({ fake: FAKE(config, options) });

/** The shell on in `W`, the log in `L`, no trail. `shell` holds the other keys of `onetool.shell`, `onetool` the others. */
const WITH_SHELL = (L, W, { shell = {}, onetool = {}, servers = SERVERS() } = {}) =>
  settingsOf(servers, { shell: { folders: [W], ...shell }, trail: false, logFolder: L, ...onetool });

/** The messages of the rejections of `calls` (texts of calls), in order, caught in the program. */
async function messages(ctx, calls) {
  const code = [
    "const out = [];",
    `for (const call of [${calls.map((call) => `() => ${call}`).join(", ")}]) {`,
    '  try { await call(); out.push("answered"); } catch (e) { out.push(e.message); }',
    "}",
    "return JSON.stringify(out);",
  ].join("\n");
  const answer = await ran(ctx, code);
  assert.equal(answer.isError, false, answer.text);
  return JSON.parse(answer.text);
}

describe("one line per call", () => {
  test("the line of a call of a listed server: eight keys, the arguments as the program gave them, the size of the value", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      const before = Date.now();
      const answer = await ran(ctx, 'await tools.fake.rec({ a: 1, nested: { b: [1, 2] } }); await tools.fake.plain({}); "x"');
      const after = Date.now();
      assert.deepEqual(answer, { text: "x", isError: false });
      const entries = logEntries(L);
      assert.equal(entries.length, 2);
      entries.forEach(assertShape);
      const [first, second] = entries;
      assert.equal(first.id, "fake.rec");
      assert.deepEqual(first.args, { a: 1, nested: { b: [1, 2] } });
      assert.equal(first.decision, "allowed");
      assert.equal(first.size, 10); // "called rec"
      assert.equal(first.fault, null);
      assert.equal(second.id, "fake.plain");
      assert.deepEqual(second.args, {});
      assert.equal(second.size, 11); // "hello world"
      for (const entry of entries) {
        const time = Date.parse(entry.time);
        assert.ok(time >= before && time <= after, `the time is that of the call: ${entry.time}`);
      }
      assert.equal(first.session, second.session);
    });
  });

  test("one file per day, named calls-<date>.jsonl with the UTC date of the line, and nothing else in the folder", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      await ran(ctx, "await tools.fake.plain({}); await tools.fake.json({}); 1");
      const names = logFiles(L);
      assert.ok(names.length >= 1);
      for (const name of names) {
        assert.match(name, FILE_NAME);
        for (const line of readFileSync(join(L, name), "utf8").split("\n").filter((one) => one !== "")) {
          assert.equal(`calls-${JSON.parse(line).time.slice(0, 10)}.jsonl`, name);
        }
      }
      assert.equal(logEntries(L).length, 2);
      assert.ok(readFileSync(join(L, names[0]), "utf8").endsWith("\n"), "each line ends with one line break");
    });
  });

  test("the session is one text per process: the same in every line of a process, another in the next process", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      await ran(ctx, "await tools.fake.plain({}); 1");
      await ran(ctx, "await tools.fake.plain({}); 1");
    });
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      await ran(ctx, "await tools.fake.plain({}); 1");
    });
    const entries = logEntries(L);
    assert.equal(entries.length, 3);
    entries.forEach(assertShape);
    assert.equal(entries[0].session, entries[1].session);
    assert.notEqual(entries[1].session, entries[2].session);
    assert.match(entries[0].session, UUID);
  });

  test("the lines of the calls of one program are written in the order the calls ended, the trail in the order they began", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS(), { trail: true }), async (ctx) => {
      const code = [
        "const slow = tools.fake.barrier({});",
        "await tools.fake.plain({});",
        "await tools.fake.json({});",
        "await Promise.all([slow, tools.fake.barrier({})]);",
        '"done"',
      ].join("\n");
      const answer = await ran(ctx, code);
      assert.ok(answer.text.startsWith("done\n--- calls ---\nfake.barrier "), answer.text);
      const ids = logEntries(L).map((entry) => entry.id);
      assert.equal(ids.length, 4);
      assert.deepEqual(ids.slice(0, 2), ["fake.plain", "fake.json"]);
      assert.deepEqual(ids.slice(2), ["fake.barrier", "fake.barrier"]);
    });
  });

  test("lines of calls made at once never mix: each is a whole JSON text of its own", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      const code = 'await Promise.all(Array.from({ length: 40 }, (_, i) => tools.fake.rec({ i, pad: "p".repeat(1500) }))); "done"';
      assert.deepEqual(await ran(ctx, code), { text: "done", isError: false });
      const entries = logEntries(L);
      assert.equal(entries.length, 40);
      entries.forEach(assertShape);
      assert.deepEqual(entries.map((entry) => entry.args.i).sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i));
    });
  });

  test("a call that the program does not make through callTool is not recorded: search, and a program with no call", async () => {
    const L = join(tmpDir(), "a", "b");
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      await ctx.call("search", {});
      await ran(ctx, "1 + 1");
      await ctx.call("run", {});
      assert.equal(existsSync(L), false, "no line, so no folder");
    });
  });
});

describe("the arguments of a line", () => {
  test("a JSON text of at most 2000 characters is kept as it is, one of more is cut with the whole length", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      // {"s":"..."} has 8 characters besides the text: 1992 characters of text make exactly 2000
      await ran(ctx, 'await tools.fake.rec({ s: "x".repeat(1992) }); await tools.fake.rec({ s: "x".repeat(3000) }); 1');
      const [exact, long] = logEntries(L);
      assert.deepEqual(exact.args, { s: "x".repeat(1992) });
      // 3000 + 8 = 3008 characters of JSON: the first 2000, then `... (3008 characters)`
      const json = JSON.stringify({ s: "x".repeat(3000) });
      assert.equal(json.length, 3008);
      assert.equal(long.args, `${json.slice(0, 2000)}... (3008 characters)`);
    });
  });

  test("the arguments of the built-in shell are those of shellLogArgs: no text of a file", async () => {
    const { W } = workFolder();
    const L = tmpDir();
    await withOnetool(WITH_SHELL(L, W), async (ctx) => {
      const code = [
        'await write("a.txt", "hello\\n");',
        'await read("a.txt");',
        'await edit("a.txt", "hello", "bye");',
        "await $`echo hi`.text();",
        '"done"',
      ].join("\n");
      assert.deepEqual(await ran(ctx, code), { text: "done", isError: false });
      const entries = logEntries(L);
      assert.deepEqual(entries.map((entry) => [entry.id, entry.args]), [
        ["shell.write", { path: "a.txt", size: 6 }],
        ["shell.read", { path: "a.txt" }],
        ["shell.edit", { path: "a.txt", oldSize: 5, newSize: 3 }],
        ["shell.run", { command: "echo hi" }],
      ]);
      assert.deepEqual(entries.map((entry) => entry.decision), ["allowed", "allowed", "allowed", "allowed"]);
      assert.equal(entries[0].size, 0); // the answer of a write is undefined
      assert.equal(entries[1].size, 6); // the text "hello\n"
      assert.equal(entries[2].size, 0);
      // the object of a command, { exitCode, stdout, stderr }: the length of its JSON text
      assert.equal(entries[3].size, JSON.stringify({ exitCode: 0, stdout: "hi\n", stderr: "" }).length);
    });
  });

  test("arguments that are not an object: the call fails, a listed server's arguments are as given, the shell's are null", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    const L = tmpDir();
    await withOnetool(WITH_SHELL(L, W), async (ctx) => {
      const got = await messages(ctx, ['tools.fake.rec([1, 2])', 'tools.shell.read("a.txt")']);
      assert.deepEqual(got, [
        "onetool: the arguments of fake.rec must be an object",
        "onetool: the arguments of shell.read must be an object",
      ]);
      const [fake, shell] = logEntries(L);
      assert.equal(fake.id, "fake.rec");
      assert.deepEqual(fake.args, [1, 2]);
      assert.equal(fake.decision, "allowed");
      assert.equal(fake.size, null);
      assert.equal(fake.fault, got[0]);
      assert.equal(shell.id, "shell.read");
      assert.equal(shell.args, null);
      assert.equal(shell.fault, got[1]);
    });
  });
});

describe("the outcome of a line: size, fault, decision", () => {
  test("a failure of the server, of the tool, a refusal by deny, bad arguments", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS(), { deny: ["fake.wipe"] }), async (ctx) => {
      const got = await messages(ctx, ["tools.fake.rpcerr({})", "tools.fake.toolerr({})", "tools.fake.wipe({})", "tools.fake.rec(5)"]);
      assert.equal(got.length, 4);
      const entries = logEntries(L);
      entries.forEach(assertShape);
      assert.deepEqual(entries.map((entry) => entry.id), ["fake.rpcerr", "fake.toolerr", "fake.wipe", "fake.rec"]);
      assert.deepEqual(entries.map((entry) => entry.decision), ["allowed", "allowed", "denied", "allowed"]);
      assert.deepEqual(entries.map((entry) => entry.size), [null, null, null, null]);
      // `failed` keeps the message of the rejection; a refusal by the rules says so
      assert.equal(entries[0].fault, got[0]);
      assert.equal(entries[1].fault, got[1]);
      assert.equal(entries[2].fault, "refused by the rules");
      assert.equal(entries[3].fault, got[3]);
      assert.equal(entries[3].args, 5);
      assert.ok(got[1].includes("bad things"));
    });
  });

  test("a fault is the first 500 characters of the message", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS({ errorText: "E".repeat(600) })), async (ctx) => {
      const [message] = await messages(ctx, ["tools.fake.rpcerr({})"]);
      assert.ok(message.length > 500, "the input is long enough");
      const [entry] = logEntries(L);
      assert.equal(entry.fault.length, 500);
      assert.equal(entry.fault, message.slice(0, 500));
    });
  });

  test("a server that is no longer connected: the call is failed with the message of the rejection", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      const got = await messages(ctx, ["tools.fake.die({})", "tools.fake.rec({})"]);
      assert.equal(got[1], "fake.rec failed: not connected");
      const entries = logEntries(L);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].id, "fake.die");
      assert.equal(entries[0].size, null);
      assert.equal(entries[1].fault, "fake.rec failed: not connected");
      assert.equal(entries[1].decision, "allowed");
    });
  });

  test("a call under allow that does not match is denied", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS(), { allow: ["fake.plain"] }), async (ctx) => {
      await messages(ctx, ["tools.fake.plain({})", "tools.fake.rec({})"]);
      const entries = logEntries(L);
      assert.deepEqual(entries.map((entry) => [entry.id, entry.decision, entry.fault, entry.size]), [
        ["fake.plain", "allowed", null, 11],
        ["fake.rec", "denied", "refused by the rules", null],
      ]);
    });
  });

  test("the shell: a command that fails with an exit code, a path outside, a denied command, a failed read", async () => {
    const { W } = workFolder({ "two.txt": "nothing\n" });
    const L = tmpDir();
    await withOnetool(WITH_SHELL(L, W, { shell: { deny: ["rm *"] } }), async (ctx) => {
      const code = [
        "await $`exit 3`.nothrow();",
        'try { await read("../x.txt"); } catch (e) {}',
        "try { await $`rm two.txt`; } catch (e) {}",
        'try { await read("missing.txt"); } catch (e) {}',
        '"end"',
      ].join("\n");
      assert.deepEqual(await ran(ctx, code), { text: "end", isError: false });
      const entries = logEntries(L);
      entries.forEach(assertShape);
      assert.deepEqual(
        entries.map((entry) => [entry.id, entry.args, entry.decision, entry.size, entry.fault.startsWith("shell.read failed: ") ? "shell.read failed" : entry.fault]),
        [
          ["shell.run", { command: "exit 3" }, "allowed", null, "exit code 3"],
          ["shell.read", { path: "../x.txt" }, "allowed", null, "outside the listed folders"],
          ["shell.run", { command: "rm two.txt" }, "denied", null, "refused by the rules"],
          ["shell.read", { path: "missing.txt" }, "allowed", null, "shell.read failed"],
        ],
      );
      assert.equal(existsSync(join(W, "two.txt")), true);
    });
  });

  test("the shell: a tool denied by id, a command outside allow", async () => {
    const { W } = workFolder();
    const L = tmpDir();
    await withOnetool(WITH_SHELL(L, W, { shell: { allow: ["echo *"] }, onetool: { deny: ["shell.write"] } }), async (ctx) => {
      await messages(ctx, ['write("b.txt", "x")', "$`ls`", "$`echo ok`"]);
      const entries = logEntries(L);
      assert.deepEqual(entries.map((entry) => [entry.id, entry.args, entry.decision, entry.fault]), [
        ["shell.write", { path: "b.txt", size: 1 }, "denied", "refused by the rules"],
        ["shell.run", { command: "ls" }, "denied", "refused by the rules"],
        ["shell.run", { command: "echo ok" }, "allowed", null],
      ]);
      assert.equal(existsSync(join(W, "b.txt")), false);
    });
  });
});

describe("a call that has not ended when the program's result is there", () => {
  test("it is complete at that moment, `unfinished`, with its line in the file when `run` answers", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      assert.deepEqual(await ran(ctx, "tools.fake.barrier({}); await tools.fake.plain({}); 1"), { text: "1", isError: false });
      const entries = logEntries(L);
      assert.deepEqual(entries.map((entry) => entry.id), ["fake.plain", "fake.barrier"]);
      assert.equal(entries[1].decision, "allowed");
      assert.equal(entries[1].size, null);
      assert.equal(entries[1].fault, "unfinished");
      assertShape(entries[1]);
    });
  });

  test("what the call does afterwards is not recorded", async () => {
    const L = tmpDir();
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      await ran(ctx, "tools.fake.barrier({}); await tools.fake.plain({}); 1");
      assert.equal(logEntries(L).length, 2);
      // this barrier lets the first one go; its answer comes to a program that is gone
      await ran(ctx, "await tools.fake.barrier({}); 2");
      await sleep(300);
      const entries = logEntries(L);
      assert.equal(entries.length, 3);
      assert.deepEqual(entries.map((entry) => entry.fault), [null, "unfinished", null]);
    });
  });

  test("a program stopped at the time limit while a command runs: the line of the command is `unfinished`", async () => {
    const { W } = workFolder();
    const L = tmpDir();
    await withOnetool(WITH_SHELL(L, W, { onetool: { timeoutSeconds: 1 } }), async (ctx) => {
      const answer = await ran(ctx, "await $`sleep 30`");
      assert.deepEqual(answer, { text: "The program was stopped after 1 seconds.", isError: true });
      const [entry] = logEntries(L);
      assert.equal(logEntries(L).length, 1);
      assertShape(entry);
      assert.equal(entry.id, "shell.run");
      assert.deepEqual(entry.args, { command: "sleep 30" });
      assert.equal(entry.size, null);
      assert.equal(entry.fault, "unfinished");
    });
  });
});

describe("what the file never holds", () => {
  test("no answer of a call, no text written, edited or read, no value of the settings file", async () => {
    const { W } = workFolder({ "a.txt": "FILE-CONTENT-ZZZ\n" });
    const L = tmpDir();
    const settings = WITH_SHELL(L, W, {
      shell: { deny: ["rm *"], ask: ["never-matches *"] },
      onetool: { deny: ["fake.wipe*-PATTERN"] },
      servers: SERVERS({}, { env: { TOKEN: "TOKEN-VALUE-XYZ" } }),
    });
    await withOnetool(settings, async (ctx) => {
      const code = [
        'await write("new.txt", "SECRET-TEXT-OF-THE-FILE");',
        'await edit("a.txt", "CONTENT", "EDITED-TEXT-ZZZ");',
        'await read("a.txt");',
        "await tools.fake.plain({});",
        "await tools.fake.env({});",
        "try { await $`rm a.txt`; } catch (e) {}",
        '"done"',
      ].join("\n");
      await ran(ctx, code);
      const text = logText(L);
      assert.ok(text.includes("rm a.txt"), "the command text is an argument and is kept");
      for (const secret of [
        "SECRET-TEXT-OF-THE-FILE", "FILE-CONTENT-ZZZ", "EDITED-TEXT-ZZZ", "hello world", "TOKEN-VALUE-XYZ",
        "rm *", "never-matches", "-PATTERN", W, L,
      ]) {
        assert.ok(!text.includes(secret), `the log does not hold ${secret}`);
      }
    });
  });
});

describe("where the log goes", () => {
  test("the folder is made, with the folders above it, at the first line written", async () => {
    const L = join(tmpDir(), "a", "b", "c");
    await withOnetool(logSettings(L, SERVERS()), async (ctx) => {
      await ran(ctx, "1 + 1");
      assert.equal(existsSync(L), false);
      await ran(ctx, "await tools.fake.plain({}); 1");
      assert.equal(logFiles(L).length, 1);
      assert.equal(logEntries(L).length, 1);
    });
  });

  test('"log": false: no folder is made and nothing is written', async () => {
    const L = join(tmpDir(), "never");
    const { W } = workFolder({ "a.txt": "x" });
    await withOnetool(WITH_SHELL(L, W, { onetool: { log: false, trail: true } }), async (ctx) => {
      const answer = await ran(ctx, 'await read("a.txt"); await tools.fake.plain({}); 1');
      assert.ok(answer.text.includes("--- calls ---"), "the trail works without the log");
      assert.equal(existsSync(L), false);
    });
  });

  test("with a logFolder: the log is in it, and nothing is written in the working folder", async () => {
    const cwd = tmpDir();
    const folder = join(tmpDir(), "own-log");
    const marker = `marker-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const settings = settingsOf(SERVERS(), { trail: false, logFolder: folder });
    await withOnetool(
      settings,
      async (ctx) => {
        await ran(ctx, `await tools.fake.rec({ marker: ${JSON.stringify(marker)} }); 1`);
        assert.ok(existsSync(folder), "the folder of the settings is made");
        const found = [];
        for (const name of readdirSync(folder).filter((one) => FILE_NAME.test(one))) {
          for (const line of readFileSync(join(folder, name), "utf8").split("\n")) {
            if (line.includes(marker)) found.push(JSON.parse(line));
          }
        }
        assert.equal(found.length, 1);
        assertShape(found[0]);
        assert.equal(found[0].id, "fake.rec");
        assert.deepEqual(found[0].args, { marker });
      },
      { cwd },
    );
    assert.deepEqual(readdirSync(cwd), []);
  });
});

describe("a log that cannot be written", () => {
  const COUNT = (text) => text.split("onetool: the log cannot be written").length - 1;

  /** The program is answered as it would be, the line is on standard error once, and it holds no path. */
  async function check(settings, forbidden) {
    await withOnetool(settings, async (ctx) => {
      const first = await ran(ctx, 'await tools.fake.plain({}); await tools.fake.json({}); "one"');
      assert.deepEqual(first, { text: "one", isError: false });
      await waitFor(() => ctx.stderr().includes("onetool: the log cannot be written"), 3000, "the line on standard error");
      const second = await ran(ctx, 'await tools.fake.plain({}); await tools.fake.rec({}); "two"');
      assert.deepEqual(second, { text: "two", isError: false });
      assert.deepEqual(await ran(ctx, "await tools.fake.plain({})"), { text: "hello world", isError: false });
      await sleep(300);
      assert.equal(COUNT(ctx.stderr()), 1, "once for the life of the process");
      assert.ok(ctx.stderrLines().includes("onetool: the log cannot be written"));
      for (const piece of forbidden) assert.ok(!ctx.stderr().includes(piece), `no path on standard error: ${piece}`);
    });
  }

  test("the folder cannot be made: the answers are what they would be, one line on standard error", async () => {
    const file = tmpPath("a-file");
    writeFileSync(file, "x");
    const L = join(file, "sub");
    await check(logSettings(L, SERVERS()), [L, file]);
  });

  test("the file cannot be opened: the same", async () => {
    const L = tmpDir();
    mkdirSync(join(L, todayFile()));
    await check(logSettings(L, SERVERS()), [L]);
  });

  test("the trail is not touched by it", async () => {
    const file = tmpPath("a-file");
    writeFileSync(file, "x");
    await withOnetool(logSettings(join(file, "sub"), SERVERS(), { trail: true }), async (ctx) => {
      const answer = await ran(ctx, "await tools.fake.plain({}); 1");
      assert.ok(answer.text.startsWith("1\n--- calls ---\nfake.plain "), answer.text);
    });
  });
});

describe("the decision of a call that a rule of ask covers", () => {
  const ASK_SERVERS = (ask) => (L, onetool = {}) => settingsOf(SERVERS(), { trail: false, logFolder: L, ask, ...onetool });
  const REC = "await tools.fake.rec({ a: 1 })";
  const ACCEPT = () => ({ action: "accept" });

  const cases = [
    ["the person said yes", { answer: ACCEPT }, "asked: yes"],
    ["decline", { answer: () => ({ action: "decline" }) }, "asked: no"],
    ["cancel", { answer: () => ({ action: "cancel" }) }, "asked: no answer"],
    ["the host answers with an error", { answer: () => ({ error: { code: -32603, message: "no" } }) }, "asked: failed"],
    ["the host cannot ask", { capabilities: {} }, "asked: cannot ask"],
  ];
  for (const [name, options, decision] of cases) {
    test(`${name}: decision \`${decision}\``, async () => {
      const L = tmpDir();
      await withHost(ASK_SERVERS(["fake.rec"])(L), options, async (host) => {
        await host.run(`try { ${REC}; } catch (e) {} 1`);
        const [entry] = logEntries(L);
        assert.equal(logEntries(L).length, 1);
        assertShape(entry);
        assert.equal(entry.id, "fake.rec");
        assert.deepEqual(entry.args, { a: 1 });
        assert.equal(entry.decision, decision);
        if (decision === "asked: yes") {
          assert.equal(entry.size, 10);
          assert.equal(entry.fault, null);
        } else {
          assert.equal(entry.size, null);
          assert.equal(entry.fault, "refused by the rules");
        }
      });
    });
  }

  test("the time of the question is in `ms`, in the log and in the trail", async () => {
    const L = tmpDir();
    const answer = async () => {
      await sleep(400);
      return { action: "accept" };
    };
    await withHost(ASK_SERVERS(["fake.rec"])(L, { trail: true }), { answer }, async (host) => {
      const result = await host.run("await tools.fake.rec({}); 1");
      const [entry] = logEntries(L);
      assert.ok(entry.ms >= 350, `ms holds the question: ${entry.ms}`);
      const ms = Number(/^fake\.rec (\d+) ms 10 chars$/m.exec(result.text)?.[1]);
      assert.ok(ms >= 350, `the trail holds it too: ${result.text}`);
    });
  });

  test("bad arguments: `asked: not asked`, and the person is not asked", async () => {
    const L = tmpDir();
    await withHost(ASK_SERVERS(["fake.rec"])(L), { answer: ACCEPT }, async (host) => {
      await host.run("try { await tools.fake.rec(5); } catch (e) {} 1");
      assert.equal(host.questions.length, 0);
      const [entry] = logEntries(L);
      assert.equal(entry.decision, "asked: not asked");
      assert.equal(entry.size, null);
      assert.equal(entry.fault, "onetool: the arguments of fake.rec must be an object");
    });
  });

  test("a server that is not connected: `asked: not asked`", async () => {
    const L = tmpDir();
    await withHost(ASK_SERVERS(["fake.rec"])(L), { answer: ACCEPT }, async (host) => {
      await host.run("try { await tools.fake.die({}); } catch (e) {} try { await tools.fake.rec({}); } catch (e) {} 1");
      assert.equal(host.questions.length, 0);
      const entry = entriesOf(L, "fake.rec")[0];
      assert.equal(entry.decision, "asked: not asked");
      assert.equal(entry.fault, "fake.rec failed: not connected");
    });
  });

  test("the program ended first: `asked: not asked`, the call is `unfinished`", async () => {
    const L = tmpDir();
    // no answer is ever given to the question
    await withHost(ASK_SERVERS(["fake.rec"])(L), { answer: () => undefined }, async (host) => {
      assert.deepEqual(await host.run("tools.fake.rec({}); await tools.fake.plain({}); 1"), { text: "1", isError: false });
      const entries = logEntries(L);
      assert.deepEqual(entries.map((entry) => entry.id), ["fake.plain", "fake.rec"]);
      assert.equal(entries[1].decision, "asked: not asked");
      assert.equal(entries[1].size, null);
      assert.equal(entries[1].fault, "unfinished");
    });
  });

  test("accepted, then the tool fails: the decision stays `asked: yes`, the call is failed", async () => {
    const L = tmpDir();
    const settings = settingsOf(SERVERS(), { trail: false, logFolder: L, ask: ["fake.rpcerr"] });
    await withHost(settings, { answer: ACCEPT }, async (host) => {
      await host.run("try { await tools.fake.rpcerr({}); } catch (e) {} 1");
      const [entry] = logEntries(L);
      assert.equal(entry.decision, "asked: yes");
      assert.equal(entry.size, null);
      assert.ok(entry.fault.startsWith("fake.rpcerr failed: "));
    });
  });

  test("a call that deny refuses is `denied`, whatever ask holds, and nobody is asked", async () => {
    const L = tmpDir();
    await withHost(ASK_SERVERS(["fake.rec"])(L, { deny: ["fake.rec"] }), { answer: ACCEPT }, async (host) => {
      await host.run("try { await tools.fake.rec({}); } catch (e) {} 1");
      assert.equal(host.questions.length, 0);
      const [entry] = logEntries(L);
      assert.equal(entry.decision, "denied");
      assert.equal(entry.fault, "refused by the rules");
    });
  });

  test("the shell: a rule of onetool.ask on a tool, a rule of onetool.shell.ask on a command", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    const L = tmpDir();
    const settings = WITH_SHELL(L, W, { shell: { ask: ["echo *"] }, onetool: { ask: ["shell.edit"] } });
    await withHost(settings, { answer: ACCEPT }, async (host) => {
      await host.run('await edit("a.txt", "hello", "bye"); await $`echo hi`.text(); await $`ls`.text(); 1');
      assert.equal(host.questions.length, 2);
      assert.deepEqual(logEntries(L).map((entry) => [entry.id, entry.decision]), [
        ["shell.edit", "asked: yes"],
        ["shell.run", "asked: yes"],
        ["shell.run", "allowed"],
      ]);
      assert.deepEqual(logEntries(L)[1].args, { command: "echo hi" });
    });
    const declined = tmpDir();
    await withHost(WITH_SHELL(declined, W, { shell: { ask: ["echo *"] } }), { answer: () => ({ action: "decline" }) }, async (host) => {
      await host.run("try { await $`echo hi`; } catch (e) {} 1");
      const [entry] = logEntries(declined);
      assert.equal(entry.decision, "asked: no");
      assert.equal(entry.fault, "refused by the rules");
    });
  });
});

describe("the end with a log", () => {
  const settingsOnLog = () => logSettings(tmpDir(), SERVERS());
  async function calledOnce(raw) {
    await raw.initialize();
    const answer = await raw.callTool("run", { code: "await tools.fake.plain({}); 1" });
    assert.equal(answer.result.content[0].text, "1");
  }

  test("standard input closes: exit code 0 within 5 seconds", async () => {
    await withRaw(settingsOnLog(), async (raw) => {
      await calledOnce(raw);
      raw.child.stdin.end();
      assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(`${signal}: exit code 0 within 5 seconds`, async () => {
      await withRaw(settingsOnLog(), async (raw) => {
        await calledOnce(raw);
        assert.deepEqual(await raw.endBy(signal, 5000), { code: 0, signal: null });
      });
    });
  }
});
