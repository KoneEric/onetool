// Helpers of the tests of "Step 12: leading the session to group its work" (the meeting point of server): the texts that part `core`
// fixes ("Step 12: `INSTRUCTIONS`", `oneProgramNote`, `sessionLine`), the programs of the examples, and a small client of `run`.
import { startHost } from "./askhost.js";
import { libSettings } from "./libhelpers.js";
import { ONE_CALL_NOTE } from "./helpers.js";

export { ONE_CALL_NOTE };

// the meeting point of core, "Step 12: `INSTRUCTIONS`": one line, 470 characters
export const INSTRUCTIONS =
  "onetool gives you two tools, run and search. It saves context only when one program does several steps. " +
  "Before the first run, list the steps of the task. Put every step that needs no decision into one program: " +
  "loops, filters, several tools. Return only the small result you need to decide what comes next. " +
  "Keep large results in state and look at them in a later program. " +
  "Never use run for one tool call when the next call is already known: put both calls in one program.";

// the meeting point of server, "Step 12", "The description of `run`"
export const SENTENCE = "Put every step that needs no decision into one program.";

// the meeting point of core, "Step 12: ... `sessionLine`"; the rate is `(calls / programs).toFixed(1)`
export const SESSION = (programs, calls) => `this session: ${programs} programs, ${calls} calls, ${(calls / programs).toFixed(1)} calls per program`;
export const isSession = (line) => line.startsWith("this session: ");

export const LYON = '(await tools.practice.count({ city: "Lyon" })).count';
export const PARIS = '(await tools.practice.count({ city: "Paris" })).count';
export const ROWS = '(await tools.practice.rows({ city: "Lyon" })).rows.length';
export const ECHO = (text) => `await tools.practice.echo({ text: ${JSON.stringify(text)} })`;
export const WIPE = "await tools.practice.wipe({})";
// three calls in one program
export const THREE = [
  'const lyon = (await tools.practice.count({ city: "Lyon" })).count;',
  'const paris = (await tools.practice.count({ city: "Paris" })).count;',
  "(await tools.practice.echo({ text: String(lyon + paris) }))",
].join("\n");

export const linesOf = (text) => text.split("\n");
/** A line of a trail: `<id> <n> ms <rest>`. */
export const callLine = (id, rest) => new RegExp(`^${id.replace(/\./g, "\\.")} \\d+ ms ${rest}$`);

/** Settings: the practice server (and `servers`), the trail on, the log off, a time limit of 10 seconds; `onetool` adds keys. */
export const settingsFor = (onetool = {}, servers) => libSettings(onetool, servers);

/** A host program in front of one onetool process; `run(code)` gives `{ text, lines, isError }`, `close()` ends the process. */
export async function openHost(settings, options = {}) {
  const host = await startHost(settings, { capabilities: {}, ...options });
  const run = async (code) => {
    const { text, isError } = await host.run(code, 10000);
    return { text, lines: linesOf(text), isError };
  };
  // `run` with any arguments, as { text, isError }; every wait is at most 10 seconds
  const call = (args) => host.call("run", args, 10000);
  return { host, run, call, search: (words) => host.search(words), close: async () => {
    host.kill();
    await host.exited;
  } };
}

/** `fn(it)` with a host program that is ended whatever happens. */
export async function withSession(settings, options, fn) {
  const it = await openHost(settings, options);
  try {
    return await fn(it);
  } finally {
    await it.close();
  }
}
