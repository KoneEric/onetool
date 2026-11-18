import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { withServer, rawServer, expectedRows, textOf, CITIES } from "./helpers.js";

const NAMES = ["rows", "count", "echo", "fail", "wipe"];

describe("the command, spoken to with the package's own client", () => {
  test("names itself practice, version 1.0.0, and offers tools only", async () => {
    await withServer(async (client) => {
      assert.deepEqual(client.getServerVersion()?.name, "practice");
      assert.deepEqual(client.getServerVersion()?.version, "1.0.0");
      const caps = client.getServerCapabilities();
      assert.ok(caps.tools);
      assert.equal(caps.resources, undefined);
      assert.equal(caps.prompts, undefined);
    });
  });

  test("answers ping", async () => {
    await withServer(async (client) => {
      await client.ping();
    });
  });

  test("lists the five tools in order, with the exact descriptions", async () => {
    await withServer(async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name), NAMES);
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      assert.equal(byName.rows.description, "Returns the practice table: 5,000 rows of id, name, city and amount. Use it to try programs on a large result.");
      assert.equal(byName.count.description, "Counts the rows of the practice table. Answers as JSON text.");
      assert.equal(byName.echo.description, "Answers with the text it was given. Plain text.");
      assert.equal(byName.fail.description, "Always fails. Use it to try what a program does with a failing tool.");
      assert.equal(byName.wipe.description, "Pretends to delete the practice table. It deletes nothing.");
    });
  });

  test("the input schemas: object, properties in order, required only for echo's text, no output schema", async () => {
    await withServer(async (client) => {
      const { tools } = await client.listTools();
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      const shape = { rows: ["city"], count: ["city"], echo: ["text"], fail: ["reason"], wipe: [] };
      for (const name of NAMES) {
        const schema = byName[name].inputSchema;
        assert.equal(schema.type, "object", name);
        assert.deepEqual(Object.keys(schema.properties), shape[name], name);
        for (const p of shape[name]) assert.equal(schema.properties[p].type, "string", `${name}.${p}`);
        assert.equal(byName[name].outputSchema, undefined, name);
        if (name === "echo") assert.deepEqual(schema.required, ["text"]);
        else assert.ok(schema.required === undefined, `${name} has no required list`);
      }
      assert.deepEqual(byName.wipe.inputSchema.properties, {});
    });
  });

  test("prints nothing on standard error in normal work", async () => {
    await withServer(async (client, stderr) => {
      await client.listTools();
      await client.callTool({ name: "count", arguments: {} });
      await client.callTool({ name: "fail", arguments: {} });
      await client.callTool({ name: "rows", arguments: { city: 5 } });
      assert.deepEqual(stderr, []);
    });
  });
});

describe("rows", () => {
  test("all 5,000 rows, as structured result and as one text with the same JSON", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "rows", arguments: {} });
      assert.ok(!res.isError);
      const expected = expectedRows();
      assert.equal(expected.length, 5000);
      assert.deepEqual(res.structuredContent, { rows: expected });
      assert.equal(res.content.length, 1);
      assert.equal(res.content[0].type, "text");
      assert.deepEqual(JSON.parse(textOf(res)), { rows: expected });
    });
  });

  test("the keys of a row come in the order id, name, city, amount", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "rows", arguments: {} });
      assert.deepEqual(Object.keys(res.structuredContent.rows[0]), ["id", "name", "city", "amount"]);
      assert.deepEqual(Object.keys(JSON.parse(textOf(res)).rows[4999]), ["id", "name", "city", "amount"]);
    });
  });

  test("a city keeps only its rows, sorted by id", async () => {
    await withServer(async (client) => {
      for (const city of ["Lyon", "Dijon"]) {
        const res = await client.callTool({ name: "rows", arguments: { city } });
        const expected = expectedRows(city);
        assert.equal(expected.length, 625);
        assert.deepEqual(res.structuredContent, { rows: expected });
        assert.deepEqual(JSON.parse(textOf(res)), { rows: expected });
        assert.equal(res.content.length, 1);
      }
    });
  });

  test("the city must match exactly: case counts, an unknown city gives no row, the empty string gives no row", async () => {
    await withServer(async (client) => {
      for (const city of ["lyon", "LYON", "Lyon ", "Berlin", ""]) {
        const res = await client.callTool({ name: "rows", arguments: { city } });
        assert.ok(!res.isError, city);
        assert.deepEqual(res.structuredContent, { rows: [] }, JSON.stringify(city));
        assert.deepEqual(JSON.parse(textOf(res)), { rows: [] }, JSON.stringify(city));
      }
    });
  });

  test("a property that is not listed is ignored", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "rows", arguments: { city: "Nice", extra: 1 } });
      assert.deepEqual(res.structuredContent, { rows: expectedRows("Nice") });
    });
  });

  test("a city that is not a string fails", async () => {
    await withServer(async (client) => {
      for (const city of [5, true, ["Paris"], { a: 1 }]) {
        const res = await client.callTool({ name: "rows", arguments: { city } });
        assert.equal(res.isError, true, JSON.stringify(city));
        assert.equal(res.content.length, 1);
        assert.equal(res.content[0].type, "text");
        assert.equal(textOf(res), "practice: city must be a string");
      }
    });
  });
});

describe("count", () => {
  test("all the rows: one text {\"count\":5000}, no structured result", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "count", arguments: {} });
      assert.ok(!res.isError);
      assert.equal(res.content.length, 1);
      assert.equal(res.content[0].type, "text");
      assert.equal(textOf(res), '{"count":5000}');
      assert.equal(res.structuredContent, undefined);
    });
  });

  test("each city has 625 rows", async () => {
    await withServer(async (client) => {
      for (const city of CITIES) {
        const res = await client.callTool({ name: "count", arguments: { city } });
        assert.equal(textOf(res), '{"count":625}', city);
        assert.equal(res.structuredContent, undefined);
      }
    });
  });

  test("an unknown city, another case, the empty string: zero", async () => {
    await withServer(async (client) => {
      for (const city of ["paris", "Berlin", ""]) {
        const res = await client.callTool({ name: "count", arguments: { city } });
        assert.ok(!res.isError, city);
        assert.equal(textOf(res), '{"count":0}', JSON.stringify(city));
      }
    });
  });

  test("a property that is not listed is ignored", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "count", arguments: { city: "Paris", extra: "x" } });
      assert.equal(textOf(res), '{"count":625}');
    });
  });

  test("a city that is not a string fails", async () => {
    await withServer(async (client) => {
      for (const city of [1, false, ["Paris"]]) {
        const res = await client.callTool({ name: "count", arguments: { city } });
        assert.equal(res.isError, true, JSON.stringify(city));
        assert.equal(res.content.length, 1);
        assert.equal(textOf(res), "practice: city must be a string");
      }
    });
  });
});

describe("echo", () => {
  test("answers with the text unchanged, no structured result", async () => {
    await withServer(async (client) => {
      for (const text of ["hello", "  padded \n with\tspace  ", "héllo ✓ 日本", '{"a":1}', "x".repeat(100000)]) {
        const res = await client.callTool({ name: "echo", arguments: { text } });
        assert.ok(!res.isError);
        assert.equal(res.content.length, 1);
        assert.equal(res.content[0].type, "text");
        assert.equal(res.content[0].text, text);
        assert.equal(res.structuredContent, undefined);
      }
    });
  });

  test("the empty string is used as it is", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "echo", arguments: { text: "" } });
      assert.ok(!res.isError);
      assert.equal(res.content.length, 1);
      assert.equal(res.content[0].text, "");
    });
  });

  test("a missing text fails", async () => {
    await withServer(async (client) => {
      for (const args of [{}, { other: "x" }]) {
        const res = await client.callTool({ name: "echo", arguments: args });
        assert.equal(res.isError, true);
        assert.equal(res.content.length, 1);
        assert.equal(res.content[0].type, "text");
        assert.equal(textOf(res), "practice: text must be a string");
      }
    });
  });

  test("a text that is not a string fails", async () => {
    await withServer(async (client) => {
      for (const text of [5, true, ["a"], { a: 1 }]) {
        const res = await client.callTool({ name: "echo", arguments: { text } });
        assert.equal(res.isError, true, JSON.stringify(text));
        assert.equal(textOf(res), "practice: text must be a string");
      }
    });
  });

  test("a property that is not listed is ignored", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "echo", arguments: { text: "hi", city: "Paris" } });
      assert.equal(textOf(res), "hi");
    });
  });
});

describe("fail", () => {
  test("a failed result with the reason", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "fail", arguments: { reason: "disk on fire" } });
      assert.equal(res.isError, true);
      assert.equal(res.content.length, 1);
      assert.equal(res.content[0].type, "text");
      assert.equal(res.content[0].text, "practice failure: disk on fire");
    });
  });

  test("'asked to fail' when no reason is given", async () => {
    await withServer(async (client) => {
      for (const args of [{}, { other: 1 }]) {
        const res = await client.callTool({ name: "fail", arguments: args });
        assert.equal(res.isError, true);
        assert.equal(res.content.length, 1);
        assert.equal(textOf(res), "practice failure: asked to fail");
      }
    });
  });

  test("the empty string as reason is used as it is", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "fail", arguments: { reason: "" } });
      assert.equal(res.isError, true);
      assert.equal(textOf(res), "practice failure: ");
    });
  });

  test("a reason that is not a string fails with the message about the property", async () => {
    await withServer(async (client) => {
      for (const reason of [5, true, ["x"]]) {
        const res = await client.callTool({ name: "fail", arguments: { reason } });
        assert.equal(res.isError, true, JSON.stringify(reason));
        assert.equal(res.content.length, 1);
        assert.equal(textOf(res), "practice: reason must be a string");
      }
    });
  });
});

describe("wipe", () => {
  test("answers 'wiped', no structured result, and nothing changes", async () => {
    await withServer(async (client) => {
      const before = await client.callTool({ name: "rows", arguments: {} });
      const res = await client.callTool({ name: "wipe", arguments: {} });
      assert.ok(!res.isError);
      assert.equal(res.content.length, 1);
      assert.equal(res.content[0].type, "text");
      assert.equal(res.content[0].text, "wiped");
      assert.equal(res.structuredContent, undefined);
      const after = await client.callTool({ name: "rows", arguments: {} });
      assert.deepEqual(after.structuredContent, before.structuredContent);
      assert.equal(textOf(await client.callTool({ name: "count", arguments: {} })), '{"count":5000}');
    });
  });

  test("properties that are not listed are ignored", async () => {
    await withServer(async (client) => {
      const res = await client.callTool({ name: "wipe", arguments: { city: "Paris", table: "all" } });
      assert.ok(!res.isError);
      assert.equal(textOf(res), "wiped");
    });
  });
});

describe("an unknown tool", () => {
  test("is a JSON-RPC error whose message holds 'unknown tool: <name>'", async () => {
    await withServer(async (client) => {
      for (const name of ["nope", "Rows", ""]) {
        await assert.rejects(
          () => client.callTool({ name, arguments: {} }),
          (err) => {
            assert.ok(err instanceof McpError, `expected a JSON-RPC error, got ${err}`);
            assert.ok(err.message.includes(`unknown tool: ${name}`), err.message);
            return true;
          },
          JSON.stringify(name),
        );
      }
    });
  });

  test("the server still answers afterwards", async () => {
    await withServer(async (client) => {
      await assert.rejects(() => client.callTool({ name: "nope", arguments: {} }));
      assert.equal(textOf(await client.callTool({ name: "echo", arguments: { text: "ok" } })), "ok");
    });
  });
});

describe("the process", () => {
  test("ends with code 0 when its standard input closes; standard output holds MCP messages only; nothing on standard error", async () => {
    const s = rawServer();
    try {
      const init = await s.initialize();
      assert.equal(init.result.serverInfo.name, "practice");
      assert.equal(init.result.serverInfo.version, "1.0.0");
      const list = await s.request("tools/list", {});
      assert.deepEqual(list.result.tools.map((t) => t.name), NAMES);
      const call = await s.request("tools/call", { name: "echo", arguments: { text: "raw" } });
      assert.equal(call.result.content[0].text, "raw");
      const bad = await s.request("tools/call", { name: "zzz", arguments: {} });
      assert.ok(bad.error);
      assert.ok(String(bad.error.message).includes("unknown tool: zzz"));
      s.child.stdin.end();
      const timer = setTimeout(() => s.kill(), 5000);
      const { code, signal } = await s.exited;
      clearTimeout(timer);
      assert.equal(signal, null);
      assert.equal(code, 0);
      assert.ok(s.lines.length >= 4);
      for (const line of s.lines) {
        const msg = JSON.parse(line);
        assert.equal(msg.jsonrpc, "2.0", line);
      }
      assert.equal(s.stderr(), "");
    } finally {
      s.kill();
    }
  });

  test("ends with code 0 when its standard input closes before any message", async () => {
    const s = rawServer();
    try {
      s.child.stdin.end();
      const timer = setTimeout(() => s.kill(), 5000);
      const { code, signal } = await s.exited;
      clearTimeout(timer);
      assert.equal(signal, null);
      assert.equal(code, 0);
      assert.deepEqual(s.lines, []);
      assert.equal(s.stderr(), "");
    } finally {
      s.kill();
    }
  });

  for (const sig of ["SIGTERM", "SIGINT"]) {
    test(`${sig} with no call in progress does what the system does: the process dies of it`, async () => {
      const s = rawServer();
      try {
        await s.initialize();
        s.child.kill(sig);
        const timer = setTimeout(() => s.kill(), 5000);
        const { code, signal } = await s.exited;
        clearTimeout(timer);
        assert.equal(signal, sig);
        assert.equal(code, null);
      } finally {
        s.kill();
      }
    });
  }
});
