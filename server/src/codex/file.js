// Executed by command/exec so configured Codex filesystem permissions also apply to edits.
import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const [action, raw] = process.argv.slice(2);
try {
  const args = JSON.parse(raw);
  const root = realpathSync(process.cwd());
  const target = resolve(root, args.file_path);
  const parent = realpathSync(dirname(target));
  const path = join(parent, basename(target));
  const rel = relative(root, path);
  if (!rel || rel.split(/[\\/]/)[0] === ".." || isAbsolute(rel)) throw new Error("File must be inside the project.");
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw new Error("Expected a regular file.");
  function read() {
    if (info?.size > 1024 * 1024) throw new Error("File is larger than 1 MiB.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
  }
  if (action === "Read") {
    process.stdout.write(JSON.stringify({ content: read() }));
  } else {
    let content = args.content;
    if (action === "Edit") {
      const parts = read().split(args.old_string);
      if (parts.length === 1) throw new Error("Old text was not found.");
      if (parts.length > 2 && !args.replace_all) throw new Error("Old text occurs more than once. Use replace_all or provide more context.");
      content = parts.join(args.new_string);
    }
    const tmp = join(parent, ".onetool-" + randomUUID());
    try {
      writeFileSync(tmp, content, { flag: "wx", mode: 0o600 });
      if (info) chmodSync(tmp, info.mode & 0o777);
      const current = lstatSync(path, { throwIfNoEntry: false });
      if (current?.ino !== info?.ino || current?.ctimeMs !== info?.ctimeMs) {
        throw new Error("The file changed during this operation. Read it again.");
      }
      renameSync(tmp, path);
    } finally {
      try { unlinkSync(tmp); } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    process.stdout.write(JSON.stringify({ file_path: path, bytes: Buffer.byteLength(content) }));
  }
} catch (error) {
  process.stderr.write(error.message + "\n");
  process.exitCode = 1;
}
