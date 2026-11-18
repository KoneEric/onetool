// the meeting point of guide, "The runs through the real thing": the real command, the real practice server, the client of the
// package on standard input and output. Nothing is replaced. Since step 5 runs 1 and 2 start the command on a copy of
// the example file with its log switched off, and run 1 reads the first line of an answer of `run`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGE, ROOT, exampleCopy, host, parsePage, sectionOf } from "./helpers.js";

const firstLine = (text) => text.split("\n")[0];

test("run 1: the example settings file, started in the root of the repository", { timeout: 60000 }, async () => {
  const copy = exampleCopy();
  const tried = await host(process.execPath, [`${ROOT}/bin/onetool.js`, "--config", copy], { canAsk: true });
  try {
    assert.equal(await tried.search(), "practice: 4 tools");

    const wiped = await tried.run("await tools.practice.wipe({})");
    assert.equal(firstLine(wiped.text), "wiped");
    assert.equal(wiped.isError, false);
    assert.equal(tried.questions.length, 1);

    const denied = await tried.run("await tools.practice.fail({})");
    assert.equal(denied.isError, true);
    assert.equal(
      firstLine(denied.text),
      'The program failed: Error: onetool: practice.fail is denied by the rule deny "practice.fail"',
    );
  } finally {
    await tried.close();
  }
});

test("run 2: the entry of the page, with the person's two paths put in", { timeout: 60000 }, async () => {
  const page = parsePage(readFileSync(PAGE, "utf8"));
  const first = sectionOf(page, "Add onetool to your host program")?.blocks.find((block) => block.tag === "json");
  assert.ok(first, "no json block in the section 'Add onetool to your host program'");
  const entry = JSON.parse(first.text).mcpServers.onetool;
  const copy = exampleCopy();
  const args = entry.args.map((arg) =>
    arg.replace("/absolute/path/to/settings.json", copy).replace("/absolute/path/to/onetool", ROOT),
  );
  const pasted = await host(entry.command, args);
  try {
    const { tools } = await pasted.client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ["run", "search"]);
  } finally {
    await pasted.close();
  }
});
