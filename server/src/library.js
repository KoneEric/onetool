// What onetool does with the library of saved programs: reading both folders, a save, a removal, the uses and the notes.
import { appendFile, mkdir, open } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { archivedNote, sameAsNote, saveItNote } from "../../core/src/index.js";
import {
  callSequence,
  formatProgram,
  joinLibraries,
  noteUses,
  readLibrary,
  readSequences,
  removeProgram,
  reportText,
  restoreProgram,
  saveDecision,
  saveProgram,
  sequenceLine,
} from "../../library/src/index.js";

const say = (line) => process.stderr.write(`${line}\n`);

const FAILURES = 5;
const SAVE_IT_AT = 3;

// the last bytes of the file of the sequences that the report reads
const SEQUENCES_READ = 2000000;

const folderIn = (base) => join(base, ".onetool", "library");

/**
 * The library of the process. `host` gives the folders in effect; `session` is the text of the lines of the log and
 * `failed()` tells, once, that a line cannot be written. Every reading and every writing is done in its turn, after the one
 * before it has ended, so that a reading never meets a half-written file.
 */
export function makeLibrary(settings, host, { session, failed }) {
  const userFolder = folderIn(os.homedir());
  const sequencesFile = join(dirname(userFolder), "sequences.jsonl");
  const toldBad = new Set();
  const sequences = new Map();
  let tail = Promise.resolve();

  /** `fn` runs after every work queued before it has ended; resolves or rejects as `fn` does. */
  function enqueue(fn) {
    const run = tail.then(fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  const projectFolder = () => {
    const folders = host.folders();
    return host.hasFolders() && folders.length > 0 ? folderIn(folders[0]) : null;
  };

  const told = (bad) => {
    for (const path of bad) {
      if (toldBad.has(path)) continue;
      toldBad.add(path);
      say(`onetool: library: ${path} is not a saved program, it is left out`);
    }
  };

  /** One folder read, its bad files told. */
  async function readFolder(folder) {
    if (folder === null) return [];
    const { programs, bad } = await readLibrary(folder);
    told(bad);
    return programs;
  }

  /** The library of the moment, and the project's folder it was read with (`null` when there is none). */
  const read = () =>
    enqueue(async () => {
      const project = projectFolder();
      const programs = joinLibraries(await readFolder(project), await readFolder(userFolder));
      return { programs, project, user: userFolder };
    });

  /** `library.save`: `program` and `replace` are what `checkSave` accepted. */
  const save = (program, replace) =>
    enqueue(async () => {
      const project = projectFolder();
      const target = project ?? userFolder;
      const saved = await readFolder(target);
      const decision = saveDecision(saved, program, { replace, cap: settings.libraryCap });
      if (!decision.save) throw new Error(decision.problem);
      await saveProgram(target, program, { replaces: decision.replaces });
      const place = project === null ? "user" : "project";
      return typeof decision.replaces === "string"
        ? `lib.${program.name} is saved in the ${place} library; lib.${decision.replaces} went to the archive.`
        : `lib.${program.name} is saved in the ${place} library.`;
    });

  /** `library.remove`: the project's library first, then the user's. */
  const remove = (name) =>
    enqueue(async () => {
      const project = projectFolder();
      if (project !== null && (await removeProgram(project, name))) return `lib.${name} went to the archive of the project library.`;
      if (await removeProgram(userFolder, name)) return `lib.${name} went to the archive of the user library.`;
      throw new Error(`library.remove failed: no program named ${name} is saved`);
    });

  /** `library.read`: the text of the file of a saved program, as onetool would write it. */
  const readProgram = (name) =>
    enqueue(async () => {
      const project = projectFolder();
      const programs = joinLibraries(await readFolder(project), await readFolder(userFolder));
      const found = programs.find((program) => program.name === name);
      if (found === undefined) throw new Error(`library.read failed: no program named ${name} is saved`);
      return formatProgram({ about: found.about, params: found.params, code: found.code });
    });

  /** The sequences of the file, the last 2,000,000 bytes of it at most; none when there is no log or no readable file. */
  async function readSequencesFile() {
    let handle;
    try {
      handle = await open(sequencesFile, "r");
      const { size } = await handle.stat();
      const length = Math.min(size, SEQUENCES_READ);
      const buffer = Buffer.alloc(length);
      let done = 0;
      while (done < length) {
        const { bytesRead } = await handle.read(buffer, done, length - done, size - length + done);
        if (bytesRead === 0) break;
        done += bytesRead;
      }
      return readSequences(buffer.toString("utf8", 0, done));
    } catch {
      return [];
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  /** `library.report`: the account of the library of the moment. */
  const report = () =>
    enqueue(async () => {
      const project = projectFolder();
      const programs = joinLibraries(await readFolder(project), await readFolder(userFolder));
      const sequences = settings.log ? await readSequencesFile() : [];
      return reportText(programs, { sequences, log: settings.log });
    });

  /** `library.restore`: the project's archive first, then the user's; the last result asked for decides. */
  const restore = (name) =>
    enqueue(async () => {
      const cap = settings.libraryCap;
      const project = projectFolder();
      let where = "project";
      let result = project === null ? { restored: false, missing: true } : await restoreProgram(project, name, { cap });
      if (project === null || (!result.restored && result.missing)) {
        where = "user";
        result = await restoreProgram(userFolder, name, { cap });
      }
      if (!result.restored) throw new Error(result.problem);
      return `lib.${name} is back in the ${where} library.`;
    });

  /** One line of the sequences, appended whole; the folder is made at the first. */
  async function writeSequence(sequence) {
    try {
      const line = `${sequenceLine(sequence, { time: Date.now(), session })}\n`;
      await mkdir(dirname(sequencesFile), { recursive: true });
      await appendFile(sequencesFile, line);
    } catch {
      failed();
    }
  }

  /**
   * The program's result is there: counts its uses and its sequence. `library` is what `read()` gave when it started,
   * `uses` the `{ name, ok }` it was handed, `ok` whether the program ended well. Gives the notes of its trail.
   */
  async function finish({ library, uses, code, ok }) {
    const notes = [];
    if (uses.length > 0) {
      const byName = new Map(library.programs.map((program) => [program.name, program.where]));
      const forProject = uses.filter((use) => byName.get(use.name) === "project");
      const forUser = uses.filter((use) => byName.get(use.name) === "user");
      const moved = [];
      if (forProject.length > 0 && library.project !== null) {
        moved.push(...(await enqueue(() => noteUses(library.project, forProject, { failuresLimit: FAILURES }))));
      }
      if (forUser.length > 0) moved.push(...(await enqueue(() => noteUses(library.user, forUser, { failuresLimit: FAILURES }))));
      for (const name of moved) notes.push(archivedNote(name, FAILURES));
    }
    const sequence = callSequence(code);
    if (sequence.length > 0) {
      const same = (other) => other.length === sequence.length && other.every((id, at) => id === sequence[at]);
      const twin = library.programs.find((program) => same(callSequence(program.code)));
      if (twin !== undefined) notes.push(sameAsNote(twin.name));
      else if (ok) {
        const key = JSON.stringify(sequence);
        const times = (sequences.get(key) ?? 0) + 1;
        sequences.set(key, times);
        if (settings.log) await enqueue(() => writeSequence(sequence));
        if (times === SAVE_IT_AT) notes.push(saveItNote(SAVE_IT_AT));
      }
    }
    return notes;
  }

  return { read, save, remove, report, restore, readProgram, finish };
}
