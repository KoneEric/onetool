import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// -- settings ----------------------------------------------------------------

export class SettingsError extends Error {
  constructor(problems) {
    super(problems.join("; "));
    this.name = "SettingsError";
    this.problems = problems;
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isWhole = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isPattern = (value) => typeof value === "string" && value !== "" && !/\s/.test(value);
const isPatternList = (value) => Array.isArray(value) && value.every(isPattern);
const isCommandPattern = (value) => typeof value === "string" && /\S/.test(value);
const isCommandPatternList = (value) => Array.isArray(value) && value.every(isCommandPattern);
const isFullPath = (value) => typeof value === "string" && isAbsolute(value);
const isBoolean = (value) => typeof value === "boolean";

const ONETOOL_KEYS = {
  answerLimit: {
    fallback: 8000,
    valid: (v) => isWhole(v, 100, 1000000),
    problem: "must be a whole number from 100 to 1000000",
  },
  timeoutSeconds: {
    fallback: 60,
    valid: (v) => isNumber(v) && v > 0 && v <= 3600,
    problem: "must be a number above 0, at most 3600",
  },
  connectSeconds: {
    fallback: 30,
    valid: (v) => isNumber(v) && v > 0 && v <= 600,
    problem: "must be a number above 0, at most 600",
  },
  searchLimit: {
    fallback: 10,
    valid: (v) => isWhole(v, 1, 100),
    problem: "must be a whole number from 1 to 100",
  },
  stateLimit: {
    fallback: 10000000,
    valid: (v) => isWhole(v, 1000, 100000000),
    problem: "must be a whole number from 1000 to 100000000",
  },
  allow: { fallback: [], valid: isPatternList, problem: "must be a list of patterns" },
  deny: { fallback: [], valid: isPatternList, problem: "must be a list of patterns" },
  ask: { fallback: [], valid: isPatternList, problem: "must be a list of patterns" },
};

const EXTRA_KEYS = ["shell", "trail", "log", "logFolder", "hostRules", "hostServers", "backgroundSeconds", "maxJobs", "libraryCap"];

const isTexts = (list) => Array.isArray(list) && list.every((item) => typeof item === "string");
const isObjectOfTexts = (value) => isObject(value) && Object.values(value).every((item) => typeof item === "string");

/** The reason an entry of mcpServers is unusable, or null when it is usable. */
function badReason(name, entry, shellOn) {
  if (name.trim() === "") return "the name is empty";
  if (name.includes(".")) return "the name holds a dot";
  if (shellOn && name === "shell") return "the name is taken by the built-in shell";
  if (name === "library") return "the name is taken by the built-in library";
  if (!isObject(entry)) return "not an object";
  const has = (key) => Object.hasOwn(entry, key);
  if (has("command") && has("url")) return "both command and url";
  if (has("url")) {
    const { url } = entry;
    if (typeof url !== "string" || !URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
      return "url is not an http address";
    }
    if (entry.type === "sse") return "the old SSE transport is not supported";
    if (has("headers") && !isObjectOfTexts(entry.headers)) return "headers is not an object of texts";
    return null;
  }
  if (typeof entry.command !== "string" || entry.command === "") return "no command";
  if (has("args") && !isTexts(entry.args)) return "args is not a list of texts";
  if (has("env") && !isObjectOfTexts(entry.env)) return "env is not an object of texts";
  return null;
}

const SHELL_KEYS = ["folders", "allow", "deny", "ask"];

/** The problems of the `shell` key of `onetool`, in their order. */
function shellProblems(shell) {
  if (!isObject(shell)) return ["onetool.shell: not an object"];
  const problems = [];
  for (const key of Object.keys(shell)) {
    if (!SHELL_KEYS.includes(key)) problems.push(`onetool.shell.${key}: unknown key`);
  }
  const { folders } = shell;
  if (Object.hasOwn(shell, "folders") && (!Array.isArray(folders) || folders.length === 0 || !folders.every(isFullPath))) {
    problems.push("onetool.shell.folders: must be a list of full paths, at least one");
  }
  for (const key of ["allow", "deny", "ask"]) {
    if (Object.hasOwn(shell, key) && !isCommandPatternList(shell[key])) {
      problems.push(`onetool.shell.${key}: must be a list of command patterns`);
    }
  }
  return problems;
}

export function readSettings(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new SettingsError([`settings file not found: ${path}`]);
  }
  let file;
  try {
    file = JSON.parse(raw);
  } catch {
    throw new SettingsError(["settings file is not JSON"]);
  }
  if (!isObject(file)) throw new SettingsError(["settings file is not a JSON object"]);

  const problems = [];
  if (!("mcpServers" in file)) problems.push("mcpServers: missing");
  else if (!isObject(file.mcpServers)) problems.push("mcpServers: not an object");

  const onetool = file.onetool === undefined ? {} : file.onetool;
  const values = {};
  let shell = null;
  let trail = false;
  let log = true;
  let logFolder = null;
  let hostRules = true;
  let hostServers = [];
  let backgroundSeconds = 7200;
  let maxJobs = 3;
  let libraryCap = 50;
  if (!isObject(onetool)) {
    problems.push("onetool: not an object");
  } else {
    for (const key of Object.keys(onetool)) {
      if (!Object.hasOwn(ONETOOL_KEYS, key) && !EXTRA_KEYS.includes(key)) problems.push(`onetool.${key}: unknown key`);
    }
    for (const [key, rule] of Object.entries(ONETOOL_KEYS)) {
      if (!Object.hasOwn(onetool, key)) values[key] = rule.fallback;
      else if (rule.valid(onetool[key])) values[key] = onetool[key];
      else problems.push(`onetool.${key}: ${rule.problem}`);
    }
    const shellOn = Object.hasOwn(onetool, "shell");
    if (shellOn) {
      const found = shellProblems(onetool.shell);
      if (found.length === 0) {
        const { folders = null, allow = [], deny = [], ask = [] } = onetool.shell;
        shell = { folders, allow, deny, ask };
      } else {
        problems.push(...found);
      }
    }
    trail = shellOn;
    if (Object.hasOwn(onetool, "trail")) {
      if (isBoolean(onetool.trail)) trail = onetool.trail;
      else problems.push("onetool.trail: must be true or false");
    }
    if (Object.hasOwn(onetool, "log")) {
      if (isBoolean(onetool.log)) log = onetool.log;
      else problems.push("onetool.log: must be true or false");
    }
    if (Object.hasOwn(onetool, "logFolder")) {
      if (isFullPath(onetool.logFolder)) logFolder = onetool.logFolder;
      else problems.push("onetool.logFolder: must be a full path");
    }
    if (Object.hasOwn(onetool, "hostRules")) {
      if (isBoolean(onetool.hostRules)) hostRules = onetool.hostRules;
      else problems.push("onetool.hostRules: must be true or false");
    }
    if (Object.hasOwn(onetool, "hostServers")) {
      const names = onetool.hostServers;
      if (Array.isArray(names) && names.every((name) => typeof name === "string" && name.trim() !== "")) hostServers = names;
      else problems.push("onetool.hostServers: must be a list of server names");
    }
    if (Object.hasOwn(onetool, "backgroundSeconds")) {
      const seconds = onetool.backgroundSeconds;
      if (isNumber(seconds) && seconds > 0 && seconds <= 86400) backgroundSeconds = seconds;
      else problems.push("onetool.backgroundSeconds: must be a number above 0, at most 86400");
    }
    if (Object.hasOwn(onetool, "maxJobs")) {
      if (isWhole(onetool.maxJobs, 0, 100)) maxJobs = onetool.maxJobs;
      else problems.push("onetool.maxJobs: must be a whole number from 0 to 100");
    }
    if (Object.hasOwn(onetool, "libraryCap")) {
      if (isWhole(onetool.libraryCap, 1, 1000)) libraryCap = onetool.libraryCap;
      else problems.push("onetool.libraryCap: must be a whole number from 1 to 1000");
    }
  }
  if (problems.length > 0) throw new SettingsError(problems);

  const servers = [];
  const bad = [];
  for (const [name, entry] of Object.entries(file.mcpServers)) {
    const reason = badReason(name, entry, shell !== null);
    if (reason !== null) bad.push({ name, reason });
    else if (Object.hasOwn(entry, "url")) servers.push({ name, url: entry.url, headers: entry.headers ?? {} });
    else servers.push({ name, command: entry.command, args: entry.args ?? [], env: entry.env ?? {} });
  }
  const { answerLimit, timeoutSeconds, connectSeconds, searchLimit, stateLimit, allow, deny, ask } = values;
  return { servers, bad, answerLimit, timeoutSeconds, connectSeconds, searchLimit, stateLimit, allow, deny, ask, shell, trail, log, logFolder, hostRules, hostServers, backgroundSeconds, maxJobs, libraryCap };
}

// -- allow and deny ----------------------------------------------------------

/** Whether `pattern` matches the whole of `text`; `*` stands for any run of characters. */
function globMatches(pattern, text) {
  let p = 0;
  let t = 0;
  let starAt = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === "*") {
      starAt = p++;
      resume = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (starAt >= 0) {
      p = starAt + 1;
      t = ++resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}

export function decide(rules, server, tool) {
  if (rules !== undefined && !isObject(rules)) throw new TypeError("decide: the rules must be an object");
  const { allow = [], deny = [], ask = [] } = rules ?? {};
  if (!Array.isArray(allow)) throw new TypeError("decide: allow must be a list");
  if (!Array.isArray(deny)) throw new TypeError("decide: deny must be a list");
  if (!Array.isArray(ask)) throw new TypeError("decide: ask must be a list");
  const id = `${server}.${tool}`;
  for (const rule of deny) {
    if (globMatches(rule, id)) {
      return { allowed: false, list: "deny", rule, message: `onetool: ${id} is denied by the rule deny "${rule}"` };
    }
  }
  if (allow.length > 0 && !allow.some((rule) => globMatches(rule, id))) {
    return {
      allowed: false,
      list: "allow",
      rule: null,
      message: `onetool: ${id} is not allowed: it matches no rule of allow`,
    };
  }
  const asked = ask.find((rule) => globMatches(rule, id));
  return asked === undefined ? { allowed: true } : { allowed: true, ask: asked };
}

/** The question the person reads before a call under a rule of `ask`. */
export function askMessage(id, rule, args, { limit = 300, file } = {}) {
  const json = JSON.stringify(args);
  const shown = json.length > limit ? `${json.slice(0, limit)}... (${json.length} characters)` : json;
  return `onetool: a program wants to call ${id}.\nArguments: ${shown}\nThe rule ask "${rule}"${file === undefined ? "" : ` of the host program (${file})`} asks for your consent. Allow this call?`;
}

const ASK_CAUSES = {
  unsupported: "the host program cannot ask the person",
  decline: "the person said no",
  cancel: "the person gave no answer",
  failed: "the question failed",
};

/** The message of the error a program gets when a call under `ask` is not made. */
export function askRefusal(id, rule, why, file) {
  if (typeof why !== "string" || !Object.hasOwn(ASK_CAUSES, why)) {
    throw new TypeError("askRefusal: why must be unsupported, decline, cancel or failed");
  }
  return `onetool: ${id} is refused by the rule ask "${rule}"${file === undefined ? "" : ` of the host program (${file})`}: ${ASK_CAUSES[why]}`;
}

/** The message of the error a program gets when a rule deny of the host program refuses its call. */
export function hostDenial(id, rule, file) {
  return `onetool: ${id} is denied by the rule deny "${rule}" of the host program (${file})`;
}

// -- search ------------------------------------------------------------------

function typeOf(property) {
  const type = property?.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.join("|");
  return "any";
}

function sentenceOf(description) {
  if (typeof description !== "string") return "";
  const text = description.replace(/\s+/g, " ").trim();
  const end = text.search(/[.!?](?: |$)/);
  const sentence = end === -1 ? text : text.slice(0, end + 1);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

export function toolLine(server, tool) {
  const schema = tool.inputSchema;
  const properties = isObject(schema?.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const args = Object.keys(properties)
    .map((name) => `${name}${required.has(name) ? "" : "?"}: ${typeOf(properties[name])}`)
    .join(", ");
  const sentence = sentenceOf(tool.description);
  return `${server}.${tool.name}(${args})${sentence === "" ? "" : ` - ${sentence}`}`;
}

function score(server, tool, words) {
  const id = `${server}.${tool.name}`.toLowerCase();
  const description = typeof tool.description === "string" ? tool.description.toLowerCase() : "";
  const properties = isObject(tool.inputSchema?.properties) ? tool.inputSchema.properties : {};
  const argumentNames = Object.keys(properties).map((name) => name.toLowerCase());
  let total = 0;
  for (const word of words) {
    if (id.includes(word)) total += 2;
    else if (description.includes(word) || argumentNames.some((name) => name.includes(word))) total += 1;
  }
  return total;
}

/** `lib.<name>(<arguments>) - <sentence>`: how a saved program is called. */
export function programLine(program) {
  const params = program.params.length === 0 ? "" : `{ ${program.params.join(", ")} }`;
  const about = program.about.replace(/\s+/g, " ").trim();
  const sentence = about.length > 160 ? `${about.slice(0, 157)}...` : about;
  return `lib.${program.name}(${params})${sentence === "" ? "" : ` - ${sentence}`}`;
}

function programScore(program, words) {
  const id = `lib.${program.name}`.toLowerCase();
  const about = program.about.toLowerCase();
  const params = program.params.map((param) => param.toLowerCase());
  let total = 0;
  for (const word of words) {
    if (id.includes(word)) total += 2;
    else if (about.includes(word) || params.some((param) => param.includes(word))) total += 1;
  }
  return total;
}

export function searchTools(catalog, words, { limit = 10, programs = [] } = {}) {
  const query = typeof words === "string" ? words.trim() : "";
  if (query === "") {
    const lines = catalog.map((entry) =>
      entry.error !== undefined && entry.error !== null
        ? `${entry.server}: not connected (${entry.error})`
        : `${entry.server}: ${entry.tools.length} tools`,
    );
    if (programs.length > 0) lines.push(`library: ${programs.length} programs`);
    return lines.length === 0 ? "No server is listed." : lines.join("\n");
  }

  const terms = query.toLowerCase().split(/\s+/);
  const matches = [];
  for (const [order, program] of programs.entries()) {
    const points = programScore(program, terms);
    if (points > 0) matches.push({ points, line: programLine(program), order });
  }
  matches.sort((a, b) => b.points - a.points || a.order - b.order);
  const found = [];
  for (const entry of catalog) {
    if (entry.error !== undefined && entry.error !== null) continue;
    for (const tool of entry.tools) {
      const points = score(entry.server, tool, terms);
      if (points > 0) found.push({ points, line: toolLine(entry.server, tool), order: found.length });
    }
  }
  found.sort((a, b) => b.points - a.points || a.order - b.order);
  matches.push(...found);
  if (matches.length === 0) return "No tool matches.";
  const lines = matches.slice(0, limit).map((m) => m.line);
  if (matches.length > limit) lines.push(`(${matches.length - limit} more match: add a word)`);
  return lines.join("\n");
}

// -- answers -----------------------------------------------------------------

export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
  }
}

export function toolValue(result) {
  if (!isObject(result)) throw new TypeError("toolValue: the result must be an object");
  const items = Array.isArray(result.content) ? result.content : [];
  const texts = items.filter((item) => isObject(item) && item.type === "text").map((item) => String(item.text ?? ""));
  const text = texts.join("\n");
  if (result.isError === true) throw new ToolError(text === "" ? "the tool failed" : text);
  if (result.structuredContent !== null && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  if (texts.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function formatRun(result, { timeoutSeconds = 60 } = {}) {
  let text;
  if (result.ok) {
    if (result.value === undefined) text = "undefined";
    else if (typeof result.value === "string") text = result.value;
    else text = JSON.stringify(result.value) ?? String(result.value);
  } else {
    const { kind, message } = result.error;
    if (kind === "timeout") text = `The program was stopped after ${String(timeoutSeconds)} seconds.`;
    else if (kind === "stopped") text = "The program was stopped on request.";
    else if (kind === "crash") text = `The program's process ended before it answered (${message}).`;
    else text = `The program failed: ${message}`;
  }
  const logs = result.logs ?? [];
  if (logs.length > 0) text += `\n--- console.log ---\n${logs.join("\n")}`;
  return text;
}

export function cutAnswer(text, limit = 8000) {
  if (typeof text !== "string") throw new TypeError("cutAnswer: text must be a string");
  if (text.length <= limit) return text;
  const notice = `\n[cut: the answer was ${text.length} characters, the limit is ${limit}]`;
  return text.slice(0, limit - notice.length) + notice;
}

// -- jobs --------------------------------------------------------------------

const RUN_NEEDS_CODE = 'onetool: run needs "code", a text';
const flagProblem = (name) => `onetool: run takes "${name}", true or false`;

/** What a call of `run` asks for: a program, a job, the list of jobs, or a problem with the arguments. */
export function runRequest(args) {
  if (!isObject(args)) return { problem: RUN_NEEDS_CODE };
  const get = (key) => (Object.hasOwn(args, key) ? args[key] : undefined);
  const flags = {};
  for (const name of ["background", "stop", "jobs"]) {
    const value = get(name);
    if (value !== undefined && value !== null && !isBoolean(value)) return { problem: flagProblem(name) };
    flags[name] = value === true;
  }
  const job = get("job");
  if (job !== undefined && job !== null && typeof job !== "string") {
    return { problem: 'onetool: run takes "job", the id of a job' };
  }
  const asksJob = typeof job === "string" && job !== "";
  const asksJobs = flags.jobs;
  const code = get("code");
  const given = code !== undefined && !((asksJob || asksJobs) && (code === null || code === ""));
  const asked = [given, asksJob, asksJobs].filter(Boolean).length;
  if (asked === 0) return { problem: RUN_NEEDS_CODE };
  if (asked > 1) return { problem: 'onetool: run takes one of "code", "job" and "jobs", not several' };
  if (given) {
    if (typeof code !== "string") return { problem: RUN_NEEDS_CODE };
    if (flags.stop) return { problem: 'onetool: run takes "stop" only with "job"' };
    return { mode: "run", code, background: flags.background };
  }
  if (asksJob) {
    if (flags.background) return { problem: 'onetool: run takes "background" only with "code"' };
    return { mode: "job", job, stop: flags.stop };
  }
  if (flags.background) return { problem: flagProblem("background") };
  if (flags.stop) return { problem: flagProblem("stop") };
  return { mode: "jobs" };
}

/** The state a job ends in, from what part `sandbox` returned for its program. */
export function jobState(result) {
  if (result.ok) return "done";
  const { kind } = result.error;
  return kind === "timeout" || kind === "stopped" ? "stopped" : "failed";
}

export const jobStarted = (id) =>
  `Job ${String(id)} started. Its state: run({ job: "${String(id)}" }). To stop it: run({ job: "${String(id)}", stop: true }).`;

export const jobLimitMessage = (maxJobs) =>
  `onetool: the job was not started: no more than ${String(maxJobs)} jobs may run at once (onetool.maxJobs). Wait for one to end, or stop one.`;

export const noJobMessage = (id) => `onetool: no job ${String(id)} in this session. run({ jobs: true }) lists them.`;

/** `<id>: <state>, <n> s`, the seconds the job has run. */
export function jobLine(job, now) {
  const end = typeof job.endedAt === "number" ? job.endedAt : now;
  const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1000));
  return `${job.id}: ${job.state}, ${seconds} s`;
}

export function formatJobs(jobs, now) {
  if (jobs.length === 0) return "No job in this session.";
  return jobs.map((job) => jobLine(job, now)).join("\n");
}

/** The text `run` answers for one job: its line, the progress kept, and its answer once it has ended. */
export function formatJob(job, now, { lineLimit = 200 } = {}) {
  const lines = [`job ${jobLine(job, now)}`];
  if (Array.isArray(job.progress) && job.progress.length > 0) {
    lines.push("--- progress ---");
    if (job.progressCount > job.progress.length) lines.push(`(${job.progressCount - job.progress.length} earlier lines not shown)`);
    for (const item of job.progress) {
      const flat = item.replace(/\r\n|\n|\r/g, " ");
      lines.push(flat.length > lineLimit ? `${flat.slice(0, lineLimit)}...` : flat);
    }
  }
  if (typeof job.answer === "string") lines.push("--- answer ---", job.answer);
  return lines.join("\n");
}

// -- the library -------------------------------------------------------------

const LIBRARY_HOW = ". Call one as await lib.<name>(args); search finds them; library.save(name, { about, params, code }) keeps a new one.";

/** The text added to the description of `run`: how many programs are saved, the most used, and how to call and save one. */
export function libraryText(programs, { limit = 298, most = 5 } = {}) {
  const head = `Saved programs: ${programs.length}`;
  const names = [];
  const sorted = [...programs].sort((a, b) => b.uses - a.uses || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name } of sorted.slice(0, most)) {
    const text = `${head} (most used: ${[...names, name].join(", ")})${LIBRARY_HOW}`;
    if (text.length > limit) break;
    names.push(name);
  }
  return `${head}${names.length === 0 ? "" : ` (most used: ${names.join(", ")})`}${LIBRARY_HOW}`;
}

export const saveItNote = (times) =>
  `(this sequence of calls has run ${String(times)} times: save it as a program with library.save)`;

export const sameAsNote = (name) => `(lib.${String(name)} does this: call it)`;

export const archivedNote = (name, failures) =>
  `(lib.${String(name)} failed ${String(failures)} times in a row: it was moved to the archive)`;

// -- state -------------------------------------------------------------------

export function nextState(kept, before, after, { limit = 10000000 } = {}) {
  const removed = new Set();
  const changed = new Set();
  for (const key of Object.keys(after)) {
    if (!Object.hasOwn(before, key) || JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.add(key);
  }
  for (const key of Object.keys(before)) {
    if (!Object.hasOwn(after, key)) removed.add(key);
  }
  const entries = [];
  for (const [key, value] of Object.entries(kept)) {
    if (removed.has(key)) continue;
    entries.push([key, changed.has(key) ? after[key] : value]);
  }
  for (const key of Object.keys(after)) {
    if (changed.has(key) && !Object.hasOwn(kept, key)) entries.push([key, after[key]]);
  }
  if (removed.size === 0 && changed.size === 0) return { state: Object.fromEntries(Object.entries(kept)), problem: null };
  const state = Object.fromEntries(entries);
  const n = JSON.stringify(state).length;
  if (n > limit) {
    return { state: kept, problem: `state was not kept: it is ${n} characters as JSON, the limit is ${limit}` };
  }
  return { state, problem: null };
}

// -- the shell ---------------------------------------------------------------

/** Whether a shell command may be run, by its text: `settings.shell` is the first argument. */
export function decideCommand(rules, command) {
  if (!isObject(rules)) throw new TypeError("decideCommand: the rules must be an object");
  const { allow = [], deny = [], ask = [] } = rules;
  if (!Array.isArray(allow)) throw new TypeError("decideCommand: allow must be a list");
  if (!Array.isArray(deny)) throw new TypeError("decideCommand: deny must be a list");
  if (!Array.isArray(ask)) throw new TypeError("decideCommand: ask must be a list");
  if (typeof command !== "string") throw new TypeError("decideCommand: the command must be a string");
  const text = command.trim();
  for (const rule of deny) {
    if (globMatches(rule, text)) {
      return {
        allowed: false,
        list: "deny",
        rule,
        message: `onetool: shell.run is denied by the rule deny "${rule}" of onetool.shell`,
      };
    }
  }
  if (allow.length > 0 && !allow.some((rule) => globMatches(rule, text))) {
    return {
      allowed: false,
      list: "allow",
      rule: null,
      message: "onetool: shell.run is not allowed: the command matches no rule of allow of onetool.shell",
    };
  }
  const asked = ask.find((rule) => globMatches(rule, text));
  return asked === undefined ? { allowed: true } : { allowed: true, ask: asked };
}

const stringProperty = () => ({ type: "string" });
const shellTool = (name, description, properties) =>
  Object.freeze({
    name,
    description,
    inputSchema: Object.freeze({
      type: "object",
      properties: Object.freeze(Object.fromEntries(properties.map((property) => [property, stringProperty()]))),
      required: Object.freeze([...properties]),
    }),
  });

export const SHELL_TOOLS = Object.freeze([
  shellTool("run", "Runs a shell command in the first listed folder. In a program: $`command`.", ["command"]),
  shellTool("read", "Reads a text file of the listed folders. In a program: read(path).", ["path"]),
  shellTool(
    "write",
    "Writes a text file in the listed folders, replacing what it holds. In a program: write(path, text).",
    ["path", "text"],
  ),
  shellTool(
    "edit",
    "Replaces one text by another in a file of the listed folders. In a program: edit(path, old, new).",
    ["path", "old", "new"],
  ),
]);

const SHELL_NAMES = ["$", "read", "write", "edit"];

export const SHELL_NO_FOLDERS = "no folder: onetool.shell.folders is not set and the host program gave none";

/** Says why a program that uses `$`, `read`, `write` or `edit` without a working shell got a ReferenceError. */
export function shellOffMessage(message, why = "off") {
  if (why !== "off" && why !== "no-folders") throw new TypeError("shellOffMessage: why must be off or no-folders");
  if (typeof message === "string" && SHELL_NAMES.some((name) => message === `ReferenceError: ${name} is not defined`)) {
    return why === "off"
      ? `${message} (the shell is not switched on: see onetool.shell in the settings file)`
      : `${message} (the shell has ${SHELL_NO_FOLDERS})`;
  }
  return message;
}

/** The full paths of the folders of a list of MCP roots, `file://` roots only, none twice. */
export function rootFolders(roots) {
  if (!Array.isArray(roots)) return [];
  const folders = [];
  for (const root of roots) {
    if (!isObject(root) || typeof root.uri !== "string" || !root.uri.startsWith("file://")) continue;
    let folder;
    try {
      folder = resolve(fileURLToPath(root.uri));
    } catch {
      continue;
    }
    if (!folders.includes(folder)) folders.push(folder);
  }
  return folders;
}

// -- the trail ---------------------------------------------------------------

/** The size of the answer of one call, in characters. */
export function callSize(value) {
  if (value === undefined) return 0;
  if (typeof value === "string") return value.length;
  return JSON.stringify(value).length;
}

/** The trail of one program: one line per call, in the order the calls started. */
export function formatTrail(calls, { limit = 20, notes = [] } = {}) {
  if (calls.length === 0 && notes.length === 0) return "";
  const lines = calls.slice(0, limit).map((call) =>
    call.outcome === "ok" ? `${call.id} ${call.ms} ms ${call.size} chars` : `${call.id} ${call.ms} ms ${call.outcome}`,
  );
  if (calls.length > limit) lines.push(`(${calls.length - limit} more not shown)`);
  return ["--- calls ---", ...lines, ...notes].join("\n");
}

/** The answer of `run` and its trail within the limit of an answer, the trail whole unless the limit is too small. */
export function withTrail(text, trail, limit = 8000) {
  if (typeof text !== "string") throw new TypeError("withTrail: text must be a string");
  if (typeof trail !== "string") throw new TypeError("withTrail: trail must be a string");
  if (trail === "") return cutAnswer(text, limit);
  const whole = `${text}\n${trail}`;
  if (whole.length <= limit) return whole;
  const notice = `\n[cut: the answer was ${whole.length} characters, the limit is ${limit}]`;
  const room = limit - notice.length - 1 - trail.length;
  if (room < 0) return cutAnswer(whole, limit);
  return `${text.slice(0, room)}${notice}\n${trail}`;
}

// -- the log -----------------------------------------------------------------

const lengthOrNull = (value) => (typeof value === "string" ? value.length : null);

/** What the log keeps of the arguments of a call of the built-in server `shell`: never the text of a file. */
export function shellLogArgs(tool, args) {
  if (!isObject(args)) return null;
  switch (tool) {
    case "run":
      return { command: args.command ?? null };
    case "read":
      return { path: args.path ?? null };
    case "write":
      return { path: args.path ?? null, size: lengthOrNull(args.text) };
    case "edit":
      return { path: args.path ?? null, oldSize: lengthOrNull(args.old), newSize: lengthOrNull(args.new) };
    default:
      return null;
  }
}

/** One line of the log file, with no line break in it or after it. */
export function logLine(entry, { argsLimit = 2000 } = {}) {
  const json = JSON.stringify(entry.args);
  let args = null;
  if (json !== undefined) {
    args = json.length <= argsLimit ? entry.args : `${json.slice(0, argsLimit)}... (${json.length} characters)`;
  }
  return JSON.stringify({
    time: new Date(entry.time).toISOString(),
    session: entry.session,
    id: entry.id,
    args,
    decision: entry.decision,
    ms: entry.ms,
    size: entry.size,
    fault: entry.fault,
  });
}

/** The name of the file a line goes to: one file per day, in UTC. */
export function logFileName(time) {
  return `calls-${new Date(time).toISOString().slice(0, 10)}.jsonl`;
}
