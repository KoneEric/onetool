import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The four words the public copy refuses, built from halves so that this file does not hold them.
const WORDS = [["Er", "ic"], ["Ground", "Zero"], ["fact", "ory"], ["ME", "ETS"]].map((halves) => halves.join(""));

// The word exactly so written, neither preceded nor followed by an ASCII letter, a digit or `_`.
const wordPattern = (word) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`);

const testDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(testDir);

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function hits(text) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    for (const word of WORDS) if (wordPattern(word).test(line)) found.push({ line: i + 1, word });
  });
  return found;
}

test("a word is the word exactly so written, not part of a longer name", () => {
  const [eric, , , meets] = WORDS;
  assert.equal(wordPattern(eric).test(`a ${eric} b`), true);
  assert.equal(wordPattern(meets).test(`${meets}.md`), true);
  assert.equal(wordPattern(eric).test(`Kone${eric}`), false);
  assert.equal(wordPattern(eric).test(`${eric}s`), false);
  assert.equal(wordPattern(eric).test(`${eric}_x`), false);
  assert.equal(wordPattern(eric).test(`${eric}9`), false);
  assert.equal(wordPattern(meets).test(meets.toLowerCase()), false);
});

test("no file under sandbox/src or sandbox/test holds one of the four words", () => {
  const files = [...filesUnder(join(root, "src")), ...filesUnder(join(root, "test"))];
  assert.ok(files.length > 0);
  const problems = [];
  for (const file of files) {
    for (const { line, word } of hits(readFileSync(file, "utf8"))) {
      problems.push(`${relative(dirname(root), file)}:${line} holds ${word}`);
    }
  }
  assert.deepEqual(problems, []);
});
