// Step 10: signing in, through the real thing (the meeting point of server, "Signing in, through the real thing"). Nothing is replaced: the
// practice server as a process that asks for a sign-in, the real command, the commands `login` and `logout`, the client of the
// package on the standard input and output of onetool, which counts the notifications `tools/list_changed`. HOME is a
// folder of the test for every process. The access token is good for 1 second (the text says 2) and the waits are 1.5
// seconds (the text says 3): the same points, shorter periods.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { practiceEntry, settingsOf, sleep, tmpDir, writeSettings, withoutSession } from "./helpers.js";
import { assertTrail, logText, splitTrail } from "./recordhelpers.js";
import { LOGIN_USAGE, NEEDED_LINE, SECRET_MARKS, authPath, failedLine, runCommand, signIn, signOut, withPractice, withSignin } from "./signhelpers.js";

const BOTH = "practice: 5 tools\nfar: 5 tools";
const COUNT = '(await tools.far.count({ city: "Lyon" })).count';

test("signing in through the real thing: ten points", async () => {
  await withPractice(["--expires", "1"], async (practice) => {
    const H = tmpDir();
    const L = join(tmpDir(), "logs");
    const S = writeSettings(
      settingsOf({ practice: practiceEntry(), far: { url: practice.url } }, { trail: true, connectSeconds: 5, timeoutSeconds: 10, logFolder: L }),
    );
    const texts = []; // what a person or an assistant could read, looked through at the end
    const secretsSeen = new Set();
    const keepTokens = () => {
      for (const m of readFileSync(authPath(H), "utf8").matchAll(/practice-(?:at|rt)-[A-Za-z0-9_-]{32}/g)) secretsSeen.add(m[0]);
    };
    const first = (answer) => answer.lines[0];

    await withSignin(S, H, async (one) => {
      // 1. two tools, listChanged, sign in needed, its line, nothing registered
      const { tools } = await one.client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["run", "search"]);
      assert.equal(one.client.getServerCapabilities().tools.listChanged, true);
      assert.equal(withoutSession(await one.search()), "practice: 5 tools\nfar: sign in needed");
      assert.ok(one.stderrLines().includes(NEEDED_LINE), one.stderr());
      assert.equal((await practice.seen()).registrations, 0);

      // 2. a call of a tool of the server
      const failed = await one.run('await tools.far.count({ city: "Lyon" })');
      assert.equal(failed.isError, true);
      assert.equal(first(failed), failedLine(S));
      assertTrail(splitTrail(failed.text).lines, [["far.count", "failed"]]);

      // 3. login, with the address printed while it waits, opened by the test
      const signed = await signIn(S, H);
      texts.push(signed.stderr);
      assert.match(signed.stdout, /^onetool: to sign in to far, open \S+\nonetool: signed in to far\n$/);
      assert.equal(statSync(authPath(H)).mode & 0o777, 0o600);
      assert.equal(JSON.parse(readFileSync(authPath(H), "utf8")).server, "far");
      keepTokens();

      // 4. the same onetool, not restarted
      assert.equal(withoutSession(await one.search()), BOTH);
      assert.equal(one.changed(), 1);
      assert.equal(first(await one.run(COUNT)), "625");

      // 5. the access token has run out: the same call answers, the token was refreshed
      const beforeRefresh = readFileSync(authPath(H), "utf8");
      await sleep(1500);
      assert.equal(first(await one.run(COUNT)), "625");
      assert.ok((await practice.seen()).refreshes >= 1);
      assert.notEqual(readFileSync(authPath(H), "utf8"), beforeRefresh, "the new tokens are in the file");
      assert.equal(statSync(authPath(H)).mode & 0o777, 0o600);
      keepTokens();

      // 6. a second onetool with the same settings and home
      await withSignin(S, H, async (two) => {
        assert.equal(await two.search(), BOTH);
        texts.push(two.stderr(), ...two.answers);
      });

      // 7. logout, followed by the first onetool; a second logout
      keepTokens();
      const out = await signOut(S, H);
      texts.push(out.stdout, out.stderr);
      assert.deepEqual([out.code, out.stdout, out.stderr], [0, "onetool: signed out of far\n", ""]);
      assert.equal(existsSync(authPath(H)), false);
      assert.equal(withoutSession(await one.search()), "practice: 5 tools\nfar: sign in needed");
      assert.equal(one.changed(), 2);
      const again = await signOut(S, H);
      texts.push(again.stdout, again.stderr);
      assert.deepEqual([again.code, again.stdout], [0, "onetool: far had no sign-in\n"]);

      // 8. a new login; the server forgets it; the call fails; search follows; it is not tried again
      const signedAgain = await signIn(S, H);
      texts.push(signedAgain.stderr);
      keepTokens();
      assert.equal(withoutSession(await one.search()), BOTH);
      await practice.forget();
      const forgotten = await one.run(COUNT);
      assert.equal(forgotten.isError, true);
      assert.equal(first(forgotten), failedLine(S));
      assert.equal(withoutSession(await one.search()), "practice: 5 tools\nfar: sign in needed");
      const settled = (await practice.seen()).refused;
      await sleep(1500);
      const later = await one.run(COUNT);
      assert.equal(first(later), failedLine(S));
      assert.equal((await practice.seen()).refused, settled, "it is not tried again");

      // 10. refusals of login
      for (const name of ["nosuch", "practice"]) {
        const r = await runCommand(["login", name, "--config", S, "--no-browser", "--wait", "5"], { home: H });
        texts.push(r.stdout, r.stderr);
        assert.equal(r.code, 1);
        assert.equal(
          r.stderr,
          name === "nosuch"
            ? "onetool: login: nosuch is not a server of the settings file\n"
            : "onetool: login: practice is started by a command, there is nothing to sign in to\n",
        );
      }
      const usage = await runCommand(["login", "far"], { home: H });
      assert.deepEqual([usage.code, usage.stderr.trim()], [2, LOGIN_USAGE]);

      texts.push(one.stderr(), ...one.answers);
    });

    // 9. nothing of a sign-in where it does not belong
    const log = existsSync(L) ? logText(L) : "";
    assert.ok(log.split("\n").filter((line) => line.includes('"far.count"')).length >= 4, "the log holds the lines of the calls");
    const everything = [...texts, log].join("\n");
    for (const mark of SECRET_MARKS) assert.ok(!everything.includes(mark), `a text holds ${mark}`);
    assert.ok(secretsSeen.size >= 2, "the tokens were read from the file");
    for (const secret of secretsSeen) assert.ok(!everything.includes(secret), "a text holds a token of the file");
    assert.ok(!everything.includes(practice.host), "a text holds the host and the port of the server");
  });
});
