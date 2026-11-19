import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const PAGES = join(ROOT, "guide", "pages");
export const PAGE = join(PAGES, "INSTALL.md");
export const EXAMPLE = join(PAGES, "settings.example.json");

export const HEADINGS = [
  "What you need",
  "Start with onetool init",
  "Try it first",
  "Add onetool to your host program",
  "The settings file",
  "Signing in",
  "Rules: allow, deny, ask",
  "The shell and files",
  "Folders and rules from the host program",
  "Background jobs",
  "The library",
  "Tidying the library",
  "Grouping the work",
  "The trail and the log",
  "When something does not work",
  "What onetool does not do",
];

const base = mkdtempSync(join(realpathSync(tmpdir()), "guide-test-"));
let counter = 0;
process.on("exit", () => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {}
});

/** Writes a text to a new file of its own and gives the path. */
export function tmpFile(name, content) {
  const path = join(base, `f${counter++}-${name}`);
  writeFileSync(path, content, "utf8");
  return path;
}

/** Makes a new empty folder of its own, under the system's temporary folder, and gives the path. */
export function tmpDir(name) {
  const path = join(base, `d${counter++}-${name}`);
  mkdirSync(path);
  return path;
}

export const readPage = () => readFileSync(PAGE, "utf8");

/**
 * Reads the page as the meeting point of guide says: a fenced block is three backquotes at the start of a line, then the tag, to
 * the next line that is three backquotes alone. Headings inside a block are not headings.
 * Gives { lines, headings: [{ level, text, line }], sections: [{ name, text, blocks }], blocks }, where a block is
 * { tag, text, line }, `tag` as written after the backquotes and `text` the lines between the two fences.
 */
export function parsePage(text) {
  const lines = text.split("\n");
  const headings = [];
  const blocks = [];
  const sections = [];
  let current = { name: "", lines: [], blocks: [] };
  sections.push(current);
  let open = null;
  lines.forEach((line, index) => {
    if (open) {
      current.lines.push(line);
      if (line === "```") {
        open.text = lines.slice(open.line + 1, index).join("\n");
        blocks.push(open);
        current.blocks.push(open);
        open = null;
      }
      return;
    }
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      open = { tag: fence[1], text: "", line: index };
      current.lines.push(line);
      return;
    }
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2], line: index });
      if (heading[1].length === 2) {
        current = { name: heading[2], lines: [], blocks: [] };
        sections.push(current);
        return;
      }
    }
    current.lines.push(line);
  });
  for (const section of sections) section.text = section.lines.join("\n");
  return { lines, headings, sections, blocks };
}

export const sectionOf = (page, name) => page.sections.find((section) => section.name === name);

export const jsonBlocks = (blocks) => blocks.filter((block) => block.tag === "json");

// ---- the real command ----------------------------------------------------------------------------------------------

const textOf = (result) =>
  (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");

/**
 * The example settings file, copied in the system's temporary folder, equal to it as a value save one key added to
 * its `onetool`, `"log": false` (the meeting point of guide, "Step 5", "The runs through the real thing"). Gives the path.
 */
export function exampleCopy() {
  const settings = JSON.parse(readFileSync(EXAMPLE, "utf8"));
  settings.onetool = { ...settings.onetool, log: false };
  return tmpFile("settings.example.json", JSON.stringify(settings));
}

/**
 * A host program in front of one onetool process, the package's own client on standard input and output, working
 * folder the root of the repository. With `canAsk` it declares elicitation and answers every question `{ action:
 * "accept" }`, keeping the questions in `questions`. With `roots`, a list of folders, it declares the roots feature
 * and answers `roots/list` with them as `file://` addresses. Since step 7 the command always starts with `HOME` set to a
 * folder the test made (the meeting point of guide, "Step 7", "The runs through the real thing"): `home` when given, else a new
 * empty one; it is in `home` of the result.
 */
export async function host(command, args, { canAsk = false, roots, home = tmpDir("home") } = {}) {
  const transport = new StdioClientTransport({ command, args, cwd: ROOT, stderr: "pipe", env: { HOME: home } });
  const capabilities = { ...(canAsk ? { elicitation: {} } : {}), ...(roots === undefined ? {} : { roots: {} }) };
  const client = new Client({ name: "guide-test", version: "1.0.0" }, { capabilities });
  const self = { client, questions: [], home };
  if (roots !== undefined) {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: roots.map((folder) => ({ uri: pathToFileURL(folder).href })),
    }));
  }
  if (canAsk) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      self.questions.push(request.params);
      return { action: "accept" };
    });
  }
  await client.connect(transport);
  self.run = async (code) => {
    const result = await client.callTool({ name: "run", arguments: { code } });
    return { text: textOf(result), isError: result.isError === true };
  };
  /** One call of the tool `run` with the arguments as given: `{ code, background }`, `{ job }`, `{ jobs: true }`. */
  self.call = async (args) => {
    const result = await client.callTool({ name: "run", arguments: args });
    return { text: textOf(result), isError: result.isError === true };
  };
  self.search = async (words) =>
    textOf(await client.callTool({ name: "search", arguments: words === undefined ? {} : { words } }));
  self.close = () => client.close().catch(() => {});
  return self;
}
