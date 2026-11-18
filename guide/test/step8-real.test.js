// the meeting point of guide, "Step 8", "The runs through the real thing", run 8: the real command started in the root of the
// repository, the real practice server, the client of the package. Nothing is replaced. `HOME` is a folder the test made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, host, parsePage, readPage, sectionOf, tmpDir, tmpFile } from "./helpers.js";

const SAVE =
  'await library.save("lyon", { about: "Counts the rows of Lyon.", code: \'(await tools.practice.count({ city: "Lyon" })).count\' })';

test("run 8: the tidying block of the page, a program saved, removed, restored, called, and the report", { timeout: 60000 }, async () => {
  const block = sectionOf(parsePage(readPage()), "Tidying the library")?.blocks.find((one) => one.tag === "json");
  assert.ok(block, "no json block in the section 'Tidying the library'");
  const settings = JSON.parse(block.text);
  settings.onetool = { ...settings.onetool, log: false, trail: false, timeoutSeconds: 10 };
  const file = tmpFile("settings.json", JSON.stringify(settings));
  const home = tmpDir("home");

  const tried = await host(process.execPath, [`${ROOT}/bin/onetool.js`, "--config", file], { canAsk: true, home });
  try {
    const prompts = (await tried.client.listPrompts()).prompts ?? [];
    assert.deepEqual(prompts.map((prompt) => prompt.name), ["tidy-library"]);

    const saved = await tried.run(SAVE);
    assert.equal(saved.isError, false, saved.text);
    assert.equal(saved.text, "lib.lyon is saved in the user library.");

    const path = join(home, ".onetool", "library", "lyon.js");
    const removed = await tried.run('await library.remove("lyon")');
    assert.equal(removed.isError, false, removed.text);
    assert.equal(removed.text, "lib.lyon went to the archive of the user library.");
    assert.ok(!existsSync(path), `${path} still exists`);

    const back = await tried.run('await library.restore("lyon")');
    assert.equal(back.isError, false, back.text);
    assert.equal(back.text, "lib.lyon is back in the user library.");
    assert.ok(existsSync(path), `${path} does not exist again`);
    assert.equal(tried.questions.length, 3);

    const called = await tried.run("await lib.lyon()");
    assert.equal(called.isError, false, called.text);
    assert.equal(called.text, "625");

    const report = await tried.run("await library.report()");
    assert.equal(report.isError, false, report.text);
    assert.ok(report.text.length <= 6000, `${report.text.length} characters`);
    const lines = report.text.trimEnd().split("\n");
    assert.equal(lines[0], "Library report: 1 programs");
    assert.equal(lines.at(-1), "(the log is switched off: no sequence is counted)");
    assert.equal(tried.questions.length, 3);
  } finally {
    await tried.close();
  }
});
