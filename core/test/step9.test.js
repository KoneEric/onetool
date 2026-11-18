import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readRoot = (rel) => readFileSync(join(root, rel), "utf8");
const pkg = () => JSON.parse(readRoot("package.json"));
const lock = () => JSON.parse(readRoot("package-lock.json"));

const FILES = [
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
];

describe("Step 9: the package file of the public copy", () => {
  test("the fields hold exactly the values of the table", () => {
    const p = pkg();
    assert.equal(p.name, "@koneeric/onetool");
    assert.equal(p.type, "module");
    assert.deepEqual(p.bin, { onetool: "bin/onetool.js" });
    assert.deepEqual(p.engines, { node: ">=22" });
    assert.equal(p.license, "MIT");
    assert.deepEqual(p.repository, { type: "git", url: "git+https://github.com/KoneEric/onetool.git" });
    assert.deepEqual(p.publishConfig, { access: "public" });
    assert.deepEqual(p.scripts, { test: 'node --test "*/test/**/*.test.js"' });
    assert.deepEqual(p.dependencies, { "@modelcontextprotocol/sdk": "^1.32.2" });
  });

  test("a non-empty version and description", () => {
    const p = pkg();
    for (const key of ["version", "description"]) {
      assert.equal(typeof p[key], "string", key);
      assert.ok(p[key].length > 0, key);
    }
  });

  test("none of private, author, contributors, devDependencies; no key outside the named ones", () => {
    const p = pkg();
    for (const key of ["private", "author", "contributors", "devDependencies"]) {
      assert.equal(Object.hasOwn(p, key), false, key);
    }
    const allowed = new Set([
      "name", "version", "description", "type", "bin", "engines", "license", "repository",
      "publishConfig", "scripts", "files", "dependencies", "keywords", "homepage", "bugs",
    ]);
    for (const key of Object.keys(p)) assert.ok(allowed.has(key), `unexpected key ${key}`);
  });

  test("files is exactly the list, in this order", () => {
    assert.deepEqual(pkg().files, FILES);
  });

  test("every entry of files names a folder that exists beside package.json", () => {
    for (const entry of pkg().files) {
      const path = join(root, entry);
      assert.ok(existsSync(path) && statSync(path).isDirectory(), `${entry} is not a folder`);
    }
  });

  test("every <name>/src folder beside package.json, release aside, is in files as <name>/src/", () => {
    const files = pkg().files;
    const names = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "release" && d.name !== "node_modules")
      .map((d) => d.name)
      .filter((name) => existsSync(join(root, name, "src")) && statSync(join(root, name, "src")).isDirectory());
    assert.ok(names.includes("core"));
    for (const name of names) assert.ok(files.includes(`${name}/src/`), `${name}/src/ is not in files`);
  });

  test("no entry of files names a folder test", () => {
    for (const entry of pkg().files) {
      assert.ok(!entry.split("/").includes("test"), entry);
    }
  });

  test("the test script is the one quoted pattern, handed to Node and not to the shell", () => {
    assert.deepEqual(Object.keys(pkg().scripts), ["test"]);
    assert.equal(pkg().scripts.test, 'node --test "*/test/**/*.test.js"');
  });
});

describe("Step 9: package-lock.json", () => {
  test("its name and the name of packages[''] are @koneeric/onetool, and that entry has license MIT", () => {
    const l = lock();
    assert.equal(l.name, "@koneeric/onetool");
    assert.equal(l.packages[""].name, "@koneeric/onetool");
    assert.equal(l.packages[""].license, "MIT");
  });

  test("every other entry of packages is what it was before this step", () => {
    // a digest of the 95 entries other than "", keys sorted at every depth
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
});

describe("Step 9: neither file holds an e-mail address or a home folder path", () => {
  for (const file of ["package.json", "package-lock.json"]) {
    test(file, () => {
      const text = readRoot(file);
      assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
      assert.doesNotMatch(text, /\/Users\/|\/home\/|[A-Za-z]:\\Users\\|~\//);
    });
  }
});

describe("Step 9: four words no file of this part holds", () => {
  const words = ["Er" + "ic", "Ground" + "Zero", "fac" + "tory", "ME" + "ETS"];
  const ruleOf = (word) => new RegExp(`(?<![A-Za-z0-9_])${word}(?![A-Za-z0-9_])`);

  const filesUnder = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)],
    );

  const scanned = [
    ...filesUnder(join(root, "core", "src")),
    ...filesUnder(join(root, "core", "test")),
    join(root, "package.json"),
    join(root, "package-lock.json"),
  ];

  test("the files scanned are there", () => {
    assert.ok(scanned.length > 10);
  });

  for (const [i, word] of words.entries()) {
    test(`no file holds word ${i + 1} of the four`, () => {
      const re = ruleOf(word);
      for (const file of scanned) {
        assert.ok(!re.test(readFileSync(file, "utf8")), `${file} holds word ${i + 1}`);
      }
    });
  }

  test("the matching rule: a longer word is not the word", () => {
    const re = ruleOf(words[0]);
    assert.ok(!re.test("Kone" + words[0]));
    assert.ok(re.test(`by ${words[0]}.`));
  });
});
