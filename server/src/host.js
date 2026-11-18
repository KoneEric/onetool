// What onetool knows of the host program: its roots (the folders of the shell) and its own permission rules.
import os from "node:os";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { rootFolders } from "../../core/src/index.js";
import { missingFolders } from "../../shell/src/index.js";
import { hostRules } from "../../hosts/src/index.js";

const say = (line) => process.stderr.write(`${line}\n`);

/**
 * The host's side of one session. `server` is the `Server` that speaks to the host. Readings of the roots are made one
 * after the other; `idle()` resolves when none is in progress or waits for its turn.
 */
export function makeHost(settings, server) {
  const shell = settings.shell;
  const wanted = settings.hostRules && (shell !== null || settings.hostServers.length > 0);
  const needsFolders = shell !== null && shell.folders === null;
  let folders = [];
  let rules = null;
  let begun = false;
  let tail = Promise.resolve();
  const unreadableTold = new Set();

  const hasFolders = () => shell !== null && inEffect().length > 0;
  const inEffect = () => (shell === null ? [] : (shell.folders ?? folders));

  async function read() {
    let found = [];
    try {
      const answer = await server.listRoots(undefined, { timeout: settings.connectSeconds * 1000 });
      const list = rootFolders(answer.roots);
      const missing = new Set(await missingFolders(list));
      found = list.filter((_, position) => !missing.has(position));
    } catch {
      found = [];
    }
    folders = found;
  }

  function enqueue(task) {
    tail = tail.then(task, task);
    return tail;
  }

  async function readRoots(first) {
    if (!(needsFolders || rules !== null) || server.getClientCapabilities()?.roots === undefined) return;
    const before = hasFolders();
    await read();
    if (!first && needsFolders && hasFolders() !== before) {
      try {
        await server.sendToolListChanged();
      } catch {
        // a failure of the sending is ignored
      }
    }
  }

  async function first() {
    if (wanted) {
      try {
        rules = await hostRules(server.getClientVersion()?.name, { home: os.homedir() });
      } catch {
        rules = null;
      }
      if (rules === null) say("onetool: host rules: this host program is not known, onetool's own rules only");
    }
    await readRoots(true);
  }

  const self = {
    /** The host's rules, or `null` when they are not in use. */
    get rules() {
      return rules;
    },
    /** The folders in effect, and whether the shell has some. */
    folders: inEffect,
    hasFolders,
    /** Begins the first reading, once. */
    start() {
      if (begun) return;
      begun = true;
      void enqueue(first);
    },
    /** Resolves when no reading is in progress or waiting for its turn. */
    async idle() {
      let seen;
      do {
        seen = tail;
        await seen;
      } while (seen !== tail);
    },
    /** The host's files are read again, for a program about to start. */
    async refresh() {
      if (rules === null) return;
      let unreadable = [];
      try {
        unreadable = await rules.refresh(folders);
      } catch {
        return;
      }
      for (const file of unreadable) {
        if (unreadableTold.has(file)) continue;
        unreadableTold.add(file);
        say(`onetool: host rules: ${file} cannot be read, its rules are not applied`);
      }
    },
  };

  server.oninitialized = () => self.start();
  server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
    if (!begun) return self.start();
    void enqueue(() => readRoots(false));
    return undefined;
  });
  return self;
}
