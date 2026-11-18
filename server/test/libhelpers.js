// Helpers of the tests of "Step 7: the library" (the meeting point of server): the folders a test makes (HOME, a project, the log),
// saved programs written by hand as a person would, the stats file read back, and the texts that other parts fix
// (the meeting point of library "The file of a program", the meeting point of core "Step 7: the texts of the library").
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceEntry, settingsOf, tmpDir, withOnetool } from "./helpers.js";

/** The two lines of the code of the program `cityCount` of the text of "The library, through the real thing". */
export const COUNT = "const { rows } = await tools.practice.rows({});\nrows.filter((row) => row.city === city).length";

/**
 * The folders of one test: `H` the home, `W` a project, `L` the log. `UL`, `UA` are the user's library and its archive,
 * `PL`, `PA` the project's. Nothing is made beside the three folders.
 */
export function world() {
  const H = tmpDir();
  const W = tmpDir();
  const L = tmpDir();
  return {
    H,
    W,
    L,
    UL: join(H, ".onetool", "library"),
    UA: join(H, ".onetool", "archive"),
    PL: join(W, ".onetool", "library"),
    PA: join(W, ".onetool", "archive"),
  };
}

/** The file of a program, the meeting point of library "The file of a program": `formatProgram({ about, params, code })`. */
export const programText = ({ about, params = [], code }) =>
  `// about: ${about}\n// params:${params.length > 0 ? ` ${params.join(", ")}` : ""}\n${code}${code.endsWith("\n") ? "" : "\n"}`;

/** Writes the file of a program by hand, in `folder` (made when it is not there). */
export function putProgram(folder, name, program) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.js`), programText(program), "utf8");
}

/** Writes a file of any text in `folder` (made when it is not there): a file that is not a program, for instance. */
export function putRaw(folder, file, text) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, file), text, "utf8");
}

/** Writes `stats.json` of `folder` by hand: `{ name: { uses, lastUse, failures } }`. */
export function putStats(folder, stats) {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "stats.json"), JSON.stringify(stats), "utf8");
}

/** `stats.json` of `folder` read as JSON; `null` when it is not there. */
export function statsOf(folder) {
  const file = join(folder, "stats.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The sorted names in `folder`; `[]` when it is not there. */
export const names = (folder) => (existsSync(folder) ? readdirSync(folder).sort() : []);

/** The text of the file `name` of `folder`. */
export const fileIn = (folder, name) => readFileSync(join(folder, name), "utf8");

/** The archived files of `archive` for the program `name`: `<name>.<stamp>.js` (the meeting point of library "What a library folder holds"). */
export const archivedOf = (archive, name) =>
  names(archive).filter((entry) => new RegExp(`^${name}\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z\\.js$`).test(entry));

// ---- the settings and the run -------------------------------------------------------------------------------------

/**
 * Settings: the practice server (and `servers`), the trail on, a time limit of 10 seconds, the log off; `onetool` holds
 * the other keys (a `logFolder` or `log` of its own, `shell`, `libraryCap`, rules...).
 */
export function libSettings(onetool = {}, servers = { practice: practiceEntry() }) {
  return settingsOf(servers, { trail: true, timeoutSeconds: 10, log: false, ...onetool });
}

/** The same with the shell on in the project folder `W`. */
export const projectSettings = (w, onetool = {}, servers) => libSettings({ shell: { folders: [w.W] }, ...onetool }, servers);

/** `withOnetool` with HOME the home `w.H` of the test. */
export const inLib = (w, settings, fn, options = {}) =>
  withOnetool(settings, fn, { ...options, env: { HOME: w.H, ...options.env } });

/** What a program that catches the rejection of `call` says: the message of the error, or `answered`. */
export const messageOf = (call) =>
  `try { await ${call}; return "answered"; } catch (e) { return e instanceof Error ? e.message : "not an Error"; }`;

/** The text of a failure of a program, the meeting point of core "`formatRun`". */
export const FAILED = (message) => `The program failed: Error: ${message}`;

/** The trail of an answer as its lines after `--- calls ---`; `null` when there is none. */
export function trailOf(text) {
  const at = text.indexOf("--- calls ---");
  return at < 0 ? null : text.slice(at).split("\n");
}

/** The line of a trail for `id` that ended well: `<id> <n> ms <size> chars`, as a pattern. */
export const okLine = (id, size = "\\d+") => new RegExp(`^${id.replace(/\./g, "\\.")} \\d+ ms ${size} chars$`);
/** The line of a trail for a call that did not end well, `<id> <n> ms <word>`. */
export const wordLine = (id, word) => new RegExp(`^${id.replace(/\./g, "\\.")} \\d+ ms ${word}$`);

// ---- the texts other parts fix -----------------------------------------------------------------------------------

// the meeting point of core "`libraryText(programs, { limit, most })`": the third piece, and the text of an empty library.
const TAIL = ". Call one as await lib.<name>(args); search finds them; library.save(name, { about, params, code }) keeps a new one.";
export const EMPTY_LIBRARY_TEXT = `Saved programs: 0${TAIL}`;

/**
 * `libraryText(programs)` with its defaults (limit 298, most 5), worked out by the rule of the meeting point of core: the names are
 * those of the programs sorted by `uses` falling, then by name; a name is shown while the whole text stays within the
 * limit; the first that does not fit ends the list.
 */
export function libraryText(programs, { limit = 298, most = 5 } = {}) {
  const head = `Saved programs: ${programs.length}`;
  const sorted = [...programs].sort((a, b) => b.uses - a.uses || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const shown = [];
  for (const one of sorted.slice(0, most)) {
    const text = `${head} (most used: ${[...shown, one.name].join(", ")})${TAIL}`;
    if (text.length > limit) break;
    shown.push(one.name);
  }
  return `${head}${shown.length > 0 ? ` (most used: ${shown.join(", ")})` : ""}${TAIL}`;
}

// the meeting point of core "`saveItNote(times)`, `sameAsNote(name)`, `archivedNote(name, failures)`"
export const SAVE_IT = (times) => `(this sequence of calls has run ${times} times: save it as a program with library.save)`;
export const SAME_AS = (name) => `(lib.${name} does this: call it)`;
export const ARCHIVED = (name, failures = 5) => `(lib.${name} failed ${failures} times in a row: it was moved to the archive)`;

// the meeting point of library "`checkSave(args)`" and "`saveDecision`"
export const BAD_NAME = "library.save failed: the name must be 1 to 40 letters, digits or _, starting with a letter";
export const BAD_ABOUT = 'library.save failed: "about" must be one sentence on one line, at most 200 characters';
export const BAD_PARAMS = 'library.save failed: "params" must be a list of at most 20 argument names, each once';
export const BAD_CODE = 'library.save failed: "code" must be the text of the program, at most 100000 characters';
export const BAD_REPLACE = 'library.save failed: "replace" must be true or false';
export const SAVED_ALREADY = (name) => `library.save failed: a program named ${name} is saved already; replace: true updates it`;
export const TWIN = (name, twin) => `library.save failed: the name ${name} differs from the saved program ${twin} only by case`;
export const SAME_TOOLS = (like) =>
  `library.save failed: lib.${like} calls the same tools in the same order: call it, or save with replace: true to put this program in its place`;
export const CAP = (n, cap, least) =>
  `library.save failed: the library holds ${n} programs, the limit is ${cap} (onetool.libraryCap). The least used: ${least}. Remove one with library.remove(name), or replace one.`;
export const BAD_REMOVE_NAME = "library.remove failed: the name must be 1 to 40 letters, digits or _, starting with a letter";
export const NOT_SAVED = (name) => `library.remove failed: no program named ${name} is saved`;
export const CANNOT_WRITE = "library.save failed: the library cannot be written";

export const savedIn = (name, where) => `lib.${name} is saved in the ${where} library.`;
export const savedReplacing = (name, where, replaces) => `lib.${name} is saved in the ${where} library; lib.${replaces} went to the archive.`;
export const removedFrom = (name, where) => `lib.${name} went to the archive of the ${where} library.`;

/** A program as `library.save` is called with it, as the text of a program (the code is quoted). */
export function saveCall(name, { about, params, code, replace }) {
  const parts = [`about: ${JSON.stringify(about)}`];
  if (params !== undefined) parts.push(`params: ${JSON.stringify(params)}`);
  parts.push(`code: ${JSON.stringify(code)}`);
  if (replace !== undefined) parts.push(`replace: ${replace}`);
  return `library.save(${JSON.stringify(name)}, { ${parts.join(", ")} })`;
}
