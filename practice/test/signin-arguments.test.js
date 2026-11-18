import { test, describe } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { runToEnd, startAddress, endWith, USAGE } from "./address-helpers.js";
import { call, mcp, wait, form, token, register, signInByHand, withSignin, authorize, pkce } from "./signin-helpers.js";

describe("Step 10: arguments", () => {
  test("the usage line is the new one, exact", () => {
    assert.equal(
      USAGE,
      "usage: node practice/src/server.js [--port <number> [--token <text>] [--signin [--expires <seconds>] [--client <id> [--secret <text>]]]]",
    );
  });

  test("every form the table sends to the usage line gets the usage line on standard error, exit code 2", async () => {
    const bad = [
      // --signin with --token, in either order
      ["--port", "0", "--signin", "--token", "t"],
      ["--port", "0", "--token", "t", "--signin"],
      ["--token", "t", "--signin", "--port", "0"],
      // --signin, --expires, --client or --secret with no --port
      ["--signin"],
      ["--signin", "--expires", "5"],
      ["--signin", "--client", "x"],
      ["--signin", "--client", "x", "--secret", "s"],
      ["--expires", "5"],
      ["--client", "x"],
      ["--secret", "s"],
      // --expires or --client with no --signin
      ["--port", "0", "--expires", "5"],
      ["--port", "0", "--client", "x"],
      ["--port", "0", "--client", "x", "--secret", "s"],
      ["--port", "0", "--token", "t", "--expires", "5"],
      // --secret with no --client
      ["--port", "0", "--signin", "--secret", "s"],
      ["--port", "0", "--signin", "--expires", "5", "--secret", "s"],
      // --signin twice
      ["--port", "0", "--signin", "--signin"],
      ["--signin", "--port", "0", "--signin"],
      // the old rows still go there
      ["--port", "0", "--port", "1", "--signin"],
      ["--port", "--signin"],
      ["--port", "0", "--signin", "extra"],
      ["--port", "0", "--signin", "--bogus", "x"],
      ["--port=0", "--signin"],
      ["--port", "0", "--signin", "--expires=5"],
      ["--port", "0", "--signin", "--client=x"],
      ["--port", "0", "--signin", "--client", "x", "--secret=s"],
      // an option with no word after it
      ["--port", "0", "--signin", "--expires"],
      ["--port", "0", "--signin", "--client"],
      ["--port", "0", "--signin", "--client", "x", "--secret"],
      // the word after --client is the id, whatever it holds: here it is `--secret`, and `s` is another word
      ["--port", "0", "--signin", "--client", "--secret", "s"],
      // --expires: digits only, from 1 to 86400
      ["--port", "0", "--signin", "--expires", ""],
      ["--port", "0", "--signin", "--expires", "0"],
      ["--port", "0", "--signin", "--expires", "86401"],
      ["--port", "0", "--signin", "--expires", "100000"],
      ["--port", "0", "--signin", "--expires", "abc"],
      ["--port", "0", "--signin", "--expires", "-1"],
      ["--port", "0", "--signin", "--expires", "+5"],
      ["--port", "0", "--signin", "--expires", "1.5"],
      ["--port", "0", "--signin", "--expires", "1e3"],
      ["--port", "0", "--signin", "--expires", " 5"],
      ["--port", "0", "--signin", "--expires", "5 "],
      ["--port", "0", "--signin", "--expires", "０５"],
      // --client and --secret are not empty
      ["--port", "0", "--signin", "--client", ""],
      ["--port", "0", "--signin", "--client", "x", "--secret", ""],
      // the old values still count
      ["--port", "65536", "--signin"],
      ["--port", "abc", "--signin"],
    ];
    const failures = [];
    await Promise.all(
      bad.map(async (args) => {
        try {
          const r = await runToEnd(args);
          assert.equal(r.signal, null);
          assert.equal(r.code, 2);
          assert.equal(r.stderr.trimEnd(), USAGE);
          assert.equal(r.stderr.trimEnd().includes("\n"), false);
          assert.equal(r.stdout, "");
        } catch (e) {
          failures.push(`${JSON.stringify(args)}: ${e.message.split("\n")[0]}`);
        }
      }),
    );
    assert.deepEqual(failures, []);
  });

  test("the options may stand in any order, and each valid form listens", async () => {
    const good = [
      ["--port", "0", "--signin"],
      ["--signin", "--port", "0"],
      ["--port", "0", "--signin", "--expires", "1"],
      ["--port", "0", "--signin", "--expires", "86400"],
      ["--expires", "30", "--signin", "--port", "0"],
      ["--port", "0", "--signin", "--client", "fixed"],
      ["--client", "fixed", "--port", "0", "--signin"],
      ["--port", "0", "--signin", "--client", "fixed", "--secret", "s3"],
      ["--secret", "s3", "--client", "fixed", "--signin", "--port", "0"],
      ["--port", "0", "--signin", "--expires", "9", "--client", "fixed", "--secret", "s3"],
      ["--client", "fixed", "--expires", "9", "--secret", "s3", "--port", "0", "--signin"],
    ];
    for (const args of good) {
      const srv = await startAddress(args);
      try {
        assert.match(srv.line, /^practice: listening on http:\/\/127\.0\.0\.1:[1-9][0-9]*\/mcp\n$/, JSON.stringify(args));
        const r = await call(srv, { path: "/.well-known/oauth-authorization-server" });
        assert.equal(r.status, 200, JSON.stringify(args));
      } finally {
        srv.stop();
      }
    }
  });

  test("an id and a secret are the word after the option, whatever it holds", async () => {
    const id = "--cliënt id";
    const secret = "--sécret 1";
    await withSignin(["--client", id, "--secret", secret], async (srv) => {
      const redirect_uri = "http://localhost:4000/cb";
      const { verifier, challenge } = pkce();
      const a = await authorize(srv, {
        response_type: "code",
        client_id: id,
        redirect_uri,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      assert.equal(a.status, 302);
      const params = { grant_type: "authorization_code", code: a.code, redirect_uri, code_verifier: verifier };
      const refused = await token(srv, { ...params, client_id: id, client_secret: "other" });
      assert.equal(refused.status, 401);
      const second = await authorize(srv, {
        response_type: "code",
        client_id: id,
        redirect_uri,
        code_challenge: challenge,
        code_challenge_method: "S256",
      });
      const ok = await token(srv, { ...params, code: second.code, client_id: id, client_secret: secret });
      assert.equal(ok.status, 200, ok.text);
    });
  });
});

describe("Step 10: listening, standard input and signals", () => {
  test("the port cannot be listened on: one line on standard error, exit code 1, nothing on standard output", async () => {
    const holder = net.createServer();
    await new Promise((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const port = holder.address().port;
    try {
      for (const extra of [[], ["--expires", "5"], ["--client", "c"], ["--client", "c", "--secret", "s"]]) {
        const r = await runToEnd(["--port", String(port), "--signin", ...extra]);
        assert.equal(r.signal, null);
        assert.equal(r.code, 1, JSON.stringify(extra));
        assert.equal(r.stderr, `practice: cannot listen on port ${port}\n`);
        assert.equal(r.stdout, "");
      }
    } finally {
      await new Promise((resolve) => holder.close(resolve));
    }
  });

  test("it prints only the listening line, on standard output and on standard error, whatever it is asked", async () => {
    await withSignin([], async (srv) => {
      const { client_id } = await register(srv);
      const t = await signInByHand(srv, client_id);
      await mcp(srv, `Bearer ${t.access_token}`);
      await mcp(srv, undefined);
      await call(srv, { path: "/nope" });
      await call(srv, { method: "POST", path: "/register", body: "{not json" });
      await token(srv, { grant_type: "nope" });
      await call(srv, { method: "POST", path: "/forget" });
      await call(srv, { path: "/seen" });
      await wait(50);
      assert.equal(srv.stdout(), srv.line);
      assert.equal(srv.stderr(), "");
    });
  });

  test("a closed standard input does not end it", async () => {
    await withSignin([], async (srv) => {
      srv.child.stdin.end();
      await wait(300);
      assert.equal(srv.child.exitCode, null);
      assert.equal(srv.child.signalCode, null);
      const r = await call(srv, { path: "/seen" });
      assert.equal(r.status, 200);
    });
  });

  for (const sig of ["SIGTERM", "SIGINT"]) {
    test(`${sig} with no request in progress ends it as the system does: the process dies of it`, async () => {
      const srv = await startAddress(["--port", "0", "--signin"]);
      try {
        await call(srv, { path: "/seen" });
        const { code, signal } = await endWith(srv, sig);
        assert.equal(signal, sig);
        assert.equal(code, null);
      } finally {
        srv.stop();
      }
    });

    test(`${sig} with a request in progress ends it as the system does: the process dies of it`, async () => {
      const srv = await startAddress(["--port", "0", "--signin"]);
      const socket = net.connect({ host: "127.0.0.1", port: srv.port });
      socket.on("error", () => {});
      try {
        await new Promise((resolve, reject) => {
          socket.on("connect", resolve);
          socket.on("error", reject);
        });
        await new Promise((resolve) =>
          socket.write(
            "POST /token HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 100000\r\n\r\ngrant_type=",
            resolve,
          ),
        );
        await wait(100);
        const { code, signal } = await endWith(srv, sig);
        assert.equal(signal, sig);
        assert.equal(code, null);
      } finally {
        socket.destroy();
        srv.stop();
      }
    });
  }

  test("what it handed out is gone with it: a token of one process is nothing to the next", async () => {
    const first = await startAddress(["--port", "0", "--signin"]);
    let old;
    try {
      first.origin = `http://127.0.0.1:${first.port}`;
      const { client_id } = await register(first);
      old = await signInByHand(first, client_id);
      assert.equal((await mcp(first, `Bearer ${old.access_token}`)).status, 200);
      await endWith(first, "SIGTERM");
    } finally {
      first.stop();
    }
    await withSignin([], async (second) => {
      assert.equal((await mcp(second, `Bearer ${old.access_token}`)).status, 401);
      const { client_id } = await register(second);
      const r = await token(second, { grant_type: "refresh_token", refresh_token: old.refresh_token, client_id });
      assert.equal(r.status, 400);
      assert.equal(r.json.error, "invalid_grant");
    });
  });
});

describe("Step 10: without --signin the server is what it was", () => {
  test("the sign-in paths are 404 at an address with no --signin, with or without --token, and /mcp is as before", async () => {
    for (const extra of [[], ["--token", "t"]]) {
      const srv = await startAddress(["--port", "0", ...extra]);
      try {
        for (const [method, path] of [
          ["GET", "/.well-known/oauth-protected-resource"],
          ["GET", "/.well-known/oauth-protected-resource/mcp"],
          ["GET", "/.well-known/oauth-authorization-server"],
          ["POST", "/register"],
          ["GET", "/authorize"],
          ["POST", "/token"],
          ["POST", "/forget"],
          ["GET", "/seen"],
        ]) {
          const r = await call(srv, { method, path, body: method === "POST" ? form({ a: "b" }) : undefined });
          assert.equal(r.status, 404, `${extra.join(" ")} ${method} ${path}`);
        }
        const refused = await mcp(srv, undefined);
        assert.equal(refused.status, extra.length === 0 ? 200 : 401);
        const given = await mcp(srv, extra.length === 0 ? "Bearer anything" : "Bearer t");
        assert.equal(given.status, 200);
        assert.equal(srv.stdout(), srv.line);
        assert.equal(srv.stderr(), "");
      } finally {
        srv.stop();
      }
    }
  });
});
