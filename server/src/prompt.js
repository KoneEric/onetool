// The prompt `tidy-library`: fixed texts, the same whatever the settings and the library hold.

export const TIDY_NAME = "tidy-library";

export const TIDY_DESCRIPTION = "Tidy the library of saved programs: merge the ones that repeat, retire the ones not used, and rename the unclear.";

export const TIDY_TEXT = [
  "Tidy the library of saved programs, with the person.",
  "1. Run a program that returns `await library.report()`. It tells, for each saved program, its uses, its failures and its last use, the programs that share most of their tools, the programs not used for a long time, and the sequences of calls that ran again and again without being saved.",
  "2. Open, with `library.read(name)`, only the programs worth comparing: those of a pair, those not used, those that fail. Do not read the others.",
  "3. Propose to the person what to merge, retire, rename or save, with the reason of each. Do not apply any of it yet.",
  "Change nothing before the person says yes.",
  "4. When the person says yes, apply what they accepted, and only that: `library.save` to save a program, with `replace: true` to put it in the place of another, and `library.remove` to retire one.",
  "5. Say that what was replaced or removed is in the archive, and that `library.restore(name)` brings it back.",
].join("\n");
