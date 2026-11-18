import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allRows, CITIES } from "../src/rows.js";
import { CITIES as EXPECTED_CITIES, expectedRow } from "./helpers.js";

describe("CITIES", () => {
  test("the eight cities, in order", () => {
    assert.deepEqual(CITIES, EXPECTED_CITIES);
  });
});

describe("allRows", () => {
  test("5,000 rows with the id from 1 to 5000, in order", () => {
    const rows = allRows();
    assert.equal(rows.length, 5000);
    rows.forEach((r, i) => assert.equal(r.id, i + 1));
  });

  test("every row follows the rule of the table", () => {
    const rows = allRows();
    for (let i = 0; i < rows.length; i++) assert.deepEqual(rows[i], expectedRow(i + 1), `row ${i + 1}`);
  });

  test("the examples of the table", () => {
    const rows = allRows();
    assert.equal(rows[0].name, "row-0001");
    assert.equal(rows[4999].name, "row-5000");
    assert.equal(rows[0].city, "Paris");
    assert.equal(rows[8].city, "Paris");
    assert.equal(rows[7].city, "Dijon");
  });

  test("keys in the order id, name, city, amount", () => {
    const rows = allRows();
    for (const r of [rows[0], rows[1234], rows[4999]]) assert.deepEqual(Object.keys(r), ["id", "name", "city", "amount"]);
    assert.ok(rows.every((r) => Object.keys(r).join() === "id,name,city,amount"));
  });

  test("each city has exactly 625 rows", () => {
    const counts = {};
    for (const r of allRows()) counts[r.city] = (counts[r.city] ?? 0) + 1;
    assert.deepEqual(Object.keys(counts).sort(), [...EXPECTED_CITIES].sort());
    for (const c of EXPECTED_CITIES) assert.equal(counts[c], 625, c);
  });

  test("the JSON of the table is longer than 200,000 characters", () => {
    assert.ok(JSON.stringify(allRows()).length > 200000);
  });

  test("a new array on each call", () => {
    const a = allRows();
    const b = allRows();
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
    a.pop();
    const c = allRows();
    assert.equal(c.length, 5000);
    assert.equal(b.length, 5000);
  });
});
