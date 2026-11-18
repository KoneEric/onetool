// Step 6: jobs through the real thing (the meeting point of server, "Jobs, through the real thing"). The command is a process, the
// practice server is a process behind it, and the client speaks MCP to it on its standard input and output. Nothing is
// replaced. The points are those of the text, numbered as there. Two waits are 3 seconds, not 4: they only have to be
// longer than the 2 seconds of `timeoutSeconds`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { PRACTICE, rawOnetool, tmpDir, writeSettings } from "./helpers.js";
import { logEntries } from "./recordhelpers.js";
import { workFolder } from "./shellhelpers.js";
import { SEVERAL, STOPPED_ON_REQUEST, firstLine, goneWithin, headOf, jobLimit, jobStarted, jobsOf, listLine, noJob, reap, twoPids, viaRaw } from "./jobhelpers.js";

const settingsFor = (W, L, backgroundSeconds) => ({
  mcpServers: { practice: { command: "node", args: [PRACTICE] } },
  onetool: { shell: { folders: [W] }, timeoutSeconds: 2, backgroundSeconds, maxJobs: 2, trail: true, logFolder: L },
});

const ROWS = [
  'progress("fetching");',
  "const rows = (await tools.practice.rows({})).rows;",
  'progress("counting", rows.length);',
  'rows.filter((row) => row.city === "Lyon").length',
].join("\n");

test("jobs through the real thing", async () => {
  const { W } = workFolder();
  const L = tmpDir();
  const raw = rawOnetool(writeSettings(settingsFor(W, L, 30)));
  const all = [];
  try {
    await raw.initialize();
    const jobs = jobsOf(viaRaw(raw));

    // 1. exactly run and search; five properties in order, no `required`; the descriptions together are short
    const { tools } = (await raw.request("tools/list", {})).result;
    assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
    assert.deepEqual(Object.keys(tools[0].inputSchema.properties), ["code", "background", "job", "stop", "jobs"]);
    assert.equal(Object.hasOwn(tools[0].inputSchema, "required"), false);
    const texts = [
      tools[0].description,
      ...Object.values(tools[0].inputSchema.properties).map((one) => one.description),
      tools[1].description,
      tools[1].inputSchema.properties.words.description,
    ];
    assert.ok(texts.join("").length < 1500, `the descriptions are ${texts.join("").length} characters`);

    // 2. a job that counts the rows of Lyon
    assert.deepEqual(await jobs.start(ROWS), { text: jobStarted("j1"), isError: false });
    const first = await jobs.untilEnded("j1");
    assert.equal(first.isError, false);
    const lines = first.text.split("\n");
    assert.equal(lines.length, 8);
    assert.match(lines[0], headOf("j1", "done"));
    assert.deepEqual(lines.slice(1, 7), ["--- progress ---", "fetching", "counting 5000", "--- answer ---", "625", "--- calls ---"]);
    assert.match(lines[7], /^practice\.rows \d+ ms \d+ chars$/);
    assert.ok(first.text.length < 300, `the answer is ${first.text.length} characters`);
    assert.deepEqual(await jobs.ask("j1"), first);

    // 3. a job longer than the limit of the foreground, which keeps `state`
    const late = (value) => `await new Promise((done) => setTimeout(done, 3000)); ${value}"late"`;
    assert.deepEqual(await jobs.start(late("state.kept = 5; ")), { text: jobStarted("j2"), isError: false });
    const running = await jobs.ask("j2");
    assert.match(running.text, /^job j2: running, \d+ s$/);
    const second = await jobs.untilEnded("j2");
    assert.match(firstLine(second.text), headOf("j2", "done"));
    assert.deepEqual(second.text.split("\n").slice(1), ["--- answer ---", "late"]);
    assert.deepEqual(await jobs.send({ code: "state.kept" }), { text: "5", isError: false });
    assert.deepEqual(await jobs.send({ code: late("") }), { text: "The program was stopped after 2 seconds.", isError: true });

    // 4. a job that is stopped while a command runs
    const command = 'progress("sleeping"); await $`sleep 30 & echo $! > pids.txt; echo $$ >> pids.txt; wait`';
    assert.deepEqual(await jobs.start(command), { text: jobStarted("j3"), isError: false });
    const pids = await twoPids(join(W, "pids.txt"));
    all.push(...pids);
    const stopped = await jobs.stop("j3");
    assert.equal(stopped.isError, false);
    const stoppedLines = stopped.text.split("\n");
    assert.equal(stoppedLines.length, 7);
    assert.match(stoppedLines[0], headOf("j3", "stopped"));
    assert.deepEqual(stoppedLines.slice(1, 6), ["--- progress ---", "sleeping", "--- answer ---", STOPPED_ON_REQUEST, "--- calls ---"]);
    assert.match(stoppedLines[6], /^shell\.run \d+ ms unfinished$/);
    await goneWithin(pids, 2000);
    assert.deepEqual(await jobs.stop("j3"), stopped);

    // 5. a job that fails
    assert.deepEqual(await jobs.start('throw new Error("boom")'), { text: jobStarted("j4"), isError: false });
    const failed = await jobs.untilEnded("j4");
    assert.equal(failed.isError, true);
    const failedLines = failed.text.split("\n");
    assert.match(failedLines[0], headOf("j4", "failed"));
    assert.deepEqual(failedLines.slice(1), ["--- answer ---", "The program failed: Error: boom"]);

    // 6. the limit, the list, and a refused start that took no number
    const forever = "await new Promise((done) => setTimeout(done, 20000))";
    assert.equal((await jobs.start(forever)).text, jobStarted("j5"));
    assert.equal((await jobs.start(forever)).text, jobStarted("j6"));
    assert.deepEqual(await jobs.start(forever), { text: jobLimit(2), isError: true });
    const listed = await jobs.list();
    assert.equal(listed.isError, false);
    const listedLines = listed.text.split("\n");
    assert.equal(listedLines.length, 6);
    [["j1", "done"], ["j2", "done"], ["j3", "stopped"], ["j4", "failed"], ["j5", "running"], ["j6", "running"]].forEach(([id, state], at) =>
      assert.match(listedLines[at], listLine(id, state)),
    );
    await jobs.stop("j5");
    const again = 'await $`sleep 30 & echo $! > pids2.txt; echo $$ >> pids2.txt; wait`';
    assert.deepEqual(await jobs.start(again), { text: jobStarted("j7"), isError: false });

    // 7. a job that is not kept, and the arguments that do not go together
    assert.deepEqual(await jobs.ask("j99"), { text: noJob("j99"), isError: true });
    assert.deepEqual(await jobs.send({ code: "1", job: "j1" }), { text: SEVERAL, isError: true });

    // 8. the log holds the line of the call of j1 and the one of the stopped command, with the same session
    const entries = logEntries(L);
    const rows = entries.find((entry) => entry.id === "practice.rows");
    const unfinished = entries.find((entry) => entry.id === "shell.run" && entry.fault === "unfinished");
    assert.ok(rows && unfinished, "both lines are in the files");
    assert.equal(rows.session, unfinished.session);

    // 9. standard input closes while j6 and j7 run: exit code 0 within 5 seconds, no process of pids2.txt within 2 more
    const pids2 = await twoPids(join(W, "pids2.txt"));
    all.push(...pids2);
    raw.child.stdin.end();
    assert.deepEqual(await raw.within(5000), { code: 0, signal: null });
    await goneWithin(pids2, 2000);
  } finally {
    raw.kill();
    await raw.exited;
    reap(all);
  }
});

test("the limit of a job through the real thing", async () => {
  const { W } = workFolder();
  const raw = rawOnetool(writeSettings(settingsFor(W, tmpDir(), 1)));
  try {
    await raw.initialize();
    const jobs = jobsOf(viaRaw(raw));
    // 10. a job that waits longer than backgroundSeconds is stopped, and that is not a fault
    assert.equal((await jobs.start("await new Promise((done) => setTimeout(done, 20000))")).text, jobStarted("j1"));
    const ended = await jobs.untilEnded("j1");
    assert.equal(ended.isError, false);
    const lines = ended.text.split("\n");
    assert.match(lines[0], headOf("j1", "stopped"));
    assert.deepEqual(lines.slice(1), ["--- answer ---", "The program was stopped after 1 seconds."]);
  } finally {
    raw.kill();
    await raw.exited;
  }
});
