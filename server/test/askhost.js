// A host program for the tests of "Step 3: `ask`": onetool as a process, spoken to in raw JSON-RPC lines, with
// the capabilities the test gives and the questions (elicitation/create) answered as the test says.
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { BIN, ROOT, sleep, tmpDir, waitFor, writeSettings } from "./helpers.js";

/**
 * What a question gets back is what `answer(question, host)` returns, or a promise of it:
 *   { action: "accept" | "decline" | "cancel", content? }   the result of the host
 *   { error: { code, message } }                            a JSON-RPC error
 *   { raw: <value> }                                        any other result, as it is
 *   undefined                                               no answer for now: `question.reply(outcome)` later
 *
 * Since step 5 the host can also be asked for its roots (`roots/list`). `name` is the name it gives, `env` is added to
 * the environment of the process (`HOME`), `roots` the folders it answers (a list the test may change with
 * `host.setRoots`; declare the capability in `capabilities`), `rootsAnswer(request, host)` an answer of its own, in the
 * forms above (`request.reply(outcome)` later when it gives `undefined`), and `initialized: false` holds back the
 * notification that says the host is ready (`host.sendInitialized()` sends it).
 */
export async function startHost(
  settings,
  { capabilities = { elicitation: {} }, answer, cwd = ROOT, name = "ask-host", env, roots, rootsAnswer, initialized = true } = {},
) {
  const path = typeof settings === "string" ? settings : writeSettings(settings);
  const child = spawn(process.execPath, [BIN, "--config", path], {
    cwd,
    // HOME is a folder the test made (the meeting point of server, "Step 7: what every test of this part sets"), unless `env` gives one
    env: { ...process.env, HOME: tmpDir(), ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  const host = {
    child,
    path,
    /** every question received, in order: { id, params, message, reply(outcome) } */
    questions: [],
    /** what the host saw from onetool, in order: { kind: "question" | "cancelled", ... } */
    events: [],
    /** every request of onetool to the host that is neither a question nor a request for the roots */
    others: [],
    /** every request for the roots, in order: { id, reply(outcome) } */
    rootsRequests: [],
    /** the folders the host answers to `roots/list`; the test may change them with `setRoots` */
    roots: roots === undefined ? [] : [...roots],
    /** how many `notifications/tools/list_changed` came */
    listChanged: 0,
  };
  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (err += chunk));
  child.stdin.on("error", () => {});
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

  function onQuestion(message) {
    const question = {
      id: message.id,
      params: message.params,
      message: message.params?.message,
      reply(outcome) {
        if (outcome?.error) send({ id: message.id, error: outcome.error });
        else send({ id: message.id, result: outcome && "raw" in outcome ? outcome.raw : outcome });
      },
    };
    host.questions.push(question);
    host.events.push({ kind: "question", question });
    const outcome = answer?.(question, host);
    if (outcome !== undefined) {
      Promise.resolve(outcome).then((settled) => {
        if (settled !== undefined) question.reply(settled);
      });
    }
  }

  function onRoots(message) {
    const request = {
      id: message.id,
      reply(outcome) {
        if (outcome?.error) send({ id: message.id, error: outcome.error });
        else send({ id: message.id, result: outcome && "raw" in outcome ? outcome.raw : outcome });
      },
    };
    host.rootsRequests.push(request);
    const outcome = rootsAnswer
      ? rootsAnswer(request, host)
      : { roots: host.roots.map((folder) => ({ uri: pathToFileURL(folder).href })) };
    if (outcome !== undefined) {
      Promise.resolve(outcome).then((settled) => {
        if (settled !== undefined) request.reply(settled);
      });
    }
  }

  function onMessage(message) {
    if (message.method === "notifications/tools/list_changed") {
      host.listChanged += 1;
      return undefined;
    }
    if (message.method !== undefined && message.id !== undefined) {
      if (message.method === "elicitation/create") return onQuestion(message);
      if (message.method === "roots/list" && roots !== undefined) return onRoots(message);
      host.others.push(message);
      return message.method === "ping"
        ? send({ id: message.id, result: {} })
        : send({ id: message.id, error: { code: -32601, message: `no method ${message.method}` } });
    }
    if (message.method === "notifications/cancelled") {
      host.events.push({ kind: "cancelled", requestId: message.params?.requestId });
      return undefined;
    }
    if (message.method === undefined && waiting.has(message.id)) {
      waiting.get(message.id)(message);
      waiting.delete(message.id);
    }
    return undefined;
  }

  child.stdout.on("data", (chunk) => {
    out += chunk;
    let at;
    while ((at = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, at);
      out = out.slice(at + 1);
      if (line === "") continue;
      try {
        onMessage(JSON.parse(line));
      } catch {}
    }
  });
  host.exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  const rejects = new Map();
  host.exited.then(({ code, signal }) => {
    for (const reject of rejects.values()) reject(new Error(`the process ended (code ${code}, signal ${signal})`));
  });

  let nextId = 1;
  host.stderr = () => err;
  host.request = (method, params, ms = 20000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), ms);
      rejects.set(id, (error) => {
        clearTimeout(timer);
        reject(error);
      });
      waiting.set(id, (message) => {
        clearTimeout(timer);
        rejects.delete(id);
        resolve(message);
      });
      send({ id, method, params });
    });
  };
  /** The result of the tool `name`, as { text, isError }; fails when it is not one text item. */
  host.call = async (name, args, ms) => {
    const message = await host.request("tools/call", { name, arguments: args }, ms);
    if (message.error) throw new Error(`error ${message.error.code}: ${message.error.message}`);
    const { content, isError } = message.result;
    if (!Array.isArray(content) || content.length !== 1 || content[0].type !== "text") {
      throw new Error(`not one text item: ${JSON.stringify(message.result)}`);
    }
    return { text: content[0].text, isError: isError === true };
  };
  host.run = (code, ms) => host.call("run", { code }, ms);
  /** The tools of `tools/list`. */
  host.listTools = async () => {
    const message = await host.request("tools/list", {});
    if (message.error) throw new Error(`error ${message.error.code}: ${message.error.message}`);
    return message.result.tools;
  };
  /** The description of the tool `run` of `tools/list`. */
  host.description = async () => (await host.listTools()).find((tool) => tool.name === "run")?.description ?? "";
  host.sendInitialized = () => send({ method: "notifications/initialized" });
  /** The host changes its folders and says so. */
  host.setRoots = (folders) => {
    host.roots = [...folders];
    send({ method: "notifications/roots/list_changed" });
  };
  host.notify = (method, params) => send({ method, params });
  host.search = async (words) => (await host.call("search", words === undefined ? {} : { words })).text;
  /** What the listed server `fake` recorded (it must not be under ask: its tool `calls`). */
  host.recorded = async () => JSON.parse((await host.run("await tools.fake.calls({})")).text);
  /** Waits until `count` questions have come, and gives them. */
  host.waitQuestions = async (count, ms = 5000) => {
    await waitFor(() => host.questions.length >= count, ms, `${count} question(s) (got ${host.questions.length})`);
    return host.questions;
  };
  host.within = async (ms = 5000) => {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the process was still there after ${ms} ms`)), ms);
    });
    try {
      return await Promise.race([host.exited, late]);
    } finally {
      clearTimeout(timer);
    }
  };
  host.endBy = (signal, ms = 5000) => {
    child.kill(signal);
    return host.within(ms);
  };
  host.kill = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };

  const initializeAnswer = await host.request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities,
    clientInfo: { name, version: "0.0.0" },
  });
  if (initializeAnswer.error) throw new Error(`initialize: ${initializeAnswer.error.message}`);
  host.initializeResult = initializeAnswer.result;
  if (initialized) send({ method: "notifications/initialized" });
  return host;
}

/** Runs `fn(host)` and kills the process after it, whatever happens. */
export async function withHost(settings, options, fn) {
  const host = await startHost(settings, options);
  try {
    return await fn(host);
  } finally {
    host.kill();
    await host.exited;
  }
}

/** A short pause, for what must NOT happen. */
export const pause = (ms = 400) => sleep(ms);

/** The text of a program that calls `call` and says what came of it: `[true, <message>]` for a rejection. */
export const CAUGHT = (call) =>
  `try { await ${call}; return JSON.stringify(["answered"]); } catch (e) { return JSON.stringify([e instanceof Error, e.message]); }`;
