import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as core from "../src/index.js";
import { settingsOf, deepFreeze, printedBy } from "./helpers.js";

// A function not built yet must fail a test with an assertion, never pass one that expects a TypeError.
const keptTools = (...args) => {
  assert.equal(typeof core.keptTools, "function", "keptTools is not exported");
  return core.keptTools(...args);
};

const OK = "http://localhost:1/mcp";
const TOOLS_REASON = "tools is not a list of tool names";
const withServer = (entry, name = "s") => ({ mcpServers: { [name]: entry } });
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
const oauthReason = (oauth, extra = {}) => reasonOf({ url: OK, oauth, ...extra });

const BAD_TOOLS = [
  null,
  "Bash",
  "",
  5,
  0,
  true,
  false,
  {},
  { 0: "Bash" },
  [""],
  ["  "],
  [" \t\n "],
  [null],
  [5],
  [["Bash"]],
  [{}],
  [true],
  ["Bash", ""],
  ["Bash", null],
  ["Bash", 5],
  ["Bash", ["Read"]],
];

describe("step 11: tools, usable", () => {
  test("a command entry with tools gives { name, command, args, env, tools }", () => {
    const got = usableOf({ command: "claude", args: ["mcp", "serve"], tools: ["Bash", "Read"] });
    assert.deepEqual(got, { name: "s", command: "claude", args: ["mcp", "serve"], env: {}, tools: ["Bash", "Read"] });
    assert.deepEqual(Object.keys(got).sort(), ["args", "command", "env", "name", "tools"]);
  });

  test("an entry with url and tools gives { name, url, headers, tools }", () => {
    const got = usableOf({ url: OK, tools: ["a"] });
    assert.deepEqual(got, { name: "s", url: OK, headers: {}, tools: ["a"] });
    assert.deepEqual(Object.keys(got).sort(), ["headers", "name", "tools", "url"]);
  });

  test("an entry with url, oauth and tools gives { name, url, headers, oauth, tools }", () => {
    const got = usableOf({ url: OK, headers: { "X-Org": "a" }, oauth: { clientId: "c", port: 8765 }, tools: ["a", "b"] });
    assert.deepEqual(got, {
      name: "s",
      url: OK,
      headers: { "X-Org": "a" },
      oauth: { clientId: "c", port: 8765 },
      tools: ["a", "b"],
    });
    assert.deepEqual(Object.keys(got).sort(), ["headers", "name", "oauth", "tools", "url"]);
  });

  test("an entry with no tools has no key tools, of either kind, with or without oauth", () => {
    assert.deepEqual(usableOf({ command: "node" }), { name: "s", command: "node", args: [], env: {} });
    assert.deepEqual(usableOf({ url: OK }), { name: "s", url: OK, headers: {} });
    assert.deepEqual(usableOf({ url: OK, oauth: { clientId: "a" } }), { name: "s", url: OK, headers: {}, oauth: { clientId: "a" } });
    for (const entry of [{ command: "node" }, { url: OK }, { url: OK, oauth: { clientId: "a" } }]) {
      assert.equal(Object.hasOwn(usableOf(entry), "tools"), false, JSON.stringify(entry));
    }
    for (const entry of [{ command: "node", tools: [] }, { url: OK, tools: [] }]) {
      assert.equal(Object.hasOwn(usableOf(entry), "tools"), true, JSON.stringify(entry));
    }
  });

  test("an empty list is valid and is kept: the server keeps no tool", () => {
    assert.deepEqual(usableOf({ command: "node", tools: [] }).tools, []);
    assert.deepEqual(usableOf({ url: OK, tools: [] }).tools, []);
  });

  test("the names are kept as written: order, case, spaces, dots, non-ASCII, a name twice", () => {
    const tools = ["Zed", "alpha", "Alpha", " padded ", "a b", "a.b", "日本語", "Ünï", "alpha", "x\ty"];
    assert.deepEqual(usableOf({ command: "node", tools }).tools, tools);
    assert.deepEqual(usableOf({ url: OK, tools }).tools, tools);
  });

  test("tools sits beside the other keys and does not change them", () => {
    const entry = { command: "node", args: ["a", ""], env: { K: "" }, tools: ["x"] };
    assert.deepEqual(usableOf(entry), { name: "s", command: "node", args: ["a", ""], env: { K: "" }, tools: ["x"] });
  });

  test("on each kind, args, env, headers and other keys are still ignored as before", () => {
    assert.deepEqual(usableOf({ url: OK, args: "x", env: 5, cwd: "/data/x", tools: ["a"] }), { name: "s", url: OK, headers: {}, tools: ["a"] });
    assert.deepEqual(usableOf({ command: "node", headers: 5, type: "sse", tools: ["a"] }), {
      name: "s",
      command: "node",
      args: [],
      env: {},
      tools: ["a"],
    });
  });

  test("the entries of a file keep their order, with and without tools mixed", () => {
    const got = settingsOf({
      mcpServers: {
        a: { command: "x", tools: ["t"] },
        b: { url: OK },
        c: { url: OK, tools: [] },
        d: { command: "x" },
      },
    });
    assert.deepEqual(got.bad, []);
    assert.deepEqual(got.servers, [
      { name: "a", command: "x", args: [], env: {}, tools: ["t"] },
      { name: "b", url: OK, headers: {} },
      { name: "c", url: OK, headers: {}, tools: [] },
      { name: "d", command: "x", args: [], env: {} },
    ]);
  });

  test("the example of the meeting point", () => {
    const tools = ["Bash", "Read", "Edit", "Write", "Grep", "Glob"];
    const got = settingsOf({ mcpServers: { claude: { command: "claude", args: ["mcp", "serve"], tools } } });
    assert.deepEqual(got.bad, []);
    assert.deepEqual(got.servers, [{ name: "claude", command: "claude", args: ["mcp", "serve"], env: {}, tools }]);
  });

  test("servers named init and claude are servers like any other", () => {
    const got = settingsOf({ mcpServers: { init: { command: "node" }, claude: { url: OK } } });
    assert.deepEqual(got.bad, []);
    assert.deepEqual(got.servers.map((s) => s.name), ["init", "claude"]);
  });

  test("the file returns the same keys as without tools; the default of trail stays true", () => {
    const plain = Object.keys(settingsOf({ mcpServers: {} })).sort();
    const got = settingsOf(withServer({ command: "node", tools: ["a"] }));
    assert.deepEqual(Object.keys(got).sort(), plain);
    assert.equal(got.trail, true);
  });
});

describe("step 11: tools, bad (test 9)", () => {
  test("on a command entry, tools that is not a list of names", () => {
    for (const tools of BAD_TOOLS) {
      assert.equal(reasonOf({ command: "node", tools }), TOOLS_REASON, JSON.stringify(tools));
    }
  });

  test("on an entry with url, tools that is not a list of names", () => {
    for (const tools of BAD_TOOLS) {
      assert.equal(reasonOf({ url: OK, tools }), TOOLS_REASON, JSON.stringify(tools));
      assert.equal(reasonOf({ url: OK, oauth: { clientId: "a" }, tools }), TOOLS_REASON, JSON.stringify(tools));
    }
  });

  test("the entry has tools whatever its value, null included", () => {
    assert.equal(reasonOf({ command: "node", tools: null }), TOOLS_REASON);
    assert.equal(reasonOf({ url: OK, tools: null }), TOOLS_REASON);
  });

  test("the reason is that text alone: it holds no value of the file", () => {
    assert.equal(reasonOf({ command: "node", tools: ["secret-name", ""] }), TOOLS_REASON);
    assert.equal(reasonOf({ url: OK, tools: "secret-name" }), TOOLS_REASON);
  });

  test("the earlier tests of an entry come first, command kind", () => {
    const bad = ["", null];
    const got = (name, entry) => {
      const r = settingsOf({ mcpServers: { [name]: entry } });
      assert.equal(r.servers.length, 0);
      assert.equal(r.bad.length, 1);
      return r.bad[0].reason;
    };
    assert.equal(got(" ", { command: "node", tools: bad }), "the name is empty");
    assert.equal(got("a.b", { command: "node", tools: bad }), "the name holds a dot");
    assert.equal(got("s", { tools: bad }), "no command");
    assert.equal(got("s", { command: "", tools: bad }), "no command");
    assert.equal(got("s", { command: "node", args: [1], env: { K: 1 }, tools: bad }), "args is not a list of texts");
    assert.equal(got("s", { command: "node", env: { K: 1 }, tools: bad }), "env is not an object of texts");
    assert.equal(got("s", { command: "node", tools: bad }), TOOLS_REASON);
  });

  test("the earlier tests of an entry come first, url kind", () => {
    const bad = ["", null];
    assert.equal(reasonOf({ command: "node", url: OK, tools: bad }), "both command and url");
    assert.equal(reasonOf({ url: "ftp://h/x", tools: bad }), "url is not an http address");
    assert.equal(reasonOf({ url: OK, type: "sse", tools: bad }), "the old SSE transport is not supported");
    assert.equal(reasonOf({ url: OK, headers: null, oauth: { clientId: "" }, tools: bad }), "headers is not an object of texts");
    assert.equal(reasonOf({ url: OK, oauth: { clientId: "" }, tools: bad }), "oauth has no clientId");
    assert.equal(reasonOf({ url: OK, oauth: { clientId: "a", port: 0 }, tools: bad }), "oauth.port is not a port");
    assert.equal(
      reasonOf({ url: OK, headers: { Authorization: "x" }, oauth: { clientId: "a" }, tools: bad }),
      "both oauth and an Authorization header",
    );
    assert.equal(reasonOf({ url: OK, headers: { Authorization: "x" }, tools: bad }), TOOLS_REASON);
  });

  test("an entry that is not an object is not an object, whatever tools is", () => {
    for (const entry of [null, [], ["a"], "a", 5]) {
      assert.equal(reasonOf(entry), "not an object", JSON.stringify(entry));
    }
  });

  test("a bad entry does not affect the others", () => {
    const got = settingsOf({ mcpServers: { a: { command: "x", tools: ["t"] }, b: { command: "x", tools: [""] }, c: { url: OK, tools: [] } } });
    assert.deepEqual(got.bad, [{ name: "b", reason: TOOLS_REASON }]);
    assert.deepEqual(got.servers.map((s) => s.name), ["a", "c"]);
  });
});

describe("step 11: oauth.redirectHost", () => {
  test("127.0.0.1 and localhost are valid and kept as written", () => {
    for (const redirectHost of ["127.0.0.1", "localhost"]) {
      assert.deepEqual(usableOf({ url: OK, oauth: { clientId: "a", redirectHost } }), {
        name: "s",
        url: OK,
        headers: {},
        oauth: { clientId: "a", redirectHost },
      });
    }
  });

  test("with every other key of oauth, as written", () => {
    const oauth = { clientId: "abc", clientSecret: "sh", scopes: ["read", "write:all"], port: 8765, redirectHost: "localhost" };
    assert.deepEqual(usableOf({ url: OK, oauth }).oauth, oauth);
    assert.deepEqual(Object.keys(usableOf({ url: OK, oauth }).oauth).sort(), ["clientId", "clientSecret", "port", "redirectHost", "scopes"]);
  });

  test("oauth holds redirectHost only when the file has it", () => {
    assert.deepEqual(Object.keys(usableOf({ url: OK, oauth: { clientId: "a", port: 1 } }).oauth).sort(), ["clientId", "port"]);
    assert.equal(Object.hasOwn(usableOf({ url: OK, oauth: { clientId: "a" } }).oauth, "redirectHost"), false);
  });

  test("redirectHost with tools on the entry", () => {
    assert.deepEqual(usableOf({ url: OK, oauth: { clientId: "a", redirectHost: "127.0.0.1" }, tools: ["t"] }), {
      name: "s",
      url: OK,
      headers: {},
      oauth: { clientId: "a", redirectHost: "127.0.0.1" },
      tools: ["t"],
    });
  });

  test("any other value gives the reason, and the entry is in bad", () => {
    const why = "oauth.redirectHost is not 127.0.0.1 or localhost";
    const values = [null, 5, 127, true, false, [], ["localhost"], {}, "", " ", "LOCALHOST", "Localhost", " localhost", "localhost ", "::1", "[::1]", "example.com", "127.0.0.1:80", "127.0.0.2", "0.0.0.0", "localhost\n", "127.0.0.1 "];
    for (const redirectHost of values) {
      assert.equal(oauthReason({ clientId: "a", redirectHost }), why, JSON.stringify(redirectHost));
    }
  });

  test("redirectHost is spelled with an upper-case H: other spellings are unknown keys", () => {
    for (const key of ["redirecthost", "redirect_host", "RedirectHost", "redirectHOST", "redirect-host"]) {
      assert.equal(oauthReason({ clientId: "a", [key]: "localhost" }), "oauth has an unknown key", key);
    }
  });

  test("the line comes after port and before the unknown key", () => {
    const why = "oauth.redirectHost is not 127.0.0.1 or localhost";
    assert.equal(oauthReason({ clientSecret: "", redirectHost: "x", x: 1 }), "oauth has no clientId");
    assert.equal(oauthReason({ clientId: "a", clientSecret: "", redirectHost: "x", x: 1 }), "oauth.clientSecret is not a text");
    assert.equal(oauthReason({ clientId: "a", scopes: 5, redirectHost: "x", x: 1 }), "oauth.scopes is not a list of words");
    assert.equal(oauthReason({ clientId: "a", port: 0, redirectHost: "x", x: 1 }), "oauth.port is not a port");
    assert.equal(oauthReason({ clientId: "a", port: 80, redirectHost: "x", x: 1 }), why);
    assert.equal(oauthReason({ clientId: "a", redirectHost: "x", x: 1 }), why);
    assert.equal(oauthReason({ clientId: "a", redirectHost: "localhost", x: 1 }), "oauth has an unknown key");
  });

  test("oauth has the key whatever its value, null included", () => {
    assert.equal(oauthReason({ clientId: "a", redirectHost: null }), "oauth.redirectHost is not 127.0.0.1 or localhost");
  });

  test("the entry tests before oauth still come first", () => {
    assert.equal(reasonOf({ url: OK, headers: null, oauth: { clientId: "a", redirectHost: "x" } }), "headers is not an object of texts");
    assert.equal(
      reasonOf({ url: OK, headers: { authorization: "x" }, oauth: { clientId: "a", redirectHost: "localhost" } }),
      "both oauth and an Authorization header",
    );
  });

  test("on an entry started by a command, oauth is still ignored", () => {
    assert.deepEqual(usableOf({ command: "node", oauth: { clientId: "a", redirectHost: "x" } }), { name: "s", command: "node", args: [], env: {} });
  });

  test("the reason holds no value of the file beyond its own fixed text", () => {
    const why = "oauth.redirectHost is not 127.0.0.1 or localhost";
    assert.equal(oauthReason({ clientId: "a", redirectHost: "secret.example" }), why);
  });
});

describe("step 11: keptTools(tools, keep)", () => {
  const agent = { name: "Agent", description: "a" };
  const bash = { name: "Bash", description: "b" };
  const read = { name: "Read" };

  test("the example of the meeting point", () => {
    const got = keptTools([agent, bash, read], ["Read", "Bash", "Glob"]);
    assert.deepEqual(got, [bash, read]);
    assert.equal(got[0], bash);
    assert.equal(got[1], read);
  });

  test("keep undefined: a new list with every item, in order", () => {
    const tools = [agent, bash, read];
    const got = keptTools(tools, undefined);
    assert.ok(Array.isArray(got));
    assert.notEqual(got, tools);
    assert.deepEqual(got, [agent, bash, read]);
    const omitted = keptTools(tools);
    assert.notEqual(omitted, tools);
    assert.deepEqual(omitted, [agent, bash, read]);
    assert.deepEqual(keptTools([], undefined), []);
  });

  test("a new list also when everything is kept", () => {
    const tools = [agent, bash];
    const got = keptTools(tools, ["Agent", "Bash"]);
    assert.notEqual(got, tools);
    assert.deepEqual(got, [agent, bash]);
    assert.equal(got[0], agent);
    assert.equal(got[1], bash);
  });

  test("the order is that of tools, not that of keep", () => {
    assert.deepEqual(keptTools([agent, bash, read], ["Read", "Agent"]).map((t) => t.name), ["Agent", "Read"]);
    assert.deepEqual(keptTools([read, bash, agent], ["Agent", "Bash", "Read"]).map((t) => t.name), ["Read", "Bash", "Agent"]);
  });

  test("each item is the same object as given", () => {
    const got = keptTools([agent, bash, read], ["Bash", "Agent"]);
    assert.equal(got[0], agent);
    assert.equal(got[1], bash);
    assert.deepEqual(Object.keys(got[0]).sort(), ["description", "name"]);
  });

  test("keep empty: nothing is kept", () => {
    assert.deepEqual(keptTools([agent, bash], []), []);
    assert.deepEqual(keptTools([], []), []);
  });

  test("a name of keep that no tool has gives nothing", () => {
    assert.deepEqual(keptTools([agent, bash], ["Glob"]), []);
    assert.deepEqual(keptTools([agent, bash], ["Glob", "Bash", "Nope"]), [bash]);
    assert.deepEqual(keptTools([], ["Bash"]), []);
  });

  test("a name twice in keep gives its tool once", () => {
    const got = keptTools([agent, bash, read], ["Bash", "Bash", "Read", "Bash"]);
    assert.deepEqual(got, [bash, read]);
    assert.equal(got.length, 2);
  });

  test("two tools of one name are both kept", () => {
    const first = { name: "Bash", id: 1 };
    const second = { name: "Bash", id: 2 };
    const got = keptTools([first, agent, second], ["Bash"]);
    assert.equal(got.length, 2);
    assert.equal(got[0], first);
    assert.equal(got[1], second);
  });

  test("the name is compared exactly: case, spaces and the rest count", () => {
    const tools = [{ name: "Bash" }, { name: "bash" }, { name: " Bash" }, { name: "a.b" }, { name: "日本語" }, { name: "a b" }];
    assert.deepEqual(keptTools(tools, ["bash"]).map((t) => t.name), ["bash"]);
    assert.deepEqual(keptTools(tools, ["BASH"]), []);
    assert.deepEqual(keptTools(tools, ["Bash "]), []);
    assert.deepEqual(keptTools(tools, [" Bash"]).map((t) => t.name), [" Bash"]);
    assert.deepEqual(keptTools(tools, ["a.b", "日本語", "a b"]).map((t) => t.name), ["a.b", "日本語", "a b"]);
    assert.deepEqual(keptTools(tools, ["a"]), []);
    assert.deepEqual(keptTools(tools, ["b"]), []);
  });

  test("the lists given are not changed and nothing is printed", () => {
    const tools = deepFreeze([{ name: "Agent" }, { name: "Bash" }, { name: "Read" }]);
    const keep = deepFreeze(["Read", "Bash", "Glob"]);
    let got;
    const printed = printedBy(() => {
      got = [keptTools(tools, keep), keptTools(tools, undefined), keptTools(tools, [])];
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(got[0].map((t) => t.name), ["Bash", "Read"]);
    assert.equal(got[1].length, 3);
    assert.deepEqual(got[2], []);
  });

  test("keptTools(tools, keep) with the keep of an entry read from a file", () => {
    const server = usableOf({ command: "claude", args: ["mcp", "serve"], tools: ["Read", "Bash", "Glob"] });
    assert.deepEqual(keptTools([{ name: "Agent" }, { name: "Bash" }, { name: "Read" }], server.tools).map((t) => t.name), ["Bash", "Read"]);
    const plain = usableOf({ command: "claude" });
    assert.deepEqual(keptTools([{ name: "Agent" }], plain.tools), [{ name: "Agent" }]);
  });

  test("tools that is not a list is a TypeError", () => {
    for (const bad of [undefined, null, "Bash", 5, true, {}, { length: 0 }, { 0: { name: "a" }, length: 1 }, new Set([{ name: "a" }])]) {
      assert.throws(() => keptTools(bad, undefined), TypeError, `tools ${String(bad)}`);
      assert.throws(() => keptTools(bad, ["a"]), TypeError, `tools ${String(bad)}`);
      assert.throws(() => keptTools(bad, []), TypeError, `tools ${String(bad)}`);
    }
    assert.throws(() => keptTools(), TypeError);
  });

  test("keep that is neither undefined nor a list is a TypeError, null included", () => {
    for (const bad of [null, "Bash", "", 5, 0, true, false, {}, { length: 1, 0: "Bash" }, new Set(["Bash"])]) {
      assert.throws(() => keptTools([{ name: "Bash" }], bad), TypeError, `keep ${String(bad)}`);
      assert.throws(() => keptTools([], bad), TypeError, `keep ${String(bad)}`);
    }
  });
});

describe("step 11: the package file at version 0.4.0", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

  test("package.json has version 0.4.0", () => {
    assert.equal(pkg.version, "0.4.0");
  });

  test("the lock has 0.4.0 at the top and in packages['']", () => {
    assert.equal(lock.version, "0.4.0");
    assert.equal(lock.packages[""].version, "0.4.0");
  });

  test("files does not change: the ten entries of step 10, in that order", () => {
    assert.deepEqual(pkg.files, [
      "auth/src/",
      "bin/",
      "core/src/",
      "guide/pages/",
      "hosts/src/",
      "library/src/",
      "practice/src/",
      "sandbox/src/",
      "server/src/",
      "shell/src/",
    ]);
  });
});

describe("step 11: no file of this part holds an e-mail address or a home folder path", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const filesUnder = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)]));
  const scanned = [...filesUnder(join(root, "core", "src")), ...filesUnder(join(root, "core", "test"))];
  // the patterns are built from halves so that this file does not hold what it looks for
  const homePath = new RegExp("/(?:Us" + "ers|ho" + "me)/[A-Za-z0-9_]");
  const mail = new RegExp("[A-Za-z0-9._%+-]+" + "@" + "[A-Za-z0-9-]+\\.[A-Za-z]{2,}");

  test("the files scanned are there, this one among them", () => {
    assert.ok(scanned.length > 10);
    assert.ok(scanned.some((f) => f.endsWith("step11.test.js")));
  });

  test("no home folder path", () => {
    for (const file of scanned) assert.ok(!homePath.test(readFileSync(file, "utf8")), `${file} holds a home folder path`);
  });

  test("no e-mail address", () => {
    for (const file of scanned) assert.ok(!mail.test(readFileSync(file, "utf8")), `${file} holds an e-mail address`);
  });
});
