// The two tools, run and search, over the connections.
import { resolve } from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  SHELL_NO_FOLDERS,
  SHELL_TOOLS,
  ToolError,
  askMessage,
  askRefusal,
  cutAnswer,
  decide,
  decideCommand,
  formatJob,
  formatJobs,
  formatRun,
  hostDenial,
  jobLimitMessage,
  libraryText,
  jobStarted,
  jobState,
  nextState,
  noJobMessage,
  runRequest,
  searchTools,
  shellOffMessage,
  toolValue,
  withTrail,
} from "../../core/src/index.js";
import { LibraryError, checkSave, isProgramName } from "../../library/src/index.js";
import { runProgram } from "../../sandbox/src/index.js";
import { ShellError, editFile, readFile, realPlace, runCommand, writeFile } from "../../shell/src/index.js";
import { isServerError } from "./connect.js";
import { toolsWith } from "./descriptions.js";
import { makeLibrary } from "./library.js";
import { makeRecords, refused } from "./record.js";

const answer = (settings, text, isError = false) => ({
  content: [{ type: "text", text: cutAnswer(text, settings.answerLimit) }],
  ...(isError ? { isError: true } : {}),
});

// the decision of a call by the way a question ended
const ASKED = { decline: "no", cancel: "no answer", unsupported: "cannot ask", failed: "failed" };

// the ended jobs kept, the lines of `progress` kept and how much of one
const ENDED_KEPT = 20;
const PROGRESS_KEPT = 10;
const PROGRESS_LINE = 1000;

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `list()` (async) is what tools/list answers, `call(name, args)` answers tools/call. `ready` is set by the caller: a promise
 * that is settled once every connection is connected or given up. `server` is the `Server` that speaks to the host:
 * it is asked through it, once its capabilities are known. `host` (host.js) holds the folders and rules of the host.
 */
export function makeTools(settings, connections, server, host) {
  const records = makeRecords(settings);
  const library = makeLibrary(settings, host, records);
  const self = {
    list: async () => toolsWith(libraryText((await library.read()).programs), host.hasFolders()),
    ready: Promise.resolve(),
  };
  // the kept state: one plain object for the life of the process
  let kept = {};

  const catalog = () => [
    ...connections.map((connection) =>
      connection.error === null
        ? { server: connection.name, tools: connection.tools }
        : { server: connection.name, tools: [], error: connection.error },
    ),
    ...settings.bad.map(({ name, reason }) => ({ server: name, tools: [], error: `bad entry: ${reason}` })),
    ...(settings.shell === null
      ? []
      : [host.hasFolders() ? { server: "shell", tools: SHELL_TOOLS } : { server: "shell", tools: [], error: SHELL_NO_FOLDERS }]),
  ];

  const visible = () =>
    catalog().map((entry) => ({
      ...entry,
      tools: entry.tools.filter((tool) => decide(settings, entry.server, tool.name).allowed),
    }));

  async function search(args) {
    const words = args.words;
    if (words !== undefined && typeof words !== "string") {
      return answer(settings, 'onetool: search takes "words", a text', true);
    }
    await self.ready;
    await host.idle();
    const { programs } = await library.read();
    return answer(settings, searchTools(visible(), words, { limit: settings.searchLimit, programs }));
  }

  // one question open at a time, for all the programs: each call takes its turn after the one before it
  let turn = Promise.resolve();

  /**
   * Asks the person about one call; resolves when they said yes, and rejects with the refusal otherwise. `ms` is the
   * time the person has: the limit of the program of the call, and one second more.
   */
  async function ask(id, rule, args, signal, record, file, ms) {
    const refuse = (why) => {
      record.decision = `asked: ${ASKED[why]}`;
      return refused(askRefusal(id, rule, why, file), "rules");
    };
    if (server.getClientCapabilities()?.elicitation?.form === undefined) throw refuse("unsupported");
    const before = turn;
    let done;
    turn = new Promise((resolve) => {
      done = resolve;
    });
    try {
      await before;
      // the program is gone: nobody waits for this answer
      if (signal.aborted) throw new Error(`${id} failed: the program has ended`);
      let outcome;
      try {
        outcome = await server.elicitInput(
          { message: askMessage(id, rule, args, { file }), requestedSchema: { type: "object", properties: {} } },
          { timeout: ms, signal },
        );
      } catch {
        throw refuse("failed");
      }
      if (outcome?.action === "accept") {
        record.decision = "asked: yes";
        return;
      }
      if (outcome?.action === "decline" || outcome?.action === "cancel") throw refuse(outcome.action);
      throw refuse("failed");
    } finally {
      done();
    }
  }

  /** The call the host's rules are asked about for a tool of the shell, or `null` when the table gives none. */
  async function shellHostCall(tool, args, folders) {
    if (tool === "run") return { action: "run", command: args.command };
    if (tool !== "read" && tool !== "write" && tool !== "edit") return null;
    if (typeof args.path !== "string" || args.path === "") return null;
    const paths = [resolve(folders[0], args.path)];
    try {
      const real = await realPlace(args.path, folders);
      if (real !== paths[0]) paths.push(real);
    } catch {
      // the first path alone
    }
    return { action: tool, paths };
  }

  /** What the host's rules say of a covered call: refuses it, or gives the rule of `ask` that covers it (or `null`). */
  function hostSays(id, call, record) {
    const said = host.rules.decide(call);
    if (said.effect === "deny") {
      record.decision = "denied";
      throw refused(hostDenial(id, said.rule, said.file), "rules");
    }
    return said.effect === "ask" ? said : null;
  }

  /** The four tools of the built-in server `shell`, done by this process with part `shell`. */
  async function callShell(tool, args, signal, record, ms) {
    const id = `shell.${tool}`;
    const decision = decide(settings, "shell", tool);
    if (!decision.allowed) {
      record.decision = "denied";
      throw refused(decision.message, "rules");
    }
    let rule = decision.ask;
    if (rule !== undefined) record.decision = "asked: not asked";
    if (!isPlainObject(args)) throw new Error(`onetool: the arguments of ${id} must be an object`);
    if (tool === "run") {
      if (typeof args.command !== "string" || args.command.trim() === "") {
        throw new Error(`${id} failed: the command must be a text that is not empty`);
      }
      const byCommand = decideCommand(settings.shell, args.command);
      if (!byCommand.allowed) {
        record.decision = "denied";
        throw refused(byCommand.message, "rules");
      }
      rule ??= byCommand.ask;
      if (rule !== undefined) record.decision = "asked: not asked";
    }
    let byHost = null;
    const covered = host.folders();
    if (host.rules !== null && covered.length > 0) {
      const call = await shellHostCall(tool, args, covered);
      if (call !== null) byHost = hostSays(id, call, record);
    }
    if (rule !== undefined) await ask(id, rule, args, signal, record, undefined, ms);
    else if (byHost !== null) {
      record.decision = "asked: not asked";
      await ask(id, byHost.rule, args, signal, record, byHost.file, ms);
    }
    const folders = host.folders();
    if (folders.length === 0) throw new Error(`${id} failed: ${SHELL_NO_FOLDERS}`);
    try {
      switch (tool) {
        case "run":
          return await runCommand(args.command, { cwd: folders[0], signal });
        case "read":
          return await readFile(args.path, { folders });
        case "write":
          return await writeFile(args.path, args.text, { folders });
        case "edit":
          return await editFile(args.path, args.old, args.new, { folders });
        default:
          throw new Error(`${id} failed: not connected`);
      }
    } catch (err) {
      if (!(err instanceof ShellError)) throw err;
      if (err.outside) throw refused(`onetool: ${id} is refused: ${err.message}`, "outside");
      throw new Error(`${id} failed: ${err.message}`);
    }
  }

  /** The five tools of the built-in server `library`, done by this process with part `library`. */
  async function callLibrary(tool, args, signal, record, ms) {
    const id = `library.${tool}`;
    const decision = decide(settings, "library", tool);
    if (!decision.allowed) {
      record.decision = "denied";
      throw refused(decision.message, "rules");
    }
    if (decision.ask !== undefined) record.decision = "asked: not asked";
    if (!isPlainObject(args)) throw new Error(`onetool: the arguments of ${id} must be an object`);
    let checked;
    if (tool === "save") {
      checked = checkSave(args);
      if (checked.problem !== undefined) throw new Error(checked.problem);
    } else if (tool === "remove" || tool === "restore" || tool === "read") {
      if (!isProgramName(args.name)) {
        throw new Error(`${id} failed: the name must be 1 to 40 letters, digits or _, starting with a letter`);
      }
    } else if (tool !== "report") {
      throw new Error(`${id} failed: not connected`);
    }
    if (decision.ask !== undefined) await ask(id, decision.ask, args, signal, record, undefined, ms);
    try {
      switch (tool) {
        case "save":
          return await library.save(checked.program, checked.replace);
        case "remove":
          return await library.remove(args.name);
        case "restore":
          return await library.restore(args.name);
        case "read":
          return await library.readProgram(args.name);
        default:
          return await library.report();
      }
    } catch (err) {
      if (err instanceof LibraryError) throw new Error(`${id} failed: ${err.message}`);
      throw err;
    }
  }

  async function callTool(serverName, tool, args, signal, record, ms) {
    if (serverName === "library") return callLibrary(tool, args, signal, record, ms);
    if (settings.shell !== null && serverName === "shell") return callShell(tool, args, signal, record, ms);
    const id = `${serverName}.${tool}`;
    const decision = decide(settings, serverName, tool);
    if (!decision.allowed) {
      record.decision = "denied";
      throw refused(decision.message, "rules");
    }
    if (decision.ask !== undefined) record.decision = "asked: not asked";
    if (!isPlainObject(args)) throw new Error(`onetool: the arguments of ${id} must be an object`);
    let byHost = null;
    if (host.rules !== null && settings.hostServers.includes(serverName)) {
      const call = host.rules.ownCall(tool, args, process.cwd());
      if (call !== null) byHost = hostSays(id, call, record);
    }
    const connection = connections.find((candidate) => candidate.name === serverName);
    if (!connection || !connection.connected) {
      if (byHost !== null) record.decision = "asked: not asked";
      throw new Error(`${id} failed: not connected`);
    }
    if (decision.ask !== undefined) await ask(id, decision.ask, args, signal, record, undefined, ms);
    else if (byHost !== null) {
      record.decision = "asked: not asked";
      await ask(id, byHost.rule, args, signal, record, byHost.file, ms);
    }
    let result;
    try {
      result = await connection.client.callTool({ name: tool, arguments: args }, undefined, { timeout: ms, signal });
    } catch (err) {
      // an address has no process to end: what the server did not say itself is told in one fixed way
      if (connection.remote && !isServerError(err)) throw new Error(`${id} failed: no answer from the server`);
      throw new Error(`${id} failed: ${err?.message ?? String(err)}`);
    }
    try {
      return toolValue(result);
    } catch (err) {
      if (err instanceof ToolError) throw new Error(`${id} failed: ${err.message}`);
      throw err;
    }
  }

  // with the shell off or with no folder, a program that uses one of its four names is told why they are not there
  const shellOffMessageOf = (result) => {
    if (result.ok || result.error?.kind !== "error" || (settings.shell !== null && host.hasFolders())) return result;
    const message = shellOffMessage(result.error.message, settings.shell === null ? "off" : "no-folders");
    return { ...result, error: { ...result.error, message } };
  };

  // the jobs of the process, in the order they were started; `ended` holds the ones that have ended, the first to end first
  const jobs = [];
  const ended = [];
  let jobCount = 0;

  /**
   * One program, from the host's files to the kept state: what a program in the foreground and a job both do. `seconds` is
   * its limit; `program` its records; `onProgress` and `signal` are the ones handed to `runProgram`. Gives the result, in
   * which a state that was too large has made an error of an `ok` result.
   */
  async function execute(code, { seconds, program, onProgress, signal }) {
    await host.refresh();
    // the program's library: read once, as it is when the program starts
    const saved = await library.read();
    const uses = [];
    const names = {};
    for (const connection of connections) {
      if (connection.error === null) names[connection.name] = connection.tools.map((tool) => tool.name);
    }
    const withShell = host.hasFolders();
    if (withShell) names.shell = SHELL_TOOLS.map((tool) => tool.name);
    // stops the commands and the open question of this program, once it has ended
    const controller = new AbortController();
    const before = kept;
    try {
      const raw = await runProgram(code, {
        tools: names,
        callTool: async (serverName, tool, callArgs) => {
          const record = program.begin(serverName, tool, callArgs);
          try {
            const value = await callTool(serverName, tool, callArgs, controller.signal, record, seconds * 1000 + 1000);
            program.resolved(record, value);
            return value;
          } catch (err) {
            program.rejected(record, err);
            throw err;
          }
        },
        timeoutMs: seconds * 1000,
        state: before,
        onProgress,
        library: saved.programs.map(({ name, params, code: text }) => ({ name, params, code: text })),
        onLibrary: (use) => uses.push(use),
        ...(withShell ? { shell: true } : {}),
        ...(signal === undefined ? {} : { signal }),
      });
      await program.close();
      controller.abort();
      const result = shellOffMessageOf(raw);
      // the sandbox gives a state only for a program that ended with one; a timeout or a crash keeps nothing
      const next = nextState(kept, before, result.state ?? before, { limit: settings.stateLimit });
      kept = next.state;
      const final =
        next.problem !== null && result.ok ? { ok: false, error: { kind: "error", message: next.problem }, logs: result.logs } : result;
      program.notes.push(...(await library.finish({ library: saved, uses, code, ok: final.ok })));
      return final;
    } finally {
      await program.close();
      controller.abort();
    }
  }

  // the answer of a program that made calls ends with its trail
  const reply = (text, isError, program) =>
    settings.trail && (program.calls.length > 0 || program.notes.length > 0)
      ? {
          content: [{ type: "text", text: withTrail(text, program.trail(), settings.answerLimit) }],
          ...(isError ? { isError: true } : {}),
        }
      : answer(settings, text, isError);

  async function runForeground(code) {
    await self.ready;
    await host.idle();
    const program = records.program();
    const result = await execute(code, { seconds: settings.timeoutSeconds, program, onProgress: () => {} });
    return reply(formatRun(result, { timeoutSeconds: settings.timeoutSeconds }), !result.ok, program);
  }

  /** The job has ended: what it answers, its state, and the place of the ended jobs kept. */
  function endJob(job, result) {
    job.answer = formatRun(result, { timeoutSeconds: settings.backgroundSeconds });
    job.state = jobState(result);
    job.endedAt = Date.now();
    ended.push(job);
    if (ended.length > ENDED_KEPT) jobs.splice(jobs.indexOf(ended.shift()), 1);
  }

  async function startJob(code) {
    await self.ready;
    await host.idle();
    // the count and the job are made in one turn of the event loop
    if (jobs.filter((job) => job.state === "running").length >= settings.maxJobs) {
      return answer(settings, jobLimitMessage(settings.maxJobs), true);
    }
    const stopper = new AbortController();
    const job = {
      id: `j${++jobCount}`,
      state: "running",
      startedAt: Date.now(),
      endedAt: null,
      progress: [],
      progressCount: 0,
      answer: null,
      program: records.program(),
      stopper,
    };
    jobs.push(job);
    const onProgress = (line) => {
      job.progress.push(String(line).slice(0, PROGRESS_LINE));
      if (job.progress.length > PROGRESS_KEPT) job.progress.shift();
      job.progressCount += 1;
    };
    job.finished = execute(code, { seconds: settings.backgroundSeconds, program: job.program, onProgress, signal: stopper.signal }).then(
      (result) => endJob(job, result),
      (err) => endJob(job, { ok: false, error: { kind: "error", message: String(err?.message ?? err) }, logs: [] }),
    );
    return answer(settings, jobStarted(job.id));
  }

  /** What `run` answers for one job: its text, with the trail once it has ended, as a fault exactly when it failed. */
  function jobReply(job) {
    const text = formatJob(job, Date.now());
    const isError = job.state === "failed";
    return job.state === "running" ? answer(settings, text, isError) : reply(text, isError, job.program);
  }

  async function askJob(id, stop) {
    const job = jobs.find((candidate) => candidate.id === id);
    if (job === undefined) return answer(settings, noJobMessage(id), true);
    if (stop && job.state === "running") {
      job.stopper.abort();
      await job.finished;
    }
    return jobReply(job);
  }

  async function run(args) {
    const request = runRequest(args);
    if (request.problem !== undefined) return answer(settings, request.problem, true);
    if (request.mode === "jobs") return answer(settings, formatJobs(jobs, Date.now()));
    if (request.mode === "job") return askJob(request.job, request.stop);
    return request.background ? startJob(request.code) : runForeground(request.code);
  }

  self.call = async (name, args) => {
    host.start();
    if (name === "search") return search(args ?? {});
    if (name === "run") return run(args ?? {});
    throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${name}`);
  };
  return self;
}
