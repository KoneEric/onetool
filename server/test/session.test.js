// Step 12: the numbers of the session and the line of `search`
// (the meeting point of server, "Step 12: leading the session to group its work", "The numbers of the session" and "`search`, and the line of the session").
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fakeEntry, practiceEntry } from "./helpers.js";
import { jobLimit, jobsOf, NEEDS_CODE, HANG, STOPPED_ON_REQUEST } from "./jobhelpers.js";
import { names, putProgram, projectSettings, world } from "./libhelpers.js";
import { ECHO, LYON, PARIS, ROWS, SESSION, THREE, WIPE, isSession, linesOf, settingsFor, withSession } from "./grouphelpers.js";

const SERVERS = () => ({ practice: practiceEntry(), fake: fakeEntry() });
const lastLine = (text) => linesOf(text).at(-1);

describe("search with no words", () => {
  test("before any program: exactly what it was; after three programs of one call each: the catalog, then the line of the session", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      assert.equal(await it.search(), "practice: 5 tools");
      for (const code of [LYON, ECHO("a"), WIPE]) await it.run(code);
      assert.equal(await it.search(), "practice: 5 tools\nthis session: 3 programs, 3 calls, 1.0 calls per program");
      assert.equal(SESSION(3, 3), "this session: 3 programs, 3 calls, 1.0 calls per program");
    });
  });

  test("after one more program of three calls: 4 programs, 6 calls, 1.5 calls per program", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      for (const code of [LYON, ECHO("a"), WIPE, THREE]) await it.run(code);
      assert.equal(lastLine(await it.search()), "this session: 4 programs, 6 calls, 1.5 calls per program");
    });
  });

  test("with words it never has the line, and words of white space only are no words", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      await it.run(LYON);
      assert.equal((await it.search("rows")).includes("this session"), false);
      assert.equal((await it.search("zzzz")).includes("this session"), false);
      assert.equal(lastLine(await it.search("   ")), "this session: 1 programs, 1 calls, 1.0 calls per program");
      assert.equal(lastLine(await it.search("")), "this session: 1 programs, 1 calls, 1.0 calls per program");
    });
  });

  test("the line is the last, after the line of the shell and the line of the library", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "Counts the rows of one city.", params: ["city"], code: "1" });
    await withSession(projectSettings(w), { env: { HOME: w.H } }, async (it) => {
      assert.equal(await it.search(), "practice: 5 tools\nshell: 4 tools\nlibrary: 1 programs");
      await it.run("1 + 1");
      assert.equal(await it.search(), "practice: 5 tools\nshell: 4 tools\nlibrary: 1 programs\nthis session: 1 programs, 0 calls, 0.0 calls per program");
    });
  });

  test("a program with no call is a program: 1 programs, 0 calls", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      assert.equal((await it.run("1 + 1")).text, "2");
      assert.equal(await it.search(), "practice: 5 tools\nthis session: 1 programs, 0 calls, 0.0 calls per program");
    });
  });

  test('"instructions": false and "trail": false leave the line as it is', async () => {
    for (const onetool of [{ instructions: false }, { trail: false }]) {
      await withSession(settingsFor(onetool), {}, async (it) => {
        for (const code of [LYON, THREE]) await it.run(code);
        assert.equal(lastLine(await it.search()), "this session: 2 programs, 4 calls, 2.0 calls per program");
      });
    }
  });
});

describe("what a program counts", () => {
  test("a call of run refused for its arguments, asking for a job, listing the jobs and stopping a job start no program", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      await it.run(LYON);
      const before = "this session: 1 programs, 1 calls, 1.0 calls per program";
      assert.equal((await it.call({})).text, NEEDS_CODE);
      assert.equal((await it.call({ code: 5 })).isError, true);
      assert.equal((await it.call({ jobs: true })).text, "No job in this session.");
      assert.equal((await it.call({ job: "j7" })).isError, true);
      assert.equal((await it.call({ job: "j7", stop: true })).isError, true);
      assert.equal((await it.call({ code: "1", job: "j1" })).isError, true);
      assert.equal(lastLine(await it.search()), before);
    });
  });

  test("a program that failed, one stopped at its limit and one whose call was refused are in the numbers, with their calls", async () => {
    await withSession(settingsFor({ timeoutSeconds: 1, deny: ["practice.wipe"] }, SERVERS()), {}, async (it) => {
      assert.equal((await it.run("await tools.practice.fail({})")).isError, true);
      assert.equal(lastLine(await it.search()), "this session: 1 programs, 1 calls, 1.0 calls per program");
      // a call that has not ended when the program is stopped is a record, unfinished
      assert.equal((await it.run("await tools.fake.barrier({})")).isError, true);
      assert.equal(lastLine(await it.search()), "this session: 2 programs, 2 calls, 1.0 calls per program");
      assert.equal((await it.run("await tools.practice.wipe({})")).isError, true);
      assert.equal(lastLine(await it.search()), "this session: 3 programs, 3 calls, 1.0 calls per program");
      assert.equal((await it.run("await new Promise(() => {})")).isError, true);
      assert.equal(lastLine(await it.search()), "this session: 4 programs, 3 calls, 0.8 calls per program");
    });
  });

  test("every call counts, whatever the server: a listed one, the shell, the library, and the calls a saved program made", async () => {
    const w = world();
    putProgram(w.UL, "cityCount", { about: "Counts the rows of one city.", params: ["city"], code: "(await tools.practice.rows({ city })).rows.length" });
    await withSession(projectSettings(w), { env: { HOME: w.H } }, async (it) => {
      const answer = await it.run('await write("a.txt", "x"); await library.report(); await tools.practice.count({}); 1');
      assert.equal(linesOf(answer.text).length, 5, answer.text); // the value, the header, three calls
      assert.equal(lastLine(await it.search()), "this session: 1 programs, 3 calls, 3.0 calls per program");
      assert.equal((await it.run('await lib.cityCount({ city: "Lyon" })')).lines[0], "625");
      assert.equal(lastLine(await it.search()), "this session: 2 programs, 4 calls, 2.0 calls per program");
    });
  });

  test("programs at the same time: the numbers are right once all have answered", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      await Promise.all([it.run(LYON), it.run(THREE), it.run(ROWS), it.run("1 + 1")]);
      assert.equal(lastLine(await it.search()), "this session: 4 programs, 5 calls, 1.3 calls per program");
    });
  });
});

describe("jobs in the numbers", () => {
  test("a job is counted when it has ended, not while it runs; a job refused for the limit starts no program", async () => {
    await withSession(settingsFor({ maxJobs: 1, backgroundSeconds: 30 }), {}, async (it) => {
      const jobs = jobsOf(it.call);
      await it.run(LYON);
      await jobs.start(HANG);
      const refused = await jobs.start("1");
      assert.equal(refused.isError, true);
      assert.equal(refused.text, jobLimit(1));
      assert.equal(lastLine(await it.search()), "this session: 1 programs, 1 calls, 1.0 calls per program", "the job runs: not counted");
      const stopped = await jobs.stop("j1");
      assert.equal(stopped.text.includes(STOPPED_ON_REQUEST), true, stopped.text);
      assert.equal(lastLine(await it.search()), "this session: 2 programs, 1 calls, 0.5 calls per program", "a job stopped on request is counted");
    });
  });

  test("a job that ends by itself is in the numbers with its calls", async () => {
    await withSession(settingsFor({ backgroundSeconds: 30 }), {}, async (it) => {
      const jobs = jobsOf(it.call);
      await it.run(LYON);
      await jobs.start(THREE);
      await jobs.untilEnded("j1", 10000);
      assert.equal(lastLine(await it.search()), "this session: 2 programs, 4 calls, 2.0 calls per program");
    });
  });

  test("with the numbers of a job only: the line is there once its result is there", async () => {
    await withSession(settingsFor({ backgroundSeconds: 30 }), {}, async (it) => {
      const jobs = jobsOf(it.call);
      await jobs.start("1");
      await jobs.untilEnded("j1", 10000);
      assert.equal(await it.search(), "practice: 5 tools\nthis session: 1 programs, 0 calls, 0.0 calls per program");
    });
  });
});

describe("nothing of this goes anywhere else", () => {
  test("no file and no folder in the home, nothing on standard error, no line of the log holds a text of this step", async () => {
    const w = world();
    await withSession(settingsFor({ logFolder: w.L, log: true }), { env: { HOME: w.H } }, async (it) => {
      for (const code of [LYON, ECHO("a"), WIPE, THREE]) await it.run(code);
      await it.search();
      assert.equal(it.host.stderr().includes("session"), false, it.host.stderr());
      assert.equal(it.host.stderr().includes("one program"), false, it.host.stderr());
    });
    for (const name of existsSync(w.L) ? readdirSync(w.L) : []) {
      const text = readFileSync(join(w.L, name), "utf8");
      assert.equal(text.includes("this session"), false);
      assert.equal(text.includes("could have been one program"), false);
      assert.equal(text.includes("calls per program"), false);
    }
  });

  test("with the log off and nothing saved: the home holds nothing", async () => {
    const w = world();
    await withSession(settingsFor(), { env: { HOME: w.H } }, async (it) => {
      for (const code of [LYON, ECHO("a"), WIPE]) await it.run(code);
      await it.search();
    });
    assert.deepEqual(names(w.H), []);
  });
});

describe("the end", () => {
  const ran = async (it) => {
    for (const code of [LYON, ECHO("a"), WIPE]) await it.run(code);
    assert.equal(isSession(lastLine(await it.search())), true);
  };

  for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`${signal} after programs ran: exit code 0 within 5 seconds`, async () => {
      await withSession(settingsFor(), {}, async (it) => {
        await ran(it);
        const ended = await it.host.endBy(signal, 5000);
        assert.deepEqual([ended.code, ended.signal], [0, null]);
      });
    });
  }

  test("standard input closed after programs ran: exit code 0 within 5 seconds", async () => {
    await withSession(settingsFor(), {}, async (it) => {
      await ran(it);
      it.host.child.stdin.end();
      const ended = await it.host.within(5000);
      assert.deepEqual([ended.code, ended.signal], [0, null]);
    });
  });
});
