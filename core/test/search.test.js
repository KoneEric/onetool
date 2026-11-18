import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toolLine, searchTools } from "../src/index.js";
import { deepFreeze, printedBy } from "./helpers.js";

const props = (o) => ({ type: "object", properties: o });

describe("toolLine: the arguments", () => {
  test("the example of the meeting point", () => {
    const tool = {
      name: "rows",
      description: "Returns the practice table: 5,000 rows of id, name, city and amount.",
      inputSchema: props({ city: { type: "string" } }),
    };
    assert.equal(toolLine("practice", tool), "practice.rows(city?: string) - Returns the practice table: 5,000 rows of id, name, city and amount.");
  });

  test("required arguments have no question mark, in the order of the properties", () => {
    const tool = {
      name: "t",
      description: "D.",
      inputSchema: { ...props({ b: { type: "number" }, a: { type: "string" }, c: { type: "boolean" } }), required: ["a", "b"] },
    };
    assert.equal(toolLine("s", tool), "s.t(b: number, a: string, c?: boolean) - D.");
  });

  test("a type that is a list: its items joined by |", () => {
    const tool = { name: "t", inputSchema: props({ a: { type: ["string", "null"] }, b: { type: ["number", "string", "null"] } }) };
    assert.equal(toolLine("s", tool), "s.t(a?: string|null, b?: number|string|null)");
  });

  test("a type that is neither a string nor a list: any", () => {
    const tool = {
      name: "t",
      inputSchema: {
        ...props({ a: {}, b: { type: 5 }, c: { type: {} }, d: { description: "x" }, e: { anyOf: [{ type: "string" }] } }),
        required: ["a"],
      },
    };
    assert.equal(toolLine("s", tool), "s.t(a: any, b?: any, c?: any, d?: any, e?: any)");
  });

  test("no inputSchema, no properties, none in it: ()", () => {
    assert.equal(toolLine("s", { name: "t" }), "s.t()");
    assert.equal(toolLine("s", { name: "t", inputSchema: {} }), "s.t()");
    assert.equal(toolLine("s", { name: "t", inputSchema: { type: "object" } }), "s.t()");
    assert.equal(toolLine("s", { name: "t", inputSchema: { type: "object", properties: {} } }), "s.t()");
    assert.equal(toolLine("s", { name: "t", inputSchema: { type: "object", properties: {}, required: ["a"] } }), "s.t()");
  });

  test("a required that is not a list counts as empty", () => {
    for (const required of ["a", { a: true }, 5, true, null]) {
      const tool = { name: "t", inputSchema: { ...props({ a: { type: "string" }, b: { type: "number" } }), required } };
      assert.equal(toolLine("s", tool), "s.t(a?: string, b?: number)", JSON.stringify(required));
    }
  });

  test("a name in required that is not a property adds nothing", () => {
    const tool = { name: "t", inputSchema: { ...props({ a: { type: "string" } }), required: ["zzz", "a"] } };
    assert.equal(toolLine("s", tool), "s.t(a: string)");
  });
});

describe("toolLine: the sentence", () => {
  const sentence = (description) => toolLine("s", { name: "t", description });

  test("up to and including the first . ! or ? followed by a space", () => {
    assert.equal(sentence("Hello world. Second one."), "s.t() - Hello world.");
    assert.equal(sentence("Wow! Next one."), "s.t() - Wow!");
    assert.equal(sentence("Really? Next one."), "s.t() - Really?");
    assert.equal(sentence("First? Then. Later!"), "s.t() - First?");
  });

  test("a mark that ends the text ends the sentence", () => {
    assert.equal(sentence("Only one."), "s.t() - Only one.");
    assert.equal(sentence("Only one!"), "s.t() - Only one!");
    assert.equal(sentence("Only one?"), "s.t() - Only one?");
  });

  test("no mark: all of the text", () => {
    assert.equal(sentence("No stop here"), "s.t() - No stop here");
  });

  test("a mark not followed by a space does not end the sentence", () => {
    assert.equal(sentence("Version 1.5 is out. More."), "s.t() - Version 1.5 is out.");
    assert.equal(sentence("a.b.c"), "s.t() - a.b.c");
    assert.equal(sentence("See a.b.c for it. Then"), "s.t() - See a.b.c for it.");
    assert.equal(sentence("What?! Next"), "s.t() - What?!");
  });

  test("runs of white space become one space and the ends are trimmed", () => {
    assert.equal(sentence("  Hello \n\t world  "), "s.t() - Hello world");
    assert.equal(sentence("Hello.  World."), "s.t() - Hello.");
    assert.equal(sentence("Line one.\nLine two."), "s.t() - Line one.");
    assert.equal(sentence("a  b\r\nc"), "s.t() - a b c");
    assert.equal(sentence("Returns\nthe  rows\tof it. Next."), "s.t() - Returns the rows of it.");
  });

  test("an absent or empty description: the line ends after the parenthesis", () => {
    assert.equal(toolLine("s", { name: "t" }), "s.t()");
    assert.equal(sentence(undefined), "s.t()");
    assert.equal(sentence(""), "s.t()");
    assert.equal(sentence("   \n\t "), "s.t()");
    assert.equal(toolLine("s", { name: "t", description: "", inputSchema: props({ a: { type: "string" } }) }), "s.t(a?: string)");
  });

  test("a sentence of 160 characters is kept; of 161 is cut to its first 157 and `...`", () => {
    // 159 letters + "." = 160 characters; 160 letters + "." = 161 characters
    assert.equal(sentence("b".repeat(159) + "."), "s.t() - " + "b".repeat(159) + ".");
    assert.equal(sentence("b".repeat(160) + "."), "s.t() - " + "b".repeat(157) + "...");
    assert.equal(sentence("b".repeat(160)), "s.t() - " + "b".repeat(160));
    assert.equal(sentence("b".repeat(161)), "s.t() - " + "b".repeat(157) + "...");
    assert.equal(sentence("c".repeat(300) + ". Next."), "s.t() - " + "c".repeat(157) + "...");
  });

  test("the cut counts the sentence, not the whole description", () => {
    const first = "d".repeat(100) + ".";
    assert.equal(sentence(first + " " + "e".repeat(300)), "s.t() - " + first);
  });

  test("the cut counts after white space is collapsed", () => {
    // 159 letters split by a run of 4 spaces, then "." : 160 characters once collapsed
    const text = "f".repeat(80) + "    " + "f".repeat(78) + ".";
    assert.equal(sentence(text), "s.t() - " + "f".repeat(80) + " " + "f".repeat(78) + ".");
  });
});

// -- searchTools -------------------------------------------------------------

const t = (name, description, properties, required) => {
  const tool = { name };
  if (description !== undefined) tool.description = description;
  if (properties) tool.inputSchema = { type: "object", properties, ...(required ? { required } : {}) };
  return tool;
};
const line = (server, name) => `${server}.${name}()`; // a tool with no description and no arguments
const bare = (name) => ({ name });

describe("searchTools: no words", () => {
  const catalog = [
    { server: "alpha", tools: [t("a1"), t("a2")] },
    { server: "dead", tools: [], error: "spawn nope ENOENT" },
    { server: "one", tools: [t("x")] },
    { server: "empty", tools: [] },
  ];
  const expected = ["alpha: 2 tools", "dead: not connected (spawn nope ENOENT)", "one: 1 tools", "empty: 0 tools"].join("\n");

  test("one line per entry, in catalog order", () => {
    assert.equal(searchTools(catalog), expected);
  });

  test("undefined, null, empty and white space only give the same answer", () => {
    for (const words of [undefined, null, "", " ", "  \n\t ", " "]) {
      assert.equal(searchTools(catalog, words), expected, JSON.stringify(words));
    }
  });

  test("the limit does not cut the list of servers", () => {
    assert.equal(searchTools(catalog, "", { limit: 1 }), expected);
    assert.equal(searchTools(catalog, undefined, { limit: 2 }), expected);
  });

  test("an empty catalog", () => {
    assert.equal(searchTools([]), "No server is listed.");
    assert.equal(searchTools([], ""), "No server is listed.");
    assert.equal(searchTools([], "  "), "No server is listed.");
  });

  test("a single server", () => {
    assert.equal(searchTools([{ server: "s", tools: [t("a")] }], null), "s: 1 tools");
  });
});

describe("searchTools: the score", () => {
  test("a word in the id scores 2, in the description or an argument name scores 1, ranked", () => {
    const catalog = [
      {
        server: "s",
        tools: [
          t("in_arg", undefined, { zebra: { type: "string" } }), // 1: argument name
          t("in_desc", "Talks about a zebra."), // 1: description
          t("zebra_id"), // 2: id
          t("nothing", "Talks about a horse."), // 0
        ],
      },
    ];
    assert.equal(
      searchTools(catalog, "zebra"),
      ["s.zebra_id()", "s.in_arg(zebra?: string)", "s.in_desc() - Talks about a zebra."].join("\n"),
    );
  });

  test("equal scores keep the catalog order, across servers and within one", () => {
    const catalog = [
      { server: "a", tools: [t("one", "has fig"), t("fig_two"), t("three", "has fig too")] },
      { server: "b", tools: [t("fig_four"), t("five", "no")] },
      { server: "c", tools: [t("six", "fig again")] },
    ];
    assert.equal(
      searchTools(catalog, "fig"),
      [
        "a.fig_two()",
        "b.fig_four()",
        "a.one() - has fig",
        "a.three() - has fig too",
        "c.six() - fig again",
      ].join("\n"),
    );
  });

  test("a word in the id and in the description still scores 2, not 3", () => {
    // kiwi_x: id (2) and description (1) still score 2, not 3; y_kiwi: id only (2); a tie, so catalog order
    const catalog = [{ server: "s", tools: [t("y_kiwi"), t("kiwi_x", "A kiwi.")] }];
    assert.equal(searchTools(catalog, "kiwi"), ["s.y_kiwi()", "s.kiwi_x() - A kiwi."].join("\n"));
  });

  test("a word in the description and in an argument name scores 1, not 2", () => {
    // first: description and argument name score 1 together; plum_second: id scores 2, so it ranks first
    const catalog = [
      { server: "s", tools: [t("first", "Uses plum.", { plum: { type: "string" } }), t("plum_second")] },
    ];
    assert.equal(searchTools(catalog, "plum"), ["s.plum_second()", "s.first(plum?: string) - Uses plum."].join("\n"));
  });

  test("the scores of the words add up", () => {
    // words "red blue": p: red in id (2) + blue in desc (1) = 3; q: red in desc (1) + blue in id (2) = 3;
    // r: red in id (2) = 2; s: blue in arg (1) = 1
    const catalog = [
      {
        server: "x",
        tools: [
          t("s_tool", undefined, { blue: { type: "string" } }),
          t("r_red"),
          t("q_blue", "Is red."),
          t("p_red", "Is blue."),
        ],
      },
    ];
    assert.equal(
      searchTools(catalog, "red blue"),
      ["x.q_blue() - Is red.", "x.p_red() - Is blue.", "x.r_red()", "x.s_tool(blue?: string)"].join("\n"),
    );
  });

  test("a tool that matches one word of two still matches", () => {
    const catalog = [{ server: "x", tools: [t("alpha_tool"), t("beta_tool"), t("gamma_tool")] }];
    assert.equal(searchTools(catalog, "alpha gamma"), ["x.alpha_tool()", "x.gamma_tool()"].join("\n"));
  });

  test("the same word given twice counts twice", () => {
    // words "foo foo bar": x: foo in description twice = 2; y: bar in id = 2; tie, so catalog order x, y
    // (counted once, x would score 1 and y would come first)
    const catalog = [{ server: "s", tools: [t("x", "Has foo."), t("y_bar")] }];
    assert.equal(searchTools(catalog, "foo foo bar"), ["s.x() - Has foo.", "s.y_bar()"].join("\n"));
  });

  test("the same word twice can lift a tool above another", () => {
    // words "foo foo": a has foo in its description: 1 + 1 = 2; c_foo has it in its id: 2 + 2 = 4, so c_foo ranks first
    const catalog = [{ server: "s", tools: [t("a", "foo"), t("c_foo")] }];
    assert.equal(searchTools(catalog, "foo foo"), ["s.c_foo()", "s.a() - foo"].join("\n"));
  });

  test("case does not count: in the word, the id, the description or the argument", () => {
    const catalog = [
      {
        server: "Srv",
        tools: [t("Fetch_ROWS"), t("two", "Gets ROWS here."), t("three", undefined, { CityName: { type: "string" } })],
      },
    ];
    assert.equal(searchTools(catalog, "rows"), ["Srv.Fetch_ROWS()", "Srv.two() - Gets ROWS here."].join("\n"));
    assert.equal(searchTools(catalog, "ROWS"), ["Srv.Fetch_ROWS()", "Srv.two() - Gets ROWS here."].join("\n"));
    assert.equal(searchTools(catalog, "cityname"), "Srv.three(CityName?: string)");
    assert.equal(searchTools(catalog, "CITYNAME"), "Srv.three(CityName?: string)");
    assert.equal(searchTools(catalog, "srv.fetch"), "Srv.Fetch_ROWS()");
  });

  test("a word is found as a part of the text, anywhere", () => {
    const catalog = [{ server: "server", tools: [t("rows", "Returns the table.")] }];
    for (const word of ["ow", "rows", "serv", "ver.r", "server.rows", "ret", "table", "e."]) {
      assert.equal(searchTools(catalog, word), "server.rows() - Returns the table.", word);
    }
  });

  test("the server's name is part of the id", () => {
    const catalog = [{ server: "practice", tools: [t("rows"), t("wipe", "Deletes things.")] }];
    assert.equal(searchTools(catalog, "practice"), "practice.rows()\npractice.wipe() - Deletes things.");
  });

  test("the whole description counts, not only the sentence shown", () => {
    const catalog = [{ server: "s", tools: [t("t", "First one. Mentions zebra here.")] }];
    assert.equal(searchTools(catalog, "zebra"), "s.t() - First one.");
  });

  test("words are split at white space of any kind, with no empty word", () => {
    const catalog = [{ server: "s", tools: [t("red_one"), t("blue_one"), t("green_one")] }];
    const expected = "s.red_one()\ns.blue_one()";
    assert.equal(searchTools(catalog, "red blue"), expected);
    assert.equal(searchTools(catalog, "  red \t\n  blue  "), expected);
    assert.equal(searchTools(catalog, "blue red"), "s.red_one()\ns.blue_one()");
  });

  test("a word is text, not a pattern", () => {
    const catalog = [{ server: "s", tools: [t("a", "uses a+b"), t("b", "uses aab"), t("c", "(x)"), t("d", "x")] }];
    assert.equal(searchTools(catalog, "a+b"), "s.a() - uses a+b");
    assert.equal(searchTools(catalog, "(x)"), "s.c() - (x)");
    assert.equal(searchTools(catalog, "*"), "No tool matches.");
    assert.equal(searchTools(catalog, ".*"), "No tool matches.");
  });

  test("a tool with no description and no schema can match by id only", () => {
    const catalog = [{ server: "s", tools: [bare("find_me"), bare("other")] }];
    assert.equal(searchTools(catalog, "find"), "s.find_me()");
    assert.equal(searchTools(catalog, "nowhere"), "No tool matches.");
  });
});

describe("searchTools: the answer", () => {
  const many = (n, prefix = "m") => Array.from({ length: n }, (_, i) => t(`${prefix}${String(i).padStart(2, "0")}_hit`));
  const lines = (n, prefix = "m") => Array.from({ length: n }, (_, i) => `s.${prefix}${String(i).padStart(2, "0")}_hit()`);

  test("no tool matches", () => {
    const catalog = [{ server: "s", tools: [t("a", "b")] }];
    assert.equal(searchTools(catalog, "zzz"), "No tool matches.");
    assert.equal(searchTools([], "zzz"), "No tool matches.");
  });

  test("a server that is not connected matches nothing, even by its name or its reason", () => {
    const catalog = [
      { server: "deadserver", tools: [], error: "deadserver refused: timeout" },
      { server: "s", tools: [t("a")] },
    ];
    assert.equal(searchTools(catalog, "deadserver"), "No tool matches.");
    assert.equal(searchTools(catalog, "timeout"), "No tool matches.");
    assert.equal(searchTools(catalog, "refused a"), "s.a()");
  });

  test("the default limit is 10; more matches add one line", () => {
    const catalog = [{ server: "s", tools: many(12) }];
    const expected = [...lines(10), "(2 more match: add a word)"].join("\n");
    assert.equal(searchTools(catalog, "hit"), expected);
    assert.equal(searchTools(catalog, "hit", {}), expected);
    assert.equal(searchTools(catalog, "hit", undefined), expected);
  });

  test("exactly limit matches are all shown, with no extra line", () => {
    assert.equal(searchTools([{ server: "s", tools: many(10) }], "hit"), lines(10).join("\n"));
    assert.equal(searchTools([{ server: "s", tools: many(3) }], "hit", { limit: 3 }), lines(3).join("\n"));
  });

  test("one more match than the limit", () => {
    assert.equal(searchTools([{ server: "s", tools: many(11) }], "hit"), [...lines(10), "(1 more match: add a word)"].join("\n"));
  });

  test("a limit given", () => {
    const catalog = [{ server: "s", tools: many(5) }];
    assert.equal(searchTools(catalog, "hit", { limit: 2 }), [...lines(2), "(3 more match: add a word)"].join("\n"));
    assert.equal(searchTools(catalog, "hit", { limit: 1 }), [...lines(1), "(4 more match: add a word)"].join("\n"));
    assert.equal(searchTools(catalog, "hit", { limit: 100 }), lines(5).join("\n"));
  });

  test("the lines shown are the highest ranked, the count is of those not shown", () => {
    const catalog = [
      { server: "s", tools: [t("low1", "has kiwi"), t("low2", "has kiwi"), t("kiwi_high1"), t("low3", "has kiwi"), t("kiwi_high2")] },
    ];
    assert.equal(
      searchTools(catalog, "kiwi", { limit: 3 }),
      ["s.kiwi_high1()", "s.kiwi_high2()", "s.low1() - has kiwi", "(2 more match: add a word)"].join("\n"),
    );
  });

  test("the extra line is not counted in the limit, and matches across servers are counted together", () => {
    const catalog = [
      { server: "a", tools: [t("x_hit"), t("y_hit")] },
      { server: "b", tools: [t("z_hit")] },
    ];
    assert.equal(searchTools(catalog, "hit", { limit: 2 }), ["a.x_hit()", "a.y_hit()", "(1 more match: add a word)"].join("\n"));
  });
});

describe("toolLine and searchTools: purity", () => {
  test("they do not change their arguments and print nothing", () => {
    const tool = deepFreeze(t("a_hit", "Some text. More.", { x: { type: ["string", "null"] } }, ["x"]));
    const catalog = deepFreeze([
      { server: "s", tools: [tool, t("b", "hit")] },
      { server: "d", tools: [], error: "down" },
    ]);
    const printed = printedBy(() => {
      toolLine("s", tool);
      searchTools(catalog, undefined);
      searchTools(catalog, "hit", { limit: 1 });
      searchTools(catalog, "none");
    });
    assert.deepEqual(printed, []);
  });
});
