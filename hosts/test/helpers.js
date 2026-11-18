import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

// Every test makes its own tree in the system's temporary folder: a home, roots, adapter folders.
// Nothing here reads a file of the person's own home.

export function makeBase() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "hosts-test-")));
  // so that an adapter file written under the base is an ES module whatever the Node version's detection
  writeFileSync(join(base, "package.json"), '{"type":"module"}');
  const home = join(base, "home");
  mkdirSync(home);
  const T = {
    base,
    home,
    adapters: join(base, "adapters"),
    folder(...parts) {
      const dir = join(base, ...parts);
      mkdirSync(dir, { recursive: true });
      return dir;
    },
    write(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
      return path;
    },
    settings(dir, rel, permissions) {
      return T.write(join(dir, ...rel.split("/")), { permissions });
    },
    cleanup() {
      rmSync(base, { recursive: true, force: true });
    },
  };
  return T;
}

export function baseTest(name, fn) {
  test(name, async () => {
    const T = makeBase();
    try {
      await fn(T);
    } finally {
      T.cleanup();
    }
  });
}

let counter = 0;

// Writes an adapter file that hands every call to hooks that the test keeps in a global of its own, so that a
// test sees what `index.js` gave the adapter. Returns the hooks object, to be filled in or changed by the test.
export function writeAdapter(T, fileName, names, hooks = {}) {
  const id = `h${process.pid}_${++counter}`;
  globalThis.__hostsTest ??= {};
  const all = {
    files: () => [],
    parse: (text) => ({ deny: [], ask: [], allow: [], ...JSON.parse(text) }),
    matches: (rule, call) => rule === call.command,
    ownCall: () => null,
    ...hooks,
  };
  globalThis.__hostsTest[id] = all;
  T.write(
    join(T.adapters, fileName),
    `const H = () => globalThis.__hostsTest[${JSON.stringify(id)}];
export const names = ${JSON.stringify(names)};
export const files = (home, roots) => H().files(home, roots);
export const parse = (text) => H().parse(text);
export const matches = (rule, call, ctx) => H().matches(rule, call, ctx);
export const ownCall = (tool, args, cwd) => H().ownCall(tool, args, cwd);
`,
  );
  return all;
}

export const run = (command) => ({ action: "run", command });
export const on = (action, ...paths) => ({ action, paths });

// A recursive listing with contents, to show that a call wrote nothing.
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isDirectory()) {
        out[p] = "<dir>";
        walk(p);
      } else if (st.isSymbolicLink()) {
        out[p] = "<link>";
      } else {
        out[p] = readFileSync(p, "utf8");
      }
    }
  };
  walk(dir);
  return out;
}
