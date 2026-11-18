// the meeting point of guide, "Step 10: signing in", "The runs through the real thing", run 9: the practice server started as a
// process with `--port 0 --signin`, the real command started in the root of the repository, the client of the package, the
// command of the page. Nothing is replaced. `HOME` is a folder the test made, for every process. No browser is started: the
// test opens the printed address with `fetch`. Every wait has a limit of 10 seconds or less.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { readSettings } from "../../core/src/index.js";
import { ROOT, host, parsePage, readPage, sectionOf, tmpDir, tmpFile } from "./helpers.js";

const COMMAND = "node /absolute/path/to/onetool/bin/onetool.js login notes --config /absolute/path/to/settings.json";
const children = new Set();
process.on("exit", () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A process with its standard output and error collected; `until(regex, ms)` waits for a match in standard output. */
function start(args, { home }) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, HOME: home }, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  child.stdin.on("error", () => {});
  const exited = new Promise((resolve) =>
    child.on("close", (code, signal) => {
      children.delete(child);
      resolve({ code, signal });
    }),
  );
  return {
    stdout: () => out,
    stderr: () => err,
    exited,
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    },
    async until(regex, ms = 10000) {
      const end = Date.now() + ms;
      for (;;) {
        const found = regex.exec(out);
        if (found) return found;
        if (child.exitCode !== null || child.signalCode !== null) {
          assert.fail(`the process ended (code ${child.exitCode}) with no line that matches ${regex}; stdout: ${out}; stderr: ${err}`);
        }
        if (Date.now() >= end) assert.fail(`no line that matches ${regex} in ${ms} ms; stdout: ${out}; stderr: ${err}`);
        await sleep(20);
      }
    },
    async within(ms = 10000) {
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`still there after ${ms} ms; stdout: ${out}; stderr: ${err}`)), ms);
      });
      try {
        return await Promise.race([exited, late]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

test("run 9: the sign-in block of the page, the command of the page, and no restart", { timeout: 90000 }, async () => {
  const signing = sectionOf(parsePage(readPage()), "Signing in");
  assert.ok(signing, "the page has no section '## Signing in'");
  const first = signing.blocks[0];
  assert.ok(first && first.tag === "json", "the first fenced block of 'Signing in' is not a json block");
  const shell = signing.blocks.find((block) => block.tag === "sh" && block.text.includes(COMMAND));
  assert.ok(shell, `no fenced sh block of 'Signing in' holds ${COMMAND}`);
  const second = signing.blocks.filter((block) => block.tag === "json")[1];
  assert.ok(second, "no second json block in 'Signing in'");

  const home = tmpDir("home");
  const practice = start([join(ROOT, "practice", "src", "server.js"), "--port", "0", "--signin"], { home });
  let tried;
  let login;
  try {
    const [, address] = await practice.until(/^practice: listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)\n/, 10000);

    const settings = JSON.parse(first.text);
    settings.mcpServers.notes.url = address;
    settings.onetool = { log: false, trail: false, connectSeconds: 5, timeoutSeconds: 10 };
    const file = tmpFile("settings.json", JSON.stringify(settings));

    tried = await host(process.execPath, [join(ROOT, "bin", "onetool.js"), "--config", file], { home });
    assert.equal(await tried.search(), "notes: sign in needed");

    // the command as the page writes it, its two paths put in, started through node, with two options added
    const [, ...rest] = COMMAND.split(" ");
    const args = rest.map((word) =>
      word === "/absolute/path/to/onetool/bin/onetool.js"
        ? join(ROOT, "bin", "onetool.js")
        : word === "/absolute/path/to/settings.json"
          ? file
          : word,
    );
    login = start([...args, "--no-browser", "--wait", "10"], { home });
    const [, open] = await login.until(/^onetool: to sign in to notes, open (\S+)$/m, 10000);
    const response = await fetch(open, { signal: AbortSignal.timeout(8000) });
    await response.arrayBuffer();
    const ended = await login.within(10000);
    assert.equal(ended.code, 0, `stdout: ${login.stdout()}; stderr: ${login.stderr()}`);
    assert.equal(login.stdout().trimEnd().split("\n").at(-1), "onetool: signed in to notes");

    // the same onetool, not restarted
    assert.equal(await tried.search(), "notes: 5 tools");
    const counted = await tried.run('(await tools.notes.count({ city: "Lyon" })).count');
    assert.equal(counted.isError, false, counted.text);
    assert.equal(counted.text, "625");

    assert.equal(statSync(join(home, ".onetool", "auth", "notes.json")).mode & 0o777, 0o600);
  } finally {
    if (tried) await tried.close();
    if (login) login.kill();
    practice.kill();
  }

  // the second block of the section: a server tracker with its oauth key
  const settings = readSettings(tmpFile("tracker.json", second.text));
  assert.deepEqual(settings.bad, []);
  const tracker = settings.servers.find((server) => server.name === "tracker");
  assert.ok(tracker, "no server tracker");
  assert.deepEqual(tracker.oauth, { clientId: "your-client-id", scopes: ["read"], port: 8765 });
});
