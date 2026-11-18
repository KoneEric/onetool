// The saved programs of onetool: names, the file of a program, whether a save is taken, the library
// folders on disk with their counts of uses and their archive. See the meeting point of library.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const CANNOT_WRITE = "the library cannot be written";
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const PARAM = /^[A-Za-z_$][A-Za-z0-9_$]{0,39}$/;
const MAX_FILE_BYTES = 200000;

export class LibraryError extends Error {
  constructor(message) {
    super(message);
    this.name = "LibraryError";
  }
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- names and the arguments of a save ----------------------------------------------------------------

export function isProgramName(name) {
  return typeof name === "string" && NAME.test(name);
}

const SAVE_PROBLEMS = [
  "library.save failed: it takes a name and { about, params, code }",
  "library.save failed: the name must be 1 to 40 letters, digits or _, starting with a letter",
  'library.save failed: "about" must be one sentence on one line, at most 200 characters',
  'library.save failed: "params" must be a list of at most 20 argument names, each once',
  'library.save failed: "code" must be the text of the program, at most 100000 characters',
  'library.save failed: "replace" must be true or false',
];

function checkParams(params) {
  if (!Array.isArray(params) || params.length > 20) return false;
  for (const param of params) if (typeof param !== "string" || !PARAM.test(param)) return false;
  return new Set(params).size === params.length;
}

export function checkSave(args) {
  try {
    if (!isPlainObject(args)) return { problem: SAVE_PROBLEMS[0] };
    const { name, about, params, code, replace } = args;
    if (!isProgramName(name)) return { problem: SAVE_PROBLEMS[1] };
    const sentence = typeof about === "string" ? about.trim() : "";
    if (sentence === "" || sentence.length > 200 || /[\n\r]/.test(sentence)) return { problem: SAVE_PROBLEMS[2] };
    if (params !== undefined && !checkParams(params)) return { problem: SAVE_PROBLEMS[3] };
    if (typeof code !== "string" || code.length > 100000 || code.trim() === "") return { problem: SAVE_PROBLEMS[4] };
    if (replace !== undefined && replace !== true && replace !== false) return { problem: SAVE_PROBLEMS[5] };
    return { program: { name, about: sentence, params: params === undefined ? [] : [...params], code }, replace: replace === true };
  } catch {
    return { problem: SAVE_PROBLEMS[0] };
  }
}

// ---- the tools a text calls, in order -----------------------------------------------------------------

const BEFORE_WORD = /[\p{L}\p{N}_$.]/u;
const MEMBER = String.raw`(?:\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)|\s*\[\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*\])`;
const PLACE = new RegExp(String.raw`tools${MEMBER}${MEMBER}`, "y");
// the match of PLACE has one group per form, per member: server 1..3, tool 4..6
const pick = (m, from) => m[from] ?? m[from + 1] ?? m[from + 2];

export function callSequence(code) {
  const sequence = [];
  if (typeof code !== "string") return sequence;
  let at = code.indexOf("tools");
  while (at !== -1) {
    let next = at + 5;
    if (at === 0 || !BEFORE_WORD.test(lastChar(code, at))) {
      PLACE.lastIndex = at;
      const m = PLACE.exec(code);
      if (m) {
        sequence.push(`${pick(m, 1)}.${pick(m, 4)}`);
        next = PLACE.lastIndex;
      }
    }
    at = code.indexOf("tools", next);
  }
  return sequence;
}

// the character (a whole code point) that ends right before `at`
function lastChar(text, at) {
  const low = text.charCodeAt(at - 1);
  if (low >= 0xdc00 && low <= 0xdfff && at >= 2) {
    const high = text.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at);
  }
  return text[at - 1];
}

const sameSequence = (a, b) => a.length > 0 && a.length === b.length && a.every((id, i) => id === b[i]);

// ---- whether a save is taken --------------------------------------------------------------------------

function leastUsed(saved) {
  const order = (p) => (p.lastUse === null ? -Infinity : p.lastUse);
  return [...saved]
    .sort((a, b) => a.uses - b.uses || (order(a) === order(b) ? 0 : order(a) < order(b) ? -1 : 1) || byString(a.name, b.name))
    .slice(0, 3)
    .map((p) => p.name);
}

export function saveDecision(saved, program, { replace = false, cap = 50 } = {}) {
  const { name } = program;
  if (saved.some((p) => p.name === name)) {
    return replace
      ? { save: true, replaces: name }
      : { save: false, problem: `library.save failed: a program named ${name} is saved already; replace: true updates it` };
  }
  const lower = name.toLowerCase();
  const twin = saved.find((p) => p.name.toLowerCase() === lower);
  if (twin) {
    return { save: false, problem: `library.save failed: the name ${name} differs from the saved program ${twin.name} only by case` };
  }
  const wanted = callSequence(program.code);
  const like = saved.find((p) => sameSequence(callSequence(p.code), wanted));
  if (like) {
    return replace
      ? { save: true, replaces: like.name }
      : {
          save: false,
          problem: `library.save failed: lib.${like.name} calls the same tools in the same order: call it, or save with replace: true to put this program in its place`,
        };
  }
  if (saved.length >= cap) {
    return {
      save: false,
      problem: `library.save failed: the library holds ${saved.length} programs, the limit is ${cap} (onetool.libraryCap). The least used: ${leastUsed(saved).join(", ")}. Remove one with library.remove(name), or replace one.`,
    };
  }
  return { save: true, replaces: null };
}

export function logArgs(tool, args) {
  if (!isPlainObject(args)) return null;
  const name = typeof args.name === "string" ? args.name : null;
  if (tool === "save") {
    return { name, codeSize: typeof args.code === "string" ? args.code.length : null, replace: args.replace === true };
  }
  if (tool === "remove" || tool === "restore" || tool === "read") return { name };
  if (tool === "report") return {};
  return null;
}

// ---- the file of a program ----------------------------------------------------------------------------

export function formatProgram({ about, params, code }) {
  const list = params.join(", ");
  return `// about: ${about}\n// params:${list === "" ? "" : " " + list}\n${code}${code.endsWith("\n") ? "" : "\n"}`;
}

export function parseProgram(text) {
  if (typeof text !== "string") return null;
  const lines = text.split("\n");
  if (lines.length < 3) return null;
  const first = lines[0].trim();
  const second = lines[1].trim();
  if (!first.startsWith("// about:") || !second.startsWith("// params:")) return null;
  const about = first.slice("// about:".length).trim();
  if (about === "") return null;
  const params = second
    .slice("// params:".length)
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");
  if (!checkParams(params)) return null;
  const code = lines.slice(2).join("\n");
  if (code.trim() === "") return null;
  return { about, params, code };
}

// ---- the library folders ------------------------------------------------------------------------------

export function archiveFolder(folder) {
  return join(dirname(folder), "archive");
}

export function joinLibraries(project, user) {
  const taken = new Set(project.map((p) => p.name));
  const joined = [
    ...project.map((p) => ({ ...p, where: "project" })),
    ...user.filter((p) => !taken.has(p.name)).map((p) => ({ ...p, where: "user" })),
  ];
  return joined.sort((a, b) => byString(a.name, b.name));
}

const statsPath = (folder) => join(folder, "stats.json");

const wholeNumber = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

// The counts of stats.json as a Map of name -> { uses, lastUse (ms or null), failures }; only the keys
// whose entry is an object. A stats.json that cannot be read or is not an object gives an empty Map.
async function readStats(folder) {
  const stats = new Map();
  let parsed;
  try {
    parsed = JSON.parse(await readFile(statsPath(folder), "utf8"));
  } catch {
    return stats;
  }
  if (!isPlainObject(parsed)) return stats;
  for (const name of Object.keys(parsed)) {
    const entry = parsed[name];
    if (!isPlainObject(entry)) continue;
    const at = typeof entry.lastUse === "string" ? Date.parse(entry.lastUse) : NaN;
    stats.set(name, { uses: wholeNumber(entry.uses), lastUse: Number.isNaN(at) ? null : at, failures: wholeNumber(entry.failures) });
  }
  return stats;
}

const emptyCounts = () => ({ uses: 0, lastUse: null, failures: 0 });

// Writes the Map as stats.json, keys by name; the file is made beside it and moved into place.
async function writeStats(folder, stats) {
  const out = {};
  for (const name of [...stats.keys()].sort()) {
    const { uses, lastUse, failures } = stats.get(name);
    out[name] = { uses, lastUse: lastUse === null ? null : new Date(lastUse).toISOString(), failures };
  }
  await writeFileInPlace(statsPath(folder), `${JSON.stringify(out, null, 2)}\n`);
}

async function writeFileInPlace(path, text) {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function readLibrary(folder) {
  let entries;
  try {
    entries = (await readdir(folder)).filter((entry) => entry.endsWith(".js")).sort();
  } catch {
    return { programs: [], bad: [] };
  }
  const stats = await readStats(folder);
  const programs = [];
  const bad = [];
  for (const entry of entries) {
    const path = join(folder, entry);
    const name = entry.slice(0, -".js".length);
    const parsed = isProgramName(name) ? await readProgramFile(path) : null;
    if (parsed === null) {
      bad.push(path);
      continue;
    }
    programs.push({ name, ...parsed, ...(stats.get(name) ?? emptyCounts()) });
  }
  return { programs, bad };
}

async function readProgramFile(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    return parseProgram(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function cannotWrite() {
  return new LibraryError(CANNOT_WRITE);
}

// Moves <folder>/<name>.js to the archive. Resolves false when there is no such file, true when moved.
async function archiveFile(folder, name, now) {
  const from = join(folder, `${name}.js`);
  if (!(await isFile(from))) return false;
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const archive = archiveFolder(folder);
  try {
    await mkdir(archive, { recursive: true });
    await rename(from, join(archive, `${name}.${stamp}.js`));
  } catch {
    throw cannotWrite();
  }
  return true;
}

export async function saveProgram(folder, program, { replaces = null, now = Date.now() } = {}) {
  const { name } = program;
  try {
    await mkdir(folder, { recursive: true });
  } catch {
    throw cannotWrite();
  }
  const stats = await readStats(folder);
  let carried = emptyCounts();
  if (typeof replaces === "string" && isProgramName(replaces)) {
    if (await archiveFile(folder, replaces, now)) {
      const had = stats.get(replaces);
      if (had) carried = { uses: had.uses, lastUse: had.lastUse, failures: 0 };
    }
  }
  try {
    await writeFileInPlace(join(folder, `${name}.js`), formatProgram(program));
  } catch {
    throw cannotWrite();
  }
  if (typeof replaces === "string" && replaces !== name) stats.delete(replaces);
  stats.set(name, { ...carried, failures: 0 });
  try {
    await writeStats(folder, stats);
  } catch {
    throw cannotWrite();
  }
}

export async function removeProgram(folder, name, { now = Date.now() } = {}) {
  if (!isProgramName(name)) return false;
  if (!(await archiveFile(folder, name, now))) return false;
  const stats = await readStats(folder);
  if (stats.delete(name)) {
    try {
      await writeStats(folder, stats);
    } catch {
      throw cannotWrite();
    }
  }
  return true;
}

export async function noteUses(folder, uses, { now = Date.now(), failuresLimit = 5 } = {}) {
  try {
    if (uses.length === 0 || !(await stat(folder)).isDirectory()) return [];
    const stats = await readStats(folder);
    const touched = new Set();
    for (const { name, ok } of uses) {
      if (!isProgramName(name) || !(await isFile(join(folder, `${name}.js`)))) continue;
      const counts = stats.get(name) ?? emptyCounts();
      counts.uses += 1;
      counts.lastUse = now;
      counts.failures = ok ? 0 : counts.failures + 1;
      stats.set(name, counts);
      touched.add(name);
    }
    if (touched.size === 0) return [];
    for (const name of [...stats.keys()]) {
      if (!touched.has(name) && !(isProgramName(name) && (await isFile(join(folder, `${name}.js`))))) stats.delete(name);
    }
    const moved = [];
    for (const name of [...touched].sort()) {
      if (stats.get(name).failures < failuresLimit) continue;
      try {
        if (await archiveFile(folder, name, now)) {
          moved.push(name);
          stats.delete(name);
        }
      } catch {
        // the file stays, and so does its entry
      }
    }
    try {
      await writeStats(folder, stats);
    } catch {
      // the counts are left undone
    }
    return moved;
  } catch {
    return [];
  }
}

// ---- bringing an archived program back ----------------------------------------------------------------

const RESTORE_NAME = "library.restore failed: the name must be 1 to 40 letters, digits or _, starting with a letter";
const STAMP_JS = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.js$/;

// The entries of the archive that are archived files of `name`, by file name (the greatest is the newest).
async function archivedFilesOf(folder, name) {
  let entries;
  try {
    entries = await readdir(archiveFolder(folder));
  } catch {
    return [];
  }
  const head = `${name}.`;
  return entries.filter((entry) => entry.startsWith(head) && STAMP_JS.test(entry.slice(head.length))).sort();
}

export async function restoreProgram(folder, name, { cap = 50 } = {}) {
  const refused = (missing, problem) => ({ restored: false, missing, problem });
  if (!isProgramName(name)) return refused(false, RESTORE_NAME);
  const files = await archivedFilesOf(folder, name);
  if (files.length === 0) return refused(true, `library.restore failed: no program named ${name} is in the archive`);
  const { programs } = await readLibrary(folder);
  if (programs.some((p) => p.name === name)) {
    return refused(false, `library.restore failed: a program named ${name} is saved already: remove it first`);
  }
  const lower = name.toLowerCase();
  const twin = programs.find((p) => p.name.toLowerCase() === lower);
  if (twin) return refused(false, `library.restore failed: the name ${name} differs from the saved program ${twin.name} only by case`);
  if (programs.length >= cap) {
    return refused(
      false,
      `library.restore failed: the library holds ${programs.length} programs, the limit is ${cap} (onetool.libraryCap). Remove one with library.remove(name) first.`,
    );
  }
  const file = files[files.length - 1];
  const from = join(archiveFolder(folder), file);
  if ((await readProgramFile(from)) === null) {
    return refused(false, `library.restore failed: the archived file of ${name} is not a saved program`);
  }
  try {
    await mkdir(folder, { recursive: true });
    // the program comes back with no count: an entry left in stats.json for the name goes
    const stats = await readStats(folder);
    if (stats.delete(name)) await writeStats(folder, stats);
    await rename(from, join(folder, `${name}.js`));
  } catch {
    throw cannotWrite();
  }
  return { restored: true, file };
}

// ---- the lines of the sequences -----------------------------------------------------------------------

export function sequenceLine(sequence, { time, session }) {
  return JSON.stringify({ time: new Date(time).toISOString(), session, sequence: [...sequence] });
}

const isSequence = (value) => Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string");

export function readSequences(text) {
  const found = [];
  if (typeof text !== "string") return found;
  for (const line of text.split("\n")) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isPlainObject(parsed) && isSequence(parsed.sequence)) found.push([...parsed.sequence]);
  }
  return found;
}

// ---- the text of the report ---------------------------------------------------------------------------

const DAY_MS = 86400000;
const LINE_MAX = 120;
const LINES_SHOWN = 8;
const NAMES_SHOWN = 20;

const cutLine = (line) => (line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 3)}...` : line);

// At most 8 lines, then one line for the others.
const shownLines = (lines) =>
  lines.length > LINES_SHOWN ? [...lines.slice(0, LINES_SHOWN), `(${lines.length - LINES_SHOWN} more not shown)`] : lines;

function pairLines(programs) {
  const tools = programs.map((p) => [...new Set(callSequence(p.code))]);
  const pairs = [];
  for (let i = 0; i < programs.length; i++) {
    if (tools[i].length === 0) continue;
    for (let j = i + 1; j < programs.length; j++) {
      if (tools[j].length === 0) continue;
      const shared = tools[i].filter((id) => tools[j].includes(id));
      const all = tools[i].length + tools[j].length - shared.length;
      if (shared.length * 2 >= all) pairs.push({ a: programs[i].name, b: programs[j].name, shared, all });
    }
  }
  pairs.sort((p, q) => q.shared.length * p.all - p.shared.length * q.all || q.shared.length - p.shared.length);
  return shownLines(
    pairs.map(({ a, b, shared, all }) => cutLine(`lib.${a} and lib.${b}: ${shared.length} of ${all} tools (${shared.join(", ")})`)),
  );
}

function unusedLine(programs, now, unusedDays) {
  const names = programs
    .filter((p) => typeof p.lastUse === "number" && now - p.lastUse > unusedDays * DAY_MS)
    .sort((a, b) => a.lastUse - b.lastUse || byString(a.name, b.name))
    .map((p) => `lib.${p.name}`);
  if (names.length === 0) return "(none)";
  if (names.length <= NAMES_SHOWN) return names.join(", ");
  return `${names.slice(0, NAMES_SHOWN).join(", ")}, and ${names.length - NAMES_SHOWN} more`;
}

function sequenceLines(programs, sequences, times) {
  const saved = new Set(programs.map((p) => JSON.stringify(callSequence(p.code))));
  const counts = new Map();
  for (const sequence of Array.isArray(sequences) ? sequences : []) {
    if (!isSequence(sequence)) continue;
    const key = JSON.stringify(sequence);
    if (saved.has(key)) continue;
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { count: 1, text: sequence.join(" > ") });
  }
  const named = [...counts.values()].filter((s) => s.count >= times);
  named.sort((a, b) => b.count - a.count || byString(a.text, b.text));
  return shownLines(named.map(({ count, text }) => cutLine(`${count} times: ${text}`)));
}

const programLine = (p) =>
  `lib.${p.name} (${p.where}): ${p.uses} uses, ${p.failures} failures, ${p.lastUse === null ? "never" : new Date(p.lastUse).toISOString().slice(0, 10)}`;

export function reportText(programs, { sequences = [], log = true, now = Date.now(), unusedDays = 30, times = 3, limit = 6000 } = {}) {
  const n = programs.length;
  const byUse = (p) => (p.lastUse === null ? -Infinity : p.lastUse);
  const ordered = [...programs].sort((a, b) => a.uses - b.uses || (byUse(a) === byUse(b) ? 0 : byUse(a) < byUse(b) ? -1 : 1) || byString(a.name, b.name));
  const programLines = ordered.map(programLine);
  const rest = [
    "--- programs that share most of their tools ---",
    ...orNone(pairLines(programs)),
    `--- not used for ${String(unusedDays)} days ---`,
    unusedLine(programs, now, unusedDays),
    `--- sequences of calls run ${times} times or more and not saved ---`,
    ...(log ? orNone(sequenceLines(programs, sequences, times)) : ["(the log is switched off: no sequence is counted)"]),
  ];
  const textWith = (k) =>
    [
      `Library report: ${n} programs`,
      "--- programs: uses, failures in a row, last use ---",
      ...(n === 0 ? ["(none)"] : [...programLines.slice(0, k), ...(k < n ? [`(${n - k} more not shown)`] : [])]),
      ...rest,
    ].join("\n");
  for (let k = n; k > 0; k--) {
    const text = textWith(k);
    if (text.length <= limit) return text;
  }
  return textWith(0).slice(0, limit);
}

const orNone = (lines) => (lines.length === 0 ? ["(none)"] : lines);
