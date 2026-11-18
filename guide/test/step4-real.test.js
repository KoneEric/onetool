// the meeting point of guide, "Step 4", "The runs through the real thing", runs 3 and 4: the real command started in the root of the
// repository, the real practice server, the client of the package. Nothing is replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, host, parsePage, readPage, sectionOf, tmpDir, tmpFile } from "./helpers.js";

const firstJson = (name) => {
  const block = sectionOf(parsePage(readPage()), name)?.blocks.find((one) => one.tag === "json");
  assert.ok(block, `no json block in the section '${name}'`);
  return JSON.parse(block.text);
};
const start = (settings) =>
  host(process.execPath, [`${ROOT}/bin/onetool.js`, "--config", tmpFile("settings.json", JSON.stringify(settings))], {
    canAsk: true,
  });

test("run 3: the shell block of the page", { timeout: 60000 }, async () => {
  const settings = firstJson("The shell and files");
  assert.deepEqual(settings.onetool.shell.folders, ["/absolute/path/to/project"]);
  settings.onetool.shell.folders = [tmpDir("project")];
  settings.onetool.logFolder = tmpDir("logs");
  const tried = await start(settings);
  try {
    assert.equal(await tried.search(), "practice: 5 tools\nshell: 4 tools");

    const hello = await tried.run("await $`echo hello`.text()");
    assert.equal(hello.isError, false);
    const lines = hello.text.split("\n");
    assert.equal(lines.length, 4, hello.text);
    assert.equal(lines[0], "hello");
    assert.equal(lines[1], "");
    assert.equal(lines[2], "--- calls ---");
    assert.match(lines[3], /^shell\.run \d+ ms \d+ chars$/);

    const denied = await tried.run("await $`rm x`");
    assert.equal(denied.isError, true);
    assert.ok(
      denied.text.startsWith('The program failed: Error: onetool: shell.run is denied by the rule deny "rm *" of onetool.shell'),
      denied.text,
    );
  } finally {
    await tried.close();
  }
});

test("run 4: the log block of the page", { timeout: 60000 }, async () => {
  const block = sectionOf(parsePage(readPage()), "The trail and the log")?.blocks.find(
    (one) => one.tag === "json" && JSON.parse(one.text).onetool?.logFolder !== undefined,
  );
  assert.ok(block, "no json block with logFolder in 'The trail and the log'");
  const settings = JSON.parse(block.text);
  assert.equal(settings.onetool.logFolder, "/absolute/path/to/logs");
  const logs = tmpDir("logs");
  settings.onetool.logFolder = logs;
  const tried = await start(settings);
  try {
    const counted = await tried.run('(await tools.practice.count({ city: "Lyon" })).count');
    assert.equal(counted.isError, false);
    const lines = counted.text.split("\n");
    assert.equal(lines[0], "625");
    assert.equal(lines[1], "--- calls ---");
    assert.ok(lines[2]?.startsWith("practice.count "), counted.text);
  } finally {
    await tried.close();
  }
  const files = readdirSync(logs);
  assert.equal(files.length, 1, files.join(", "));
  assert.match(files[0], /^calls-.+\.jsonl$/);
  const rows = readFileSync(join(logs, files[0]), "utf8").split("\n").filter((line) => line !== "");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]).id, "practice.count");
});
