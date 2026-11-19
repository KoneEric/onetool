// Step 11, `oauth.redirectHost` (the meeting point of server, "`oauth.redirectHost`", and point 10 of "Step 11, through the real thing"): `login` hands the
// `oauth` of the entry on as `readSettings` returned it, the address it prints carries the callback address of part `auth`, and an entry whose
// `redirectHost` is not valid is a bad entry. The practice server asks for a sign-in; HOME is a folder of the test; no browser is started; no
// request goes to the name `localhost` itself: the test comes back to 127.0.0.1.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { practiceEntry, settingsOf, waitFor, withOnetool, writeSettings, tmpDir } from "./helpers.js";
import { ADDRESS_LINE, NEEDED_LINE, authPath, command, runCommand, withPractice } from "./signhelpers.js";

const settingsFor = (practice, oauth) => writeSettings(settingsOf({ far: { url: practice.url, oauth } }, { connectSeconds: 5, timeoutSeconds: 10 }));

/**
 * `login far --config S --no-browser --wait 10`, started: the address line is read, the address is requested without following
 * the redirect, and the `Location` is requested at 127.0.0.1. Gives `{ address, redirectUri, location, code, stdout, stderr }`.
 */
async function loginComingBack(S, home) {
  const c = command(["login", "far", "--config", S, "--no-browser", "--wait", "10"], { home });
  try {
    const [, address] = await c.line(ADDRESS_LINE("far"));
    const redirectUri = new URL(address).searchParams.get("redirect_uri");
    const response = await fetch(address, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    await response.arrayBuffer();
    const location = response.headers.get("location");
    assert.ok(location, `a Location header (status ${response.status})`);
    const back = new URL(location);
    const port = /^http:\/\/[^/:]+:(\d+)\/callback$/.exec(redirectUri)?.[1];
    const reached = await fetch(`http://127.0.0.1:${port}${back.pathname}${back.search}`, { signal: AbortSignal.timeout(8000) });
    await reached.arrayBuffer();
    const { code } = await c.within(10000);
    return { address, redirectUri, location, port, code, stdout: c.stdout(), stderr: c.stderr() };
  } finally {
    c.kill();
  }
}

describe("login with redirectHost", () => {
  test("localhost: the redirect_uri is http://localhost:<port>/callback, the browser comes back, the sign-in is made", async () => {
    await withPractice(["--client", "step11"], async (practice) => {
      const home = tmpDir();
      const S = settingsFor(practice, { clientId: "step11", redirectHost: "localhost" });
      const r = await loginComingBack(S, home);
      assert.match(r.redirectUri, /^http:\/\/localhost:\d+\/callback$/);
      assert.ok(r.location.startsWith(`http://localhost:${r.port}/callback?`), r.location);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `onetool: to sign in to far, open ${r.address}\nonetool: signed in to far\n`);
      assert.equal(existsSync(authPath(home)), true);
    });
  });

  test("127.0.0.1, and no redirectHost: the redirect_uri is http://127.0.0.1:<port>/callback", async () => {
    await withPractice(["--client", "step11"], async (practice) => {
      for (const oauth of [{ clientId: "step11", redirectHost: "127.0.0.1" }, { clientId: "step11" }]) {
        const r = await loginComingBack(settingsFor(practice, oauth), tmpDir());
        assert.match(r.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/, JSON.stringify(oauth));
        assert.equal(r.code, 0, r.stderr);
        assert.ok(r.stdout.endsWith("onetool: signed in to far\n"));
      }
    });
  });

  test("a redirectHost that is not valid: the entry is bad, login says far is not a server of the settings file, exit code 1", async () => {
    await withPractice(["--client", "step11"], async (practice) => {
      for (const redirectHost of ["example.com", "LOCALHOST", "", " localhost", "::1", "127.0.0.1:80", 5, null]) {
        const home = tmpDir();
        const S = settingsFor(practice, { clientId: "step11", redirectHost });
        const r = await runCommand(["login", "far", "--config", S, "--no-browser", "--wait", "10"], { home });
        assert.equal(r.code, 1, JSON.stringify(redirectHost));
        assert.equal(r.stderr, "onetool: login: far is not a server of the settings file\n");
        assert.equal(r.stdout, "");
        assert.equal(existsSync(authPath(home)), false);
      }
    });
  });
});

describe("the server command with redirectHost", () => {
  const BAD_LINE = "onetool: server far: not connected (bad entry: oauth.redirectHost is not 127.0.0.1 or localhost)";

  test("a redirectHost that is not valid: the line of a bad entry on standard error, and onetool goes on", async () => {
    for (const redirectHost of ["example.com", "LOCALHOST", 5]) {
      const settings = settingsOf(
        { practice: practiceEntry(), far: { url: "http://127.0.0.1:9/mcp", oauth: { clientId: "x", redirectHost } } },
        { connectSeconds: 5, timeoutSeconds: 10 },
      );
      await withOnetool(settings, async (ctx) => {
        await waitFor(() => ctx.stderrLines().includes(BAD_LINE), 8000, "the line of the bad entry");
        assert.equal(ctx.stderrLines().filter((line) => line === BAD_LINE).length, 1);
        assert.ok(!ctx.stderr().includes("example.com"), "no value in the line");
        const text = (await ctx.call("search", {})).content[0].text;
        assert.ok(text.startsWith("practice: 5 tools"), text);
      });
    }
  });

  test("a valid redirectHost: the entry is a sign-in server like any other: sign in needed, with nothing sent to it", async () => {
    await withPractice(["--client", "step11"], async (practice) => {
      const S = settingsFor(practice, { clientId: "step11", redirectHost: "localhost" });
      await withOnetool(S, async (ctx) => {
        await waitFor(() => ctx.stderrLines().includes(NEEDED_LINE), 8000, "sign in needed");
        assert.equal((await ctx.call("search", {})).content[0].text, "far: sign in needed");
      });
      assert.equal((await practice.seen()).registrations, 0);
    });
  });
});
