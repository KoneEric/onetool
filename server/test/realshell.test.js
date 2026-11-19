// Step 4: the shell through the real thing. The command is a process, the practice server is a process behind it, and the
// client of the package speaks to it. Nothing is replaced. The points are those of the meeting point of server, "Step 4: the
// built-in server `shell`", "The shell, through the real thing".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BIN, PRACTICE, ROOT, textOf, tmpDir, writeSettings, withoutSession } from "./helpers.js";
import { OFF_HINT, failed, workFolder } from "./shellhelpers.js";

/** The command, and a client of the package; `fn(client)` runs, and the client is closed after. */
async function withClient(settings, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", writeSettings(settings)],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), HOME: tmpDir() },
    stderr: "pipe",
  });
  const client = new Client({ name: "realshell", version: "0.0.0" });
  await client.connect(transport, { timeout: 10000 });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

const run = async (client, code) => {
  const result = await client.callTool({ name: "run", arguments: { code } }, undefined, { timeout: 20000 });
  return { text: textOf(result), isError: result.isError === true };
};
const search = async (client) => textOf(await client.callTool({ name: "search", arguments: {} }));

const SERVERS = () => ({ practice: { command: "node", args: [PRACTICE] } });

test("the shell through the real thing", async () => {
  const { parent, W } = workFolder({ "one.txt": "alpha needle\n", "two.txt": "nothing\n", "three.txt": "needle again\n" });
  writeFileSync(join(parent, "outside.txt"), "outside\n");
  const settings = {
    mcpServers: SERVERS(),
    onetool: { shell: { folders: [W], deny: ["rm *"] }, trail: false, log: false },
  };

  await withClient(settings, async (client) => {
    // 1. exactly run and search; the catalog
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
    assert.equal(await search(client), "practice: 5 tools\nshell: 4 tools");

    // 2. a command, an edit
    const code = [
      'const found = (await $`grep -l needle *.txt`.text()).trim().split("\\n");',
      'await edit(found[0], "needle", "thread");',
      "found[0]",
    ].join("\n");
    assert.deepEqual(await run(client, code), { text: "one.txt", isError: false });
    assert.equal(readFileSync(join(W, "one.txt"), "utf8"), "alpha thread\n");

    // 3. a path outside
    assert.deepEqual(await run(client, 'await read("../outside.txt")'), {
      text: failed("Error: onetool: shell.read is refused: ../outside.txt is outside the listed folders"),
      isError: true,
    });

    // 4. a command the rules deny
    assert.deepEqual(await run(client, "await $`rm two.txt`"), {
      text: failed('Error: onetool: shell.run is denied by the rule deny "rm *" of onetool.shell'),
      isError: true,
    });
    assert.equal(existsSync(join(W, "two.txt")), true);
  });

  // 5. a second process, the same file without the key `shell`
  await withClient({ mcpServers: SERVERS(), onetool: { trail: false, log: false } }, async (client) => {
    assert.deepEqual(await run(client, "await $`ls`"), {
      text: failed(`ReferenceError: $ is not defined ${OFF_HINT}`),
      isError: true,
    });
    assert.equal(withoutSession(await search(client)), "practice: 5 tools");
  });
});
