// Helpers of the tests of "Step 8: tidying the library" (the meeting point of server): the report as lines, the sequences file read and
// written by hand, an archive made by hand, and the texts that part `library` fixes (the meeting point of library "Step 8").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { programText } from "./libhelpers.js";

/** The program of the text of "Tidying, through the real thing": `REPORT`. */
export const REPORT = "await library.report()";

/** The stamp of an archived file, the meeting point of library "What a library folder holds": `<name>.<stamp>.js`. */
export const STAMP = "2026-11-18T10-00-00-000Z";

/** `SQ` of a world: the sequences file, beside the user's library (the meeting point of server "Words"). */
export const sequencesOf = (w) => join(w.H, ".onetool", "sequences.jsonl");

/** The text of the sequences file; `null` when it is not there. */
export const sequencesText = (w) => (existsSync(sequencesOf(w)) ? readFileSync(sequencesOf(w), "utf8") : null);

/** The lines of the sequences file as parsed objects (`[]` when there is no file). */
export const sequenceObjects = (w) =>
  (sequencesText(w) ?? "")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

/** One line of the sequences file as the meeting point of library "`sequenceLine`" gives it (no line break): written by hand. */
export const sequenceLineOf = (sequence, time = "2026-11-18T10:00:00.000Z", session = "s1") =>
  `{"time":"${time}","session":"${session}","sequence":${JSON.stringify(sequence)}}`;

/** Writes the sequences file by hand (the folders above it are made). */
export function putSequences(w, text) {
  mkdirSync(join(w.H, ".onetool"), { recursive: true });
  writeFileSync(sequencesOf(w), text, "utf8");
}

/** Writes an archived file of `name` by hand in `archive`: `<name>.<stamp>.js` holding the file of `program`. */
export function putArchived(archive, name, program, stamp = STAMP) {
  mkdirSync(archive, { recursive: true });
  writeFileSync(join(archive, `${name}.${stamp}.js`), programText(program), "utf8");
}

/** The answer of a run as `{ report, trail }`: the lines before `--- calls ---` and the lines after it (`null` when none). */
export function splitReport(text) {
  const lines = text.split("\n");
  const at = lines.indexOf("--- calls ---");
  return at < 0 ? { report: lines, trail: null } : { report: lines.slice(0, at), trail: lines.slice(at + 1) };
}

// the meeting point of library "`reportText`": the headers, in their order
export const H_PROGRAMS = "--- programs: uses, failures in a row, last use ---";
export const H_PAIRS = "--- programs that share most of their tools ---";
export const H_UNUSED = "--- not used for 30 days ---";
export const H_SEQUENCES = "--- sequences of calls run 3 times or more and not saved ---";
export const LOG_OFF = "(the log is switched off: no sequence is counted)";

/** The report of an empty library, as the meeting point of library gives it: nine lines, the last line being `last`. */
export const emptyReport = (last = "(none)") => [
  "Library report: 0 programs",
  H_PROGRAMS,
  "(none)",
  H_PAIRS,
  "(none)",
  H_UNUSED,
  "(none)",
  H_SEQUENCES,
  last,
];

/** The first ten characters of the ISO text of the time `days` days before `now`. */
export const dayOf = (now, days = 0) => new Date(now - days * 86400000).toISOString().slice(0, 10);
/** The ISO text of the time `days` days before `now`: what `toISOString` writes, as `stats.json` holds it. */
export const isoOf = (now, days = 0) => new Date(now - days * 86400000).toISOString();

/** A program as `JSON.stringify(<its read>)` is parsed back: for `library.read`, whose text has many lines. */
export const READ_AS_JSON = (name) => `JSON.stringify(await library.read(${JSON.stringify(name)}))`;

// the messages of part `library` and of onetool that the three calls give
export const BAD_NAME_OF = (tool) => `library.${tool} failed: the name must be 1 to 40 letters, digits or _, starting with a letter`;
export const NOT_IN_ARCHIVE = (name) => `library.restore failed: no program named ${name} is in the archive`;
export const SAVED_ALREADY_RESTORE = (name) => `library.restore failed: a program named ${name} is saved already: remove it first`;
export const NO_SUCH_READ = (name) => `library.read failed: no program named ${name} is saved`;
export const RESTORE_CAP = (n, cap) =>
  `library.restore failed: the library holds ${n} programs, the limit is ${cap} (onetool.libraryCap). Remove one with library.remove(name) first.`;
export const backIn = (name, where) => `lib.${name} is back in the ${where} library.`;

/** The question the person reads, the meeting point of core "`askMessage`" as the older tests of this part hold it. */
export const questionOf = (id, rule, args) =>
  [
    `onetool: a program wants to call ${id}.`,
    `Arguments: ${JSON.stringify(args)}`,
    `The rule ask "${rule}" asks for your consent. Allow this call?`,
  ].join("\n");
