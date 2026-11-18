import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./helpers.js";

// The pieces of the patterns are joined here so that this file does not hold what it looks for.
const SEP = "/";
const HOME_FOLDERS = [`${SEP}Us` + `ers${SEP}`, `${SEP}ho` + `me${SEP}`];
const WORDS = ["Er" + "ic", "Ground" + "Zero", "fact" + "ory", "ME" + "ETS"];
const EMAIL = new RegExp("[A-Za-z0-9._%+-]+" + "@" + "[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}");
const NEXT = /[A-Za-z0-9_]/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** What the public copy refuses, found in one line of text. */
function found(line) {
  const kinds = [];
  for (const home of HOME_FOLDERS) {
    for (let i = line.indexOf(home); i >= 0; i = line.indexOf(home, i + 1)) {
      if (NEXT.test(line[i + home.length] ?? "")) kinds.push("a home folder path");
    }
  }
  const win = /\\{1,2}Users\\{1,2}[A-Za-z0-9_]/;
  if (win.test(line)) kinds.push("a home folder path");
  if (EMAIL.test(line)) kinds.push("an e-mail address");
  for (const word of WORDS) {
    for (let i = line.indexOf(word); i >= 0; i = line.indexOf(word, i + 1)) {
      const before = line[i - 1] ?? "";
      const after = line[i + word.length] ?? "";
      if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) kinds.push(`the word ${word}`);
    }
  }
  return kinds;
}

describe("What refuses a copy: practice/src and practice/test", () => {
  test("no file holds a home folder path, an e-mail address or one of the words the public copy refuses", () => {
    const all = [...files(join(ROOT, "practice", "src")), ...files(join(ROOT, "practice", "test"))];
    assert.ok(all.length > 5);
    const findings = [];
    for (const file of all) {
      const path = relative(ROOT, file);
      findings.push(...found(path).map((k) => `${path}:0: ${k}`));
      readFileSync(file).toString("utf8").split("\n").forEach((line, i) => {
        findings.push(...found(line).map((k) => `${path}:${i + 1}: ${k}`));
      });
    }
    assert.deepEqual(findings, []);
  });
});
