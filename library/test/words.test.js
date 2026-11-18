import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The four words, built from halves so that this file does not hold them itself.
const WORDS = [["Er", "ic"], ["Ground", "Zero"], ["fact", "ory"], ["ME", "ETS"]].map((halves) => halves.join(""));

// A word counts only when neither preceded nor followed by an ASCII letter, a digit or `_`.
const wordIn = (word, line) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`).test(line);

const PART = join(import.meta.dirname, "..");

function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

test("the matcher: the word exactly so written, not inside a longer word", () => {
  const [eric, , third, meets] = WORDS;
  assert.ok(wordIn(meets, `See library/${meets}.md.`));
  assert.ok(wordIn(meets, `(${meets})`));
  assert.ok(wordIn(third, `the ${third}`));
  assert.ok(wordIn(eric, eric));
  assert.ok(!wordIn(eric, `Kone${eric}`));
  assert.ok(!wordIn(eric, `${eric}s`));
  assert.ok(!wordIn(meets, `_${meets}_`));
  assert.ok(!wordIn(meets, meets.toLowerCase()));
  assert.ok(!wordIn(third, `${third}9`));
});

test("no file under library/src or library/test holds one of the four words", () => {
  const files = [...filesUnder(join(PART, "src")), ...filesUnder(join(PART, "test"))];
  assert.ok(files.length > 0);
  const hits = [];
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r\n|\r|\n/).forEach((line, i) => {
      for (const word of WORDS) if (wordIn(word, line)) hits.push(`${file}:${i + 1} holds ${word}`);
    });
  }
  assert.deepEqual(hits, []);
});
