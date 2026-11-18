// Step 4: the rules `ask` on the built-in server `shell` (the meeting point of server, "`callTool("shell", tool, args)` when the
// shell is on", point 4: asked exactly as "Step 3: `ask`" says from its point b to its point f). The host program is the
// raw one of askhost.js. Trail and log are off in every settings file.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { practiceEntry, waitFor } from "./helpers.js";
import { CAUGHT, pause, withHost } from "./askhost.js";
import { CANNOT_ASK, NO_ANSWER, QUESTION_FAILED, SAID_NO, question, refusal, shellSettings, workFolder } from "./shellhelpers.js";

const ACCEPT = () => ({ action: "accept" });
const caught = (answer) => JSON.parse(answer.text);
const EDIT = 'await edit("a.txt", "hello", "bye"); return "done"';
const EDIT_ARGS = '{"path":"a.txt","old":"hello","new":"bye"}';

describe("a rule of ask on a tool of the shell (onetool.ask)", () => {
  test("accept: one question that says what core says, then the work is done", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    await withHost(shellSettings([W], { onetool: { ask: ["shell.edit"] } }), { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run(EDIT), { text: "done", isError: false });
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, question("shell.edit", "shell.edit", EDIT_ARGS));
      assert.deepEqual(host.questions[0].params.requestedSchema, { type: "object", properties: {} });
      assert.equal(readFileSync(join(W, "a.txt"), "utf8"), "bye\n");
    });
  });

  for (const [action, cause] of [["decline", SAID_NO], ["cancel", NO_ANSWER]]) {
    test(`${action}: the program gets the refusal, and nothing is written`, async () => {
      const { W } = workFolder({ "a.txt": "hello\n" });
      await withHost(shellSettings([W], { onetool: { ask: ["shell.edit"] } }), { answer: () => ({ action }) }, async (host) => {
        const res = caught(await host.run(CAUGHT('edit("a.txt", "hello", "bye")')));
        assert.deepEqual(res, [true, refusal("shell.edit", "shell.edit", cause)]);
        assert.equal(readFileSync(join(W, "a.txt"), "utf8"), "hello\n");
      });
    });
  }

  test("the host answers with an error: the refusal `the question failed`, without the error's message", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    const answer = () => ({ error: { code: -32603, message: "SECRET-HOST-MESSAGE" } });
    await withHost(shellSettings([W], { onetool: { ask: ["shell.edit"] } }), { answer }, async (host) => {
      const res = caught(await host.run(CAUGHT('edit("a.txt", "hello", "bye")')));
      assert.deepEqual(res, [true, refusal("shell.edit", "shell.edit", QUESTION_FAILED)]);
      assert.ok(!host.stderr().includes("SECRET-HOST-MESSAGE"));
      assert.equal(readFileSync(join(W, "a.txt"), "utf8"), "hello\n");
    });
  });

  test("a host that cannot ask: the refusal of step 3, nothing is sent", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    await withHost(shellSettings([W], { onetool: { ask: ["shell.edit"] } }), { capabilities: {} }, async (host) => {
      const res = caught(await host.run(CAUGHT('edit("a.txt", "hello", "bye")')));
      assert.deepEqual(res, [true, refusal("shell.edit", "shell.edit", CANNOT_ASK)]);
      assert.equal(host.questions.length, 0);
      assert.equal(readFileSync(join(W, "a.txt"), "utf8"), "hello\n");
    });
  });

  test("each call is asked anew; a call no rule covers is never asked about", async () => {
    const { W } = workFolder({ "a.txt": "hello hello\n" });
    await withHost(shellSettings([W], { onetool: { ask: ["shell.edit"] } }), { answer: ACCEPT }, async (host) => {
      assert.equal((await host.run('await edit("a.txt", "hello hello", "one"); await edit("a.txt", "one", "two"); return "ok"')).text, "ok");
      assert.equal(host.questions.length, 2);
      assert.equal((await host.run('await read("a.txt")')).text, "two\n");
      assert.equal((await host.run('await write("b.txt", "x"); await $`echo hi`.text()')).text, "hi\n");
      assert.equal(host.questions.length, 2, "read, write and a command were not asked about");
    });
  });
});

describe("a rule of ask on commands (onetool.shell.ask)", () => {
  test("accept: the question has the rule and the command, then the command is run", async () => {
    const { W } = workFolder();
    await withHost(shellSettings([W], { shell: { ask: ["echo *"] } }), { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run("await $`echo hi`.text()"), { text: "hi\n", isError: false });
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, question("shell.run", "echo *", '{"command":"echo hi"}'));
      assert.deepEqual(await host.run("await $`ls`.text()"), { text: "", isError: false });
      assert.equal(host.questions.length, 1, "a command that no pattern matches is not asked about");
    });
  });

  test("decline: the command is not run; a yes is run only after it", async () => {
    const { W } = workFolder();
    let action = "decline";
    await withHost(shellSettings([W], { shell: { ask: ["touch *"] } }), { answer: () => ({ action }) }, async (host) => {
      const no = caught(await host.run(CAUGHT("$`touch m.txt`")));
      assert.deepEqual(no, [true, refusal("shell.run", "touch *", SAID_NO)]);
      assert.equal(existsSync(join(W, "m.txt")), false);
      action = "accept";
      assert.equal((await host.run("await $`touch m.txt`; 1")).text, "1");
      assert.equal(existsSync(join(W, "m.txt")), true);
    });
  });

  test("a host that cannot ask gets the refusal of step 3 and the command is not run", async () => {
    const { W } = workFolder();
    await withHost(shellSettings([W], { shell: { ask: ["touch *"] } }), { capabilities: {} }, async (host) => {
      const res = caught(await host.run(CAUGHT("$`touch m.txt`")));
      assert.deepEqual(res, [true, refusal("shell.run", "touch *", CANNOT_ASK)]);
      assert.equal(existsSync(join(W, "m.txt")), false);
      assert.equal(host.questions.length, 0);
    });
  });

  test("one question at most: the rule of onetool.ask is the one named when both cover the call", async () => {
    const { W } = workFolder();
    const settings = shellSettings([W], { shell: { ask: ["echo *"] }, onetool: { ask: ["shell.run"] } });
    await withHost(settings, { answer: ACCEPT }, async (host) => {
      assert.equal((await host.run("await $`echo hi`.text()")).text, "hi\n");
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, question("shell.run", "shell.run", '{"command":"echo hi"}'));
    });
  });
});

describe("what is refused before a question", () => {
  test("a call that deny refuses is refused without a question, whatever ask holds", async () => {
    const { W } = workFolder({ "a.txt": "alpha\n" });
    const settings = shellSettings([W], { shell: { deny: ["rm *"] }, onetool: { ask: ["shell.*"], deny: ["shell.write"] } });
    await withHost(settings, { answer: ACCEPT }, async (host) => {
      assert.deepEqual(caught(await host.run(CAUGHT("$`rm a.txt`"))), [
        true,
        'onetool: shell.run is denied by the rule deny "rm *" of onetool.shell',
      ]);
      assert.deepEqual(caught(await host.run(CAUGHT('write("b.txt", "x")'))), [
        true,
        'onetool: shell.write is denied by the rule deny "shell.write"',
      ]);
      assert.equal(existsSync(join(W, "a.txt")), true);
      assert.equal(existsSync(join(W, "b.txt")), false);
      assert.equal(host.questions.length, 0);
    });
  });

  test("bad arguments, an empty command and a path outside are refused before the question or without one", async () => {
    const { W } = workFolder();
    await withHost(shellSettings([W], { onetool: { ask: ["shell.*"] } }), { answer: ACCEPT }, async (host) => {
      assert.deepEqual(caught(await host.run(CAUGHT('tools.shell.read("x")'))), [
        true,
        "onetool: the arguments of shell.read must be an object",
      ]);
      assert.deepEqual(caught(await host.run(CAUGHT("tools.shell.run({ command: '  ' })"))), [
        true,
        "shell.run failed: the command must be a text that is not empty",
      ]);
      assert.equal(host.questions.length, 0, "the person only sees calls that can be made");
    });
  });
});

describe("the turn, and the person's time", () => {
  test("two calls at once: the host receives the second question only after it answered the first", async () => {
    const { W } = workFolder({ "a.txt": "hello\n" });
    const settings = shellSettings([W], {
      servers: { practice: practiceEntry() },
      onetool: { ask: ["shell.edit", "practice.wipe"] },
    });
    await withHost(settings, { answer: () => undefined }, async (host) => {
      const program = host.run('await Promise.all([edit("a.txt", "hello", "bye"), tools.practice.wipe({})]); return "both"');
      await host.waitQuestions(1);
      await pause(400);
      assert.equal(host.questions.length, 1, "the second question waits for the first answer");
      host.questions[0].reply({ action: "accept" });
      await host.waitQuestions(2);
      host.questions[1].reply({ action: "accept" });
      assert.deepEqual(await program, { text: "both", isError: false });
      const messages = host.questions.map((one) => one.message).sort();
      assert.deepEqual(
        messages,
        [question("shell.edit", "shell.edit", EDIT_ARGS), question("practice.wipe", "practice.wipe", "{}")].sort(),
      );
    });
  });

  test("the program's time limit runs while the question is open, and the command never starts", async () => {
    const { W } = workFolder();
    const settings = shellSettings([W], { shell: { ask: ["touch *"] }, onetool: { timeoutSeconds: 2 } });
    await withHost(settings, { answer: () => undefined }, async (host) => {
      const answer = await host.run("await $`touch m.txt`");
      assert.deepEqual(answer, { text: "The program was stopped after 2 seconds.", isError: true });
      assert.equal(host.questions.length, 1);
      await pause(400);
      assert.equal(existsSync(join(W, "m.txt")), false, "a command starts only after the yes");
      await waitFor(() => host.events.some((event) => event.kind === "cancelled"), 3000, "the open question to be given up");
    });
  });
});
