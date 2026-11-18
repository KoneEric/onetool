import { describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, lstatSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFile, writeFile, editFile } from "../src/index.js";
import { treeTest, fault } from "./helpers.js";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const noPerms = isRoot ? { skip: "root can write anywhere" } : undefined;
const outsideMessage = (path) => `${path} is outside the listed folders`;
const BAD_PATH = "the path must be a text that is not empty";
const read = (file) => readFileSync(file, "utf8");

describe("readFile", () => {
  treeTest("resolves with the text of the file: relative, full, in the second folder", async (T) => {
    const o = { folders: T.folders };
    assert.equal(await readFile("a.txt", o), "A");
    assert.equal(await readFile(join(T.W, "a.txt"), o), "A");
    assert.equal(await readFile(join(T.X, "x.txt"), o), "X");
    assert.equal(await readFile("./sub/../a.txt", o), "A");
  });

  treeTest("UTF-8 text, line breaks kept, an empty file gives the empty string", async (T) => {
    const text = "héllo ✓ 日本\r\nline\n\n";
    writeFileSync(join(T.W, "u.txt"), text);
    writeFileSync(join(T.W, "empty.txt"), "");
    assert.equal(await readFile("u.txt", { folders: T.folders }), text);
    assert.equal(await readFile("empty.txt", { folders: T.folders }), "");
  });

  treeTest("bytes that are not UTF-8 become the replacement character", async (T) => {
    writeFileSync(join(T.W, "bad.bin"), Buffer.from([0x61, 0xff, 0x62]));
    assert.equal(await readFile("bad.bin", { folders: T.folders }), "a�b");
  });

  treeTest("through a link to a file inside, it reads the target", async (T) => {
    symlinkSync(join(T.X, "x.txt"), join(T.W, "in.txt"));
    assert.equal(await readFile("in.txt", { folders: T.folders }), "X");
  });

  treeTest("the faults of realPlace, with the path as given", async (T) => {
    const o = { folders: T.folders };
    await fault(readFile("", o), BAD_PATH);
    await fault(readFile(null, o), BAD_PATH);
    await fault(readFile("../outside/secret.txt", o), outsideMessage("../outside/secret.txt"), true);
    const full = join(T.O, "secret.txt");
    await fault(readFile(full, o), outsideMessage(full), true);
    symlinkSync(full, join(T.W, "link.txt"));
    await fault(readFile("link.txt", o), outsideMessage("link.txt"), true);
  });

  treeTest("outside is told before `no such file`, also where nothing is", async (T) => {
    await fault(readFile("../nothing-here.txt", { folders: T.folders }), outsideMessage("../nothing-here.txt"), true);
    symlinkSync(join(T.O, "nothing"), join(T.W, "dangling.txt"));
    await fault(readFile("dangling.txt", { folders: T.folders }), outsideMessage("dangling.txt"), true);
  });

  treeTest("nothing at the real place: `<path>: no such file`", async (T) => {
    const o = { folders: T.folders };
    await fault(readFile("nope.txt", o), "nope.txt: no such file");
    await fault(readFile("nodir/nope.txt", o), "nodir/nope.txt: no such file");
    const full = join(T.X, "nope.txt");
    await fault(readFile(full, o), `${full}: no such file`);
    await fault(readFile("  ", o), "  : no such file");
  });

  treeTest("a folder: `<path>: not a file`", async (T) => {
    mkdirSync(join(T.W, "sub"));
    await fault(readFile("sub", { folders: T.folders }), "sub: not a file");
    symlinkSync(join(T.W, "sub"), join(T.W, "subln"));
    await fault(readFile("subln", { folders: T.folders }), "subln: not a file");
  });

  treeTest("a socket: `<path>: not a file`", async (T) => {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(T.W, "s.sock"), resolve);
    });
    try {
      await fault(readFile("s.sock", { folders: T.folders }), "s.sock: not a file");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  treeTest("the limit: exactly `limit` bytes is read, one more is not", async (T) => {
    writeFileSync(join(T.W, "ten.txt"), "0123456789");
    assert.equal(await readFile("ten.txt", { folders: T.folders, limit: 10 }), "0123456789");
    assert.equal(await readFile("ten.txt", { folders: T.folders, limit: 11 }), "0123456789");
    await fault(readFile("ten.txt", { folders: T.folders, limit: 9 }), "ten.txt: the file is over 9 bytes");
    await fault(readFile("ten.txt", { folders: T.folders, limit: 1 }), "ten.txt: the file is over 1 bytes");
  });

  treeTest("the limit counts bytes, not characters", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "éé"); // 2 characters, 4 bytes
    assert.equal(await readFile("e.txt", { folders: T.folders, limit: 4 }), "éé");
    await fault(readFile("e.txt", { folders: T.folders, limit: 3 }), "e.txt: the file is over 3 bytes");
  });

  treeTest("the limit is 10000000 bytes when not given", async (T) => {
    writeFileSync(join(T.W, "big.txt"), Buffer.alloc(10000000, 0x61));
    writeFileSync(join(T.W, "bigger.txt"), Buffer.alloc(10000001, 0x61));
    const got = await readFile("big.txt", { folders: T.folders });
    assert.equal(got.length, 10000000);
    await fault(readFile("bigger.txt", { folders: T.folders }), "bigger.txt: the file is over 10000000 bytes");
  });

  treeTest("the limit is told before a refusal of the system", noPerms ? async () => {} : async (T) => {
    const file = join(T.W, "locked.txt");
    writeFileSync(file, "0123456789");
    chmodSync(file, 0o000);
    await fault(readFile("locked.txt", { folders: T.folders, limit: 5 }), "locked.txt: the file is over 5 bytes");
  }, noPerms);

  treeTest("the system refuses the reading: `<path>: cannot be read`", noPerms ? async () => {} : async (T) => {
    const file = join(T.W, "locked.txt");
    writeFileSync(file, "secret");
    chmodSync(file, 0o000);
    await fault(readFile("locked.txt", { folders: T.folders }), "locked.txt: cannot be read");
  }, noPerms);

  treeTest("changes nothing: not its arguments, not the file", async (T) => {
    const folders = Object.freeze([T.W, T.X]);
    const options = Object.freeze({ folders, limit: 100 });
    assert.equal(await readFile("a.txt", options), "A");
    assert.equal(read(join(T.W, "a.txt")), "A");
    assert.deepEqual([...folders], [T.W, T.X]);
  });
});

describe("writeFile", () => {
  treeTest("creates the file when it is not there, and resolves with undefined", async (T) => {
    assert.equal(await writeFile("new.txt", "hello", { folders: T.folders }), undefined);
    assert.equal(read(join(T.W, "new.txt")), "hello");
    assert.equal(await writeFile(join(T.X, "newx.txt"), "in x", { folders: T.folders }), undefined);
    assert.equal(read(join(T.X, "newx.txt")), "in x");
  });

  treeTest("replaces all of the file when it is there", async (T) => {
    writeFileSync(join(T.W, "old.txt"), "a long old content\nwith lines\n");
    await writeFile("old.txt", "short", { folders: T.folders });
    assert.equal(read(join(T.W, "old.txt")), "short");
  });

  treeTest("the empty string is a valid text and gives an empty file", async (T) => {
    await writeFile("a.txt", "", { folders: T.folders });
    assert.equal(lstatSync(join(T.W, "a.txt")).size, 0);
    await writeFile("blank.txt", "", { folders: T.folders });
    assert.equal(lstatSync(join(T.W, "blank.txt")).size, 0);
  });

  treeTest("texts are UTF-8, taken letter for letter", async (T) => {
    const text = "héllo ✓ 日本 😀\r\n\n  end ";
    await writeFile("u.txt", text, { folders: T.folders });
    assert.deepEqual(readFileSync(join(T.W, "u.txt")), Buffer.from(text, "utf8"));
  });

  treeTest("a path of white space only is a path like any other", async (T) => {
    await writeFile("  ", "x", { folders: T.folders });
    assert.equal(read(join(T.W, "  ")), "x");
  });

  treeTest("`text` is not a string: the message, tested first", async (T) => {
    const o = { folders: T.folders };
    for (const bad of [undefined, null, 5, {}, ["a"], Buffer.from("x")]) {
      await fault(writeFile("new.txt", bad, o), "the text must be a text");
    }
    assert.equal(existsSync(join(T.W, "new.txt")), false);
    // before the path is looked at
    await fault(writeFile("", 5, o), "the text must be a text");
    await fault(writeFile("../outside/new.txt", 5, o), "the text must be a text");
  });

  treeTest("the faults of realPlace; nothing is created outside", async (T) => {
    const o = { folders: T.folders };
    await fault(writeFile("", "x", o), BAD_PATH);
    await fault(writeFile(undefined, "x", o), BAD_PATH);
    await fault(writeFile("../new.txt", "x", o), outsideMessage("../new.txt"), true);
    const full = join(T.O, "new.txt");
    await fault(writeFile(full, "x", o), outsideMessage(full), true);
    await fault(writeFile("/etc/hosts", "x", o), outsideMessage("/etc/hosts"), true);
    assert.equal(existsSync(join(T.root, "new.txt")), false);
    assert.equal(existsSync(full), false);
  });

  treeTest("through a link to a folder outside: outside, nothing written", async (T) => {
    symlinkSync(T.O, join(T.W, "linkdir"));
    await fault(writeFile("linkdir/new.txt", "x", { folders: T.folders }), outsideMessage("linkdir/new.txt"), true);
    await fault(writeFile("linkdir/a.txt", "x", { folders: T.folders }), outsideMessage("linkdir/a.txt"), true);
    assert.equal(existsSync(join(T.O, "new.txt")), false);
    assert.equal(read(join(T.O, "dir", "a.txt")), "OUT");
  });

  treeTest("through a link to a file outside: outside, the target is untouched", async (T) => {
    symlinkSync(join(T.O, "secret.txt"), join(T.W, "link.txt"));
    await fault(writeFile("link.txt", "x", { folders: T.folders }), outsideMessage("link.txt"), true);
    assert.equal(read(join(T.O, "secret.txt")), "SECRET");
  });

  treeTest("through a link that leads nowhere: outside, nothing is created where it points", async (T) => {
    symlinkSync(join(T.O, "made.txt"), join(T.W, "dangling.txt"));
    symlinkSync(join(T.W, "made-in.txt"), join(T.W, "dangling-in.txt"));
    await fault(writeFile("dangling.txt", "x", { folders: T.folders }), outsideMessage("dangling.txt"), true);
    await fault(writeFile("dangling-in.txt", "x", { folders: T.folders }), outsideMessage("dangling-in.txt"), true);
    assert.equal(existsSync(join(T.O, "made.txt")), false);
    assert.equal(existsSync(join(T.W, "made-in.txt")), false);
  });

  treeTest("through a link whose target is inside: writes the target; the link stays a link", async (T) => {
    symlinkSync(join(T.W, "a.txt"), join(T.W, "in.txt"));
    symlinkSync(join("..", "extra", "x.txt"), join(T.W, "inx.txt"));
    await writeFile("in.txt", "via link", { folders: T.folders });
    await writeFile("inx.txt", "via link x", { folders: T.folders });
    assert.equal(lstatSync(join(T.W, "in.txt")).isSymbolicLink(), true);
    assert.equal(lstatSync(join(T.W, "inx.txt")).isSymbolicLink(), true);
    assert.equal(read(join(T.W, "a.txt")), "via link");
    assert.equal(read(join(T.X, "x.txt")), "via link x");
  });

  treeTest("the folder of the real place does not exist: `<path>: its folder does not exist`, none is made", async (T) => {
    const o = { folders: T.folders };
    await fault(writeFile("nodir/new.txt", "x", o), "nodir/new.txt: its folder does not exist");
    await fault(writeFile("nodir/deeper/new.txt", "x", o), "nodir/deeper/new.txt: its folder does not exist");
    const full = join(T.W, "nodir2", "new.txt");
    await fault(writeFile(full, "x", o), `${full}: its folder does not exist`);
    assert.equal(existsSync(join(T.W, "nodir")), false);
    assert.equal(existsSync(join(T.W, "nodir2")), false);
  });

  treeTest("the faults of realPlace come before `its folder does not exist`", async (T) => {
    await fault(writeFile("../nodir/new.txt", "x", { folders: T.folders }), outsideMessage("../nodir/new.txt"), true);
  });

  treeTest("the real place is a folder: `<path>: not a file`, the folder is not touched", async (T) => {
    mkdirSync(join(T.W, "sub"));
    writeFileSync(join(T.W, "sub", "keep.txt"), "keep");
    await fault(writeFile("sub", "x", { folders: T.folders }), "sub: not a file");
    await fault(writeFile(".", "x", { folders: T.folders }), ".: not a file");
    await fault(writeFile(T.X, "x", { folders: T.folders }), `${T.X}: not a file`);
    assert.deepEqual(readdirSync(join(T.W, "sub")), ["keep.txt"]);
  });

  treeTest("the real place is another thing than a regular file: `<path>: not a file`", async (T) => {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(T.W, "s.sock"), resolve);
    });
    try {
      await fault(writeFile("s.sock", "x", { folders: T.folders }), "s.sock: not a file");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  treeTest("the system refuses the writing: `<path>: cannot be written`", noPerms ? async () => {} : async (T) => {
    const file = join(T.W, "ro.txt");
    writeFileSync(file, "keep");
    chmodSync(file, 0o444);
    await fault(writeFile("ro.txt", "x", { folders: T.folders }), "ro.txt: cannot be written");
    assert.equal(read(file), "keep");
    mkdirSync(join(T.W, "rodir"));
    chmodSync(join(T.W, "rodir"), 0o555);
    await fault(writeFile("rodir/new.txt", "x", { folders: T.folders }), "rodir/new.txt: cannot be written");
  }, noPerms);

  treeTest("changes nothing but the file: not its arguments, not the other files", async (T) => {
    const folders = Object.freeze([T.W, T.X]);
    await writeFile("new.txt", "x", Object.freeze({ folders }));
    assert.deepEqual([...folders], [T.W, T.X]);
    assert.deepEqual(readdirSync(T.W).sort(), ["a.txt", "new.txt"]);
    assert.equal(read(join(T.W, "a.txt")), "A");
    assert.equal(read(join(T.X, "x.txt")), "X");
  });
});

describe("editFile", () => {
  treeTest("replaces the one place and nothing else; resolves with undefined", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "one two three\nfour\n");
    assert.equal(await editFile("e.txt", "two", "2", { folders: T.folders }), undefined);
    assert.equal(read(join(T.W, "e.txt")), "one 2 three\nfour\n");
    await editFile(join(T.X, "x.txt"), "X", "XX", { folders: T.folders });
    assert.equal(read(join(T.X, "x.txt")), "XX");
  });

  treeTest("an old text and a new text of several lines and of non-ASCII characters", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "head\nfoo\n  bar é\ntail\n");
    await editFile("e.txt", "foo\n  bar é\n", "baz ✓\n", { folders: T.folders });
    assert.equal(read(join(T.W, "e.txt")), "head\nbaz ✓\ntail\n");
  });

  treeTest("no pattern: `a.c` is those three characters, and `$&`, `$1`, `$$`, `$'` are themselves", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "abc a.c (x)");
    await editFile("e.txt", "a.c", "$& $1 $$ $' $`", { folders: T.folders });
    assert.equal(read(join(T.W, "e.txt")), "abc $& $1 $$ $' $` (x)");
    await editFile("e.txt", "(x)", "[$&]", { folders: T.folders });
    assert.equal(read(join(T.W, "e.txt")), "abc $& $1 $$ $' $` [$&]");
  });

  treeTest("an empty newText removes the place", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "keep REMOVE keep");
    await editFile("e.txt", " REMOVE", "", { folders: T.folders });
    assert.equal(read(join(T.W, "e.txt")), "keep keep");
  });

  treeTest("newText equal to oldText is valid and leaves the file holding what it held", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "same text\n");
    assert.equal(await editFile("e.txt", "same", "same", { folders: T.folders }), undefined);
    assert.equal(read(join(T.W, "e.txt")), "same text\n");
  });

  treeTest("oldText that is the whole file", async (T) => {
    await editFile("a.txt", "A", "whole new", { folders: T.folders });
    assert.equal(read(join(T.W, "a.txt")), "whole new");
  });

  treeTest("through a link to a file inside: edits the target; the link stays a link", async (T) => {
    symlinkSync(join(T.W, "a.txt"), join(T.W, "in.txt"));
    await editFile("in.txt", "A", "B", { folders: T.folders });
    assert.equal(lstatSync(join(T.W, "in.txt")).isSymbolicLink(), true);
    assert.equal(read(join(T.W, "a.txt")), "B");
  });

  treeTest("oldText is not a string, or is empty: the message, tested first", async (T) => {
    const message = "the old text must be a text that is not empty";
    for (const bad of [undefined, null, 5, {}, ""]) {
      await fault(editFile("a.txt", bad, "x", { folders: T.folders }), message);
    }
    // before newText and before the path
    await fault(editFile("a.txt", "", 5, { folders: T.folders }), message);
    await fault(editFile("../outside/secret.txt", "", "x", { folders: T.folders }), message);
    await fault(editFile("", "", "x", { folders: T.folders }), message);
    assert.equal(read(join(T.W, "a.txt")), "A");
  });

  treeTest("newText is not a string: the message, before the path is looked at", async (T) => {
    const message = "the new text must be a text";
    for (const bad of [undefined, null, 5, {}]) {
      await fault(editFile("a.txt", "A", bad, { folders: T.folders }), message);
    }
    await fault(editFile("../outside/secret.txt", "S", 5, { folders: T.folders }), message);
    await fault(editFile("nope.txt", "S", 5, { folders: T.folders }), message);
    assert.equal(read(join(T.W, "a.txt")), "A");
  });

  treeTest("every fault of readFile, with the same messages", async (T) => {
    const o = { folders: T.folders };
    await fault(editFile("", "A", "B", o), BAD_PATH);
    await fault(editFile("../outside/secret.txt", "S", "T", o), outsideMessage("../outside/secret.txt"), true);
    symlinkSync(join(T.O, "secret.txt"), join(T.W, "link.txt"));
    await fault(editFile("link.txt", "S", "T", o), outsideMessage("link.txt"), true);
    await fault(editFile("nope.txt", "A", "B", o), "nope.txt: no such file");
    mkdirSync(join(T.W, "sub"));
    await fault(editFile("sub", "A", "B", o), "sub: not a file");
    writeFileSync(join(T.W, "ten.txt"), "0123456789");
    await fault(editFile("ten.txt", "0", "1", { folders: T.folders, limit: 9 }), "ten.txt: the file is over 9 bytes");
    assert.equal(read(join(T.W, "ten.txt")), "0123456789");
    assert.equal(read(join(T.O, "secret.txt")), "SECRET");
  });

  treeTest("the limit: exactly `limit` bytes is edited", async (T) => {
    writeFileSync(join(T.W, "ten.txt"), "0123456789");
    await editFile("ten.txt", "9", "nine", { folders: T.folders, limit: 10 });
    assert.equal(read(join(T.W, "ten.txt")), "012345678nine");
  });

  treeTest("the limit is 10000000 bytes when not given", async (T) => {
    writeFileSync(join(T.W, "bigger.txt"), Buffer.alloc(10000001, 0x61));
    await fault(editFile("bigger.txt", "a", "b", { folders: T.folders }), "bigger.txt: the file is over 10000000 bytes");
  });

  treeTest("oldText is not in the file: the message, the file is not touched", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "abc");
    await fault(editFile("e.txt", "abd", "x", { folders: T.folders }), "e.txt: the old text is not in the file");
    await fault(editFile("e.txt", "ABC", "x", { folders: T.folders }), "e.txt: the old text is not in the file");
    writeFileSync(join(T.W, "empty.txt"), "");
    await fault(editFile("empty.txt", "a", "x", { folders: T.folders }), "empty.txt: the old text is not in the file");
    assert.equal(read(join(T.W, "e.txt")), "abc");
  });

  treeTest("oldText more than once: the count, in digits; the file is not touched", async (T) => {
    writeFileSync(join(T.W, "e.txt"), "ab ab ab");
    await fault(
      editFile("e.txt", "ab", "x", { folders: T.folders }),
      "e.txt: the old text is in the file 3 times, it must be there once",
    );
    // 10 places: the count is written in digits
    writeFileSync(join(T.W, "ten.txt"), "z".repeat(10));
    await fault(
      editFile("ten.txt", "z", "y", { folders: T.folders }),
      "ten.txt: the old text is in the file 10 times, it must be there once",
    );
    assert.equal(read(join(T.W, "e.txt")), "ab ab ab");
    assert.equal(read(join(T.W, "ten.txt")), "zzzzzzzzzz");
  });

  treeTest("places that overlap are counted as `text.split(oldText).length - 1` counts them", async (T) => {
    // "aaaa".split("aa") is ["", "", ""]: 2 places that do not overlap
    writeFileSync(join(T.W, "four.txt"), "aaaa");
    await fault(
      editFile("four.txt", "aa", "x", { folders: T.folders }),
      "four.txt: the old text is in the file 2 times, it must be there once",
    );
    assert.equal(read(join(T.W, "four.txt")), "aaaa");
  });

  // assumed: when the count is 1 with an overlap ("aaa" holds "aa" once), the place read from the start is replaced
  treeTest("an overlap counted once: the place read from the start is replaced", async (T) => {
    // "aaa".split("aa") is ["", "a"]: 1 place, read from the start
    writeFileSync(join(T.W, "three.txt"), "aaa");
    await editFile("three.txt", "aa", "X", { folders: T.folders });
    assert.equal(read(join(T.W, "three.txt")), "Xa");
  });

  treeTest("the first folder itself, `.`: `not a file`", async (T) => {
    await fault(editFile(".", "a", "b", { folders: T.folders }), ".: not a file");
  });

  treeTest("the system refuses the writing: `<path>: cannot be written`, the file is not touched", noPerms ? async () => {} : async (T) => {
    const file = join(T.W, "ro.txt");
    writeFileSync(file, "old text here");
    chmodSync(file, 0o444);
    await fault(editFile("ro.txt", "old", "new", { folders: T.folders }), "ro.txt: cannot be written");
    assert.equal(read(file), "old text here");
  }, noPerms);

  treeTest("changes nothing but the file: not its arguments, not the other files", async (T) => {
    const folders = Object.freeze([T.W, T.X]);
    await editFile("a.txt", "A", "B", Object.freeze({ folders, limit: 100 }));
    assert.deepEqual([...folders], [T.W, T.X]);
    assert.deepEqual(readdirSync(T.W).sort(), ["a.txt"]);
    assert.equal(read(join(T.X, "x.txt")), "X");
  });
});
