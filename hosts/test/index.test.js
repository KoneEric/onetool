import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { hostRules } from "../src/index.js";
import { baseTest, writeAdapter, run, on, snapshot } from "./helpers.js";

const NONE = { effect: "none" };

describe("hostRules: the object and the host name", () => {
  baseTest("HostRules has exactly four keys; host is the first name of the adapter", async (T) => {
    const r = await hostRules("claude-code", { home: T.home });
    assert.deepEqual(Object.keys(r).sort(), ["decide", "host", "ownCall", "refresh"]);
    assert.equal(r.host, "claude-code");
    for (const k of ["decide", "ownCall", "refresh"]) assert.equal(typeof r[k], "function");
    const p = r.refresh([]);
    assert.ok(p instanceof Promise);
    assert.deepEqual(await p, []);
  });

  baseTest("the name is compared trimmed and in lower case", async (T) => {
    for (const name of [" Claude-Code ", "CLAUDE-CODE", "\tclaude-code\n", "Claude-code"]) {
      const r = await hostRules(name, { home: T.home });
      assert.equal(r?.host, "claude-code", JSON.stringify(name));
    }
  });

  baseTest("no adapter knows the name: null; never a rejection for a name", async (T) => {
    for (const name of ["claude code", "cursor", "claude-code2", "claude-cod", "", " ", "\n", "claude"]) {
      assert.equal(await hostRules(name, { home: T.home }), null, JSON.stringify(name));
    }
    for (const name of [undefined, null, 5, {}, [], ["claude-code"], true, Symbol("x"), () => "claude-code"]) {
      assert.equal(await hostRules(name, { home: T.home }), null, String(name));
    }
  });

  baseTest("home that is not a string or is empty: rejects with a TypeError", async (T) => {
    for (const bad of ["", 5, null, {}, [], true, [T.home]]) {
      await assert.rejects(hostRules("claude-code", { home: bad }), TypeError, JSON.stringify(bad));
    }
  });

  baseTest("the default home is os.homedir(), read at the call", async (T) => {
    const was = process.env.HOME;
    const other = T.folder("otherhome");
    T.settings(T.home, ".claude/settings.json", { deny: ["Bash(rm *)"] });
    T.settings(other, ".claude/settings.json", { deny: ["Bash(ls *)"] });
    try {
      process.env.HOME = T.home;
      const r = await hostRules("claude-code");
      process.env.HOME = other; // changed after the call: not read again
      assert.deepEqual(await r.refresh([]), []);
      assert.equal(r.decide(run("rm x")).effect, "deny");
      assert.deepEqual(r.decide(run("ls x")), NONE);
    } finally {
      if (was === undefined) delete process.env.HOME;
      else process.env.HOME = was;
    }
  });

  baseTest("hostRules reads no settings file: before the first refresh there is no rule", async (T) => {
    T.settings(T.home, ".claude/settings.json", { deny: ["Bash"], ask: ["Bash"] });
    const r = await hostRules("claude-code", { home: T.home });
    assert.deepEqual(r.decide(run("rm x")), NONE);
    assert.deepEqual(r.decide(on("read", "/w/a")), NONE);
    await r.refresh([]);
    assert.equal(r.decide(run("rm x")).effect, "deny");
  });
});

describe("Finding the adapter", () => {
  baseTest("an adaptersFolder that does not exist or holds no adapter: null", async (T) => {
    assert.equal(await hostRules("claude-code", { home: T.home, adaptersFolder: join(T.base, "nope") }), null);
    mkdirSync(T.adapters);
    assert.equal(await hostRules("claude-code", { home: T.home, adaptersFolder: T.adapters }), null);
  });

  baseTest("only the files directly in the folder whose name ends with .js; every other file and folder is left out", async (T) => {
    writeAdapter(T, "notes.txt", ["a1"]);
    writeAdapter(T, "other.mjs", ["a2"]);
    writeAdapter(T, "backup.js.bak", ["a3"]);
    writeAdapter(T, "data.json", ["a4"]);
    writeAdapter(T, "nested.js/index.js", ["a5"]);
    writeAdapter(T, "deeper/adapter.js", ["a6"]);
    for (const n of ["a1", "a2", "a3", "a4", "a5", "a6"]) {
      assert.equal(await hostRules(n, { home: T.home, adaptersFolder: T.adapters }), null, n);
    }
    writeAdapter(T, "real.js", ["a7"]);
    assert.equal((await hostRules("a7", { home: T.home, adaptersFolder: T.adapters })).host, "a7");
  });

  baseTest("the order is that of the file names (sort with no argument); the first adapter that knows the name serves", async (T) => {
    writeAdapter(T, "a.js", ["ax", "shared"]);
    writeAdapter(T, "B.js", ["bx", "shared"]);
    writeAdapter(T, "c.js", ["cx", "shared"]);
    const get = (n) => hostRules(n, { home: T.home, adaptersFolder: T.adapters });
    assert.equal((await get("shared")).host, "bx"); // "B.js" sorts before "a.js"
    assert.equal((await get("ax")).host, "ax");
    assert.equal((await get("cx")).host, "cx");
    assert.equal((await get("SHARED ")).host, "bx");
  });

  baseTest("host is the first of the names; any of the names finds the adapter", async (T) => {
    writeAdapter(T, "fox.js", ["fox", "fox-cli", "foxy"]);
    for (const n of ["fox", "FOX-CLI", " foxy "]) {
      assert.equal((await hostRules(n, { home: T.home, adaptersFolder: T.adapters })).host, "fox");
    }
  });

  baseTest("the list is built at each call: adding one file adds a host, with no other file changed", async (T) => {
    writeAdapter(T, "one.js", ["one"]);
    const get = (n) => hostRules(n, { home: T.home, adaptersFolder: T.adapters });
    assert.equal(await get("two"), null);
    writeAdapter(T, "two.js", ["two"]);
    assert.equal((await get("two")).host, "two");
    assert.equal((await get("one")).host, "one");
    // the adapters of the default folder are not those of this one
    assert.equal(await get("claude-code"), null);
  });

  baseTest("a second adapter is served in full: refresh, decide and ownCall", async (T) => {
    const root = T.folder("proj");
    T.write(join(T.home, "rules.json"), { deny: ["nuke"], ask: ["poke"], allow: [] });
    writeAdapter(T, "zeta.js", ["zeta"], {
      files: (home, roots) => [{ file: join(home, "rules.json"), anchors: roots }],
      matches: (rule, call) => call.command === rule,
      ownCall: (tool, args, cwd) => (tool === "Hi" ? { action: "run", command: `${args.say}@${cwd}` } : null),
    });
    const r = await hostRules("zeta", { home: T.home, adaptersFolder: T.adapters });
    assert.deepEqual(await r.refresh([root]), []);
    assert.deepEqual(r.decide(run("nuke")), { effect: "deny", file: join(T.home, "rules.json"), rule: "nuke" });
    assert.deepEqual(r.decide(run("poke")), { effect: "ask", file: join(T.home, "rules.json"), rule: "poke" });
    assert.deepEqual(r.decide(run("other")), NONE);
    assert.deepEqual(r.ownCall("Hi", { say: "yo" }, "/c"), { action: "run", command: "yo@/c" });
    assert.equal(r.ownCall("Other", {}, "/c"), null);
  });

  baseTest("ownCall is the adapter's, called as it is: same arguments, same result", async (T) => {
    const seen = [];
    const sentinel = { action: "read", paths: ["/zz"] };
    writeAdapter(T, "own.js", ["own"], {
      ownCall: (...a) => {
        seen.push(a);
        return seen.length === 1 ? sentinel : null;
      },
    });
    const r = await hostRules("own", { home: T.home, adaptersFolder: T.adapters });
    const args = { file_path: "q" };
    assert.deepEqual(r.ownCall("Read", args, "/cwd"), sentinel);
    assert.equal(r.ownCall("Read", args, "/cwd"), null);
    assert.deepEqual(seen, [["Read", { file_path: "q" }, "/cwd"], ["Read", { file_path: "q" }, "/cwd"]]);
  });

  baseTest("the real adapter's ownCall through HostRules, and it is synchronous", async (T) => {
    const r = await hostRules("claude-code", { home: T.home });
    assert.deepEqual(r.ownCall("Read", { file_path: "a.txt" }, "/w"), { action: "read", paths: ["/w/a.txt"] });
    assert.deepEqual(r.ownCall("Bash", { command: "ls" }, "/w"), { action: "run", command: "ls" });
    assert.equal(r.ownCall("Grep", {}, "/w"), null);
  });
});

// An adapter of three files, to see what index.js does with what the adapter gives it.
//   one.json   (anchors /a1)     two.json   (anchors [])     three.json  (anchors /c)     nodir/four.json (not there)
async function threeFiles(T, hooks = {}) {
  const adapterHooks = writeAdapter(T, "tri.js", ["tri"], {
    files: (home, roots) => [
      { file: join(home, "one.json"), anchors: ["/a1"] },
      { file: join(home, "two.json"), anchors: [] },
      { file: join(home, "three.json"), anchors: ["/c"] },
      { file: join(home, "nodir", "four.json"), anchors: roots },
    ],
    matches: (rule, call) => call.command.includes(rule.trim()),
    ...hooks,
  });
  const r = await hostRules("tri", { home: T.home, adaptersFolder: T.adapters });
  return { r, hooks: adapterHooks };
}
const f = (T, name) => join(T.home, name);

describe("refresh and decide: what index.js does", () => {
  baseTest("before the first refresh: none", async (T) => {
    T.write(f(T, "one.json"), { deny: ["x"] });
    const { r } = await threeFiles(T);
    assert.deepEqual(r.decide(run("x")), NONE);
  });

  baseTest("refresh gives files the home and the roots it was given", async (T) => {
    const calls = [];
    const { r } = await threeFiles(T, {
      files: (home, roots) => {
        calls.push([home, roots]);
        return [];
      },
    });
    await r.refresh(["/p", "/q"]);
    await r.refresh([]);
    assert.deepEqual(calls, [[T.home, ["/p", "/q"]], [T.home, []]]);
  });

  baseTest("deny of any file wins over ask of any file; the first deny, files in order, rules in order", async (T) => {
    T.write(f(T, "one.json"), { ask: ["x"], deny: [] });
    T.write(f(T, "two.json"), { deny: ["nomatch", "x", "x "], ask: ["x"] });
    T.write(f(T, "three.json"), { deny: ["x"] });
    const { r } = await threeFiles(T);
    assert.deepEqual(await r.refresh([]), []);
    assert.deepEqual(r.decide(run("do x")), { effect: "deny", file: f(T, "two.json"), rule: "x" });
  });

  baseTest("with no deny, the first ask in the order of the files, then of the list", async (T) => {
    T.write(f(T, "one.json"), { ask: ["zzz", "y"] });
    T.write(f(T, "two.json"), { ask: ["x", "y"] });
    T.write(f(T, "three.json"), { ask: ["x"] });
    const { r } = await threeFiles(T);
    await r.refresh([]);
    assert.deepEqual(r.decide(run("x")), { effect: "ask", file: f(T, "two.json"), rule: "x" });
    assert.deepEqual(r.decide(run("y")), { effect: "ask", file: f(T, "one.json"), rule: "y" });
    assert.deepEqual(r.decide(run("x y")), { effect: "ask", file: f(T, "one.json"), rule: "y" });
    assert.deepEqual(r.decide(run("none of them")), NONE);
  });

  baseTest("the rule is the text of the item exactly as written, not trimmed; the same rule twice: the first file", async (T) => {
    T.write(f(T, "one.json"), { deny: ["  spaced "] });
    T.write(f(T, "two.json"), { deny: ["  spaced "] });
    const { r } = await threeFiles(T);
    await r.refresh([]);
    assert.deepEqual(r.decide(run("a spaced b")), { effect: "deny", file: f(T, "one.json"), rule: "  spaced " });
  });

  baseTest("the allow lists are read and never looked at", async (T) => {
    const { r, hooks } = await threeFiles(T);
    const asked = [];
    hooks.matches = (rule, call) => {
      asked.push(rule);
      return call.command.includes(rule);
    };
    T.write(f(T, "one.json"), { deny: ["d"], ask: ["a"], allow: ["d", "a", "z", "ALLOWED"] });
    await r.refresh([]);
    const calls = ["d", "a", "z", "ALLOWED", "d a", "other"];
    const withAllow = calls.map((c) => r.decide(run(c)));
    assert.deepEqual(withAllow[2], NONE);
    assert.deepEqual(withAllow[3], NONE);
    assert.equal(asked.includes("ALLOWED"), false);
    assert.equal(asked.includes("z"), false);
    T.write(f(T, "one.json"), { deny: ["d"], ask: ["a"], allow: [] });
    await r.refresh([]);
    assert.deepEqual(calls.map((c) => r.decide(run(c))), withAllow);
    T.write(f(T, "one.json"), { deny: ["d"], ask: ["a"] });
    await r.refresh([]);
    assert.deepEqual(calls.map((c) => r.decide(run(c))), withAllow);
  });

  baseTest("a file that is not there gives no rule and no fault, also under a folder that is not there", async (T) => {
    const { r } = await threeFiles(T);
    assert.deepEqual(await r.refresh(["/p"]), []);
    assert.deepEqual(r.decide(run("x")), NONE);
  });

  baseTest("a file that is there and cannot be read, or that parse throws on, is in the result; the rest apply", async (T) => {
    mkdirSync(f(T, "one.json")); // a folder
    T.write(f(T, "two.json"), { deny: ["x"] });
    T.write(f(T, "three.json"), "this is not json");
    const { r } = await threeFiles(T);
    assert.deepEqual(await r.refresh([]), [f(T, "one.json"), f(T, "three.json")]);
    assert.deepEqual(r.decide(run("x")), { effect: "deny", file: f(T, "two.json"), rule: "x" });
  });

  baseTest("whatever parse throws counts, and never makes refresh reject", async (T) => {
    T.write(f(T, "one.json"), "1");
    T.write(f(T, "two.json"), "2");
    const { r } = await threeFiles(T, {
      parse: (text) => {
        if (text === "1") throw "a string";
        if (text === "2") throw undefined;
        return { deny: [], ask: [], allow: [] };
      },
    });
    assert.deepEqual(await r.refresh([]), [f(T, "one.json"), f(T, "two.json")]);
  });

  baseTest("refresh reads every file again and replaces every rule read before", async (T) => {
    T.write(f(T, "one.json"), { deny: ["old1"] });
    T.write(f(T, "two.json"), { ask: ["old2"] });
    const { r } = await threeFiles(T);
    await r.refresh([]);
    assert.equal(r.decide(run("old1")).effect, "deny");
    assert.equal(r.decide(run("old2")).effect, "ask");
    T.write(f(T, "one.json"), { deny: ["new1"] });
    rmSync(f(T, "two.json"));
    assert.deepEqual(await r.refresh([]), []);
    assert.deepEqual(r.decide(run("old1")), NONE);
    assert.deepEqual(r.decide(run("old2")), NONE);
    assert.equal(r.decide(run("new1")).effect, "deny");
    // a file that was good and is now bad gives no rule, and is in the result
    T.write(f(T, "one.json"), "broken");
    assert.deepEqual(await r.refresh([]), [f(T, "one.json")]);
    assert.deepEqual(r.decide(run("new1")), NONE);
  });

  baseTest("two refreshes at the same time: the rules are those of one of them, whole", async (T) => {
    const home = T.home;
    const rootA = T.folder("ra");
    const rootB = T.folder("rb");
    T.settings(rootA, ".claude/settings.json", { deny: ["Bash(rm *)"], ask: ["Bash(ls *)"] });
    T.settings(rootB, ".claude/settings.json", { deny: ["Bash(cat *)"] });
    const r = await hostRules("claude-code", { home });
    await Promise.all([r.refresh([rootA]), r.refresh([rootB])]);
    const got = ["rm x", "ls x", "cat x"].map((c) => r.decide(run(c)).effect);
    const A = ["deny", "ask", "none"];
    const B = ["none", "none", "deny"];
    assert.ok(JSON.stringify(got) === JSON.stringify(A) || JSON.stringify(got) === JSON.stringify(B), got.join());
  });

  baseTest("decide is synchronous and gives a plain object with exactly the keys of its effect", async (T) => {
    T.write(f(T, "one.json"), { deny: ["x"], ask: ["y"] });
    const { r } = await threeFiles(T);
    await r.refresh([]);
    const d = r.decide(run("x"));
    assert.deepEqual(Object.keys(d).sort(), ["effect", "file", "rule"]);
    assert.deepEqual(Object.keys(r.decide(run("y"))).sort(), ["effect", "file", "rule"]);
    assert.deepEqual(Object.keys(r.decide(run("q"))), ["effect"]);
  });

  baseTest("the part writes nothing", async (T) => {
    const root = T.folder("proj");
    T.settings(T.home, ".claude/settings.json", { deny: ["Bash(rm *)"] });
    T.settings(root, ".claude/settings.local.json", { ask: ["Read(.env)"] });
    const before = snapshot(T.base);
    const r = await hostRules("claude-code", { home: T.home });
    await r.refresh([root]);
    r.decide(run("rm x"));
    r.ownCall("Read", { file_path: "a" }, root);
    assert.deepEqual(snapshot(T.base), before);
  });
});

describe("the adapter of Claude Code through hostRules", () => {
  baseTest("the user's file, the project file and the local file, in order; deny over ask; the file named", async (T) => {
    const root = T.folder("proj");
    const userFile = T.settings(T.home, ".claude/settings.json", {
      deny: ["Bash(rm *)", "  Bash(ls) "],
      ask: ["Read(./.env)", "Bash(git push:*)"],
      allow: ["Bash"],
    });
    const projFile = T.settings(root, ".claude/settings.json", { ask: ["Bash(git push:*)", "Edit(./src/**)"] });
    const localFile = T.settings(root, ".claude/settings.local.json", { deny: ["Read(.env)"] });
    const r = await hostRules("claude-code", { home: T.home });
    assert.deepEqual(await r.refresh([root]), []);
    assert.deepEqual(r.decide(run("rm -rf x")), { effect: "deny", file: userFile, rule: "Bash(rm *)" });
    assert.deepEqual(r.decide(run("ls")), { effect: "deny", file: userFile, rule: "  Bash(ls) " });
    assert.deepEqual(r.decide(run("git push origin")), { effect: "ask", file: userFile, rule: "Bash(git push:*)" });
    // the user's ask is of the root too; the local deny wins over it
    assert.deepEqual(r.decide(on("read", join(root, ".env"))), { effect: "deny", file: localFile, rule: "Read(.env)" });
    assert.deepEqual(r.decide(on("edit", join(root, "src", "a.js"))), { effect: "ask", file: projFile, rule: "Edit(./src/**)" });
    assert.deepEqual(r.decide(on("write", join(root, "src", "a.js"))), { effect: "ask", file: projFile, rule: "Edit(./src/**)" });
    assert.deepEqual(r.decide(on("read", join(root, "src", "a.js"))), NONE);
    assert.deepEqual(r.decide(run("echo hi")), NONE);
  });

  baseTest("the allow lists change nothing: the same call gives the same decision with and without", async (T) => {
    const root = T.folder("proj");
    const rules = { deny: ["Bash(rm *)", "Read(./.env)"], ask: ["Bash(git push:*)", "Edit(./src/**)"] };
    const calls = [run("rm x"), run("git push"), run("ls"), on("read", join(root, ".env")), on("write", join(root, "src/a")), on("read", join(root, "x"))];
    const decide = async (allow) => {
      T.settings(T.home, ".claude/settings.json", { ...rules, allow });
      const r = await hostRules("claude-code", { home: T.home });
      await r.refresh([root]);
      return calls.map((c) => r.decide(c));
    };
    const without = await decide([]);
    const withAll = await decide(["Bash", "Read", "Edit", "Write", "Bash(*)", "Bash(rm *)", "Read(./.env)", "Edit(./src/**)", "Bash(git push:*)"]);
    assert.deepEqual(withAll, without);
    assert.deepEqual(without[2], NONE);
    assert.equal(without[0].effect, "deny");
    assert.equal(without[1].effect, "ask");
  });

  baseTest("the same rule in two files: the first file in order is named", async (T) => {
    const root = T.folder("proj");
    const userFile = T.settings(T.home, ".claude/settings.json", { deny: ["Bash(rm *)"] });
    T.settings(root, ".claude/settings.json", { deny: ["Bash(rm *)"] });
    const r = await hostRules("claude-code", { home: T.home });
    await r.refresh([root]);
    assert.deepEqual(r.decide(run("rm x")), { effect: "deny", file: userFile, rule: "Bash(rm *)" });
  });

  baseTest("a rule of the user's file is of every root; a rule of a root's file is of that root only", async (T) => {
    const r1 = T.folder("r1");
    const r2 = T.folder("r2");
    T.settings(T.home, ".claude/settings.json", { deny: ["Read(./.env)"] });
    T.settings(r2, ".claude/settings.json", { deny: ["Read(./only2)"] });
    const r = await hostRules("claude-code", { home: T.home });
    await r.refresh([r1, r2]);
    assert.equal(r.decide(on("read", join(r1, ".env"))).effect, "deny");
    assert.equal(r.decide(on("read", join(r2, ".env"))).effect, "deny");
    assert.equal(r.decide(on("read", join(r2, "only2"))).effect, "deny");
    assert.deepEqual(r.decide(on("read", join(r1, "only2"))), NONE);
    await r.refresh([r1]);
    assert.deepEqual(r.decide(on("read", join(r2, ".env"))), NONE);
    assert.deepEqual(r.decide(on("read", join(r2, "only2"))), NONE);
    await r.refresh([]);
    assert.deepEqual(r.decide(on("read", join(r1, ".env"))), NONE);
  });

  baseTest("with no root only the user's file is read; a bash rule needs no anchor", async (T) => {
    const root = T.folder("proj");
    T.settings(root, ".claude/settings.json", { deny: ["Bash"] });
    T.settings(T.home, ".claude/settings.json", { deny: ["Bash(rm *)", "Read(./.env)"] });
    const r = await hostRules("claude-code", { home: T.home });
    await r.refresh([]);
    assert.equal(r.decide(run("rm x")).effect, "deny");
    assert.deepEqual(r.decide(run("ls")), NONE);
    assert.deepEqual(r.decide(on("read", join(root, ".env"))), NONE);
  });

  baseTest("the same root twice: its files are read twice, the result is the same", async (T) => {
    const root = T.folder("proj");
    const file = T.settings(root, ".claude/settings.json", { deny: ["Bash(rm *)"] });
    const r = await hostRules("claude-code", { home: T.home });
    await r.refresh([root]);
    const once = ["rm x", "ls"].map((c) => r.decide(run(c)));
    await r.refresh([root, root]);
    assert.deepEqual(["rm x", "ls"].map((c) => r.decide(run(c))), once);
    assert.deepEqual(once[0], { effect: "deny", file, rule: "Bash(rm *)" });
    // read twice: a file that cannot be read is in the result twice
    rmSync(file);
    mkdirSync(file);
    assert.deepEqual(await r.refresh([root, root]), [file, file]);
  });

  baseTest("the files that are there and cannot be read, or are not a settings file, in the order of the files", async (T) => {
    const root = T.folder("proj");
    const userFile = join(T.home, ".claude", "settings.json");
    const projFile = join(root, ".claude", "settings.json");
    const localFile = join(root, ".claude", "settings.local.json");
    mkdirSync(userFile, { recursive: true });
    T.write(projFile, "");
    T.write(localFile, '{"permissions":{"ask":["Bash(ls)"]}}');
    const r = await hostRules("claude-code", { home: T.home });
    assert.deepEqual(await r.refresh([root]), [userFile, projFile]);
    assert.deepEqual(r.decide(run("ls")), { effect: "ask", file: localFile, rule: "Bash(ls)" });
    T.write(projFile, '{"permissions":[]}');
    assert.deepEqual(await r.refresh([root]), [userFile, projFile]);
    T.write(projFile, "{}");
    assert.deepEqual(await r.refresh([root]), [userFile]);
  });

  baseTest("odd names: spaces, non-ASCII and case are kept as given", async (T) => {
    const root = T.folder("my proj é");
    T.settings(root, ".claude/settings.json", { deny: ["Read(./Données/clé.txt)"] });
    const r = await hostRules("claude-code", { home: T.home });
    await r.refresh([root]);
    assert.equal(r.decide(on("read", join(root, "Données", "clé.txt"))).effect, "deny");
    assert.deepEqual(r.decide(on("read", join(root, "données", "clé.txt"))), NONE);
  });
});

describe("two spellings: the real paths of the anchors and of home", () => {
  // The recorded calls of `matches`, the rules never matching, so that every spelling is tried.
  async function recorded(T, home, roots, tag = "sp") {
    const log = [];
    T.write(join(home, "s.json"), { deny: ["r"] });
    writeAdapter(T, `${tag}.js`, [tag], {
      files: (h, rs) => [{ file: join(h, "s.json"), anchors: rs }],
      matches: (rule, call, ctx) => {
        log.push({ rule, home: ctx.home, anchors: ctx.anchors });
        return false;
      },
    });
    const r = await hostRules(tag, { home, adaptersFolder: T.adapters });
    await r.refresh(roots);
    r.decide(run("anything"));
    return log;
  }

  baseTest("home through a link: matches is called with the given spelling, then with the real home; anchors get their real paths after", async (T) => {
    const realHome = T.folder("realhome");
    const linkHome = join(T.base, "linkhome");
    symlinkSync(realHome, linkHome);
    const realRoot = T.folder("realroot");
    const linkRoot = join(T.base, "linkroot");
    symlinkSync(realRoot, linkRoot);
    const log = await recorded(T, linkHome, [linkRoot]);
    assert.deepEqual(log, [
      { rule: "r", home: linkHome, anchors: [linkRoot, realRoot] },
      { rule: "r", home: realHome, anchors: [linkRoot, realRoot] },
    ]);
  });

  baseTest("nothing differs: one call, the anchors as given; an anchor that has no real path stays alone", async (T) => {
    const realRoot = T.folder("realroot");
    const log = await recorded(T, T.home, [realRoot]);
    assert.deepEqual(log, [{ rule: "r", home: T.home, anchors: [realRoot] }]);
    const gone = join(T.base, "not-there");
    const log2 = await recorded(T, T.home, [gone, realRoot], "sp_b");
    assert.deepEqual(log2, [{ rule: "r", home: T.home, anchors: [gone, realRoot] }]);
  });

  baseTest("a rule matches when one of the calls says so", async (T) => {
    const realHome = T.folder("realhome");
    const linkHome = join(T.base, "linkhome");
    symlinkSync(realHome, linkHome);
    const realRoot = T.folder("realroot");
    const linkRoot = join(T.base, "linkroot");
    symlinkSync(realRoot, linkRoot);
    T.write(join(linkHome, "s.json"), { deny: ["byRealHome", "byRealAnchor", "byGivenAnchor", "byGivenHome", "never"] });
    writeAdapter(T, "sp2.js", ["sp2"], {
      files: (h, rs) => [{ file: join(h, "s.json"), anchors: rs }],
      matches: (rule, call, ctx) =>
        ({
          byRealHome: ctx.home === realHome,
          byGivenHome: ctx.home === linkHome,
          byRealAnchor: ctx.anchors.includes(realRoot),
          byGivenAnchor: ctx.anchors.includes(linkRoot),
          never: false,
        })[rule] && call.command === rule,
    });
    const r = await hostRules("sp2", { home: linkHome, adaptersFolder: T.adapters });
    await r.refresh([linkRoot]);
    for (const rule of ["byRealHome", "byRealAnchor", "byGivenAnchor", "byGivenHome"]) {
      assert.equal(r.decide(run(rule)).effect, "deny", rule);
    }
    assert.deepEqual(r.decide(run("never")), NONE);
  });

  baseTest("the real paths are worked out at each refresh", async (T) => {
    const realHome = T.folder("realhome");
    const linkHome = join(T.base, "linkhome"); // not there when hostRules is called
    const r0 = await hostRules("claude-code", { home: linkHome });
    T.settings(realHome, ".claude/settings.json", { deny: ["Read(~/.ssh/**)"] });
    symlinkSync(realHome, linkHome);
    await r0.refresh([]);
    assert.equal(r0.decide(on("read", join(realHome, ".ssh", "id"))).effect, "deny");
    assert.equal(r0.decide(on("read", join(linkHome, ".ssh", "id"))).effect, "deny");
  });

  baseTest("Claude Code's rules hold whether the caller's paths go through a link or not", async (T) => {
    const realHome = T.folder("realhome");
    const linkHome = join(T.base, "linkhome");
    symlinkSync(realHome, linkHome);
    const realRoot = T.folder("realroot");
    const linkRoot = join(T.base, "linkroot");
    symlinkSync(realRoot, linkRoot);
    T.settings(realHome, ".claude/settings.json", { deny: ["Read(~/.ssh/**)"] });
    T.settings(realRoot, ".claude/settings.json", { ask: ["Read(./.env)", "Edit(/lib/**)"] });
    const r = await hostRules("claude-code", { home: linkHome });
    // the user's file as the adapter names it, through the home as given
    assert.deepEqual(await r.refresh([linkRoot]), []);
    for (const p of [join(linkHome, ".ssh", "id"), join(realHome, ".ssh", "id")]) {
      assert.deepEqual(r.decide(on("read", p)), { effect: "deny", file: join(linkHome, ".claude", "settings.json"), rule: "Read(~/.ssh/**)" });
    }
    for (const p of [join(linkRoot, ".env"), join(realRoot, ".env")]) {
      assert.equal(r.decide(on("read", p)).effect, "ask", p);
    }
    for (const p of [join(linkRoot, "lib", "a"), join(realRoot, "lib", "a")]) {
      assert.equal(r.decide(on("write", p)).effect, "ask", p);
    }
    assert.deepEqual(r.decide(on("read", join(realRoot, "other"))), NONE);
  });
});

describe("what the part does to its caller", () => {
  baseTest("no handler, no timer, no watcher, no output, any working folder; the default adapters folder is found from index.js", async (T) => {
    const { spawnSync } = await import("node:child_process");
    const { pathToFileURL } = await import("node:url");
    const { readFileSync } = await import("node:fs");
    const root = T.folder("proj");
    T.settings(T.home, ".claude/settings.json", { deny: ["Bash(rm *)"] });
    const out = join(T.base, "result.json");
    const script = join(T.base, "child.mjs");
    writeFileSync(
      script,
      `
import { writeFileSync } from "node:fs";
import { constants } from "node:os";
const [src, home, root, out] = process.argv.slice(2);
const names = [...Object.keys(constants.signals), "exit", "beforeExit", "uncaughtException", "unhandledRejection"];
const counts = () => Object.fromEntries(names.map((n) => [n, process.listenerCount(n)]));
const own = () => {};
process.on("SIGTERM", own);
const before = counts();
const { hostRules } = await import(src);
const r = await hostRules("claude-code", { home });
await r.refresh([root]);
await r.refresh([root]);
const d = r.decide({ action: "run", command: "rm x" });
const resources = process.getActiveResourcesInfo().filter((x) => x !== "TTYWrap" && x !== "PipeWrap");
writeFileSync(out, JSON.stringify({ found: r !== null, d, same: JSON.stringify(before) === JSON.stringify(counts()), resources, cwd: process.cwd() }));
`,
    );
    const src = pathToFileURL(fileURLToPath(new URL("../src/index.js", import.meta.url))).href;
    const res = spawnSync(process.execPath, [script, src, T.home, root, out], { cwd: T.base, encoding: "utf8", timeout: 20000 });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "");
    const got = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(got.found, true);
    assert.equal(got.d.effect, "deny");
    assert.equal(got.same, true);
    assert.equal(got.resources.some((x) => /Timeout|Timer|FSEvent|Watch|Immediate/.test(x)), false, got.resources.join());
  });
});
