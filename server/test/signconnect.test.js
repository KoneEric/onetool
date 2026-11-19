// Step 10: a listed server that asks for a sign-in (the meeting point of server, "Connecting a sign-in server", "`search`, and a program",
// "A sign-in made, or forgotten, while onetool runs" and "Telling the host"). The sign-in server is the practice server
// started with `--signin`, nothing replaced; the sign-in is made by the command `login`, as a person does it. HOME is
// a folder of the test for every process.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { delimiter, dirname, join } from "node:path";
import { LINE, fakeEntry, practiceEntry, settingsOf, sleep, tmpDir, withRaw, writeSettings, withoutSession } from "./helpers.js";
import { urlEntry, withHttp } from "./httpfixture.js";
import { assertShape, assertTrail, entriesOf, splitTrail } from "./recordhelpers.js";
import {
  COUNT_LYON,
  NEEDED_LINE,
  SECRET_MARKS,
  failedLine,
  needed,
  signIn,
  signOut,
  signSettings,
  standIns,
  waitNeeded,
  withPractice,
  withSignin,
} from "./signhelpers.js";

const BOTH = "practice: 5 tools\nfar: 5 tools";
const SIGN_IN_NEEDED = "practice: 5 tools\nfar: sign in needed";
const FAR_URL = "http://127.0.0.1:9/mcp";

/** The texts a person or an assistant could read hold none of the marks of a sign-in, and not the host and port of the server. */
function assertNoSecret(texts, practice) {
  const all = texts.join("\n");
  for (const mark of SECRET_MARKS) assert.ok(!all.includes(mark), `a text holds ${mark}`);
  assert.ok(!all.includes(practice.host), "a text holds the host and the port of the server");
}

describe("a sign-in server with no sign-in", () => {
  test("search says sign in needed, standard error has its line once, nothing is registered, and the host is not told", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      await withSignin(signSettings(practice), home, async (host) => {
        assert.equal(await host.search(), SIGN_IN_NEEDED);
        await waitNeeded(host);
        await sleep(200);
        assert.deepEqual(host.stderrLines().filter((line) => line.startsWith("onetool: server ")), [NEEDED_LINE]);
        const seen = await practice.seen();
        assert.deepEqual([seen.registrations, seen.authorizations, seen.tokens, seen.refreshes], [0, 0, 0, 0]);
        assert.equal(host.changed(), 0, "no notification for the state of the start");
        assert.deepEqual(host.client.getServerCapabilities(), { tools: { listChanged: true }, prompts: {} });
        assertNoSecret([host.stderr(), ...host.answers], practice);
      });
    });
  });

  test("search with words matches nothing of it", async () => {
    await withPractice([], async (practice) => {
      await withSignin(signSettings(practice), tmpDir(), async (host) => {
        const found = await host.search("count");
        assert.ok(found.split("\n").includes(LINE.count), found);
        assert.ok(!found.includes("far"), found);
      });
    });
  });

  test("in a program, every name under the server is a function, and the other servers are as before", async () => {
    await withPractice([], async (practice) => {
      await withSignin(signSettings(practice), tmpDir(), async (host) => {
        assert.equal((await host.run("typeof tools.far.count")).text, "function");
        assert.equal((await host.run("typeof tools.far.anything")).text, "function");
        assert.equal((await host.run("typeof tools.practice.count")).text, "function");
        assert.equal((await host.run("typeof tools.practice.nothing")).text, "undefined");
      });
    });
  });

  test("a call rejects with <id> failed: sign in needed: run \"onetool login ...\", at the place where it is said; the server is not called", async () => {
    await withPractice([], async (practice) => {
      const path = signSettings(practice);
      await withSignin(path, tmpDir(), async (host) => {
        await waitNeeded(host);
        await host.search();
        const before = await practice.seen();
        const answer = await host.run("await tools.far.count({})");
        assert.equal(answer.isError, true);
        assert.equal(answer.text, failedLine(path));
        assert.deepEqual(await practice.seen(), before, "nothing reached the server");
        assert.equal(host.changed(), 0);
      });
    });
  });

  test("the example of the text, in full, with a trail that has one line for the call, ending with failed", async () => {
    await withPractice([], async (practice) => {
      const path = signSettings(practice, { onetool: { trail: true } });
      await withSignin(path, tmpDir(), async (host) => {
        const answer = await host.run('await tools.far.count({ city: "Lyon" })');
        assert.equal(answer.isError, true);
        const { body, lines } = splitTrail(answer.text);
        assert.equal(body, failedLine(path));
        assertTrail(lines, [["far.count", "failed"]]);
      });
    });
  });

  test("the path in the message is the full path of the settings file, though --config gave a relative one", async () => {
    await withPractice([], async (practice) => {
      const path = signSettings(practice);
      await withSignin(path, tmpDir(), async (host) => {
        const answer = await host.run("await tools.far.count({})");
        assert.equal(answer.text, failedLine(path));
      }, { cwd: dirname(path), configArg: "settings.json" });
    });
  });

  test("a rule of deny refuses at step 1, whatever the state", async () => {
    await withPractice([], async (practice) => {
      const L = join(tmpDir(), "logs");
      const path = signSettings(practice, { onetool: { deny: ["far.count"], logFolder: L, trail: true } });
      await withSignin(path, tmpDir(), async (host) => {
        const answer = await host.run("await tools.far.count({})");
        assert.equal(answer.isError, true);
        assert.equal(answer.lines[0], 'The program failed: Error: onetool: far.count is denied by the rule deny "far.count"');
        assertTrail(splitTrail(answer.text).lines, [["far.count", "refused"]]);
        assert.equal(entriesOf(L, "far.count")[0].decision, "denied");
      });
    });
  });

  test("the record of the call: failed, no size, the fault is the message, the decision is allowed", async () => {
    await withPractice([], async (practice) => {
      const L = join(tmpDir(), "logs");
      const path = signSettings(practice, { onetool: { logFolder: L, trail: false } });
      await withSignin(path, tmpDir(), async (host) => {
        await host.run("await tools.far.count({})");
      });
      const [entry, ...rest] = entriesOf(L, "far.count");
      assert.deepEqual(rest, []);
      assertShape(entry);
      assert.equal(entry.decision, "allowed");
      assert.equal(entry.size, null);
      assert.equal(entry.fault, `far.count failed: ${needed(path)}`.slice(0, 500));
    });
  });

  test("a rule of ask covers it: the person is not asked, and the decision is asked: not asked", async () => {
    await withPractice([], async (practice) => {
      const L = join(tmpDir(), "logs");
      const path = signSettings(practice, { onetool: { ask: ["far.count"], logFolder: L, trail: false } });
      await withSignin(path, tmpDir(), async (host) => {
        const answer = await host.run("await tools.far.count({})");
        assert.equal(answer.text, failedLine(path));
        assert.deepEqual(host.questions, [], "no question");
      }, { canAsk: true });
      const [entry] = entriesOf(L, "far.count");
      assert.equal(entry.decision, "asked: not asked");
      assert.equal(entry.size, null);
    });
  });

  test("a server that answers 401 and has no sign-in at all is sign in needed, and it stops nothing", async () => {
    await withHttp({ status: 401, wwwAuth: 'Bearer resource_metadata="http://127.0.0.1:9/.well-known/oauth-protected-resource"' }, async (server) => {
      const path = writeSettings(settingsOf({ practice: practiceEntry(), far: urlEntry(server) }, { connectSeconds: 5, timeoutSeconds: 10 }));
      await withSignin(path, tmpDir(), async (host) => {
        assert.equal(await host.search(), SIGN_IN_NEEDED);
        await waitNeeded(host);
        assert.equal((await host.run("await tools.practice.echo({ text: 'still here' })")).text, "still here");
        assert.deepEqual([...new Set(server.requests.map((r) => `${r.method} ${r.path}`))], ["POST /mcp"], "nothing but the request to the server itself");
      });
    });
  });

  test("a server that does not ask for a sign-in connects as before: its tools, no line of sign in needed, no notification", async () => {
    await withHttp({ tools: ["hello", "plain"] }, async (server) => {
      const path = writeSettings(settingsOf({ far: urlEntry(server) }, { connectSeconds: 5, timeoutSeconds: 10 }));
      await withSignin(path, tmpDir(), async (host) => {
        assert.equal(await host.search(), "far: 2 tools");
        assert.equal((await host.run("await tools.far.plain({})")).text, "hello world");
        assert.equal(host.needed(), 0);
        assert.equal(host.changed(), 0);
        assert.deepEqual(host.client.getServerCapabilities(), { tools: { listChanged: true }, prompts: {} });
      });
    });
  });

  test("onetool starts no browser by itself, listens on nothing and registers nobody, whatever the server answers", async () => {
    await withPractice([], async (practice) => {
      const stand = standIns();
      await withSignin(signSettings(practice), tmpDir(), async (host) => {
        await host.search();
        await host.run("await tools.far.count({})");
        await sleep(300);
        assert.equal(stand.marked(), false);
        assert.equal((await practice.seen()).registrations, 0);
        assert.equal((await practice.seen()).authorizations, 0);
      }, { env: { PATH: `${stand.bin}${delimiter}${process.env.PATH}` } });
    });
  });
});

describe("a sign-in that is there at the start", () => {
  test("the server is connected with it: its tools, a call that works, no notification, no line of sign in needed", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      await withSignin(path, home, async (host) => {
        assert.equal(await host.search(), BOTH);
        assert.equal((await host.run(COUNT_LYON)).text, "625");
        assert.equal(host.changed(), 0);
        assert.equal(host.needed(), 0);
        assertNoSecret([host.stderr(), ...host.answers], practice);
      });
    });
  });

  test("the sign-in of another address is not used", async () => {
    await withPractice([], async (practice) => {
      await withPractice([], async (other) => {
        const home = tmpDir();
        await signIn(signSettings(other), home);
        await withSignin(signSettings(practice), home, async (host) => {
          assert.equal(await host.search(), SIGN_IN_NEEDED);
        });
      });
    });
  });

  test("a sign-in the server withdrew before the start: sign in needed, once, and it is not tried again at each call", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      await practice.forget();
      await withSignin(path, home, async (host) => {
        assert.equal(await host.search(), SIGN_IN_NEEDED);
        await waitNeeded(host);
        const settled = await practice.seen();
        await host.search();
        await host.run("await tools.far.count({})");
        await host.run("1");
        await host.search();
        assert.deepEqual(await practice.seen(), settled, "no request reached the server again");
        assert.equal(host.changed(), 0);
        assert.equal(host.needed(), 1);
        // only a write of the file makes it try again
        await signIn(path, home);
        assert.equal(withoutSession(await host.search()), BOTH);
        assert.equal(host.changed(), 1);
      });
    });
  });
});

describe("a sign-in made while onetool runs", () => {
  test("the next search picks it up with no restart: the tools, one notification before the answer, a call that works", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await withSignin(path, home, async (host) => {
        assert.equal(await host.search(), SIGN_IN_NEEDED);
        assert.equal(host.changed(), 0);
        await signIn(path, home);
        assert.equal(await host.search(), BOTH);
        assert.equal(host.changed(), 1, "told before the search was answered");
        assert.equal((await host.run(COUNT_LYON)).text, "625");
        assert.equal(withoutSession(await host.search()), BOTH);
        await sleep(200);
        assert.equal(host.changed(), 1, "once");
        assert.equal(host.needed(), 1);
        assertNoSecret([host.stderr(), ...host.answers], practice);
      });
    });
  });

  const FIRST_CALLS = {
    "search with a bad argument": ["search", { words: 5 }],
    "run with no code": ["run", {}],
    "run with jobs": ["run", { jobs: true }],
    "run with a program": ["run", { code: "1" }],
  };
  for (const [what, [name, args]] of Object.entries(FIRST_CALLS)) {
    test(`${what}: the first call after the sign-in picks it up, whatever its arguments`, async () => {
      await withPractice([], async (practice) => {
        const home = tmpDir();
        const path = signSettings(practice);
        await withSignin(path, home, async (host) => {
          await host.search();
          await signIn(path, home);
          await host.call(name, args);
          assert.equal(host.changed(), 1, "told before the call was answered");
          assert.equal(withoutSession(await host.search()), BOTH);
        });
      });
    });
  }

  test("calls that arrive together all see it connected (the second waits for the connection of the first), and the host is told", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await withSignin(path, home, async (host) => {
        await host.search();
        await signIn(path, home);
        const [one, two, counted] = await Promise.all([host.search(), host.search(), host.run(COUNT_LYON)]);
        assert.deepEqual([one, two, counted.text], [BOTH, BOTH, "625"]);
        await sleep(200);
        assert.ok(host.changed() >= 1, "the host was told");
      });
    });
  });

  test("a logout is followed the same way, and a new login again", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      await withSignin(path, home, async (host) => {
        assert.equal(await host.search(), BOTH);
        assert.equal((await signOut(path, home)).stdout, "onetool: signed out of far\n");
        assert.equal(await host.search(), SIGN_IN_NEEDED);
        assert.equal(host.changed(), 1, "told before the search was answered");
        await waitNeeded(host);
        assert.equal(host.needed(), 1);
        // its tools are forgotten, and its names in a program are functions that give the message
        assert.equal((await host.run("typeof tools.far.count")).text, "function");
        const answer = await host.run("await tools.far.count({})");
        assert.equal(answer.text, failedLine(path));
        await sleep(200);
        assert.equal(host.changed(), 1);
        await signIn(path, home);
        assert.equal(withoutSession(await host.search()), BOTH);
        assert.equal(host.changed(), 2);
        assert.equal((await host.run(COUNT_LYON)).text, "625");
      });
    });
  });

  test("a sign-in the server withdrew while onetool runs: the call fails with the message, the host is told once, the line is written, search follows", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const L = join(tmpDir(), "logs");
      const path = signSettings(practice, { onetool: { trail: true, logFolder: L } });
      await signIn(path, home);
      await withSignin(path, home, async (host) => {
        assert.equal(await host.search(), BOTH);
        await practice.forget();
        const answer = await host.run(
          'const out = [];\nfor (let i = 0; i < 2; i++) { try { await tools.far.count({}); out.push("ok"); } catch (error) { out.push(error.message); } }\nout.join("\\n")',
        );
        assert.equal(answer.isError, false);
        const { body, lines } = splitTrail(answer.text);
        assert.equal(body.split(`far.count failed: ${needed(path)}`).length - 1, 2, body);
        assertTrail(lines, [["far.count", "failed"], ["far.count", "failed"]]);
        assert.equal(host.changed(), 1, "once for the call of run, before it was answered");
        await waitNeeded(host);
        assert.equal(host.needed(), 1);
        assert.equal(withoutSession(await host.search()), SIGN_IN_NEEDED);
        await sleep(200);
        assert.equal(host.changed(), 1);
        assertNoSecret([host.stderr(), ...host.answers], practice);
      });
      const entries = entriesOf(L, "far.count");
      assert.equal(entries.length, 2);
      for (const entry of entries) {
        assertShape(entry);
        assert.equal(entry.decision, "allowed");
        assert.equal(entry.size, null);
        assert.equal(entry.fault, `far.count failed: ${needed(path)}`.slice(0, 500));
      }
    });
  });

  test("a program that is running when the state changes keeps its names, and its calls get the state of the moment (a sign-in made)", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice, { others: { fake: fakeEntry({ tools: ["barrier"] }) } });
      await withSignin(path, home, async (host) => {
        await host.search();
        const waiting = host.run(`await tools.fake.barrier({}); ${COUNT_LYON}`);
        await signIn(path, home);
        // the second program begins: the sign-in is picked up, and the first one is let go
        assert.equal((await host.run("await tools.fake.barrier({})")).text, "released");
        assert.equal((await waiting).text, "625");
        assert.equal(host.changed(), 1);
      });
    });
  });

  test("a program that is running when the state changes keeps its names, and its calls get the state of the moment (a sign-in forgotten)", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice, { others: { fake: fakeEntry({ tools: ["barrier"] }) } });
      await signIn(path, home);
      await withSignin(path, home, async (host) => {
        assert.equal(await host.search(), `${BOTH}\nfake: 1 tools`);
        const waiting = host.run(`await tools.fake.barrier({}); await tools.far.count({})`);
        await signOut(path, home);
        assert.equal((await host.run("await tools.fake.barrier({})")).text, "released");
        const answer = await waiting;
        assert.equal(answer.isError, true);
        assert.equal(answer.lines[0], failedLine(path));
        assert.equal(host.changed(), 1);
      });
    });
  });
});

describe("what onetool tells the host", () => {
  const FAR = { far: { url: FAR_URL } };
  const CASES = (shellFolder) => [
    ["a sign-in server and a server by command", settingsOf({ practice: practiceEntry(), ...FAR }), { tools: { listChanged: true }, prompts: {} }],
    ["a sign-in server with the shell on and folders (whatever the shell is)", settingsOf({ ...FAR }, { shell: { folders: [shellFolder] } }), { tools: { listChanged: true }, prompts: {} }],
    ["a sign-in server and nothing else (the shell is off)", settingsOf({ ...FAR }), { tools: { listChanged: true }, prompts: {} }],
    ["a sign-in server with headers that are not Authorization", settingsOf({ far: { url: FAR_URL, headers: { "X-Org": "a" } } }), { tools: { listChanged: true }, prompts: {} }],
    ["a sign-in server with an oauth key", settingsOf({ far: { url: FAR_URL, oauth: { clientId: "x" } } }), { tools: { listChanged: true }, prompts: {} }],
    ["only a server by command", settingsOf({ practice: practiceEntry() }), { tools: {}, prompts: {} }],
    ["no server at all", settingsOf({}), { tools: {}, prompts: {} }],
    ["a server at an address with an Authorization header", settingsOf({ far: { url: FAR_URL, headers: { Authorization: "Bearer x" } } }), { tools: {}, prompts: {} }],
    ["a server at an address with an authorization header in lower case", settingsOf({ far: { url: FAR_URL, headers: { authorization: "x" } } }), { tools: {}, prompts: {} }],
    ["an entry that is bad (oauth and an Authorization header)", settingsOf({ far: { url: FAR_URL, oauth: { clientId: "x" }, headers: { Authorization: "x" } } }), { tools: {}, prompts: {} }],
    ["the shell with no folders and no sign-in server (the case of step 5)", settingsOf({ practice: practiceEntry() }, { shell: {} }), { tools: { listChanged: true }, prompts: {} }],
    ["the shell with folders and no sign-in server", settingsOf({ practice: practiceEntry() }, { shell: { folders: [shellFolder] } }), { tools: {}, prompts: {} }],
  ];
  for (const [what, settings, capabilities] of CASES(tmpDir())) {
    test(`capabilities, ${what}`, async () => {
      await withRaw(settings, async (raw) => {
        const res = await raw.initialize();
        assert.deepEqual(res.result.capabilities, capabilities);
      });
    });
  }

  test("tools/list is the same two tools, with the same descriptions and schemas, with a sign-in server and without", async () => {
    const list = (servers) => withRaw(settingsOf(servers, { connectSeconds: 5 }), async (raw) => {
      await raw.initialize();
      return (await raw.request("tools/list", {})).result.tools;
    });
    const without = await list({ practice: practiceEntry() });
    const withIt = await list({ practice: practiceEntry(), far: { url: FAR_URL } });
    assert.deepEqual(withIt.map((tool) => tool.name), ["run", "search"]);
    assert.deepEqual(withIt, without);
  });

  test("tools/list is still the same after a sign-in has changed what search finds", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await withSignin(path, home, async (host) => {
        const before = await host.client.listTools();
        await host.search();
        await signIn(path, home);
        assert.equal(await host.search(), BOTH);
        assert.deepEqual(await host.client.listTools(), before);
      });
    });
  });
});
