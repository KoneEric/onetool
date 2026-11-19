import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { readSettings, SettingsError } from "../src/index.js";
import { settingsOf, faultOf, faultAt, writeSettings, tmpPath, printedBy } from "./helpers.js";

const DEFAULTS = {
  answerLimit: 8000,
  timeoutSeconds: 60,
  connectSeconds: 30,
  searchLimit: 10,
  stateLimit: 10000000,
  allow: [],
  deny: [],
  ask: [],
  shell: null,
  trail: true,
  log: true,
  logFolder: null,
  hostRules: true,
  hostServers: [],
  backgroundSeconds: 7200,
  maxJobs: 3,
  libraryCap: 50,
  instructions: true,
};

const withServer = (entry) => ({ mcpServers: { s: entry } });
const reasonOf = (entry) => {
  const got = settingsOf(withServer(entry));
  assert.equal(got.servers.length, 0);
  assert.equal(got.bad.length, 1);
  assert.equal(got.bad[0].name, "s");
  return got.bad[0].reason;
};

describe("readSettings: the whole file", () => {
  test("the example of the meeting point", () => {
    const got = settingsOf({
      mcpServers: {
        practice: { command: "node", args: ["practice/src/server.js"], env: { KEY: "value" } },
      },
      onetool: {
        answerLimit: 8000,
        timeoutSeconds: 60,
        connectSeconds: 30,
        searchLimit: 10,
        allow: [],
        deny: ["practice.wipe"],
      },
    });
    assert.deepEqual(got, {
      servers: [{ name: "practice", command: "node", args: ["practice/src/server.js"], env: { KEY: "value" } }],
      bad: [],
      answerLimit: 8000,
      timeoutSeconds: 60,
      connectSeconds: 30,
      searchLimit: 10,
      stateLimit: 10000000,
      allow: [],
      deny: ["practice.wipe"],
      ask: [],
      shell: null,
      trail: true,
      log: true,
      logFolder: null,
      hostRules: true,
      hostServers: [],
      backgroundSeconds: 7200,
      maxJobs: 3,
      libraryCap: 50,
      instructions: true,
    });
  });

  test("onetool absent: every default", () => {
    assert.deepEqual(settingsOf({ mcpServers: {} }), { servers: [], bad: [], ...DEFAULTS });
  });

  test("onetool empty: every default", () => {
    assert.deepEqual(settingsOf({ mcpServers: {}, onetool: {} }), { servers: [], bad: [], ...DEFAULTS });
  });

  test("a key given leaves the others at their default", () => {
    const got = settingsOf({ mcpServers: {}, onetool: { searchLimit: 3, deny: ["a.b"] } });
    assert.deepEqual(got, { servers: [], bad: [], ...DEFAULTS, searchLimit: 3, deny: ["a.b"] });
  });

  test("other top-level keys are ignored", () => {
    const got = settingsOf({ $schema: "x", extra: [1, 2], mcpServers: {} });
    assert.deepEqual(got, { servers: [], bad: [], ...DEFAULTS });
  });

  test("allow and deny come back as written: order and repeats kept", () => {
    const got = settingsOf({ mcpServers: {}, onetool: { allow: ["b.*", "a.*", "b.*"], deny: ["z", "*.x"] } });
    assert.deepEqual(got.allow, ["b.*", "a.*", "b.*"]);
    assert.deepEqual(got.deny, ["z", "*.x"]);
  });

  test("it prints nothing", () => {
    const path = writeSettings({ mcpServers: { s: { command: "node" }, "a.b": {} } });
    assert.deepEqual(printedBy(() => readSettings(path)), []);
  });
});

describe("readSettings: mcpServers, usable entries", () => {
  test("args [] and env {} when absent; only the four keys", () => {
    assert.deepEqual(settingsOf(withServer({ command: "node" })).servers, [
      { name: "s", command: "node", args: [], env: {} },
    ]);
  });

  test("command, args and env values are kept exactly as written", () => {
    const got = settingsOf(withServer({ command: " node ", args: ["", " a  b ", "--x=1"], env: { A: "", B: " v " } }));
    assert.deepEqual(got.servers, [
      { name: "s", command: " node ", args: ["", " a  b ", "--x=1"], env: { A: "", B: " v " } },
    ]);
  });

  test("an empty args list and an empty env are valid", () => {
    assert.deepEqual(settingsOf(withServer({ command: "node", args: [], env: {} })).servers, [
      { name: "s", command: "node", args: [], env: {} },
    ]);
  });

  test("any other key of an entry is ignored", () => {
    const got = settingsOf(withServer({ command: "node", type: "stdio", disabled: true, cwd: "/x", other: [1] }));
    assert.deepEqual(got.servers, [{ name: "s", command: "node", args: [], env: {} }]);
    assert.deepEqual(got.bad, []);
  });

  test("names keep their case, spaces and non-ASCII characters", () => {
    const names = ["My Server", "ÜberServer", "日本語", " padded ", "UPPER"];
    const mcpServers = Object.fromEntries(names.map((n) => [n, { command: "x" }]));
    const got = settingsOf({ mcpServers });
    assert.deepEqual(
      got.servers.map((s) => s.name),
      names,
    );
  });

  test("servers and bad are in the order of the file", () => {
    const got = settingsOf({
      mcpServers: {
        zeta: { command: "z" },
        "bad.one": { command: "x" },
        alpha: { command: "a" },
        omega: { args: [] },
        mid: { command: "m" },
      },
    });
    assert.deepEqual(
      got.servers.map((s) => s.name),
      ["zeta", "alpha", "mid"],
    );
    assert.deepEqual(got.bad, [
      { name: "bad.one", reason: "the name holds a dot" },
      { name: "omega", reason: "no command" },
    ]);
  });

  test("a bad entry does not affect the others, and nothing is thrown", () => {
    const got = settingsOf({ mcpServers: { ok: { command: "node" }, nope: 5 } });
    assert.equal(got.servers.length, 1);
    assert.equal(got.bad.length, 1);
  });
});

describe("readSettings: mcpServers, the bad entries", () => {
  test("the name is empty", () => {
    for (const name of ["", " ", "\t\n", " "]) {
      const got = settingsOf({ mcpServers: { [name]: { command: "node" } } });
      assert.deepEqual(got.servers, [], JSON.stringify(name));
      assert.deepEqual(got.bad, [{ name, reason: "the name is empty" }], JSON.stringify(name));
    }
  });

  test("the name holds a dot", () => {
    for (const name of ["a.b", ".a", "a.", "x y.z"]) {
      const got = settingsOf({ mcpServers: { [name]: { command: "node" } } });
      assert.deepEqual(got.bad, [{ name, reason: "the name holds a dot" }], name);
    }
  });

  test("not an object", () => {
    for (const entry of [null, [], ["node"], "node", 5, true]) {
      assert.equal(reasonOf(entry), "not an object", JSON.stringify(entry));
    }
  });

  test("no command", () => {
    for (const entry of [{}, { command: "" }, { command: 5 }, { command: ["node"] }, { command: null }, { args: ["a"] }]) {
      assert.equal(reasonOf(entry), "no command", JSON.stringify(entry));
    }
  });

  test("an entry reached at an address is no longer `no command` (step 2: it is usable)", () => {
    for (const entry of [{ url: "http://localhost:1/mcp", headers: { A: "b" } }, { type: "http", url: "http://localhost:1/mcp" }]) {
      const got = settingsOf(withServer(entry));
      assert.deepEqual(got.bad, []);
      assert.equal(got.servers.length, 1);
    }
  });

  test("args is not a list of texts", () => {
    for (const args of ["a", 5, {}, { 0: "a" }, [1], ["a", 2], [null], [["a"]], [{}]]) {
      assert.equal(reasonOf({ command: "node", args }), "args is not a list of texts", JSON.stringify(args));
    }
  });

  test("env is not an object of texts", () => {
    for (const env of ["a", 5, { A: 1 }, { A: "x", B: null }, { A: true }, { A: ["x"] }, { A: {} }]) {
      assert.equal(reasonOf({ command: "node", env }), "env is not an object of texts", JSON.stringify(env));
    }
  });

  test("the first test that fails gives the reason", () => {
    const entries = [
      [{ args: "x", env: "y" }, "no command"],
      [{ command: "node", args: "x", env: "y" }, "args is not a list of texts"],
      [{ command: "node", args: [], env: "y" }, "env is not an object of texts"],
    ];
    for (const [entry, reason] of entries) assert.equal(reasonOf(entry), reason, JSON.stringify(entry));
  });

  test("the name is tested before the entry, the dot before the object", () => {
    assert.deepEqual(settingsOf({ mcpServers: { "": null } }).bad, [{ name: "", reason: "the name is empty" }]);
    assert.deepEqual(settingsOf({ mcpServers: { "a.b": null } }).bad, [{ name: "a.b", reason: "the name holds a dot" }]);
    assert.deepEqual(settingsOf({ mcpServers: { " ": {} } }).bad, [{ name: " ", reason: "the name is empty" }]);
  });

  test("no reason holds a value of the file", () => {
    const got = settingsOf({
      mcpServers: {
        a: { command: "SECRET-cmd", args: ["SECRET-arg", 1] },
        b: { command: "SECRET-cmd", env: { K: "SECRET-env", L: 2 } },
        c: { args: ["SECRET-arg"], env: { K: "SECRET-env" } },
        d: { command: 5, args: ["SECRET-arg"] },
      },
    });
    assert.equal(got.bad.length, 4);
    for (const b of got.bad) assert.ok(!b.reason.includes("SECRET"), b.reason);
  });
});

describe("readSettings: onetool, valid values", () => {
  const one = (key, value) => settingsOf({ mcpServers: {}, onetool: { [key]: value } })[key];

  test("answerLimit: whole numbers from 100 to 1000000", () => {
    for (const v of [100, 101, 8000, 999999, 1000000, 1e3]) assert.equal(one("answerLimit", v), v === 1e3 ? 1000 : v);
  });

  test("timeoutSeconds: above 0, at most 3600", () => {
    for (const v of [0.5, 0.001, 1, 59.5, 3600]) assert.equal(one("timeoutSeconds", v), v);
  });

  test("connectSeconds: above 0, at most 600", () => {
    for (const v of [0.5, 0.001, 1, 599.5, 600]) assert.equal(one("connectSeconds", v), v);
  });

  test("searchLimit: whole numbers from 1 to 100", () => {
    for (const v of [1, 2, 10, 99, 100]) assert.equal(one("searchLimit", v), v);
  });

  test("allow and deny: lists of patterns, the empty list included", () => {
    for (const key of ["allow", "deny"]) {
      assert.deepEqual(one(key, []), []);
      assert.deepEqual(one(key, ["*"]), ["*"]);
      assert.deepEqual(one(key, ["a.b", "*.delete*", "Ünï.*"]), ["a.b", "*.delete*", "Ünï.*"]);
    }
  });
});

describe("readSettings: onetool, invalid values", () => {
  const problemsOf = (onetool) => faultOf({ mcpServers: {}, onetool }).problems;

  test("answerLimit", () => {
    const msg = "onetool.answerLimit: must be a whole number from 100 to 1000000";
    for (const v of [99, 0, -100, 1000001, 100.5, "8000", true, false, null, [], {}, [100]]) {
      assert.deepEqual(problemsOf({ answerLimit: v }), [msg], JSON.stringify(v));
    }
  });

  test("timeoutSeconds", () => {
    const msg = "onetool.timeoutSeconds: must be a number above 0, at most 3600";
    for (const v of [0, -1, 3600.5, 3601, "60", true, null, [], {}]) {
      assert.deepEqual(problemsOf({ timeoutSeconds: v }), [msg], JSON.stringify(v));
    }
  });

  test("connectSeconds", () => {
    const msg = "onetool.connectSeconds: must be a number above 0, at most 600";
    for (const v of [0, -1, 600.5, 601, "30", true, null, [], {}]) {
      assert.deepEqual(problemsOf({ connectSeconds: v }), [msg], JSON.stringify(v));
    }
  });

  test("searchLimit", () => {
    const msg = "onetool.searchLimit: must be a whole number from 1 to 100";
    for (const v of [0, -1, 101, 2.5, "10", true, null, [], {}]) {
      assert.deepEqual(problemsOf({ searchLimit: v }), [msg], JSON.stringify(v));
    }
  });

  test("allow and deny", () => {
    const bad = [
      "x",
      "a.b",
      {},
      5,
      true,
      [""],
      ["a b"],
      [" a"],
      ["a "],
      ["a\tb"],
      ["a\nb"],
      ["a b"],
      ["ok", ""],
      ["ok", 5],
      ["ok", null],
      [["a"]],
      [{}],
    ];
    for (const key of ["allow", "deny"]) {
      for (const v of bad) {
        assert.deepEqual(problemsOf({ [key]: v }), [`onetool.${key}: must be a list of patterns`], `${key} ${JSON.stringify(v)}`);
      }
    }
  });

  test("onetool not an object", () => {
    for (const onetool of [[], "x", 5, true]) {
      assert.deepEqual(faultOf({ mcpServers: {}, onetool }).problems, ["onetool: not an object"], JSON.stringify(onetool));
    }
  });

  test("a key not in the table is unknown, `state` included", () => {
    for (const key of ["state", "foo", "AnswerLimit", "answer_limit", "mcpServers"]) {
      assert.deepEqual(problemsOf({ [key]: 1 }), [`onetool.${key}: unknown key`], key);
    }
  });

  test("every unknown key is named", () => {
    const problems = problemsOf({ bar: {}, state: "x", foo: 1 });
    assert.deepEqual([...problems].sort(), ["onetool.bar: unknown key", "onetool.foo: unknown key", "onetool.state: unknown key"]);
  });

  test("no problem holds a value of the file", () => {
    const problems = problemsOf({
      answerLimit: "SECRET-1",
      timeoutSeconds: "SECRET-2",
      connectSeconds: "SECRET-3",
      searchLimit: "SECRET-4",
      allow: ["SECRET 5"],
      deny: [["SECRET-6"]],
    });
    assert.equal(problems.length, 6);
    for (const p of problems) assert.ok(!p.includes("SECRET"), p);
  });
});

describe("readSettings: faults", () => {
  test("every problem, in the order of the table", () => {
    const got = faultOf({
      onetool: {
        deny: 5,
        searchLimit: 0,
        connectSeconds: 0,
        timeoutSeconds: 0,
        answerLimit: 0,
        zzz: 1,
      },
    });
    assert.deepEqual(got.problems, [
      "mcpServers: missing",
      "onetool.zzz: unknown key",
      "onetool.answerLimit: must be a whole number from 100 to 1000000",
      "onetool.timeoutSeconds: must be a number above 0, at most 3600",
      "onetool.connectSeconds: must be a number above 0, at most 600",
      "onetool.searchLimit: must be a whole number from 1 to 100",
      "onetool.deny: must be a list of patterns",
    ]);
  });

  test("allow and deny both invalid: both named, after the numbers", () => {
    const got = faultOf({ mcpServers: {}, onetool: { allow: "x", deny: "y", searchLimit: 0 } });
    assert.equal(got.problems[0], "onetool.searchLimit: must be a whole number from 1 to 100");
    assert.deepEqual(got.problems.slice(1).sort(), [
      "onetool.allow: must be a list of patterns",
      "onetool.deny: must be a list of patterns",
    ]);
  });

  test("the message is the problems joined by `; `", () => {
    const got = faultOf({ onetool: { searchLimit: 0, state: 1 } });
    assert.deepEqual(got.problems, [
      "mcpServers: missing",
      "onetool.state: unknown key",
      "onetool.searchLimit: must be a whole number from 1 to 100",
    ]);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("it is a SettingsError, an Error, with problems a list of texts", () => {
    const got = faultOf({});
    assert.ok(got instanceof SettingsError);
    assert.ok(got instanceof Error);
    assert.ok(Array.isArray(got.problems));
    assert.ok(got.problems.every((p) => typeof p === "string"));
  });

  test("mcpServers absent", () => {
    assert.deepEqual(faultOf({}).problems, ["mcpServers: missing"]);
    assert.deepEqual(faultOf({ onetool: {} }).problems, ["mcpServers: missing"]);
  });

  test("mcpServers not an object", () => {
    for (const v of [[], ["a"], "x", 5, true]) {
      assert.deepEqual(faultOf({ mcpServers: v }).problems, ["mcpServers: not an object"], JSON.stringify(v));
    }
  });

  test("mcpServers and onetool problems are listed together", () => {
    const got = faultOf({ mcpServers: [], onetool: [] });
    assert.deepEqual(got.problems, ["mcpServers: not an object", "onetool: not an object"]);
  });

  test("no file: the path is named", () => {
    const path = tmpPath("missing.json");
    const err = faultAt(path);
    assert.deepEqual(err.problems, [`settings file not found: ${path}`]);
    assert.equal(err.message, `settings file not found: ${path}`);
  });

  test("a folder is not a file", () => {
    const path = tmpPath("a-folder");
    mkdirSync(path);
    assert.deepEqual(faultAt(path).problems, [`settings file not found: ${path}`]);
  });

  test("an empty path", () => {
    assert.deepEqual(faultAt("").problems, ["settings file not found: "]);
  });

  test("a file that cannot be read", { skip: process.getuid?.() === 0 || process.platform === "win32" }, () => {
    const path = tmpPath("locked.json");
    writeFileSync(path, '{"mcpServers":{}}');
    chmodSync(path, 0o000);
    try {
      assert.deepEqual(faultAt(path).problems, [`settings file not found: ${path}`]);
    } finally {
      chmodSync(path, 0o600);
    }
  });

  test("not JSON: an empty file included; the parser's message is not repeated", () => {
    for (const text of ["", "  \n", "{", "not json", '{"a": SECRET-value}', '{"mcpServers": {"x": SECRET}}', "{'a': 1}"]) {
      const err = faultOf(text);
      assert.deepEqual(err.problems, ["settings file is not JSON"], JSON.stringify(text));
      assert.equal(err.message, "settings file is not JSON");
    }
  });

  test("JSON, but not an object", () => {
    for (const text of ["[]", '[{"mcpServers":{}}]', "null", "5", '"x"', "true"]) {
      assert.deepEqual(faultOf(text).problems, ["settings file is not a JSON object"], text);
    }
  });

  test("the first three faults end the reading alone", () => {
    assert.equal(faultAt(tmpPath("nothing-here.json")).problems.length, 1);
    assert.equal(faultOf("{ SECRET").problems.length, 1);
    assert.equal(faultOf("[1]").problems.length, 1);
  });

  test("a usable file written with the file system's own calls reads the same as one made by the helper", () => {
    const path = tmpPath("plain.json");
    writeFileSync(path, '{\n  "mcpServers": { "a": { "command": "node" } }\n}\n', "utf8");
    assert.deepEqual(readSettings(path).servers, [{ name: "a", command: "node", args: [], env: {} }]);
  });

  test("a file read from a path inside a folder", () => {
    const folder = tmpPath("nested");
    mkdirSync(folder);
    const path = join(folder, "settings.json");
    writeFileSync(path, '{"mcpServers":{}}', "utf8");
    assert.deepEqual(readSettings(path), { servers: [], bad: [], ...DEFAULTS });
  });

  test("the file is read as UTF-8", () => {
    const path = writeSettings('{"mcpServers":{"Ünï 日本":{"command":"é","args":["ß"],"env":{"K":"ü"}}}}');
    assert.deepEqual(readSettings(path).servers, [{ name: "Ünï 日本", command: "é", args: ["ß"], env: { K: "ü" } }]);
  });
});
