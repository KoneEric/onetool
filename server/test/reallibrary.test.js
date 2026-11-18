// Step 7: the library through the real thing. The command is a process with HOME a folder the test made, the practice server
// is a process behind it, and the client of the package speaks to it. Nothing is replaced. The points are those of
// the meeting point of server, "Step 7: the library", "The library, through the real thing", numbered as they are there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BIN, PRACTICE, ROOT, sleep, textOf, waitFor, writeSettings } from "./helpers.js";
import { logEntries, logText } from "./recordhelpers.js";
import {
  ARCHIVED,
  COUNT,
  FAILED,
  SAME_AS,
  SAME_TOOLS,
  SAVE_IT,
  archivedOf,
  fileIn,
  names,
  okLine,
  programText,
  putRaw,
  saveCall,
  statsOf,
  world,
  wordLine,
} from "./libhelpers.js";

const CITY_COUNT = { about: "Counts the rows of one city.", params: ["city"], code: COUNT };
const LYON_SHARE_CODE = '(await lib.cityCount({ city: "Lyon" })) / 5000';

/** The settings file of the text: the practice server, the trail, a time limit of 10 seconds, the log in `L`. */
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
  const client = new Client({ name: "reallibrary", version: "0.0.0" }, { capabilities });
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
  const host = {
    client,
    requests,
    stderr: () => stderr,
    stderrLines: () => stderr.split("\n").filter((line) => line !== ""),
    run: (code) => call("run", { code }),
    call,
    search: async (words) => (await call("search", words === undefined ? {} : { words })).text,
    tools: async () => (await client.listTools()).tools,
    description: async () => (await client.listTools()).tools.find((tool) => tool.name === "run").description,
  };
  try {
    return await fn(host);
  } finally {
    await client.close().catch(() => {});
  }
}

const linesOf = (answer) => answer.text.split("\n");

test("the library through the real thing: the user's library, the cap and the rules, the project's library, the log", async () => {
  const w = world();
  const { UL, PL, UA } = w;

  // ---- the user's library -------------------------------------------------------------------------------------------
  await withClient(SETTINGS(w), w, {}, async (host) => {
    // 1. exactly run and search; the description says `Saved programs: 0` and `library.save(`; the texts are short
    const tools = await host.tools();
    assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
    const description = tools[0].description;
    assert.ok(description.includes("Saved programs: 0") && description.includes("library.save("), description);
    const texts = [
      description,
      ...Object.values(tools[0].inputSchema.properties).map((one) => one.description),
      tools[1].description,
      tools[1].inputSchema.properties.words.description,
    ];
    assert.ok(texts.join("").length < 1500, `the descriptions are ${texts.join("").length} characters`);
    assert.equal(await host.search(), "practice: 5 tools");

    // 2. a save: three lines, and the file of the meeting point of library
    const saved = await host.run(`await ${saveCall("cityCount", CITY_COUNT)}`);
    assert.equal(saved.isError, false, saved.text);
    const savedLines = linesOf(saved);
    assert.equal(savedLines.length, 3, saved.text);
    assert.equal(savedLines[0], "lib.cityCount is saved in the user library.");
    assert.equal(savedLines[1], "--- calls ---");
    assert.match(savedLines[2], /^library\.save \d+ ms \d+ chars$/);
    assert.equal(fileIn(UL, "cityCount.js"), programText(CITY_COUNT));

    // 3. a later program calls it: 625 and the call the saved program made
    const counted = await host.run('await lib.cityCount({ city: "Lyon" })');
    const countedLines = linesOf(counted);
    assert.equal(countedLines.length, 3, counted.text);
    assert.equal(countedLines[0], "625");
    assert.equal(countedLines[1], "--- calls ---");
    assert.match(countedLines[2], okLine("practice.rows"));

    // 4. search counts it, finds it first by a word, and the description names it
    assert.equal(await host.search(), "practice: 5 tools\nlibrary: 1 programs");
    assert.equal((await host.search("city")).split("\n")[0], "lib.cityCount({ city }) - Counts the rows of one city.");
    assert.ok((await host.description()).includes("Saved programs: 1 (most used: cityCount)"));

    // 5. a saved program that calls another
    const lyonShare = { about: "The share of Lyon in the table.", code: LYON_SHARE_CODE };
    const second = await host.run(`await ${saveCall("lyonShare", lyonShare)}`);
    assert.equal(second.isError, false, second.text);
    assert.equal(linesOf(second)[0], "lib.lyonShare is saved in the user library.");
    const share = await host.run("await lib.lyonShare()");
    assert.equal(share.isError, false, share.text);
    assert.equal(linesOf(share)[0], "0.125");
    assert.ok(linesOf(share).some((line) => okLine("practice.rows").test(line)), share.text);

    // 6. a save that calls the same tools in the same order as a saved program is refused, and nothing is written
    const rowsOf = { about: "The rows of one city.", params: ["city"], code: "(await tools.practice.rows({ city })).rows" };
    const refused = await host.run(`await ${saveCall("rowsOf", rowsOf)}`);
    assert.equal(refused.isError, true);
    assert.equal(linesOf(refused)[0], FAILED(SAME_TOOLS("cityCount")));
    // the text of this program holds `tools.practice.rows` in a string, so it also gets the note of the same saved
    // program (see "Silent or unclear" of the note of this file): only the line of the failed call is held here
    assert.ok(linesOf(refused).some((line) => wordLine("library.save", "failed").test(line)), refused.text);
    // the last two lines are the trail line of `library.save`, then the note of the same saved program (steps/7.sh holds the same)
    assert.match(linesOf(refused).at(-2), wordLine("library.save", "failed"));
    assert.equal(linesOf(refused).at(-1), SAME_AS("cityCount"));
    assert.equal(existsSync(join(UL, "rowsOf.js")), false);

    // 7. a program that does by itself what cityCount does ends with the note
    const same = await host.run('(await tools.practice.rows({ city: "Nice" })).rows.length');
    const sameLines = linesOf(same);
    assert.equal(sameLines.length, 4, same.text);
    assert.equal(sameLines[0], "625");
    assert.equal(sameLines[1], "--- calls ---");
    assert.match(sameLines[2], okLine("practice.rows"));
    assert.equal(sameLines[3], SAME_AS("cityCount"));

    // 8. the same unsaved sequence three times: the third says to save it, not the fourth
    const paris = '(await tools.practice.count({ city: "Paris" })).count';
    for (const time of [1, 2, 3, 4]) {
      const answer = await host.run(paris);
      const lines = linesOf(answer);
      assert.equal(lines[0], "625");
      assert.equal(lines[1], "--- calls ---");
      assert.match(lines[2], okLine("practice.count", "13"));
      if (time === 3) assert.deepEqual(lines.slice(3), [SAVE_IT(3)], answer.text);
      else assert.equal(lines.length, 3, `time ${time}: ${answer.text}`);
    }

    // 9. a saved program that fails five times in a row is moved to the archive
    const broken = await host.run('await library.save("broken", { about: "Always fails.", code: \'throw new Error("no")\' })');
    assert.equal(linesOf(broken)[0], "lib.broken is saved in the user library.");
    for (let time = 1; time <= 4; time++) assert.deepEqual(await host.run('await lib.broken().catch(() => "caught")'), { text: "caught", isError: false });
    const fifth = await host.run('await lib.broken().catch(() => "caught")');
    assert.deepEqual(linesOf(fifth), ["caught", "--- calls ---", ARCHIVED("broken")]);
    assert.equal(existsSync(join(UL, "broken.js")), false);
    assert.equal(archivedOf(UA, "broken").length, 1);
    assert.equal(names(UA).filter((name) => name.startsWith("broken.") && name.endsWith(".js")).length, 1);
    assert.deepEqual(await host.run("typeof lib.broken"), { text: "undefined", isError: false });

    // 10. a file edited by hand is followed; a file that is not a program is left out and said once
    putRaw(UL, "lyonShare.js", programText({ about: "Lyon, as a share.", code: LYON_SHARE_CODE }));
    assert.ok((await host.search("lyon")).split("\n").includes("lib.lyonShare() - Lyon, as a share."));
    putRaw(UL, "notes.js", "not a program");
    assert.equal(await host.search(), "practice: 5 tools\nlibrary: 2 programs");
    await host.search();
    const line = `onetool: library: ${join(UL, "notes.js")} is not a saved program, it is left out`;
    await waitFor(() => host.stderrLines().includes(line), 3000, "the line about notes.js");
    await sleep(150);
    assert.equal(host.stderrLines().filter((one) => one === line).length, 1);
    rmSync(join(UL, "notes.js"));

    // 11. stats.json: the uses of cityCount (the call of point 3 and the inner call of point 5) and of lyonShare
    const stats = statsOf(UL);
    assert.equal(stats.cityCount.uses, 2);
    assert.equal(stats.lyonShare.uses, 1);

    // 12. null for the arguments `run` does not need is the same as not given
    assert.deepEqual(await host.call("run", { code: "1 + 1", background: null, job: null, stop: null, jobs: null }), { text: "2", isError: false });
  });

  // ---- the cap and the rules ----------------------------------------------------------------------------------------
  const cityCountFile = fileIn(UL, "cityCount.js");
  let reply = { action: "accept" };
  await withClient(SETTINGS(w, { libraryCap: 2, ask: ["library.save"], deny: ["library.remove"] }), w, { capabilities: { elicitation: {} }, answer: () => reply }, async (host) => {
    // 13. a yes, and the library is full: refused with the three least used (two here), after one question
    reply = { action: "accept" };
    const full = await host.run('await library.save("third", { about: "One.", code: "1" })');
    assert.equal(full.isError, true);
    assert.equal(
      linesOf(full)[0],
      FAILED("library.save failed: the library holds 2 programs, the limit is 2 (onetool.libraryCap). The least used: lyonShare, cityCount. Remove one with library.remove(name), or replace one."),
    );
    assert.equal(host.requests.length, 1);
    assert.ok(host.requests[0].message.startsWith("onetool: a program wants to call library.save."), host.requests[0].message);

    // 14. a no: refused by the rule, the file is what it was
    reply = { action: "decline" };
    const declined = await host.run('await library.save("cityCount", { about: "Changed.", code: "2", replace: true })');
    assert.equal(
      linesOf(declined)[0],
      FAILED('onetool: library.save is refused by the rule ask "library.save": the person said no'),
    );
    assert.equal(fileIn(UL, "cityCount.js"), cityCountFile);

    // 15. a removal that deny refuses
    const denied = await host.run('await library.remove("cityCount")');
    assert.equal(linesOf(denied)[0], FAILED('onetool: library.remove is denied by the rule deny "library.remove"'));
    assert.equal(existsSync(join(UL, "cityCount.js")), true);
  });

  // ---- the project's library ----------------------------------------------------------------------------------------
  await withClient(SETTINGS(w, { shell: { folders: [w.W] } }), w, {}, async (host) => {
    // 16. a save goes to the project's library; the search counts the three programs
    const local = await host.run('await library.save("local", { about: "Says where it is.", code: \'"here"\' })');
    assert.equal(linesOf(local)[0], "lib.local is saved in the project library.");
    assert.equal(existsSync(join(PL, "local.js")), true);
    assert.equal(existsSync(join(UL, "local.js")), false);
    assert.equal(await host.search(), "practice: 5 tools\nshell: 4 tools\nlibrary: 3 programs");

    // 17. the project's own cityCount wins, and is counted once
    putRaw(PL, "cityCount.js", programText({ about: "The project's own count.", params: ["city"], code: '"project"' }));
    assert.deepEqual(await host.run('await lib.cityCount({ city: "Lyon" })'), { text: "project", isError: false });
    assert.ok((await host.search()).endsWith("library: 3 programs"));

    // 18. a removal goes to the archive of the project's library
    const removed = await host.run('await library.remove("local")');
    assert.equal(linesOf(removed)[0], "lib.local went to the archive of the project library.");
    assert.equal(existsSync(join(PL, "local.js")), false);
    assert.equal(archivedOf(w.PA, "local").length, 1);
    assert.equal(names(w.PA).filter((name) => name.startsWith("local.")).length, 1);
  });

  // ---- the log ------------------------------------------------------------------------------------------------------
  // 19. the files of L, read together
  const entries = logEntries(w.L);
  const firstSave = entries.find((entry) => entry.id === "library.save");
  assert.equal(firstSave.decision, "allowed");
  assert.deepEqual(firstSave.args, { name: "cityCount", codeSize: COUNT.length, replace: false });
  assert.ok(entries.some((entry) => entry.id === "library.save" && entry.decision === "asked: no"));
  assert.ok(entries.some((entry) => entry.id === "library.remove" && entry.decision === "denied"));
  assert.equal(logText(w.L).includes("rows.filter"), false);
});
