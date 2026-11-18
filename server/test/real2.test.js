// Step 2: the run through the real thing. The practice server is a process of its own at an address, the command
// is a process, and the client of the package speaks to it. Nothing is replaced. The points are those of
// the meeting point of server, "Step 2: the run through the real thing".
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { PRACTICE, ROOT, settingsOf, textOf, waitFor, withOnetool } from "./helpers.js";

const TOKEN = "real2-token-4f9c1e7a";

/** Starts `node practice/src/server.js --port 0 --token <token>` and gives its printed address, and `stop()`. */
async function practiceAtAnAddress(token) {
  const child = spawn(process.execPath, [PRACTICE, "--port", "0", "--token", token], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (out += chunk));
  const ended = new Promise((resolve) => child.on("close", resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await ended;
  };
  try {
    const line = await waitFor(
      () => out.split("\n").find((l) => /^practice: listening on http:\/\/127\.0\.0\.1:[0-9]+\/mcp$/.test(l)),
      5000,
      "the practice server to print its address",
    );
    return { address: line.slice("practice: listening on ".length), stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

test("the run through the real thing, with a server at an address and state", async () => {
  const practice = await practiceAtAnAddress(TOKEN);
  try {
    const settings = {
      mcpServers: {
        desk: { command: "node", args: [PRACTICE] },
        far: { url: practice.address, headers: { Authorization: `Bearer ${TOKEN}` } },
        locked: { url: practice.address, headers: { Authorization: "Bearer not-the-token" } },
      },
    };
    await withOnetool(settings, async (ctx) => {
      const answers = [];
      const seen = (result) => {
        const text = textOf(result);
        answers.push(text);
        return text;
      };

      // 1. tools/list gives exactly run and search
      const { tools } = await ctx.client.listTools();
      assert.deepEqual(tools.map((t) => t.name), ["run", "search"]);

      // 2. three lines: the two servers, and the one that is not connected
      const servers = seen(await ctx.call("search", {}));
      assert.equal(servers, ["desk: 5 tools", "far: 5 tools", "locked: not connected (could not connect)"].join("\n"));

      // 3. a tool of the server at the address: 5,000 rows, 8 cities, 625 each
      const counted = await ctx.run('(await tools.far.count({ city: "Lyon" })).count');
      assert.notEqual(counted.isError, true);
      assert.equal(seen(counted), "625");

      // 4. the 5,000 rows are kept in state, and only how many there are is answered
      const kept = await ctx.run("state.rows = (await tools.far.rows({})).rows;\nstate.rows.length");
      assert.notEqual(kept.isError, true);
      assert.equal(seen(kept), "5000");
      assert.ok(textOf(kept).length < 200);

      // 5. a second program calls no tool and looks at what the first one kept
      const looked = await ctx.run('state.rows.filter((row) => row.city === "Lyon").length');
      assert.notEqual(looked.isError, true);
      assert.equal(seen(looked), "625");

      // 6. the line on standard error, and nothing of the settings file anywhere
      await waitFor(
        () => ctx.stderrLines().includes("onetool: server locked: not connected (could not connect)"),
        3000,
        "the line of the server that is not connected",
      );
      const everything = `${ctx.stderr()}\n${answers.join("\n")}`;
      for (const secret of [TOKEN, "not-the-token", practice.address]) {
        assert.ok(!everything.includes(secret), `${secret} is in an answer or on standard error`);
      }
    });
  } finally {
    await practice.stop();
  }
});
