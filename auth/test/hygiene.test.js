import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { authFile, signInStamp } from "../src/index.js";
import { HERE, ROOT, startPractice, tmpHome, mode, readJson, wait, within } from "./helpers.js";

/** Runs a script of this folder as a child process with a channel to it; `onMessage` sees what it sends. */
function child(script, arg, onMessage) {
  const c = spawn(process.execPath, [path.join(HERE, script), JSON.stringify(arg)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const seen = { stdout: "", stderr: "" };
  c.stdout.setEncoding("utf8");
  c.stderr.setEncoding("utf8");
  c.stdout.on("data", (d) => (seen.stdout += d));
  c.stderr.on("data", (d) => (seen.stderr += d));
  c.on("message", (m) => onMessage?.(m));
  const exited = new Promise((resolve) => c.on("close", (code, signal) => resolve({ code, signal })));
  process.on("exit", () => {
    if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  });
  return { c, seen, exited };
}

describe("nothing is printed; the process ends by itself", () => {
  test("points 2 to 5 in a child process: standard output and standard error are empty, and it ends with code 0 on its own", async () => {
    const plain = await startPractice();
    const short = await startPractice(["--expires", "1"]);
    try {
      const home = tmpHome();
      let result;
      let at;
      let done;
      const got = new Promise((resolve) => (done = resolve));
      const run = child("child-run.js", { plain: plain.url, short: short.url, home }, (m) => {
        result = m;
        at = Date.now();
        done();
      });
      await within(Promise.race([got, run.exited]), 10000, "the result of the child process");
      assert.ok(result, "the child sent its result");
      const end = await within(run.exited, 6000, "the child process ends by itself");
      assert.ok(Date.now() - at < 6000);
      assert.equal(result.failed, undefined, result.failed);
      assert.deepEqual(result.login, { ok: true });
      assert.equal(result.count, '{"count":625}');
      assert.deepEqual(result.loginShort, { ok: true });
      assert.equal(result.countAfterExpiry, '{"count":625}');
      assert.equal(result.stampChanged, true);
      assert.equal(result.afterForget, "401");
      assert.equal(result.stampAfterForget, null);
      assert.deepEqual(end, { code: 0, signal: null });
      assert.equal(run.seen.stdout, "");
      assert.equal(run.seen.stderr, "");
    } finally {
      plain.stop();
      short.stop();
    }
  });
});

describe("a signal that ends the process during a login leaves the file whole", () => {
  test("after SIGTERM or SIGKILL at several moments the file is one whole usable sign-in", async () => {
    const srv = await startPractice();
    try {
      for (const [delay, signal] of [
        [0, "SIGKILL"],
        [7, "SIGTERM"],
        [15, "SIGKILL"],
        [23, "SIGTERM"],
        [31, "SIGKILL"],
        [43, "SIGTERM"],
      ]) {
        const home = tmpHome();
        let ready;
        const isReady = new Promise((resolve) => (ready = resolve));
        const run = child("child-loop.js", { url: srv.url, home }, (m) => m === "ready" && ready());
        await within(Promise.race([isReady, run.exited.then((e) => Promise.reject(new Error(`the child ended before it was ready: ${JSON.stringify(e)} ${run.seen.stderr}`)))]), 10000, "the first sign-in of the child");
        await wait(delay);
        run.c.kill(signal);
        await within(run.exited, 6000, "the child ends after the signal");
        const file = authFile("far", { home });
        const doc = readJson(file);
        assert.equal(doc.server, "far", `${signal} after ${delay} ms`);
        assert.equal(doc.url, srv.url);
        assert.notEqual(signInStamp("far", srv.url, { home }), null, `${signal} after ${delay} ms`);
        assert.equal(mode(file), 0o600);
      }
    } finally {
      srv.stop();
    }
  });
});

describe("the files of this part", () => {
  const files = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  test("none holds a home folder path, an e-mail address or one of the four words", () => {
    const all = [...files(path.join(ROOT, "auth", "src")), ...files(path.join(ROOT, "auth", "test"))];
    assert.ok(all.some((f) => f.endsWith(path.join("src", "index.js"))));
    assert.ok(all.length >= 6);
    const edge = (w) => new RegExp(`(?<![A-Za-z0-9_])${w}(?![A-Za-z0-9_])`);
    const checks = [
      ["a home folder path", new RegExp("/Us" + "ers/[A-Za-z0-9_]")],
      ["a home folder path", new RegExp("/ho" + "me/[A-Za-z0-9_]")],
      ["an e-mail address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/],
      ["a word", edge("Er" + "ic")],
      ["a word", edge("Ground" + "Zero")],
      ["a word", edge("fac" + "tory")],
      ["a word", edge("ME" + "ETS")],
    ];
    for (const f of all) {
      const text = fs.readFileSync(f, "utf8");
      for (const [what, re] of checks) assert.ok(!re.test(text), `${path.relative(ROOT, f)} holds ${what}`);
    }
  });
});
