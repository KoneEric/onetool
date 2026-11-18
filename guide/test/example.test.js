// the meeting point of guide, "`settings.example.json`": equal, as a value, to the file the text gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSettings } from "../../core/src/index.js";
import { EXAMPLE } from "./helpers.js";

test("settings.example.json is the file of the meeting point, as a value", () => {
  assert.deepEqual(JSON.parse(readFileSync(EXAMPLE, "utf8")), {
    mcpServers: {
      practice: { command: "node", args: ["practice/src/server.js"] },
    },
    onetool: { deny: ["practice.fail"], ask: ["practice.wipe"] },
  });
});

test("readSettings accepts it: one server, no bad entry, the two rules", () => {
  const settings = readSettings(EXAMPLE);
  assert.deepEqual(settings.bad, []);
  assert.deepEqual(settings.servers, [{ name: "practice", command: "node", args: ["practice/src/server.js"], env: {} }]);
  assert.deepEqual(settings.deny, ["practice.fail"]);
  assert.deepEqual(settings.ask, ["practice.wipe"]);
});
