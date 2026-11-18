// The adapter of Claude Code: what its own permission rules (`deny`, `ask`, `allow` of its settings files)
// say of one call. A close copy of the host's matching, wider where a difference can only tighten.
import { join, resolve } from "node:path";

export const names = ["claude-code"];

export function files(home, roots) {
  const out = [{ file: join(home, ".claude", "settings.json"), anchors: [...roots] }];
  for (const root of roots) {
    out.push({ file: join(root, ".claude", "settings.json"), anchors: [root] });
    out.push({ file: join(root, ".claude", "settings.local.json"), anchors: [root] });
  }
  return out;
}

function list(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("a permission list is not a list");
  return value.filter((item) => typeof item === "string");
}

export function parse(text) {
  const data = JSON.parse(text);
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("not a settings file");
  const permissions = data.permissions;
  if (permissions === undefined) return { deny: [], ask: [], allow: [] };
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    throw new TypeError("permissions is not an object");
  }
  return { deny: list(permissions.deny), ask: list(permissions.ask), allow: list(permissions.allow) };
}

// The actions each tool name of a rule speaks of.
const ACTIONS = { Bash: ["run"], Read: ["read"], Edit: ["edit", "write"], Write: ["write"] };

// -> { name, spec } with spec null when the rule has no parentheses, or null when it is not a rule that is read.
function readRule(rule) {
  const text = rule.trim();
  const open = text.indexOf("(");
  let name = text;
  let spec = null;
  if (open !== -1) {
    if (!text.endsWith(")")) return null;
    name = text.slice(0, open);
    spec = text.slice(open + 1, -1);
  }
  return Object.hasOwn(ACTIONS, name) ? { name, spec } : null;
}

// `*` stands for any run of characters; with `single`, `?` stands for one character. Everything else stands for itself.
function wild(pattern, text, single) {
  const p = Array.from(pattern);
  const s = Array.from(text);
  let pi = 0;
  let si = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (p[pi] === "*") {
      star = pi++;
      mark = si;
    } else if (pi < p.length && (p[pi] === s[si] || (single && p[pi] === "?"))) {
      pi++;
      si++;
    } else if (star >= 0) {
      pi = star + 1;
      si = ++mark;
    } else {
      return false;
    }
  }
  while (p[pi] === "*") pi++;
  return pi === p.length;
}

function candidates(command) {
  const whole = command.trim();
  const pieces = whole.split(/[;&|\r\n]/).map((piece) => piece.trim()).filter((piece) => piece !== "");
  return [whole, ...pieces];
}

function matchesCommand(spec, command) {
  return candidates(command).some((candidate) => {
    if (spec.endsWith(":*")) return candidate.startsWith(spec.slice(0, -2));
    if (wild(spec, candidate, false)) return true;
    return spec.endsWith(" *") && wild(spec.slice(0, -2), candidate, false);
  });
}

const noSlashEnd = (text) => text.replace(/\/+$/, "");

function patternsOf(spec, home, anchors) {
  let out;
  if (spec.startsWith("//")) out = [spec.slice(1)];
  else if (spec.startsWith("~/")) out = [noSlashEnd(home) + spec.slice(1)];
  else if (spec.startsWith("/")) out = anchors.map((anchor) => noSlashEnd(anchor) + spec);
  else if (spec.startsWith("./")) out = anchors.map((anchor) => noSlashEnd(anchor) + spec.slice(1));
  else if (spec.slice(0, -1).includes("/")) out = anchors.map((anchor) => `${noSlashEnd(anchor)}/${spec}`);
  else out = anchors.map((anchor) => `${noSlashEnd(anchor)}/**/${spec}`);
  return out.map((pattern) => (pattern.endsWith("/") ? pattern.slice(0, -1) : pattern));
}

// The pattern is used up: what is left of the path is a folder's content, which the rule on the folder covers.
function matchPieces(pattern, pi, path, si) {
  if (pi === pattern.length) return true;
  if (pattern[pi] === "**") {
    for (let k = si; k <= path.length; k++) if (matchPieces(pattern, pi + 1, path, k)) return true;
    return false;
  }
  return si < path.length && wild(pattern[pi], path[si], true) && matchPieces(pattern, pi + 1, path, si + 1);
}

function matchesPath(spec, paths, home, anchors) {
  const patterns = patternsOf(spec, home, anchors).map((pattern) => pattern.split("/"));
  return patterns.some((pattern) => paths.some((path) => matchPieces(pattern, 0, path.split("/"), 0)));
}

export function matches(rule, call, { home, anchors }) {
  const read = readRule(rule);
  if (read === null || !ACTIONS[read.name].includes(call.action)) return false;
  if (read.spec === null || read.spec === "") return true;
  if (call.action === "run") return matchesCommand(read.spec, call.command);
  return matchesPath(read.spec, call.paths, home, anchors);
}

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function ownCall(tool, args, cwd) {
  if (!isPlainObject(args)) return null;
  if (tool === "Bash") return typeof args.command === "string" ? { action: "run", command: args.command } : null;
  if (tool === "Read" || tool === "Edit" || tool === "Write") {
    if (typeof args.file_path !== "string" || args.file_path === "") return null;
    return { action: tool.toLowerCase(), paths: [resolve(cwd, args.file_path)] };
  }
  return null;
}
