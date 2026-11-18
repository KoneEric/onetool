// Step 5: the rules of the host program (the meeting point of server, "Step 5: the rules of the host program"): when they are in
// use, when their files are read again, the step they add to a call, the record of a covered call, what does not
// change. The host program is the raw one of askhost.js, named `claude-code`, with a home and folders the test made;
// the real adapter of part `hosts` reads the files the test writes. The texts are those of part `core`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fakeEntry, sleep, tmpDir, waitFor } from "./helpers.js";
import { CANNOT_ASK, NO_ANSWER, QUESTION_FAILED, SAID_NO, question, refusal } from "./shellhelpers.js";
import { logEntries, logText, trailLine } from "./recordhelpers.js";
import {
  NO_FOLDERS,
  ROOTS,
  UNKNOWN_HOST_LINE,
  countLine,
  hostDenial,
  hostQuestion,
  hostRefusal,
  messageOf,
  put,
  shellOnly,
  snapshot,
  unreadableLine,
  waitInBarrier,
  withClaude,
  withProgram,
  world,
} from "./stepfive.js";

const FAILED = (message) => `The program failed: Error: ${message}`;
const firstLine = (answer) => answer.text.split("\n")[0];
const ACCEPT = () => ({ action: "accept" });
const SCHEMA = { type: "object", properties: {} };
const HOST = (extra = {}) => ({ hostRules: true, ...extra });
const ON = (onetool = {}, servers = {}, shell = {}) => shellOnly({ shell, onetool: HOST(onetool), servers });

describe("when a host's rules are in use", () => {
  const CASES = [
    ["the shell with folders in the file", () => shellOnly({ shell: { folders: [tmpDir()] } }), true],
    ["the shell with no folders in the file", () => shellOnly({}), true],
    ["a server marked as the host itself, and no shell", () => shellOnly({ shell: null, onetool: { hostServers: ["fake"] }, servers: { fake: fakeEntry() } }), true],
    ["nothing the rules could apply to: no shell, no server marked", () => shellOnly({ shell: null, servers: { fake: fakeEntry() } }), false],
    ["a name of hostServers that no server has, and no shell", () => shellOnly({ shell: null, onetool: { hostServers: ["nobody"] } }), true],
    ["the shell, with \"hostRules\": false", () => shellOnly({ onetool: { hostRules: false } }), false],
    ["a server marked as the host itself, with \"hostRules\": false", () => shellOnly({ shell: null, onetool: { hostServers: ["fake"], hostRules: false }, servers: { fake: fakeEntry() } }), false],
  ];
  for (const [what, settings, wanted] of CASES) {
    test(`a host that is not known, ${what}: ${wanted ? "the one line, once" : "no line"}`, async () => {
      const w = world();
      const name = "my-secret-host-name";
      await withProgram(settings(), { home: w.H, name, capabilities: ROOTS, roots: [w.A] }, async (host) => {
        for (let again = 0; again < 3; again++) assert.equal((await host.run("1")).text, "1");
        await sleep(300);
        assert.equal(countLine(host.stderr(), UNKNOWN_HOST_LINE), wanted ? 1 : 0);
        assert.ok(!host.stderr().includes(name), "the line does not hold the host's name");
        assert.ok(!host.stderr().split("\n").some((line) => line.startsWith("onetool: host rules:") && line !== UNKNOWN_HOST_LINE));
      });
    });
  }

  test("a host that is not known: the roots are not needed for its rules, with folders in the file nothing is sent", async () => {
    const w = world();
    await withProgram(shellOnly({ shell: { folders: [w.B] } }), { home: w.H, name: "some-host", capabilities: ROOTS, roots: [w.A] }, async (host) => {
      assert.equal((await host.run("await read(\"two.txt\")")).text, "beta\n");
      await sleep(300);
      assert.equal(host.rootsRequests.length, 0);
    });
  });

  test("a host that is known: its rules are in use and the roots are read, though the file gives folders", async () => {
    const w = world();
    put(join(w.B, "one.txt"), "from B\n");
    await withClaude(shellOnly({ shell: { folders: [w.B] }, onetool: HOST() }), w, {}, async (host) => {
      assert.equal(host.initializeResult.capabilities.tools?.listChanged, undefined);
      const removed = await host.run("await $`rm one.txt`");
      assert.deepEqual([removed.isError, firstLine(removed)], [true, FAILED(hostDenial("shell.run", "Bash(rm *)", w.fileA))]);
      assert.equal(existsSync(join(w.B, "one.txt")), true, "the command would have run in the folder of the file, not in the host's");
      assert.ok(host.rootsRequests.length >= 1, "the roots were read for the anchors of the rules");
      assert.equal(countLine(host.stderr(), UNKNOWN_HOST_LINE), 0);
    });
  });

  test("the file of the person is read from the home of the process, with no root declared", async () => {
    const w = world();
    await withClaude(shellOnly({ shell: { folders: [w.B] }, onetool: HOST() }), w, { capabilities: { elicitation: {} }, roots: undefined }, async (host) => {
      const curl = await host.run("await $`curl --version`");
      assert.deepEqual([curl.isError, firstLine(curl)], [true, FAILED(hostDenial("shell.run", "Bash(curl *)", w.userFile))]);
      assert.equal(host.rootsRequests.length, 0, "no roots declared: nothing is asked");
      assert.equal((await host.run("await $`echo ok`.text()")).text, "ok\n");
    });
  });
});

describe("reading the files again", () => {
  test("a file that appears, changes or goes away between two programs is followed by the second one", async () => {
    const w = world({ rules: { deny: [] } });
    const echo = (host) => host.run("await $`echo ok`.text()");
    await withClaude(ON(), w, {}, async (host) => {
      assert.deepEqual(await echo(host), { text: "ok\n", isError: false });
      put(w.localA, { permissions: { deny: ["Bash(echo *)"] } });
      let answer = await echo(host);
      assert.deepEqual([answer.isError, firstLine(answer)], [true, FAILED(hostDenial("shell.run", "Bash(echo *)", w.localA))]);
      put(w.userFile, { permissions: { deny: ["Bash(echo *)"] } });
      answer = await echo(host);
      assert.equal(firstLine(answer), FAILED(hostDenial("shell.run", "Bash(echo *)", w.userFile)), "the file of the person comes first");
      rmSync(w.userFile);
      rmSync(w.localA);
      assert.deepEqual(await echo(host), { text: "ok\n", isError: false });
      put(w.fileA, { permissions: { deny: ["Bash(echo *)"] } });
      assert.equal(firstLine(await echo(host)), FAILED(hostDenial("shell.run", "Bash(echo *)", w.fileA)));
      put(w.fileA, { permissions: { deny: [] } });
      assert.deepEqual(await echo(host), { text: "ok\n", isError: false });
    });
  });

  test("the files follow the folders of the host: a change of roots changes the files read", async () => {
    const w = world({ rules: { deny: [] } });
    put(w.fileB, { permissions: { deny: ["Bash(echo *)"] } });
    const echo = (host) => host.run("await $`echo ok`.text()");
    await withClaude(ON(), w, {}, async (host) => {
      assert.deepEqual(await echo(host), { text: "ok\n", isError: false });
      host.setRoots([w.B, w.A]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      const denied = await echo(host);
      assert.equal(firstLine(denied), FAILED(hostDenial("shell.run", "Bash(echo *)", w.fileB)));
      host.setRoots([w.A]);
      await waitFor(() => host.rootsRequests.length === 3, 3000, "the third reading");
      assert.deepEqual(await echo(host), { text: "ok\n", isError: false });
    });
  });

  test("a file that cannot be read is told once on standard error, its rules are not applied, those of the others are", async () => {
    const w = world({ rules: { deny: [] } });
    rmSync(w.fileA);
    mkdirSync(w.fileA); // a folder where the file should be: it is there and cannot be read
    put(w.localA, "not json");
    put(w.fileB, { permissions: { deny: ["Bash(echo *)"] } });
    await withClaude(ON(), w, { roots: [w.A, w.B] }, async (host) => {
      for (let again = 0; again < 3; again++) {
        const answer = await host.run("await $`echo ok`.text()");
        assert.equal(firstLine(answer), FAILED(hostDenial("shell.run", "Bash(echo *)", w.fileB)), "the rules of the other files apply");
      }
      await sleep(300);
      for (const file of [w.fileA, w.localA]) {
        assert.equal(countLine(host.stderr(), unreadableLine(file)), 1, `once for ${file}`);
      }
      put(w.localA, { permissions: { deny: [] } });
      await host.run("1");
      put(w.localA, "not json again");
      await host.run("1");
      await sleep(200);
      assert.equal(countLine(host.stderr(), unreadableLine(w.localA)), 1, "told once for the life of the process");
      const said = host.stderr().split("\n").filter((line) => line.startsWith("onetool: host rules:"));
      assert.equal(said.length, 2);
    });
  });

  test('"hostRules": false: no file of the host is read, whatever the host is', async () => {
    const w = world();
    mkdirSync(join(w.B, ".claude", "settings.json"), { recursive: true });
    for (const name of ["claude-code", "some-host"]) {
      await withProgram(shellOnly({ onetool: { hostRules: false } }), { home: w.H, name, capabilities: ROOTS, roots: [w.A, w.B] }, async (host) => {
        assert.deepEqual(await host.run('await read("secret.txt")'), { text: "hidden\n", isError: false });
        assert.deepEqual(await host.run("await $`rm one.txt`.nothrow().text()"), { text: "", isError: false });
        await sleep(300);
        assert.ok(!host.stderr().split("\n").some((line) => line.startsWith("onetool: host rules:")), host.stderr());
      });
      put(join(w.A, "one.txt"), "alpha\n");
    }
  });
});

describe("the step added to a shell.run", () => {
  const RULES = { deny: ["Bash(rm *)"], ask: ["Bash(touch *)"], allow: ["Bash(*)"] };
  const TOUCH = '{"command":"touch made.txt"}';

  test("a deny of the host: the call is refused with the file and the rule, nothing is run or asked", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON(), w, { answer: ACCEPT }, async (host) => {
      for (const code of ["await $`rm one.txt`", "await $`echo a; rm one.txt`", 'await tools.shell.run({ command: "ls && rm one.txt" })']) {
        const answer = await host.run(code);
        assert.deepEqual([answer.isError, firstLine(answer)], [true, FAILED(hostDenial("shell.run", "Bash(rm *)", w.fileA))], code);
      }
      assert.equal(existsSync(join(w.A, "one.txt")), true);
      assert.equal(host.questions.length, 0);
      assert.deepEqual(await host.run("await $`echo fine`.text()"), { text: "fine\n", isError: false });
    });
  });

  test("an ask of the host: one question that names the file and the rule, and the yes lets the command run", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON(), w, { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run("await $`touch made.txt`; 1"), { text: "1", isError: false });
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, hostQuestion("shell.run", "Bash(touch *)", TOUCH, w.fileA));
      assert.deepEqual(host.questions[0].params.requestedSchema, SCHEMA);
      assert.equal(existsSync(join(w.A, "made.txt")), true);
      assert.deepEqual(await host.run("await $`touch made.txt`; 2"), { text: "2", isError: false });
      assert.equal(host.questions.length, 2, "each call is asked anew");
    });
  });

  for (const [what, answer, cause] of [
    ["decline", () => ({ action: "decline" }), SAID_NO],
    ["cancel", () => ({ action: "cancel" }), NO_ANSWER],
    ["an error", () => ({ error: { code: -32603, message: "SECRET-HOST-MESSAGE" } }), QUESTION_FAILED],
  ]) {
    test(`the person's answer is ${what}: the refusal names the file and the rule, nothing is run`, async () => {
      const w = world({ rules: RULES });
      await withClaude(ON(), w, { answer }, async (host) => {
        const got = await host.run(messageOf("$`touch made.txt`"));
        assert.deepEqual(got, { text: hostRefusal("shell.run", "Bash(touch *)", cause, w.fileA), isError: false });
        assert.equal(existsSync(join(w.A, "made.txt")), false);
        assert.ok(!host.stderr().includes("SECRET-HOST-MESSAGE"));
      });
    });
  }

  test("a host that cannot ask: the refusal `cannot ask`, nothing is sent, nothing is run", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON(), w, { capabilities: ROOTS }, async (host) => {
      const got = await host.run(messageOf("$`touch made.txt`"));
      assert.deepEqual(got, { text: hostRefusal("shell.run", "Bash(touch *)", CANNOT_ASK, w.fileA), isError: false });
      assert.equal(host.questions.length, 0);
      assert.equal(existsSync(join(w.A, "made.txt")), false);
    });
  });

  test("onetool's own ask on the same call: one question, onetool's own texts, with no file", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON({}, {}, { ask: ["touch *"] }), w, { answer: ACCEPT }, async (host) => {
      await host.run("await $`touch made.txt`");
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, question("shell.run", "touch *", TOUCH));
    });
    await withClaude(ON({}, {}, { ask: ["touch *"] }), w, { answer: () => ({ action: "decline" }) }, async (host) => {
      const got = await host.run(messageOf("$`touch made.txt`"));
      assert.deepEqual(got, { text: refusal("shell.run", "touch *", SAID_NO), isError: false });
      assert.equal(host.questions.length, 1);
    });
  });

  test("a deny of the host speaks before onetool's own ask, and onetool's own deny before an ask of the host", async () => {
    const w = world({ rules: { deny: ["Bash(rm *)"], ask: ["Bash(touch *)"] } });
    await withClaude(ON({}, {}, { ask: ["rm *"], deny: ["touch *"] }), w, { answer: ACCEPT }, async (host) => {
      const removed = await host.run("await $`rm one.txt`");
      assert.equal(firstLine(removed), FAILED(hostDenial("shell.run", "Bash(rm *)", w.fileA)));
      const touched = await host.run("await $`touch made.txt`");
      assert.equal(firstLine(touched), FAILED('onetool: shell.run is denied by the rule deny "touch *" of onetool.shell'));
      assert.equal(host.questions.length, 0);
    });
    await withClaude(ON({ deny: ["shell.run"] }), w, { answer: ACCEPT }, async (host) => {
      const touched = await host.run("await $`touch made.txt`");
      assert.equal(firstLine(touched), FAILED('onetool: shell.run is denied by the rule deny "shell.run"'));
      assert.equal(host.questions.length, 0);
    });
  });

  test("the host's allow undoes nothing of onetool's: every refusal onetool would make is still made", async () => {
    const w = world({ rules: { allow: ["Bash(*)", "Read(*)", "Edit(*)"] } });
    await withClaude(ON({ deny: ["shell.write"] }, {}, { deny: ["ls *"] }), w, {}, async (host) => {
      assert.equal(firstLine(await host.run("await $`ls -a`")), FAILED('onetool: shell.run is denied by the rule deny "ls *" of onetool.shell'));
      assert.equal(firstLine(await host.run('await write("w.txt", "x")')), FAILED('onetool: shell.write is denied by the rule deny "shell.write"'));
      assert.equal(existsSync(join(w.A, "w.txt")), false);
    });
  });

  test("two questions of the host's rules at once: the second is sent only after the first was answered", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON(), w, { answer: (request, host) => (host.questions.length === 1 ? undefined : { action: "accept" }) }, async (host) => {
      const running = host.run("await Promise.all([$`touch a.txt`, $`touch b.txt`]); 1");
      await host.waitQuestions(1);
      await sleep(400);
      assert.equal(host.questions.length, 1, "no second question while the first is open");
      host.questions[0].reply({ action: "accept" });
      await host.waitQuestions(2);
      assert.deepEqual(await running, { text: "1", isError: false });
      assert.equal(existsSync(join(w.A, "a.txt")) && existsSync(join(w.A, "b.txt")), true);
    });
  });

  test("the person's time is the program's time: a question that is never answered ends with the stop of the program", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON({ timeoutSeconds: 2 }), w, { answer: () => undefined }, async (host) => {
      const answer = await host.run("await $`touch made.txt`");
      assert.deepEqual(answer, { text: "The program was stopped after 2 seconds.", isError: true });
      assert.equal(existsSync(join(w.A, "made.txt")), false, "the command is not run");
      await waitFor(() => host.events.some((event) => event.kind === "cancelled"), 3000, "the question given up");
    });
  });

  for (const [how, end] of [
    ["standard input closed", async (host) => (host.child.stdin.end(), host.within(5000))],
    ["SIGTERM", (host) => host.endBy("SIGTERM")],
  ]) {
    test(`the end with a question of a host's rule open (${how}): exit code 0 within 5 seconds`, async () => {
      const w = world({ rules: RULES });
      await withClaude(ON(), w, { answer: () => undefined }, async (host) => {
        const running = host.run("await $`touch made.txt`").catch(() => "ended");
        void running;
        await host.waitQuestions(1);
        const started = Date.now();
        const ended = await end(host);
        assert.equal(ended.code, 0);
        assert.ok(Date.now() - started < 5000);
      });
    });
  }
});

describe("the step added to a read, a write and an edit", () => {
  const RULES = {
    deny: ["Read(./r.txt)", "Write(./w.txt)", "Edit(./e.txt)", "Read(./nothing.txt)", "Read(./secret.txt)"],
    ask: ["Edit(./notes.txt)"],
    allow: ["Read(./secret.txt)"],
  };
  const prepare = (w) => {
    for (const name of ["r.txt", "w.txt", "e.txt"]) put(join(w.A, name), "t\n");
    mkdirSync(join(w.A, "sub"), { recursive: true });
    symlinkSync(join(w.A, "r.txt"), join(w.A, "link"));
  };
  const call = (action, path) =>
    action === "read" ? `read(${JSON.stringify(path)})` : action === "write" ? `write(${JSON.stringify(path)}, "x")` : `edit(${JSON.stringify(path)}, "t", "u")`;

  test("each action is asked of the rules that speak of it: Read of read, Write of write, Edit of edit and of write", async () => {
    const w = world({ rules: RULES });
    prepare(w);
    const D = (action, rule) => hostDenial(`shell.${action}`, rule, w.fileA);
    const table = [
      ["read", "r.txt", D("read", "Read(./r.txt)")],
      ["read", "w.txt", "answered"],
      ["read", "e.txt", "answered"],
      ["write", "w.txt", D("write", "Write(./w.txt)")],
      ["write", "e.txt", D("write", "Edit(./e.txt)")],
      ["edit", "e.txt", D("edit", "Edit(./e.txt)")],
      ["edit", "w.txt", "answered"],
      ["edit", "r.txt", "answered"],
      ["write", "r.txt", "answered"],
    ];
    await withClaude(ON(), w, { answer: ACCEPT }, async (host) => {
      for (const [action, path, expected] of table) {
        assert.deepEqual(await host.run(messageOf(call(action, path))), { text: expected, isError: false }, `${action} ${path}`);
      }
      assert.equal(readFileSync(join(w.A, "r.txt"), "utf8"), "x");
      assert.equal(readFileSync(join(w.A, "e.txt"), "utf8"), "t\n", "the refused write and edit changed nothing");
      assert.equal(host.questions.length, 0);
    });
  });

  test("every spelling of the file is looked at: a path with .., a full path, a link, a file that is not there", async () => {
    const w = world({ rules: RULES });
    prepare(w);
    const denied = hostDenial("shell.read", "Read(./r.txt)", w.fileA);
    await withClaude(ON(), w, {}, async (host) => {
      for (const path of ["sub/../r.txt", join(w.A, "r.txt"), "link", "./r.txt"]) {
        assert.deepEqual(await host.run(messageOf(`read(${JSON.stringify(path)})`)), { text: denied, isError: false }, path);
      }
      assert.deepEqual(
        await host.run(messageOf('read("nothing.txt")')),
        { text: hostDenial("shell.read", "Read(./nothing.txt)", w.fileA), isError: false },
        "a file that is not there: the first path alone is looked at",
      );
      const secret = await host.run('await read("secret.txt")');
      assert.equal(firstLine(secret), FAILED(hostDenial("shell.read", "Read(./secret.txt)", w.fileA)));
      assert.ok(!secret.text.includes("hidden"), "the allow of the same file undoes nothing");
    });
  });

  test("a relative path is taken from the first folder in effect, which is not always the host's", async () => {
    const w = world({ rules: RULES });
    prepare(w);
    put(join(w.B, "r.txt"), "from B\n");
    await withClaude(shellOnly({ shell: { folders: [w.B, w.A] }, onetool: HOST() }), w, {}, async (host) => {
      assert.deepEqual(await host.run('await read("r.txt")'), { text: "from B\n", isError: false });
      const full = await host.run(`await read(${JSON.stringify(join(w.A, "r.txt"))})`);
      assert.equal(firstLine(full), FAILED(hostDenial("shell.read", "Read(./r.txt)", w.fileA)));
    });
  });

  test("an ask of the host on an edit and on a write: the question has the arguments the program gave", async () => {
    const w = world({ rules: RULES });
    await withClaude(ON(), w, { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run('await edit("notes.txt", "draft", "final"); 1'), { text: "1", isError: false });
      assert.deepEqual(await host.run('await write("notes.txt", "x"); 2'), { text: "2", isError: false });
      assert.deepEqual(
        host.questions.map((one) => one.message),
        [
          hostQuestion("shell.edit", "Edit(./notes.txt)", '{"path":"notes.txt","old":"draft","new":"final"}', w.fileA),
          hostQuestion("shell.write", "Edit(./notes.txt)", '{"path":"notes.txt","text":"x"}', w.fileA),
        ],
      );
      assert.equal(readFileSync(join(w.A, "notes.txt"), "utf8"), "x");
    });
    await withClaude(ON(), w, { answer: () => ({ action: "decline" }) }, async (host) => {
      assert.deepEqual(await host.run(messageOf('edit("notes.txt", "x", "y")')), {
        text: hostRefusal("shell.edit", "Edit(./notes.txt)", SAID_NO, w.fileA),
        isError: false,
      });
      assert.equal(readFileSync(join(w.A, "notes.txt"), "utf8"), "x");
    });
  });

  test("a call the table gives no call for is not covered: a path that is not a text or is empty", async () => {
    const w = world({ rules: { deny: ["Read", "Edit", "Write"] } });
    await withClaude(ON(), w, { answer: ACCEPT }, async (host) => {
      for (const code of ['tools.shell.read({ path: "" })', "tools.shell.read({ path: 5 })", "tools.shell.read({})", 'tools.shell.write({ path: "", text: "x" })', 'tools.shell.edit({ path: 5, old: "a", new: "b" })']) {
        const answer = await host.run(messageOf(code));
        assert.equal(answer.isError, false, code);
        assert.ok(!answer.text.includes("of the host program"), `${code}: ${answer.text}`);
      }
      assert.equal(host.questions.length, 0);
      const covered = await host.run(messageOf('read("one.txt")'));
      assert.equal(covered.text, hostDenial("shell.read", "Read", w.fileA), "a rule on every path covers a path that is a text");
    });
  });

  test("a spelling of the folder through a symbolic link is the host's own: the file is named as the host gave it", async () => {
    const w = world();
    const link = join(tmpDir(), "lnk");
    symlinkSync(w.A, link);
    await withClaude(ON(), w, { roots: [link] }, async (host) => {
      const spelled = join(link, ".claude", "settings.json");
      assert.equal(firstLine(await host.run("await $`rm one.txt`")), FAILED(hostDenial("shell.run", "Bash(rm *)", spelled)));
      assert.equal(firstLine(await host.run('await read("secret.txt")')), FAILED(hostDenial("shell.read", "Read(./secret.txt)", spelled)));
      assert.equal(firstLine(await host.run(`await read(${JSON.stringify(join(w.A, "secret.txt"))})`)), FAILED(hostDenial("shell.read", "Read(./secret.txt)", spelled)));
    });
  });

  test("a program that lost its folders is refused for that, not by the rules, and nothing is asked", async () => {
    const w = world({ rules: { deny: ["Read"] } });
    const servers = { fake: fakeEntry({ tools: ["barrier", "calls"] }) };
    await withClaude(ON({}, servers), w, { answer: ACCEPT }, async (host) => {
      assert.equal(await host.search(), "fake: 2 tools\nshell: 4 tools");
      const first = host.run(`await tools.fake.barrier({}); ${messageOf('read("one.txt")')}`);
      await waitInBarrier(host);
      host.setRoots([]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      await host.search();
      await host.run("await tools.fake.barrier({}); 1");
      assert.deepEqual(await first, { text: `shell.read failed: ${NO_FOLDERS}`, isError: false });
    });
  });
});

describe("a server that is the host itself", () => {
  const TOOLS = ["Bash", "Read", "Edit", "Write", "Grep"];
  const FAKE = () => fakeEntry({ tools: TOOLS });
  const SERVERS = () => ({ claude: FAKE(), other: FAKE(), Claude: FAKE() });
  const LISTED = (onetool = {}) => shellOnly({ shell: null, onetool: { hostServers: ["claude"], ...onetool }, servers: SERVERS() });
  const RULES = { deny: ["Bash(rm *)", "Read(./secret.txt)"], ask: ["Edit(./notes.txt)"], allow: ["Bash(*)"] };

  test("its Bash, Read and Edit are under the host's rules; any other call is not covered", async () => {
    const w = world({ rules: RULES });
    const at = (name) => JSON.stringify(join(w.A, name));
    const table = [
      ['tools.claude.Bash({ command: "echo hi" })', "answered"],
      ['tools.claude.Bash({ command: "rm x" })', hostDenial("claude.Bash", "Bash(rm *)", w.fileA)],
      ['tools.claude.Bash({ command: "echo a; rm x" })', hostDenial("claude.Bash", "Bash(rm *)", w.fileA)],
      ["tools.claude.Bash({ command: 5 })", "answered"],
      ["tools.claude.Bash({})", "answered"],
      ['tools.claude.Bash("rm x")', "onetool: the arguments of claude.Bash must be an object"],
      [`tools.claude.Read({ file_path: ${at("secret.txt")} })`, hostDenial("claude.Read", "Read(./secret.txt)", w.fileA)],
      [`tools.claude.Read({ file_path: ${at("one.txt")} })`, "answered"],
      ['tools.claude.Read({ file_path: "" })', "answered"],
      ["tools.claude.Read({})", "answered"],
      ['tools.claude.Grep({ pattern: "x" })', "answered"],
      ['tools.other.Bash({ command: "rm x" })', "answered"],
      ['tools.Claude.Bash({ command: "rm x" })', "answered"],
    ];
    await withClaude(LISTED(), w, { cwd: w.B }, async (host) => {
      for (const [code, expected] of table) {
        assert.deepEqual(await host.run(messageOf(code)), { text: expected, isError: false }, code);
      }
      // a listed server is started in onetool's working folder: a relative file is taken from there
      assert.deepEqual(await host.run(messageOf('tools.claude.Read({ file_path: "secret.txt" })')), { text: "answered", isError: false });
    });
    await withClaude(LISTED(), w, { cwd: w.A }, async (host) => {
      assert.deepEqual(await host.run(messageOf('tools.claude.Read({ file_path: "secret.txt" })')), {
        text: hostDenial("claude.Read", "Read(./secret.txt)", w.fileA),
        isError: false,
      });
    });
  });

  test("an ask of the host on its Edit: the question names the file and the rule; onetool's own ask is the one question when both cover", async () => {
    const w = world({ rules: RULES });
    const args = { file_path: join(w.A, "notes.txt") };
    const code = `tools.claude.Edit(${JSON.stringify(args)})`;
    await withClaude(LISTED(), w, { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run(messageOf(code)), { text: "answered", isError: false });
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, hostQuestion("claude.Edit", "Edit(./notes.txt)", JSON.stringify(args), w.fileA));
    });
    await withClaude(LISTED(), w, { answer: () => ({ action: "cancel" }) }, async (host) => {
      assert.deepEqual(await host.run(messageOf(code)), { text: hostRefusal("claude.Edit", "Edit(./notes.txt)", NO_ANSWER, w.fileA), isError: false });
    });
    await withClaude(LISTED(), w, { capabilities: ROOTS }, async (host) => {
      assert.deepEqual(await host.run(messageOf(code)), { text: hostRefusal("claude.Edit", "Edit(./notes.txt)", CANNOT_ASK, w.fileA), isError: false });
    });
    await withClaude(LISTED({ ask: ["claude.Edit"] }), w, { answer: ACCEPT }, async (host) => {
      await host.run(messageOf(code));
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, question("claude.Edit", "claude.Edit", JSON.stringify(args)));
    });
  });

  test("onetool's own rules speak first: a deny of onetool is its own message, a deny of the host comes before onetool's question", async () => {
    const w = world({ rules: RULES });
    await withClaude(LISTED({ deny: ["claude.Bash"] }), w, { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run(messageOf('tools.claude.Bash({ command: "rm x" })')), {
        text: 'onetool: claude.Bash is denied by the rule deny "claude.Bash"',
        isError: false,
      });
    });
    await withClaude(LISTED({ ask: ["claude.Bash"] }), w, { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run(messageOf('tools.claude.Bash({ command: "rm x" })')), {
        text: hostDenial("claude.Bash", "Bash(rm *)", w.fileA),
        isError: false,
      });
      assert.equal(host.questions.length, 0);
    });
  });
});

describe("the record of a covered call", () => {
  const RULES = { deny: ["Bash(rm *)", "Read(./secret.txt)"], ask: ["Bash(touch *)"], allow: ["Bash(*)"] };

  test("the trail and the log: refused by a host's deny, and the five ways a host's question ends", async () => {
    const w = world({ rules: RULES });
    const settings = ON({ trail: true, logFolder: w.L, log: true });
    let reply = "accept";
    await withClaude(settings, w, { answer: () => (reply === "error" ? { error: { code: -32603, message: "no" } } : { action: reply }) }, async (host) => {
      const removed = await host.run("await $`rm one.txt`");
      assert.equal(removed.isError, true);
      const lines = removed.text.split("\n");
      assert.match(lines.at(-1), trailLine("shell.run", "refused"));
      for (const [word, command] of [["accept", "touch a.txt"], ["decline", "touch b.txt"], ["cancel", "touch c.txt"], ["error", "touch d.txt"]]) {
        reply = word;
        const answer = await host.run(`await $\`${command}\``);
        assert.equal(answer.isError, word !== "accept", word);
        assert.match(answer.text.split("\n").at(-1), trailLine("shell.run", word === "accept" ? "\\d+ chars" : "refused"));
      }
    });
    await withClaude(settings, w, { capabilities: ROOTS }, async (host) => {
      assert.equal((await host.run("await $`touch e.txt`")).isError, true);
    });
    const byCommand = (command) => logEntries(w.L).find((entry) => entry.args?.command === command);
    const expected = {
      "rm one.txt": ["denied", "refused by the rules"],
      "touch a.txt": ["asked: yes", null],
      "touch b.txt": ["asked: no", "refused by the rules"],
      "touch c.txt": ["asked: no answer", "refused by the rules"],
      "touch d.txt": ["asked: failed", "refused by the rules"],
      "touch e.txt": ["asked: cannot ask", "refused by the rules"],
    };
    for (const [command, [decision, fault]] of Object.entries(expected)) {
      const entry = byCommand(command);
      assert.ok(entry, `a line for ${command}`);
      assert.deepEqual([entry.id, entry.decision, entry.fault], ["shell.run", decision, fault], command);
    }
    assert.equal(byCommand("rm one.txt").size, null);
    const text = logText(w.L);
    for (const secret of ["Bash(", "settings.json", w.A, w.H, "hidden"]) assert.ok(!text.includes(secret), `the log does not hold ${secret}`);
  });

  test("a read refused by the host's rule is recorded as denied; a server that is the host itself too", async () => {
    const w = world({ rules: RULES });
    const settings = shellOnly({
      onetool: HOST({ trail: true, logFolder: w.L, log: true, hostServers: ["claude"] }),
      servers: { claude: fakeEntry({ tools: ["Bash"] }) },
    });
    await withClaude(settings, w, {}, async (host) => {
      const read = await host.run('await read("secret.txt")');
      assert.match(read.text.split("\n").at(-1), trailLine("shell.read", "refused"));
      const bash = await host.run('await tools.claude.Bash({ command: "rm x" })');
      assert.match(bash.text.split("\n").at(-1), trailLine("claude.Bash", "refused"));
      const fine = await host.run('await tools.claude.Bash({ command: "echo hi" })');
      assert.equal(fine.isError, false);
    });
    const entries = logEntries(w.L);
    const read = entries.find((entry) => entry.id === "shell.read");
    assert.deepEqual([read.decision, read.fault, read.size], ["denied", "refused by the rules", null]);
    const refused = entries.find((entry) => entry.id === "claude.Bash" && entry.args.command === "rm x");
    assert.deepEqual([refused.decision, refused.fault], ["denied", "refused by the rules"]);
    const ok = entries.find((entry) => entry.id === "claude.Bash" && entry.args.command === "echo hi");
    assert.deepEqual([ok.decision, ok.fault], ["allowed", null]);
  });
});

describe("what does not change", () => {
  test("a host's rule hides no tool: search says shell: 4 tools when the host denies every command, and every tool of a server that is the host", async () => {
    const w = world({ rules: { deny: ["Bash(*)", "Read", "Edit", "Write"] } });
    const settings = shellOnly({ onetool: HOST({ hostServers: ["claude"] }), servers: { claude: fakeEntry({ tools: ["Bash", "Read"] }) } });
    await withClaude(settings, w, {}, async (host) => {
      assert.equal(await host.search(), "claude: 2 tools\nshell: 4 tools");
      assert.ok((await host.description()).includes("$`command`"));
      assert.equal(firstLine(await host.run("await $`echo hi`")), FAILED(hostDenial("shell.run", "Bash(*)", w.fileA)));
    });
  });

  test("no request is sent to the host for its rules, and no file of the host is written", async () => {
    const w = world({ rules: { deny: ["Bash(rm *)"], ask: ["Bash(touch *)"] } });
    put(w.localA, { permissions: { allow: ["Bash(*)"] } });
    const before = { ...snapshot(join(w.A, ".claude")), ...snapshot(join(w.H, ".claude")) };
    await withClaude(ON(), w, { answer: ACCEPT }, async (host) => {
      await host.run("await $`rm one.txt`").catch(() => {});
      await host.run("await $`touch made.txt`");
      await host.run('await read("one.txt")');
      assert.deepEqual(host.others, [], "no request but roots/list and the questions");
      assert.ok(host.rootsRequests.length >= 1);
      assert.equal(host.questions.length, 1);
    });
    assert.deepEqual({ ...snapshot(join(w.A, ".claude")), ...snapshot(join(w.H, ".claude")) }, before);
  });

  test("a program that makes no covered call is untouched by the rules: a tool of a server that is not the host", async () => {
    const w = world({ rules: { deny: ["Bash(*)", "Read"] } });
    const settings = shellOnly({ shell: null, onetool: HOST({ hostServers: ["claude"] }), servers: { claude: fakeEntry({ tools: ["Bash"] }), fake: fakeEntry({ tools: ["Bash", "plain"] }) } });
    await withClaude(settings, w, {}, async (host) => {
      assert.deepEqual(await host.run('await tools.fake.Bash({ command: "rm x" })'), { text: "called Bash", isError: false });
      assert.deepEqual(await host.run("await tools.fake.plain({})"), { text: "hello world", isError: false });
    });
  });
});
