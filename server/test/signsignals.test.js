// Step 10: the end and the signals with a sign-in server (the meeting point of server, "Signing in, the end, signals, time limits and
// waits"). The server command ends as "End, and signals" says, in whatever state a sign-in server is; `login` installs no
// handler, so a signal ends it as the system does by default, and the file of a sign-in is then whole or as it was.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { rawOnetool, tmpDir } from "./helpers.js";
import { authPath, hasSignIn, signIn, signSettings, withLogin, withPractice } from "./signhelpers.js";

/** The names in the folder of the sign-ins of `home`, `[]` when it is not there. */
const folderOf = (home) => (existsSync(dirname(authPath(home))) ? readdirSync(dirname(authPath(home))) : []);

describe("the server command with a sign-in server", () => {
  for (const [what, signed] of [["sign in needed", false], ["connected with a sign-in", true]]) {
    for (const signal of ["SIGTERM", "SIGINT"]) {
      test(`${signal} while the server is ${what}: exit code 0 within 5 seconds`, async () => {
        await withPractice([], async (practice) => {
          const home = tmpDir();
          const path = signSettings(practice);
          if (signed) await signIn(path, home);
          const raw = rawOnetool(path, { env: { HOME: home } });
          try {
            await raw.initialize();
            const answer = await raw.callTool("search", {});
            assert.ok(answer.result.content[0].text.includes(signed ? "far: 5 tools" : "far: sign in needed"));
            const ended = await raw.endBy(signal, 5000);
            assert.deepEqual([ended.code, ended.signal], [0, null]);
          } finally {
            raw.kill();
          }
        });
      });
    }

    test(`standard input closed while the server is ${what}: exit code 0 within 5 seconds, no timer keeps it alive`, async () => {
      await withPractice([], async (practice) => {
        const home = tmpDir();
        const path = signSettings(practice);
        if (signed) await signIn(path, home);
        const raw = rawOnetool(path, { env: { HOME: home } });
        try {
          await raw.initialize();
          await raw.callTool("search", {});
          raw.child.stdin.end();
          const ended = await raw.within(5000);
          assert.deepEqual([ended.code, ended.signal], [0, null]);
        } finally {
          raw.kill();
        }
      });
    });
  }

  test("SIGTERM at once, before the connections are made, with a sign-in server: exit code 0 within 5 seconds", async () => {
    await withPractice([], async (practice) => {
      const raw = rawOnetool(signSettings(practice), { env: { HOME: tmpDir() } });
      try {
        await raw.initialize();
        const ended = await raw.endBy("SIGTERM", 5000);
        assert.deepEqual([ended.code, ended.signal], [0, null]);
      } finally {
        raw.kill();
      }
    });
  });
});

describe("login and a signal: no handler, and no half-written file", () => {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`${signal} to a login that waits: it ends by the signal, and no file is left`, async () => {
      await withPractice([], async (practice) => {
        const home = tmpDir();
        await withLogin(signSettings(practice), home, async (c) => {
          c.child.kill(signal);
          const ended = await c.within(5000);
          assert.deepEqual([ended.code, ended.signal], [null, signal]);
        });
        assert.deepEqual(folderOf(home), []);
      });
    });

    test(`${signal} to a login that waits, with a sign-in in the file: the file is as it was`, async () => {
      await withPractice([], async (practice) => {
        const home = tmpDir();
        const path = signSettings(practice);
        await signIn(path, home);
        const before = readFileSync(authPath(home));
        await withLogin(path, home, async (c) => {
          c.child.kill(signal);
          const ended = await c.within(5000);
          assert.deepEqual([ended.code, ended.signal], [null, signal]);
        });
        assert.equal(hasSignIn(home), true);
        assert.deepEqual(folderOf(home), ["far.json"]);
        assert.ok(readFileSync(authPath(home)).equals(before));
      });
    });
  }
});
