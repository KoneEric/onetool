import os from "node:os";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ADAPTERS = fileURLToPath(new URL("./adapters", import.meta.url));
const EXPORTS = ["names", "files", "parse", "matches", "ownCall"];

// The adapter modules of the folder, in the order of the file names; one that cannot be loaded is left out.
async function* adapters(folder) {
  let entries;
  try {
    entries = (await readdir(folder)).filter((name) => name.endsWith(".js")).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    const path = join(folder, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      // the stamp makes a file that changed be loaded again
      const url = `${pathToFileURL(path).href}?m=${info.mtimeMs}-${info.size}`;
      const mod = await import(url);
      if (EXPORTS.every((key) => key in mod) && Array.isArray(mod.names)) yield mod;
    } catch {
      // not loadable: left out
    }
  }
}

async function realOf(path) {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

export async function hostRules(hostName, { home = os.homedir(), adaptersFolder = DEFAULT_ADAPTERS } = {}) {
  if (typeof home !== "string" || home === "") throw new TypeError("home must be a non-empty string");
  if (typeof hostName !== "string") return null;
  const wanted = hostName.trim().toLowerCase();
  if (wanted === "") return null;
  let adapter = null;
  for await (const mod of adapters(adaptersFolder)) {
    if (mod.names.includes(wanted)) {
      adapter = mod;
      break;
    }
  }
  if (adapter === null) return null;

  // one entry per file that gave rules: { file, anchors, homes, deny, ask }
  let rules = [];

  async function refresh(roots) {
    const next = [];
    const faults = [];
    const realHome = await realOf(home);
    const homes = realHome === home ? [home] : [home, realHome];
    for (const { file, anchors } of adapter.files(home, roots)) {
      let text;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") faults.push(file);
        continue;
      }
      let parsed;
      try {
        parsed = adapter.parse(text);
        if (!Array.isArray(parsed.deny) || !Array.isArray(parsed.ask)) throw new TypeError("bad lists");
      } catch {
        faults.push(file);
        continue;
      }
      const reals = await Promise.all(anchors.map(realOf));
      const all = [...anchors, ...reals.filter((real, i) => real !== anchors[i])];
      next.push({ file, anchors: all, deny: parsed.deny, ask: parsed.ask });
    }
    rules = next.map((entry) => ({ ...entry, homes }));
    return faults;
  }

  function hit(entry, rule, call) {
    return entry.homes.some((h) => adapter.matches(rule, call, { home: h, anchors: entry.anchors }));
  }

  function decide(call) {
    for (const effect of ["deny", "ask"]) {
      for (const entry of rules) {
        for (const rule of entry[effect]) {
          if (hit(entry, rule, call)) return { effect, file: entry.file, rule };
        }
      }
    }
    return { effect: "none" };
  }

  return {
    host: adapter.names[0],
    refresh,
    decide,
    ownCall: (tool, args, cwd) => adapter.ownCall(tool, args, cwd),
  };
}
