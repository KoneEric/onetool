import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../src/index.js";
import { NOW, deepFreeze, program } from "./helpers.js";

const DAY = 86400000;

const HEAD = "--- programs: uses, failures in a row, last use ---";
const PAIRS = "--- programs that share most of their tools ---";
const unusedHead = (d) => `--- not used for ${d} days ---`;
const seqHead = (t) => `--- sequences of calls run ${t} times or more and not saved ---`;
const OFF = "(the log is switched off: no sequence is counted)";

// A program as `joinLibraries` gives it; `tools` are ids `<server>.<tool>`, written as calls in its code.
const prog = (name, { tools = [], ...over } = {}) => ({
  ...program(name),
  where: "user",
  code: tools.length ? tools.map((id) => `tools.${id}();`).join(" ") + "\n" : "1\n",
  ...over,
});

const report = (programs, options = {}) => lib.reportText(programs, { now: NOW, ...options });

// The text cut into its four sections after line 1: the lines under each header.
function sections(text) {
  const lines = text.split("\n");
  const out = { first: lines[0], programs: [], pairs: [], unused: [], seqs: [] };
  let into = null;
  for (const line of lines.slice(1)) {
    if (line === HEAD) into = out.programs;
    else if (line === PAIRS) into = out.pairs;
    else if (/^--- not used for .* days ---$/.test(line)) into = out.unused;
    else if (/^--- sequences of calls run .* times or more and not saved ---$/.test(line)) into = out.seqs;
    else into.push(line);
  }
  return out;
}

// The sections of a text whose pairs or sequences are the thing under test.
const pairLines = (programs, options) => sections(report(programs, options)).pairs;
const seqLines = (sequences, options = {}, programs = []) => sections(report(programs, { sequences, ...options })).seqs;

test("reportText: an empty library with no sequence is nine lines", () => {
  const expected = [
    "Library report: 0 programs",
    HEAD,
    "(none)",
    PAIRS,
    "(none)",
    unusedHead(30),
    "(none)",
    seqHead(3),
    "(none)",
  ].join("\n");
  assert.equal(report([]), expected);
  assert.equal(lib.reportText([]), expected);
  assert.equal(lib.reportText([], {}), expected);
  assert.equal(expected.split("\n").length, 9);
});

test("reportText: the first line says programs, also for 1", () => {
  assert.equal(report([prog("a")]).split("\n")[0], "Library report: 1 programs");
  assert.equal(report([prog("a"), prog("b")]).split("\n")[0], "Library report: 2 programs");
});

test("reportText: the whole text of a small library, line by line", () => {
  const cityCount = prog("cityCount", { tools: ["practice.rows"], uses: 2, lastUse: NOW });
  const cityShare = prog("cityShare", { tools: ["practice.rows", "practice.count"], where: "project" });
  const sequences = [
    ["practice.rows", "practice.count"], ["practice.rows", "practice.count"], ["practice.rows", "practice.count"],
    ["practice.echo"], ["practice.echo"], ["practice.echo"],
  ];
  assert.equal(
    report([cityCount, cityShare], { sequences }),
    [
      "Library report: 2 programs",
      HEAD,
      "lib.cityShare (project): 0 uses, 0 failures, never",
      "lib.cityCount (user): 2 uses, 0 failures, 2026-11-18",
      PAIRS,
      "lib.cityCount and lib.cityShare: 1 of 2 tools (practice.rows)",
      unusedHead(30),
      "(none)",
      seqHead(3),
      "3 times: practice.echo",
    ].join("\n"),
  );
});

test("reportText: a program line, uses and failures always plural, the day in UTC", () => {
  const got = sections(
    report([
      prog("a", { uses: 1, failures: 1, lastUse: Date.UTC(2026, 10, 18, 23, 59, 59, 999) }),
      prog("b", { uses: 10, failures: 12, lastUse: Date.UTC(2026, 10, 19, 0, 0, 0, 0), where: "project" }),
    ]),
  ).programs;
  assert.deepEqual(got, [
    "lib.a (user): 1 uses, 1 failures, 2026-11-18",
    "lib.b (project): 10 uses, 12 failures, 2026-11-19",
  ]);
});

test("reportText: program lines go the least used first: uses, then never before a day, then name", () => {
  const programs = [
    prog("A", { uses: 2, lastUse: NOW }),
    prog("B", { uses: 1, failures: 3, lastUse: Date.UTC(2026, 10, 20), where: "project" }),
    prog("C", { uses: 1, lastUse: null }),
    prog("D", { uses: 1, lastUse: Date.UTC(2026, 10, 2, 23, 59, 59, 999) }),
    prog("E", { uses: 1, lastUse: Date.UTC(2026, 10, 2, 23, 59, 59, 999) }),
    prog("F", { uses: 0, lastUse: Date.UTC(2020, 0, 1), where: "project" }),
    prog("G", { uses: 0, lastUse: null }),
    prog("H", { uses: 10, lastUse: null }),
    prog("I", { uses: 9, lastUse: null }),
  ];
  assert.deepEqual(sections(report(programs, { unusedDays: 100000 })).programs, [
    "lib.G (user): 0 uses, 0 failures, never",
    "lib.F (project): 0 uses, 0 failures, 2020-01-01",
    "lib.C (user): 1 uses, 0 failures, never",
    "lib.D (user): 1 uses, 0 failures, 2026-11-02",
    "lib.E (user): 1 uses, 0 failures, 2026-11-02",
    "lib.B (project): 1 uses, 3 failures, 2026-11-20",
    "lib.A (user): 2 uses, 0 failures, 2026-11-18",
    "lib.I (user): 9 uses, 0 failures, never",
    "lib.H (user): 10 uses, 0 failures, never",
  ]);
});

test("reportText: equal counts go by name, as < compares strings: Z before a", () => {
  assert.deepEqual(sections(report([prog("Z"), prog("a")])).programs, [
    "lib.Z (user): 0 uses, 0 failures, never",
    "lib.a (user): 0 uses, 0 failures, never",
  ]);
});

// ---- the pairs

test("reportText: a pair that shares half of its tools, and a program with no tools or other tools is in none", () => {
  const programs = [
    prog("cityCount", { tools: ["practice.rows"] }),
    prog("cityShare", { tools: ["practice.rows", "practice.count"] }),
    prog("echoOnly", { tools: ["practice.echo"] }),
  ];
  assert.deepEqual(pairLines(programs), ["lib.cityCount and lib.cityShare: 1 of 2 tools (practice.rows)"]);
});

test("reportText: less than half is no pair; none is `(none)`; programs with no tool are in no pair", () => {
  // shared 1, all 3 + 1 - 1 = 3: 1 * 2 < 3
  assert.deepEqual(pairLines([prog("a", { tools: ["p.x", "p.y", "p.z"] }), prog("b", { tools: ["p.x"] })]), ["(none)"]);
  // no tool at all: not "0 of 0"
  assert.deepEqual(pairLines([prog("a"), prog("b")]), ["(none)"]);
  assert.deepEqual(pairLines([prog("a")]), ["(none)"]);
});

test("reportText: half counts: shared * 2 = all is a pair", () => {
  // shared 2, all 3 + 3 - 2 = 4: 2 * 2 = 4
  const got = pairLines([prog("a", { tools: ["p.x", "p.y", "p.z"] }), prog("b", { tools: ["p.x", "p.y", "p.w"] })]);
  assert.deepEqual(got, ["lib.a and lib.b: 2 of 4 tools (p.x, p.y)"]);
});

test("reportText: a tool named twice in a program counts once; shared is in the order of the first program", () => {
  // a: x, y (x twice, y once); b: y, x. shared 2, all 2 + 2 - 2 = 2
  const a = prog("a", { code: "tools.p.x(); tools.p.y(); tools.p.x();\n" });
  const b = prog("b", { tools: ["p.y", "p.x"] });
  assert.deepEqual(pairLines([a, b]), ["lib.a and lib.b: 2 of 2 tools (p.x, p.y)"]);
});

test("reportText: two saved programs with the same tools are a pair n of n", () => {
  assert.deepEqual(pairLines([prog("a", { tools: ["p.x"] }), prog("b", { tools: ["p.x"] })]), [
    "lib.a and lib.b: 1 of 1 tools (p.x)",
  ]);
});

test("reportText: tool ids with spaces and non-ASCII characters are put in as they are", () => {
  const code = 'await tools["my server"]["get-rows"](); await tools["é"]["ü"]();\n';
  assert.deepEqual(pairLines([prog("a", { code }), prog("b", { code })]), [
    "lib.a and lib.b: 2 of 2 tools (my server.get-rows, é.ü)",
  ]);
});

test("reportText: pairs go by share, then by shared count, then by the order they were made in", () => {
  // Each group of two shares tools only inside the group.
  const programs = [
    // a: shared 2, all 2 + 2 - 2 = 2: 2 of 2
    prog("a1", { tools: ["a.t1", "a.t2"] }),
    prog("a2", { tools: ["a.t1", "a.t2"] }),
    // b: 4 of 4: the same share as a, a greater shared count
    prog("b1", { tools: ["b.t2", "b.t1", "b.t3", "b.t4"] }),
    prog("b2", { tools: ["b.t1", "b.t2", "b.t3", "b.t4"] }),
    // c: shared 2, all 3 + 2 - 2 = 3: 2 of 3
    prog("c1", { tools: ["c.t1", "c.t2", "c.t3"] }),
    prog("c2", { tools: ["c.t1", "c.t2"] }),
    // f: shared 1, all 2 + 1 - 1 = 2: 1 of 2
    prog("f1", { tools: ["f.t1", "f.t2"] }),
    prog("f2", { tools: ["f.t1"] }),
    // g: shared 2, all 3 + 3 - 2 = 4: 2 of 4, the share of f with a greater shared count
    prog("g1", { tools: ["g.t1", "g.t2", "g.t3"] }),
    prog("g2", { tools: ["g.t1", "g.t2", "g.t4"] }),
  ];
  assert.deepEqual(pairLines(programs), [
    "lib.b1 and lib.b2: 4 of 4 tools (b.t2, b.t1, b.t3, b.t4)",
    "lib.a1 and lib.a2: 2 of 2 tools (a.t1, a.t2)",
    "lib.c1 and lib.c2: 2 of 3 tools (c.t1, c.t2)",
    "lib.g1 and lib.g2: 2 of 4 tools (g.t1, g.t2)",
    "lib.f1 and lib.f2: 1 of 2 tools (f.t1)",
  ]);
});

test("reportText: pairs of one share and one count go by the order of the programs: a, then b", () => {
  const programs = ["p1", "p2", "p3"].map((name) => prog(name, { tools: ["p.x"] }));
  assert.deepEqual(pairLines(programs), [
    "lib.p1 and lib.p2: 1 of 1 tools (p.x)",
    "lib.p1 and lib.p3: 1 of 1 tools (p.x)",
    "lib.p2 and lib.p3: 1 of 1 tools (p.x)",
  ]);
});

// Groups of two programs with one tool of their own each: `count` pairs, in the order of their names.
const groups = (count) => {
  const programs = [];
  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(2, "0");
    programs.push(prog(`g${n}a`, { tools: [`s${n}.t`] }), prog(`g${n}b`, { tools: [`s${n}.t`] }));
  }
  return programs;
};
const groupLine = (i) => {
  const n = String(i).padStart(2, "0");
  return `lib.g${n}a and lib.g${n}b: 1 of 1 tools (s${n}.t)`;
};

test("reportText: exactly 8 pair lines are all shown, 9 are 8 and a line of the rest", () => {
  const eight = pairLines(groups(8));
  assert.deepEqual(eight, [1, 2, 3, 4, 5, 6, 7, 8].map(groupLine));
  const nine = pairLines(groups(9));
  assert.deepEqual(nine, [...[1, 2, 3, 4, 5, 6, 7, 8].map(groupLine), "(1 more not shown)"]);
  const eleven = pairLines(groups(11));
  assert.equal(eleven.length, 9);
  assert.equal(eleven[8], "(3 more not shown)");
});

test("reportText: a pair line of exactly 120 characters is not cut, one of 121 is 117 and `...`", () => {
  // "lib.a and lib.b: 1 of 1 tools (" is 31 characters and ")" one more: the id is 88 for 120.
  const exactId = "p." + "x".repeat(86);
  const exact = `lib.a and lib.b: 1 of 1 tools (${exactId})`;
  assert.equal(exact.length, 120);
  assert.deepEqual(pairLines([prog("a", { tools: [exactId] }), prog("b", { tools: [exactId] })]), [exact]);
  const longId = "p." + "x".repeat(87);
  const long = `lib.a and lib.b: 1 of 1 tools (${longId})`;
  assert.equal(long.length, 121);
  const got = pairLines([prog("a", { tools: [longId] }), prog("b", { tools: [longId] })]);
  assert.deepEqual(got, [long.slice(0, 117) + "..."]);
  assert.equal(got[0].length, 120);
});

// ---- the programs not used

test("reportText: a program not used for more than unusedDays days is named; exactly that many is not", () => {
  const programs = [
    prog("exact", { lastUse: NOW - 30 * DAY }),
    prog("just", { lastUse: NOW - 30 * DAY - 1 }),
    prog("never", { lastUse: null }),
    prog("recent", { lastUse: NOW }),
  ];
  assert.deepEqual(sections(report(programs)).unused, ["lib.just"]);
  assert.deepEqual(sections(report(programs, { unusedDays: 30 })).unused, ["lib.just"]);
});

test("reportText: the header says the number of days as it is written", () => {
  const text = (d) => report([], { unusedDays: d });
  assert.ok(text(7).split("\n").includes(unusedHead(7)));
  assert.ok(text(0).split("\n").includes("--- not used for 0 days ---"));
  assert.ok(text(1.5).split("\n").includes("--- not used for 1.5 days ---"));
  assert.ok(text(1).split("\n").includes("--- not used for 1 days ---"));
});

test("reportText: unusedDays is passed, and 0 names every program used before now", () => {
  const programs = [
    prog("a", { lastUse: NOW - 1 }),
    prog("b", { lastUse: NOW }),
    prog("c", { lastUse: null }),
    prog("d", { lastUse: NOW - 10 * DAY }),
  ];
  assert.deepEqual(sections(report(programs, { unusedDays: 0 })).unused, ["lib.d, lib.a"]);
  assert.deepEqual(sections(report(programs, { unusedDays: 7 })).unused, ["lib.d"]);
  assert.deepEqual(sections(report(programs, { unusedDays: 10 })).unused, ["(none)"]);
  assert.deepEqual(sections(report(programs, { unusedDays: 9.5 })).unused, ["lib.d"]);
});

test("reportText: the names go by last use rising, then by name, on one line joined by `, `", () => {
  const programs = [
    prog("alpha", { lastUse: NOW - 40 * DAY }),
    prog("b", { lastUse: NOW - 50 * DAY }),
    prog("c", { lastUse: NOW - 50 * DAY }),
    prog("zeta", { lastUse: NOW - 60 * DAY }),
  ];
  assert.deepEqual(sections(report(programs)).unused, ["lib.zeta, lib.b, lib.c, lib.alpha"]);
});

test("reportText: 20 names are all shown, more are 20 and `, and <n> more`, on one line that is never cut", () => {
  const make = (count) =>
    Array.from({ length: count }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return prog(`${"u".repeat(36)}${n}`, { lastUse: NOW - 40 * DAY + i * 1000 });
    });
  const lineOf = (programs) => programs.map((p) => `lib.${p.name}`);
  const twenty = make(20);
  assert.deepEqual(sections(report(twenty)).unused, [lineOf(twenty).join(", ")]);
  assert.ok(sections(report(twenty)).unused[0].length > 120);
  const twentyOne = make(21);
  assert.deepEqual(sections(report(twentyOne)).unused, [lineOf(twentyOne).slice(0, 20).join(", ") + ", and 1 more"]);
  const twentyFive = make(25);
  assert.deepEqual(sections(report(twentyFive)).unused, [lineOf(twentyFive).slice(0, 20).join(", ") + ", and 5 more"]);
});

// ---- the sequences

test("reportText: the example of the meeting point: 3 times", () => {
  const sequences = [["practice.count"], ["practice.count"], ["a.b", "c.d"], ["practice.count"]];
  assert.deepEqual(seqLines(sequences), ["3 times: practice.count"]);
});

test("reportText: exactly `times` counts, and the header and the line say times", () => {
  const sequences = [["a.b"], ["a.b"], ["c.d"]];
  assert.deepEqual(seqLines(sequences, { times: 3 }), ["(none)"]);
  assert.deepEqual(seqLines(sequences, { times: 2 }), ["2 times: a.b"]);
  assert.deepEqual(seqLines(sequences, { times: 1 }), ["2 times: a.b", "1 times: c.d"]);
  assert.ok(report([], { times: 2 }).split("\n").includes(seqHead(2)));
  assert.ok(report([], { times: 1 }).split("\n").includes(seqHead(1)));
});

test("reportText: items of a sequence are joined by ` > `, in order, and the same set in another order is another sequence", () => {
  const sequences = [
    ["a.b", "c.d"], ["a.b", "c.d"], ["a.b", "c.d"],
    ["c.d", "a.b"], ["c.d", "a.b"], ["c.d", "a.b"], ["c.d", "a.b"],
    ["my server.get-rows", "é.ü"], ["my server.get-rows", "é.ü"], ["my server.get-rows", "é.ü"],
  ];
  assert.deepEqual(seqLines(sequences), [
    "4 times: c.d > a.b",
    "3 times: a.b > c.d",
    "3 times: my server.get-rows > é.ü",
  ]);
});

test("reportText: the order of sequences in the list does not matter, and the same one twice counts twice", () => {
  const sequences = [["a.b"], ["c.d"], ["a.b"], ["c.d"], ["a.b"]];
  assert.deepEqual(seqLines(sequences), ["3 times: a.b"]);
  assert.deepEqual(seqLines(sequences, { times: 2 }), ["3 times: a.b", "2 times: c.d"]);
});

test("reportText: sequences go by count, then by the joined text as < compares strings", () => {
  const rep = (seq, n) => Array.from({ length: n }, () => seq);
  const sequences = [
    ...rep(["b.x"], 3), ...rep(["a.x", "z.y"], 3), ...rep(["a.x"], 3), ...rep(["c.x", "d.x"], 4), ...rep(["B.x"], 3),
  ];
  assert.deepEqual(seqLines(sequences), [
    "4 times: c.x > d.x",
    "3 times: B.x",
    "3 times: a.x",
    "3 times: a.x > z.y",
    "3 times: b.x",
  ]);
});

test("reportText: a sequence a saved program calls is not named, and the same tools in another order or count is", () => {
  const programs = [
    prog("one", { code: "tools.a.b(); tools.c.d();\n" }),
    prog("twice", { code: "tools.p.q(); tools.p.q();\n" }),
    prog("noTool", { code: "1\n" }),
    prog("single", { code: "tools.s.t();\n", where: "project" }),
  ];
  const rep = (seq) => [seq, seq, seq];
  const sequences = [
    ...rep(["a.b", "c.d"]), // saved by "one"
    ...rep(["c.d", "a.b"]), // another order
    ...rep(["p.q", "p.q"]), // saved by "twice"
    ...rep(["p.q"]), // not the same length
    ...rep(["s.t"]), // saved by "single", of the project
    ...rep(["a.b"]), // a prefix of a saved sequence
  ];
  assert.deepEqual(seqLines(sequences, {}, programs), ["3 times: a.b", "3 times: c.d > a.b", "3 times: p.q"]);
});

test("reportText: exactly 8 sequence lines are all shown, 9 are 8 and a line of the rest", () => {
  const make = (count) => {
    const sequences = [];
    for (let i = 1; i <= count; i++) sequences.push(["q" + i + ".t"], ["q" + i + ".t"], ["q" + i + ".t"]);
    return sequences;
  };
  const lineOf = (i) => `3 times: q${i}.t`;
  assert.deepEqual(seqLines(make(8)), [1, 2, 3, 4, 5, 6, 7, 8].map(lineOf));
  assert.deepEqual(seqLines(make(9)), [...[1, 2, 3, 4, 5, 6, 7, 8].map(lineOf), "(1 more not shown)"]);
  const got = seqLines(make(12));
  assert.equal(got.length, 9);
  assert.equal(got[8], "(4 more not shown)");
});

test("reportText: a sequence line of exactly 120 characters is not cut, one of 121 is 117 and `...`", () => {
  const rep = (seq) => [seq, seq, seq];
  // "3 times: " is 9 characters: an id of 111 makes 120.
  const exactId = "p." + "x".repeat(109);
  assert.equal(`3 times: ${exactId}`.length, 120);
  assert.deepEqual(seqLines(rep([exactId])), [`3 times: ${exactId}`]);
  const longId = "p." + "x".repeat(110);
  const long = `3 times: ${longId}`;
  assert.equal(long.length, 121);
  assert.deepEqual(seqLines(rep([longId])), [long.slice(0, 117) + "..."]);
});

test("reportText: an item of sequences that is not a list of one or more strings is passed over", () => {
  const sequences = [
    [], ["a.b", 5], [5], "a.b", null, undefined, { sequence: ["a.b"] }, 7, [["a.b"]], ["a.b", null],
    ["ok.t"], ["ok.t"],
  ];
  assert.deepEqual(seqLines(sequences, { times: 1 }), ["2 times: ok.t"]);
});

test("reportText: log false: the one line, whatever sequences holds, and the other sections are as they were", () => {
  const sequences = [["a.b"], ["a.b"], ["a.b"]];
  const programs = [prog("x", { tools: ["a.b"], uses: 3, lastUse: NOW })];
  assert.deepEqual(seqLines(sequences, { log: false }), [OFF]);
  assert.deepEqual(seqLines([], { log: false }), [OFF]);
  assert.deepEqual(seqLines(sequences, { log: true }), ["3 times: a.b"]);
  const off = report(programs, { sequences, log: false }).split("\n");
  assert.equal(off.at(-1), OFF);
  assert.equal(off.at(-2), seqHead(3));
  assert.equal(
    report(programs, { sequences, log: false }).split("\n").slice(0, -1).join("\n"),
    report(programs, { sequences: [], log: true }).split("\n").slice(0, -1).join("\n"),
  );
});

test("reportText: sequences that are not given are none", () => {
  assert.deepEqual(seqLines(undefined), ["(none)"]);
});

// ---- the limit

// What the text of the meeting point says of a cut, written out: the lines that never give way, with the
// first k program lines and a line for the rest, k the greatest that fits, else the first `limit` characters.
function cutModel(first, programLines, tail, limit) {
  const n = programLines.length;
  const textWith = (k) =>
    [first, HEAD, ...programLines.slice(0, k), ...(k < n ? [`(${n - k} more not shown)`] : []), ...tail].join("\n");
  for (let k = n; k >= 0; k--) {
    if (textWith(k).length <= limit) return { text: textWith(k), k, textWith };
  }
  return { text: textWith(0).slice(0, limit), k: 0, textWith };
}

const TAIL = [PAIRS, "(none)", unusedHead(30), "(none)", seqHead(3), "(none)"];
const bulk = (count) => {
  const programs = [];
  const lines = [];
  for (let i = 0; i < count; i++) {
    const name = "p" + String(i).padStart(21, "0");
    programs.push(prog(name));
    lines.push(`lib.${name} (user): 0 uses, 0 failures, never`);
  }
  return { programs, lines };
};

test("reportText: 100 programs of lines of 60 characters, the default limit of 6000", () => {
  const { programs, lines } = bulk(100);
  for (const line of lines) assert.equal(line.length, 60);
  const text = report(programs);
  const model = cutModel("Library report: 100 programs", lines, TAIL, 6000);
  assert.ok(model.k > 0 && model.k < 100);
  assert.equal(text, model.text);
  assert.ok(text.length <= 6000);
  const all = text.split("\n");
  const at = all.indexOf(PAIRS);
  assert.equal(all[at - 1], `(${100 - model.k} more not shown)`);
});

test("reportText: exactly limit characters is kept, one less shows one program the less", () => {
  const { programs, lines } = bulk(30);
  const first = "Library report: 30 programs";
  // the text with 12 of the 30 lines shown, and the line of the 18 others in the place of the rest
  const limit = cutModel(first, lines, TAIL, 1e9).textWith(12).length;
  const kept = cutModel(first, lines, TAIL, limit);
  assert.equal(kept.k, 12);
  assert.equal(report(programs, { limit }), kept.text);
  assert.equal(kept.text.length, limit);
  const fewer = cutModel(first, lines, TAIL, limit - 1);
  assert.equal(fewer.k, 11);
  assert.equal(report(programs, { limit: limit - 1 }), fewer.text);
});

test("reportText: a limit that fits the whole text shows every program and no `more` line", () => {
  const { programs, lines } = bulk(5);
  const whole = cutModel("Library report: 5 programs", lines, TAIL, 1e9).text;
  assert.equal(report(programs, { limit: whole.length }), whole);
  assert.ok(!whole.includes("more not shown"));
  assert.equal(report(programs), whole);
});

test("reportText: the shown programs are the least used, and the one line for the rest takes the place of the others", () => {
  const programs = ["a", "b", "c", "d", "e"].map((name, i) => prog(name, { uses: 5 - i }));
  const lines = [
    "lib.e (user): 1 uses, 0 failures, never",
    "lib.d (user): 2 uses, 0 failures, never",
    "lib.c (user): 3 uses, 0 failures, never",
    "lib.b (user): 4 uses, 0 failures, never",
    "lib.a (user): 5 uses, 0 failures, never",
  ];
  const first = "Library report: 5 programs";
  const limit = cutModel(first, lines, TAIL, 1e9).text.length - 3 * 40; // lines are 39 characters and a newline
  const model = cutModel(first, lines, TAIL, limit);
  assert.ok(model.k >= 1 && model.k <= 3);
  const text = report(programs, { limit });
  assert.equal(text, model.text);
  assert.ok(text.includes(lines[0]));
  assert.ok(!text.includes(lines[4]));
  assert.ok(text.includes(`(${5 - model.k} more not shown)`));
});

test("reportText: a limit with no room for any program line gives the text of k 0, with the one line for them all", () => {
  const { programs, lines } = bulk(10);
  const first = "Library report: 10 programs";
  const k0 = [first, HEAD, "(10 more not shown)", ...TAIL].join("\n");
  assert.equal(report(programs, { limit: k0.length }), k0);
  assert.equal(report(programs, { limit: k0.length + 59 }), k0);
  assert.equal(report(programs, { limit: k0.length + 60 }), cutModel(first, lines, TAIL, k0.length + 60).text);
});

test("reportText: when even that is too long, the result is its first limit characters", () => {
  const { programs } = bulk(10);
  const k0 = ["Library report: 10 programs", HEAD, "(10 more not shown)", ...TAIL].join("\n");
  for (const limit of [1, 10, 50, k0.length - 1]) {
    const got = report(programs, { limit });
    assert.equal(got.length, limit);
    assert.equal(got, k0.slice(0, limit));
  }
});

test("reportText: nothing but program lines gives way: the other sections are whole under a small limit", () => {
  const programs = [
    prog("cityCount", { tools: ["practice.rows"], lastUse: NOW - 40 * DAY }),
    prog("cityShare", { tools: ["practice.rows", "practice.count"], lastUse: NOW - 41 * DAY }),
    ...bulk(40).programs,
  ];
  const sequences = [["x.y"], ["x.y"], ["x.y"]];
  const full = sections(report(programs, { sequences, limit: 100000 }));
  const cut = sections(report(programs, { sequences, limit: 1200 }));
  assert.ok(cut.programs.length < full.programs.length);
  assert.deepEqual(cut.pairs, full.pairs);
  assert.deepEqual(cut.unused, full.unused);
  assert.deepEqual(cut.seqs, full.seqs);
});

// ---- no change, no clock

test("reportText: does not change what it is given", () => {
  const programs = deepFreeze([
    prog("a", { tools: ["p.x"], uses: 2, lastUse: NOW - 40 * DAY }),
    prog("b", { tools: ["p.x"], uses: 1, lastUse: null }),
  ]);
  const sequences = deepFreeze([["q.r"], ["q.r"], ["q.r"]]);
  const options = deepFreeze({ sequences, log: true, now: NOW, unusedDays: 30, times: 3, limit: 6000 });
  const text = lib.reportText(programs, options);
  assert.equal(typeof text, "string");
  assert.equal(text, lib.reportText(programs, options));
});

test("reportText: the time is the argument now: the same text for the same now, another for another", () => {
  const programs = [prog("a", { lastUse: NOW })];
  assert.deepEqual(sections(lib.reportText(programs, { now: NOW + 30 * DAY })).unused, ["(none)"]);
  assert.deepEqual(sections(lib.reportText(programs, { now: NOW + 30 * DAY + 1 })).unused, ["lib.a"]);
});

test("reportText: when now is not passed it is the clock at the call", () => {
  const programs = [prog("old", { lastUse: Date.now() - 31 * DAY }), prog("new", { lastUse: Date.now() - DAY })];
  assert.deepEqual(sections(lib.reportText(programs)).unused, ["lib.old"]);
});

// ---- logArgs

test("logArgs: report is an empty object, whatever args holds", () => {
  assert.deepEqual(lib.logArgs("report", {}), {});
  assert.deepEqual(lib.logArgs("report", { name: "x", unusedDays: 3, code: "secret" }), {});
  assert.deepEqual(Object.keys(lib.logArgs("report", { a: 1 })), []);
});

test("logArgs: restore and read are the name when it is a string, else null", () => {
  for (const tool of ["restore", "read"]) {
    assert.deepEqual(lib.logArgs(tool, { name: "cityCount", extra: 1 }), { name: "cityCount" });
    assert.deepEqual(lib.logArgs(tool, { name: "" }), { name: "" });
    assert.deepEqual(lib.logArgs(tool, { name: "bad name!" }), { name: "bad name!" });
    assert.deepEqual(lib.logArgs(tool, { name: 5 }), { name: null });
    assert.deepEqual(lib.logArgs(tool, { name: null }), { name: null });
    assert.deepEqual(lib.logArgs(tool, {}), { name: null });
  }
});

test("logArgs: report, restore and read give null for args that is not a plain object", () => {
  for (const tool of ["report", "restore", "read"]) {
    for (const args of [null, undefined, [], ["a"], "text", 5, true]) assert.equal(lib.logArgs(tool, args), null);
  }
});

test("logArgs: the two older rows are as they were, and another tool is still null", () => {
  assert.deepEqual(lib.logArgs("save", { name: "n", code: "abc", replace: true }), { name: "n", codeSize: 3, replace: true });
  assert.deepEqual(lib.logArgs("remove", { name: "n" }), { name: "n" });
  for (const tool of ["run", "list", "Report", "Restore", "READ", "", undefined, null, 5]) {
    assert.equal(lib.logArgs(tool, { name: "n" }), null);
  }
});
