import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as core from "../src/index.js";
import { settingsOf, deepFreeze, printedBy } from "./helpers.js";

// A function not built yet must fail a test with an assertion, never pass one that expects a TypeError.
const named = (name) => (...args) => {
  assert.equal(typeof core[name], "function", `${name} is not exported`);
  return core[name](...args);
};
const searchTools = named("searchTools");
const signsIn = named("signsIn");
const signInMessage = named("signInMessage");

const OK = "http://localhost:1/mcp";
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

describe("step 10: oauth, usable", () => {
  test("an entry with url and oauth gives exactly { name, url, headers, oauth }", () => {
    const got = usableOf({ url: OK, oauth: { clientId: "abc" } });
    assert.deepEqual(got, { name: "s", url: OK, headers: {}, oauth: { clientId: "abc" } });
    assert.deepEqual(Object.keys(got).sort(), ["headers", "name", "oauth", "url"]);
  });

  test("oauth holds clientSecret, scopes and port only when the file has them, as written", () => {
    const oauth = { clientId: "abc", clientSecret: "sh", scopes: ["read", "write:all"], port: 8765 };
    assert.deepEqual(usableOf({ url: OK, oauth }).oauth, oauth);
    assert.deepEqual(Object.keys(usableOf({ url: OK, oauth: { clientId: "a", port: 1 } }).oauth).sort(), ["clientId", "port"]);
    assert.deepEqual(Object.keys(usableOf({ url: OK, oauth: { clientId: "a", scopes: [] } }).oauth).sort(), ["clientId", "scopes"]);
    assert.deepEqual(Object.keys(usableOf({ url: OK, oauth: { clientId: "a", clientSecret: "x" } }).oauth).sort(), ["clientId", "clientSecret"]);
  });

  test("an empty list of scopes is valid; the ports 1 and 65535 are valid", () => {
    assert.deepEqual(usableOf({ url: OK, oauth: { clientId: "a", scopes: [] } }).oauth.scopes, []);
    assert.equal(usableOf({ url: OK, oauth: { clientId: "a", port: 1 } }).oauth.port, 1);
    assert.equal(usableOf({ url: OK, oauth: { clientId: "a", port: 65535 } }).oauth.port, 65535);
  });

  test("oauth next to headers other than Authorization", () => {
    const got = usableOf({ url: OK, headers: { "X-Org": "a" }, oauth: { clientId: "c" } });
    assert.deepEqual(got, { name: "s", url: OK, headers: { "X-Org": "a" }, oauth: { clientId: "c" } });
  });

  test("an entry with url and no oauth is still exactly { name, url, headers }", () => {
    assert.deepEqual(usableOf({ url: OK }), { name: "s", url: OK, headers: {} });
    assert.deepEqual(usableOf({ url: OK, headers: { Authorization: "Bearer x" } }), {
      name: "s",
      url: OK,
      headers: { Authorization: "Bearer x" },
    });
  });

  test("on an entry started by a command, oauth is ignored like any other key", () => {
    const want = { name: "s", command: "node", args: [], env: {} };
    assert.deepEqual(usableOf({ command: "node", oauth: { clientId: "a" } }), want);
    assert.deepEqual(usableOf({ command: "node", oauth: null }), want);
    assert.deepEqual(usableOf({ command: "node", oauth: 5, headers: { Authorization: "x" } }), want);
  });

  test("the file with an oauth returns the same keys as without", () => {
    const plain = Object.keys(settingsOf({ mcpServers: {} })).sort();
    assert.deepEqual(Object.keys(settingsOf(withServer({ url: OK, oauth: { clientId: "a" } }))).sort(), plain);
  });

  test("servers named login and logout are servers like any other", () => {
    const got = settingsOf({ mcpServers: { login: { url: OK }, logout: { command: "node" } } });
    assert.deepEqual(got.bad, []);
    assert.deepEqual(got.servers.map((s) => s.name), ["login", "logout"]);
  });

  test("the default of trail stays true", () => {
    assert.equal(settingsOf(withServer({ url: OK, oauth: { clientId: "a" } })).trail, true);
  });
});

describe("step 10: oauth, bad (5d)", () => {
  test("oauth is not an object, or has no clientId", () => {
    for (const oauth of [null, [], ["a"], "a", 5, true, {}, { clientId: "" }, { clientId: " " }, { clientId: " \t\n " }, { clientId: 5 }, { clientId: null }, { clientId: ["a"] }, { clientSecret: "x" }]) {
      assert.equal(oauthReason(oauth), "oauth has no clientId", JSON.stringify(oauth));
    }
  });

  test("clientSecret is not a text", () => {
    for (const clientSecret of ["", 5, null, [], ["a"], {}, true]) {
      assert.equal(oauthReason({ clientId: "a", clientSecret }), "oauth.clientSecret is not a text", JSON.stringify(clientSecret));
    }
  });

  test("scopes is not a list of words", () => {
    for (const scopes of ["read", null, {}, 5, true, [5], [""], [" "], ["a b"], ["a", "b c"], ["a\tb"], ["a\nb"], [null], [["a"]], ["a", ""]]) {
      assert.equal(oauthReason({ clientId: "a", scopes }), "oauth.scopes is not a list of words", JSON.stringify(scopes));
    }
  });

  test("port is not a port", () => {
    for (const port of ["8765", "", 0, -1, 65536, 100000, 2.5, true, false, null, [], [80], {}]) {
      assert.equal(oauthReason({ clientId: "a", port }), "oauth.port is not a port", JSON.stringify(port));
    }
  });

  test("oauth has an unknown key", () => {
    for (const extra of [{ x: 1 }, { clientid: "a" }, { redirectUri: "http://h/cb" }, { x: null }]) {
      assert.equal(oauthReason({ clientId: "a", ...extra }), "oauth has an unknown key", JSON.stringify(extra));
    }
    assert.equal(oauthReason({ clientId: "a", clientSecret: "s", scopes: ["r"], port: 80, extra: 1 }), "oauth has an unknown key");
  });

  test("the five lines are tested in order", () => {
    assert.equal(oauthReason({ clientSecret: "", scopes: 5, port: 0, x: 1 }), "oauth has no clientId");
    assert.equal(oauthReason({ clientId: "a", clientSecret: "", scopes: 5, port: 0, x: 1 }), "oauth.clientSecret is not a text");
    assert.equal(oauthReason({ clientId: "a", scopes: 5, port: 0, x: 1 }), "oauth.scopes is not a list of words");
    assert.equal(oauthReason({ clientId: "a", port: 0, x: 1 }), "oauth.port is not a port");
    assert.equal(oauthReason({ clientId: "a", x: 1 }), "oauth has an unknown key");
  });

  test("oauth has a key whatever its value, null included", () => {
    assert.equal(reasonOf({ url: OK, oauth: null }), "oauth has no clientId");
    assert.equal(reasonOf({ url: OK, oauth: { clientId: "a", clientSecret: null } }), "oauth.clientSecret is not a text");
    assert.equal(reasonOf({ url: OK, oauth: { clientId: "a", scopes: null } }), "oauth.scopes is not a list of words");
    assert.equal(reasonOf({ url: OK, oauth: { clientId: "a", port: null } }), "oauth.port is not a port");
  });
});

describe("step 10: oauth and an Authorization header (5e)", () => {
  test("the name is compared without case", () => {
    for (const name of ["Authorization", "authorization", "AUTHORIZATION", "aUtHoRiZaTiOn"]) {
      assert.equal(oauthReason({ clientId: "a" }, { headers: { [name]: "Bearer x" } }), "both oauth and an Authorization header", name);
      assert.equal(oauthReason({ clientId: "a" }, { headers: { "X-Org": "a", [name]: "" } }), "both oauth and an Authorization header", name);
    }
  });

  test("another header name does not count", () => {
    for (const name of ["X-Authorization", "Authorization-Token", "Auth", " Authorization"]) {
      assert.deepEqual(usableOf({ url: OK, headers: { [name]: "v" }, oauth: { clientId: "a" } }).headers, { [name]: "v" }, name);
    }
  });

  test("an Authorization header without oauth is as before", () => {
    assert.deepEqual(usableOf({ url: OK, headers: { Authorization: "Bearer x" } }).headers, { Authorization: "Bearer x" });
  });

  test("5d comes before 5e, 5c before 5d, 5b before 5d, 5a before 5d", () => {
    assert.equal(oauthReason({}, { headers: { Authorization: "x" } }), "oauth has no clientId");
    assert.equal(oauthReason({ clientId: "a", x: 1 }, { headers: { Authorization: "x" } }), "oauth has an unknown key");
    assert.equal(oauthReason({}, { headers: { Authorization: 5 } }), "headers is not an object of texts");
    assert.equal(oauthReason({}, { headers: 5 }), "headers is not an object of texts");
    assert.equal(oauthReason({ clientId: "a" }, { headers: { Authorization: 5 } }), "headers is not an object of texts");
    assert.equal(oauthReason({}, { type: "sse" }), "the old SSE transport is not supported");
    assert.equal(oauthReason({ clientId: "a" }, { type: "sse", headers: { Authorization: "x" } }), "the old SSE transport is not supported");
    assert.equal(reasonOf({ url: "ftp://h", oauth: {}, headers: 5, type: "sse" }), "url is not an http address");
  });

  test("earlier tests keep their order: both command and url comes before oauth", () => {
    assert.equal(reasonOf({ command: "x", url: OK, oauth: {} }), "both command and url");
  });

  test("the entry is bad as a whole: a good one next to it stays in servers, in order", () => {
    const got = settingsOf({
      mcpServers: {
        a: { url: OK, oauth: { clientId: "a" } },
        b: { url: OK, oauth: {} },
        c: { url: OK, oauth: { clientId: "c" }, headers: { authorization: "x" } },
        d: { command: "node" },
      },
    });
    assert.deepEqual(got.servers.map((s) => s.name), ["a", "d"]);
    assert.deepEqual(got.bad, [
      { name: "b", reason: "oauth has no clientId" },
      { name: "c", reason: "both oauth and an Authorization header" },
    ]);
  });

  test("no reason holds the client id, the secret or a scope", () => {
    const got = settingsOf({
      mcpServers: {
        a: { url: OK, oauth: { clientId: "SECRET-id", clientSecret: 5 } },
        b: { url: OK, oauth: { clientId: "SECRET-id", clientSecret: "SECRET-sh", scopes: ["SECRET scope"] } },
        c: { url: OK, oauth: { clientId: "SECRET-id", clientSecret: "SECRET-sh", scopes: ["SECRET-scope"], port: "SECRET" } },
        d: { url: OK, oauth: { clientId: "SECRET-id", clientSecret: "SECRET-sh", scopes: ["SECRET-scope"], other: "SECRET" } },
        e: { url: OK, oauth: { clientId: "SECRET-id" }, headers: { Authorization: "SECRET-tok" } },
      },
    });
    assert.equal(got.bad.length, 5);
    for (const b of got.bad) assert.ok(!b.reason.includes("SECRET"), b.reason);
  });
});

describe("step 10: signsIn(entry)", () => {
  test("a server started by a command gives false", () => {
    assert.equal(signsIn({ name: "s", command: "node", args: [], env: {} }), false);
  });

  test("a server at an address with an Authorization header, in any case, gives false", () => {
    for (const name of ["Authorization", "authorization", "AUTHORIZATION", "aUthOrization"]) {
      assert.equal(signsIn({ name: "s", url: OK, headers: { [name]: "Bearer x" } }), false, name);
      assert.equal(signsIn({ name: "s", url: OK, headers: { "X-Org": "a", [name]: "" } }), false, name);
    }
  });

  test("a server at an address with no header or other headers gives true, with oauth or without", () => {
    assert.equal(signsIn({ name: "s", url: OK, headers: {} }), true);
    assert.equal(signsIn({ name: "s", url: OK, headers: { "X-Org": "a" } }), true);
    assert.equal(signsIn({ name: "s", url: OK, headers: {}, oauth: { clientId: "a" } }), true);
    assert.equal(signsIn({ name: "s", url: OK, headers: { "X-Org": "a" }, oauth: { clientId: "a" } }), true);
    assert.equal(signsIn({ name: "s", url: OK, headers: { "X-Authorization": "a" } }), true);
  });

  test("two Authorization headers in two cases give false", () => {
    assert.equal(signsIn({ name: "s", url: OK, headers: { Authorization: "a", authorization: "b" } }), false);
  });

  test("the key is lower-cased with toLowerCase and compared whole", () => {
    assert.equal(signsIn({ name: "s", url: OK, headers: { " authorization": "a" } }), true);
    assert.equal(signsIn({ name: "s", url: OK, headers: { "authorization ": "a" } }), true);
  });

  test("what readSettings gives is told apart the same way", () => {
    const got = settingsOf({
      mcpServers: {
        a: { command: "node" },
        b: { url: OK },
        c: { url: OK, oauth: { clientId: "x" } },
        d: { url: OK, headers: { Authorization: "Bearer x" } },
        e: { url: OK, headers: { "X-Org": "a" } },
      },
    });
    assert.deepEqual(got.servers.map(signsIn), [false, true, true, false, true]);
  });

  test("not an entry: a TypeError", () => {
    for (const bad of [null, undefined, "a string", "https://h/mcp"]) {
      assert.throws(() => signsIn(bad), TypeError, String(bad));
    }
  });

  test("an object with url and no headers: a TypeError", () => {
    // assumed: "an object with no headers" is read as an entry that has url, the only case that reads headers
    assert.throws(() => signsIn({ name: "s", url: OK }), TypeError);
  });

  test("returns a boolean, prints nothing, changes nothing", () => {
    const entry = deepFreeze({ name: "s", url: OK, headers: { "X-Org": "a" }, oauth: { clientId: "a", scopes: ["r"] } });
    let got;
    const printed = printedBy(() => {
      got = signsIn(entry);
    });
    assert.equal(got, true);
    assert.deepEqual(printed, []);
  });
});

const tool = (name, description) => ({ name, description });
const practice = {
  server: "practice",
  tools: [tool("rows", "Returns the rows."), tool("sum", "Adds."), tool("a", "x"), tool("b", "y"), tool("c", "z")],
};
const far = { server: "far", tools: [], signIn: true };
const program = { name: "cityCount", params: ["city"], about: "Counts the rows of one city.", uses: 0 };

describe("step 10: sign in needed in searchTools", () => {
  test("with no words, the line `<server>: sign in needed` in catalog order", () => {
    assert.equal(searchTools([practice, far], undefined), "practice: 5 tools\nfar: sign in needed");
    assert.equal(searchTools([far, practice], null), "far: sign in needed\npractice: 5 tools");
    assert.equal(searchTools([practice, far, practice], ""), "practice: 5 tools\nfar: sign in needed\npractice: 5 tools");
    assert.equal(searchTools([practice, far], "  \t "), "practice: 5 tools\nfar: sign in needed");
  });

  test("a catalog of that one entry is not an empty catalog", () => {
    assert.equal(searchTools([far], undefined), "far: sign in needed");
  });

  test("beside an entry with an error", () => {
    const down = { server: "down", tools: [], error: "boom" };
    assert.equal(searchTools([down, far], undefined), "down: not connected (boom)\nfar: sign in needed");
  });

  test("signIn absent, undefined or false is as before", () => {
    assert.equal(searchTools([{ server: "far", tools: [] }], undefined), "far: 0 tools");
    assert.equal(searchTools([{ server: "far", tools: [], signIn: undefined }], undefined), "far: 0 tools");
    assert.equal(searchTools([{ server: "far", tools: [], signIn: false }], undefined), "far: 0 tools");
  });

  test("with no words and programs, the library line comes last", () => {
    assert.equal(searchTools([practice, far], undefined, { programs: [program] }), "practice: 5 tools\nfar: sign in needed\nlibrary: 1 programs");
    assert.equal(searchTools([far], "", { programs: [program, program] }), "far: sign in needed\nlibrary: 2 programs");
  });

  test("with words, the entry has no tools and matches nothing", () => {
    for (const words of ["far", "sign", "needed", "far sign in needed", "in", "e"]) {
      assert.equal(searchTools([far], words), "No tool matches.", words);
    }
  });

  test("with words, the answer is that of the catalog without the entry", () => {
    for (const words of ["rows", "sum rows", "zzz", "far"]) {
      assert.equal(searchTools([far, practice, far], words), searchTools([practice], words), words);
      assert.equal(searchTools([far, practice, far], words, { limit: 1 }), searchTools([practice], words, { limit: 1 }), words);
    }
  });

  test("with words and programs, the programs are as before", () => {
    const programs = [program];
    assert.equal(searchTools([far, practice], "rows", { programs }), searchTools([practice], "rows", { programs }));
    assert.ok(searchTools([far, practice], "rows", { programs }).startsWith("lib.cityCount({ city }) - Counts the rows of one city.\n"));
    assert.equal(searchTools([far], "city", { programs }), "lib.cityCount({ city }) - Counts the rows of one city.");
    assert.equal(searchTools([far], "zzz", { programs }), "No tool matches.");
  });

  test("the entry and its arguments are not changed, nothing is printed", () => {
    const catalog = deepFreeze([{ ...far }, { server: "p", tools: [tool("x", "y")] }]);
    const programs = deepFreeze([{ ...program }]);
    const printed = printedBy(() => {
      searchTools(catalog, undefined, { programs });
      searchTools(catalog, "y", { programs });
    });
    assert.deepEqual(printed, []);
  });
});

describe("step 10: signInMessage(server, configPath)", () => {
  test("the example of the meeting point", () => {
    assert.equal(signInMessage("far", "/tmp/s.json"), 'sign in needed: run "onetool login far --config /tmp/s.json" in a terminal');
  });

  test("server and configPath as given, unchanged", () => {
    assert.equal(
      signInMessage("my server", "/data/a b/dir/onetool.json"),
      'sign in needed: run "onetool login my server --config /data/a b/dir/onetool.json" in a terminal',
    );
    assert.equal(signInMessage("login", "/absolute/path/to/s.json"), 'sign in needed: run "onetool login login --config /absolute/path/to/s.json" in a terminal');
    assert.equal(signInMessage(" x ", " /y "), 'sign in needed: run "onetool login  x  --config  /y " in a terminal');
  });

  test("both must be strings that are not empty, else a TypeError", () => {
    for (const bad of ["", undefined, null, 5, [], ["a"], {}, true]) {
      assert.throws(() => signInMessage(bad, "/tmp/s.json"), TypeError, `server ${JSON.stringify(bad)}`);
      assert.throws(() => signInMessage("far", bad), TypeError, `configPath ${JSON.stringify(bad)}`);
    }
    assert.throws(() => signInMessage(), TypeError);
    assert.throws(() => signInMessage("far"), TypeError);
  });

  test("prints nothing", () => {
    let got;
    const printed = printedBy(() => {
      got = signInMessage("far", "/tmp/s.json");
    });
    assert.equal(typeof got, "string");
    assert.deepEqual(printed, []);
  });
});

describe("step 10: the package file at version 0.2.0", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));

  test("package.json has version 0.2.0", () => {
    assert.equal(pkg.version, "0.2.0");
  });

  test("the lock has 0.2.0 at the top and in packages['']", () => {
    assert.equal(lock.version, "0.2.0");
    assert.equal(lock.packages[""].version, "0.2.0");
    assert.equal(lock.name, "@koneeric/onetool");
    assert.equal(lock.packages[""].name, "@koneeric/onetool");
    assert.equal(lock.packages[""].license, "MIT");
  });

  test("files is exactly the list of ten, in this order", () => {
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

  test("auth/src/ is a folder beside package.json", () => {
    const path = join(root, "auth/src");
    assert.ok(existsSync(path) && statSync(path).isDirectory());
  });
});
