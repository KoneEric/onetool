import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import * as core from "../src/index.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pkg = () => JSON.parse(read("../../package.json"));
const lock = () => JSON.parse(read("../../package-lock.json"));

describe("what other parts may call", () => {
  test("core/src/index.js exports exactly what the meeting point lists", () => {
    assert.deepEqual(
      Object.keys(core).sort(),
      [
        "SHELL_NO_FOLDERS",
        "SHELL_TOOLS",
        "SettingsError",
        "signInMessage",
        "signsIn",
        "ToolError",
        "askMessage",
        "askRefusal",
        "callSize",
        "cutAnswer",
        "decide",
        "decideCommand",
        "formatRun",
        "formatTrail",
        "hostDenial",
        "logFileName",
        "logLine",
        "nextState",
        "readSettings",
        "rootFolders",
        "searchTools",
        "shellLogArgs",
        "shellOffMessage",
        "toolLine",
        "toolValue",
        "withTrail",
        "runRequest",
        "jobState",
        "jobStarted",
        "jobLimitMessage",
        "noJobMessage",
        "jobLine",
        "formatJobs",
        "formatJob",
        "programLine",
        "libraryText",
        "saveItNote",
        "sameAsNote",
        "archivedNote",
        "keptTools",
        "INSTRUCTIONS",
        "nextStreak",
        "oneProgramNote",
        "sessionLine",
      ].sort(),
    );
  });

  test("the functions are functions and the two errors are Error classes", () => {
    for (const name of ["readSettings", "decide", "toolLine", "searchTools", "toolValue", "formatRun", "cutAnswer", "nextState"]) {
      assert.equal(typeof core[name], "function", name);
    }
    assert.ok(core.SettingsError.prototype instanceof Error);
    assert.ok(core.ToolError.prototype instanceof Error);
  });

  test("index.js imports nothing but Node's standard library", () => {
    const source = read("../src/index.js");
    const specifiers = [
      ...[...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...source.matchAll(/\bimport\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ];
    for (const specifier of specifiers) {
      const bare = specifier.replace(/^node:/, "");
      assert.ok(builtinModules.includes(bare), `${specifier} is not a Node module`);
    }
  });
});

describe("the package file", () => {
  test("name, type, bin, engines and a version", () => {
    const p = pkg();
    assert.equal(p.name, "@koneeric/onetool");
    assert.equal(p.type, "module");
    assert.deepEqual(p.bin, { onetool: "bin/onetool.js" });
    assert.deepEqual(p.engines, { node: ">=22" });
    assert.equal(typeof p.version, "string");
    assert.ok(p.version.length > 0);
  });

  test("exactly one dependency, the MCP SDK at ^1.32.2", () => {
    assert.deepEqual(pkg().dependencies, { "@modelcontextprotocol/sdk": "^1.32.2" });
  });

  test("no devDependencies and no build script", () => {
    const p = pkg();
    assert.equal(p.devDependencies, undefined);
    assert.equal(p.scripts?.build, undefined);
  });

  test("package-lock.json is in step with the package file", () => {
    const l = lock();
    assert.equal(typeof l.lockfileVersion, "number");
    assert.equal(l.name, "@koneeric/onetool");
    const root = l.packages[""];
    assert.deepEqual(root.dependencies, { "@modelcontextprotocol/sdk": "^1.32.2" });
    assert.equal(root.devDependencies, undefined);
    assert.equal(root.version, pkg().version);
  });

  test("the lock holds an SDK version that satisfies ^1.32.2", () => {
    const entry = lock().packages["node_modules/@modelcontextprotocol/sdk"];
    assert.ok(entry, "the SDK is in the lock");
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(entry.version);
    assert.ok(m, `version ${entry.version}`);
    const [major, minor, patch] = m.slice(1).map(Number);
    assert.equal(major, 1);
    assert.ok(minor > 32 || (minor === 32 && patch >= 2), `version ${entry.version} is below 1.32.2`);
  });
});
