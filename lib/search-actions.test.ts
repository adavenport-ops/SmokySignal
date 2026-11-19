// Run: npx tsx --test lib/search-actions.test.ts
//
// Pins the jump-offs under a tail match in search: the radar history and
// 3D links cover the last 30 Pacific calendar days ending today, and the
// logbook link lands on the plane page's #logbook section.

import { test } from "node:test";
import assert from "node:assert";
import { lastDaysPT, rowHref, searchRows, tailActions } from "./search-actions";
import { buildNavIndex, searchNav, type NavIndexTail } from "./nav-index";

const TAILS: NavIndexTail[] = [
  { tail: "N305DK", nickname: "Smokey 4", operator: "WSP", model: "Cessna 206H", role: "police" },
  { tail: "N2446X", nickname: "Smokey 3", operator: "WSP", model: "Cessna 206H", role: "police" },
];

test("30 days in PT, inclusive of today", () => {
  // 20:00 UTC on 18 Nov = 12:00 PST on 18 Nov.
  assert.deepStrictEqual(lastDaysPT(Date.parse("2026-11-18T20:00:00Z")), { from: "2026-10-20", to: "2026-11-18" });
});

test("the PT day wins over the UTC day near midnight", () => {
  // 05:30 UTC on 19 Nov is still 21:30 PST on 18 Nov.
  const ms = Date.parse("2026-11-19T05:30:00Z");
  assert.deepStrictEqual(lastDaysPT(ms), { from: "2026-10-20", to: "2026-11-18" });
  // 08:30 UTC on 19 Nov is 00:30 PST on 19 Nov.
  assert.strictEqual(lastDaysPT(Date.parse("2026-11-19T08:30:00Z")).to, "2026-11-19");
});

test("a range across the DST change still counts 30 calendar days", () => {
  // 2026-11-01 is the fall-back day. 12:00 PST on 15 Nov.
  assert.deepStrictEqual(lastDaysPT(Date.parse("2026-11-15T20:00:00Z")), { from: "2026-10-17", to: "2026-11-15" });
});

test("tail actions: radar, 3D and logbook links", () => {
  const ms = Date.parse("2026-11-19T05:30:00Z");
  const a = tailActions("n305dk", ms);
  assert.deepStrictEqual(
    a.map((x) => [x.label, x.href]),
    [
      ["Last 30 days on the radar", "/radar?h=1&tail=N305DK&from=2026-10-20&to=2026-11-18"],
      ["Last 30 days in 3D", "/radar?h=1&tail=N305DK&from=2026-10-20&to=2026-11-18&hview=3d"],
      ["Logbook", "/plane/N305DK#logbook"],
    ],
  );
  assert.ok(a.every((x) => x.parentId === "aircraft:N305DK"));
  assert.deepStrictEqual(tailActions("  ", ms), []);
});

test("rows: actions sit right under the first tail match only", () => {
  const ms = Date.parse("2026-11-18T20:00:00Z");
  const index = buildNavIndex({ nowMs: ms, tails: TAILS });
  const rows = searchRows(searchNav(index, "smokey"), ms);
  const firstTail = rows.findIndex((r) => r.type === "result" && r.result.kind === "aircraft");
  assert.ok(firstTail >= 0);
  const actions = rows.filter((r) => r.type === "action");
  assert.strictEqual(actions.length, 3);
  assert.deepStrictEqual(
    rows.slice(firstTail + 1, firstTail + 4).map((r) => r.type),
    ["action", "action", "action"],
  );
  const exact = searchRows(searchNav(index, "N305DK"), ms);
  assert.deepStrictEqual(exact.map(rowHref).slice(0, 4), [
    "/plane/N305DK",
    "/radar?h=1&tail=N305DK&from=2026-10-20&to=2026-11-18",
    "/radar?h=1&tail=N305DK&from=2026-10-20&to=2026-11-18&hview=3d",
    "/plane/N305DK#logbook",
  ]);
  // Row ids are unique, so the listbox can key and reference them.
  assert.strictEqual(new Set(exact.map((r) => r.id)).size, exact.length);
});

test("no tail match, no actions", () => {
  const ms = Date.parse("2026-11-18T20:00:00Z");
  const index = buildNavIndex({ nowMs: ms, tails: TAILS });
  assert.ok(searchRows(searchNav(index, "forecast"), ms).every((r) => r.type === "result"));
});
