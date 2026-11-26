import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as core from "../src/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readRoot = (rel) => readFileSync(join(root, rel), "utf8");
const pkg = () => JSON.parse(readRoot("package.json"));
const lock = () => JSON.parse(readRoot("package-lock.json"));

const VERSION = "0.4.0";

describe("Step 14: the package file at version 0.4.0", () => {
  test("package.json has version 0.4.0, that text exactly", () => {
    const p = pkg();
    assert.equal(p.version, VERSION);
    assert.match(p.version, /^\d+\.\d+\.\d+$/);
  });

  test("the lock has 0.4.0 at the top and in packages['']", () => {
    const l = lock();
    assert.equal(l.version, VERSION);
    assert.equal(l.packages[""].version, VERSION);
  });

  test("every other key and value of package.json is what it was, in this order", () => {
    const p = pkg();
    assert.deepEqual(Object.keys(p), [
      "name", "version", "description", "type", "bin", "engines", "license", "repository",
      "publishConfig", "scripts", "files", "dependencies",
    ]);
    const { version, ...rest } = p;
    assert.deepEqual(rest, {
      name: "@koneeric/onetool",
      description: "One MCP server that runs programs over all the others",
      type: "module",
      bin: { onetool: "bin/onetool.js" },
      engines: { node: ">=22" },
      license: "MIT",
      repository: { type: "git", url: "git+https://github.com/KoneEric/onetool.git" },
      publishConfig: { access: "public" },
      scripts: { test: 'node --test "*/test/**/*.test.js"' },
      files: [
        "auth/src/",
        "bin/",
        "core/src/",
        "guide/pages/",
        "hosts/src/",
        "library/src/",
        "practice/src/",
        "sandbox/src/",
        "server/src/",
        "shell/src/",
      ],
      dependencies: { "@modelcontextprotocol/sdk": "^1.32.2" },
    });
  });

  test("the lock: the other keys at the top and the other keys of packages[''] are what they were", () => {
    const l = lock();
    assert.deepEqual(Object.keys(l), ["name", "version", "lockfileVersion", "requires", "packages"]);
    assert.equal(l.name, "@koneeric/onetool");
    assert.equal(l.lockfileVersion, 3);
    assert.equal(l.requires, true);
    const { version, ...rest } = l.packages[""];
    assert.deepEqual(rest, {
      name: "@koneeric/onetool",
      license: "MIT",
      dependencies: { "@modelcontextprotocol/sdk": "^1.32.2" },
      bin: { onetool: "bin/onetool.js" },
      engines: { node: ">=22" },
    });
  });

  test("the other 95 entries of packages are what they were: no package added, removed or moved", () => {
    // same digest as the check of step 9: the 95 entries other than "", keys sorted at every depth
    const canon = (v) =>
      Array.isArray(v)
        ? v.map(canon)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
          : v;
    const packages = lock().packages;
    const keys = Object.keys(packages).filter((k) => k !== "").sort();
    assert.equal(keys.length, 95);
    const digest = createHash("sha256")
      .update(JSON.stringify(keys.map((k) => [k, canon(packages[k])])))
      .digest("hex");
    assert.equal(digest, "8f0aabde8de8e1f957886a2ace56a97b2b5af6877f2536a5ce6170cc7e7fad2a");
  });

  test("the files stay what npm writes: JSON, two spaces, one line break at the end", () => {
    for (const file of ["package.json", "package-lock.json"]) {
      const text = readRoot(file);
      assert.ok(text.endsWith("}\n") && !text.endsWith("\n\n"), file);
      assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + "\n", file);
    }
  });

  test("no export is added: the number is not in the code of this part", () => {
    const source = readFileSync(join(root, "core", "src", "index.js"), "utf8");
    assert.ok(!source.includes(VERSION));
    assert.ok(!("VERSION" in core) && !("version" in core));
  });
});

describe("Step 14: no file of this part holds a home folder path, an e-mail address or the four words", () => {
  const filesUnder = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)],
    );
  const files = [
    ...filesUnder(join(root, "core", "src")),
    ...filesUnder(join(root, "core", "test")),
    join(root, "package.json"),
    join(root, "package-lock.json"),
  ];
  const words = [["Er", "ic"], ["Ground", "Zero"], ["fac", "tory"], ["ME", "ETS"]].map((h) => h.join(""));

  test("the scan finds the step 14 file", () => {
    assert.ok(files.some((f) => f.endsWith("step14.test.js")));
  });

  for (const file of files) {
    test(file.slice(root.length), () => {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /\/(?:Users|home)\/[A-Za-z0-9_]/);
      assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
      for (const word of words) {
        assert.doesNotMatch(text, new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`), word);
      }
    });
  }
});
