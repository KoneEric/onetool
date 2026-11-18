// The commands `onetool login` and `onetool logout`: the arguments, and what each prints. The sign-in itself is part `auth`'s.
import { spawn } from "node:child_process";
import { browserCommand, login, logout } from "../../auth/src/index.js";
import { signsIn } from "../../core/src/index.js";

export const LOGIN_USAGE = "usage: onetool login <server> --config <settings file> [--no-browser] [--wait <seconds>]";
export const LOGOUT_USAGE = "usage: onetool logout <server> --config <settings file>";

const WAIT_DEFAULT = 300;

/**
 * The arguments of `login` or `logout` (`word` is the first, `rest` the others): `{ server, config, noBrowser, waitSeconds }`,
 * or `null` when they are not as the table says.
 */
export function parseSignArgs(word, rest) {
  const isLogin = word === "login";
  if (rest.length === 0 || rest[0] === "") return null;
  const parsed = { server: rest[0], config: null, noBrowser: false, waitSeconds: WAIT_DEFAULT };
  let waitSeen = false;
  for (let i = 1; i < rest.length; i += 1) {
    const option = rest[i];
    if (option === "--config" && parsed.config === null) {
      if (i + 1 >= rest.length) return null;
      parsed.config = rest[(i += 1)];
    } else if (isLogin && option === "--no-browser" && !parsed.noBrowser) {
      parsed.noBrowser = true;
    } else if (isLogin && option === "--wait" && !waitSeen) {
      if (i + 1 >= rest.length || !/^[0-9]+$/.test(rest[i + 1])) return null;
      const seconds = Number(rest[(i += 1)]);
      if (seconds < 1 || seconds > 3600) return null;
      parsed.waitSeconds = seconds;
      waitSeen = true;
    } else {
      return null;
    }
  }
  return parsed.config === null ? null : parsed;
}

const out = (line) => process.stdout.write(`${line}\n`);

// the last line is flushed, then the process ends at once, whatever is still in flight
function finish(stream, line, code) {
  stream.on("error", () => {});
  stream.write(`${line}\n`, () => process.exit(code));
  return new Promise(() => {});
}

/** Starts the browser on `address` and does not wait for it; a program that cannot be started is ignored. */
function openBrowser(address) {
  const command = browserCommand(address);
  if (command === null) return;
  try {
    const child = spawn(command[0], command.slice(1), { stdio: "ignore", detached: true, shell: false });
    child.on("error", () => {});
    child.unref();
  } catch {
    // the printed address is the way
  }
}

/** One sign-in, then the end of the process. `settings` is what `readSettings` gave. */
export async function runLogin(server, settings, { noBrowser, waitSeconds }) {
  const entry = settings.servers.find((candidate) => candidate.name === server);
  if (entry === undefined) return fail(`onetool: login: ${server} is not a server of the settings file`);
  if (!Object.hasOwn(entry, "url")) return fail(`onetool: login: ${server} is started by a command, there is nothing to sign in to`);
  if (!signsIn(entry)) return fail(`onetool: login: ${server} has an Authorization header in the settings file`);
  let result;
  try {
    result = await login(
      { name: entry.name, url: entry.url, oauth: entry.oauth },
      {
        waitSeconds,
        say: (address) => out(`onetool: to sign in to ${server}, open ${address}`),
        ...(noBrowser ? {} : { open: openBrowser }),
      },
    );
  } catch {
    result = { ok: false, reason: "the sign-in could not be started" };
  }
  if (result.ok) {
    return finish(process.stdout, `onetool: signed in to ${server}`, 0);
  }
  return fail(`onetool: login: ${server}: ${result.reason}`);
}

/** The sign-in of `server` is forgotten, then the end of the process. */
export function runLogout(server) {
  let had;
  try {
    had = logout(server);
  } catch {
    return fail(`onetool: logout: ${server}: the sign-in could not be removed`);
  }
  return finish(process.stdout, had ? `onetool: signed out of ${server}` : `onetool: ${server} had no sign-in`, 0);
}

const fail = (line) => finish(process.stderr, line, 1);
