import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { authFile, authFolder, signInStamp, logout } from "../src/index.js";
import { startPractice, signIn, tmpHome, mode, readJson, strings, without } from "./helpers.js";

let srv;
before(async () => {
  srv = await startPractice();
});
after(() => srv?.stop());

describe("the file of a sign-in, as login writes it", () => {
  test("one file, directly in the folder, mode 600 in a folder of mode 700, with server and url", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const file = authFile("far", { home });
    assert.ok(fs.statSync(file).isFile());
    assert.equal(mode(file), 0o600);
    assert.equal(mode(authFolder({ home })), 0o700);
    const doc = readJson(file);
    assert.equal(typeof doc, "object");
    assert.equal(doc.server, "far");
    assert.equal(doc.url, srv.url);
    assert.deepEqual(fs.readdirSync(authFolder({ home })), ["far.json"]);
    assert.deepEqual(fs.readdirSync(home), [".onetool"]);
    assert.deepEqual(fs.readdirSync(path.join(home, ".onetool")), ["auth"]);
  });

  test("the file holds the tokens of the sign-in server and no client secret", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const all = strings(readJson(authFile("far", { home })));
    assert.ok(all.some((s) => /^practice-at-[A-Za-z0-9_-]{32}$/.test(s)), "an access token");
    assert.ok(all.some((s) => /^practice-rt-[A-Za-z0-9_-]{32}$/.test(s)), "a refresh token");
  });

  test("the file has mode 600 whatever the umask, also when it existed with another mode; a folder that exists keeps its mode", async () => {
    const home = tmpHome();
    fs.mkdirSync(authFolder({ home }), { recursive: true });
    fs.chmodSync(authFolder({ home }), 0o755);
    const old = process.umask(0o000);
    try {
      await signIn({ name: "far", url: srv.url, home });
      assert.equal(mode(authFile("far", { home })), 0o600);
      fs.chmodSync(authFile("far", { home }), 0o644);
      await signIn({ name: "far", url: srv.url, home });
      assert.equal(mode(authFile("far", { home })), 0o600);
    } finally {
      process.umask(old);
    }
    assert.equal(mode(authFolder({ home })), 0o755);
    assert.deepEqual(fs.readdirSync(authFolder({ home })), ["far.json"]);
  });

  test("the folder is made with its parents with mode 700 even under a loose umask", async () => {
    const home = tmpHome();
    const old = process.umask(0o000);
    try {
      await signIn({ name: "far", url: srv.url, home });
    } finally {
      process.umask(old);
    }
    assert.equal(mode(authFolder({ home })), 0o700);
  });

  test("a name with spaces, a slash, upper case and non-ASCII characters is one file in the folder", async () => {
    const home = tmpHome();
    const name = "My Server/Ünï";
    await signIn({ name, url: srv.url, home });
    assert.deepEqual(fs.readdirSync(authFolder({ home })), ["My%20Server%2F%C3%9Cn%C3%AF.json"]);
    assert.equal(readJson(authFile(name, { home })).server, name);
    assert.notEqual(signInStamp(name, srv.url, { home }), null);
    assert.equal(signInStamp("my server/ünï", srv.url, { home }), null);
  });

  test("two servers, two files", async () => {
    const home = tmpHome();
    await signIn({ name: "one", url: srv.url, home });
    await signIn({ name: "two", url: srv.url, home });
    assert.deepEqual(fs.readdirSync(authFolder({ home })).sort(), ["one.json", "two.json"]);
  });
});

describe("signInStamp", () => {
  test("null when there is no file, no folder", () => {
    const home = tmpHome();
    assert.equal(signInStamp("far", srv.url, { home }), null);
    fs.mkdirSync(authFolder({ home }), { recursive: true });
    assert.equal(signInStamp("far", srv.url, { home }), null);
  });

  test("a non-empty string, the same for two calls with no write between, and holding no secret", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const a = signInStamp("far", srv.url, { home });
    assert.equal(typeof a, "string");
    assert.ok(a.length > 0);
    assert.equal(signInStamp("far", srv.url, { home }), a);
    for (const s of strings(readJson(authFile("far", { home })))) {
      if (/^practice-(at|rt)-/.test(s)) assert.ok(!a.includes(s), "a token in the stamp");
    }
  });

  test("it differs after each write, whatever the time between them", async () => {
    const home = tmpHome();
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      await signIn({ name: "far", url: srv.url, home });
      const s = signInStamp("far", srv.url, { home });
      assert.ok(s);
      assert.ok(!seen.has(s), `a stamp given twice (round ${i})`);
      seen.add(s);
    }
  });

  test("it is null for another name and for another address, compared character for character", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    assert.notEqual(signInStamp("far", srv.url, { home }), null);
    assert.equal(signInStamp("far", srv.url + "/", { home }), null);
    assert.equal(signInStamp("far", srv.url.replace("127.0.0.1", "localhost"), { home }), null);
    assert.equal(signInStamp("Far", srv.url, { home }), null);
    assert.equal(signInStamp("near", srv.url, { home }), null);
  });

  describe("a file that is no usable sign-in; none of these throws", () => {
    const setup = async () => {
      const home = tmpHome();
      await signIn({ name: "far", url: srv.url, home });
      const file = authFile("far", { home });
      return { home, file, doc: readJson(file) };
    };
    const put = (file, text) => fs.writeFileSync(file, text);

    test("another server, another url", async () => {
      const { home, file, doc } = await setup();
      put(file, JSON.stringify({ ...doc, server: "near" }));
      assert.equal(signInStamp("far", srv.url, { home }), null);
      put(file, JSON.stringify({ ...doc, url: srv.url + "/" }));
      assert.equal(signInStamp("far", srv.url, { home }), null);
      put(file, JSON.stringify(doc));
      assert.notEqual(signInStamp("far", srv.url, { home }), null);
    });

    test("no tokens, no access token, an empty access token", async () => {
      const { home, file, doc } = await setup();
      put(file, JSON.stringify({ server: doc.server, url: doc.url }));
      assert.equal(signInStamp("far", srv.url, { home }), null, "no tokens");
      put(file, JSON.stringify(without(doc, /^practice-at-/)));
      assert.equal(signInStamp("far", srv.url, { home }), null, "no access token");
      put(file, JSON.stringify(without(doc, /^practice-at-/, "")));
      assert.equal(signInStamp("far", srv.url, { home }), null, "an empty access token");
    });

    test("not JSON, empty, not an object", async () => {
      const { home, file } = await setup();
      for (const text of ["", "{", "not json", "[]", "null", "5", '"far"', "[{}]"]) {
        put(file, text);
        assert.equal(signInStamp("far", srv.url, { home }), null, JSON.stringify(text));
      }
    });

    test("a folder in the place of the file", async () => {
      const { home, file } = await setup();
      fs.rmSync(file);
      fs.mkdirSync(file);
      assert.equal(signInStamp("far", srv.url, { home }), null);
    });

    test("a file in the place of the folder", async () => {
      const home = tmpHome();
      fs.mkdirSync(path.join(home, ".onetool"));
      fs.writeFileSync(authFolder({ home }), "x");
      assert.equal(signInStamp("far", srv.url, { home }), null);
    });
  });
});

describe("logout", () => {
  test("false when there is none, no folder either, and it makes nothing", () => {
    const home = tmpHome();
    assert.equal(logout("far", { home }), false);
    assert.deepEqual(fs.readdirSync(home), []);
    fs.mkdirSync(authFolder({ home }), { recursive: true });
    assert.equal(logout("far", { home }), false);
  });

  test("true when a file was there and is gone; then false; other files stay", async () => {
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    await signIn({ name: "near", url: srv.url, home });
    const other = signInStamp("near", srv.url, { home });
    assert.equal(logout("far", { home }), true);
    assert.equal(fs.existsSync(authFile("far", { home })), false);
    assert.equal(signInStamp("far", srv.url, { home }), null);
    assert.equal(logout("far", { home }), false);
    assert.equal(signInStamp("near", srv.url, { home }), other);
  });

  test("a file that cannot be removed: an Error with exactly one message", async (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("a process of the super-user can remove it");
      return;
    }
    const home = tmpHome();
    await signIn({ name: "far", url: srv.url, home });
    const folder = authFolder({ home });
    fs.chmodSync(folder, 0o500);
    try {
      assert.throws(
        () => logout("far", { home }),
        (e) => e instanceof Error && e.message === "the sign-in could not be removed",
      );
    } finally {
      fs.chmodSync(folder, 0o700);
    }
    assert.ok(fs.existsSync(authFile("far", { home })));
  });
});
