import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import * as core from "../src/index.js";
import { settingsOf, faultOf, deepFreeze, printedBy } from "./helpers.js";

// The functions are read off the module at call time, so a missing one fails its own test and not the file.
const decideCommand = (...args) => core.decideCommand(...args);
const shellOffMessage = (...args) => core.shellOffMessage(...args);
const rootFolders = (...args) => core.rootFolders(...args);
const hostDenial = (...args) => core.hostDenial(...args);
const askMessage = (...args) => core.askMessage(...args);
const askRefusal = (...args) => core.askRefusal(...args);

const ABS = resolve("/work/project");
const ABS2 = resolve("/work/other");
const withOnetool = (onetool) => ({ mcpServers: {}, onetool });
const problemsOf = (onetool) => faultOf(withOnetool(onetool)).problems;
const FOLDERS = "onetool.shell.folders: must be a list of full paths, at least one";
const HOST_RULES = "onetool.hostRules: must be true or false";
const HOST_SERVERS = "onetool.hostServers: must be a list of server names";

// -- the exports -----------------------------------------------------------------------------------------------

describe("step 5: the exports", () => {
  test("rootFolders and hostDenial are functions, SHELL_NO_FOLDERS is a text and not a function", () => {
    assert.equal(typeof core.rootFolders, "function");
    assert.equal(typeof core.hostDenial, "function");
    assert.equal(typeof core.SHELL_NO_FOLDERS, "string");
  });
});

// -- shell.folders may be left out -----------------------------------------------------------------------------

describe("step 5: shell.folders may be left out", () => {
  const shellOf = (shell) => settingsOf(withOnetool({ shell })).shell;

  test('"shell": {} is valid and gives exactly folders null and three empty lists', () => {
    const got = shellOf({});
    assert.deepEqual(got, { folders: null, allow: [], deny: [], ask: [] });
    assert.deepEqual(Object.keys(got).sort(), ["allow", "ask", "deny", "folders"]);
    assert.equal(got.folders, null);
  });

  test("the other keys of shell given, folders left out: folders is null and the lists are kept as written", () => {
    const got = shellOf({ allow: ["git *"], deny: ["rm *", "rm *"], ask: ["git push*"] });
    assert.deepEqual(got, { folders: null, allow: ["git *"], deny: ["rm *", "rm *"], ask: ["git push*"] });
  });

  test("folders given and valid: as written, as before", () => {
    assert.deepEqual(shellOf({ folders: [ABS2, ABS, ABS2] }), { folders: [ABS2, ABS, ABS2], allow: [], deny: [], ask: [] });
  });

  test("folders present is tested as before, null and the empty list included: null is not absent", () => {
    for (const folders of [null, [], "", ABS, {}, 5, true, [null], [""], ["relative/path"], [5], [ABS, "relative/path"]]) {
      assert.deepEqual(problemsOf({ shell: { folders } }), [FOLDERS], JSON.stringify(folders));
    }
  });

  test("folders left out gives no problem of folders, whatever else of shell is wrong", () => {
    assert.deepEqual(problemsOf({ shell: { zz: 1 } }), ["onetool.shell.zz: unknown key"]);
    assert.deepEqual(problemsOf({ shell: { allow: 5, deny: 5, ask: 5 } }), [
      "onetool.shell.allow: must be a list of command patterns",
      "onetool.shell.deny: must be a list of command patterns",
      "onetool.shell.ask: must be a list of command patterns",
    ]);
  });

  test("the shell is on: trail is true by default, as for a shell with folders", () => {
    assert.equal(settingsOf(withOnetool({ shell: {} })).trail, true);
    assert.equal(settingsOf(withOnetool({ shell: {}, trail: false })).trail, false);
  });

  test("the shell is still off when the key is absent: trail true, shell null", () => {
    const got = settingsOf(withOnetool({ hostRules: false }));
    assert.equal(got.shell, null);
    assert.equal(got.trail, true);
  });

  test("a server named `shell` is taken whenever the file has onetool.shell, with or without folders", () => {
    const CMD = { command: "node" };
    const got = settingsOf({ mcpServers: { shell: CMD }, onetool: { shell: {} } });
    assert.deepEqual(got.servers, []);
    assert.deepEqual(got.bad, [{ name: "shell", reason: "the name is taken by the built-in shell" }]);
    const got2 = settingsOf({ mcpServers: { shell: CMD }, onetool: { shell: { allow: [] } } });
    assert.deepEqual(got2.bad, [{ name: "shell", reason: "the name is taken by the built-in shell" }]);
  });

  test("a shell with no folders, read by decideCommand, allows what no rule refuses", () => {
    const shell = shellOf({ deny: ["rm *"] });
    assert.deepEqual(decideCommand(shell, "ls"), { allowed: true });
    assert.equal(decideCommand(shell, "rm x").allowed, false);
  });
});

// -- hostRules and hostServers ---------------------------------------------------------------------------------

describe("step 5: hostRules and hostServers in what readSettings returns", () => {
  test("neither in the file: hostRules true, hostServers []", () => {
    for (const file of [{ mcpServers: {} }, withOnetool({}), withOnetool({ searchLimit: 3 }), withOnetool({ shell: {} })]) {
      const got = settingsOf(file);
      assert.equal(got.hostRules, true);
      assert.deepEqual(got.hostServers, []);
    }
  });

  test("the whole returned object, with both given and the shell on without folders", () => {
    const got = settingsOf({
      mcpServers: { s: { command: "node" } },
      onetool: {
        shell: {},
        hostRules: false,
        hostServers: ["claude", "s", "claude", "nothing"],
      },
    });
    assert.deepEqual(got, {
      servers: [{ name: "s", command: "node", args: [], env: {} }],
      bad: [],
      answerLimit: 8000,
      timeoutSeconds: 60,
      connectSeconds: 30,
      searchLimit: 10,
      stateLimit: 10000000,
      allow: [],
      deny: [],
      ask: [],
      shell: { folders: null, allow: [], deny: [], ask: [] },
      trail: true,
      log: true,
      logFolder: null,
      hostRules: false,
      hostServers: ["claude", "s", "claude", "nothing"],
      backgroundSeconds: 7200,
      maxJobs: 3,
      libraryCap: 50,
      instructions: true,
    });
  });

  test("the returned keys are those of before plus hostRules and hostServers", () => {
    assert.deepEqual(Object.keys(settingsOf({ mcpServers: {} })).sort(), [
      "allow",
      "answerLimit",
      "ask",
      "backgroundSeconds",
      "bad",
      "connectSeconds",
      "deny",
      "hostRules",
      "hostServers",
      "instructions",
      "libraryCap",
      "log",
      "logFolder",
      "maxJobs",
      "searchLimit",
      "servers",
      "shell",
      "stateLimit",
      "timeoutSeconds",
      "trail",
    ]);
  });

  test("hostRules true and false are kept", () => {
    assert.equal(settingsOf(withOnetool({ hostRules: true })).hostRules, true);
    assert.equal(settingsOf(withOnetool({ hostRules: false })).hostRules, false);
  });

  test("hostServers is kept as written: order and repeats, and names no entry of mcpServers has", () => {
    assert.deepEqual(settingsOf(withOnetool({ hostServers: [] })).hostServers, []);
    assert.deepEqual(settingsOf(withOnetool({ hostServers: ["b", "a", "b"] })).hostServers, ["b", "a", "b"]);
    const got = settingsOf({ mcpServers: { a: { command: "node" } }, onetool: { hostServers: ["a", "nobody", "A"] } });
    assert.deepEqual(got.hostServers, ["a", "nobody", "A"]);
    assert.deepEqual(got.bad, []);
  });

  test("the two keys are not unknown keys", () => {
    const got = settingsOf(withOnetool({ hostRules: true, hostServers: ["x"] }));
    assert.equal(got.bad.length, 0);
    for (const key of ["hostRules", "hostServers"]) {
      assert.ok(!problemsOf({ [key]: "x", foo: 1 }).includes(`onetool.${key}: unknown key`), key);
    }
  });

  test("a wrong case of the new keys stays unknown", () => {
    assert.deepEqual(problemsOf({ hostrules: true }), ["onetool.hostrules: unknown key"]);
    assert.deepEqual(problemsOf({ HostServers: [] }), ["onetool.HostServers: unknown key"]);
  });

  test("hostRules not true or false: null counts as present", () => {
    for (const value of [null, "true", "false", 1, 0, [], {}, "", [true]]) {
      assert.deepEqual(problemsOf({ hostRules: value }), [HOST_RULES], JSON.stringify(value));
    }
  });

  test("hostServers not a list of names: a string, null, an item that is empty, white space only or not a string", () => {
    const bad = [null, "claude", {}, 5, true, [""], ["  "], ["\t\n"], [null], [5], [["a"]], [{}], ["a", ""], ["a", null], ["a", 1]];
    for (const value of bad) {
      assert.deepEqual(problemsOf({ hostServers: value }), [HOST_SERVERS], JSON.stringify(value));
    }
  });

  test("the problems of the two come after the one of logFolder, hostRules first, in the order of the table", () => {
    const got = faultOf({
      onetool: {
        hostServers: 1,
        hostRules: 1,
        logFolder: "logs",
        log: 1,
        trail: null,
        shell: { ask: 1, deny: 1, allow: 1, folders: [], zz: 1 },
        ask: 5,
        deny: 5,
        searchLimit: 0,
        answerLimit: 0,
        zzz: 1,
      },
    });
    assert.deepEqual(got.problems, [
      "mcpServers: missing",
      "onetool.zzz: unknown key",
      "onetool.answerLimit: must be a whole number from 100 to 1000000",
      "onetool.searchLimit: must be a whole number from 1 to 100",
      "onetool.deny: must be a list of patterns",
      "onetool.ask: must be a list of patterns",
      "onetool.shell.zz: unknown key",
      FOLDERS,
      "onetool.shell.allow: must be a list of command patterns",
      "onetool.shell.deny: must be a list of command patterns",
      "onetool.shell.ask: must be a list of command patterns",
      "onetool.trail: must be true or false",
      "onetool.log: must be true or false",
      "onetool.logFolder: must be a full path",
      HOST_RULES,
      HOST_SERVERS,
    ]);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("no problem holds a value of the file", () => {
    const problems = problemsOf({ hostRules: "SECRET-1", hostServers: ["SECRET-2", ""] });
    assert.equal(problems.length, 2);
    for (const p of problems) assert.ok(!p.includes("SECRET"), p);
    const [q] = problemsOf({ hostServers: "SECRET-3" });
    assert.ok(!q.includes("SECRET"));
  });
});

// -- rootFolders -----------------------------------------------------------------------------------------------

describe("step 5: rootFolders", () => {
  const root = (uri) => ({ uri, name: "n" });

  test("the two examples of the meeting point", () => {
    assert.deepEqual(rootFolders([root("file:///tmp/a/")]), [resolve("/tmp/a")]);
    assert.deepEqual(rootFolders([root("file:///tmp/my%20project")]), [resolve("/tmp/my project")]);
  });

  test("the folders come in the order of the roots", () => {
    assert.deepEqual(rootFolders([root("file:///tmp/b"), root("file:///tmp/a"), root("file:///tmp/c")]), [
      resolve("/tmp/b"),
      resolve("/tmp/a"),
      resolve("/tmp/c"),
    ]);
  });

  test("the address is made a path by fileURLToPath then path.resolve: dots and percent escapes are read", () => {
    assert.deepEqual(rootFolders([root("file:///tmp/a/../b"), root("file:///tmp/a/./b/"), root("file:///tmp/%C3%A9")]), [
      resolve("/tmp/b"),
      resolve("/tmp/a/b"),
      resolve("/tmp/é"),
    ]);
  });

  test("another scheme, a uri that is not a string, a host that is not this machine, null: left out", () => {
    const got = rootFolders([
      root("https://x"),
      root("untitled:1"),
      { uri: 5, name: "n" },
      { uri: null },
      { uri: ["file:///tmp/x"] },
      { name: "no uri" },
      root("file://other/x"),
      null,
      root("file:///tmp/kept"),
    ]);
    assert.deepEqual(got, [resolve("/tmp/kept")]);
  });

  test("an item that is not an object: a list, a string, a number, null, undefined", () => {
    assert.deepEqual(rootFolders([["file:///tmp/x"], "file:///tmp/x", 5, null, undefined, true]), []);
  });

  test("`file://` in lower case only", () => {
    assert.deepEqual(rootFolders([root("FILE:///tmp/x"), root("File:///tmp/y"), root("file:///tmp/z")]), [resolve("/tmp/z")]);
  });

  test("an address that fileURLToPath refuses is left out (an encoded slash)", () => {
    assert.deepEqual(rootFolders([root("file:///tmp/a%2Fb"), root("file:///tmp/ok")]), [resolve("/tmp/ok")]);
  });

  test("a folder already in the result is not added again: the first place counts", () => {
    assert.deepEqual(rootFolders([root("file:///tmp/a"), root("file:///tmp/b"), root("file:///tmp/a/"), root("file:///tmp/a")]), [
      resolve("/tmp/a"),
      resolve("/tmp/b"),
    ]);
    assert.deepEqual(rootFolders([root("file:///tmp/b"), root("file:///tmp/a"), root("file:///tmp/b")]), [
      resolve("/tmp/b"),
      resolve("/tmp/a"),
    ]);
  });

  test("the key name is not read: absent, a number or the same name for two roots", () => {
    assert.deepEqual(rootFolders([{ uri: "file:///tmp/a" }, { uri: "file:///tmp/b", name: 5 }, { uri: "file:///tmp/c", name: "same" }]), [
      resolve("/tmp/a"),
      resolve("/tmp/b"),
      resolve("/tmp/c"),
    ]);
  });

  test("roots that is not a list, or an empty list: []", () => {
    for (const roots of [undefined, null, {}, { roots: [root("file:///tmp/a")] }, "file:///tmp/a", 5, true]) {
      assert.deepEqual(rootFolders(roots), [], JSON.stringify(roots));
    }
    assert.deepEqual(rootFolders([]), []);
    assert.deepEqual(rootFolders(), []);
  });

  test("the result is a new list, the argument is not changed, nothing is printed", () => {
    const roots = deepFreeze([root("file:///tmp/a"), root("https://x")]);
    const a = rootFolders(roots);
    const b = rootFolders(roots);
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
    assert.ok(Array.isArray(a));
    assert.deepEqual(printedBy(() => rootFolders(roots)), []);
  });
});

// -- SHELL_NO_FOLDERS and shellOffMessage ----------------------------------------------------------------------

describe("step 5: SHELL_NO_FOLDERS", () => {
  test("exactly the text of the meeting point", () => {
    assert.equal(core.SHELL_NO_FOLDERS, "no folder: onetool.shell.folders is not set and the host program gave none");
  });
});

describe("step 5: shellOffMessage(message, why)", () => {
  const OFF_TAIL = " (the shell is not switched on: see onetool.shell in the settings file)";
  const NAMES = ["$", "read", "write", "edit"];

  test("why no-folders: the four messages get the text of SHELL_NO_FOLDERS", () => {
    for (const name of NAMES) {
      const message = `ReferenceError: ${name} is not defined`;
      assert.equal(shellOffMessage(message, "no-folders"), `${message} (the shell has ${core.SHELL_NO_FOLDERS})`, name);
    }
  });

  test("the example of the meeting point, to the character", () => {
    assert.equal(
      shellOffMessage("ReferenceError: $ is not defined", "no-folders"),
      "ReferenceError: $ is not defined (the shell has no folder: onetool.shell.folders is not set and the host program gave none)",
    );
  });

  test("why no-folders: any other message is returned unchanged", () => {
    for (const message of [
      "ReferenceError: foo is not defined",
      "ReferenceError: Read is not defined",
      "ReferenceError: read is not defined.",
      "ReferenceError: read is not defined ",
      " ReferenceError: read is not defined",
      "ReferenceError: run is not defined",
      "TypeError: read is not defined",
      "read",
      "",
    ]) {
      assert.equal(shellOffMessage(message, "no-folders"), message, JSON.stringify(message));
    }
  });

  test('why "off", and why left out or undefined: as before, to the character', () => {
    for (const name of NAMES) {
      const message = `ReferenceError: ${name} is not defined`;
      assert.equal(shellOffMessage(message, "off"), message + OFF_TAIL, name);
      assert.equal(shellOffMessage(message, undefined), message + OFF_TAIL, name);
      assert.equal(shellOffMessage(message), message + OFF_TAIL, name);
    }
    assert.equal(shellOffMessage("ReferenceError: foo is not defined", "off"), "ReferenceError: foo is not defined");
    assert.equal(shellOffMessage("ReferenceError: read is not defined", "off").includes("the shell has"), false);
  });

  test("any other why throws TypeError", () => {
    for (const why of ["", "OFF", "Off", "No-Folders", "no folders", "no_folders", "on", " off", null, 5, true, {}, ["off"]]) {
      assert.throws(() => shellOffMessage("ReferenceError: read is not defined", why), TypeError, JSON.stringify(why));
      assert.throws(() => shellOffMessage("another message", why), TypeError, JSON.stringify(why));
    }
  });

  test("it prints nothing", () => {
    assert.deepEqual(printedBy(() => shellOffMessage("ReferenceError: $ is not defined", "no-folders")), []);
  });
});

// -- decideCommand with no rules -------------------------------------------------------------------------------

describe("step 5: decideCommand with no rules", () => {
  test("an undefined first argument throws TypeError, as null does", () => {
    for (const command of ["ls", "", "rm -rf x"]) {
      assert.throws(() => decideCommand(undefined, command), TypeError, command);
    }
    assert.throws(() => decideCommand(null, "ls"), TypeError);
  });

  test("no argument at all throws TypeError", () => {
    assert.throws(() => decideCommand(), TypeError);
  });

  test("an empty object is the way to say no rule: allowed", () => {
    assert.deepEqual(decideCommand({}, "ls"), { allowed: true });
    assert.deepEqual(decideCommand({}, ""), { allowed: true });
    assert.deepEqual(Object.keys(decideCommand({}, "ls")), ["allowed"]);
  });

  test("lists inside the object that are undefined are still [] and allow", () => {
    assert.deepEqual(decideCommand({ allow: undefined, deny: undefined, ask: undefined }, "ls"), { allowed: true });
  });

  test("decide is not changed: its undefined first argument is the default {}", () => {
    assert.deepEqual(core.decide(undefined, "p", "t"), { allowed: true });
    assert.deepEqual(core.decide(undefined, "p", "t").allowed, true);
  });
});

// -- the texts of a host program's rule ------------------------------------------------------------------------

describe("step 5: hostDenial", () => {
  test("the example of the meeting point", () => {
    assert.equal(
      hostDenial("shell.run", "Bash(rm *)", "/w/.claude/settings.json"),
      'onetool: shell.run is denied by the rule deny "Bash(rm *)" of the host program (/w/.claude/settings.json)',
    );
  });

  test("id, rule and file are put in as they are", () => {
    assert.equal(
      hostDenial("My Server.do it", 'Read(./a "b" *)', "/w/my dir/.claude/settings.local.json"),
      'onetool: My Server.do it is denied by the rule deny "Read(./a "b" *)" of the host program (/w/my dir/.claude/settings.local.json)',
    );
  });

  test("one line, nothing printed, a frozen argument is fine", () => {
    const text = hostDenial("a.b", "r", "/f");
    assert.equal(text.includes("\n"), false);
    assert.deepEqual(printedBy(() => hostDenial("a.b", "r", "/f")), []);
  });
});

describe("step 5: askMessage with a file", () => {
  const FILE = "/w/.claude/settings.json";

  test("the first two lines unchanged, the third names the host program and the file", () => {
    assert.equal(
      askMessage("shell.edit", "Edit(./notes.txt)", { path: "notes.txt" }, { file: FILE }),
      [
        "onetool: a program wants to call shell.edit.",
        'Arguments: {"path":"notes.txt"}',
        'The rule ask "Edit(./notes.txt)" of the host program (/w/.claude/settings.json) asks for your consent. Allow this call?',
      ].join("\n"),
    );
  });

  test("with arguments {}, to the character", () => {
    assert.equal(
      askMessage("practice.wipe", "practice.*", {}, { file: "/f" }),
      'onetool: a program wants to call practice.wipe.\nArguments: {}\nThe rule ask "practice.*" of the host program (/f) asks for your consent. Allow this call?',
    );
  });

  test("file absent or undefined: as before, to the character", () => {
    const args = { a: 1, b: ["x"] };
    const before = askMessage("a.b", "a.*", args);
    assert.equal(askMessage("a.b", "a.*", args, {}), before);
    assert.equal(askMessage("a.b", "a.*", args, { file: undefined }), before);
    assert.equal(askMessage("a.b", "a.*", args, { limit: 300, file: undefined }), before);
    assert.equal(before.split("\n")[2], 'The rule ask "a.*" asks for your consent. Allow this call?');
  });

  test("the first two lines are those of the version with no file", () => {
    const args = { k: "y".repeat(50) };
    const without = askMessage("a.b", "a.*", args, { limit: 20 }).split("\n");
    const withFile = askMessage("a.b", "a.*", args, { limit: 20, file: FILE }).split("\n");
    assert.equal(withFile.length, 3);
    assert.deepEqual(withFile.slice(0, 2), without.slice(0, 2));
  });

  test("the limit still cuts the arguments, with the default 300 and with a given one", () => {
    const args = { k: "y".repeat(400) };
    const json = JSON.stringify(args);
    const lines = askMessage("a.b", "a.*", args, { file: FILE }).split("\n");
    assert.equal(lines[1], `Arguments: ${json.slice(0, 300)}... (${json.length} characters)`);
    const lines2 = askMessage("a.b", "a.*", { a: 1 }, { limit: 6, file: FILE }).split("\n");
    assert.equal(lines2[1], 'Arguments: {"a":1... (7 characters)');
  });

  test("no line break at the end, nothing printed, arguments not changed", () => {
    const args = deepFreeze({ a: { b: 1 } });
    const text = askMessage("a.b", "a.*", args, deepFreeze({ file: FILE }));
    assert.equal(text.endsWith("\n"), false);
    assert.deepEqual(printedBy(() => askMessage("a.b", "a.*", args, { file: FILE })), []);
  });
});

describe("step 5: askRefusal with a file", () => {
  const FILE = "/w/.claude/settings.json";
  const CAUSES = {
    unsupported: "the host program cannot ask the person",
    decline: "the person said no",
    cancel: "the person gave no answer",
    failed: "the question failed",
  };

  test("the example of the meeting point", () => {
    assert.equal(
      askRefusal("shell.edit", "Edit(./notes.txt)", "decline", FILE),
      'onetool: shell.edit is refused by the rule ask "Edit(./notes.txt)" of the host program (/w/.claude/settings.json): the person said no',
    );
  });

  test("the four causes", () => {
    for (const [why, cause] of Object.entries(CAUSES)) {
      assert.equal(askRefusal("a.b", "a.*", why, "/f"), `onetool: a.b is refused by the rule ask "a.*" of the host program (/f): ${cause}`, why);
    }
  });

  test("file absent or undefined: as before, to the character", () => {
    for (const [why, cause] of Object.entries(CAUSES)) {
      const before = `onetool: a.b is refused by the rule ask "a.*": ${cause}`;
      assert.equal(askRefusal("a.b", "a.*", why), before, why);
      assert.equal(askRefusal("a.b", "a.*", why, undefined), before, why);
    }
  });

  test("another why throws TypeError, with a file as without", () => {
    for (const why of [undefined, "accept", "", "Decline", null, 5]) {
      assert.throws(() => askRefusal("a.b", "a.*", why, FILE), TypeError, String(why));
    }
  });

  test("id, rule and file are put in as they are; nothing is printed", () => {
    assert.equal(
      askRefusal("My Server.do it", 'Bash(a "b" *)', "cancel", "/w/my dir/settings.json"),
      'onetool: My Server.do it is refused by the rule ask "Bash(a "b" *)" of the host program (/w/my dir/settings.json): the person gave no answer',
    );
    assert.deepEqual(printedBy(() => askRefusal("a.b", "a.*", "failed", FILE)), []);
  });
});
