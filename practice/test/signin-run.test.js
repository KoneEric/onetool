import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { checkSameAnswers, checkFaults, NAMES } from "./address-helpers.js";
import { call, mcp, seen, wait, within, withSignin, memoryProvider, newClient, signIn, connected } from "./signin-helpers.js";

describe("Step 10: the run through the real thing", () => {
  test("the first connection is refused with the address to open; the code in Location, finished, signs in; a new connection lists the five tools", async () => {
    await withSignin([], async (srv) => {
      const provider = memoryProvider();
      const { address, location, code } = await signIn(srv, provider);
      assert.equal(address.origin, srv.origin);
      assert.equal(address.pathname, "/authorize");
      assert.equal(provider.redirects.length, 1);
      assert.match(code, /^practice-code-[A-Za-z0-9_-]{32}$/);
      assert.equal(location.origin + location.pathname, provider.redirectUrl);
      const sent = address.searchParams.get("state");
      if (sent !== null) assert.equal(location.searchParams.get("state"), sent);
      assert.match(provider.saved.client.client_id, /^practice-client-1$/);
      assert.match(provider.saved.tokens.access_token, /^practice-at-[A-Za-z0-9_-]{32}$/);
      assert.match(provider.saved.tokens.refresh_token, /^practice-rt-[A-Za-z0-9_-]{32}$/);

      await connected(srv, provider, async (client) => {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((t) => t.name), NAMES);
        await checkSameAnswers(client);
        await checkFaults(client, McpError);
      });

      assert.deepEqual(await seen(srv), { registrations: 1, authorizations: 1, tokens: 1, refreshes: 0, refused: 1 });
      assert.equal(srv.stdout(), srv.line);
      assert.equal(srv.stderr(), "");
    });
  });

  test("a connection with no sign-in is refused again, and a connection of a client that is not signed in does not get the table", async () => {
    await withSignin([], async (srv) => {
      const { client, transport } = newClient(srv, memoryProvider());
      await assert.rejects(() => within(client.connect(transport), 10000, "connect"));
      await client.close().catch(() => {});
      assert.equal((await mcp(srv, undefined)).status, 401);
    });
  });

  test("several clients may be signed in at once", async () => {
    await withSignin([], async (srv) => {
      const one = memoryProvider();
      const two = memoryProvider();
      await signIn(srv, one);
      await signIn(srv, two);
      assert.notEqual(one.saved.client.client_id, two.saved.client.client_id);
      const answers = await Promise.all(
        [one, two].map((p, i) =>
          connected(srv, p, async (client) => {
            const echo = await client.callTool({ name: "echo", arguments: { text: `from ${i}` } });
            const count = await client.callTool({ name: "count", arguments: { city: "Nice" } });
            return [echo.content[0].text, count.content[0].text];
          }),
        ),
      );
      assert.deepEqual(answers, [["from 0", '{"count":625}'], ["from 1", '{"count":625}']]);
    });
  });

  test("after /forget the signed-in client is refused and signs in again by the refresh token or the sign-in", async () => {
    await withSignin([], async (srv) => {
      const provider = memoryProvider();
      await signIn(srv, provider);
      const old = provider.saved.tokens;
      await connected(srv, provider, async (client) => {
        assert.equal((await client.callTool({ name: "echo", arguments: { text: "a" } })).content[0].text, "a");
      });
      assert.equal((await call(srv, { method: "POST", path: "/forget" })).status, 204);
      assert.equal((await mcp(srv, `Bearer ${old.access_token}`)).status, 401);
      // The refresh token is forgotten too: the package cannot refresh and asks for a new sign-in.
      const { client, transport } = newClient(srv, provider);
      await assert.rejects(() => within(client.connect(transport), 10000, "connect after forget"));
      await client.close().catch(() => {});
      assert.equal((await seen(srv)).refreshes, 0);
    });
  });

  test("with --expires 1, 1.5 seconds later a call still answers and /seen counts one refresh", async () => {
    await withSignin(["--expires", "1"], async (srv) => {
      const provider = memoryProvider();
      await signIn(srv, provider);
      const first = provider.saved.tokens;
      await connected(srv, provider, async (client) => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 5);
        await wait(1500);
        const res = await within(client.callTool({ name: "echo", arguments: { text: "still here" } }), 10000, "the call");
        assert.equal(res.content[0].text, "still here");
      });
      const now = provider.saved.tokens;
      assert.notEqual(now.access_token, first.access_token);
      assert.notEqual(now.refresh_token, first.refresh_token);
      assert.equal((await mcp(srv, `Bearer ${first.access_token}`)).status, 401);
      const counted = await seen(srv);
      assert.equal(counted.refreshes, 1);
      assert.equal(counted.tokens, 1);
      assert.equal(counted.registrations, 1);
    });
  });

  test("with --client fixed --secret s3 a client that registers is refused and the client fixed with the secret signs in", async () => {
    await withSignin(["--client", "fixed", "--secret", "s3"], async (srv) => {
      // A client that registers itself: there is no registration, and no sign-in follows.
      const stranger = memoryProvider();
      const { client, transport } = newClient(srv, stranger);
      await assert.rejects(() => within(client.connect(transport), 10000, "connect of a client that registers"));
      await client.close().catch(() => {});
      assert.equal(stranger.redirects.length, 0);
      assert.equal(stranger.saved.tokens, undefined);
      assert.deepEqual(await seen(srv), { registrations: 0, authorizations: 0, tokens: 0, refreshes: 0, refused: 1 });

      // The client fixed with a wrong secret does not get its tokens.
      const wrong = memoryProvider({ client: { client_id: "fixed", client_secret: "nope" } });
      await assert.rejects(() => signIn(srv, wrong));
      assert.equal(wrong.saved.tokens, undefined);

      // The client fixed with the secret signs in.
      const provider = memoryProvider({ client: { client_id: "fixed", client_secret: "s3" } });
      await signIn(srv, provider);
      assert.match(provider.saved.tokens.access_token, /^practice-at-/);
      await connected(srv, provider, async (c) => {
        const { tools } = await c.listTools();
        assert.deepEqual(tools.map((t) => t.name), NAMES);
        assert.equal((await c.callTool({ name: "count", arguments: {} })).content[0].text, '{"count":5000}');
      });
      const counted = await seen(srv);
      assert.equal(counted.registrations, 0);
      assert.equal(counted.tokens, 1);
    });
  });
});
