import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpRoot } from "./helpers.js";

const SRC = pathToFileURL(join(import.meta.dirname, "..", "src", "index.js")).href;

// The part prints nothing and keeps nothing alive: a process that uses every function ends by itself, silent.
const SCENARIO = `
const lib = await import(process.argv[1]);
const root = process.argv[2];
const folder = root + "/proj/.onetool/library";
const prog = { name: "a", about: "A.", params: ["x"], code: "tools.p.q()\\n" };
lib.isProgramName("a"); lib.checkSave({}); lib.checkSave({ name: "a", about: "A.", code: "1" });
lib.callSequence("tools.a.b()"); lib.saveDecision([], prog); lib.logArgs("save", prog);
lib.parseProgram(lib.formatProgram(prog)); lib.joinLibraries([], []); lib.archiveFolder(folder);
await lib.readLibrary(folder);
await lib.saveProgram(folder, prog, { now: 0 });
await lib.saveProgram(folder, { ...prog, name: "b" }, { replaces: "a", now: 1 });
await lib.noteUses(folder, [{ name: "b", ok: false }], { now: 2, failuresLimit: 1 });
await lib.removeProgram(folder, "b", { now: 3 });
await lib.saveProgram(folder, prog, { now: 4 });
await lib.saveProgram(folder + "/a.js/inner", prog).catch(() => {});
await lib.readLibrary(folder);
`;

test("the part prints nothing, and a process that used it ends by itself", (t) => {
  const root = tmpRoot(t);
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", SCENARIO, SRC, root], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(run.error, undefined);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, "");
});
