// the meeting point of guide, "Step 6", "The runs through the real thing", run 6: the real command started in the root of the
// repository, the real practice server, the client of the package. Nothing is replaced. The settings file is the first
// json block of "Background jobs" with `"log": false` added, so nothing is written in the folder `logs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOT, host, parsePage, readPage, sectionOf, tmpFile } from "./helpers.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("run 6: the jobs block of the page, a job started, asked for and listed", { timeout: 60000 }, async () => {
  const block = sectionOf(parsePage(readPage()), "Background jobs")?.blocks.find((one) => one.tag === "json");
  assert.ok(block, "no json block in the section 'Background jobs'");
  const settings = JSON.parse(block.text);
  settings.onetool = { ...settings.onetool, log: false };
  const file = tmpFile("settings.json", JSON.stringify(settings));

  const tried = await host(process.execPath, [`${ROOT}/bin/onetool.js`, "--config", file]);
  try {
    const started = await tried.call({
      code: 'progress("half"); (await tools.practice.count({ city: "Lyon" })).count',
      background: true,
    });
    assert.equal(started.isError, false, started.text);
    assert.equal(started.text, 'Job j1 started. Its state: run({ job: "j1" }). To stop it: run({ job: "j1", stop: true }).');

    // asked every 100 ms until its first line does not hold `running`, for 15 seconds at most
    const until = Date.now() + 15000;
    let asked = await tried.call({ job: "j1" });
    while (asked.text.split("\n")[0].includes("running") && Date.now() < until) {
      await sleep(100);
      asked = await tried.call({ job: "j1" });
    }
    assert.equal(asked.isError, false, asked.text);
    const lines = asked.text.split("\n");
    assert.match(lines[0], /^job j1: done, \d+ s$/, asked.text);
    let at = 0;
    for (const wanted of ["--- progress ---", "half", "--- answer ---", "625"]) {
      const found = lines.indexOf(wanted, at);
      assert.ok(found >= at, `the answer does not hold the line ${JSON.stringify(wanted)} in order: ${asked.text}`);
      at = found + 1;
    }

    const listed = await tried.call({ jobs: true });
    assert.equal(listed.isError, false, listed.text);
    assert.equal(listed.text.split("\n").length, 1, listed.text);
    assert.match(listed.text, /^j1: done, \d+ s$/);
  } finally {
    await tried.close();
  }
});
