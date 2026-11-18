// Step 8: tidying the library through the real thing. The command is a process with HOME a folder the test made, the practice server
// is a process behind it, and the client of the package speaks to it. Nothing is replaced. The points are those of the meeting point of server,
// "Step 8: tidying the library", "Tidying, through the real thing", numbered as they are there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BIN, PRACTICE, ROOT, textOf, writeSettings } from "./helpers.js";
import { FILE_NAME, logEntries, logFiles, logText } from "./recordhelpers.js";
import { COUNT, FAILED, names, okLine, programText, saveCall, statsOf, world } from "./libhelpers.js";
import { H_PAIRS, H_PROGRAMS, H_SEQUENCES, H_UNUSED, LOG_OFF, REPORT, emptyReport, sequencesOf } from "./tidyhelpers.js";

const SHARE = "const { rows } = await tools.practice.rows({});\nconst { count } = await tools.practice.count({});\nrows.filter((row) => row.city === city).length / count";
const CITY_COUNT = { about: "Counts the rows of one city.", params: ["city"], code: COUNT };
const CITY_SHARE = { about: "The share of one city.", params: ["city"], code: SHARE };
const OLD = { about: "An old one.", code: '"old"' };

const SETTINGS = (w, onetool = {}) => ({
  mcpServers: { practice: { command: "node", args: [PRACTICE] } },
  onetool: { trail: true, timeoutSeconds: 10, logFolder: w.L, ...onetool },
});

/** The command with HOME `w.H`, and a client of the package with `capabilities`; `fn(host)` runs, the client is closed after. */
async function withClient(settings, w, { capabilities = {}, answer } = {}, fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN, "--config", writeSettings(settings)],
    cwd: ROOT,
    env: { ...getDefaultEnvironment(), HOME: w.H },
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  const client = new Client({ name: "realtidy", version: "0.0.0" }, { capabilities });
  const requests = [];
  if (answer !== undefined) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      requests.push(request.params);
      return answer(request.params);
    });
  }
  await client.connect(transport, { timeout: 10000 });
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
    return { text: textOf(result), isError: result.isError === true };
  };
  const host = { client, requests, stderr: () => stderr, run: (code) => call("run", { code }), call };
  try {
    return await fn(host);
  } finally {
    await client.close().catch(() => {});
  }
}

const linesOf = (answer) => answer.text.split("\n");
const firstLine = (answer) => linesOf(answer)[0];

test("tidying the library through the real thing: the prompt, the report, the read and the restore, the rules and the log off, the project's library", async () => {
  const w = world();
  const { UL, UA, PL } = w;
  const SQ = sequencesOf(w);

  // ---- the user's library -------------------------------------------------------------------------------------------
  await withClient(SETTINGS(w), w, {}, async (host) => {
    // 1. the capabilities have `prompts`; exactly run and search; one prompt, with a description and no `arguments`
    assert.ok(host.client.getServerCapabilities()?.prompts !== undefined, JSON.stringify(host.client.getServerCapabilities()));
    assert.deepEqual((await host.client.listTools()).tools.map((tool) => tool.name), ["run", "search"]);
    const { prompts } = await host.client.listPrompts();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].name, "tidy-library");
    assert.ok(typeof prompts[0].description === "string" && prompts[0].description !== "");
    assert.equal(Object.hasOwn(prompts[0], "arguments"), false);

    // 2. the prompt: one message of the role user, a text under 2,000 characters with the words; an unknown name is refused
    const prompt = await host.client.getPrompt({ name: "tidy-library" });
    assert.equal(prompt.messages.length, 1);
    assert.equal(prompt.messages[0].role, "user");
    assert.equal(prompt.messages[0].content.type, "text");
    const { text } = prompt.messages[0].content;
    assert.ok(text.length < 2000, `${text.length} characters`);
    for (const word of ["library.report()", "library.read(name)", "library.save", "library.remove", "library.restore", "Change nothing before the person says yes."]) {
      assert.ok(text.includes(word), `the text lacks ${word}`);
    }
    await assert.rejects(host.client.getPrompt({ name: "nope" }), (error) => String(error.message).includes("unknown prompt: nope"));

    // 3. an empty library: eleven lines
    const empty = await host.run(REPORT);
    assert.equal(empty.isError, false, empty.text);
    const emptyLines = linesOf(empty);
    assert.equal(emptyLines.length, 11, empty.text);
    assert.deepEqual(emptyLines.slice(0, 9), emptyReport("(none)"));
    assert.equal(emptyLines[9], "--- calls ---");
    assert.match(emptyLines[10], okLine("library.report"));

    // 4. three saves, then the programs of the text: seven lines in the sequences file
    for (const [name, program] of [["cityCount", CITY_COUNT], ["cityShare", CITY_SHARE], ["old", OLD]]) {
      const saved = await host.run(`await ${saveCall(name, program)}`);
      assert.equal(saved.isError, false, saved.text);
      assert.equal(firstLine(saved), `lib.${name} is saved in the user library.`);
    }
    for (let time = 0; time < 2; time++) assert.equal(firstLine(await host.run('await lib.cityCount({ city: "Lyon" })')), "625");
    assert.deepEqual(await host.run("await lib.old()"), { text: "old", isError: false });
    for (let time = 0; time < 3; time++) assert.equal(firstLine(await host.run('(await tools.practice.count({ city: "Paris" })).count')), "625");
    for (let time = 0; time < 2; time++) assert.equal(firstLine(await host.run('await tools.practice.echo({ text: "a" })')), "a");
    const sequenceLines = readFileSync(SQ, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line));
    assert.equal(sequenceLines.length, 7);
    for (const line of sequenceLines) assert.deepEqual(Object.keys(line).sort(), ["sequence", "session", "time"]);
    assert.deepEqual(sequenceLines.map((line) => line.sequence), [
      ["practice.rows"],
      ["practice.rows", "practice.count"],
      ["practice.count"],
      ["practice.count"],
      ["practice.count"],
      ["practice.echo"],
      ["practice.echo"],
    ]);
    const sessions = new Set(logEntries(w.L).map((entry) => entry.session));
    assert.equal(sessions.size, 1);
    assert.ok(sequenceLines.every((line) => sessions.has(line.session)), "the session of the lines of L");

    // 5. `old` last used 40 days ago, written by hand: the report, line by line
    const stats = statsOf(UL);
    const fortyDays = new Date(Date.now() - 40 * 86400000).toISOString();
    stats.old.lastUse = fortyDays;
    writeFileSync(join(UL, "stats.json"), JSON.stringify(stats), "utf8");
    const report = await host.run(REPORT);
    assert.equal(report.isError, false, report.text);
    const reportLines = linesOf(report);
    const at = reportLines.indexOf("--- calls ---");
    assert.equal(at, 11, report.text);
    const wanted = [
      "Library report: 3 programs",
      H_PROGRAMS,
      "lib.cityShare (user): 0 uses, 0 failures, never",
      `lib.old (user): 1 uses, 0 failures, ${fortyDays.slice(0, 10)}`,
      null,
      H_PAIRS,
      "lib.cityCount and lib.cityShare: 1 of 2 tools (practice.rows)",
      H_UNUSED,
      "lib.old",
      H_SEQUENCES,
      "3 times: practice.count",
    ];
    wanted.forEach((line, i) => {
      if (line === null) assert.match(reportLines[i], /^lib\.cityCount \(user\): 2 uses, 0 failures, \d{4}-\d{2}-\d{2}$/);
      else assert.equal(reportLines[i], line, `line ${i + 1}`);
    });
    assert.ok(report.text.length < 6100, `${report.text.length} characters`);

    // 6. a read: the file as onetool writes it, then a name that is not saved
    const read = await host.run('await library.read("cityCount")');
    assert.equal(read.isError, false, read.text);
    assert.ok(read.text.startsWith(programText(CITY_COUNT)), read.text);
    assert.match(linesOf(read).at(-1), okLine("library.read"));
    const nope = await host.run('await library.read("nope")');
    assert.equal(nope.isError, true);
    assert.equal(firstLine(nope), FAILED("library.read failed: no program named nope is saved"));

    // 7. a removal, then a restore: the program is back, with no count
    assert.equal(firstLine(await host.run('await library.remove("old")')), "lib.old went to the archive of the user library.");
    const restored = await host.run('await library.restore("old")');
    assert.equal(restored.isError, false, restored.text);
    const restoredLines = linesOf(restored);
    assert.equal(restoredLines.length, 3, restored.text);
    assert.equal(restoredLines[0], "lib.old is back in the user library.");
    assert.equal(restoredLines[1], "--- calls ---");
    assert.match(restoredLines[2], okLine("library.restore"));
    assert.equal(existsSync(join(UL, "old.js")), true);
    assert.deepEqual(names(UA).filter((name) => name.startsWith("old.")), []);
    assert.deepEqual(await host.run("await lib.old()"), { text: "old", isError: false });
    assert.equal(statsOf(UL).old.uses, 1, "it came back with no count");

    // 8. a replace sends a program to the archive, and it comes back; a second restore finds nothing
    const rowsIn = { about: "The rows of one city, counted.", params: ["city"], code: "(await tools.practice.rows({ city })).rows.length", replace: true };
    assert.equal(firstLine(await host.run(`await ${saveCall("rowsIn", rowsIn)}`)), "lib.rowsIn is saved in the user library; lib.cityCount went to the archive.");
    assert.equal(firstLine(await host.run('await library.restore("cityCount")')), "lib.cityCount is back in the user library.");
    assert.equal(firstLine(await host.run('await lib.cityCount({ city: "Lyon" })')), "625");
    const again = await host.run('await library.restore("cityCount")');
    assert.equal(again.isError, true);
    assert.equal(firstLine(again), FAILED("library.restore failed: no program named cityCount is in the archive"));

    // 9. the log: the files, the arguments, and what no line holds
    assert.ok(logFiles(w.L).length > 0 && logFiles(w.L).every((file) => FILE_NAME.test(file)), logFiles(w.L).join());
    const entries = logEntries(w.L);
    const first = (id) => entries.find((entry) => entry.id === id);
    assert.equal(first("library.report").decision, "allowed");
    assert.deepEqual(first("library.report").args, {});
    assert.deepEqual(first("library.read").args, { name: "cityCount" });
    assert.deepEqual(first("library.restore").args, { name: "old" });
    assert.equal(logText(w.L).includes("rows.filter"), false);
    assert.equal(readFileSync(SQ, "utf8").includes("rows.filter"), false);
    assert.equal(logText(w.L).includes("Library report"), false);
  });

  // ---- the rules, and the log switched off ----------------------------------------------------------------------------
  const sequencesBefore = readFileSync(SQ);
  let reply = { action: "decline" };
  const second = { mcpServers: SETTINGS(w).mcpServers, onetool: { trail: true, timeoutSeconds: 10, log: false, ask: ["library.restore"], deny: ["library.read"] } };
  await withClient(second, w, { capabilities: { elicitation: {} }, answer: () => reply }, async (host) => {
    // 10. four programs, the log is off: nothing is counted and the file is as it was
    const report = await host.run(REPORT);
    assert.equal(report.isError, false, report.text);
    const reportLines = linesOf(report);
    assert.equal(reportLines[0], "Library report: 4 programs");
    assert.equal(reportLines[reportLines.indexOf("--- calls ---") - 1], LOG_OFF);
    assert.equal(firstLine(await host.run('(await tools.practice.count({ city: "Nice" })).count')), "625");
    assert.deepEqual(readFileSync(SQ), sequencesBefore, "byte for byte");

    // 11. a restore asked and declined, then accepted
    assert.equal((await host.run('await library.remove("old")')).isError, false);
    const declined = await host.run('await library.restore("old")');
    assert.equal(declined.isError, true);
    assert.equal(firstLine(declined), FAILED('onetool: library.restore is refused by the rule ask "library.restore": the person said no'));
    assert.equal(existsSync(join(UL, "old.js")), false);
    assert.equal(host.requests.length, 1);
    assert.ok(host.requests[0].message.startsWith("onetool: a program wants to call library.restore."), host.requests[0].message);
    reply = { action: "accept" };
    assert.equal(firstLine(await host.run('await library.restore("old")')), "lib.old is back in the user library.");
    assert.equal(existsSync(join(UL, "old.js")), true);

    // 12. a read that deny refuses
    const denied = await host.run('await library.read("old")');
    assert.equal(denied.isError, true);
    assert.equal(firstLine(denied), FAILED('onetool: library.read is denied by the rule deny "library.read"'));
  });

  // ---- the project's library ----------------------------------------------------------------------------------------
  await withClient(SETTINGS(w, { shell: { folders: [w.W] } }), w, {}, async (host) => {
    // 13. a save, a removal and a restore in the project's library; the report counts five programs
    assert.equal(firstLine(await host.run('await library.save("local", { about: "Says where it is.", code: \'"here"\' })')), "lib.local is saved in the project library.");
    assert.equal(firstLine(await host.run('await library.remove("local")')), "lib.local went to the archive of the project library.");
    assert.equal(firstLine(await host.run('await library.restore("local")')), "lib.local is back in the project library.");
    assert.equal(existsSync(join(PL, "local.js")), true);
    const report = await host.run(REPORT);
    assert.equal(report.isError, false, report.text);
    const reportLines = linesOf(report);
    assert.equal(reportLines[0], "Library report: 5 programs");
    assert.ok(reportLines.includes("lib.local (project): 0 uses, 0 failures, never"), report.text);
  });
});
