// Step 2: servers reached at an address (the meeting point of server, "Step 2: servers reached at an address").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FAKE_TOOL_COUNT, alive, childrenOf, fakeEntry, okText, serverLines, settingsOf, textOf, waitFor, withOnetool, withRaw } from "./helpers.js";
import { SECRET_BODY, freePort, httpServer, urlEntry, withHttp } from "./httpfixture.js";

const FAR = (server, headers, onetool = {}) => settingsOf({ far: urlEntry(server, headers) }, { timeoutSeconds: 10, ...onetool });
const HTTP_TOOLS = 6; // the default list of the fixture: hello, rec, calls, rpcerr, hang, plain

const CAUGHT = (call) => `try { await ${call}; return 'answered'; } catch (e) { return e.message; }`;

/** The texts that must not hold the address of a server, a header or a text of the server. */
function assertNoValue(texts, server) {
  for (const text of texts) {
    assert.ok(!text.includes("ZZZ"), `a value of the settings file or of the server is in: ${text}`);
    assert.ok(!text.includes(server.url), `the address is in: ${text}`);
    assert.ok(!text.includes(`127.0.0.1:${server.port}`), `the address is in: ${text}`);
  }
}

describe("connecting to a server at an address", () => {
  test("its tools are listed in order, and a program calls them; the servers keep the order of the file, both kinds mixed", async () => {
    await withHttp({ tools: ["alpha", "beta"] }, async (a) => {
      await withHttp({ tools: ["gamma"] }, async (b) => {
        const settings = settingsOf(
          { first: urlEntry(a), desk: fakeEntry(), second: urlEntry(b) },
          { timeoutSeconds: 10 },
        );
        await withOnetool(settings, async (ctx) => {
          assert.equal(textOf(await ctx.call("search", {})), `first: 2 tools\ndesk: ${FAKE_TOOL_COUNT} tools\nsecond: 1 tools`);
          assert.equal(textOf(await ctx.call("search", { words: "first" })), "first.alpha() - The alpha tool.\nfirst.beta() - The beta tool.");
          assert.equal(okText(await ctx.run("await tools.first.alpha({})")), "called alpha");
          assert.equal(okText(await ctx.run("await tools.second.gamma({})")), "called gamma");
          assert.equal(okText(await ctx.run("await tools.desk.hello({})")), "called hello");
        });
      });
    });
  });

  test("the list is followed through its pages, in order", async () => {
    const tools = ["p1", "p2", "p3", "p4", "p5"];
    await withHttp({ tools, pageSize: 2 }, async (server) => {
      await withOnetool(FAR(server), async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), "far: 5 tools");
        assert.equal(
          textOf(await ctx.call("search", { words: "far" })),
          tools.map((t) => `far.${t}() - The ${t} tool.`).join("\n"),
        );
        assert.equal(okText(await ctx.run("typeof tools.far.p5")), "function");
      });
    });
  });

  test("every HTTP request to the server carries every header of the entry, as written", async () => {
    const headers = { Authorization: "Bearer token-1", "X-Api-Key": "a b=c;d", "X-Other": "é-ü", "X-Empty": "" };
    await withHttp({}, async (server) => {
      await withOnetool(FAR(server, headers), async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), `far: ${HTTP_TOOLS} tools`);
        assert.equal(okText(await ctx.run("await tools.far.hello({})")), "called hello");
      });
      const methods = server.methods();
      for (const needed of ["initialize", "tools/list", "tools/call"]) assert.ok(methods.includes(needed), `${needed} was sent`);
      assert.ok(server.requests.length >= 4);
      for (const request of server.requests) {
        for (const [name, value] of Object.entries(headers)) {
          assert.equal(request.headers[name.toLowerCase()], value, `${request.method} ${request.body?.method ?? ""}: ${name}`);
        }
      }
    });
  });

  test("a redirect inside the same origin is followed", async () => {
    await withHttp({}, async (server) => {
      const entry = { url: `${server.origin}/old`, headers: { "X-Key": "k" } };
      await withOnetool(settingsOf({ far: entry }, { timeoutSeconds: 10 }), async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), `far: ${HTTP_TOOLS} tools`);
        assert.equal(okText(await ctx.run("await tools.far.hello({})")), "called hello");
      });
    });
  });

  test("no process is started for it", async () => {
    await withHttp({}, async (server) => {
      await withRaw(FAR(server), async (raw) => {
        await raw.initialize();
        const res = await raw.callTool("search", {});
        assert.equal(res.result.content[0].text, `far: ${HTTP_TOOLS} tools`);
        assert.deepEqual(childrenOf(raw.child.pid), []);
        raw.child.stdin.end();
        assert.equal((await raw.within(5000)).code, 0);
      });
    });
  });

  test("a call that arrives before the connection is made waits for it, for both kinds of server", async () => {
    await withHttp({ tools: ["hello"], listDelayMs: 700 }, async (server) => {
      await withOnetool(FAR(server), async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), "far: 1 tools");
      });
      await withOnetool(FAR(server), async (ctx) => {
        assert.equal(okText(await ctx.run("typeof tools.far.hello")), "function");
      });
    });
  });

  test("every server is connected at the same time, whatever its kind", async () => {
    await withHttp({ tools: ["hello"], listDelayMs: 1200 }, async (a) => {
      await withHttp({ tools: ["hello"], listDelayMs: 1200 }, async (b) => {
        const settings = settingsOf({ a: urlEntry(a), b: urlEntry(b) });
        await withOnetool(settings, async (ctx) => {
          assert.equal(textOf(await ctx.call("search", {})), "a: 1 tools\nb: 1 tools");
        });
        const start = (server) => server.requests.find((r) => r.body?.method === "initialize").at;
        // One after the other, the second would begin 1.2 seconds after the first.
        assert.ok(Math.abs(start(a) - start(b)) < 800, `begun ${Math.abs(start(a) - start(b))} ms apart`);
      });
    });
  });
});

describe("a server at an address that is not connected", () => {
  /** Runs onetool in front of the entry and says what it said: the answer of search, and the lines on standard error. */
  async function failure(entry, onetool = {}, others = {}) {
    return withOnetool(settingsOf({ far: entry, ...others }, { timeoutSeconds: 10, connectSeconds: 20, ...onetool }), async (ctx) => {
      const answer = textOf(await ctx.call("search", {}));
      await waitFor(() => serverLines(ctx).length >= 1, 3000, "its line");
      return { answer, lines: serverLines(ctx), stderr: ctx.stderr(), ctx };
    });
  }

  const COULD_NOT = "far: not connected (could not connect)";
  const LINE_COULD_NOT = "onetool: server far: not connected (could not connect)";

  // since step 10 (the meeting point of server, "Connecting a sign-in server"): a 401 at a server with no `Authorization` header is `sign in needed`
  const SIGN_IN = "far: sign in needed";
  const LINE_SIGN_IN = "onetool: server far: sign in needed";
  for (const status of [401, 403, 404, 500]) {
    test(`an HTTP status that is not a success (${status}): ${status === 401 ? "sign in needed" : "could not connect"}, with nothing of the status or the address`, async () => {
      const wwwAuth = status === 401 ? 'Bearer resource_metadata="http://127.0.0.1:9/.well-known/oauth-protected-resource"' : undefined;
      await withHttp({ status, wwwAuth }, async (server) => {
        const { answer, lines, stderr } = await failure(urlEntry(server, { "X-Key": "ZZZhdr" }));
        assert.equal(answer, status === 401 ? SIGN_IN : COULD_NOT);
        assert.deepEqual(lines, [status === 401 ? LINE_SIGN_IN : LINE_COULD_NOT]);
        assertNoValue([answer, stderr], server);
        // no sign-in is done, and the old transport is not tried: only the POSTs of this transport reach the address
        for (const request of server.requests) {
          assert.equal(request.method, "POST");
          assert.equal(request.path, "/mcp");
        }
      });
    });
  }

  test("a 401 at a server with an Authorization header stays could not connect (it is no sign-in server)", async () => {
    const wwwAuth = 'Bearer resource_metadata="http://127.0.0.1:9/.well-known/oauth-protected-resource"';
    for (const name of ["Authorization", "authorization"]) {
      await withHttp({ status: 401, wwwAuth }, async (server) => {
        const { answer, lines, stderr } = await failure(urlEntry(server, { [name]: "Bearer ZZZhdr" }));
        assert.equal(answer, COULD_NOT);
        assert.deepEqual(lines, [LINE_COULD_NOT]);
        assertNoValue([answer, stderr], server);
      });
    }
  });

  test("nobody listens at the address: could not connect", async () => {
    const entry = { url: `http://127.0.0.1:${await freePort()}/mcp?key=ZZZkey`, headers: { "X-Key": "ZZZhdr" } };
    const { answer, lines, stderr } = await failure(entry);
    assert.equal(answer, COULD_NOT);
    assert.deepEqual(lines, [LINE_COULD_NOT]);
    assert.ok(!`${answer}${stderr}`.includes("ZZZ"));
    assert.ok(!`${answer}${stderr}`.includes(entry.url));
  });

  test("the name of the host is not found: could not connect", async () => {
    const entry = { url: "http://onetool-no-such-host-zzz.invalid/mcp", headers: {} };
    const { answer, lines, stderr } = await failure(entry);
    assert.equal(answer, COULD_NOT);
    assert.deepEqual(lines, [LINE_COULD_NOT]);
    assert.ok(!stderr.includes("no-such-host"));
  });

  test("a redirect to another origin is not followed: could not connect, and the other origin is not reached", async () => {
    await withHttp({}, async (other) => {
      await withHttp({}, async (server) => {
        server.config.redirectTo = `${other.origin}/mcp`;
        const { answer, lines, stderr } = await failure(urlEntry(server, { Authorization: "Bearer ZZZhdr" }));
        assert.equal(answer, COULD_NOT);
        assert.deepEqual(lines, [LINE_COULD_NOT]);
        assertNoValue([answer, stderr], server);
        assert.deepEqual(other.requests, [], "no request, and so no header, reached the other origin");
      });
    });
  });

  test("an answer that is not MCP: could not connect", async () => {
    await withHttp({ notMcp: true }, async (server) => {
      const { answer, lines, stderr } = await failure(urlEntry(server));
      assert.equal(answer, COULD_NOT);
      assert.deepEqual(lines, [LINE_COULD_NOT]);
      assert.ok(!stderr.includes(SECRET_BODY));
    });
  });

  test("a header the HTTP client refuses to send: could not connect, and nothing reaches the server", async () => {
    await withHttp({}, async (server) => {
      for (const headers of [{ "bad name": "x" }, { "X-Key": "a\nb-ZZZ" }]) {
        const { answer, lines, stderr } = await failure(urlEntry(server, headers));
        assert.equal(answer, COULD_NOT);
        assert.deepEqual(lines, [LINE_COULD_NOT]);
        assert.ok(!stderr.includes("ZZZ"));
      }
      assert.deepEqual(server.requests, []);
    });
  });

  test("a JSON-RPC error to initialize, or to the list of tools: refused the connection, and nothing of its text", async () => {
    for (const [what, config] of [["initialize", { initError: true }], ["the list", { listError: true }]]) {
      await withHttp({ ...config, errorText: "error-ZZZerr" }, async (server) => {
        const { answer, lines, stderr } = await failure(urlEntry(server));
        assert.equal(answer, "far: not connected (refused the connection)", what);
        assert.deepEqual(lines, ["onetool: server far: not connected (refused the connection)"], what);
        assertNoValue([answer, stderr], server);
      });
    }
  });

  test("no answer: no answer in <connectSeconds> seconds, and the connection is then closed", async () => {
    for (const config of [{ initHang: true }, { listHang: true }]) {
      await withHttp(config, async (server) => {
        const { answer, lines, stderr } = await failure(urlEntry(server), { connectSeconds: 0.5 });
        assert.equal(answer, "far: not connected (no answer in 0.5 seconds)");
        assert.deepEqual(lines, ["onetool: server far: not connected (no answer in 0.5 seconds)"]);
        assertNoValue([answer, stderr], server);
        await waitFor(() => server.aborted() >= 1, 3000, "the request that was not answered to be given up");
      });
    }
  });

  test("it does not stop the others, and the catalog and the lines are those of a command that fails", async () => {
    await withHttp({ status: 403 }, async (server) => {
      const entry = urlEntry(server);
      const settings = settingsOf(
        { ok: fakeEntry({ tools: ["hello"] }), far: entry, "b.ad": { url: "ftp://host-ZZZ/x" } },
        { timeoutSeconds: 10 },
      );
      await withOnetool(settings, async (ctx) => {
        assert.equal(
          textOf(await ctx.call("search", {})),
          "ok: 1 tools\nfar: not connected (could not connect)\nb.ad: not connected (bad entry: the name holds a dot)",
        );
        assert.equal(okText(await ctx.run("await tools.ok.hello({})")), "called hello");
        assert.equal(okText(await ctx.run("typeof tools.far")), "undefined");
      });
    });
  });

  test("an entry that readSettings puts in bad is told first, with its reason, and never its address", async () => {
    const settings = settingsOf(
      {
        ftp: { url: "ftp://host-ZZZ/x" },
        both: { url: "http://host-ZZZ/x", command: "node" },
        old: { url: "http://host-ZZZ/sse", type: "sse" },
        hdr: { url: "http://host-ZZZ/x", headers: { "X-Key": 5 } },
      },
      {},
    );
    await withOnetool(settings, async (ctx) => {
      assert.equal(
        textOf(await ctx.call("search", {})),
        [
          "ftp: not connected (bad entry: url is not an http address)",
          "both: not connected (bad entry: both command and url)",
          "old: not connected (bad entry: the old SSE transport is not supported)",
          "hdr: not connected (bad entry: headers is not an object of texts)",
        ].join("\n"),
      );
      await waitFor(() => serverLines(ctx).length >= 4, 3000, "the four lines");
      assert.deepEqual(serverLines(ctx), [
        "onetool: server ftp: not connected (bad entry: url is not an http address)",
        "onetool: server both: not connected (bad entry: both command and url)",
        "onetool: server old: not connected (bad entry: the old SSE transport is not supported)",
        "onetool: server hdr: not connected (bad entry: headers is not an object of texts)",
      ]);
      assert.ok(!ctx.stderr().includes("ZZZ"));
    });
  });
});

describe("a call of a tool of a server at an address", () => {
  test("the result is read by toolValue; the arguments reach the server as they are, and none reaches it as {}", async () => {
    await withHttp({}, async (server) => {
      await withOnetool(FAR(server), async (ctx) => {
        assert.equal(okText(await ctx.run("await tools.far.plain({})")), "hello world");
        const code = [
          'await tools.far.rec({ a: 1, b: [2, "x"], c: { d: "é" } });',
          "await tools.far.rec();",
          "return await tools.far.calls({});",
        ].join("\n");
        assert.equal(
          okText(await ctx.run(code)),
          '[{"name":"plain","arguments":{}},{"name":"rec","arguments":{"a":1,"b":[2,"x"],"c":{"d":"é"}}},{"name":"rec","arguments":{}}]',
        );
      });
    });
  });

  test("a JSON-RPC error of the server: <id> failed: <the error's message>", async () => {
    await withHttp({ errorText: "boom" }, async (server) => {
      await withOnetool(FAR(server), async (ctx) => {
        const msg = okText(await ctx.run(CAUGHT("tools.far.rpcerr({})")));
        assert.ok(msg.startsWith("far.rpcerr failed: "), msg);
        assert.ok(msg.includes("boom"), msg);
        assert.notEqual(msg, "far.rpcerr failed: no answer from the server");
      });
    });
  });

  test("the decision comes first and then the arguments: the server is not called", async () => {
    await withHttp({}, async (server) => {
      await withOnetool(FAR(server, undefined, { deny: ["far.rec"] }), async (ctx) => {
        const code = [
          "const out = [];",
          "try { await tools.far.rec({}); } catch (e) { out.push(e.message); }",
          "try { await tools.far.rec(5); } catch (e) { out.push(e.message); }",
          "try { await tools.far.hello([1]); } catch (e) { out.push(e.message); }",
          "try { await tools.far.hello(null); } catch (e) { out.push(e.message); }",
          "return out;",
        ].join("\n");
        assert.equal(
          okText(await ctx.run(code)),
          JSON.stringify([
            'onetool: far.rec is denied by the rule deny "far.rec"',
            'onetool: far.rec is denied by the rule deny "far.rec"',
            "onetool: the arguments of far.hello must be an object",
            "onetool: the arguments of far.hello must be an object",
          ]),
        );
      });
      assert.equal(server.methods().filter((m) => m === "tools/call").length, 0);
    });
  });

  // For each case: how the server stops answering the call (after onetool is connected), and the same for the next call.
  const FAILURES = {
    "an HTTP status that is not a success": async (server) => {
      server.config.callMode = "status";
    },
    "a redirect to another origin": async (server, other) => {
      server.config.callMode = "redirect";
      server.config.redirectTo = `${other.origin}/mcp`;
    },
    "an answer that is not MCP": async (server) => {
      server.config.callMode = "notMcp";
    },
    "nobody listening any more": async (server) => {
      await server.close();
    },
  };
  for (const [what, spoil] of Object.entries(FAILURES)) {
    test(`${what}: exactly <id> failed: no answer from the server, never the message of the error, the address or the text of the server`, async () => {
      await withHttp({}, async (other) => {
        await withHttp({}, async (server) => {
          const entry = { url: `${server.url}?key=ZZZkey`, headers: { "X-Key": "ZZZhdr" } };
          await withOnetool(settingsOf({ far: entry }, { timeoutSeconds: 10 }), async (ctx) => {
            assert.equal(textOf(await ctx.call("search", {})), `far: ${HTTP_TOOLS} tools`);
            await spoil(server, other);
            const message = okText(await ctx.run(CAUGHT("tools.far.hello({})")));
            assert.equal(message, "far.hello failed: no answer from the server");
            const uncaught = await ctx.run("await tools.far.hello({})");
            assert.equal(uncaught.isError, true);
            assert.equal(textOf(uncaught), "The program failed: Error: far.hello failed: no answer from the server");
            // it is still connected as far as search and the program are concerned
            assert.equal(textOf(await ctx.call("search", {})), `far: ${HTTP_TOOLS} tools`);
            assert.equal(okText(await ctx.run("typeof tools.far.hello")), "function");
            const again = okText(await ctx.run(CAUGHT("tools.far.plain({})")));
            assert.ok(!again.includes("not connected"), again);
            assertNoValue([message, uncaught.content[0].text, again, ctx.stderr()], server);
            assert.ok(!`${message}${again}${ctx.stderr()}`.includes(SECRET_BODY));
          });
          assert.deepEqual(other.requests, [], "the other origin was not reached");
        });
      });
    });
  }

  test("onetool does not connect a second time, and a later call is tried again on the same connection", async () => {
    await withHttp({}, async (server) => {
      await withOnetool(FAR(server), async (ctx) => {
        assert.equal(textOf(await ctx.call("search", {})), `far: ${HTTP_TOOLS} tools`);
        server.config.callMode = "status";
        const sent = () => server.methods().filter((m) => m === "tools/call").length;
        const first = okText(await ctx.run(CAUGHT("tools.far.hello({})")));
        assert.equal(first, "far.hello failed: no answer from the server");
        const after = sent();
        assert.equal(okText(await ctx.run(CAUGHT("tools.far.hello({})"))), "far.hello failed: no answer from the server");
        assert.equal(sent(), after + 1, "the second call was tried");
        assert.equal(textOf(await ctx.call("search", {})), `far: ${HTTP_TOOLS} tools`);
        const count = (method) => server.methods().filter((m) => m === method).length;
        assert.equal(count("initialize"), 1);
        assert.equal(count("tools/list"), 1);
      });
    });
  });

  test("a tool that never answers: the program is stopped at timeoutSeconds, for a command and for an address", async () => {
    await withHttp({}, async (server) => {
      const settings = settingsOf({ fake: fakeEntry(), far: urlEntry(server) }, { timeoutSeconds: 2 });
      await withOnetool(settings, async (ctx) => {
        for (const code of ["await tools.far.hang({})", "await tools.fake.barrier({})"]) {
          const res = await ctx.run(code);
          assert.equal(res.isError, true, code);
          assert.equal(textOf(res), "The program was stopped after 2 seconds.", code);
        }
        assert.equal(okText(await ctx.run("await tools.far.hello({})")), "called hello");
      });
    });
  });

  test("no value of the settings file reaches an answer or standard error", async () => {
    await withHttp({}, async (server) => {
      const entry = { url: `${server.url}?key=ZZZkey`, headers: { "X-Key": "ZZZhdr", Authorization: "Bearer ZZZtoken" } };
      await withOnetool(settingsOf({ far: entry }, { timeoutSeconds: 10, deny: ["far.rec"] }), async (ctx) => {
        const listed = textOf(await ctx.call("search", {}));
        assert.equal(listed, `far: ${HTTP_TOOLS - 1} tools`, "it is connected");
        const texts = [
          listed,
          textOf(await ctx.call("search", { words: "rec" })),
          textOf(await ctx.run("await tools.far.hello({})")),
          textOf(await ctx.run("await tools.far.rec({})")),
          textOf(await ctx.run("await tools.far.rpcerr({})")),
        ];
        server.config.callMode = "notMcp";
        texts.push(textOf(await ctx.run("await tools.far.hello({})")));
        for (const text of texts) assert.ok(!text.includes("ZZZ"), text);
        assert.ok(!ctx.stderr().includes("ZZZ"));
        assert.ok(!ctx.stderr().includes(server.url));
        assert.ok(!ctx.stderr().includes(`127.0.0.1:${server.port}`));
      });
    });
  });
});

describe("the end, with a server at an address", () => {
  const ENDS = {
    "standard input closes": (raw) => {
      raw.child.stdin.end();
      return raw.within(5000);
    },
    SIGINT: (raw) => raw.endBy("SIGINT", 5000),
    SIGTERM: (raw) => raw.endBy("SIGTERM", 5000),
  };
  const GONE = { code: 0, signal: null };

  for (const [how, end] of Object.entries(ENDS)) {
    for (const stream of [false, true]) {
      test(`${how}, connected${stream ? " (the server keeps a stream open)" : ""}: exit code 0 within 5 seconds, and the processes of the commands end`, async () => {
        await withHttp({ stream }, async (server) => {
          const settings = settingsOf({ far: urlEntry(server), fake: fakeEntry() }, { timeoutSeconds: 60 });
          await withRaw(settings, async (raw) => {
            await raw.initialize();
            const res = await raw.callTool("search", {});
            assert.equal(res.result.content[0].text, `far: ${HTTP_TOOLS} tools\nfake: ${FAKE_TOOL_COUNT} tools`);
            const started = childrenOf(raw.child.pid);
            assert.ok(started.length >= 1, "the command server runs");
            assert.deepEqual(await end(raw), GONE);
            await waitFor(() => started.every((pid) => !alive(pid)), 4000, "the processes onetool started to end");
          });
        });
      });
    }

    test(`${how}, the server at an address no longer answers anything: exit code 0 within 5 seconds`, async () => {
      await withHttp({ stream: true }, async (server) => {
        await withRaw(FAR(server, undefined, { timeoutSeconds: 60 }), async (raw) => {
          await raw.initialize();
          assert.equal((await raw.callTool("search", {})).result.content[0].text, `far: ${HTTP_TOOLS} tools`);
          server.config.hangAll = true;
          assert.deepEqual(await end(raw), GONE);
        });
      });
    });

    test(`${how}, while the server at an address is being connected: exit code 0 within 5 seconds`, async () => {
      for (const config of [{ listHang: true }, { initHang: true }, { hangAll: true }]) {
        await withHttp(config, async (server) => {
          await withRaw(FAR(server, undefined, { connectSeconds: 30 }), async (raw) => {
            await raw.initialize();
            await waitFor(() => server.requests.length >= 1, 3000, "the connection to begin");
            assert.deepEqual(await end(raw), GONE);
          });
        });
      }
    });

    test(`${how}, a program waits for a tool of the server at an address: exit code 0 within 5 seconds`, async () => {
      await withHttp({ stream: true }, async (server) => {
        await withRaw(FAR(server, undefined, { timeoutSeconds: 60 }), async (raw) => {
          await raw.initialize();
          raw.send({ id: 900, method: "tools/call", params: { name: "run", arguments: { code: "await tools.far.hang({})" } } });
          await waitFor(() => server.recorded.some((r) => r.name === "hang"), 5000, "the program to call the tool");
          const started = childrenOf(raw.child.pid);
          assert.ok(started.length >= 1, "the process of the program runs");
          assert.deepEqual(await end(raw), GONE);
          await waitFor(() => started.every((pid) => !alive(pid)), 4000, "the program's process to end");
        });
      });
    });
  }

  test("a second signal while it is ending: the process is gone within 5 seconds", async () => {
    await withHttp({ stream: true }, async (server) => {
      await withRaw(FAR(server, undefined, { timeoutSeconds: 60 }), async (raw) => {
        await raw.initialize();
        assert.equal((await raw.callTool("search", {})).result.content[0].text, `far: ${HTTP_TOOLS} tools`);
        server.config.hangAll = true;
        raw.child.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 30));
        raw.child.kill("SIGTERM");
        await raw.within(5000);
      });
    });
  });
});
