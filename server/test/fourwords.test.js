// Step 9: the public copy takes every file under bin/, server/src/ and server/test/ as it is, and refuses a file that
// holds one of four words. This test reads every file of those folders, at any depth, as UTF-8 text, and fails naming
// the file and the line that holds a word. The words are built from halves, so that this file does not hold them.
// It reads nothing outside those three folders: it must pass in a copy that has no steps, no pieces and no release.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..");
const FOLDERS = ["bin", join("server", "src"), join("server", "test")];
const WORDS = [["Er", "ic"], ["Ground", "Zero"], ["fact", "ory"], ["ME", "ETS"]].map((halves) => halves.join(""));

// The word exactly so written, neither preceded nor followed by an ASCII letter, a digit or `_`.
const wordRegex = (word) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`);
const MATCHERS = WORDS.map((word) => [word, wordRegex(word)]);
const wordsOf = (line) => MATCHERS.filter(([, regex]) => regex.test(line)).map(([word]) => word);

const filesUnder = (folder) =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });

describe("the four words no file of the part holds", () => {
  test("no file under bin/, server/src/ or server/test/ holds one of them, at any line", () => {
    const found = [];
    let files = 0;
    for (const folder of FOLDERS) {
      for (const path of filesUnder(join(ROOT, folder))) {
        files += 1;
        readFileSync(path, "utf8")
          .split(/\r\n|\n|\r/)
          .forEach((line, index) => {
            for (const word of wordsOf(line)) found.push(`${relative(ROOT, path)}:${index + 1}: ${word}`);
          });
      }
    }
    assert.ok(files > 40, `the three folders were read (${files} files)`);
    assert.deepEqual(found, [], `files that hold one of the four words:\n${found.join("\n")}`);
  });

  test("the match is the word exactly so written: not inside a longer word, but a file name holds it", () => {
    const [name, group, built, meets] = WORDS;
    assert.deepEqual(wordsOf(`see ${meets}.md`), [meets]);
    assert.deepEqual(wordsOf(`(${meets})`), [meets]);
    assert.deepEqual(wordsOf(`${meets.toLowerCase()} and Kone${name} and ${name}2 and _${built}`), []);
    assert.deepEqual(wordsOf(`${group}x ${built}s x${group}`), []);
    assert.deepEqual(wordsOf(`${name}, ${group}; ${built}`), [name, group, built]);
  });
});
