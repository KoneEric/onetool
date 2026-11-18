import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import * as part from "../src/index.js";
import { INDEX, tmpHome, within } from "./helpers.js";

const { authFolder, authFile, signInStamp, quietProvider, login, logout, browserCommand } = part;

describe("what other parts may call", () => {
  test("the seven functions are exported", () => {
    for (const f of [authFolder, authFile, signInStamp, quietProvider, login, logout, browserCommand]) {
      assert.equal(typeof f, "function");
    }
  });

  test("the file imports Node's own modules and the MCP package, nothing else", () => {
    const text = fs.readFileSync(INDEX, "utf8");
    const specs = [...text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
    assert.ok(specs.length > 0, "the file imports something");
    for (const s of specs) {
      const bare = s.replace(/^node:/, "");
      const ok = s.startsWith("node:") || builtinModules.includes(bare) || s.startsWith("@modelcontextprotocol/sdk/") || s === "@modelcontextprotocol/sdk";
      assert.ok(ok, `import of ${s}`);
    }
  });
});

describe("the names of the files", () => {
  test("authFolder is the folder .onetool/auth of home", () => {
    const home = path.join(path.sep, "some", "home");
    assert.equal(authFolder({ home }), path.join(home, ".onetool", "auth"));
  });

  test("authFile is the encoded name with .json, directly in the folder", () => {
    const home = path.join(path.sep, "some", "home");
    const folder = authFolder({ home });
    assert.equal(authFile("far", { home }), path.join(folder, "far.json"));
    assert.equal(authFile("my server", { home }), path.join(folder, "my%20server.json"));
    assert.equal(authFile("a/b", { home }), path.join(folder, "a%2Fb.json"));
    for (const name of ["Far", "café", "日本語", "../up", "a b/C d"]) {
      const f = authFile(name, { home });
      assert.equal(f, path.join(folder, encodeURIComponent(name) + ".json"), name);
      assert.equal(path.dirname(f), folder, name);
    }
  });

  test("two names that differ only by case give two file names; a name is never trimmed", () => {
    const home = path.join(path.sep, "some", "home");
    assert.notEqual(authFile("far", { home }), authFile("Far", { home }));
    assert.notEqual(authFile("far", { home }), authFile(" far", { home }));
  });

  test("the default of home is read at each call, and follows HOME", () => {
    const a = tmpHome();
    const b = tmpHome();
    const script = `
      import(${JSON.stringify(INDEX)}).then((m) => {
        const first = [m.authFolder(), m.authFile("far")];
        process.env.HOME = process.env.OTHER_HOME;
        const second = [m.authFolder(), m.authFile("far")];
        process.stdout.write(JSON.stringify({ first, second, stamp: m.signInStamp("far", "http://h/mcp"), gone: m.logout("far") }));
      });`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: a, OTHER_HOME: b },
      encoding: "utf8",
      timeout: 8000,
    });
    const got = JSON.parse(out);
    assert.deepEqual(got.first, [path.join(a, ".onetool", "auth"), path.join(a, ".onetool", "auth", "far.json")]);
    assert.deepEqual(got.second, [path.join(b, ".onetool", "auth"), path.join(b, ".onetool", "auth", "far.json")]);
    assert.equal(got.stamp, null);
    assert.equal(got.gone, false);
  });
});

describe("browserCommand", () => {
  const address = "http://127.0.0.1:1234/authorize?client_id=x&state=a b;c&q='\"$(x)";

  test("darwin and linux", () => {
    assert.deepEqual(browserCommand(address, "darwin"), ["open", address]);
    assert.deepEqual(browserCommand(address, "linux"), ["xdg-open", address]);
  });

  test("anything else gives null", () => {
    for (const p of ["win32", "freebsd", "sunos", "aix", "", "Darwin", "LINUX"]) assert.equal(browserCommand(address, p), null, p);
  });

  test("the default platform is process.platform", () => {
    assert.deepEqual(browserCommand(address), browserCommand(address, process.platform));
  });
});

describe("bad arguments", () => {
  const url = "http://127.0.0.1:1/mcp";

  test("signInStamp, logout, authFile and quietProvider throw a TypeError", () => {
    const home = tmpHome();
    for (const bad of ["", 5, null, undefined, {}, ["far"]]) {
      assert.throws(() => signInStamp(bad, url, { home }), TypeError, `signInStamp name ${String(bad)}`);
      assert.throws(() => logout(bad, { home }), TypeError, `logout name ${String(bad)}`);
      assert.throws(() => authFile(bad, { home }), TypeError, `authFile name ${String(bad)}`);
      assert.throws(() => quietProvider(bad, url, { home }), TypeError, `quietProvider name ${String(bad)}`);
      assert.throws(() => signInStamp("far", bad, { home }), TypeError, `signInStamp url ${String(bad)}`);
      assert.throws(() => quietProvider("far", bad, { home }), TypeError, `quietProvider url ${String(bad)}`);
    }
    assert.throws(() => quietProvider("far", url, { home, oauth: "x" }), TypeError);
    assert.throws(() => quietProvider("far", url, { home, oauth: {} }), TypeError);
    assert.throws(() => quietProvider("far", url, { home, oauth: { clientId: 5 } }), TypeError);
    assert.deepEqual(fs.readdirSync(home), [], "nothing was done");
  });

  test("login rejects with a TypeError and does nothing", async () => {
    const home = tmpHome();
    let said = 0;
    const say = () => said++;
    const cases = [
      [{ name: "", url }, {}],
      [{ name: 5, url }, {}],
      [{ name: "far", url: "" }, {}],
      [{ name: "far", url: 5 }, {}],
      [{ name: "far", url: undefined }, {}],
      [{ name: "far", url }, { waitSeconds: 0 }],
      [{ name: "far", url }, { waitSeconds: -1 }],
      [{ name: "far", url }, { waitSeconds: NaN }],
      [{ name: "far", url }, { waitSeconds: Infinity }],
      [{ name: "far", url }, { waitSeconds: "5" }],
      [{ name: "far", url }, { say: "x" }],
      [{ name: "far", url }, { open: 3 }],
      [{ name: "far", url, oauth: {} }, {}],
      [{ name: "far", url, oauth: "x" }, {}],
      [{ name: "far", url, oauth: { clientId: 5 } }, {}],
    ];
    for (const [args, opts] of cases) {
      await within(
        assert.rejects(() => login(args, { home, waitSeconds: 5, say, ...opts }), TypeError, JSON.stringify([args, opts])),
        8000,
        "a bad argument is refused at once",
      );
    }
    assert.equal(said, 0);
    assert.deepEqual(fs.readdirSync(home), [], "nothing was written");
  });
});
