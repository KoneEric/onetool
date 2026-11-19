// the meeting point of guide, "Step 11", "The runs through the real thing", run 10: the real command `init`, started with
// `process.execPath` in the root of the repository, standard input not a terminal, `HOME` an empty folder of the test and
// `PATH` one folder of the test that holds a file `claude`, a script that only exits 1 (`init` never starts it). Nothing is
// replaced. Every wait has a limit of 10 seconds or less.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT, jsonBlocks, parsePage, readPage, sectionOf, tmpDir } from "./helpers.js";

const START = "Start with onetool init";
const BIN = join(ROOT, "bin", "onetool.js");

/** `init` with the arguments given, run to its end: nobody to ask, HOME and PATH folders of the test. */
function init(args, { home, path }) {
  const done = spawnSync(process.execPath, [BIN, "init", ...args], {
    cwd: ROOT,
    env: { HOME: home, PATH: path },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 10000,
  });
  return { code: done.status, signal: done.signal, stdout: done.stdout ?? "", stderr: done.stderr ?? "" };
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

test("run 10: the command of the page makes the file of the page, and --no-claude makes the empty file that onetool serves", { timeout: 60000 }, async () => {
  const block = jsonBlocks(sectionOf(parsePage(readPage()), START)?.blocks ?? [])[0];
  assert.ok(block, `the page has no json block in the section "## ${START}"`);
  const shown = JSON.parse(block.text);
  assert.equal(shown.mcpServers?.claude?.command, "/absolute/path/to/claude");

  const home = tmpDir("home");
  const bin = tmpDir("bin");
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "claude"), 0o755);
  const dir = tmpDir("settings");

  // init --config <S> --yes: the file of the page, with the path of the stand-in
  const first = join(dir, "settings.json");
  assert.ok(!existsSync(first));
  const one = init(["--config", first, "--yes"], { home, path: bin });
  assert.equal(one.code, 0, `signal ${one.signal}; stdout: ${one.stdout}; stderr: ${one.stderr}`);
  const expected = structuredClone(shown);
  expected.mcpServers.claude.command = `${bin}/claude`;
  assert.deepEqual(readJson(first), expected);
  const lines = one.stdout.split("\n");
  const brace = lines.indexOf("{");
  assert.ok(brace >= 0, `no line that is exactly { in: ${one.stdout}`);
  const entry = JSON.parse(lines.slice(brace).join("\n"));
  const args = entry.mcpServers.onetool.args;
  assert.equal(args.at(-1), first, `the args of the entry: ${JSON.stringify(args)}`);

  // init --config <S2> --no-claude: no server, and the command on it offers run and search
  const second = join(dir, "second.json");
  const two = init(["--config", second, "--no-claude"], { home, path: bin });
  assert.equal(two.code, 0, `signal ${two.signal}; stdout: ${two.stdout}; stderr: ${two.stderr}`);
  assert.deepEqual(readJson(second), { mcpServers: {} });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", second],
    cwd: ROOT,
    stderr: "pipe",
    env: { ...getDefaultEnvironment(), HOME: home, PATH: bin },
  });
  const client = new Client({ name: "guide-test", version: "1.0.0" }, { capabilities: {} });
  const within = (promise, what) => {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: no answer in 10 seconds`)), 10000);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  };
  try {
    await within(client.connect(transport), "connect");
    const listed = await within(client.listTools(), "tools/list");
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["run", "search"]);
  } finally {
    await client.close().catch(() => {});
  }
});
