import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMiles, formatMilesNm, formatMilesOff, miToNm, nmToMi } from "./units";

test("nm and mi convert both ways", () => {
  assert.equal(Math.round(nmToMi(1) * 1000) / 1000, 1.151);
  assert.ok(Math.abs(miToNm(nmToMi(3.2)) - 3.2) < 1e-9);
});

test("formatMiles: one decimal under 10, whole from 10", () => {
  assert.equal(formatMiles(0.26), "0.3 mi");
  assert.equal(formatMiles(0), "0.0 mi");
  assert.equal(formatMiles(3), "3.5 mi");
  assert.equal(formatMiles(8.65), "10 mi");
  assert.equal(formatMiles(20), "23 mi");
});

test("formatMiles guards bad input", () => {
  assert.equal(formatMiles(Number.NaN), "0 mi");
  assert.equal(formatMiles(-1), "0 mi");
});

test("formatMilesOff and formatMilesNm", () => {
  assert.equal(formatMilesOff(0.26), "0.3 mi off");
  assert.equal(formatMilesNm(3), "3.5 mi (3.0 nm)");
  assert.equal(formatMilesNm(12), "14 mi (12 nm)");
});
