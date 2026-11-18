import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync, realpathSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { realPlace, missingFolders, readFile, writeFile, editFile } from "../src/index.js";
import { treeTest, fault, makeTree } from "./helpers.js";

const outsideMessage = (path) => `${path} is outside the listed folders`;
const BAD_PATH = "the path must be a text that is not empty";

describe("realPlace: step 1, the path is a text", () => {
  treeTest("not a string, or the empty string: the message, outside false", async (T) => {
    for (const bad of [undefined, null, 5, {}, [], ["a.txt"], true, ""]) {
      await fault(realPlace(bad, T.folders), BAD_PATH);
    }
  });

  treeTest("a path of white space only is a path like any other", async (T) => {
    assert.equal(await realPlace("  ", T.folders), join(T.realW, "  "));
    assert.equal(await realPlace("\t", T.folders), join(T.realW, "\t"));
  });
});

describe("realPlace: the table of paths, folders [W, X]", () => {
  treeTest("`a.txt` and `./sub/../a.txt`: the real place of W/a.txt", async (T) => {
    assert.equal(await realPlace("a.txt", T.folders), join(T.realW, "a.txt"));
    // `sub` does not exist: `..` is worked out on the names alone
    assert.equal(await realPlace("./sub/../a.txt", T.folders), join(T.realW, "a.txt"));
  });

  treeTest("`..` is worked out on the names alone, also past a symbolic link", async (T) => {
    symlinkSync(T.O, join(T.W, "linkdir"));
    assert.equal(await realPlace("linkdir/../a.txt", T.folders), join(T.realW, "a.txt"));
    mkdirSync(join(T.W, "sub"));
    assert.equal(await realPlace("sub/../a.txt", T.folders), join(T.realW, "a.txt"));
  });

  treeTest("`../a.txt`, `sub/../../a.txt`, `/etc/hosts`: outside", async (T) => {
    for (const path of ["../a.txt", "sub/../../a.txt", "/etc/hosts", "../outside/secret.txt", "../work2/a.txt"]) {
      await fault(realPlace(path, T.folders), outsideMessage(path), true);
    }
  });

  treeTest("a full path with `..` is worked out too: inside or outside by where it lands", async (T) => {
    mkdirSync(join(T.W, "sub"));
    assert.equal(await realPlace(join(T.W, "sub", "..", "a.txt"), T.folders), join(T.realW, "a.txt"));
    const out = `${T.W}/../work2/a.txt`;
    await fault(realPlace(out, T.folders), outsideMessage(out), true);
  });

  treeTest("the full path of a file in X: its real place", async (T) => {
    assert.equal(await realPlace(join(T.X, "x.txt"), T.folders), join(T.realX, "x.txt"));
    assert.equal(await realPlace(join(T.X, "not-yet.txt"), T.folders), join(T.realX, "not-yet.txt"));
  });

  treeTest("the first folder is where a relative path starts, not another", async (T) => {
    assert.equal(await realPlace("x.txt", [T.X, T.W]), join(T.realX, "x.txt"));
    assert.equal(await realPlace("a.txt", [T.X, T.W]), join(T.realX, "a.txt"));
  });

  treeTest("the full path of W itself, or `.`: the real place of W", async (T) => {
    assert.equal(await realPlace(T.W, T.folders), T.realW);
    assert.equal(await realPlace(".", T.folders), T.realW);
    assert.equal(await realPlace(T.X, T.folders), T.realX);
  });

  treeTest("W itself: the three file functions say `not a file`", async (T) => {
    const opts = { folders: T.folders };
    await fault(readFile(".", opts), ".: not a file");
    await fault(readFile(T.W, opts), `${T.W}: not a file`);
    await fault(writeFile(".", "x", opts), ".: not a file");
    await fault(writeFile(T.W, "x", opts), `${T.W}: not a file`);
    await fault(editFile(".", "a", "b", opts), ".: not a file");
    await fault(editFile(T.W, "a", "b", opts), `${T.W}: not a file`);
  });

  treeTest("a file of W2, whose name starts with the name of W: outside", async (T) => {
    const full = join(T.W2, "a.txt");
    await fault(realPlace(full, T.folders), outsideMessage(full), true);
    await fault(realPlace(T.W2, T.folders), outsideMessage(T.W2), true);
    // the same with the real names of both
    const real = join(T.realW + "2", "a.txt");
    await fault(realPlace(real, T.folders), outsideMessage(real), true);
  });

  treeTest("`link.txt`, a link in W to a file outside W and X: outside", async (T) => {
    symlinkSync(join(T.O, "secret.txt"), join(T.W, "link.txt"));
    await fault(realPlace("link.txt", T.folders), outsideMessage("link.txt"), true);
    symlinkSync(join("..", "outside", "secret.txt"), join(T.W, "rel.txt"));
    await fault(realPlace("rel.txt", T.folders), outsideMessage("rel.txt"), true);
  });

  treeTest("`linkdir/a.txt`, `linkdir` a link in W to a folder outside: outside", async (T) => {
    symlinkSync(T.O, join(T.W, "linkdir"));
    await fault(realPlace("linkdir/a.txt", T.folders), outsideMessage("linkdir/a.txt"), true);
    await fault(realPlace("linkdir/new.txt", T.folders), outsideMessage("linkdir/new.txt"), true);
    await fault(realPlace("linkdir/dir/a.txt", T.folders), outsideMessage("linkdir/dir/a.txt"), true);
    await fault(realPlace("linkdir", T.folders), outsideMessage("linkdir"), true);
  });

  treeTest("`in.txt`, a link in W to another file of W or of X: the real place of that file", async (T) => {
    writeFileSync(join(T.W, "target.txt"), "T");
    symlinkSync(join(T.W, "target.txt"), join(T.W, "in.txt"));
    symlinkSync(join("..", "extra", "x.txt"), join(T.W, "inx.txt"));
    symlinkSync("target.txt", join(T.W, "rel.txt"));
    symlinkSync(T.X, join(T.W, "linkx"));
    assert.equal(await realPlace("in.txt", T.folders), join(T.realW, "target.txt"));
    assert.equal(await realPlace("inx.txt", T.folders), join(T.realX, "x.txt"));
    assert.equal(await realPlace("rel.txt", T.folders), join(T.realW, "target.txt"));
    assert.equal(await realPlace("linkx/x.txt", T.folders), join(T.realX, "x.txt"));
    assert.equal(await realPlace("linkx/new.txt", T.folders), join(T.realX, "new.txt"));
  });

  treeTest("`dangling.txt`, a link in W to a path where nothing is: outside, whatever it points to", async (T) => {
    symlinkSync(join(T.O, "nothing"), join(T.W, "dangling.txt"));
    symlinkSync(join(T.W, "nothing"), join(T.W, "dangling-in.txt"));
    symlinkSync("no-such-name", join(T.W, "dangling-rel.txt"));
    symlinkSync(join(T.O, "nothing"), join(T.W, "dangling-dir"));
    for (const path of ["dangling.txt", "dangling-in.txt", "dangling-rel.txt", "dangling-dir/new.txt"]) {
      await fault(realPlace(path, T.folders), outsideMessage(path), true);
    }
  });

  treeTest("a loop of links: outside", async (T) => {
    symlinkSync("l2", join(T.W, "l1"));
    symlinkSync("l1", join(T.W, "l2"));
    symlinkSync("l1", join(T.W, "self"));
    await fault(realPlace("l1", T.folders), outsideMessage("l1"), true);
    await fault(realPlace("l2/a.txt", T.folders), outsideMessage("l2/a.txt"), true);
  });

  treeTest("`new.txt` where nothing is: the real place of W joined with `new.txt`", async (T) => {
    assert.equal(await realPlace("new.txt", T.folders), join(T.realW, "new.txt"));
  });

  treeTest("a file in a folder that does not exist yet has a real place", async (T) => {
    assert.equal(await realPlace("nodir/deeper/new.txt", T.folders), join(T.realW, "nodir", "deeper", "new.txt"));
  });

  treeTest("a new file under a link to a folder of W: the real place goes through the link", async (T) => {
    mkdirSync(join(T.W, "real"));
    symlinkSync(join(T.W, "real"), join(T.W, "alias"));
    assert.equal(await realPlace("alias/new.txt", T.folders), join(T.realW, "real", "new.txt"));
  });

  treeTest("upper and lower case, spaces and non-ASCII characters are kept as given", async (T) => {
    mkdirSync(join(T.W, "Sp ace"));
    assert.equal(await realPlace("Sp ace/é ✓ Ünï.TXT", T.folders), join(T.realW, "Sp ace", "é ✓ Ünï.TXT"));
    assert.equal(await realPlace("Sp ace/new file.txt", T.folders), join(T.realW, "Sp ace", "new file.txt"));
  });

  treeTest("a listed folder that is gone holds nothing", async (T) => {
    const gone = join(T.root, "gone");
    const inGone = join(gone, "a.txt");
    await fault(realPlace(inGone, [T.W, gone]), outsideMessage(inGone), true);
    // gone as the first folder: a relative path starts there and is outside, W still holds its own
    await fault(realPlace("a.txt", [gone, T.W]), outsideMessage("a.txt"), true);
    assert.equal(await realPlace(join(T.W, "a.txt"), [gone, T.W]), join(T.realW, "a.txt"));
  });

  treeTest("a listed folder that is a link leading nowhere holds nothing", async (T) => {
    const dead = join(T.root, "dead");
    symlinkSync(join(T.root, "nowhere"), dead);
    const inDead = join(dead, "a.txt");
    await fault(realPlace(inDead, [T.W, dead]), outsideMessage(inDead), true);
  });

  treeTest("does not change its arguments", async (T) => {
    const folders = Object.freeze([T.W, T.X]);
    assert.equal(await realPlace("a.txt", folders), join(T.realW, "a.txt"));
    assert.deepEqual([...folders], [T.W, T.X]);
  });
});

describe("realPlace: the same results when W is itself reached through a symbolic link", () => {
  treeTest("both sides are compared as real paths", async (T) => {
    const wlink = join(T.root, "wlink");
    symlinkSync(T.W, wlink);
    symlinkSync(T.O, join(T.W, "linkdir"));
    symlinkSync(join(T.O, "secret.txt"), join(T.W, "link.txt"));
    symlinkSync(join(T.O, "nothing"), join(T.W, "dangling.txt"));
    symlinkSync(join(T.W, "a.txt"), join(T.W, "in.txt"));
    const variants = [
      [wlink, T.X],
      [T.W, T.X],
      [T.root + "/./work", T.X],
      [wlink, symlinkTo(T, "xlink", T.X)],
    ];
    for (const folders of variants) {
      const where = JSON.stringify(folders);
      assert.equal(await realPlace("a.txt", folders), join(T.realW, "a.txt"), where);
      assert.equal(await realPlace("new.txt", folders), join(T.realW, "new.txt"), where);
      assert.equal(await realPlace("./sub/../a.txt", folders), join(T.realW, "a.txt"), where);
      assert.equal(await realPlace("in.txt", folders), join(T.realW, "a.txt"), where);
      assert.equal(await realPlace(".", folders), T.realW, where);
      assert.equal(await realPlace(join(T.X, "x.txt"), folders), join(T.realX, "x.txt"), where);
      assert.equal(await realPlace(join(T.W, "a.txt"), folders), join(T.realW, "a.txt"), where);
      assert.equal(await realPlace(join(wlink, "a.txt"), folders), join(T.realW, "a.txt"), where);
      for (const path of ["../a.txt", "sub/../../a.txt", "/etc/hosts", "link.txt", "linkdir/a.txt", "dangling.txt"]) {
        await fault(realPlace(path, folders), outsideMessage(path), true);
      }
      const w2 = join(T.W2, "a.txt");
      await fault(realPlace(w2, folders), outsideMessage(w2), true);
    }
  });
});

function symlinkTo(T, name, target) {
  const link = join(T.root, name);
  symlinkSync(target, link);
  return link;
}

describe("missingFolders", () => {
  treeTest("all exist: []", async (T) => {
    assert.deepEqual(await missingFolders([T.W, T.X]), []);
  });

  treeTest("nothing there, a file, a link to no folder: the positions, from 0, in rising order", async (T) => {
    const file = join(T.root, "afile");
    writeFileSync(file, "x");
    const deadLink = join(T.root, "dead");
    symlinkSync(join(T.root, "nowhere"), deadLink);
    const fileLink = join(T.root, "filelink");
    symlinkSync(file, fileLink);
    const folders = [T.W, join(T.root, "gone"), T.X, file, deadLink, fileLink, T.W2];
    assert.deepEqual(await missingFolders(folders), [1, 3, 4, 5]);
    assert.deepEqual(await missingFolders([join(T.root, "gone")]), [0]);
  });

  treeTest("a link to a folder is a folder", async (T) => {
    const link = join(T.root, "wlink");
    symlinkSync(T.W, link);
    assert.deepEqual(await missingFolders([link, T.X]), []);
  });

  treeTest("never rejects, and does not change its argument", async (T) => {
    const folders = Object.freeze([join(T.root, "gone"), T.W]);
    const got = await missingFolders(folders);
    assert.ok(Array.isArray(got));
    assert.deepEqual(got, [0]);
    assert.deepEqual([...folders], [join(T.root, "gone"), T.W]);
    for (const odd of [join(T.root, "a\u0000b"), "", "relative/gone"]) {
      assert.ok(Array.isArray(await missingFolders([odd])));
    }
  });
});

test("nothing was written to the file system by realPlace and missingFolders", async () => {
  const T = makeTree();
  try {
    const before = readFileSync(join(T.W, "a.txt"), "utf8");
    await realPlace("new.txt", T.folders);
    await realPlace("nodir/x.txt", T.folders);
    await missingFolders(T.folders);
    assert.equal(readFileSync(join(T.W, "a.txt"), "utf8"), before);
    assert.throws(() => realpathSync(join(T.W, "new.txt")));
    assert.throws(() => realpathSync(join(T.W, "nodir")));
  } finally {
    T.cleanup();
  }
});
