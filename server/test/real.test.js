// The run through the real thing: the command as a process, the real practice server behind it, the client of the
// package on its standard input and output. Nothing is replaced. The points are those of the meeting point of server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRACTICE, LINE, practiceRows, settingsOf, textOf, withOnetool } from "./helpers.js";

const REAL = () => settingsOf({ practice: { command: "node", args: [PRACTICE] } }, { deny: ["practice.wipe"] });

test("the run through the real thing", async () => {
  await withOnetool(REAL(), async (ctx) => {
    // 1. tools/list gives exactly run and search
    const { tools } = await ctx.client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["run", "search"]);

    // 2. search
    const found = textOf(await ctx.call("search", { words: "rows" }));
    assert.ok(found.split("\n").includes(LINE.rows), found);
    assert.equal(textOf(await ctx.call("search", {})), "practice: 4 tools");

    // 3. the rows of Lyon are counted in the program: 5,000 rows, 8 cities, 625 each
    const counted = await ctx.run(
      'const { rows } = await tools.practice.rows({});\nrows.filter((row) => row.city === "Lyon").length',
    );
    assert.notEqual(counted.isError, true);
    assert.equal(textOf(counted), "625");
    assert.ok(textOf(counted).length < 200);

    // 4. every row: cut to exactly 8,000 characters, and the notice says how long the answer was
    const all = await ctx.run("(await tools.practice.rows({})).rows");
    assert.notEqual(all.isError, true);
    const whole = JSON.stringify(practiceRows());
    const notice = `\n[cut: the answer was ${whole.length} characters, the limit is 8000]`;
    const text = textOf(all);
    assert.equal(text.length, 8000);
    assert.equal(text, whole.slice(0, 8000 - notice.length) + notice);

    // 5. a denied tool
    const denied = await ctx.run("await tools.practice.wipe({})");
    assert.equal(denied.isError, true);
    assert.equal(
      textOf(denied),
      'The program failed: Error: onetool: practice.wipe is denied by the rule deny "practice.wipe"',
    );
  });
});
