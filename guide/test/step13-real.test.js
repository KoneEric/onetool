// the meeting point of guide, "Step 13", "The runs through the real thing", run 12: the real command `init`, started with
// `process.execPath` in the root of the repository, standard input not a terminal, `HOME` an empty folder `H` of the test and `PATH`
// one folder `B` of the test that holds two files, `claude` and `codex`, each a script that only exits 1 (`init` never starts
// them). Nothing is replaced. Every wait has a limit of 10 seconds or less. Nothing reads or writes a file of the person who runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT, parsePage, readPage, sectionOf, tmpDir } from "./helpers.js";

const GROUPING = "Grouping the work";
const BIN = join(ROOT, "bin", "onetool.js");

const squeeze = (text) => text.replace(/\s+/g, " ").trim();
/** Cut at each run of one or more empty lines, then each piece with its white space squeezed and its ends trimmed. */
const paragraphs = (text) => text.trim().split(/\n\s*\n/).map(squeeze);

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

/** `promise`, or a failure after 10 seconds. */
const within = (promise, what) => {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: no answer in 10 seconds`)), 10000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

/** The lines of a file as a person reads them: split at the line breaks, the empty piece after the last one left out. */
const linesOf = (text) => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

test("run 12: the paragraphs of the page are the ones init adds, init again changes no byte, and the command on the file gives the instructions", { timeout: 90000 }, async () => {
  const section = sectionOf(parsePage(readPage()), GROUPING);
  assert.ok(section, `the page has no section "## ${GROUPING}"`);
  const texts = section.blocks.filter((block) => block.tag === "text");
  assert.equal(texts.length, 1, `${texts.length} blocks with the tag text in "## ${GROUPING}"`);
  const onPage = paragraphs(texts[0].text);
  assert.equal(onPage.length, 2, `${onPage.length} paragraphs in the block with the tag text`);
  const marks = section.blocks
    .filter((block) => block.tag !== "json" && block.tag !== "text")
    .flatMap((block) => block.text.split("\n"));
  const begin = marks.find((line) => line.startsWith("<!-- onetool: begin"));
  const end = marks.find((line) => line.startsWith("<!-- onetool: end"));
  assert.ok(begin && end, "the page holds no two marker lines in a fenced block that is neither json nor text");

  const home = tmpDir("home");
  const bin = tmpDir("bin");
  for (const name of ["claude", "codex"]) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 1\n");
    chmodSync(join(bin, name), 0o755);
  }
  const settings = join(tmpDir("settings"), "settings.json");
  assert.ok(!existsSync(settings));

  const one = init(["--config", settings, "--yes", "--no-claude"], { home, path: bin });
  assert.equal(one.code, 0, `signal ${one.signal}; stdout: ${one.stdout}; stderr: ${one.stderr}`);

  const files = [join(home, ".claude", "CLAUDE.md"), join(home, ".codex", "AGENTS.md")];
  const before = [];
  for (const file of files) {
    assert.ok(existsSync(file), `${file} is not there; stdout: ${one.stdout}; stderr: ${one.stderr}`);
    const bytes = readFileSync(file);
    before.push(bytes);
    const lines = linesOf(bytes.toString("utf8"));
    assert.equal(lines[0], begin, `the first line of ${file}`);
    assert.equal(lines.at(-1), end, `the last line of ${file}`);
    assert.deepEqual(paragraphs(lines.slice(1, -1).join("\n")), onPage, `what is between the marker lines of ${file}`);
  }

  // again: the bytes of the two files are what they were
  const two = init(["--config", settings, "--yes", "--no-claude"], { home, path: bin });
  assert.equal(two.signal, null, `signal ${two.signal}`);
  files.forEach((file, index) => {
    assert.ok(readFileSync(file).equals(before[index]), `${file} changed on the second init`);
  });

  // the real command on the settings file init made
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", settings],
    cwd: ROOT,
    stderr: "pipe",
    env: { ...getDefaultEnvironment(), HOME: home, PATH: bin },
  });
  const client = new Client({ name: "guide-test", version: "1.0.0" }, { capabilities: {} });
  try {
    await within(client.connect(transport), "connect");
    const listed = await within(client.listTools(), "tools/list");
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["run", "search"]);
    const told = client.getInstructions();
    assert.equal(typeof told, "string");
    assert.ok(told.includes("ask for run and search together, in one request"), told);
  } finally {
    await client.close().catch(() => {});
  }
});
