// Step 5: the folders of the host program (the meeting point of server, "Step 5: the folders of the host program"): the roots of the
// host are the folders of the shell when the settings file gives none; how they are read, waited for, followed, and what
// follows from them. The host program is the raw one of askhost.js, which answers `roots/list` as the test says.
// No host's rules here (`"hostRules": false`) unless said: they are the tests of hostrules.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeEntry, sleep, waitFor, withoutSession } from "./helpers.js";
import { NO_FOLDERS, NO_FOLDERS_ANSWER, NO_FOLDERS_LINE, ROOTS, put, settledWithin, shellOnly, waitInBarrier, withProgram, world } from "./stepfive.js";

const answerRoots = (folders) => ({ roots: folders.map((folder) => ({ uri: pathToFileURL(folder).href })) });
const SHELL_NAMES = ["$`", "read(", "write(", "edit("];
const shellOff = (description) => !SHELL_NAMES.some((name) => description.includes(name));
const shellOn = (description) => description.includes("$`command`") && description.includes("read(path)");
const SETTINGS = (onetool = {}, servers = {}) => shellOnly({ onetool: { hostRules: false, ...onetool }, servers });
const PWD = "await $`pwd`.text()";

/** A program held back from the roots: the question for them is kept in `host.rootsRequests`, answered when the test says. */
const HOLD = () => undefined;

describe("the folders in effect", () => {
  test("a host that declared roots: its first root is the first folder, and the shell has folders", async () => {
    const w = world();
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A] }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      assert.ok(shellOn(await host.description()), "the description of run names the shell");
      assert.deepEqual(await host.run(PWD), { text: `${w.A}\n`, isError: false });
      assert.deepEqual(await host.run('await read("one.txt")'), { text: "alpha\n", isError: false });
      assert.equal(host.rootsRequests.length, 1, "one reading, however many calls");
      assert.equal(host.stderr(), "", "nothing about a reading on standard error");
    });
  });

  test("the roots are the folders in the host's order, the first root first, and the others are listed too", async () => {
    const w = world();
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.B, w.A] }, async (host) => {
      assert.deepEqual(await host.run(PWD), { text: `${w.B}\n`, isError: false });
      assert.deepEqual(await host.run('await read("two.txt")'), { text: "beta\n", isError: false });
      assert.deepEqual(await host.run(`await read(${JSON.stringify(join(w.A, "one.txt"))})`), { text: "alpha\n", isError: false });
      await host.run('await write("made.txt", "x")');
      assert.equal(existsSync(join(w.B, "made.txt")), true, "a relative path is taken from the first folder");
      assert.equal(existsSync(join(w.A, "made.txt")), false);
    });
  });

  test("a root that is not a folder that exists is left out in silence: files, folders gone, other hosts, twice the same", async () => {
    const w = world();
    const gone = join(w.B, "gone");
    // the package refuses a list that holds an address that is not `file://`, so every root here is one
    const uris = [
      pathToFileURL(gone).href,
      pathToFileURL(join(w.A, "one.txt")).href,
      "file://other-host/x",
      pathToFileURL(w.A).href,
      `${pathToFileURL(w.A).href}/`,
      pathToFileURL(w.B).href,
    ];
    const rootsAnswer = () => ({ roots: uris.map((uri) => ({ uri })) });
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [], rootsAnswer }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      assert.deepEqual(await host.run(PWD), { text: `${w.A}\n`, isError: false }, "the first root that is a folder");
      assert.deepEqual(await host.run(`await read(${JSON.stringify(join(w.B, "two.txt"))})`), { text: "beta\n", isError: false });
      assert.equal(host.child.exitCode, null, "no exit code 2: the start looks at no folder of the host");
      assert.equal(host.stderr(), "", "nothing is said of a root left out");
    });
  });

  test("the file gives folders: they win, whatever the host says, and no reading is made", async () => {
    const w = world();
    put(join(w.B, "one.txt"), "from B\n");
    const settings = shellOnly({ shell: { folders: [w.B] }, onetool: { hostRules: false } });
    await withProgram(settings, { home: w.H, capabilities: ROOTS, roots: [w.A] }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      assert.ok(shellOn(await host.description()));
      assert.deepEqual(await host.run(PWD), { text: `${w.B}\n`, isError: false });
      assert.deepEqual(await host.run('await read("one.txt")'), { text: "from B\n", isError: false });
      host.setRoots([w.B, w.A]);
      await sleep(300);
      assert.equal(host.rootsRequests.length, 0, "the roots are not needed: nothing is sent");
      assert.deepEqual(await host.run(PWD), { text: `${w.B}\n`, isError: false });
    });
  });
});

describe("a host that gives no folder", () => {
  /** What the shell is for a program, in every place the text of "What follows the folders" says. */
  async function assertNoFolders(host) {
    assert.equal(await host.search(), NO_FOLDERS_LINE);
    assert.ok(shellOff(await host.description()), "the description of run is the one of the shell off");
    assert.deepEqual(await host.run("await $`ls`.text()"), { text: NO_FOLDERS_ANSWER, isError: true });
    assert.deepEqual(await host.run('JSON.stringify([typeof $, typeof read, typeof write, typeof edit, "shell" in tools])'), {
      text: '["undefined","undefined","undefined","undefined",false]',
      isError: false,
    });
    assert.deepEqual((await host.listTools()).map((tool) => tool.name), ["run", "search"]);
  }

  test("it did not declare roots: nothing is sent to it, whatever it says afterwards", async () => {
    const w = world();
    await withProgram(SETTINGS({}, { fake: fakeEntry({ tools: ["rec"] }) }), { home: w.H, capabilities: {}, roots: [w.A] }, async (host) => {
      assert.equal(await host.search(), `fake: 1 tools\n${NO_FOLDERS_LINE}`);
      host.setRoots([w.B]);
      await sleep(300);
      assert.equal(host.rootsRequests.length, 0, "no roots/list, not even after a notifications/roots/list_changed");
      assert.deepEqual(await host.run("await $`ls`.text()"), { text: NO_FOLDERS_ANSWER, isError: true });
      assert.equal(host.rootsRequests.length, 0);
      assert.equal(host.others.length, 0);
    });
  });

  test("it did not declare roots, and the shell has no server beside it: the one line, the same texts", async () => {
    const w = world();
    await withProgram(SETTINGS(), { home: w.H, capabilities: {}, roots: [w.A] }, async (host) => {
      await assertNoFolders(host);
      assert.equal(host.rootsRequests.length, 0);
      assert.equal(host.stderr(), "");
    });
  });

  for (const [name, rootsAnswer] of [
    ["answers with an error", () => ({ error: { code: -32603, message: "SECRET-ROOTS-ERROR" } })],
    ["answers what the package refuses", () => ({ raw: { nothing: "of roots" } })],
    ["answers no root", () => ({ roots: [] })],
    ["answers roots that are not folders", () => ({ roots: [{ uri: "https://example.com/x" }, { uri: "untitled:1" }] })],
  ]) {
    test(`it declared roots and ${name}: no folder, and nothing about it on standard error or in an answer`, async () => {
      const w = world();
      await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer }, async (host) => {
        await assertNoFolders(host);
        assert.ok(host.rootsRequests.length >= 1);
        assert.equal(host.stderr(), "");
        assert.ok(!(await host.run("await $`ls`.text()")).text.includes("SECRET-ROOTS-ERROR"));
      });
    });
  }

  test("a reading with no answer is given up after connectSeconds: tools/list, search and run wait for that, no longer", async () => {
    const w = world();
    await withProgram(SETTINGS({ connectSeconds: 1 }), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer: HOLD }, async (host) => {
      const started = Date.now();
      const description = await host.description();
      const waited = Date.now() - started;
      assert.ok(shellOff(description), "the shell has no folder");
      assert.ok(waited >= 700 && waited < 4500, `tools/list waited the 1 second of connectSeconds: ${waited} ms`);
      const before = Date.now();
      assert.equal(await host.search(), NO_FOLDERS_LINE);
      assert.deepEqual(await host.run("await $`ls`.text()"), { text: NO_FOLDERS_ANSWER, isError: true });
      assert.ok(Date.now() - before < 3000, "the given-up reading does not make the next calls wait again");
      assert.equal(host.rootsRequests.length, 1);
    });
  });
});

describe("when the first reading begins, and who waits for it", () => {
  test("at the host's notification that it is ready: the request comes with no call of the host", async () => {
    const w = world();
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A] }, async (host) => {
      await waitFor(() => host.rootsRequests.length === 1, 3000, "the reading of the roots");
      assert.equal(host.rootsRequests.length, 1);
      assert.equal(await host.search(), "shell: 4 tools");
      await host.listTools();
      await host.run("1");
      assert.equal(host.rootsRequests.length, 1, "the first call of the host does not begin a second reading");
    });
  });

  for (const [what, call, check] of [
    ["tools/list", (host) => host.description(), (answer) => assert.ok(shellOn(answer))],
    ["search", (host) => host.search(), (answer) => assert.equal(answer, "shell: 4 tools")],
    ["run", (host) => host.run('await read("one.txt")'), (answer) => assert.deepEqual(answer, { text: "alpha\n", isError: false })],
  ]) {
    test(`with no notification of the host, ${what} begins the reading and waits for it`, async () => {
      const w = world();
      await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], initialized: false, rootsAnswer: HOLD }, async (host) => {
        await sleep(200);
        assert.equal(host.rootsRequests.length, 0, "nothing is asked before the host speaks");
        const pending = call(host);
        await waitFor(() => host.rootsRequests.length === 1, 3000, "the reading of the roots");
        assert.equal(await settledWithin(pending), "pending", `${what} waits for the reading`);
        host.rootsRequests[0].reply(answerRoots([w.A]));
        check(await pending);
        assert.equal(host.rootsRequests.length, 1);
      });
    });
  }

  test("tools/list, search and run wait for a reading in progress when the file gives no folders; tools/list does not when it gives some", async () => {
    const w = world();
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer: HOLD }, async (host) => {
      await waitFor(() => host.rootsRequests.length === 1, 3000, "the reading of the roots");
      const pending = [host.description(), host.search(), host.run('await read("one.txt")')];
      assert.deepEqual(await Promise.all(pending.map((one) => settledWithin(one, 300))), ["pending", "pending", "pending"]);
      host.rootsRequests[0].reply(answerRoots([w.A]));
      const [description, found, ran] = await Promise.all(pending);
      assert.ok(shellOn(description));
      assert.equal(found, "shell: 4 tools");
      assert.deepEqual(ran, { text: "alpha\n", isError: false });
    });
    // with folders in the file the reading is made only for the rules of a known host, and tools/list does not wait for it
    const settings = shellOnly({ shell: { folders: [w.B] }, onetool: { hostRules: true } });
    await withProgram(settings, { home: w.H, name: "claude-code", capabilities: ROOTS, roots: [w.A], rootsAnswer: HOLD }, async (host) => {
      await waitFor(() => host.rootsRequests.length === 1, 3000, "the reading of the roots");
      const search = host.search();
      const run = host.run("1");
      const started = Date.now();
      assert.ok(shellOn(await host.description()), "the folders of the file are the shell's");
      assert.ok(Date.now() - started < 1500, "tools/list waited for nothing");
      assert.equal(await settledWithin(search), "pending", "search waits for the reading");
      assert.equal(await settledWithin(run), "pending", "run waits for the reading");
      host.rootsRequests[0].reply(answerRoots([w.A]));
      assert.equal(await search, "shell: 4 tools");
      assert.deepEqual(await run, { text: "1", isError: false });
    });
  });
});

describe("a change of roots", () => {
  test("each notification is one more reading, and the folders are those of the last", async () => {
    const w = world();
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A] }, async (host) => {
      assert.deepEqual(await host.run(PWD), { text: `${w.A}\n`, isError: false });
      host.setRoots([w.B, w.A]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      assert.deepEqual(await host.run(PWD), { text: `${w.B}\n`, isError: false });
      assert.deepEqual(await host.run('await read("two.txt")'), { text: "beta\n", isError: false });
      host.setRoots([w.A]);
      await waitFor(() => host.rootsRequests.length === 3, 3000, "the third reading");
      assert.deepEqual(await host.run(PWD), { text: `${w.A}\n`, isError: false });
      assert.equal(host.rootsRequests.length, 3);
    });
  });

  test("a call that arrives while a reading is in progress waits for it, and works on the new folders", async () => {
    const w = world();
    let hold = false;
    const rootsAnswer = (request, host) => (hold ? undefined : answerRoots(host.roots));
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      hold = true;
      host.setRoots([w.B]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      const pending = [host.run(PWD), host.search()];
      assert.deepEqual(await Promise.all(pending.map((one) => settledWithin(one, 300))), ["pending", "pending"]);
      host.rootsRequests[1].reply(answerRoots([w.B]));
      assert.deepEqual(await pending[0], { text: `${w.B}\n`, isError: false });
      assert.equal(await pending[1], "shell: 4 tools");
    });
  });

  test("readings are made one after the other, in the order they were asked for", async () => {
    const w = world();
    let hold = false;
    const rootsAnswer = (request, host) => (hold ? undefined : answerRoots(host.roots));
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      hold = true;
      host.setRoots([w.B]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      host.setRoots([w.A]);
      await sleep(400);
      assert.equal(host.rootsRequests.length, 2, "the third reading waits for the second to end");
      hold = false;
      host.rootsRequests[1].reply(answerRoots([w.B]));
      await waitFor(() => host.rootsRequests.length === 3, 3000, "the third reading");
      assert.deepEqual(await host.run(PWD), { text: `${w.A}\n`, isError: false }, "the folders are those of the last reading");
    });
  });

  test("a reading that fails: no folder, and the next one that succeeds gives them back", async () => {
    const w = world();
    let mode = "ok";
    const rootsAnswer = (request, host) =>
      mode === "ok" ? answerRoots(host.roots) : { error: { code: -32603, message: "SECRET-ROOTS-ERROR" } };
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      mode = "fail";
      host.setRoots([w.A]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      assert.equal(await host.search(), NO_FOLDERS_LINE);
      mode = "ok";
      host.setRoots([w.B]);
      await waitFor(() => host.rootsRequests.length === 3, 3000, "the third reading");
      assert.equal(await host.search(), "shell: 4 tools");
      assert.equal(host.stderr(), "");
    });
  });
});

describe("telling the host that the description changed", () => {
  test("the capabilities: a list that can change only when the file gives no folders", async () => {
    const w = world();
    const cases = [
      // since step 8 every case has one more key, `prompts: {}` (the meeting point of server, "Telling the host that the description changed")
      [SETTINGS(), { tools: { listChanged: true }, prompts: {} }],
      [shellOnly({ shell: { deny: ["rm *"] }, onetool: { hostRules: false } }), { tools: { listChanged: true }, prompts: {} }],
      [shellOnly({ shell: { folders: [w.A] }, onetool: { hostRules: false } }), { tools: {}, prompts: {} }],
      [shellOnly({ shell: null, onetool: { hostRules: false } }), { tools: {}, prompts: {} }],
    ];
    for (const [settings, capabilities] of cases) {
      await withProgram(settings, { home: w.H, capabilities: ROOTS, roots: [w.A] }, async (host) => {
        assert.deepEqual(host.initializeResult.capabilities, capabilities);
      });
    }
  });

  test("one notification when the shell gains or loses its folders, none when it keeps them, and tools/list is then the one of that moment", async () => {
    const w = world();
    let mode = "ok";
    const rootsAnswer = (request, host) => (mode === "ok" ? answerRoots(host.roots) : { error: { code: -32603, message: "no" } });
    await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer }, async (host) => {
      assert.equal(await host.search(), "shell: 4 tools");
      await sleep(200);
      const base = host.listChanged;
      const settle = async (count) => {
        await waitFor(() => host.listChanged >= count, 3000, `${count} notification(s) that the tools changed`);
        await sleep(300);
        assert.equal(host.listChanged, count, "once");
      };
      // folders lost
      host.setRoots([]);
      await settle(base + 1);
      assert.ok(shellOff(await host.description()));
      assert.deepEqual((await host.listTools()).map((tool) => tool.name), ["run", "search"]);
      // folders back
      host.setRoots([w.B]);
      await settle(base + 2);
      assert.ok(shellOn(await host.description()));
      // folders kept, others: nothing
      host.setRoots([w.A, w.B]);
      await waitFor(() => host.rootsRequests.length === 4, 3000, "the fourth reading");
      await host.search();
      await sleep(300);
      assert.equal(host.listChanged, base + 2, "the shell had folders and still has");
      // a reading that fails loses them
      mode = "fail";
      host.setRoots([w.A]);
      await settle(base + 3);
      assert.ok(shellOff(await host.description()));
      assert.equal(host.stderr(), "");
    });
  });
});

describe("what follows the folders, for a program", () => {
  test("a program that started with folders and lost them: its calls of the shell are refused after the rules, and nothing is run or read", async () => {
    const w = world();
    const settings = SETTINGS({ deny: ["shell.write"] }, { fake: fakeEntry({ tools: ["barrier", "calls"] }) });
    await withProgram(settings, { home: w.H, capabilities: ROOTS, roots: [w.A] }, async (host) => {
      assert.equal(await host.search(), "fake: 2 tools\nshell: 3 tools");
      const first = host.run(`
        const out = [];
        await tools.fake.barrier({});
        for (const call of [() => read("one.txt"), () => write("made.txt", "x"), () => tools.shell.run({ command: "touch ran.txt" }), () => tools.shell.read("one.txt")]) {
          try { await call(); out.push("answered"); } catch (e) { out.push(e.message); }
        }
        return JSON.stringify(out);`);
      await waitInBarrier(host);
      host.setRoots([]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      assert.equal(withoutSession(await host.search()), `fake: 2 tools\n${NO_FOLDERS_LINE}`);
      const second = await host.run("await tools.fake.barrier({}); typeof read");
      assert.deepEqual(second, { text: "undefined", isError: false }, "a program that starts without folders has no names");
      const out = JSON.parse((await first).text);
      assert.deepEqual(out, [
        `shell.read failed: ${NO_FOLDERS}`,
        'onetool: shell.write is denied by the rule deny "shell.write"',
        `shell.run failed: ${NO_FOLDERS}`,
        "onetool: the arguments of shell.read must be an object",
      ]);
      assert.equal(existsSync(join(w.A, "ran.txt")), false);
      assert.equal(existsSync(join(w.A, "made.txt")), false);
      host.setRoots([w.B]);
      assert.deepEqual(await host.run("typeof read"), { text: "function", isError: false }, "the next program has the names again");
    });
  });

  test("a program that started without folders keeps no names when the host gives some, and its failure is then the plain one", async () => {
    const w = world();
    const settings = SETTINGS({}, { fake: fakeEntry({ tools: ["barrier", "calls"] }) });
    await withProgram(settings, { home: w.H, capabilities: ROOTS, roots: [] }, async (host) => {
      assert.equal(await host.search(), `fake: 2 tools\n${NO_FOLDERS_LINE}`);
      const first = host.run("await tools.fake.barrier({}); await $`ls`");
      await waitInBarrier(host);
      host.setRoots([w.A]);
      await waitFor(() => host.rootsRequests.length === 2, 3000, "the second reading");
      assert.equal(withoutSession(await host.search()), "fake: 2 tools\nshell: 4 tools");
      assert.deepEqual(await host.run("await tools.fake.barrier({}); typeof $"), { text: "function", isError: false });
      // the folders are there when its result is: shellOffMessage is not called
      assert.deepEqual(await first, { text: "The program failed: ReferenceError: $ is not defined", isError: true });
    });
  });
});

describe("the end with a reading in progress", () => {
  for (const [how, end] of [
    ["standard input closed", async (host) => (host.child.stdin.end(), host.within(5000))],
    ["SIGTERM", (host) => host.endBy("SIGTERM")],
    ["SIGINT", (host) => host.endBy("SIGINT")],
  ]) {
    test(`${how}: exit code 0 within 5 seconds, with calls waiting for the host`, async () => {
      const w = world();
      await withProgram(SETTINGS(), { home: w.H, capabilities: ROOTS, roots: [w.A], rootsAnswer: HOLD }, async (host) => {
        await waitFor(() => host.rootsRequests.length === 1, 3000, "the reading of the roots");
        const waiting = host.run("1").catch(() => "ended");
        void waiting;
        await sleep(100);
        const started = Date.now();
        const ended = await end(host);
        assert.equal(ended.code, 0);
        assert.ok(Date.now() - started < 5000);
      });
    });
  }
});
