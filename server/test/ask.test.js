// Step 3: `ask` (the meeting point of server, "Step 3: `ask`"). The host program is the raw one of askhost.js, so that what
// onetool sends to it, and when, can be seen; the listed server is the fake one, which records its calls.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FAKE_TOOL_COUNT, alive, childrenOf, fakeEntry, settingsOf, waitFor, withOnetool, textOf } from "./helpers.js";
import { CAUGHT, pause, withHost } from "./askhost.js";

const ASK = (ask, onetool = {}) => settingsOf({ fake: fakeEntry() }, { timeoutSeconds: 10, ask, ...onetool });

// The question the person reads: the meeting point of core, "`askMessage(id, rule, args, { limit })`".
const question = (id, rule, argumentsText) =>
  [
    `onetool: a program wants to call ${id}.`,
    `Arguments: ${argumentsText}`,
    `The rule ask "${rule}" asks for your consent. Allow this call?`,
  ].join("\n");

// The message of a refusal: the meeting point of core, "`askRefusal(id, rule, why)`".
const refusal = (rule, cause, id = "fake.rec") => `onetool: ${id} is refused by the rule ask "${rule}": ${cause}`;
const SAID_NO = "the person said no";
const NO_ANSWER = "the person gave no answer";
const FAILED = "the question failed";
const CANNOT_ASK = "the host program cannot ask the person";

const ACCEPT = () => ({ action: "accept" });
const CALLED = { text: "called rec", isError: false };
const caught = (answer) => JSON.parse(answer.text);

/** The processes onetool started are gone a little after it is. */
async function allGone(pids) {
  await waitFor(() => pids.every((pid) => !alive(pid)), 4000, "the processes onetool started to end");
}

describe("a host program that can be asked", () => {
  test("accept: the tool is called, after one question that says what the text of core says", async () => {
    await withHost(ASK(["fake.rec"]), { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run("await tools.fake.rec({ a: 1 })"), CALLED);
      assert.equal(host.questions.length, 1);
      const [asked] = host.questions;
      assert.equal(asked.message, question("fake.rec", "fake.rec", '{"a":1}'));
      assert.deepEqual(asked.params.requestedSchema, { type: "object", properties: {} });
      assert.equal(asked.params.mode, "form");
      assert.deepEqual(await host.recorded(), [{ name: "rec", arguments: { a: 1 } }]);
    });
  });

  test("the arguments in the question are cut as core says: the first 300 characters, then the whole length", async () => {
    await withHost(ASK(["fake.rec"]), { answer: ACCEPT }, async (host) => {
      const args = { s: "x".repeat(400) };
      assert.deepEqual(await host.run(`await tools.fake.rec({ s: "${args.s}" })`), CALLED);
      // the JSON text is {"s":"<400 x>"}: 6 + 400 + 2 characters; the default limit of askMessage is 300
      const json = JSON.stringify(args);
      assert.equal(json.length, 408);
      assert.equal(host.questions[0].message, question("fake.rec", "fake.rec", `${json.slice(0, 300)}... (408 characters)`));
    });
  });

  test("the rule in the question and in the refusals is the first pattern of ask that matches, as written", async () => {
    await withHost(ASK(["*.rec", "fake.*"]), { answer: () => ({ action: "decline" }) }, async (host) => {
      const res = caught(await host.run(CAUGHT("tools.fake.rec({})")));
      assert.deepEqual(res, [true, refusal("*.rec", SAID_NO)]);
      assert.equal(host.questions[0].message, question("fake.rec", "*.rec", "{}"));
    });
  });

  test("accept whatever the content holds, with or without one: the tool is called", async () => {
    let outcome = { action: "accept", content: { x: 1 } };
    await withHost(ASK(["fake.rec"]), { answer: () => outcome }, async (host) => {
      assert.deepEqual(await host.run("await tools.fake.rec({ n: 1 })"), CALLED);
      outcome = { action: "accept" };
      assert.deepEqual(await host.run("await tools.fake.rec({ n: 2 })"), CALLED);
      assert.deepEqual(await host.recorded(), [
        { name: "rec", arguments: { n: 1 } },
        { name: "rec", arguments: { n: 2 } },
      ]);
    });
  });

  // What comes back, and the cause the program reads. The message of an error of the host is never passed on.
  const OUTCOMES = [
    ["decline", { action: "decline" }, SAID_NO],
    ["cancel", { action: "cancel" }, NO_ANSWER],
    ["a JSON-RPC error of the host", { error: { code: -32603, message: "ZZZsecret" } }, FAILED],
    ["an action the package refuses", { raw: { action: "maybe" } }, FAILED],
    ["a result with no action", { raw: {} }, FAILED],
  ];

  test("every answer but accept: the program gets an Error it can catch, and the real server is not called", async () => {
    let outcome;
    await withHost(ASK(["fake.rec"]), { answer: () => outcome }, async (host) => {
      for (const [what, given, cause] of OUTCOMES) {
        outcome = given;
        const res = caught(await host.run(CAUGHT("tools.fake.rec({})")));
        assert.deepEqual(res, [true, refusal("fake.rec", cause)], what);
      }
      assert.equal(host.questions.length, OUTCOMES.length);
      assert.deepEqual(await host.recorded(), []);
      assert.doesNotMatch(host.stderr(), /fake\.rec|consent|person|question|ZZZ/, "nothing about a question on standard error");
    });
  });

  test("every answer but accept, uncaught: the answer of run is The program failed: Error: <the message>, isError", async () => {
    let outcome;
    await withHost(ASK(["fake.rec"]), { answer: () => outcome }, async (host) => {
      for (const [what, given, cause] of OUTCOMES) {
        outcome = given;
        const res = await host.run("await tools.fake.rec({})");
        assert.deepEqual(res, { text: `The program failed: Error: ${refusal("fake.rec", cause)}`, isError: true }, what);
      }
      assert.ok(!host.stderr().includes("ZZZ"));
    });
  });

  test("each call is asked anew: a yes is not remembered", async () => {
    await withHost(ASK(["fake.rec"]), { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run("await tools.fake.rec({ n: 1 })"), CALLED);
      assert.deepEqual(await host.run("await tools.fake.rec({ n: 1 })"), CALLED);
      assert.deepEqual(await host.run("await tools.fake.rec({ n: 1 }); await tools.fake.rec({ n: 1 })"), CALLED);
      assert.equal(host.questions.length, 4);
    });
  });

  test("a call no rule of ask covers is never asked about", async () => {
    await withHost(ASK(["fake.rec"]), { answer: ACCEPT }, async (host) => {
      assert.deepEqual(await host.run("await tools.fake.plain({})"), { text: "hello world", isError: false });
      assert.deepEqual(await host.run("await tools.fake.hello({})"), { text: "called hello", isError: false });
      assert.equal(host.questions.length, 0);
    });
  });

  test("a call that deny or allow refuses is refused without a question, whatever ask holds", async () => {
    const settings = settingsOf(
      { fake: fakeEntry() },
      {
        timeoutSeconds: 10,
        deny: ["fake.rec"],
        allow: ["fake.rec", "fake.hello", "fake.calls"],
        ask: ["fake.rec", "fake.json", "fake.hello"],
      },
    );
    await withHost(settings, { answer: ACCEPT }, async (host) => {
      // refused by deny, ask holds it too
      assert.deepEqual(caught(await host.run(CAUGHT("tools.fake.rec({})"))), [
        true,
        'onetool: fake.rec is denied by the rule deny "fake.rec"',
      ]);
      // refused by allow, ask holds it too
      assert.deepEqual(caught(await host.run(CAUGHT("tools.fake.json({})"))), [
        true,
        "onetool: fake.json is not allowed: it matches no rule of allow",
      ]);
      assert.equal(host.questions.length, 0);
      // allowed and under ask: asked
      assert.deepEqual(await host.run("await tools.fake.hello({})"), { text: "called hello", isError: false });
      assert.equal(host.questions.length, 1);
      assert.equal(host.questions[0].message, question("fake.hello", "fake.hello", "{}"));
    });
  });

  test("bad arguments are refused before the question", async () => {
    await withHost(ASK(["fake.rec"]), { answer: ACCEPT }, async (host) => {
      const code = `const out = [];
        for (const bad of [[1, 2], "text", 7, null]) {
          try { await tools.fake.rec(bad); out.push("answered"); } catch (e) { out.push(e.message); }
        }
        return JSON.stringify(out);`;
      const message = "onetool: the arguments of fake.rec must be an object";
      assert.deepEqual(caught(await host.run(code)), [message, message, message, message]);
      assert.equal(host.questions.length, 0);
      assert.deepEqual(await host.recorded(), []);
    });
  });

  test("state: a program refused after state.a = 1 has kept a", async () => {
    let outcome = { action: "decline" };
    await withHost(ASK(["fake.rec"]), { answer: () => outcome }, async (host) => {
      const refused = await host.run("state.a = 1; await tools.fake.rec({})");
      assert.deepEqual(refused, { text: `The program failed: Error: ${refusal("fake.rec", SAID_NO)}`, isError: true });
      assert.deepEqual(await host.run("JSON.stringify(state)"), { text: '{"a":1}', isError: false });
    });
  });

  test("search shows a tool under ask like any other", async () => {
    const lines = async (onetool) =>
      withOnetool(settingsOf({ fake: fakeEntry() }, { timeoutSeconds: 10, ...onetool }), async (ctx) => [
        textOf(await ctx.call("search", {})),
        textOf(await ctx.call("search", { words: "rec" })),
        textOf(await ctx.call("search", { words: "fake" })),
      ]);
    const asked = await lines({ ask: ["fake.rec", "fake.*"] });
    const plain = await lines({});
    assert.deepEqual(asked, plain);
    assert.equal(asked[0], `fake: ${FAKE_TOOL_COUNT} tools`);
    assert.ok(asked[1].split("\n").includes("fake.rec() - The rec tool."), asked[1]);
  });
});

describe("the capability of the host program", () => {
  const CANNOT = [
    ["no capability at all", {}],
    ["another capability only", { roots: {} }],
    ["elicitation of the url kind only", { elicitation: { url: {} } }],
  ];
  const CAN = [
    ["an empty elicitation", { elicitation: {} }],
    ["the form kind", { elicitation: { form: {} } }],
    ["both kinds", { elicitation: { form: {}, url: {} } }],
  ];

  for (const [what, capabilities] of CANNOT) {
    test(`${what}: the call is refused as unsupported, nothing is sent to the host, the server is not called`, async () => {
      await withHost(ASK(["fake.rec"]), { capabilities, answer: ACCEPT }, async (host) => {
        assert.deepEqual(caught(await host.run(CAUGHT("tools.fake.rec({})"))), [true, refusal("fake.rec", CANNOT_ASK)]);
        assert.deepEqual(await host.run("await tools.fake.rec({})"), {
          text: `The program failed: Error: ${refusal("fake.rec", CANNOT_ASK)}`,
          isError: true,
        });
        // the other tools work as before
        assert.deepEqual(await host.run("await tools.fake.plain({})"), { text: "hello world", isError: false });
        assert.equal(host.questions.length, 0);
        assert.deepEqual(host.others, []);
        assert.deepEqual(await host.recorded(), [{ name: "plain", arguments: {} }]);
        assert.doesNotMatch(host.stderr(), /fake\.rec|consent|person|question/);
      });
    });
  }

  for (const [what, capabilities] of CAN) {
    test(`${what}: the host is asked, and the call is made after a yes`, async () => {
      await withHost(ASK(["fake.rec"]), { capabilities, answer: ACCEPT }, async (host) => {
        assert.deepEqual(await host.run("await tools.fake.rec({})"), CALLED);
        assert.equal(host.questions.length, 1);
      });
    });
  }

  test("a server that is no longer connected: not connected, the person is not asked, whatever the host declared", async () => {
    for (const capabilities of [{ elicitation: {} }, {}]) {
      await withHost(ASK(["fake.rec"]), { capabilities, answer: ACCEPT }, async (host) => {
        const dying = caught(await host.run(CAUGHT("tools.fake.die({})")));
        assert.ok(dying[1].startsWith("fake.die failed: "), dying[1]);
        // once its process is gone, every call says so (a tool under no rule, so that nobody is asked while we wait)
        let last = "";
        await waitFor(
          async () => {
            last = caught(await host.run(CAUGHT("tools.fake.hello({})")))[1];
            return last === "fake.hello failed: not connected";
          },
          3000,
          `fake.hello failed: not connected (last answer: ${last})`,
        );
        assert.deepEqual(caught(await host.run(CAUGHT("tools.fake.rec({})"))), [true, "fake.rec failed: not connected"]);
        assert.equal(host.questions.length, 0);
      });
    }
  });
});

describe("one question at a time", () => {
  test("several calls in one program: the host receives each question only after it answered the one before; each call gets its own answer", async () => {
    await withHost(ASK(["fake.rec"]), { answer: () => undefined }, async (host) => {
      const code = `const all = await Promise.allSettled([tools.fake.rec({ n: 1 }), tools.fake.rec({ n: 2 }), tools.fake.rec({ n: 3 })]);
        return JSON.stringify(all.map((one) => (one.status === "fulfilled" ? "ok" : one.reason.message)));`;
      const pending = host.run(code);
      await host.waitQuestions(1);
      await pause();
      assert.equal(host.questions.length, 1, "the second question waits for the answer to the first");
      host.questions[0].reply({ action: "accept" });
      await host.waitQuestions(2);
      await pause();
      assert.equal(host.questions.length, 2, "the third question waits for the answer to the second");
      host.questions[1].reply({ action: "decline" });
      await host.waitQuestions(3);
      host.questions[2].reply({ action: "accept" });
      assert.deepEqual(caught(await pending), ["ok", refusal("fake.rec", SAID_NO), "ok"]);
      // in the order the calls reached the step
      assert.deepEqual(
        host.questions.map((one) => one.message),
        [1, 2, 3].map((n) => question("fake.rec", "fake.rec", `{"n":${n}}`)),
      );
      assert.deepEqual(await host.recorded(), [
        { name: "rec", arguments: { n: 1 } },
        { name: "rec", arguments: { n: 3 } },
      ]);
    });
  });

  test("two calls of run in progress: the same, for all the programs together", async () => {
    await withHost(ASK(["fake.rec"]), { answer: () => undefined }, async (host) => {
      const pendingA = host.run('await tools.fake.rec({ p: "A" })');
      const pendingB = host.run('await tools.fake.rec({ p: "B" })');
      const outcomeFor = (asked) => (asked.message.includes('{"p":"A"}') ? { action: "decline" } : { action: "accept" });
      await host.waitQuestions(1);
      await pause();
      assert.equal(host.questions.length, 1, "the second question waits for the answer to the first");
      host.questions[0].reply(outcomeFor(host.questions[0]));
      await host.waitQuestions(2);
      host.questions[1].reply(outcomeFor(host.questions[1]));
      assert.deepEqual(await pendingA, {
        text: `The program failed: Error: ${refusal("fake.rec", SAID_NO)}`,
        isError: true,
      });
      assert.deepEqual(await pendingB, CALLED);
      assert.deepEqual(await host.recorded(), [{ name: "rec", arguments: { p: "B" } }]);
    });
  });
});

describe("the person's time is the program's time", () => {
  test("a host that never answers: the program is stopped at its limit, the question is given up, the tool is not called", async () => {
    await withHost(ASK(["fake.rec"], { timeoutSeconds: 1 }), { answer: () => undefined }, async (host) => {
      const res = await host.run("state.b = 2; await tools.fake.rec({})");
      assert.deepEqual(res, { text: "The program was stopped after 1 seconds.", isError: true });
      assert.equal(host.questions.length, 1);
      // the package tells the host that the request is given up
      await waitFor(() => host.events.some((event) => event.kind === "cancelled"), 3000, "notifications/cancelled");
      const cancelled = host.events.find((event) => event.kind === "cancelled");
      assert.equal(cancelled.requestId, host.questions[0].id);
      // a late answer changes nothing
      host.questions[0].reply({ action: "accept" });
      await pause();
      assert.deepEqual(await host.recorded(), []);
      // and nothing of the stopped call is kept
      assert.deepEqual(await host.run("JSON.stringify(state)"), { text: "{}", isError: false });
    });
  });

  test("the next call in line, of another program, gets its turn once the open question is given up", async () => {
    const answer = (asked) => (asked.message.includes('{"p":"B"}') ? { action: "accept" } : undefined);
    await withHost(ASK(["fake.rec"], { timeoutSeconds: 3 }), { answer }, async (host) => {
      const pendingA = host.run('await tools.fake.rec({ p: "A" })');
      await host.waitQuestions(1);
      // B begins a second after A, so that it still has time when A is stopped
      await pause(1000);
      const pendingB = host.run('await tools.fake.rec({ p: "B" })');
      assert.deepEqual(await pendingA, { text: "The program was stopped after 3 seconds.", isError: true });
      assert.deepEqual(await pendingB, CALLED);
      // the question of A is given up before the one of B is sent (what the package says after B's own is not read)
      assert.deepEqual(
        host.events.slice(0, 3).map((event) => event.kind),
        ["question", "cancelled", "question"],
      );
      assert.equal(host.events[1].requestId, host.questions[0].id);
      assert.deepEqual(await host.recorded(), [{ name: "rec", arguments: { p: "B" } }]);
    });
  });

  test("a call whose program ended by itself while it waited for its turn is dropped: nothing is sent, the next gets its turn", async () => {
    let mode = "hold";
    const answer = (asked) => (mode === "hold" && asked.message.includes('{"p":"A"}') ? undefined : { action: "accept" });
    await withHost(ASK(["fake.rec"]), { answer }, async (host) => {
      const pendingA = host.run('await tools.fake.rec({ p: "A" })');
      await host.waitQuestions(1);
      // B does not wait for its call: it ends with its value while the question of A is open
      assert.deepEqual(await host.run('tools.fake.rec({ p: "B" }); "done"'), { text: "done", isError: false });
      host.questions[0].reply({ action: "accept" });
      assert.deepEqual(await pendingA, CALLED);
      await pause(600);
      assert.equal(host.questions.length, 1, "nothing was sent for the call of B");
      mode = "free";
      assert.deepEqual(await host.run('await tools.fake.rec({ p: "C" })'), CALLED);
      assert.equal(host.questions.length, 2);
      assert.deepEqual(await host.recorded(), [
        { name: "rec", arguments: { p: "A" } },
        { name: "rec", arguments: { p: "C" } },
      ]);
    });
  });

  test("a call whose program was stopped while it waited for its turn is dropped as well", async () => {
    let mode = "hold";
    const answer = () => (mode === "hold" ? undefined : { action: "accept" });
    await withHost(ASK(["fake.rec"], { timeoutSeconds: 1 }), { answer }, async (host) => {
      const code = "await Promise.all([tools.fake.rec({ p: 1 }), tools.fake.rec({ p: 2 })])";
      assert.deepEqual(await host.run(code), { text: "The program was stopped after 1 seconds.", isError: true });
      await pause(600);
      assert.equal(host.questions.length, 1, "the second call of the stopped program was never asked");
      mode = "free";
      assert.deepEqual(await host.run('await tools.fake.rec({ p: "C" })'), CALLED);
      assert.deepEqual(
        host.questions.map((one) => one.message),
        [question("fake.rec", "fake.rec", '{"p":1}'), question("fake.rec", "fake.rec", '{"p":"C"}')],
      );
      assert.deepEqual(await host.recorded(), [{ name: "rec", arguments: { p: "C" } }]);
    });
  });
});

describe("the end with a question open or waiting", () => {
  const HOLD = { answer: () => undefined };
  const OPEN = 'await tools.fake.rec({ p: "open" })';
  const WAITING = 'await Promise.all([tools.fake.rec({ p: "open" }), tools.fake.rec({ p: "waiting" })])';
  const ENDS = [
    ["SIGINT", (host) => host.endBy("SIGINT", 5000)],
    ["SIGTERM", (host) => host.endBy("SIGTERM", 5000)],
    [
      "standard input closed",
      (host) => {
        host.child.stdin.end();
        return host.within(5000);
      },
    ],
  ];

  for (const [what, code] of [
    ["a question is open", OPEN],
    ["a question is open and another waits for its turn", WAITING],
  ]) {
    for (const [ending, end] of ENDS) {
      test(`${ending} while ${what}: exit code 0 within 5 seconds, no process is left`, async () => {
        await withHost(ASK(["fake.rec"], { timeoutSeconds: 60 }), HOLD, async (host) => {
          host.run(code).catch(() => {});
          await host.waitQuestions(1);
          const started = childrenOf(host.child.pid);
          assert.ok(started.length >= 2, "the server and the program's process run");
          assert.deepEqual(await end(host), { code: 0, signal: null });
          await allGone(started);
          assert.equal(host.questions.length, 1);
        });
      });
    }
  }

  test("a signal when nothing runs and no question is open: the same end", async () => {
    await withHost(ASK(["fake.rec"], { timeoutSeconds: 60 }), HOLD, async (host) => {
      assert.equal(await host.search(), `fake: ${FAKE_TOOL_COUNT} tools`);
      assert.deepEqual(await host.endBy("SIGTERM", 5000), { code: 0, signal: null });
    });
  });

  test("a second signal while it is ending: the process is gone within 5 seconds", async () => {
    await withHost(ASK(["fake.rec"], { timeoutSeconds: 60 }), HOLD, async (host) => {
      host.run(OPEN).catch(() => {});
      await host.waitQuestions(1);
      host.child.kill("SIGTERM");
      await pause(30);
      host.child.kill("SIGTERM");
      await host.within(5000);
    });
  });
});
