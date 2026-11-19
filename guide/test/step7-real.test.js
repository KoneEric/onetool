// the meeting point of guide, "Step 7", "The runs through the real thing", run 7: the real command started in the root of the
// repository, the real practice server, the client of the package. Nothing is replaced. `HOME` is a folder the test made,
// so the person's own ~/.onetool is never read or written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, host, parsePage, readPage, sectionOf, tmpDir, tmpFile } from "./helpers.js";

const SAVE =
  'await library.save("lyon", { about: "Counts the rows of Lyon.", code: \'(await tools.practice.count({ city: "Lyon" })).count\' })';

test("run 7: the library block of the page, a program saved and called, with HOME a folder of the test", { timeout: 60000 }, async () => {
  const block = sectionOf(parsePage(readPage()), "The library")?.blocks.find((one) => one.tag === "json");
  assert.ok(block, "no json block in the section 'The library'");
  const settings = JSON.parse(block.text);
  settings.onetool = { ...settings.onetool, log: false, trail: false, timeoutSeconds: 10 };
  const file = tmpFile("settings.json", JSON.stringify(settings));
  const home = tmpDir("home");

  const tried = await host(process.execPath, [`${ROOT}/bin/onetool.js`, "--config", file], { canAsk: true, home });
  try {
    const saved = await tried.run(SAVE);
    assert.equal(saved.isError, false, saved.text);
    assert.equal(saved.text, "lib.lyon is saved in the user library.");
    assert.equal(tried.questions.length, 1);

    const path = join(home, ".onetool", "library", "lyon.js");
    assert.ok(existsSync(path), `${path} does not exist`);
    assert.equal(readFileSync(path, "utf8").split("\n")[0], "// about: Counts the rows of Lyon.");

    const called = await tried.run("await lib.lyon()");
    assert.equal(called.isError, false, called.text);
    assert.equal(called.text, "625");

    // since step 12 (guide, "Step 12", "What changes in what is built"): the answer is three lines, the last the line of the session
    assert.equal(
      await tried.search(),
      "practice: 5 tools\nlibrary: 1 programs\nthis session: 2 programs, 2 calls, 1.0 calls per program",
    );
  } finally {
    await tried.close();
  }
});

test("every run starts the command with HOME a folder the test made: the library goes there, in the home of the host", { timeout: 60000 }, async () => {
  // a run that names no home gets a new empty one of its own (the helper `host`)
  const settings = { mcpServers: { practice: { command: "node", args: ["practice/src/server.js"] } }, onetool: { log: false, trail: false, timeoutSeconds: 10 } };
  const file = tmpFile("settings.json", JSON.stringify(settings));
  const tried = await host(process.execPath, [`${ROOT}/bin/onetool.js`, "--config", file]);
  try {
    assert.deepEqual(readdirSync(tried.home), [], "the home of the run is not empty at the start");
    const saved = await tried.run('await library.save("one", { about: "One.", code: "1" })');
    assert.equal(saved.isError, false, saved.text);
    assert.ok(existsSync(join(tried.home, ".onetool", "library", "one.js")), "the program is not in the home of the run");
  } finally {
    await tried.close();
  }
});
