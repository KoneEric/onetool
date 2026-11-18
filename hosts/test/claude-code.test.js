import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import * as adapter from "../src/adapters/claude-code.js";

const { names, files, parse, matches, ownCall } = adapter;

const A = { home: "/h", anchors: ["/w"] };
const run = (command) => ({ action: "run", command });
const on = (action, ...paths) => ({ action, paths });
const m = (rule, call, ctx = A) => matches(rule, call, ctx);
const check = (rule, call, expected, ctx = A) =>
  assert.equal(m(rule, call, ctx), expected, `${JSON.stringify(rule)} against ${JSON.stringify(call)}`);

describe("the five exports", () => {
  test("exactly names, files, parse, matches, ownCall; names is [claude-code]", () => {
    assert.deepEqual(Object.keys(adapter).sort(), ["files", "matches", "names", "ownCall", "parse"]);
    assert.deepEqual(names, ["claude-code"]);
    for (const f of [files, parse, matches, ownCall]) assert.equal(typeof f, "function");
  });
});

describe("files(home, roots)", () => {
  test("no root: the user's file alone, anchors []", () => {
    assert.deepEqual(files("/h", []), [{ file: join("/h", ".claude", "settings.json"), anchors: [] }]);
  });

  test("the user's file has every root as anchor; then per root settings.json and settings.local.json", () => {
    assert.deepEqual(files("/h", ["/a", "/b"]), [
      { file: join("/h", ".claude", "settings.json"), anchors: ["/a", "/b"] },
      { file: join("/a", ".claude", "settings.json"), anchors: ["/a"] },
      { file: join("/a", ".claude", "settings.local.json"), anchors: ["/a"] },
      { file: join("/b", ".claude", "settings.json"), anchors: ["/b"] },
      { file: join("/b", ".claude", "settings.local.json"), anchors: ["/b"] },
    ]);
  });

  test("the same root twice gives its two files twice", () => {
    assert.deepEqual(files("/h", ["/a", "/a"]), [
      { file: join("/h", ".claude", "settings.json"), anchors: ["/a", "/a"] },
      { file: join("/a", ".claude", "settings.json"), anchors: ["/a"] },
      { file: join("/a", ".claude", "settings.local.json"), anchors: ["/a"] },
      { file: join("/a", ".claude", "settings.json"), anchors: ["/a"] },
      { file: join("/a", ".claude", "settings.local.json"), anchors: ["/a"] },
    ]);
  });

  test("paths are joined with path.join (a trailing slash and a double slash are worked out)", () => {
    assert.deepEqual(files("/h/", ["/a/"]).map((f) => f.file), [
      join("/h/", ".claude", "settings.json"),
      join("/a/", ".claude", "settings.json"),
      join("/a/", ".claude", "settings.local.json"),
    ]);
  });
});

describe("parse(text)", () => {
  const empty = { deny: [], ask: [], allow: [] };

  test("throws: not JSON, the empty text, JSON that is not an object", () => {
    for (const bad of ["", "not json", "{", "   ", "null", "[]", '["permissions"]', "5", '"text"', "true"]) {
      assert.throws(() => parse(bad), undefined, JSON.stringify(bad));
    }
  });

  test("an object with no key permissions: three empty lists", () => {
    assert.deepEqual(parse("{}"), empty);
    assert.deepEqual(parse('{"model":"x","hooks":{}}'), empty);
  });

  test("permissions that is not an object: throws", () => {
    for (const bad of ["null", "[]", '["deny"]', '"x"', "5", "true"]) {
      assert.throws(() => parse(`{"permissions":${bad}}`), undefined, bad);
    }
  });

  test("a list absent: []; the three read as written", () => {
    assert.deepEqual(parse('{"permissions":{}}'), empty);
    assert.deepEqual(parse('{"permissions":{"deny":["a","b"]}}'), { deny: ["a", "b"], ask: [], allow: [] });
    assert.deepEqual(parse('{"permissions":{"ask":["c"],"allow":["d","e"]}}'), { deny: [], ask: ["c"], allow: ["d", "e"] });
  });

  test("a list present and not a list: throws", () => {
    for (const key of ["deny", "ask", "allow"]) {
      for (const bad of ["null", '"Bash"', "5", "{}", "true"]) {
        assert.throws(() => parse(`{"permissions":{"${key}":${bad}}}`), undefined, `${key} ${bad}`);
      }
    }
  });

  test("an item that is not a string is left out, the strings around it kept in order", () => {
    const text = '{"permissions":{"deny":["a",1,null,"b",{"x":1},["c"],true,"d"],"ask":[5],"allow":[null,"e"]}}';
    assert.deepEqual(parse(text), { deny: ["a", "b", "d"], ask: [], allow: ["e"] });
  });

  test("every other key of the file and of permissions is ignored; the items are kept as written", () => {
    const text = JSON.stringify({
      model: "x",
      hooks: { PreToolUse: [] },
      permissions: { defaultMode: "plan", additionalDirectories: ["/x"], deny: ["  Bash(rm *) ", ""], ask: [], allow: [] },
    });
    assert.deepEqual(parse(text), { deny: ["  Bash(rm *) ", ""], ask: [], allow: [] });
  });
});

describe("what a rule is", () => {
  const everyCall = [
    run("rm x"),
    on("read", "/w/a"),
    on("edit", "/w/a"),
    on("write", "/w/a"),
  ];

  test("only Bash, Read, Edit and Write are read; every other rule matches nothing", () => {
    const others = [
      "WebFetch(domain:x)",
      "mcp__server__tool",
      "Agent",
      "bash(rm *)",
      "bash",
      "read",
      "BASH",
      "Grep(x)",
      "Bash (rm *)", // the name is everything before the first `(`: "Bash " is not Bash
      "Read (*)",
      "Task(Bash)",
      "",
      "   ",
      "(rm *)",
    ];
    for (const rule of others) for (const call of everyCall) check(rule, call, false);
  });

  test("a `(` with no `)` at the end matches nothing", () => {
    for (const rule of ["Bash(rm *", "Bash(", "Read(./.env", "Bash(rm *) x", "Bash(rm *)) x", "Read(./.env)."]) {
      check(rule, run("rm x"), false);
      check(rule, on("read", "/w/.env"), false);
    }
  });

  test("the text of the rule is trimmed", () => {
    check("  Bash(rm *)  ", run("rm x"), true);
    check("\tRead(./.env)\n", on("read", "/w/.env"), true);
    check("  Bash  ", run("anything"), true);
  });

  test("the spec is everything between the first ( and the last )", () => {
    check("Bash(echo (a))", run("echo (a)"), true);
    check("Bash(echo (a))", run("echo a"), false);
    check("Read(./a(b))", on("read", "/w/a(b)"), true);
    check("Read(./a(b))", on("read", "/w/ab"), false);
  });

  test("each name speaks of its actions: Bash run; Read read; Edit edit and write; Write write", () => {
    const table = {
      Bash: ["run"],
      Read: ["read"],
      Edit: ["edit", "write"],
      Write: ["write"],
    };
    const calls = { run: run("x"), read: on("read", "/w/a"), edit: on("edit", "/w/a"), write: on("write", "/w/a") };
    for (const [name, actions] of Object.entries(table)) {
      for (const rule of [name, `${name}()`]) {
        for (const [action, call] of Object.entries(calls)) {
          check(rule, call, actions.includes(action));
        }
      }
    }
  });

  test("a rule with no spec or an empty spec matches every call of its actions, whatever the anchors", () => {
    const none = { home: "/h", anchors: [] };
    check("Read", on("read", "/anywhere/at/all"), true, none);
    check("Read()", on("read", "/anywhere/at/all"), true, none);
    check("Edit", on("write", "/q"), true, none);
    check("Edit()", on("edit", "/q"), true, none);
    check("Write", on("write", "/q"), true, none);
    check("Bash", run(""), true, none);
  });
});

describe("Bash(<spec>) against a command", () => {
  test("`Bash(rm *)`: rm -rf x, rm, ls; rm x, ls && rm x and the padded one; not rmdir x, not sudo rm x", () => {
    for (const c of ["rm -rf x", "rm", "ls; rm x", "ls && rm x", "  rm x  ", "rm "]) check("Bash(rm *)", run(c), true);
    for (const c of ["rmdir x", "sudo rm x", "echo rm", "ls"]) check("Bash(rm *)", run(c), false);
  });

  test("`Bash(rm *)` matches no call of read, edit or write", () => {
    for (const action of ["read", "edit", "write"]) check("Bash(rm *)", on(action, "/w/rm x"), false);
  });

  test("`Bash(git * main)` matches git push origin main", () => {
    check("Bash(git * main)", run("git push origin main"), true);
    check("Bash(git * main)", run("git push origin main2"), false);
    check("Bash(git * main)", run("git main"), false);
  });

  test("`Bash(npm test)` matches `npm test` only", () => {
    check("Bash(npm test)", run("npm test"), true);
    check("Bash(npm test)", run("npm test x"), false);
    check("Bash(npm test)", run("npm tests"), false);
    check("Bash(npm test)", run("xnpm test"), false);
    check("Bash(npm test)", run("npm  test"), false);
    check("Bash(npm test)", run("NPM TEST"), false);
  });

  test("`Bash(*)` and `Bash` match every command", () => {
    for (const rule of ["Bash(*)", "Bash"]) for (const c of ["ls", "rm -rf /", "", "a\nb", "  "]) check(rule, run(c), true);
  });

  test("the candidates: split at &&, ||, ;, |, &, and line breaks; each piece trimmed", () => {
    for (const c of ["ls && rm x", "ls || rm x", "ls ; rm x", "ls;rm x", "ls | rm x", "ls|rm x", "ls & rm x", "ls&rm x", "ls\nrm x", "ls\r\nrm x", "ls\n\n  rm x  \n", "a && b || c; d | rm x & e"]) {
      check("Bash(rm *)", run(c), true);
    }
    check("Bash(ls)", run("ls;"), true);
    check("Bash(ls)", run(";;ls&&"), true);
    check("Bash(ls)", run("ls -a; pwd"), false);
  });

  test("the whole command trimmed is a candidate too", () => {
    check("Bash(cd a && make)", run("cd a && make"), true);
    check("Bash(cd a && make)", run("  cd a && make \n"), true);
    check("Bash(a | b)", run("a | b"), true);
  });

  test("quotes are not looked at: a `;` inside quotes splits too", () => {
    check("Bash(rm *)", run('echo "a; rm x"'), true);
    check("Bash(rm *)", run("echo 'ok' && echo \"x\" | rm y"), true);
  });

  test("a `*` stands for any run of characters: the empty run, spaces and line breaks included", () => {
    check("Bash(a*b)", run("ab"), true);
    check("Bash(a*b)", run("a   b"), true);
    check("Bash(a*b)", run("axxxb"), true);
    check("Bash(a*b)", run("a\nb"), true);
    check("Bash(a * b)", run("a x\ny b"), true); // the whole command is the candidate; the line break is in the star
    check("Bash(a*b)", run("a b c"), false);
    check("Bash(*b)", run("x a b"), true);
    check("Bash(**)", run("anything"), true);
  });

  test("every other character stands for itself, case counting", () => {
    check("Bash(ls ?)", run("ls ?"), true);
    check("Bash(ls ?)", run("ls a"), false);
    check("Bash(a.b)", run("a.b"), true);
    check("Bash(a.b)", run("axb"), false);
    check("Bash(a+b)", run("a+b"), true);
    check("Bash(a+b)", run("aab"), false);
    check("Bash(echo $(x))", run("echo $(x)"), true);
    check("Bash(echo ^x$)", run("echo ^x$"), true);
    check("Bash(echo ^x$)", run("echo x"), false);
    check("Bash(RM *)", run("rm x"), false);
    check("Bash(echo héllo)", run("echo héllo"), true);
    check("Bash(echo héllo)", run("echo HÉLLO"), false);
  });

  test("a spec that ends with a space and `*` also matches the candidate equal to what stands before them", () => {
    check("Bash(rm *)", run("rm"), true);
    check("Bash(git push *)", run("git push"), true);
    check("Bash(git push *)", run("git pus"), false);
    check("Bash(git push *)", run("git pushx"), false);
  });

  test("a spec that ends with `:*` is a prefix", () => {
    for (const c of ["npm run test", "npm run test:unit", "npm run tests", "npm run test -- x", "ls && npm run test:x", "  npm run test  "]) {
      check("Bash(npm run test:*)", run(c), true);
    }
    for (const c of ["npm run tes", "xnpm run test", "NPM run test", "npm  run test", "ls"]) check("Bash(npm run test:*)", run(c), false);
    check("Bash(rm:*)", run("rmdir x"), true);
    check("Bash(:*)", run("anything"), true);
  });
});

describe("Read(<spec>), Edit(<spec>), Write(<spec>) against a path: the table", () => {
  const table = [
    ["Read(./.env)", ["/w/.env"], ["/w/sub/.env", "/w/.env2"]],
    ["Read(.env)", ["/w/.env", "/w/sub/.env"], ["/x/.env"]],
    ["Read(./secrets/**)", ["/w/secrets/a/b.txt"], ["/w/secrets2/a"]],
    ["Read(secrets)", ["/w/secrets/k", "/w/x/secrets/k"], ["/w/secrets.txt"]],
    ["Read(*.pem)", ["/w/a/b.pem", "/w/k.pem"], ["/w/k.pem.txt"]],
    ["Read(src/*.js)", ["/w/src/a.js"], ["/w/src/x/a.js"]],
    ["Read(/docs/**)", ["/w/docs/a/b.md"], ["/docs/a.md"]],
    ["Read(~/.ssh/**)", ["/h/.ssh/id"], ["/w/.ssh/id"]],
  ];
  for (const [rule, yes, no] of table) {
    test(rule, () => {
      for (const p of yes) check(rule, on("read", p), true);
      for (const p of no) check(rule, on("read", p), false);
    });
  }

  test("Edit(//etc/hosts): /etc/hosts for edit and for write, not for read", () => {
    check("Edit(//etc/hosts)", on("edit", "/etc/hosts"), true);
    check("Edit(//etc/hosts)", on("write", "/etc/hosts"), true);
    check("Edit(//etc/hosts)", on("read", "/etc/hosts"), false);
    check("Edit(//etc/hosts)", on("edit", "/w/etc/hosts"), false);
  });

  test("Write(./out/**): /w/out/a.txt for write, not for edit nor read", () => {
    check("Write(./out/**)", on("write", "/w/out/a.txt"), true);
    check("Write(./out/**)", on("edit", "/w/out/a.txt"), false);
    check("Write(./out/**)", on("read", "/w/out/a.txt"), false);
  });

  test("Read: every path for read, any path for edit not", () => {
    check("Read", on("read", "/w/x"), true);
    check("Read", on("read", "/elsewhere/y"), true);
    check("Read", on("edit", "/w/x"), false);
    check("Read", on("write", "/w/x"), false);
  });
});

describe("Read(<spec>): the forms of a spec", () => {
  test("`//` is an absolute path, with no anchor needed", () => {
    const none = { home: "/h", anchors: [] };
    check("Read(//etc/hosts)", on("read", "/etc/hosts"), true, none);
    check("Read(//etc/**)", on("read", "/etc/a/b"), true, none);
    check("Read(//etc/hosts)", on("read", "/w/etc/hosts"), false);
  });

  test("`~/` is home and the rest, with no anchor needed", () => {
    const none = { home: "/h", anchors: [] };
    check("Read(~/.ssh/**)", on("read", "/h/.ssh/id"), true, none);
    check("Read(~/.aws)", on("read", "/h/.aws/credentials"), true, none);
    check("Read(~/.ssh/**)", on("read", "/x/h/.ssh/id"), false, none);
    check("Read(~/.ssh/**)", on("read", "/h2/.ssh/id"), false, none);
    check("Read(~/.ssh/**)", on("read", "/h/.ssh/id"), true, { home: "/h", anchors: ["/w", "/v"] });
    check("Read(~/.ssh/**)", on("read", "/other/.ssh/id"), false, { home: "/other2", anchors: ["/w"] });
    check("Read(~/.ssh/**)", on("read", "/other/.ssh/id"), true, { home: "/other", anchors: ["/w"] });
  });

  test("with no anchor, the other four forms give no pattern: the rule matches no path", () => {
    const none = { home: "/h", anchors: [] };
    for (const rule of ["Read(/docs/**)", "Read(./.env)", "Read(.env)", "Read(src/*.js)", "Read(secrets)", "Read(*.pem)"]) {
      for (const p of ["/docs/a", "/.env", "/w/.env", "/w/src/a.js", "/secrets/k", "/a.pem", "/src/a.js"]) {
        check(rule, on("read", p), false, none);
      }
    }
  });

  test("each anchor gives its patterns: a path under any anchor matches", () => {
    const two = { home: "/h", anchors: ["/w", "/v"] };
    check("Read(./.env)", on("read", "/w/.env"), true, two);
    check("Read(./.env)", on("read", "/v/.env"), true, two);
    check("Read(./.env)", on("read", "/u/.env"), false, two);
    check("Read(/docs/**)", on("read", "/v/docs/a"), true, two);
    check("Read(src/*.js)", on("read", "/v/src/a.js"), true, two);
    check("Read(.env)", on("read", "/v/deep/er/.env"), true, two);
  });

  test("a name with no `/`, or one only as last character, is the name at any depth under the anchor", () => {
    check("Read(secrets/)", on("read", "/w/secrets/k"), true);
    check("Read(secrets/)", on("read", "/w/x/y/secrets/k"), true);
    check("Read(secrets/)", on("read", "/w/secrets"), true);
    check("Read(secrets/)", on("read", "/w/secrets.txt"), false);
    check("Read(.env)", on("read", "/w/a/b/c/.env"), true);
    check("Read(.env)", on("read", "/w/.env"), true);
  });

  test("a spec holding a `/` before its last character is under the anchor, at no depth", () => {
    check("Read(src/a.js)", on("read", "/w/src/a.js"), true);
    check("Read(src/a.js)", on("read", "/w/x/src/a.js"), false);
    check("Read(**/*.pem)", on("read", "/w/k.pem"), true);
    check("Read(**/*.pem)", on("read", "/w/a/b/k.pem"), true);
    check("Read(**/*.pem)", on("read", "/x/k.pem"), false);
  });

  test("a `/` at the end of a pattern is removed", () => {
    check("Read(./secrets/)", on("read", "/w/secrets/a/b"), true);
    check("Read(./secrets/)", on("read", "/w/secrets"), true);
    check("Read(./secrets/)", on("read", "/w/secrets2/a"), false);
    check("Read(//etc/)", on("read", "/etc/hosts"), true);
  });

  test("a pattern matches the whole path or one of the folders above it", () => {
    check("Read(./a/b)", on("read", "/w/a/b"), true);
    check("Read(./a/b)", on("read", "/w/a/b/c/d"), true);
    check("Read(./a/b)", on("read", "/w/a"), false);
    check("Read(./a)", on("read", "/w/ab"), false);
    check("Read(./sec*)", on("read", "/w/secrets/x/y"), true);
    check("Read(.env)", on("read", "/w/.env/x"), true);
    check("Read(./secrets/**)", on("read", "/w/secrets"), true); // `**` stands for none
    check("Read(./a/**/c.txt)", on("read", "/w/a/c.txt"), true);
    check("Read(./a/**/c.txt)", on("read", "/w/a/b/c.txt"), true);
    check("Read(./a/**/c.txt)", on("read", "/w/a/b/d/c.txt"), true);
    check("Read(./a/**/c.txt)", on("read", "/w/a/c.txt.bak"), false);
    check("Read(./a/**/c.txt)", on("read", "/w/b/c.txt"), false);
  });

  test("`*` is a run of characters of one piece, the empty run included; `?` is one character", () => {
    check("Read(./a*b)", on("read", "/w/ab"), true);
    check("Read(./a*b)", on("read", "/w/axxb"), true);
    check("Read(./a*b)", on("read", "/w/a/b"), false);
    check("Read(./a?c)", on("read", "/w/abc"), true);
    check("Read(./a?c)", on("read", "/w/ac"), false);
    check("Read(./a?c)", on("read", "/w/abbc"), false);
    check("Read(./a?c)", on("read", "/w/a/c"), false);
    check("Read(./*)", on("read", "/w/anything"), true);
    check("Read(./*/x)", on("read", "/w/d/x"), true);
    check("Read(./*/x)", on("read", "/w/d/e/x"), false);
  });

  test("every other character stands for itself, case counting; spaces and non-ASCII are kept", () => {
    check("Read(./a.b)", on("read", "/w/a.b"), true);
    check("Read(./a.b)", on("read", "/w/axb"), false);
    check("Read(./a+b)", on("read", "/w/aab"), false);
    check("Read(./a+b)", on("read", "/w/a+b"), true);
    check("Read(./.ENV)", on("read", "/w/.env"), false);
    check("Read(./my docs/é.txt)", on("read", "/w/my docs/é.txt"), true);
    check("Read(./my docs/é.txt)", on("read", "/w/my docs/É.txt"), false);
    check("Read(./my docs/é.txt)", on("read", "/w/my  docs/é.txt"), false);
  });

  test("the rule matches the call when one pattern matches one of the call's paths", () => {
    check("Read(./.env)", on("read", "/x/y/.env", "/w/.env"), true);
    check("Read(./.env)", on("read", "/w/.env", "/x/y/.env"), true);
    check("Read(./.env)", on("read", "/x/y/.env", "/z/.env"), false);
    check("Read(~/.ssh/**)", on("read", "/private/h/.ssh/id", "/h/.ssh/id"), true);
  });

  test("Edit covers edit and write; Write only write; both with the same spec forms", () => {
    for (const action of ["edit", "write"]) {
      check("Edit(./src/**)", on(action, "/w/src/a.js"), true);
      check("Edit(./src/**)", on(action, "/w/lib/a.js"), false);
    }
    check("Edit(./src/**)", on("read", "/w/src/a.js"), false);
    check("Write(src)", on("write", "/w/x/src/a.js"), true);
    check("Write(src)", on("edit", "/w/x/src/a.js"), false);
    check("Write(~/x)", on("write", "/h/x/y"), true);
    check("Read(./.env)", run("cat /w/.env"), false);
  });
});

describe("ownCall(tool, args, cwd)", () => {
  test("Bash with a command that is a string: a run call", () => {
    assert.deepEqual(ownCall("Bash", { command: "ls -a" }, "/w"), { action: "run", command: "ls -a" });
    assert.deepEqual(ownCall("Bash", { command: "ls", description: "x", timeout: 5 }, "/w"), { action: "run", command: "ls" });
  });

  test("Read, Edit and Write with a file_path: one resolved path", () => {
    for (const [tool, action] of [["Read", "read"], ["Edit", "edit"], ["Write", "write"]]) {
      assert.deepEqual(ownCall(tool, { file_path: "a.txt" }, "/w"), { action, paths: [resolve("/w", "a.txt")] });
      assert.deepEqual(ownCall(tool, { file_path: "sub/../b/./c.txt" }, "/w/x"), { action, paths: [resolve("/w/x", "sub/../b/./c.txt")] });
      assert.deepEqual(ownCall(tool, { file_path: "/abs/p.txt" }, "/w"), { action, paths: ["/abs/p.txt"] });
      assert.deepEqual(ownCall(tool, { file_path: "../up.txt" }, "/w/x"), { action, paths: [resolve("/w/x", "../up.txt")] });
      assert.deepEqual(ownCall(tool, { file_path: "d/", old_string: "q", content: "z" }, "/w"), { action, paths: [resolve("/w", "d/")] });
    }
  });

  test("another tool name: null", () => {
    for (const tool of ["Grep", "Agent", "bash", "read", "BASH", "Bash ", "WebFetch", "", "Glob", "mcp__x__y"]) {
      assert.equal(ownCall(tool, { command: "ls", file_path: "a" }, "/w"), null, tool);
    }
  });

  test("args that is not a plain object: null", () => {
    for (const tool of ["Bash", "Read", "Edit", "Write"]) {
      for (const bad of [undefined, null, [], ["ls"], "ls", 5, true]) {
        assert.equal(ownCall(tool, bad, "/w"), null, `${tool} ${JSON.stringify(bad)}`);
      }
    }
  });

  test("the named argument absent or of another kind: null", () => {
    for (const bad of [undefined, null, 5, true, ["ls"], { a: 1 }]) {
      assert.equal(ownCall("Bash", { command: bad }, "/w"), null, `Bash ${JSON.stringify(bad)}`);
    }
    assert.equal(ownCall("Bash", {}, "/w"), null);
    assert.equal(ownCall("Bash", { file_path: "/a" }, "/w"), null);
    for (const tool of ["Read", "Edit", "Write"]) {
      for (const bad of [undefined, null, "", 5, true, ["a"], { a: 1 }]) {
        assert.equal(ownCall(tool, { file_path: bad }, "/w"), null, `${tool} ${JSON.stringify(bad)}`);
      }
      assert.equal(ownCall(tool, {}, "/w"), null);
      assert.equal(ownCall(tool, { path: "a" }, "/w"), null);
      assert.equal(ownCall(tool, { command: "ls" }, "/w"), null);
    }
  });
});
