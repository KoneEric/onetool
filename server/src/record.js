// The record of every call: one record per call a program makes, the trail at the end of an answer, the log file.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { callSize, formatTrail, logFileName, logLine, shellLogArgs } from "../../core/src/index.js";
import { logArgs } from "../../library/src/index.js";

const DEFAULT_FOLDER = fileURLToPath(new URL("../../logs", import.meta.url));
const FAULT_LIMIT = 500;

/** An `Error` for a call that was refused: `why` is `"rules"` (deny, allow, ask) or `"outside"` (a path outside). */
export function refused(message, why) {
  return Object.assign(new Error(message), { refusal: why });
}

const FAULTS = { rules: "refused by the rules", outside: "outside the listed folders" };

/** The log file: lines queued in the order the records were completed, each appended whole. */
function makeLog(settings, session, fail) {
  if (!settings.log) return { write() {}, flush: async () => {} };
  const folder = typeof settings.logFolder === "string" ? settings.logFolder : DEFAULT_FOLDER;
  let tail = Promise.resolve();
  return {
    write(record) {
      let text;
      try {
        text = `${logLine({ ...record, session })}\n`;
      } catch {
        fail();
        return;
      }
      tail = tail.then(async () => {
        try {
          await mkdir(folder, { recursive: true });
          await appendFile(join(folder, logFileName(record.time)), text);
        } catch {
          fail();
        }
      });
    },
    flush: () => tail,
  };
}

/**
 * The records of the process: `program()` gives the records of one program. `session` is the text of the lines of the log;
 * `failed()` says once, for the life of the process, that the log cannot be written (the file of the sequences shares it).
 */
export function makeRecords(settings) {
  const session = randomUUID();
  const codexAdapters = new Set((settings.servers ?? [])
    .filter((entry) => entry.args?.[1] === "codex-server" && entry.args[2] === "--root")
    .map((entry) => entry.name));
  let told = false;
  const failed = () => {
    if (told) return;
    told = true;
    process.stderr.write("onetool: the log cannot be written\n");
  };
  const log = makeLog(settings, session, failed);

  function program() {
    const calls = [];
    // the lines the program's trail ends with, after its calls
    const notes = [];
    let over = false;

    function complete(record, fields) {
      if (record.done) return;
      record.done = true;
      record.ms = Math.max(0, Math.floor(performance.now() - record.began));
      Object.assign(record, fields);
      log.write(record);
    }

    // what the log keeps of the arguments of a call of a built-in server: never the text of a file or of a program
    const loggedArgs = (serverName, tool, args) => {
      if (serverName === "shell" && settings.shell !== null) return shellLogArgs(tool, args);
      if (serverName === "library") return logArgs(tool, args);
      if (codexAdapters.has(serverName) && args) {
        if (tool === "Write") return shellLogArgs("write", { path: args.file_path, text: args.content });
        if (tool === "Edit") return shellLogArgs("edit", { path: args.file_path, old: args.old_string, new: args.new_string });
      }
      return args;
    };

    return {
      calls,
      notes,
      /** A call begins: the record is kept, its decision is for the caller to set. */
      begin(serverName, tool, args) {
        const record = {
          time: Date.now(),
          began: performance.now(),
          id: `${serverName}.${tool}`,
          args: loggedArgs(serverName, tool, args),
          decision: "allowed",
          outcome: null,
          ms: 0,
          size: null,
          fault: null,
          done: over,
        };
        if (!over) calls.push(record);
        return record;
      },
      resolved(record, value) {
        if (record.id === "shell.run" && settings.shell !== null && value?.exitCode !== 0) {
          complete(record, { outcome: "failed", fault: `exit code ${value?.exitCode}` });
          return;
        }
        complete(record, { outcome: "ok", size: callSize(value) });
      },
      rejected(record, err) {
        if (err?.refusal !== undefined) {
          complete(record, { outcome: "refused", fault: FAULTS[err.refusal] });
          return;
        }
        complete(record, { outcome: "failed", fault: String(err?.message ?? err).slice(0, FAULT_LIMIT) });
      },
      /** The program's result is there: what has not ended is complete now, and the file holds every line. */
      async close() {
        over = true;
        for (const record of calls) complete(record, { outcome: "unfinished", fault: "unfinished" });
        await log.flush();
      },
      trail() {
        return formatTrail(
          calls.map(({ id, ms, size, outcome }) => ({ id, ms, size, outcome })),
          { notes },
        );
      },
    };
  }

  return { program, session, failed };
}
