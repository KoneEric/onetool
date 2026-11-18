import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { settingsOf, faultOf } from "./helpers.js";

const withServer = (entry) => ({ mcpServers: { s: entry } });
const reasonOf = (entry) => {
  const got = settingsOf(withServer(entry));
  assert.equal(got.servers.length, 0, JSON.stringify(entry));
  assert.equal(got.bad.length, 1, JSON.stringify(entry));
  assert.equal(got.bad[0].name, "s");
  return got.bad[0].reason;
};
const usableOf = (entry) => {
  const got = settingsOf(withServer(entry));
  assert.deepEqual(got.bad, [], JSON.stringify(entry));
  assert.equal(got.servers.length, 1, JSON.stringify(entry));
  return got.servers[0];
};

const OK = "http://localhost:1/mcp";

describe("step 2: entries reached at an address, usable", () => {
  test("{ name, url, headers }, headers {} when absent, and only those keys", () => {
    assert.deepEqual(usableOf({ url: OK }), { name: "s", url: OK, headers: {} });
    assert.deepEqual(Object.keys(usableOf({ url: OK })).sort(), ["headers", "name", "url"]);
  });

  test("http and https are both addresses", () => {
    assert.equal(usableOf({ url: "https://example.com/mcp" }).url, "https://example.com/mcp");
    assert.equal(usableOf({ url: "http://127.0.0.1:8080" }).url, "http://127.0.0.1:8080");
  });

  test("url is kept as written, not rewritten by the URL parser", () => {
    for (const url of ["http://localhost:1", "HTTP://LocalHost:80/a/../b?x=1#frag", "https://example.com:443/a b"]) {
      assert.equal(usableOf({ url }).url, url);
    }
  });

  test("headers are kept as written; an empty value is valid", () => {
    const headers = { Authorization: "Bearer x", "X-Empty": "", "x-lower": " padded " };
    assert.deepEqual(usableOf({ url: OK, headers }).headers, headers);
    assert.deepEqual(usableOf({ url: OK, headers: {} }).headers, {});
  });

  test("header names are not tested", () => {
    assert.deepEqual(usableOf({ url: OK, headers: { "": "a", "a b": "c" } }).headers, { "": "a", "a b": "c" });
  });

  test("args, env and every other key are ignored on an entry with url", () => {
    const got = usableOf({ url: OK, args: "x", env: 5, cwd: "/x", disabled: true, other: [1] });
    assert.deepEqual(got, { name: "s", url: OK, headers: {} });
  });

  test("type is ignored with any value but `sse`", () => {
    for (const type of ["http", "streamable-http", 5, null, "SSE", "Sse", "", ["sse"], {}, true]) {
      assert.deepEqual(usableOf({ type, url: OK }), { name: "s", url: OK, headers: {} }, JSON.stringify(type));
    }
  });

  test("on an entry with no url, type (sse included) and headers are ignored", () => {
    assert.deepEqual(usableOf({ command: "node", type: "sse" }), { name: "s", command: "node", args: [], env: {} });
    assert.deepEqual(usableOf({ command: "node", headers: 5 }), { name: "s", command: "node", args: [], env: {} });
    assert.deepEqual(usableOf({ command: "node", headers: null, type: "sse" }), { name: "s", command: "node", args: [], env: {} });
  });

  test("an entry with command gives exactly { name, command, args, env }; `url` tells the kinds apart", () => {
    const got = settingsOf({ mcpServers: { a: { command: "node" }, b: { url: OK } } }).servers;
    assert.equal(Object.hasOwn(got[0], "url"), false);
    assert.equal(Object.hasOwn(got[1], "url"), true);
    assert.deepEqual(Object.keys(got[0]).sort(), ["args", "command", "env", "name"]);
    assert.deepEqual(Object.keys(got[1]).sort(), ["headers", "name", "url"]);
  });

  test("servers and bad keep the order of the file, the two kinds mixed", () => {
    const got = settingsOf({
      mcpServers: {
        a: { command: "x" },
        b: { url: OK },
        "c.d": { url: OK },
        e: { url: "ftp://h" },
        f: { command: "y" },
        g: { url: OK, headers: { H: "v" } },
        h: { command: "z", url: OK },
      },
    });
    assert.deepEqual(got.servers, [
      { name: "a", command: "x", args: [], env: {} },
      { name: "b", url: OK, headers: {} },
      { name: "f", command: "y", args: [], env: {} },
      { name: "g", url: OK, headers: { H: "v" } },
    ]);
    assert.deepEqual(got.bad, [
      { name: "c.d", reason: "the name holds a dot" },
      { name: "e", reason: "url is not an http address" },
      { name: "h", reason: "both command and url" },
    ]);
  });
});

describe("step 2: entries reached at an address, bad", () => {
  test("both command and url (4)", () => {
    assert.equal(reasonOf({ command: "node", url: OK }), "both command and url");
    assert.equal(reasonOf({ command: "", url: "" }), "both command and url");
    assert.equal(reasonOf({ command: 5, url: 5, type: "sse", headers: 5 }), "both command and url");
  });

  test("an entry has a key whatever its value, null included", () => {
    assert.equal(reasonOf({ command: "node", url: null }), "both command and url");
    assert.equal(reasonOf({ command: null, url: OK }), "both command and url");
    assert.equal(reasonOf({ command: null, url: null }), "both command and url");
  });

  test("url is not an http address (5a)", () => {
    for (const url of [null, 5, [], [OK], {}, true, "", " ", "ftp://host/x", "host:80/mcp", "localhost:80/mcp", "file:///x", "ws://h/mcp", "/mcp", "not a url", "mailto:a@b.c"]) {
      assert.equal(reasonOf({ url }), "url is not an http address", JSON.stringify(url));
    }
  });

  test("the old SSE transport is not supported (5b): type exactly `sse`", () => {
    assert.equal(reasonOf({ type: "sse", url: OK }), "the old SSE transport is not supported");
    assert.equal(reasonOf({ type: "sse", url: OK, headers: { A: "b" } }), "the old SSE transport is not supported");
  });

  test("headers is not an object of texts (5c)", () => {
    for (const headers of [[], ["a"], null, "a", 5, true, { A: 1 }, { A: null }, { A: "x", B: 2 }, { A: ["x"] }, { A: {} }, { A: true }]) {
      assert.equal(reasonOf({ url: OK, headers }), "headers is not an object of texts", JSON.stringify(headers));
    }
  });

  test("no command and no url: `no command` (6)", () => {
    assert.equal(reasonOf({}), "no command");
    assert.equal(reasonOf({ headers: { A: "b" }, type: "http" }), "no command");
    assert.equal(reasonOf({ args: [], env: {} }), "no command");
  });

  test("the tests run in order: name, object, both, 5a, 5b, 5c", () => {
    assert.deepEqual(settingsOf({ mcpServers: { "a.b": { command: "x", url: OK } } }).bad, [{ name: "a.b", reason: "the name holds a dot" }]);
    assert.deepEqual(settingsOf({ mcpServers: { "": { url: "x" } } }).bad, [{ name: "", reason: "the name is empty" }]);
    assert.equal(reasonOf(null), "not an object");
    assert.equal(reasonOf({ command: "x", url: "ftp://h", type: "sse", headers: 5 }), "both command and url");
    assert.equal(reasonOf({ url: "ftp://h", type: "sse", headers: 5 }), "url is not an http address");
    assert.equal(reasonOf({ url: OK, type: "sse", headers: 5 }), "the old SSE transport is not supported");
    assert.equal(reasonOf({ url: OK, type: "http", headers: 5, args: "x" }), "headers is not an object of texts");
  });

  test("no reason holds the address or a header", () => {
    const got = settingsOf({
      mcpServers: {
        a: { url: "ftp://SECRET-host/SECRET-path" },
        b: { url: "http://SECRET-host/x", type: "sse" },
        c: { url: "http://SECRET-host/x", headers: { Authorization: "SECRET-token", N: 1 } },
        d: { url: "http://SECRET-host/x", command: "SECRET-cmd" },
        e: { url: "SECRET-host:80/mcp", headers: { "SECRET-name": "SECRET-value" } },
      },
    });
    assert.equal(got.bad.length, 5);
    for (const b of got.bad) assert.ok(!b.reason.includes("SECRET"), b.reason);
  });
});

describe("step 2: stateLimit", () => {
  const one = (value) => settingsOf({ mcpServers: {}, onetool: { stateLimit: value } }).stateLimit;
  const problemsOf = (onetool) => faultOf({ mcpServers: {}, onetool }).problems;
  const MSG = "onetool.stateLimit: must be a whole number from 1000 to 100000000";

  test("the default is 10000000, and readSettings returns the key", () => {
    const got = settingsOf({ mcpServers: {} });
    assert.equal(got.stateLimit, 10000000);
    assert.ok(Object.hasOwn(got, "stateLimit"));
    assert.equal(settingsOf({ mcpServers: {}, onetool: {} }).stateLimit, 10000000);
  });

  test("whole numbers from 1000 to 100000000, both included", () => {
    for (const v of [1000, 1001, 5000, 10000000, 99999999, 100000000]) assert.equal(one(v), v);
  });

  test("the other keys keep their value when stateLimit is given", () => {
    const got = settingsOf({ mcpServers: {}, onetool: { stateLimit: 2000, searchLimit: 3 } });
    assert.equal(got.stateLimit, 2000);
    assert.equal(got.searchLimit, 3);
    assert.equal(got.answerLimit, 8000);
  });

  test("not valid: the problem", () => {
    for (const v of [999, 0, -1000, 100000001, 1500.5, "5000", true, false, null, [], {}, [1000]]) {
      assert.deepEqual(problemsOf({ stateLimit: v }), [MSG], JSON.stringify(v));
    }
  });

  test("its problem comes after the one of searchLimit and before the one of allow", () => {
    assert.deepEqual(problemsOf({ allow: 5, stateLimit: 0, searchLimit: 0, deny: 5, answerLimit: 0 }), [
      "onetool.answerLimit: must be a whole number from 100 to 1000000",
      "onetool.searchLimit: must be a whole number from 1 to 100",
      MSG,
      "onetool.allow: must be a list of patterns",
      "onetool.deny: must be a list of patterns",
    ]);
  });

  test("`state` stays an unknown key", () => {
    assert.deepEqual(problemsOf({ state: 1 }), ["onetool.state: unknown key"]);
  });

  test("the problem holds no value of the file", () => {
    const [p] = problemsOf({ stateLimit: "SECRET-1" });
    assert.ok(!p.includes("SECRET"));
  });
});

describe("step 2: null in the settings file", () => {
  const problemsOf = (file) => faultOf(file).problems;

  test("mcpServers null, a list, a string, a number, true", () => {
    for (const v of [null, [], ["a"], "x", 5, true, false, 0]) {
      assert.deepEqual(problemsOf({ mcpServers: v }), ["mcpServers: not an object"], JSON.stringify(v));
    }
  });

  test("onetool null, a list, a string, a number, true", () => {
    for (const v of [null, [], ["a"], "x", 5, true, false, 0]) {
      assert.deepEqual(problemsOf({ mcpServers: {}, onetool: v }), ["onetool: not an object"], JSON.stringify(v));
    }
  });

  test("a key of onetool holding null is present and not valid: its own problem", () => {
    const table = {
      answerLimit: "onetool.answerLimit: must be a whole number from 100 to 1000000",
      timeoutSeconds: "onetool.timeoutSeconds: must be a number above 0, at most 3600",
      connectSeconds: "onetool.connectSeconds: must be a number above 0, at most 600",
      searchLimit: "onetool.searchLimit: must be a whole number from 1 to 100",
      stateLimit: "onetool.stateLimit: must be a whole number from 1000 to 100000000",
      allow: "onetool.allow: must be a list of patterns",
      deny: "onetool.deny: must be a list of patterns",
    };
    for (const [key, problem] of Object.entries(table)) {
      assert.deepEqual(problemsOf({ mcpServers: {}, onetool: { [key]: null } }), [problem], key);
    }
  });

  test("allow or deny with an item that is not a pattern", () => {
    for (const key of ["allow", "deny"]) {
      for (const item of [null, 5, "", "a b", " ", ["a"], true, {}]) {
        assert.deepEqual(
          problemsOf({ mcpServers: {}, onetool: { [key]: ["ok.*", item] } }),
          [`onetool.${key}: must be a list of patterns`],
          `${key} ${JSON.stringify(item)}`,
        );
      }
    }
  });

  const withServer = (entry) => ({ mcpServers: { s: entry } });
  const reasonOf = (entry) => {
    const got = settingsOf(withServer(entry));
    assert.equal(got.servers.length, 0, JSON.stringify(entry));
    assert.deepEqual(got.bad.map((b) => b.name), ["s"]);
    return got.bad[0].reason;
  };

  test("an entry that is null: bad, not an object", () => {
    assert.equal(reasonOf(null), "not an object");
    const got = settingsOf({ mcpServers: { a: null, b: { command: "x" } } });
    assert.deepEqual(got.bad, [{ name: "a", reason: "not an object" }]);
    assert.equal(got.servers.length, 1);
  });

  test('"command": null on an entry with no url: bad, no command', () => {
    assert.equal(reasonOf({ command: null }), "no command");
    assert.equal(reasonOf({ command: null, args: ["a"] }), "no command");
  });

  test("args, env, headers null: the entry has the key, so bad with the reason of that key", () => {
    assert.equal(reasonOf({ command: "node", args: null }), "args is not a list of texts");
    assert.equal(reasonOf({ command: "node", env: null }), "env is not an object of texts");
    assert.equal(reasonOf({ url: "http://localhost:1/mcp", headers: null }), "headers is not an object of texts");
  });

  test("null as an item of args, a value of env or of headers", () => {
    assert.equal(reasonOf({ command: "node", args: [null] }), "args is not a list of texts");
    assert.equal(reasonOf({ command: "node", args: ["a", null] }), "args is not a list of texts");
    assert.equal(reasonOf({ command: "node", env: { A: null } }), "env is not an object of texts");
    assert.equal(reasonOf({ command: "node", env: { A: "x", B: null } }), "env is not an object of texts");
    assert.equal(reasonOf({ url: "http://localhost:1/mcp", headers: { A: null } }), "headers is not an object of texts");
  });

  test("url null, a number, a list, empty, ftp, a bare host and port", () => {
    for (const url of [null, 5, [], [], "", "ftp://host/x", "host:80/mcp"]) {
      assert.equal(reasonOf({ url }), "url is not an http address", JSON.stringify(url));
    }
  });
});
