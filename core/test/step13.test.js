import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.js";
import { settingsOf, printedBy } from "./helpers.js";

// The text of step 12, to the character, and the sentence step 13 adds after one space.
const STEP12 =
  "onetool gives you two tools, run and search. It saves context only when one program does several steps. " +
  "Before the first run, list the steps of the task. Put every step that needs no decision into one program: " +
  "loops, filters, several tools. Return only the small result you need to decide what comes next. Keep large " +
  "results in state and look at them in a later program. Never use run for one tool call when the next call is " +
  "already known: put both calls in one program.";
const SENTENCE = "When the host program loads tools on request, ask for run and search together, in one request.";

describe("step 13: INSTRUCTIONS", () => {
  test("it is exactly the text of the meeting point", () => {
    assert.equal(core.INSTRUCTIONS, STEP12 + " " + SENTENCE);
  });

  test("it is the text of step 12, one space, and the new sentence", () => {
    assert.ok(core.INSTRUCTIONS.startsWith(STEP12 + " "));
    assert.equal(core.INSTRUCTIONS.slice(STEP12.length), " " + SENTENCE);
    assert.ok(core.INSTRUCTIONS.endsWith(SENTENCE));
  });

  test("it is one line, 565 characters, and at most 600", () => {
    assert.equal(typeof core.INSTRUCTIONS, "string");
    // The text gives the length: the 470 characters of step 12, so a first part of that length.
    assert.equal(STEP12.length, 470);
    assert.equal(core.INSTRUCTIONS.length, 565);
    assert.ok(core.INSTRUCTIONS.length <= 600);
    assert.ok(!/[\r\n]/.test(core.INSTRUCTIONS));
  });

  test("it names no host program", () => {
    assert.ok(!core.INSTRUCTIONS.includes("Claude"));
    assert.ok(!core.INSTRUCTIONS.includes("Codex"));
  });

  test("it is fixed: the settings read do not change it", () => {
    settingsOf({ mcpServers: {}, onetool: { instructions: false } });
    settingsOf({ mcpServers: {} });
    assert.equal(core.INSTRUCTIONS, STEP12 + " " + SENTENCE);
  });

  test("reading it prints nothing", () => {
    assert.deepEqual(printedBy(() => core.INSTRUCTIONS.length), []);
  });

  test("the exports and the key instructions are as before: INSTRUCTIONS is still a string, not a function", () => {
    assert.equal(typeof core.INSTRUCTIONS, "string");
    assert.equal(settingsOf({ mcpServers: {} }).instructions, true);
    assert.equal(settingsOf({ mcpServers: {}, onetool: { instructions: false } }).instructions, false);
  });
});
