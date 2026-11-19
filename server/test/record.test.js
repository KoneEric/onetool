// Step 4: the trail at the end of the answer of `run` (the meeting point of server, "Step 4: the record of every call", "The trail").
// The log is off in these tests (`"log": false`) unless said. The lines of a trail are those of the meeting point of core, "Step 4:
// the trail": `--- calls ---`, then `<id> <ms> ms <size> chars` for `ok` and `<id> <ms> ms <outcome>` for the others.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { alive, fakeEntry, settingsOf, textOf, waitFor, withOnetool, withoutSession } from "./helpers.js";
import { WAITING_COMMAND, pidsIn, ran, workFolder } from "./shellhelpers.js";
import { assertTrail, splitTrail } from "./recordhelpers.js";

const NAMES = ["rec", "plain", "json", "structured", "empty", "toolerr", "rpcerr", "die", "barrier", "wipe", "calls"];
const FAKE = () => fakeEntry({ tools: NAMES });

/** The settings of a test of the trail: the log is off. `onetool` holds the other keys of `onetool`. */
const TRAIL = (onetool = {}, servers = { fake: FAKE() }) => settingsOf(servers, { log: false, trail: false, ...onetool });
/** The same with the shell on in the folder `W` and the trail on (`onetool` may say otherwise). */
const WITH_SHELL = (W, onetool = {}, shell = {}) => settingsOf({ fake: FAKE() }, { log: false, trail: true, shell: { folders: [W], ...shell }, ...onetool });

describe("when the trail is on", () => {
  test("with the trail on and the shell on: the answer is the text, a line break, the trail", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    await withOnetool(WITH_SHELL(W), async (ctx) => {
      const answer = await ran(ctx, 'await read("a.txt")');
      assert.equal(answer.isError, false);
      const { body, lines } = splitTrail(answer.text);
      assert.equal(body, "hello\n");
      // "hello\n" is 6 characters
      assertTrail(lines, [["shell.read", "6 chars"]]);
    });
  });

  test("with the trail off and no shell: the answer is the text to the character, whatever was called", async () => {
    await withOnetool(TRAIL(), async (ctx) => {
      assert.deepEqual(await ran(ctx, "await tools.fake.plain({})"), { text: "hello world", isError: false });
    });
  });

  test('"trail": false with the shell on: no trail', async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    await withOnetool(WITH_SHELL(W, { trail: false }), async (ctx) => {
      assert.deepEqual(await ran(ctx, 'await read("a.txt")'), { text: "hello\n", isError: false });
    });
  });

  test('"trail": true with no shell: the trail is there', async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      const answer = await ran(ctx, "await tools.fake.plain({})");
      const { body, lines } = splitTrail(answer.text);
      assert.equal(body, "hello world");
      assertTrail(lines, [["fake.plain", "11 chars"]]);
    });
  });
});

describe("a trail", () => {
  test("`ok` lines show callSize of the value: the length of a text, of the JSON of anything else, 0 for undefined", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      const code = [
        "await tools.fake.plain({});", // "hello world": 11
        "await tools.fake.json({});", // the value {"n":12}: JSON text of 8 characters
        "await tools.fake.structured({});", // {"x":1}: 7
        "await tools.fake.empty({});", // null: JSON text `null`, 4
        "await tools.fake.rec({});", // "called rec": 10
        '"done"',
      ].join("\n");
      const { body, lines } = splitTrail((await ran(ctx, code)).text);
      assert.equal(body, "done");
      assertTrail(lines, [
        ["fake.plain", "11 chars"],
        ["fake.json", "8 chars"],
        ["fake.structured", "7 chars"],
        ["fake.empty", "4 chars"],
        ["fake.rec", "10 chars"],
      ]);
    });
  });

  test("the lines come in the order the calls began, not the order they ended", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      // the first barrier waits for the second: it begins first and ends last
      const code = [
        "const slow = tools.fake.barrier({});",
        "await tools.fake.plain({});",
        "await tools.fake.json({});",
        "await Promise.all([slow, tools.fake.barrier({})]);",
        '"done"',
      ].join("\n");
      const { body, lines } = splitTrail((await ran(ctx, code)).text);
      assert.equal(body, "done");
      // "released" is 8 characters
      assertTrail(lines, [
        ["fake.barrier", "8 chars"],
        ["fake.plain", "11 chars"],
        ["fake.json", "8 chars"],
        ["fake.barrier", "8 chars"],
      ]);
    });
  });

  test("a refusal by deny is `refused`; a failure of the tool, of the server and bad arguments are `failed`", async () => {
    await withOnetool(TRAIL({ trail: true, deny: ["fake.wipe"] }), async (ctx) => {
      const code = [
        "for (const call of [() => tools.fake.rpcerr({}), () => tools.fake.toolerr({}), () => tools.fake.wipe({}), () => tools.fake.rec(5)]) {",
        "  try { await call(); } catch (e) {}",
        "}",
        '"done"',
      ].join("\n");
      const { body, lines } = splitTrail((await ran(ctx, code)).text);
      assert.equal(body, "done");
      assertTrail(lines, [
        ["fake.rpcerr", "failed"],
        ["fake.toolerr", "failed"],
        ["fake.wipe", "refused"],
        ["fake.rec", "failed"],
      ]);
    });
  });

  test("a server that is no longer connected: the call is `failed`", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      const code = 'try { await tools.fake.die({}); } catch (e) {}\ntry { await tools.fake.rec({}); } catch (e) {}\n"done"';
      const { lines } = splitTrail((await ran(ctx, code)).text);
      assertTrail(lines, [
        ["fake.die", "failed"],
        ["fake.rec", "failed"],
      ]);
    });
  });

  test("the answer of a program that fails keeps `isError`, the console lines, then the trail", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      const answer = await ran(ctx, 'console.log("hi"); await tools.fake.plain({}); throw new Error("boom")');
      assert.equal(answer.isError, true);
      const prefix = "The program failed: Error: boom\n--- console.log ---\nhi\n--- calls ---\n";
      assert.ok(answer.text.startsWith(prefix), answer.text);
      assertTrail(answer.text.slice(answer.text.indexOf("--- calls ---")).split("\n"), [["fake.plain", "11 chars"]]);
    });
  });

  test("more than 20 calls: the first 20 lines, then `(<n> more not shown)`", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      const { body, lines } = splitTrail((await ran(ctx, 'for (let i = 0; i < 22; i++) await tools.fake.plain({}); "done"')).text);
      assert.equal(body, "done");
      // 22 calls, the limit is 20: 2 are left out
      assert.equal(lines.length, 1 + 20 + 1);
      assert.equal(lines[0], "--- calls ---");
      for (const line of lines.slice(1, 21)) assert.match(line, /^fake\.plain \d+ ms 11 chars$/);
      assert.equal(lines[21], "(2 more not shown)");
    });
  });

  test("exactly 20 calls are all shown", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      const { lines } = splitTrail((await ran(ctx, 'for (let i = 0; i < 20; i++) await tools.fake.plain({}); "done"')).text);
      assert.equal(lines.length, 21);
      assert.ok(!lines.at(-1).includes("more not shown"));
    });
  });

  test("an answer longer than answerLimit is exactly answerLimit characters and still ends with its whole trail", async () => {
    await withOnetool(TRAIL({ trail: true, answerLimit: 1000 }), async (ctx) => {
      const answer = await ran(ctx, 'await tools.fake.plain({}); "x".repeat(3000)');
      assert.equal(answer.isError, false);
      assert.equal(answer.text.length, 1000);
      const at = answer.text.indexOf("\n--- calls ---\n");
      const trail = answer.text.slice(at + 1);
      assertTrail(trail.split("\n"), [["fake.plain", "11 chars"]]);
      // withTrail: the whole is the text (3000), one line break and the trail; the notice names that length;
      // room is the limit minus the notice, minus 1, minus the trail
      const notice = `\n[cut: the answer was ${3000 + 1 + trail.length} characters, the limit is 1000]`;
      const room = 1000 - notice.length - 1 - trail.length;
      assert.equal(answer.text, `${"x".repeat(room)}${notice}\n${trail}`);
    });
  });

  test("a program that made no call has no trail, with the trail on", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      assert.deepEqual(await ran(ctx, "1 + 1"), { text: "2", isError: false });
      assert.deepEqual(await ran(ctx, 'console.log("x"); 3'), { text: "3\n--- console.log ---\nx", isError: false });
    });
  });

  test('`run` without "code" and every answer of `search` never have a trail', async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      await ran(ctx, "await tools.fake.plain({})");
      const noCode = await ctx.call("run", {});
      assert.equal(noCode.isError, true);
      assert.equal(textOf(noCode), 'onetool: run needs "code", a text');
      const search = withoutSession(textOf(await ctx.call("search", {})));
      assert.equal(search, `fake: ${NAMES.length} tools`);
      assert.ok(!search.includes("--- calls ---"));
      const bad = await ctx.call("search", { words: 5 });
      assert.equal(textOf(bad), 'onetool: search takes "words", a text');
    });
  });
});

describe("the trail of the shell", () => {
  test("a command, a file written, read and edited; a command that fails; a path outside; a denied command; a read that fails", async () => {
    const { W } = workFolder();
    await withOnetool(WITH_SHELL(W, {}, { deny: ["rm *"] }), async (ctx) => {
      const code = [
        'await write("a.txt", "hello\\n");',
        'await read("a.txt");',
        'await edit("a.txt", "hello", "bye");',
        "await $`echo hello`.text();",
        "await $`exit 3`.nothrow();",
        'try { await read("../x.txt"); } catch (e) {}',
        "try { await $`rm a.txt`; } catch (e) {}",
        'try { await read("missing.txt"); } catch (e) {}',
        '"end"',
      ].join("\n");
      const answer = await ran(ctx, code);
      assert.equal(answer.isError, false, answer.text);
      const { body, lines } = splitTrail(answer.text);
      assert.equal(body, "end");
      // callSize of the object of a command: the length of its JSON text
      const size = JSON.stringify({ exitCode: 0, stdout: "hello\n", stderr: "" }).length;
      assertTrail(lines, [
        ["shell.write", "0 chars"],
        ["shell.read", "6 chars"],
        ["shell.edit", "0 chars"],
        ["shell.run", `${size} chars`],
        ["shell.run", "failed"],
        ["shell.read", "refused"],
        ["shell.run", "refused"],
        ["shell.read", "failed"],
      ]);
    });
  });

  test("a program stopped at the time limit while a command runs: the answer, then a trail ending with `unfinished`", async () => {
    const { W } = workFolder();
    let pids;
    try {
      await withOnetool(WITH_SHELL(W, { timeoutSeconds: 1 }), async (ctx) => {
        const answer = await ran(ctx, `await $(${JSON.stringify(WAITING_COMMAND)})`);
        assert.equal(answer.isError, true);
        assert.ok(answer.text.startsWith("The program was stopped after 1 seconds.\n--- calls ---\n"), answer.text);
        assertTrail(answer.text.split("\n").slice(1), [["shell.run", "unfinished"]]);
        pids = await waitFor(() => (existsSync(join(W, "pids")) ? pidsIn(readFileSync(join(W, "pids"), "utf8")) : null), 3000, "the command's process numbers");
        await waitFor(() => pids.every((pid) => !alive(pid)), 2500, "the processes to be gone");
      });
    } finally {
      for (const pid of pids ?? []) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
    }
  });
});

describe("a call that has not ended when its program ends", () => {
  test("a program that ends by itself: the call is `unfinished` in the trail, at the place it began", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      // the second barrier never comes: the first call is still waiting when the program returns
      const { body, lines } = splitTrail((await ran(ctx, "tools.fake.barrier({}); await tools.fake.plain({}); 1")).text);
      assert.equal(body, "1");
      assertTrail(lines, [
        ["fake.barrier", "unfinished"],
        ["fake.plain", "11 chars"],
      ]);
    });
  });

  test("what the call does afterwards is not recorded: a later program is not given its line", async () => {
    await withOnetool(TRAIL({ trail: true }), async (ctx) => {
      await ran(ctx, "tools.fake.barrier({}); await tools.fake.plain({}); 1");
      // this barrier releases the first one, whose answer then comes to a program that is gone
      const { body, lines } = splitTrail((await ran(ctx, "await tools.fake.barrier({}); 2")).text);
      assert.equal(body, "2");
      assertTrail(lines, [["fake.barrier", "8 chars"]]);
    });
  });
});
