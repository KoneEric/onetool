// Step 10: the commands `onetool login` and `onetool logout` (the meeting point of server, "The three commands", "`onetool login`" and
// "`onetool logout`"). The sign-in is made against the practice server that asks for one, nothing replaced; `login` always has
// `--no-browser` but where a test is about the browser, which is then a stand-in first in PATH.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import { delimiter, join } from "node:path";
import { LOGIN_USAGE, LOGOUT_USAGE, SERVER_USAGE, SECRET_MARKS, ADDRESS_LINE, standIns, authPath, command, hasSignIn, open, runCommand, signIn, signOut, signSettings, withLogin, withPractice } from "./signhelpers.js";
import { fakeEntry, practiceEntry, settingsOf, sleep, tmpDir, tmpPath, waitFor, writeSettings } from "./helpers.js";

const FAR_URL = "http://127.0.0.1:9/mcp";
/** A settings file that lists `far` at an address nobody listens at (it is never reached by what these tests do). */
const plain = () => writeSettings(settingsOf({ far: { url: FAR_URL }, practice: practiceEntry() }));

const noMcp = (r) => {
  assert.equal(r.stdout, "");
};

describe("the arguments of login", () => {
  const WRONG = (p) => ({
    "no server": ["login"],
    "no --config": ["login", "far"],
    "--config with no path": ["login", "far", "--config"],
    "--config twice": ["login", "far", "--config", p, "--config", p],
    "an empty server": ["login", "", "--config", p],
    "the path first, then the word `--config` as the server, so another word is left": ["login", "--config", p],
    "another word": ["login", "far", "--config", p, "extra"],
    "another option": ["login", "far", "--config", p, "--verbose"],
    "--no-browser twice": ["login", "far", "--config", p, "--no-browser", "--no-browser"],
    "--wait with no word": ["login", "far", "--config", p, "--wait"],
    "--wait twice": ["login", "far", "--config", p, "--wait", "5", "--wait", "6"],
    "--wait=5 in one word": ["login", "far", "--config", p, "--wait=5"],
    "--config=<path> in one word": ["login", "far", `--config=${p}`],
    "--wait 0": ["login", "far", "--config", p, "--wait", "0"],
    "--wait 3601": ["login", "far", "--config", p, "--wait", "3601"],
    "--wait 1.5": ["login", "far", "--config", p, "--wait", "1.5"],
    "--wait -1": ["login", "far", "--config", p, "--wait", "-1"],
    "--wait +5": ["login", "far", "--config", p, "--wait", "+5"],
    "--wait 1e2": ["login", "far", "--config", p, "--wait", "1e2"],
    "--wait with a letter": ["login", "far", "--config", p, "--wait", "5s"],
    "--wait with a space": ["login", "far", "--config", p, "--wait", " 5"],
    "--wait empty": ["login", "far", "--config", p, "--wait", ""],
  });
  const p = plain();
  for (const [what, args] of Object.entries(WRONG(p))) {
    test(`${what}: the usage line of login on standard error, exit code 2`, async () => {
      const r = await runCommand(args, { home: tmpDir() });
      assert.equal(r.code, 2);
      assert.equal(r.stderr.trim(), LOGIN_USAGE);
      noMcp(r);
    });
  }

  const RIGHT = {
    "the options in the order of the table": (q) => ["login", "nosuch", "--config", q, "--no-browser", "--wait", "5"],
    "--no-browser first": (q) => ["login", "nosuch", "--no-browser", "--config", q],
    "--wait first": (q) => ["login", "nosuch", "--wait", "5", "--config", q],
    "every option, --config last": (q) => ["login", "nosuch", "--wait", "5", "--no-browser", "--config", q],
    "--wait 1": (q) => ["login", "nosuch", "--config", q, "--wait", "1"],
    "--wait 3600": (q) => ["login", "nosuch", "--config", q, "--wait", "3600"],
  };
  for (const [what, args] of Object.entries(RIGHT)) {
    test(`${what}: the arguments are right, so the settings are read and the server is not found`, async () => {
      const r = await runCommand(args(p), { home: tmpDir() });
      assert.equal(r.code, 1);
      assert.equal(r.stderr, "onetool: login: nosuch is not a server of the settings file\n");
      noMcp(r);
    });
  }

  test("the server is the second argument, whatever it holds: a leading `--`, a space, the word login", async () => {
    for (const name of ["--weird", "a b", "login", "logout", "--config"]) {
      const r = await runCommand(["login", name, "--config", p], { home: tmpDir() });
      assert.equal(r.code, 1, name);
      assert.equal(r.stderr, `onetool: login: ${name} is not a server of the settings file\n`);
    }
  });
});

describe("the arguments of logout", () => {
  const p = plain();
  const WRONG = {
    "no server": ["logout"],
    "no --config": ["logout", "far"],
    "--config with no path": ["logout", "far", "--config"],
    "--config twice": ["logout", "far", "--config", p, "--config", p],
    "an empty server": ["logout", "", "--config", p],
    "another word": ["logout", "far", "--config", p, "extra"],
    "another option": ["logout", "far", "--config", p, "--verbose"],
    "--no-browser": ["logout", "far", "--config", p, "--no-browser"],
    "--wait 5": ["logout", "far", "--config", p, "--wait", "5"],
    "--config=<path> in one word": ["logout", "far", `--config=${p}`],
  };
  for (const [what, args] of Object.entries(WRONG)) {
    test(`${what}: the usage line of logout on standard error, exit code 2`, async () => {
      const r = await runCommand(args, { home: tmpDir() });
      assert.equal(r.code, 2);
      assert.equal(r.stderr.trim(), LOGOUT_USAGE);
      noMcp(r);
    });
  }

  test("the server is the second argument, whatever it holds: `--x` has no sign-in", async () => {
    const r = await runCommand(["logout", "--x", "--config", p], { home: tmpDir() });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "onetool: --x had no sign-in\n");
    assert.equal(r.stderr, "");
  });
});

describe("`login` and `logout` are words only as the first argument", () => {
  const p = plain();
  const SERVER = {
    "--config, the path, then login": ["--config", p, "login"],
    "--config, the path, then logout and a server": ["--config", p, "logout", "far"],
    "login in another case": ["Login", "far", "--config", p],
    "logout in another case": ["LOGOUT", "far", "--config", p],
    "an option, then login": ["--no-browser", "login", "far", "--config", p],
  };
  for (const [what, args] of Object.entries(SERVER)) {
    test(`${what}: the usage line of the server command, exit code 2`, async () => {
      const r = await runCommand(args, { home: tmpDir() });
      assert.equal(r.code, 2);
      assert.equal(r.stderr.trim(), SERVER_USAGE);
      noMcp(r);
    });
  }
});

describe("the settings of login and logout", () => {
  const BAD = () => writeSettings({ mcpServers: { far: { url: FAR_URL } }, onetool: { answerLimit: 5, searchLimit: 0, bogus: 1 } });
  const LINES = [
    "onetool: onetool.bogus: unknown key",
    "onetool: onetool.answerLimit: must be a whole number from 100 to 1000000",
    "onetool: onetool.searchLimit: must be a whole number from 1 to 100",
  ];
  for (const word of ["login", "logout"]) {
    test(`${word}: one line per problem, as onetool: <problem>, exit code 2`, async () => {
      const r = await runCommand([word, "far", "--config", BAD()], { home: tmpDir() });
      assert.equal(r.code, 2);
      assert.deepEqual(r.stderr.split("\n").filter(Boolean), LINES);
      noMcp(r);
    });

    test(`${word}: a settings file that is not there`, async () => {
      const missing = tmpPath("missing.json");
      const r = await runCommand([word, "far", "--config", missing], { home: tmpDir() });
      assert.equal(r.code, 2);
      assert.deepEqual(r.stderr.split("\n").filter(Boolean), [`onetool: settings file not found: ${missing}`]);
      noMcp(r);
    });
  }
});

describe("what login refuses", () => {
  const SECRET = "Bearer ZZZheader";
  const settings = () =>
    writeSettings({
      mcpServers: {
        practice: practiceEntry(),
        keyed: { url: FAR_URL, headers: { Authorization: SECRET } },
        lower: { url: FAR_URL, headers: { authorization: SECRET } },
        both: { url: FAR_URL, headers: { AUTHORIZATION: SECRET }, oauth: { clientId: "x" } },
        "b.ad": { command: "x" },
        far: { url: FAR_URL },
      },
    });
  const CASES = [
    ["a name that is no entry", "nosuch", "onetool: login: nosuch is not a server of the settings file"],
    ["an entry of settings.bad", "b.ad", "onetool: login: b.ad is not a server of the settings file"],
    ["an entry that is bad for holding both oauth and an Authorization header", "both", "onetool: login: both is not a server of the settings file"],
    ["an entry started by a command", "practice", "onetool: login: practice is started by a command, there is nothing to sign in to"],
    ["an entry with an Authorization header", "keyed", "onetool: login: keyed has an Authorization header in the settings file"],
    ["an entry with an authorization header in lower case", "lower", "onetool: login: lower has an Authorization header in the settings file"],
  ];
  for (const [what, name, line] of CASES) {
    test(`${what}: one line, exit code 1, and nothing is opened or written`, async () => {
      const home = tmpDir();
      const r = await runCommand(["login", name, "--config", settings(), "--no-browser", "--wait", "5"], { home });
      assert.equal(r.code, 1);
      assert.equal(r.stderr, `${line}\n`);
      assert.equal(r.stdout, "");
      assert.deepEqual(readdirSync(home), [], "nothing is written in the home folder");
    });
  }
});

describe("neither command starts the server", () => {
  test("no listed server is started, no log is written, nothing is left in the home folder, and both end with standard input open", async () => {
    const pidFile = tmpPath("pid");
    const pidFolder = pidFile.slice(0, pidFile.lastIndexOf("/"));
    const logs = join(tmpDir(), "logs");
    const home = tmpDir();
    const path = writeSettings({
      mcpServers: { fake: fakeEntry({ pidFile }), far: { url: FAR_URL } },
      onetool: { logFolder: logs, trail: true },
    });
    for (const args of [["login", "nosuch", "--config", path, "--no-browser"], ["login", "fake", "--config", path], ["logout", "far", "--config", path]]) {
      const r = await runCommand(args, { home });
      assert.ok(r.code === 0 || r.code === 1, `${args[0]} ended by itself: ${r.code}`);
      assert.equal(r.stdout.includes("jsonrpc"), false, "no MCP message");
    }
    assert.deepEqual(readdirSync(pidFolder).filter((name) => name !== "settings.json"), []);
    assert.equal(existsSync(logs), false, "no log is written");
    assert.deepEqual(readdirSync(home), []);
  });
});

describe("login, to its end", () => {
  test("the address line is written while the command still waits, then the result line; standard error is empty; exit code 0; the file is there with mode 600", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await withLogin(path, home, async (c, address) => {
        assert.equal(c.child.exitCode, null, "it still runs when the address is printed");
        assert.equal(c.stdout(), `onetool: to sign in to far, open ${address}\n`, "the address line is all there is so far");
        const url = new URL(address);
        for (const key of ["client_id", "state", "code_challenge"]) assert.ok(url.searchParams.get(key), `the address holds ${key}`);
        assert.equal(hasSignIn(home), false, "nothing is written before the browser comes back");
        await open(address);
        const { code, signal } = await c.within(10000);
        assert.deepEqual([code, signal], [0, null]);
        assert.equal(c.stdout(), `onetool: to sign in to far, open ${address}\nonetool: signed in to far\n`);
        assert.equal(c.stderr(), "");
        for (const mark of SECRET_MARKS) assert.ok(!c.stdout().includes(mark));
      });
      assert.equal(statSync(authPath(home)).mode & 0o777, 0o600);
      assert.equal(JSON.parse(readFileSync(authPath(home), "utf8")).server, "far");
      assert.deepEqual(await practice.seen().then((s) => [s.registrations, s.tokens]), [1, 1]);
    });
  });

  test("a login for a server that already has a sign-in makes a new one in its place", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      const before = readFileSync(authPath(home), "utf8");
      await signIn(path, home);
      const after = readFileSync(authPath(home), "utf8");
      assert.notEqual(after, before);
      assert.equal((await practice.seen()).registrations, 2, "a new client at each login");
      assert.equal((await signOut(path, home)).code, 0);
    });
  });

  test("with a client id in the entry, nothing is registered; the secret of the entry is in no line", async () => {
    await withPractice(["--client", "step10", "--secret", "s3-ZZZsecret"], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice, { far: { oauth: { clientId: "step10", clientSecret: "s3-ZZZsecret", scopes: ["a", "b"] } } });
      const out = await signIn(path, home);
      assert.ok(!`${out.stdout}${out.stderr}`.includes("s3-ZZZsecret"));
      assert.equal((await practice.seen()).registrations, 0);
    });
  });

  test("a server that lets no client register itself, and no oauth: the sign-in could not be started, and no address is printed", async () => {
    await withPractice(["--client", "step10"], async (practice) => {
      const r = await runCommand(["login", "far", "--config", signSettings(practice), "--no-browser", "--wait", "10"], { home: tmpDir() });
      assert.equal(r.code, 1);
      assert.equal(r.stderr, "onetool: login: far: the sign-in could not be started\n");
      assert.equal(r.stdout, "");
    });
  });

  test("an address where nobody listens: the sign-in could not be started", async () => {
    const dead = net.createServer();
    await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const { port } = dead.address();
    await new Promise((resolve) => dead.close(resolve));
    const home = tmpDir();
    const r = await runCommand(["login", "far", "--config", signSettings(`http://127.0.0.1:${port}/mcp`, { withCommand: false }), "--no-browser", "--wait", "10"], { home });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "onetool: login: far: the sign-in could not be started\n");
    assert.equal(r.stdout, "");
    assert.equal(hasSignIn(home), false);
  });

  test("a port that is taken: cannot listen on port <port>", async () => {
    await withPractice(["--client", "step10"], async (practice) => {
      const taken = net.createServer();
      await new Promise((resolve) => taken.listen(0, "127.0.0.1", resolve));
      const { port } = taken.address();
      try {
        const path = signSettings(practice, { far: { oauth: { clientId: "step10", port } } });
        const r = await runCommand(["login", "far", "--config", path, "--no-browser", "--wait", "10"], { home: tmpDir() });
        assert.equal(r.code, 1);
        assert.equal(r.stderr, `onetool: login: far: cannot listen on port ${port}\n`);
        assert.equal(r.stdout, "");
      } finally {
        await new Promise((resolve) => taken.close(resolve));
      }
    });
  });

  test("the browser comes back with an error: the sign-in was refused, and the file is not written", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      await withLogin(signSettings(practice), home, async (c, address) => {
        const url = new URL(address);
        const callback = new URL(url.searchParams.get("redirect_uri"));
        callback.searchParams.set("error", "access_denied");
        callback.searchParams.set("state", url.searchParams.get("state"));
        const response = await fetch(callback, { signal: AbortSignal.timeout(8000) });
        await response.arrayBuffer();
        const { code } = await c.within(10000);
        assert.equal(code, 1);
        assert.equal(c.stderr(), "onetool: login: far: the sign-in was refused\n");
        assert.equal(c.stdout(), `onetool: to sign in to far, open ${address}\n`, "no result line on standard output");
      });
      assert.equal(hasSignIn(home), false);
    });
  });

  test("--wait 1 and nobody opens the address: exit code 1 within 5 seconds, no answer in 1 seconds", async () => {
    await withPractice([], async (practice) => {
      const start = Date.now();
      const r = await runCommand(["login", "far", "--config", signSettings(practice), "--no-browser", "--wait", "1"], { home: tmpDir() });
      assert.ok(Date.now() - start < 5000, `it took ${Date.now() - start} ms`);
      assert.equal(r.code, 1);
      assert.equal(r.stderr, "onetool: login: far: no answer in 1 seconds\n");
      assert.match(r.stdout, /^onetool: to sign in to far, open \S+\n$/, "the address line, and nothing else");
    });
  });
});

describe("the browser", () => {
  const WHICH = { darwin: "open", linux: "xdg-open" }[process.platform];
  const OTHER = WHICH === "open" ? "xdg-open" : "open";

  test("without --no-browser the program of browserCommand is started with the address as its one argument", async () => {
    await withPractice([], async (practice) => {
      const stand = standIns();
      const home = tmpDir();
      const c = command(["login", "far", "--config", signSettings(practice), "--wait", "10"], { home, env: { PATH: `${stand.bin}${delimiter}${process.env.PATH}` } });
      try {
        const [, address] = await c.line(ADDRESS_LINE());
        if (WHICH === undefined) {
          await open(address);
          assert.equal((await c.within(10000)).code, 0);
          assert.equal(existsSync(stand.mark("open")) || existsSync(stand.mark("xdg-open")), false, "no program is known for this system");
          return;
        }
        await waitFor(() => existsSync(stand.mark(WHICH)), 8000, `the mark of ${WHICH}`);
        await waitFor(() => readFileSync(stand.mark(WHICH), "utf8").endsWith("\n"), 5000, "its arguments");
        assert.equal(readFileSync(stand.mark(WHICH), "utf8"), `${address}\n`);
        assert.equal(existsSync(stand.mark(OTHER)), false);
        await open(address);
        assert.equal((await c.within(10000)).code, 0);
      } finally {
        c.kill();
      }
    });
  });

  test("with --no-browser and the stand-ins first in PATH, none of them leaves a mark", async () => {
    await withPractice([], async (practice) => {
      const stand = standIns();
      const home = tmpDir();
      const c = command(["login", "far", "--config", signSettings(practice), "--no-browser", "--wait", "10"], { home, env: { PATH: `${stand.bin}${delimiter}${process.env.PATH}` } });
      try {
        const [, address] = await c.line(ADDRESS_LINE());
        await open(address);
        assert.equal((await c.within(10000)).code, 0);
        await sleep(300);
        assert.equal(existsSync(stand.mark("open")) || existsSync(stand.mark("xdg-open")), false);
      } finally {
        c.kill();
      }
    });
  });

  test("a program that cannot be started is ignored: the printed address is the way", async () => {
    await withPractice([], async (practice) => {
      const nothing = tmpDir();
      const c = command(["login", "far", "--config", signSettings(practice), "--wait", "10"], { home: tmpDir(), env: { PATH: nothing } });
      try {
        const [, address] = await c.line(ADDRESS_LINE());
        await open(address);
        const { code } = await c.within(10000);
        assert.equal(code, 0);
        assert.equal(c.stderr(), "");
        assert.ok(c.stdout().endsWith("onetool: signed in to far\n"));
      } finally {
        c.kill();
      }
    });
  });
});

describe("logout", () => {
  test("a sign-in: signed out of <server>, exit code 0, the file is gone; a second time: had no sign-in, exit code 0", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      assert.equal(hasSignIn(home), true);
      const first = await signOut(path, home);
      assert.deepEqual([first.code, first.stdout, first.stderr], [0, "onetool: signed out of far\n", ""]);
      assert.equal(hasSignIn(home), false);
      const second = await signOut(path, home);
      assert.deepEqual([second.code, second.stdout, second.stderr], [0, "onetool: far had no sign-in\n", ""]);
    });
  });

  test("it contacts no server, and forgets only the server it is told", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      const before = await practice.seen();
      const other = await signOut(path, home, "other");
      assert.equal(other.stdout, "onetool: other had no sign-in\n");
      assert.equal(hasSignIn(home), true, "the sign-in of far is still there");
      assert.equal((await signOut(path, home)).code, 0);
      assert.deepEqual(await practice.seen(), before);
    });
  });

  test("the settings file does not have to list the server (an entry removed first)", async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      await signIn(signSettings(practice), home);
      const without = writeSettings(settingsOf({ practice: practiceEntry() }));
      const r = await signOut(without, home);
      assert.deepEqual([r.code, r.stdout], [0, "onetool: signed out of far\n"]);
      assert.equal(hasSignIn(home), false);
    });
  });

  test("a sign-in that cannot be removed: logout: <server>: the sign-in could not be removed, exit code 1", { skip: typeof process.getuid === "function" && process.getuid() === 0 }, async () => {
    await withPractice([], async (practice) => {
      const home = tmpDir();
      const path = signSettings(practice);
      await signIn(path, home);
      const folder = join(home, ".onetool", "auth");
      chmodSync(folder, 0o500);
      try {
        const r = await signOut(path, home);
        assert.deepEqual([r.code, r.stdout, r.stderr], [1, "", "onetool: logout: far: the sign-in could not be removed\n"]);
      } finally {
        chmodSync(folder, 0o700);
      }
    });
  });

  test("a server that is not asked at all: nothing is written in a home that holds nothing", async () => {
    const home = tmpDir();
    const r = await signOut(plain(), home);
    assert.deepEqual([r.code, r.stdout], [0, "onetool: far had no sign-in\n"]);
    assert.deepEqual(readdirSync(home), []);
  });
});
