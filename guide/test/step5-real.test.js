// the meeting point of guide, "Step 5", "The runs through the real thing", run 5: the real command started in the root of the
// repository, the real practice server, the client of the package. Nothing is replaced, and the real `claude` command is
// never started. The client is named `guide-test`, which is no known host program: no settings file of a host is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, host, parsePage, readPage, sectionOf, tmpDir, tmpFile } from "./helpers.js";

test("run 5: the folders block of the page, with the roots of the host program", { timeout: 60000 }, async () => {
  const block = sectionOf(parsePage(readPage()), "Folders and rules from the host program")?.blocks.find(
    (one) => one.tag === "json",
  );
  assert.ok(block, "no json block in the section 'Folders and rules from the host program'");
  const settings = JSON.parse(block.text);
  settings.onetool = { ...settings.onetool, log: false };
  const file = tmpFile("settings.json", JSON.stringify(settings));
  const folder = tmpDir("session");
  writeFileSync(join(folder, "a.txt"), "hello");
  const args = [`${ROOT}/bin/onetool.js`, "--config", file];

  const given = await host(process.execPath, args, { roots: [folder] });
  try {
    assert.equal(await given.search(), "practice: 5 tools\nshell: 4 tools");
    const read = await given.run('await read("a.txt")');
    assert.equal(read.isError, false, read.text);
    assert.equal(read.text.split("\n")[0], "hello");
  } finally {
    await given.close();
  }

  const none = await host(process.execPath, args);
  try {
    assert.equal(
      await none.search(),
      "practice: 5 tools\nshell: not connected (no folder: onetool.shell.folders is not set and the host program gave none)",
    );
  } finally {
    await none.close();
  }
});
