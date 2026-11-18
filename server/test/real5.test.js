// The run through the real thing, step 5 (the meeting point of server, "Step 5: through the real thing"): the command as a process
// with HOME set to a folder the test made, the real practice server behind it, the client of the package on its
// standard input and output. Nothing is replaced. The real `claude` command is never started, and no process is
// started with a known host name and the home of the person who runs the test. Points 1 to 19 of the text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, ListRootsRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { BIN, PRACTICE, ROOT, sleep, textOf, writeSettings } from "./helpers.js";
import { logEntries, logText } from "./recordhelpers.js";
import { NO_FOLDERS_ANSWER, NO_FOLDERS_LINE, UNKNOWN_HOST_LINE, countLine, hostDenial, hostQuestion, hostRefusal, put, unreadableLine, world } from "./stepfive.js";

const FAKE_CLAUDE = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "fake-claude.mjs");
const SHELL_NAMES = ["$`", "read(", "write(", "edit("];
const FAILED = (message) => `The program failed: Error: ${message}`;
const SAID_NO = "the person said no";

/**
 * One host program in front of one process of the command started with the settings `settings`, HOME being `home`.
 * `roots` is the list of folders it says the session works in (`undefined` for a host with no roots), `canAsk` whether
 * it can ask the person; `self.person` is what it answers to a question.
 */
async function connect(settings, home, { name, roots, canAsk = false }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", writeSettings(settings)],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), HOME: home },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  const capabilities = { ...(roots === undefined ? {} : { roots: { listChanged: true } }), ...(canAsk ? { elicitation: {} } : {}) };
  const client = new Client({ name, version: "1.0.0" }, { capabilities });
  const self = { client, roots, questions: [], person: "accept", listChanged: 0, stderr: () => stderr };
  if (roots !== undefined) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: self.roots.map((folder) => ({ uri: pathToFileURL(folder).href })) }));
  }
  if (canAsk) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      self.questions.push(request.params);
      return { action: self.person };
    });
  }
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    self.listChanged += 1;
  });
  await client.connect(transport, { timeout: 10000 });
  self.run = async (code) => {
    const result = await client.callTool({ name: "run", arguments: { code } }, undefined, { timeout: 20000 });
    const text = textOf(result);
    return { text, lines: text.split("\n"), isError: result.isError === true };
  };
  self.search = async () => textOf(await client.callTool({ name: "search", arguments: {} }));
  self.describe = async () => (await client.listTools()).tools.find((tool) => tool.name === "run")?.description ?? "";
  self.names = async () => (await client.listTools()).tools.map((tool) => tool.name);
  self.setRoots = async (folders) => {
    self.roots = folders;
    await client.sendRootsListChanged();
  };
  self.close = () => client.close().catch(() => {});
  return self;
}

const PRACTICE_ENTRY = { command: "node", args: [PRACTICE] };

test("step 5 through the real thing", async () => {
  const w = world();
  const { H, A, B, L, fileA, userFile } = w;
  const S = { mcpServers: { practice: PRACTICE_ENTRY }, onetool: { shell: { deny: ["ls *"] }, trail: true, logFolder: L } };
  const open = [];
  try {
    // ---- a host that is not known and gives no folder
    const plain = await connect(S, H, { name: "some-host" });
    open.push(plain);
    // 1.
    assert.deepEqual(await plain.names(), ["run", "search"]);
    const offDescription = await plain.describe();
    assert.ok(!SHELL_NAMES.some((one) => offDescription.includes(one)), "the description of run does not name the shell");
    assert.equal(await plain.search(), `practice: 5 tools\n${NO_FOLDERS_LINE}`);
    // 2.
    assert.deepEqual(await plain.run("await $`ls`.text()"), { text: NO_FOLDERS_ANSWER, lines: [NO_FOLDERS_ANSWER], isError: true });
    // 3.
    await sleep(300);
    assert.equal(countLine(plain.stderr(), UNKNOWN_HOST_LINE), 1);
    await plain.close();

    // ---- Claude Code as the host
    const claude = await connect(S, H, { name: "claude-code", roots: [A], canAsk: true });
    open.push(claude);
    // 4.
    const description = await claude.describe();
    assert.ok(description.includes("$`command`") && description.includes("read(path)"));
    assert.equal(await claude.search(), "practice: 5 tools\nshell: 4 tools");
    assert.deepEqual(await claude.names(), ["run", "search"]);
    // 5.
    const one = await claude.run('await read("one.txt")');
    assert.equal(one.isError, false);
    assert.equal(one.lines.length, 4, one.text);
    assert.deepEqual(one.lines.slice(0, 3), ["alpha", "", "--- calls ---"]);
    assert.match(one.lines[3], /^shell\.read \d+ ms 6 chars$/);
    // 6.
    const removed = await claude.run("await $`rm one.txt`");
    assert.equal(removed.isError, true);
    assert.equal(removed.lines[0], FAILED(hostDenial("shell.run", "Bash(rm *)", fileA)));
    assert.equal(existsSync(join(A, "one.txt")), true);
    // 7.
    const secret = await claude.run('await read("secret.txt")');
    assert.equal(secret.lines[0], FAILED(hostDenial("shell.read", "Read(./secret.txt)", fileA)));
    assert.ok(!secret.text.includes("hidden"), "the allow of the same file undoes nothing");
    // 8.
    claude.person = "accept";
    const edited = await claude.run('await edit("notes.txt", "draft", "final")');
    assert.equal(edited.isError, false, edited.text);
    assert.equal(claude.questions.length, 1);
    assert.equal(
      claude.questions[0].message,
      hostQuestion("shell.edit", "Edit(./notes.txt)", '{"path":"notes.txt","old":"draft","new":"final"}', fileA),
    );
    assert.equal(readFileSync(join(A, "notes.txt"), "utf8"), "final\n");
    claude.person = "decline";
    const kept = await claude.run('await edit("notes.txt", "final", "draft")');
    assert.equal(kept.isError, true);
    assert.equal(kept.lines[0], FAILED(hostRefusal("shell.edit", "Edit(./notes.txt)", SAID_NO, fileA)));
    assert.equal(readFileSync(join(A, "notes.txt"), "utf8"), "final\n");
    // 9.
    const listed = await claude.run("await $`ls -a`");
    assert.equal(listed.lines[0], FAILED('onetool: shell.run is denied by the rule deny "ls *" of onetool.shell'));
    // 10.
    const curl = await claude.run("await $`curl --version`");
    assert.equal(curl.lines[0], FAILED(hostDenial("shell.run", "Bash(curl *)", userFile)));
    // 11.
    const before = await claude.run("await $`cat one.txt`.text()");
    assert.equal(before.lines[0], "alpha");
    writeFileSync(w.localA, JSON.stringify({ permissions: { deny: ["Bash(cat *)"] } }));
    const after = await claude.run("await $`cat one.txt`.text()");
    assert.equal(after.lines[0], FAILED(hostDenial("shell.run", "Bash(cat *)", w.localA)));
    // 12.
    await claude.setRoots([B, A]);
    const two = await claude.run('await read("two.txt")');
    assert.equal(two.lines[0], "beta");
    // 13.
    const changedBefore = claude.listChanged;
    await claude.setRoots([]);
    assert.equal(await claude.search(), `practice: 5 tools\n${NO_FOLDERS_LINE}`);
    const gone = await claude.describe();
    assert.ok(!SHELL_NAMES.some((one) => gone.includes(one)));
    await sleep(200);
    assert.ok(claude.listChanged >= changedBefore + 1, "the host was told that the list of tools changed");
    // 14.
    put(w.fileB, "not json");
    await claude.setRoots([B]);
    const first = await claude.run('await read("two.txt")');
    const second = await claude.run('await read("two.txt")');
    assert.equal(first.lines[0], "beta");
    assert.equal(second.lines[0], "beta");
    await sleep(200);
    assert.equal(countLine(claude.stderr(), unreadableLine(w.fileB)), 1);
    await claude.close();
    // 15.
    const entries = logEntries(L);
    const rm = entries.find((entry) => entry.args?.command === "rm one.txt");
    assert.deepEqual([rm.decision, rm.fault], ["denied", "refused by the rules"]);
    assert.deepEqual(entries.filter((entry) => entry.id === "shell.edit").map((entry) => entry.decision), ["asked: yes", "asked: no"]);
    assert.ok(!logText(L).includes("hidden"));

    // ---- "hostRules": false
    const norules = await connect({ ...S, onetool: { ...S.onetool, hostRules: false } }, H, { name: "claude-code", roots: [A] });
    open.push(norules);
    // 16.
    assert.equal((await norules.run('await read("secret.txt")')).lines[0], "hidden");
    await sleep(200);
    assert.ok(!norules.stderr().split("\n").some((line) => line.startsWith("onetool: host rules:")), norules.stderr());
    await norules.close();

    // ---- a listed server that is the host itself
    const listedSettings = {
      mcpServers: { claude: { command: "node", args: [FAKE_CLAUDE] } },
      onetool: { hostServers: ["claude"], trail: true, log: false },
    };
    const behind = await connect(listedSettings, H, { name: "claude-code", roots: [A] });
    open.push(behind);
    // 17.
    const ran = await behind.run('await tools.claude.Bash({ command: "echo hi" })');
    assert.equal(ran.isError, false);
    assert.equal(ran.lines.length, 3, ran.text);
    assert.deepEqual(ran.lines.slice(0, 2), ["ran", "--- calls ---"]);
    assert.match(ran.lines[2], /^claude\.Bash \d+ ms 3 chars$/);
    // 18.
    const rmx = await behind.run('await tools.claude.Bash({ command: "rm x" })');
    assert.equal(rmx.isError, true);
    assert.equal(rmx.lines[0], FAILED(hostDenial("claude.Bash", "Bash(rm *)", fileA)));
    // 19.
    const readSecret = await behind.run(`await tools.claude.Read({ file_path: ${JSON.stringify(join(A, "secret.txt"))} })`);
    assert.equal(readSecret.lines[0], FAILED(hostDenial("claude.Read", "Read(./secret.txt)", fileA)));
    const readOne = await behind.run(`await tools.claude.Read({ file_path: ${JSON.stringify(join(A, "one.txt"))} })`);
    assert.equal(readOne.lines[0], "read");
    await behind.close();
  } finally {
    for (const one of open) await one.close();
  }
});
