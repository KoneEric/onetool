// Step 4: the record of every call through the real thing. The command is a process, the practice server is a process
// behind it, and the client of the package speaks to it. Nothing is replaced. The points are those of the meeting point of server,
// "Step 4: the record of every call", "The record, through the real thing".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BIN, PRACTICE, ROOT, alive, textOf, tmpDir, waitFor, writeSettings } from "./helpers.js";
import { WAITING_COMMAND, pidsIn, workFolder } from "./shellhelpers.js";
import { FILE_NAME, KEYS, assertShape, logEntries, logFiles, logText, trailLine } from "./recordhelpers.js";

async function withClient(settings, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", writeSettings(settings)],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), HOME: tmpDir() },
    stderr: "pipe",
  });
  const client = new Client({ name: "realrecord", version: "0.0.0" });
  await client.connect(transport, { timeout: 10000 });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

const run = async (client, code) => {
  const result = await client.callTool({ name: "run", arguments: { code } }, undefined, { timeout: 20000 });
  const text = textOf(result);
  return { text, lines: text.split("\n"), isError: result.isError === true };
};

test("the record of every call through the real thing", async () => {
  const { parent, W } = workFolder({ "one.txt": "alpha needle\n", "two.txt": "nothing\n", "three.txt": "needle again\n" });
  writeFileSync(join(parent, "outside.txt"), "outside\n");
  const L = tmpDir();
  const secret = "SECRET-TEXT-OF-THE-FILE";
  const servers = { practice: { command: "node", args: [PRACTICE] } };
  const settings = {
    mcpServers: servers,
    onetool: { shell: { folders: [W], deny: ["rm *"] }, timeoutSeconds: 3, trail: true, logFolder: L },
  };
  let pids;
  try {
    await withClient(settings, async (client) => {
      // 1. points 2, 3 and 4 of "The shell, through the real thing", each answer followed by its trail
      const code = [
        'const found = (await $`grep -l needle *.txt`.text()).trim().split("\\n");',
        'await edit(found[0], "needle", "thread");',
        "found[0]",
      ].join("\n");
      const found = await run(client, code);
      assert.equal(found.isError, false);
      assert.equal(found.lines.length, 4, found.text);
      assert.equal(found.lines[0], "one.txt");
      assert.equal(found.lines[1], "--- calls ---");
      assert.match(found.lines[2], trailLine("shell.run", "\\d+ chars"));
      assert.match(found.lines[3], trailLine("shell.edit", "0 chars"));
      assert.equal(readFileSync(join(W, "one.txt"), "utf8"), "alpha thread\n");

      const outside = await run(client, 'await read("../outside.txt")');
      assert.equal(outside.isError, true);
      assert.equal(
        outside.lines[0],
        "The program failed: Error: onetool: shell.read is refused: ../outside.txt is outside the listed folders",
      );
      assert.equal(outside.lines[1], "--- calls ---");
      assert.match(outside.lines.at(-1), trailLine("shell.read", "refused"));
      assert.equal(outside.lines.length, 3);

      const denied = await run(client, "await $`rm two.txt`");
      assert.equal(denied.isError, true);
      assert.equal(
        denied.lines[0],
        'The program failed: Error: onetool: shell.run is denied by the rule deny "rm *" of onetool.shell',
      );
      assert.match(denied.lines.at(-1), trailLine("shell.run", "refused"));
      assert.equal(denied.lines.length, 3);
      assert.equal(existsSync(join(W, "two.txt")), true);

      // 2. a file written and a tool of the practice server: three lines after 625
      const both = await run(client, `await write("new.txt", "${secret}"); (await tools.practice.count({ city: "Lyon" })).count`);
      assert.equal(both.isError, false);
      assert.equal(both.lines.length, 4, both.text);
      assert.equal(both.lines[0], "625");
      assert.equal(both.lines[1], "--- calls ---");
      assert.match(both.lines[2], trailLine("shell.write", "0 chars"));
      // {"count":625} is 13 characters
      assert.match(both.lines[3], trailLine("practice.count", "13 chars"));

      // 3. a command that starts a child, writes both process numbers to a file of W and waits
      const slow = await run(client, `await $(${JSON.stringify(WAITING_COMMAND)})`);
      assert.equal(slow.isError, true);
      assert.equal(slow.lines[0], "The program was stopped after 3 seconds.");
      assert.equal(slow.lines[1], "--- calls ---");
      assert.match(slow.lines.at(-1), trailLine("shell.run", "unfinished"));
      assert.equal(slow.lines.length, 3);
      pids = await waitFor(() => (existsSync(join(W, "pids")) ? pidsIn(readFileSync(join(W, "pids"), "utf8")) : null), 3000, "the process numbers");
      await waitFor(() => pids.every((pid) => !alive(pid)), 2000, "neither process to be there");
    });

    // 4. the log: one file per day, seven lines, eight keys, one session
    const names = logFiles(L);
    assert.ok(names.length >= 1);
    for (const name of names) assert.match(name, FILE_NAME);
    const entries = logEntries(L);
    assert.equal(entries.length, 7);
    for (const entry of entries) {
      assertShape(entry);
      assert.deepEqual(Object.keys(entry), KEYS);
    }
    assert.equal(new Set(entries.map((entry) => entry.session)).size, 1);
    assert.deepEqual(entries.find((entry) => entry.id === "shell.write").args, { path: "new.txt", size: 23 });
    const removed = entries.find((entry) => entry.args?.command === "rm two.txt");
    assert.equal(removed.decision, "denied");
    assert.deepEqual(removed.args, { command: "rm two.txt" });
    const text = logText(L);
    for (const piece of [secret, "alpha", L, W]) assert.ok(!text.includes(piece), `the log does not hold ${piece}`);

    // 5. the same settings with the trail and the log off: no trail, and L gets nothing more
    const before = { names: logFiles(L), text: logText(L) };
    const quiet = { ...settings, onetool: { ...settings.onetool, trail: false, log: false } };
    await withClient(quiet, async (client) => {
      const again = await run(client, `await write("again.txt", "x"); (await tools.practice.count({ city: "Lyon" })).count`);
      assert.deepEqual(again, { text: "625", lines: ["625"], isError: false });
      const failing = await run(client, 'await read("../outside.txt")');
      assert.equal(
        failing.text,
        "The program failed: Error: onetool: shell.read is refused: ../outside.txt is outside the listed folders",
      );
    });
    assert.deepEqual(logFiles(L), before.names);
    assert.equal(logText(L), before.text);
  } finally {
    for (const pid of pids ?? []) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
});
