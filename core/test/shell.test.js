import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import * as core from "../src/index.js";
import { toolLine, cutAnswer } from "../src/index.js";
import { settingsOf, faultOf, deepFreeze, printedBy } from "./helpers.js";

// The functions are read off the module at call time, so a missing one fails its own test and not the file.
const decideCommand = (...args) => core.decideCommand(...args);
const shellOffMessage = (...args) => core.shellOffMessage(...args);
const callSize = (...args) => core.callSize(...args);
const formatTrail = (...args) => core.formatTrail(...args);
const withTrail = (...args) => core.withTrail(...args);
const shellLogArgs = (...args) => core.shellLogArgs(...args);
const logLine = (...args) => core.logLine(...args);
const logFileName = (...args) => core.logFileName(...args);

const ABS = resolve("/work/project");
const ABS2 = resolve("/work/other");
const withOnetool = (onetool) => ({ mcpServers: {}, onetool });
const problemsOf = (onetool) => faultOf(withOnetool(onetool)).problems;
const FOLDERS = "onetool.shell.folders: must be a list of full paths, at least one";

// -- the settings file -----------------------------------------------------------------------------------------

describe("step 4: the exports", () => {
  test("the nine new names are there, SHELL_TOOLS a list and not a function", () => {
    for (const name of ["decideCommand", "shellOffMessage", "callSize", "formatTrail", "withTrail", "shellLogArgs", "logLine", "logFileName"]) {
      assert.equal(typeof core[name], "function", name);
    }
    assert.ok(Array.isArray(core.SHELL_TOOLS));
  });
});

describe("step 4: shell, trail, log and logFolder in what readSettings returns", () => {
  test("none of the four keys in the file: shell null, trail true, log true, logFolder null", () => {
    for (const file of [{ mcpServers: {} }, withOnetool({}), withOnetool({ searchLimit: 3 })]) {
      const got = settingsOf(file);
      assert.equal(got.shell, null);
      assert.equal(got.trail, true);
      assert.equal(got.log, true);
      assert.equal(got.logFolder, null);
    }
  });

  test("the whole returned object, with the shell on and every key given", () => {
    const got = settingsOf({
      mcpServers: { s: { command: "node" } },
      onetool: {
        shell: { folders: [ABS, ABS2], allow: ["git *"], deny: ["rm *"], ask: ["git push*"] },
        trail: false,
        log: false,
        logFolder: ABS2,
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
      shell: { folders: [ABS, ABS2], allow: ["git *"], deny: ["rm *"], ask: ["git push*"] },
      trail: false,
      log: false,
      logFolder: ABS2,
      hostRules: true,
      hostServers: [],
      backgroundSeconds: 7200,
      maxJobs: 3,
      libraryCap: 50,
      instructions: true,
    });
  });

  test("the example of the meeting point reads", () => {
    const got = settingsOf({
      mcpServers: {},
      onetool: {
        shell: { folders: [ABS], allow: [], deny: ["rm *"], ask: ["git push*"] },
        trail: true,
        log: true,
        logFolder: ABS,
      },
    });
    assert.deepEqual(got.shell, { folders: [ABS], allow: [], deny: ["rm *"], ask: ["git push*"] });
    assert.equal(got.trail, true);
    assert.equal(got.log, true);
    assert.equal(got.logFolder, ABS);
  });

  test("the returned keys are those of before plus shell, trail, log and logFolder", () => {
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

  test("shell, trail, log and logFolder are not unknown keys", () => {
    const got = settingsOf(withOnetool({ shell: { folders: [ABS] }, trail: true, log: true, logFolder: ABS }));
    assert.equal(got.bad.length, 0);
    for (const key of ["shell", "trail", "log", "logFolder"]) {
      assert.ok(!problemsOf({ [key]: "x", foo: 1 }).includes(`onetool.${key}: unknown key`), key);
    }
  });

  test("`state` and a wrong case of the new keys stay unknown", () => {
    assert.deepEqual(problemsOf({ state: 1 }), ["onetool.state: unknown key"]);
    assert.deepEqual(problemsOf({ Shell: 1 }), ["onetool.Shell: unknown key"]);
    assert.deepEqual(problemsOf({ logfolder: 1 }), ["onetool.logfolder: unknown key"]);
  });
});

describe("step 4: shell", () => {
  const shellOf = (shell) => settingsOf(withOnetool({ shell })).shell;

  test("the key present means on: defaults filled in, exactly the four keys", () => {
    const got = shellOf({ folders: [ABS] });
    assert.deepEqual(got, { folders: [ABS], allow: [], deny: [], ask: [] });
    assert.deepEqual(Object.keys(got).sort(), ["allow", "ask", "deny", "folders"]);
  });

  test("the lists are kept as written, in order, repeats included, the folders too", () => {
    const got = shellOf({
      folders: [ABS2, ABS, ABS2],
      allow: ["git *", "ls*", "git *"],
      deny: ["rm *", "rm *"],
      ask: ["git push*", "*sudo*"],
    });
    assert.deepEqual(got.folders, [ABS2, ABS, ABS2]);
    assert.deepEqual(got.allow, ["git *", "ls*", "git *"]);
    assert.deepEqual(got.deny, ["rm *", "rm *"]);
    assert.deepEqual(got.ask, ["git push*", "*sudo*"]);
  });

  test("a command pattern may hold white space inside and an empty list is valid", () => {
    const got = shellOf({ folders: [ABS], allow: [], deny: ["git  push *", "a\tb"], ask: [] });
    assert.deepEqual(got.deny, ["git  push *", "a\tb"]);
    assert.deepEqual(got.allow, []);
  });

  test("not an object: that problem alone", () => {
    for (const shell of [null, true, false, [], [ABS], "x", "", 5]) {
      assert.deepEqual(problemsOf({ shell }), ["onetool.shell: not an object"], JSON.stringify(shell));
    }
  });

  test("a key of shell that is not one of the four is named, in the order of the file", () => {
    assert.deepEqual(problemsOf({ shell: { folders: [ABS], zeta: 1, alpha: 2 } }), [
      "onetool.shell.zeta: unknown key",
      "onetool.shell.alpha: unknown key",
    ]);
    assert.deepEqual(problemsOf({ shell: { Folders: [ABS], folders: [ABS] } }), ["onetool.shell.Folders: unknown key"]);
  });

  test("an unknown key does not hide the other problems of shell, and comes first", () => {
    assert.deepEqual(problemsOf({ shell: { zz: 1 } }), ["onetool.shell.zz: unknown key"]);
    assert.deepEqual(problemsOf({ shell: { folders: [ABS], allow: 5, zz: 1 } }), [
      "onetool.shell.zz: unknown key",
      "onetool.shell.allow: must be a list of command patterns",
    ]);
  });

  test("folders: not a list, empty or with an item that is not a full path", () => {
    const bad = [
      null,
      "",
      ABS,
      {},
      5,
      true,
      [],
      [null],
      [""],
      ["relative/path"],
      [5],
      [[ABS]],
      [ABS, "relative/path"],
      [ABS, null],
      ["./here"],
    ];
    for (const folders of bad) {
      const shell = folders === undefined ? {} : { folders };
      assert.deepEqual(problemsOf({ shell }), [FOLDERS], JSON.stringify(folders));
    }
  });

  test("allow, deny and ask of shell: a list of command patterns, each one named when not", () => {
    const bad = [null, "rm *", {}, 5, true, [""], ["  "], ["\t\n"], [null], [5], [["rm *"]], ["rm *", ""], [{}]];
    for (const key of ["allow", "deny", "ask"]) {
      for (const value of bad) {
        assert.deepEqual(
          problemsOf({ shell: { folders: [ABS], [key]: value } }),
          [`onetool.shell.${key}: must be a list of command patterns`],
          `${key} ${JSON.stringify(value)}`,
        );
      }
    }
  });

  test("allow, deny and ask of shell, all invalid: in that order, whatever the order of the file", () => {
    assert.deepEqual(problemsOf({ shell: { ask: 1, deny: 1, allow: 1, folders: [ABS] } }), [
      "onetool.shell.allow: must be a list of command patterns",
      "onetool.shell.deny: must be a list of command patterns",
      "onetool.shell.ask: must be a list of command patterns",
    ]);
  });

  test("folders comes before allow, deny and ask", () => {
    assert.deepEqual(problemsOf({ shell: { ask: 1, folders: [] } }), [
      FOLDERS,
      "onetool.shell.ask: must be a list of command patterns",
    ]);
  });

  test("the shell lists of the file are not the lists of onetool", () => {
    const got = settingsOf(withOnetool({ allow: ["a.*"], deny: ["a.x"], ask: ["a.y"], shell: { folders: [ABS], deny: ["rm *"] } }));
    assert.deepEqual([got.allow, got.deny, got.ask], [["a.*"], ["a.x"], ["a.y"]]);
    assert.deepEqual(got.shell.deny, ["rm *"]);
    assert.deepEqual(got.shell.allow, []);
  });
});

describe("step 4: trail, log and logFolder", () => {
  test("trail: true by default, with or without shell", () => {
    assert.equal(settingsOf(withOnetool({ shell: { folders: [ABS] } })).trail, true);
    assert.equal(settingsOf(withOnetool({})).trail, true);
    assert.equal(settingsOf(withOnetool({ log: false })).trail, true);
  });

  test("trail given wins over the default, both ways, with the shell on or off", () => {
    assert.equal(settingsOf(withOnetool({ shell: { folders: [ABS] }, trail: false })).trail, false);
    assert.equal(settingsOf(withOnetool({ shell: { folders: [ABS] }, trail: true })).trail, true);
    assert.equal(settingsOf(withOnetool({ trail: true })).trail, true);
    assert.equal(settingsOf(withOnetool({ trail: false })).trail, false);
  });

  test("log: true by default, with the shell on or off, and false when given", () => {
    assert.equal(settingsOf(withOnetool({})).log, true);
    assert.equal(settingsOf(withOnetool({ shell: { folders: [ABS] } })).log, true);
    assert.equal(settingsOf(withOnetool({ log: false })).log, false);
    assert.equal(settingsOf(withOnetool({ log: true })).log, true);
  });

  test("logFolder: the string as written, or null when the key is absent", () => {
    assert.equal(settingsOf(withOnetool({ logFolder: ABS })).logFolder, ABS);
    assert.equal(settingsOf(withOnetool({ logFolder: ABS2 })).logFolder, ABS2);
    assert.equal(settingsOf(withOnetool({})).logFolder, null);
  });

  test("trail and log not true or false: null counts as present", () => {
    for (const key of ["trail", "log"]) {
      for (const value of [null, "true", "false", 1, 0, [], {}, "", [true]]) {
        assert.deepEqual(problemsOf({ [key]: value }), [`onetool.${key}: must be true or false`], `${key} ${JSON.stringify(value)}`);
      }
    }
  });

  test("logFolder not a full path", () => {
    for (const value of [null, "", "logs", "./logs", 5, true, [], [ABS], {}]) {
      assert.deepEqual(problemsOf({ logFolder: value }), ["onetool.logFolder: must be a full path"], JSON.stringify(value));
    }
  });
});

describe("step 4: problems, their order and their content", () => {
  test("every problem of shell, trail, log and logFolder, after the ones of before, in the order of the table", () => {
    const got = faultOf({
      onetool: {
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
    ]);
    assert.equal(got.message, got.problems.join("; "));
  });

  test("a shell that is not an object keeps its place before trail, log and logFolder", () => {
    assert.deepEqual(problemsOf({ logFolder: 1, log: 1, trail: 1, shell: null, ask: 1 }), [
      "onetool.ask: must be a list of patterns",
      "onetool.shell: not an object",
      "onetool.trail: must be true or false",
      "onetool.log: must be true or false",
      "onetool.logFolder: must be a full path",
    ]);
  });

  test("no problem holds a value of the file: a folder, a command pattern, a path", () => {
    const problems = problemsOf({
      shell: { folders: ["SECRET-relative", 5], allow: ["SECRET 1", 5], deny: "SECRET-2", ask: [null, "SECRET 3"] },
      trail: "SECRET-4",
      log: "SECRET-5",
      logFolder: "SECRET-6",
    });
    assert.equal(problems.length, 7); // folders, allow, deny, ask, trail, log, logFolder
    for (const p of problems) assert.ok(!p.includes("SECRET"), p);
    const [q] = problemsOf({ shell: "SECRET-7" });
    assert.ok(!q.includes("SECRET"));
  });
});

describe("step 4: a server named shell", () => {
  const CMD = { command: "node" };
  const TAKEN = "the name is taken by the built-in shell";

  test("with the shell on, the name `shell` goes to bad and nothing else of it is kept", () => {
    const got = settingsOf({ mcpServers: { shell: CMD }, onetool: { shell: { folders: [ABS] } } });
    assert.deepEqual(got.servers, []);
    assert.deepEqual(got.bad, [{ name: "shell", reason: TAKEN }]);
  });

  test("the test comes before `not an object`, `both command and url`, `no command` and the others", () => {
    for (const entry of [null, 5, [], {}, { command: "" }, { command: "x", url: "http://h/x" }, { url: "ftp://h" }, { command: "x", args: 5 }]) {
      const got = settingsOf({ mcpServers: { shell: entry }, onetool: { shell: { folders: [ABS] } } });
      assert.deepEqual(got.bad, [{ name: "shell", reason: TAKEN }], JSON.stringify(entry));
    }
  });

  test("a server reached at an address is taken too", () => {
    const got = settingsOf({ mcpServers: { shell: { url: "http://h/mcp" } }, onetool: { shell: { folders: [ABS] } } });
    assert.deepEqual(got.bad, [{ name: "shell", reason: TAKEN }]);
    assert.deepEqual(got.servers, []);
  });

  test("with the shell off, a server named `shell` is a server like any other", () => {
    for (const onetool of [undefined, {}, { trail: true }]) {
      const file = onetool === undefined ? { mcpServers: { shell: CMD } } : { mcpServers: { shell: CMD }, onetool };
      const got = settingsOf(file);
      assert.deepEqual(got.servers, [{ name: "shell", command: "node", args: [], env: {} }]);
      assert.deepEqual(got.bad, []);
    }
    assert.deepEqual(settingsOf({ mcpServers: { shell: null } }).bad, [{ name: "shell", reason: "not an object" }]);
  });

  test("`Shell`, `SHELL` and a name that only holds `shell` are never taken", () => {
    const got = settingsOf({
      mcpServers: { Shell: CMD, SHELL: CMD, "shell ": CMD, shells: CMD, myshell: CMD },
      onetool: { shell: { folders: [ABS] } },
    });
    assert.deepEqual(got.bad, []);
    assert.deepEqual(got.servers.map((s) => s.name), ["Shell", "SHELL", "shell ", "shells", "myshell"]);
  });

  test("the other entries are not affected and bad keeps the order of the file", () => {
    const got = settingsOf({
      mcpServers: { a: CMD, "b.c": CMD, shell: CMD, d: { command: "" }, e: CMD },
      onetool: { shell: { folders: [ABS] } },
    });
    assert.deepEqual(got.servers.map((s) => s.name), ["a", "e"]);
    assert.deepEqual(got.bad, [
      { name: "b.c", reason: "the name holds a dot" },
      { name: "shell", reason: TAKEN },
      { name: "d", reason: "no command" },
    ]);
  });
});

// -- decideCommand ---------------------------------------------------------------------------------------------

describe("step 4: decideCommand", () => {
  const ALLOWED = { allowed: true };
  const asked = (rule) => ({ allowed: true, ask: rule });
  const denied = (rule) => ({
    allowed: false,
    list: "deny",
    rule,
    message: `onetool: shell.run is denied by the rule deny "${rule}" of onetool.shell`,
  });
  const NOT_ALLOWED = {
    allowed: false,
    list: "allow",
    rule: null,
    message: "onetool: shell.run is not allowed: the command matches no rule of allow of onetool.shell",
  };

  test("the three examples of the meeting point", () => {
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "  rm -rf x "), denied("rm *"));
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "ls; rm -rf x"), ALLOWED);
    assert.deepEqual(decideCommand({ allow: ["git *"], ask: ["git push*"] }, "git push origin"), asked("git push*"));
  });

  test("no rule at all, or undefined lists: allowed", () => {
    assert.deepEqual(decideCommand({}, "ls"), ALLOWED);
    assert.deepEqual(decideCommand({ allow: undefined, deny: undefined, ask: undefined }, "ls"), ALLOWED);
    assert.deepEqual(decideCommand({ allow: [], deny: [], ask: [] }, ""), ALLOWED);
  });

  test("the text matched is the command trimmed, line breaks included", () => {
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "\n\t rm -rf x \r\n"), denied("rm *"));
    assert.deepEqual(decideCommand({ deny: ["*"] }, "   "), denied("*"));
    assert.deepEqual(decideCommand({ allow: ["rm *"] }, " rm x"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["rm "] }, "rm "), ALLOWED);
  });

  test("a pattern is matched against the whole text: `rm *` and `*rm *`", () => {
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "rm -rf x"), denied("rm *"));
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "rm"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "sudo rm x"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["*rm *"] }, "rm -rf x"), denied("*rm *"));
    assert.deepEqual(decideCommand({ deny: ["*rm *"] }, "sudo rm x"), denied("*rm *"));
    assert.deepEqual(decideCommand({ deny: ["ls"] }, "ls -l"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["ls"] }, "ls"), denied("ls"));
    assert.deepEqual(decideCommand({ deny: ["l"] }, "ls"), ALLOWED);
  });

  test("case counts", () => {
    assert.deepEqual(decideCommand({ deny: ["RM *"] }, "rm x"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["rm *"] }, "RM x"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["Rm *"] }, "Rm x"), denied("Rm *"));
  });

  test("`*` stands for any run, the empty one, spaces and line breaks included", () => {
    assert.deepEqual(decideCommand({ deny: ["git*"] }, "git"), denied("git*"));
    assert.deepEqual(decideCommand({ deny: ["git *"] }, "git a\nb c"), denied("git *"));
    assert.deepEqual(decideCommand({ deny: ["a*b"] }, "a \n\n b"), denied("a*b"));
    assert.deepEqual(decideCommand({ deny: ["a*b*c"] }, "a--b--c"), denied("a*b*c"));
    assert.deepEqual(decideCommand({ deny: ["a*b*c"] }, "a--c--b"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["*"] }, "anything at all"), denied("*"));
    assert.deepEqual(decideCommand({ deny: ["*"] }, ""), denied("*"));
  });

  test("every other character stands for itself", () => {
    assert.deepEqual(decideCommand({ deny: ["a.b"] }, "axb"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["a.b"] }, "a.b"), denied("a.b"));
    assert.deepEqual(decideCommand({ deny: ["a+b"] }, "aab"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["echo $HOME*"] }, "echo $HOME/x"), denied("echo $HOME*"));
    assert.deepEqual(decideCommand({ deny: ["echo $HOME*"] }, "echo /root"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["ls [a]"] }, "ls a"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["ls [a]"] }, "ls [a]"), denied("ls [a]"));
    assert.deepEqual(decideCommand({ deny: ["(x)|y"] }, "y"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["^x$"] }, "x"), ALLOWED);
    assert.deepEqual(decideCommand({ deny: ["日本 *"] }, "日本 語"), denied("日本 *"));
  });

  test("deny first, in order: the first pattern that matches is named", () => {
    assert.deepEqual(decideCommand({ deny: ["x*", "rm *", "*"] }, "rm a"), denied("rm *"));
    assert.deepEqual(decideCommand({ deny: ["*", "rm *"] }, "rm a"), denied("*"));
    assert.deepEqual(decideCommand({ deny: ["rm *", "rm *"] }, "rm a"), denied("rm *"));
  });

  test("allow: empty allows, otherwise at least one must match", () => {
    assert.deepEqual(decideCommand({ allow: ["git *", "ls*"] }, "ls -l"), ALLOWED);
    assert.deepEqual(decideCommand({ allow: ["git *", "ls*"] }, "git status"), ALLOWED);
    assert.deepEqual(decideCommand({ allow: ["git *", "ls*"] }, "rm x"), NOT_ALLOWED);
    assert.deepEqual(decideCommand({ allow: ["git *"] }, "git"), NOT_ALLOWED);
  });

  test("deny wins over allow, and a refusal by deny is never one of allow", () => {
    assert.deepEqual(decideCommand({ allow: ["*"], deny: ["rm *"] }, "rm x"), denied("rm *"));
    assert.deepEqual(decideCommand({ allow: ["git *"], deny: ["rm *"] }, "rm x"), denied("rm *"));
    assert.deepEqual(decideCommand({ allow: ["git *"], deny: ["rm *"] }, "git x"), ALLOWED);
    assert.deepEqual(decideCommand({ allow: ["git *"], deny: ["rm *"] }, "ls"), NOT_ALLOWED);
  });

  test("ask: the first pattern of the list that matches, as written", () => {
    assert.deepEqual(decideCommand({ ask: ["git push*", "git *"] }, "git push x"), asked("git push*"));
    assert.deepEqual(decideCommand({ ask: ["git *", "git push*"] }, "git push x"), asked("git *"));
    assert.deepEqual(decideCommand({ ask: ["x*", "git *"] }, "git status"), asked("git *"));
    assert.deepEqual(decideCommand({ ask: ["git push*"] }, "git status"), ALLOWED);
    assert.deepEqual(decideCommand({ ask: ["Git *"] }, "git status"), ALLOWED);
    assert.deepEqual(decideCommand({ ask: ["*"] }, "ls"), asked("*"));
  });

  test("a call that deny or allow refuse is never asked about", () => {
    assert.deepEqual(decideCommand({ deny: ["rm *"], ask: ["*"] }, "rm x"), denied("rm *"));
    assert.deepEqual(decideCommand({ allow: ["git *"], ask: ["*"] }, "rm x"), NOT_ALLOWED);
    assert.deepEqual(decideCommand({ allow: ["git *"], ask: ["git *"] }, "git x"), asked("git *"));
  });

  test("the result has exactly the keys of its case", () => {
    assert.deepEqual(Object.keys(decideCommand({}, "ls")), ["allowed"]);
    assert.deepEqual(Object.keys(decideCommand({ ask: ["*"] }, "ls")).sort(), ["allowed", "ask"]);
    assert.deepEqual(Object.keys(decideCommand({ deny: ["*"], ask: ["*"] }, "ls")).sort(), ["allowed", "list", "message", "rule"]);
    assert.deepEqual(Object.keys(decideCommand({ allow: ["x"], ask: ["*"] }, "ls")).sort(), ["allowed", "list", "message", "rule"]);
  });

  test("no message holds the command", () => {
    const a = decideCommand({ deny: ["*"] }, "SECRET-command --token=abc");
    const b = decideCommand({ allow: ["nothing"] }, "SECRET-command --token=abc");
    assert.ok(!a.message.includes("SECRET"));
    assert.ok(!b.message.includes("SECRET"));
    assert.ok(!JSON.stringify(a).includes("SECRET") && !JSON.stringify(b).includes("SECRET"));
  });

  test("a first argument that is null, a list or not an object throws TypeError", () => {
    for (const rules of [null, [], ["rm *"], "rm *", 5, true]) {
      assert.throws(() => decideCommand(rules, "ls"), TypeError, JSON.stringify(rules));
    }
  });

  test("a list of the first argument that is present and not a list throws TypeError", () => {
    for (const key of ["allow", "deny", "ask"]) {
      for (const value of [null, "rm *", 5, {}, true]) {
        assert.throws(() => decideCommand({ [key]: value }, "ls"), TypeError, `${key} ${JSON.stringify(value)}`);
      }
    }
  });

  test("a command that is not a string throws TypeError", () => {
    for (const command of [undefined, null, 5, ["ls"], {}, true]) {
      assert.throws(() => decideCommand({ deny: ["*"] }, command), TypeError, String(command));
    }
  });

  test("it reads what readSettings returns", () => {
    const { shell } = settingsOf(withOnetool({ shell: { folders: [ABS], allow: ["git *"], deny: ["git rm*"], ask: ["git push*"] } }));
    assert.deepEqual(decideCommand(shell, "git status"), ALLOWED);
    assert.deepEqual(decideCommand(shell, "ls"), NOT_ALLOWED);
    assert.deepEqual(decideCommand(shell, "git push"), asked("git push*")); // `*` may stand for the empty run
    assert.deepEqual(decideCommand(shell, "git push -f"), asked("git push*"));
    assert.deepEqual(decideCommand(shell, "git rm a"), denied("git rm*"));
  });

  test("it does not change its arguments and prints nothing", () => {
    const rules = deepFreeze({ allow: ["git *"], deny: ["git rm*"], ask: ["git push*"] });
    const printed = printedBy(() => {
      decideCommand(rules, "git rm x");
      decideCommand(rules, "git push x");
      decideCommand(rules, "ls");
      decideCommand(rules, "git status");
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(rules, { allow: ["git *"], deny: ["git rm*"], ask: ["git push*"] });
  });
});

// -- SHELL_TOOLS -----------------------------------------------------------------------------------------------

describe("step 4: SHELL_TOOLS", () => {
  const TABLE = [
    ["run", "Runs a shell command in the first listed folder. In a program: $`command`.", ["command"], ["command"]],
    ["read", "Reads a text file of the listed folders. In a program: read(path).", ["path"], ["path"]],
    ["write", "Writes a text file in the listed folders, replacing what it holds. In a program: write(path, text).", ["path", "text"], ["path", "text"]],
    ["edit", "Replaces one text by another in a file of the listed folders. In a program: edit(path, old, new).", ["path", "old", "new"], ["path", "old", "new"]],
  ];

  test("a list of four tools, in the order run, read, write, edit", () => {
    assert.ok(Array.isArray(core.SHELL_TOOLS));
    assert.equal(core.SHELL_TOOLS.length, 4);
    assert.deepEqual(core.SHELL_TOOLS.map((t) => t.name), ["run", "read", "write", "edit"]);
  });

  for (const [index, [name, description, properties, required]] of TABLE.entries()) {
    test(`${name}: the description, the properties in order, all strings, and required`, () => {
      const tool = core.SHELL_TOOLS[index];
      assert.equal(tool.name, name);
      assert.equal(tool.description, description);
      assert.equal(tool.inputSchema.type, "object");
      assert.deepEqual(Object.keys(tool.inputSchema.properties), properties);
      for (const property of properties) assert.equal(tool.inputSchema.properties[property].type, "string", property);
      assert.deepEqual(tool.inputSchema.required, required);
    });
  }

  test("toolLine gives the line of each tool, by the rules of toolLine", () => {
    // arguments: each property, `name: string` when required; the sentence: up to the first `.` followed by a space.
    assert.equal(toolLine("shell", core.SHELL_TOOLS[0]), "shell.run(command: string) - Runs a shell command in the first listed folder.");
    assert.equal(toolLine("shell", core.SHELL_TOOLS[1]), "shell.read(path: string) - Reads a text file of the listed folders.");
    assert.equal(
      toolLine("shell", core.SHELL_TOOLS[2]),
      "shell.write(path: string, text: string) - Writes a text file in the listed folders, replacing what it holds.",
    );
    assert.equal(
      toolLine("shell", core.SHELL_TOOLS[3]),
      "shell.edit(path: string, old: string, new: string) - Replaces one text by another in a file of the listed folders.",
    );
  });

  test("the example of the meeting point", () => {
    assert.equal(toolLine("shell", core.SHELL_TOOLS[1]), "shell.read(path: string) - Reads a text file of the listed folders.");
  });

  test("the list is the same on each read", () => {
    assert.equal(core.SHELL_TOOLS, core.SHELL_TOOLS);
    assert.deepEqual(core.SHELL_TOOLS.map((t) => t.name), ["run", "read", "write", "edit"]);
  });
});

// -- shellOffMessage -------------------------------------------------------------------------------------------

describe("step 4: shellOffMessage", () => {
  const TAIL = " (the shell is not switched on: see onetool.shell in the settings file)";

  test("each of the four names gets the explanation", () => {
    for (const name of ["$", "read", "write", "edit"]) {
      const message = `ReferenceError: ${name} is not defined`;
      assert.equal(shellOffMessage(message), message + TAIL, name);
    }
  });

  test("any other message is returned unchanged", () => {
    for (const message of [
      "ReferenceError: foo is not defined",
      "ReferenceError: Read is not defined",
      "ReferenceError: READ is not defined",
      "referenceerror: read is not defined",
      "ReferenceError: read is not defined.",
      "ReferenceError: read is not defined ",
      " ReferenceError: read is not defined",
      "The program failed: ReferenceError: read is not defined",
      "ReferenceError: read is not defined\nat x",
      "ReferenceError: reads is not defined",
      "ReferenceError: $x is not defined",
      "ReferenceError:  read is not defined",
      "TypeError: read is not defined",
      "ReferenceError: read is not a function",
      "ReferenceError: run is not defined",
      "read",
      "",
    ]) {
      assert.equal(shellOffMessage(message), message, JSON.stringify(message));
    }
  });

  test("a message that is not a string is returned as it is", () => {
    const object = { message: "ReferenceError: read is not defined" };
    assert.equal(shellOffMessage(undefined), undefined);
    assert.equal(shellOffMessage(null), null);
    assert.equal(shellOffMessage(5), 5);
    assert.equal(shellOffMessage(object), object);
  });
});

// -- the trail -------------------------------------------------------------------------------------------------

describe("step 4: callSize", () => {
  test("0 for undefined", () => {
    assert.equal(callSize(undefined), 0);
  });

  test("the length of a string, not of its JSON", () => {
    assert.equal(callSize(""), 0);
    assert.equal(callSize("abc"), 3);
    assert.equal(callSize('a"b'), 3); // JSON would add two quotes and a backslash
    assert.equal(callSize("line\nbreak"), 10);
    assert.equal(callSize("é"), 1);
    assert.equal(callSize("😀"), 2); // String.prototype.length
    assert.equal(callSize("x".repeat(208355)), 208355);
  });

  test("the length of JSON.stringify for anything else", () => {
    assert.equal(callSize(12345), 5); // "12345"
    assert.equal(callSize(0), 1); // "0"
    assert.equal(callSize(null), 4); // "null"
    assert.equal(callSize(true), 4); // "true"
    assert.equal(callSize(false), 5); // "false"
    assert.equal(callSize({}), 2); // "{}"
    assert.equal(callSize([]), 2); // "[]"
    assert.equal(callSize([1, 2]), 5); // "[1,2]"
    assert.equal(callSize({ a: 1 }), 7); // {"a":1}
    assert.equal(callSize({ a: "x" }), 9); // {"a":"x"}
    assert.equal(callSize([{ a: [] }]), 10); // [{"a":[]}]
  });

  test("it prints nothing and does not change its argument", () => {
    const value = deepFreeze({ a: [1, { b: "c" }] });
    assert.deepEqual(printedBy(() => callSize(value)), []);
    assert.deepEqual(value, { a: [1, { b: "c" }] });
  });
});

describe("step 4: formatTrail", () => {
  const call = (id, ms, size, outcome) => ({ id, ms, size, outcome });
  const manyCalls = (n) => Array.from({ length: n }, (_, i) => call(`s.t${i}`, i, i, "ok"));
  const linesOf = (n) => Array.from({ length: n }, (_, i) => `s.t${i} ${i} ms ${i} chars`);

  test("an empty list gives the empty string", () => {
    assert.equal(formatTrail([]), "");
    assert.equal(formatTrail([], { limit: 1 }), "");
  });

  test("the example of the meeting point", () => {
    const got = formatTrail([call("practice.rows", 12, 208355, "ok"), call("shell.read", 0, 0, "refused")]);
    assert.equal(got, "--- calls ---\npractice.rows 12 ms 208355 chars\nshell.read 0 ms refused");
  });

  test("one call: the header and its line, no line break at the end", () => {
    assert.equal(formatTrail([call("a.b", 5, 7, "ok")]), "--- calls ---\na.b 5 ms 7 chars");
  });

  test("the three other outcomes give the outcome, whatever size holds", () => {
    assert.equal(formatTrail([call("a.b", 5, 99, "refused")]), "--- calls ---\na.b 5 ms refused");
    assert.equal(formatTrail([call("a.b", 6, 99, "failed")]), "--- calls ---\na.b 6 ms failed");
    assert.equal(formatTrail([call("a.b", 7, 99, "unfinished")]), "--- calls ---\na.b 7 ms unfinished");
    assert.equal(formatTrail([{ id: "a.b", ms: 8, outcome: "failed" }]), "--- calls ---\na.b 8 ms failed");
  });

  test("always `chars`, also for 0 and 1; numbers in digits with no separator", () => {
    assert.equal(
      formatTrail([call("a.b", 0, 0, "ok"), call("a.c", 1, 1, "ok"), call("a.d", 1234567, 9876543, "ok")]),
      "--- calls ---\na.b 0 ms 0 chars\na.c 1 ms 1 chars\na.d 1234567 ms 9876543 chars",
    );
  });

  test("the calls come in the order given, the id as it is", () => {
    const got = formatTrail([call("z.z", 1, 1, "ok"), call("My Server.do it", 2, 2, "failed"), call("a.a", 3, 3, "ok")]);
    assert.equal(got, "--- calls ---\nz.z 1 ms 1 chars\nMy Server.do it 2 ms failed\na.a 3 ms 3 chars");
  });

  test("exactly `limit` calls are all shown; the default limit is 20", () => {
    assert.equal(formatTrail(manyCalls(20)), ["--- calls ---", ...linesOf(20)].join("\n"));
    assert.equal(formatTrail(manyCalls(3), { limit: 3 }), ["--- calls ---", ...linesOf(3)].join("\n"));
    assert.equal(formatTrail(manyCalls(1), { limit: 1 }), ["--- calls ---", ...linesOf(1)].join("\n"));
  });

  test("more than `limit`: the first `limit` lines, then how many are left out", () => {
    assert.equal(formatTrail(manyCalls(21)), ["--- calls ---", ...linesOf(20), "(1 more not shown)"].join("\n"));
    assert.equal(formatTrail(manyCalls(5), { limit: 2 }), ["--- calls ---", ...linesOf(2), "(3 more not shown)"].join("\n"));
    assert.equal(formatTrail(manyCalls(2), { limit: 1 }), ["--- calls ---", ...linesOf(1), "(1 more not shown)"].join("\n"));
    assert.equal(formatTrail(manyCalls(120), { limit: 100 }), ["--- calls ---", ...linesOf(100), "(20 more not shown)"].join("\n"));
  });

  test("it does not change its arguments and prints nothing", () => {
    const calls = deepFreeze(manyCalls(4));
    const printed = printedBy(() => formatTrail(calls, { limit: 2 }));
    assert.deepEqual(printed, []);
    assert.deepEqual(calls, manyCalls(4));
  });
});

describe("step 4: withTrail", () => {
  const noticeOf = (n, limit) => `\n[cut: the answer was ${n} characters, the limit is ${limit}]`;
  const TRAIL = "--- calls ---\na.b 1 ms 2 chars";

  test("an empty trail: the result is cutAnswer(text, limit)", () => {
    assert.equal(withTrail("short", "", 100), "short");
    const text = "x".repeat(150);
    assert.equal(withTrail(text, "", 100), "x".repeat(100 - noticeOf(150, 100).length) + noticeOf(150, 100));
    assert.equal(withTrail(text, "", 100), cutAnswer(text, 100));
    assert.equal(withTrail("x".repeat(100), "", 100), "x".repeat(100));
  });

  test("the answer, one line break, the trail, when that fits", () => {
    assert.equal(withTrail("42", TRAIL, 8000), `42\n${TRAIL}`);
    assert.equal(withTrail("", TRAIL, 8000), `\n${TRAIL}`);
  });

  test("a whole of exactly `limit` characters is kept", () => {
    const trail = "t".repeat(10);
    const text = "a".repeat(100 - 1 - trail.length);
    const got = withTrail(text, trail, 100);
    assert.equal(got, `${text}\n${trail}`);
    assert.equal(got.length, 100);
  });

  test("a whole one character over: the text is cut, the notice and the trail follow, exactly `limit` characters", () => {
    const trail = "t".repeat(10);
    const text = "a".repeat(100 - 1 - trail.length + 1);
    const whole = text.length + 1 + trail.length; // 101
    const notice = noticeOf(whole, 100);
    const room = 100 - notice.length - 1 - trail.length;
    assert.ok(room >= 0);
    const got = withTrail(text, trail, 100);
    assert.equal(got, `${"a".repeat(room)}${notice}\n${trail}`);
    assert.equal(got.length, 100);
  });

  test("a long text: the trail stays whole at the end", () => {
    const text = "a".repeat(200);
    const whole = text.length + 1 + TRAIL.length;
    const notice = noticeOf(whole, 100);
    const room = 100 - notice.length - 1 - TRAIL.length;
    assert.ok(room >= 0);
    const got = withTrail(text, TRAIL, 100);
    assert.equal(got, `${"a".repeat(room)}${notice}\n${TRAIL}`);
    assert.equal(got.length, 100);
    assert.ok(got.endsWith(`\n${TRAIL}`));
  });

  test("room of exactly 0: no text, the notice and the trail", () => {
    const noticeLength = noticeOf(300, 100).length; // the same length for any whole of three digits
    const trail = "t".repeat(100 - 1 - noticeLength);
    const text = "a".repeat(200);
    const whole = text.length + 1 + trail.length;
    assert.equal(String(whole).length, 3);
    const got = withTrail(text, trail, 100);
    assert.equal(got, `${noticeOf(whole, 100)}\n${trail}`);
    assert.equal(got.length, 100);
  });

  test("room below 0: the only case where the trail is cut, as cutAnswer(whole, limit)", () => {
    const noticeLength = noticeOf(300, 100).length;
    const trail = "t".repeat(100 - 1 - noticeLength + 1);
    const text = "a".repeat(200);
    const whole = `${text}\n${trail}`;
    assert.equal(String(whole.length).length, 3);
    const got = withTrail(text, trail, 100);
    assert.equal(got, cutAnswer(whole, 100));
    assert.equal(got.length, 100);
    assert.ok(!got.endsWith(trail));
  });

  test("a trail longer than the limit is cut with the answer", () => {
    const trail = `--- calls ---\n${"a.b 1 ms 2 chars\n".repeat(20)}`.trimEnd();
    const got = withTrail("ok", trail, 100);
    assert.equal(got, cutAnswer(`ok\n${trail}`, 100));
    assert.equal(got.length, 100);
  });

  test("the default limit is 8000", () => {
    const trail = "t".repeat(20);
    const fits = "a".repeat(8000 - 1 - trail.length);
    assert.equal(withTrail(fits, trail), `${fits}\n${trail}`);
    const got = withTrail(`${fits}a`, trail);
    assert.equal(got.length, 8000);
    assert.ok(got.endsWith(`\n${trail}`));
    assert.ok(got.includes("[cut: the answer was 8001 characters, the limit is 8000]"));
    assert.equal(withTrail("x".repeat(8000), ""), "x".repeat(8000));
    assert.equal(withTrail("x".repeat(8001), "").length, 8000);
  });

  test("a text or a trail that is not a string throws TypeError", () => {
    for (const bad of [undefined, null, 5, ["a"], {}]) {
      assert.throws(() => withTrail(bad, "", 100), TypeError, `text ${JSON.stringify(bad)}`);
      assert.throws(() => withTrail("ok", bad, 100), TypeError, `trail ${JSON.stringify(bad)}`);
    }
  });

  test("it prints nothing", () => {
    assert.deepEqual(printedBy(() => withTrail("a".repeat(200), TRAIL, 100)), []);
  });
});

// -- the log ---------------------------------------------------------------------------------------------------

describe("step 4: shellLogArgs", () => {
  const sorted = (value) => Object.keys(value).sort();

  test("run: { command }", () => {
    const got = shellLogArgs("run", { command: "ls -l" });
    assert.deepEqual(got, { command: "ls -l" });
    assert.deepEqual(sorted(got), ["command"]);
    assert.deepEqual(shellLogArgs("run", { command: "ls", other: 1 }), { command: "ls" });
    assert.deepEqual(shellLogArgs("run", {}), { command: null });
  });

  test("read: { path }", () => {
    assert.deepEqual(shellLogArgs("read", { path: "/a/b.txt" }), { path: "/a/b.txt" });
    assert.deepEqual(shellLogArgs("read", { path: "/a", extra: "x" }), { path: "/a" });
    assert.deepEqual(shellLogArgs("read", {}), { path: null });
  });

  test("write: { path, size }, never the text", () => {
    const got = shellLogArgs("write", { path: "/a/b.txt", text: "SECRET body" });
    assert.deepEqual(got, { path: "/a/b.txt", size: 11 }); // "SECRET body" is 6 + 1 + 4 characters
    assert.deepEqual(sorted(got), ["path", "size"]);
    assert.ok(!JSON.stringify(got).includes("SECRET"));
    assert.deepEqual(shellLogArgs("write", { path: "/a", text: "" }), { path: "/a", size: 0 });
    assert.deepEqual(shellLogArgs("write", { path: "/a", text: "é" }), { path: "/a", size: 1 });
    assert.deepEqual(shellLogArgs("write", { path: "/a", text: 5 }), { path: "/a", size: null });
    assert.deepEqual(shellLogArgs("write", { path: "/a", text: null }), { path: "/a", size: null });
    assert.deepEqual(shellLogArgs("write", { path: "/a" }), { path: "/a", size: null });
    assert.deepEqual(shellLogArgs("write", {}), { path: null, size: null });
  });

  test("edit: { path, oldSize, newSize }, never the texts", () => {
    const got = shellLogArgs("edit", { path: "/a", old: "SECRET", new: "ab" });
    assert.deepEqual(got, { path: "/a", oldSize: 6, newSize: 2 });
    assert.deepEqual(sorted(got), ["newSize", "oldSize", "path"]);
    assert.ok(!JSON.stringify(got).includes("SECRET"));
    assert.deepEqual(shellLogArgs("edit", { path: "/a", old: "", new: "" }), { path: "/a", oldSize: 0, newSize: 0 });
    assert.deepEqual(shellLogArgs("edit", { path: "/a", old: 1, new: "abc" }), { path: "/a", oldSize: null, newSize: 3 });
    assert.deepEqual(shellLogArgs("edit", { path: "/a", old: "abc", new: null }), { path: "/a", oldSize: 3, newSize: null });
    assert.deepEqual(shellLogArgs("edit", { path: "/a" }), { path: "/a", oldSize: null, newSize: null });
    assert.deepEqual(shellLogArgs("edit", {}), { path: null, oldSize: null, newSize: null });
  });

  test("args that is not a plain object: null", () => {
    for (const tool of ["run", "read", "write", "edit"]) {
      for (const args of [[], ["ls"], "ls", null, undefined, 5, true]) {
        assert.equal(shellLogArgs(tool, args), null, `${tool} ${JSON.stringify(args)}`);
      }
    }
  });

  test("another tool: null", () => {
    for (const tool of ["", "RUN", "Run", "shell.run", "rows", "exec", undefined, null, 5]) {
      assert.equal(shellLogArgs(tool, { command: "ls", path: "/a" }), null, String(tool));
    }
  });

  test("it does not change its arguments and prints nothing", () => {
    const args = deepFreeze({ path: "/a", old: "abc", new: "d" });
    const printed = printedBy(() => shellLogArgs("edit", args));
    assert.deepEqual(printed, []);
    assert.deepEqual(args, { path: "/a", old: "abc", new: "d" });
  });
});

describe("step 4: logLine", () => {
  const TIME = Date.UTC(2026, 10, 17, 10, 0, 0, 0); // 2026-11-17T10:00:00.000Z
  const entry = (extra = {}) => ({
    time: TIME,
    session: "s1",
    id: "shell.run",
    args: { command: "ls" },
    decision: "allowed",
    ms: 12,
    size: 3,
    fault: null,
    ...extra,
  });

  test("the keys, in this order, as the JSON text of one line", () => {
    assert.equal(
      logLine(entry()),
      '{"time":"2026-11-17T10:00:00.000Z","session":"s1","id":"shell.run","args":{"command":"ls"},"decision":"allowed","ms":12,"size":3,"fault":null}',
    );
  });

  test("the key order of the parsed line", () => {
    assert.deepEqual(Object.keys(JSON.parse(logLine(entry()))), ["time", "session", "id", "args", "decision", "ms", "size", "fault"]);
  });

  test("time is the ISO text of the milliseconds, with the milliseconds", () => {
    assert.equal(JSON.parse(logLine(entry({ time: Date.UTC(2026, 0, 2, 3, 4, 5, 67) }))).time, "2026-01-02T03:04:05.067Z");
    assert.equal(JSON.parse(logLine(entry({ time: 0 }))).time, "1970-01-01T00:00:00.000Z");
  });

  test("session, id, decision, ms, size and fault are the values of the entry", () => {
    const got = JSON.parse(
      logLine(entry({ session: "abc-123", id: "practice.rows", decision: "refused", ms: 0, size: null, fault: "the call failed: boom" })),
    );
    assert.equal(got.session, "abc-123");
    assert.equal(got.id, "practice.rows");
    assert.equal(got.decision, "refused");
    assert.equal(got.ms, 0);
    assert.equal(got.size, null);
    assert.equal(got.fault, "the call failed: boom");
  });

  test("no line break in it or after it, whatever the arguments hold", () => {
    const line = logLine(entry({ args: { command: "a\nb\r\nc" }, fault: "x\ny" }));
    assert.ok(!line.includes("\n"));
    assert.ok(!line.includes("\r"));
    assert.equal(JSON.parse(line).args.command, "a\nb\r\nc");
    assert.equal(JSON.parse(line).fault, "x\ny");
  });

  test("other keys of the entry are left out", () => {
    const got = JSON.parse(logLine(entry({ extra: "SECRET", more: [1] })));
    assert.equal(Object.keys(got).length, 8);
    assert.ok(!logLine(entry({ extra: "SECRET" })).includes("SECRET"));
  });

  test("args undefined gives null", () => {
    const line = logLine(entry({ args: undefined }));
    assert.equal(JSON.parse(line).args, null);
    assert.ok(line.includes('"args":null'));
    assert.deepEqual(Object.keys(JSON.parse(line)), ["time", "session", "id", "args", "decision", "ms", "size", "fault"]);
  });

  test("args kept as they are when their JSON is at most argsLimit characters, exactly argsLimit included", () => {
    const args = { command: "x".repeat(50), n: [1, { b: 2 }] };
    const n = JSON.stringify(args).length;
    assert.deepEqual(JSON.parse(logLine(entry({ args }), { argsLimit: n })).args, args);
    assert.deepEqual(JSON.parse(logLine(entry({ args }), { argsLimit: n + 1 })).args, args);
  });

  test("args over argsLimit: a string, the start of the JSON, then `... (<n> characters)`", () => {
    const args = { command: "x".repeat(50), n: [1, { b: 2 }] };
    const json = JSON.stringify(args);
    const n = json.length;
    assert.equal(JSON.parse(logLine(entry({ args }), { argsLimit: n - 1 })).args, `${json.slice(0, n - 1)}... (${n} characters)`);
    assert.equal(JSON.parse(logLine(entry({ args }), { argsLimit: 10 })).args, `${json.slice(0, 10)}... (${n} characters)`);
    assert.equal(JSON.parse(logLine(entry({ args }), { argsLimit: 1 })).args, `${json.slice(0, 1)}... (${n} characters)`);
  });

  test("argsLimit defaults to 2000", () => {
    const filler = "x".repeat(2000 - JSON.stringify({ a: "" }).length);
    const exact = { a: filler };
    assert.equal(JSON.stringify(exact).length, 2000);
    assert.deepEqual(JSON.parse(logLine(entry({ args: exact }))).args, exact);
    const over = { a: `${filler}y` };
    const json = JSON.stringify(over);
    assert.equal(json.length, 2001);
    assert.equal(JSON.parse(logLine(entry({ args: over }))).args, `${json.slice(0, 2000)}... (2001 characters)`);
  });

  test("the cut args do not break the line", () => {
    const args = { command: "a\nb".repeat(30) };
    const line = logLine(entry({ args }), { argsLimit: 20 });
    assert.ok(!line.includes("\n"));
    assert.equal(typeof JSON.parse(line).args, "string");
  });

  test("it does not change its arguments and prints nothing", () => {
    const e = deepFreeze(entry({ args: { command: "x".repeat(40) } }));
    const copy = JSON.parse(JSON.stringify(e));
    const printed = printedBy(() => {
      logLine(e);
      logLine(e, { argsLimit: 5 });
    });
    assert.deepEqual(printed, []);
    assert.deepEqual(e, copy);
  });
});

describe("step 4: logFileName", () => {
  test("calls-<date>.jsonl, the date being the first ten characters of the ISO time", () => {
    assert.equal(logFileName(Date.UTC(2026, 10, 17, 10, 0, 0)), "calls-2026-11-17.jsonl");
    assert.equal(logFileName(Date.UTC(2026, 0, 1, 0, 0, 0)), "calls-2026-01-01.jsonl");
    assert.equal(logFileName(0), "calls-1970-01-01.jsonl");
  });

  test("one file per day, in UTC: the change comes at 00:00:00.000 UTC", () => {
    assert.equal(logFileName(Date.UTC(2026, 10, 17, 23, 59, 59, 999)), "calls-2026-11-17.jsonl");
    assert.equal(logFileName(Date.UTC(2026, 10, 18, 0, 0, 0, 0)), "calls-2026-11-18.jsonl");
    assert.equal(logFileName(Date.UTC(2026, 11, 31, 23, 59, 59, 999)), "calls-2026-12-31.jsonl");
    assert.equal(logFileName(Date.UTC(2027, 0, 1, 0, 0, 0, 0)), "calls-2027-01-01.jsonl");
  });
});

describe("step 4: none of these reads the clock", () => {
  test("with Date.now made to throw, they all still answer", () => {
    const realNow = Date.now;
    Date.now = () => {
      throw new Error("the clock was read");
    };
    try {
      const time = Date.UTC(2026, 10, 17, 10, 0, 0);
      assert.equal(logFileName(time), "calls-2026-11-17.jsonl");
      assert.equal(typeof logLine({ time, session: "s", id: "a.b", args: {}, decision: "allowed", ms: 1, size: null, fault: null }), "string");
      assert.equal(formatTrail([{ id: "a.b", ms: 1, size: 1, outcome: "ok" }]), "--- calls ---\na.b 1 ms 1 chars");
      assert.equal(withTrail("a", "b", 100), "a\nb");
      assert.equal(callSize("abc"), 3);
      assert.deepEqual(shellLogArgs("read", { path: "/a" }), { path: "/a" });
      assert.deepEqual(decideCommand({}, "ls"), { allowed: true });
      assert.equal(shellOffMessage("x"), "x");
    } finally {
      Date.now = realNow;
    }
  });
});
