import { describe } from "node:test";
import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:os";
import { existsSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../src/index.js";
import { treeTest, fault, within, quote } from "./helpers.js";

const NOT_TEXT = "the command must be a text that is not empty";
const STOPPED = "the command was stopped";
const NOT_STARTED = "the command could not be started";

// A command that has no business taking long: a late answer is a failure, not a hang.
const run = (command, options) => within(runCommand(command, options), 8000, `the command ${JSON.stringify(command)}`);

describe("runCommand: the result", () => {
  treeTest("`{ exitCode, stdout, stderr }` and no other key", async (T) => {
    const got = await run("echo hi", { cwd: T.W });
    assert.deepEqual(Object.keys(got).sort(), ["exitCode", "stderr", "stdout"]);
    assert.deepEqual(got, { exitCode: 0, stdout: "hi\n", stderr: "" });
    assert.equal(Number.isInteger(got.exitCode), true);
  });

  treeTest("standard output and standard error come apart", async (T) => {
    const got = await run("echo out; echo err >&2; echo out2; echo err2 >&2", { cwd: T.W });
    assert.deepEqual(got, { exitCode: 0, stdout: "out\nout2\n", stderr: "err\nerr2\n" });
  });

  treeTest("the text of the command is handed to the shell as it is", async (T) => {
    const got = await run('x=3; echo "$((x + 4))" && echo \'single "double" $x\'', { cwd: T.W });
    assert.deepEqual(got, { exitCode: 0, stdout: '7\nsingle "double" $x\n', stderr: "" });
  });

  treeTest("everything written, unchanged: line breaks kept, white space kept", async (T) => {
    const got = await run("printf '  a\\n\\n\\t'; printf 'b\\n\\n' >&2", { cwd: T.W });
    assert.deepEqual(got, { exitCode: 0, stdout: "  a\n\n\t", stderr: "b\n\n" });
  });

  treeTest("read as UTF-8, also a character that comes in two pieces", async (T) => {
    // the two bytes of `é` are written 100 ms apart
    const got = await run("printf 'h\\303'; sleep 0.1; printf '\\251llo \\342\\234\\223'", { cwd: T.W });
    assert.equal(got.stdout, "héllo ✓");
  });

  treeTest("nothing written gives the empty string", async (T) => {
    assert.deepEqual(await run("true", { cwd: T.W }), { exitCode: 0, stdout: "", stderr: "" });
  });

  treeTest("a code other than 0 is not a fault: it resolves with that code", async (T) => {
    assert.deepEqual(await run("exit 3", { cwd: T.W }), { exitCode: 3, stdout: "", stderr: "" });
    assert.equal((await run("false", { cwd: T.W })).exitCode, 1);
    assert.equal((await run("echo partial; echo bad >&2; exit 255", { cwd: T.W })).exitCode, 255);
    const missing = await run("no-such-command-anywhere-xyz", { cwd: T.W });
    assert.equal(missing.exitCode, 127);
    assert.notEqual(missing.stderr, "");
  });

  treeTest("a command ended by a signal the part did not send: 128 plus the number of the signal", async (T) => {
    const term = await run("kill -TERM $$", { cwd: T.W });
    assert.equal(term.exitCode, 128 + constants.signals.SIGTERM);
    assert.equal((await run("kill -KILL $$", { cwd: T.W })).exitCode, 128 + constants.signals.SIGKILL);
    assert.equal((await run("kill -HUP $$", { cwd: T.W })).exitCode, 128 + constants.signals.SIGHUP);
    const withOut = await run("echo before; kill -TERM $$", { cwd: T.W });
    assert.deepEqual(withOut, { exitCode: 143, stdout: "before\n", stderr: "" });
  });

  treeTest("standard input is closed: a command that reads it sees the end at once", async (T) => {
    assert.deepEqual(await run("cat", { cwd: T.W }), { exitCode: 0, stdout: "", stderr: "" });
    const got = await run("if read line; then echo got; else echo end; fi", { cwd: T.W });
    assert.equal(got.stdout, "end\n");
  });

  treeTest("the command starts in `cwd`", async (T) => {
    assert.equal((await run("pwd -P", { cwd: T.W })).stdout, realpathSync(T.W) + "\n");
    assert.equal((await run("pwd -P", { cwd: T.X })).stdout, realpathSync(T.X) + "\n");
    await run("echo made > here.txt", { cwd: T.W });
    assert.equal(existsSync(join(T.W, "here.txt")), true);
  });

  treeTest("`env` is the environment of the command; the default is the one of the caller", async (T) => {
    process.env.SHELL_TEST_VAR = "from caller";
    try {
      assert.equal((await run('echo "[$SHELL_TEST_VAR]"', { cwd: T.W })).stdout, "[from caller]\n");
      const own = await run('echo "[$SHELL_TEST_VAR][$FOO]"', { cwd: T.W, env: { PATH: process.env.PATH, FOO: "bar" } });
      assert.equal(own.stdout, "[][bar]\n");
    } finally {
      delete process.env.SHELL_TEST_VAR;
    }
  });
});

describe("runCommand: the faults before anything starts", () => {
  treeTest("`command` is not a string, or holds nothing but white space", async (T) => {
    for (const bad of [undefined, null, 5, {}, ["echo"], "", " ", "\n", "\t \r\n", " ", "﻿"]) {
      await fault(runCommand(bad, { cwd: T.W }), NOT_TEXT);
    }
  });

  treeTest("a text with something other than white space is a command", async (T) => {
    assert.equal((await run("  echo spaced  ", { cwd: T.W })).stdout, "spaced\n");
  });

  treeTest("`signal` already aborted: `the command was stopped`, nothing is started", async (T) => {
    const marker = join(T.W, "marker.txt");
    const controller = new AbortController();
    controller.abort();
    await fault(runCommand(`touch ${quote(marker)}`, { cwd: T.W, signal: controller.signal }), STOPPED);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(existsSync(marker), false);
  });

  treeTest("`cwd` is not a folder: `the command could not be started`, without the folder in it", async (T) => {
    const notThere = join(T.root, "no-such-folder");
    const err = await fault(runCommand("echo hi", { cwd: notThere }), NOT_STARTED);
    assert.equal(err.message.includes(notThere), false);
    writeFileSync(join(T.root, "afile"), "x");
    await fault(runCommand("echo hi", { cwd: join(T.root, "afile") }), NOT_STARTED);
  });
});

describe("runCommand: outputLimit", () => {
  treeTest("exactly `outputLimit` bytes of standard output is kept", async (T) => {
    const got = await run("printf 0123456789", { cwd: T.W, outputLimit: 10 });
    assert.deepEqual(got, { exitCode: 0, stdout: "0123456789", stderr: "" });
  });

  treeTest("one byte more of standard output: `the output is over <outputLimit> bytes`", async (T) => {
    await fault(run("printf 01234567890", { cwd: T.W, outputLimit: 10 }), "the output is over 10 bytes");
    await fault(run("printf 01", { cwd: T.W, outputLimit: 1 }), "the output is over 1 bytes");
  });

  treeTest("exactly `outputLimit` bytes of standard error is kept, one more is over", async (T) => {
    const got = await run("printf 0123456789 >&2", { cwd: T.W, outputLimit: 10 });
    assert.deepEqual(got, { exitCode: 0, stdout: "", stderr: "0123456789" });
    await fault(run("printf 01234567890 >&2", { cwd: T.W, outputLimit: 10 }), "the output is over 10 bytes");
  });

  treeTest("each stream is counted alone: 8 and 8 bytes under a limit of 10 is kept", async (T) => {
    const got = await run("printf 12345678; printf abcdefgh >&2", { cwd: T.W, outputLimit: 10 });
    assert.deepEqual(got, { exitCode: 0, stdout: "12345678", stderr: "abcdefgh" });
  });

  treeTest("the limit counts bytes, over the whole run", async (T) => {
    // two characters of two bytes each: 4 bytes
    const got = await run("printf '\\303\\251\\303\\251'", { cwd: T.W, outputLimit: 4 });
    assert.equal(got.stdout, "éé");
    await fault(run("printf '\\303\\251\\303\\251'", { cwd: T.W, outputLimit: 3 }), "the output is over 3 bytes");
    // 10 bytes, a pause, 1 byte more
    await fault(run("printf 0123456789; sleep 0.2; printf x", { cwd: T.W, outputLimit: 10 }), "the output is over 10 bytes");
  });

  treeTest("the default limit is 10000000 bytes: 3 million bytes are kept whole", async (T) => {
    const got = await run("head -c 3000000 /dev/zero | tr '\\0' a", { cwd: T.W });
    assert.equal(got.exitCode, 0);
    assert.equal(got.stdout.length, 3000000);
  });

  treeTest("more than 10000000 bytes with no limit given: over", async (T) => {
    await fault(
      within(runCommand("head -c 10000001 /dev/zero | tr '\\0' a", { cwd: T.W }), 15000, "the big output"),
      "the output is over 10000000 bytes",
    );
  });
});

describe("runCommand: arguments", () => {
  treeTest("changes none of its arguments", async (T) => {
    const env = Object.freeze({ PATH: process.env.PATH, FOO: "1" });
    const signal = new AbortController().signal;
    const options = Object.freeze({ cwd: T.W, signal, env, outputLimit: 1000 });
    assert.equal((await run("echo $FOO", options)).stdout, "1\n");
    assert.deepEqual({ ...options }, { cwd: T.W, signal, env, outputLimit: 1000 });
    assert.deepEqual({ ...env }, { PATH: process.env.PATH, FOO: "1" });
    assert.equal(signal.aborted, false);
  });

  treeTest("several commands at the same time share nothing", async (T) => {
    const [a, b, c] = await Promise.all([
      run("sleep 0.2; echo a; echo ea >&2; exit 1", { cwd: T.W }),
      run("echo b; exit 2", { cwd: T.X }),
      run("pwd -P; echo $V", { cwd: T.W2, env: { PATH: process.env.PATH, V: "v" } }),
    ]);
    assert.deepEqual(a, { exitCode: 1, stdout: "a\n", stderr: "ea\n" });
    assert.deepEqual(b, { exitCode: 2, stdout: "b\n", stderr: "" });
    assert.deepEqual(c, { exitCode: 0, stdout: realpathSync(T.W2) + "\nv\n", stderr: "" });
  });
});

test("runCommand is exported next to the file functions and ShellError", async () => {
  const m = await import("../src/index.js");
  for (const name of ["runCommand", "readFile", "writeFile", "editFile", "realPlace", "missingFolders"]) {
    assert.equal(typeof m[name], "function", name);
  }
  assert.equal(typeof m.ShellError, "function");
  assert.ok(m.ShellError.prototype instanceof Error);
});
