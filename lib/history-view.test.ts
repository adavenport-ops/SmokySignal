// Run: npx tsx --test lib/history-view.test.ts
//
// Pins history mode's pure half: URL state round-trips, preset → Pacific
// range resolution (month edges, the 2026-10-16 floor), per-tail colours
// (never warm) and the summary chip copy.

import { test } from "node:test";
import assert from "node:assert";
import {
  HISTORY_FLOOR,
  HISTORY_SINGLE_COLOR,
  HISTORY_TAIL_PALETTE,
  PER_TAIL_COLOR_MAX,
  assignTailColors,
  clampRange,
  flightCardText,
  formatHours,
  formatSummaryChip,
  historyApiQuery,
  historyMonths,
  historyPresets,
  historySubject,
  historyToFlight3DPaths,
  isWarmHex,
  parseHistoryParams,
  polylinesToGeoJSON,
  presetForRange,
  ptDate,
  rangeLabel,
  resolvePreset,
  sameHistoryState,
  serializeHistoryParams,
  type HistoryState,
} from "./history-view";
import { SS_TOKENS } from "./tokens";

const TODAY = "2026-11-18";

// ─── URL state ───────────────────────────────────────────────────────

test("parse: no h=1 means live mode", () => {
  assert.strictEqual(parseHistoryParams(new URLSearchParams(""), TODAY), null);
  assert.strictEqual(parseHistoryParams(new URLSearchParams("from=2026-11-01&to=2026-11-05"), TODAY), null);
  assert.strictEqual(parseHistoryParams(new URLSearchParams("h=0&from=2026-11-01"), TODAY), null);
});

test("parse: full state", () => {
  const s = parseHistoryParams(
    new URLSearchParams("h=1&from=2026-11-01&to=2026-11-17&tail=n305dk,N2446X&mission=police,sar"),
    TODAY,
  );
  assert.deepStrictEqual(s, {
    from: "2026-11-01",
    to: "2026-11-17",
    tails: ["N2446X", "N305DK"],
    missions: ["police", "sar"],
  });
});

test("parse: defaults to Last 7 days and Smokey", () => {
  const s = parseHistoryParams(new URLSearchParams("h=1"), TODAY)!;
  assert.strictEqual(s.from, "2026-11-12");
  assert.strictEqual(s.to, TODAY);
  assert.deepStrictEqual(s.tails, []);
  assert.deepStrictEqual(s.missions, ["police"]);
});

test("parse: bad and out-of-record dates are clamped or replaced", () => {
  // Malformed → Last 7 days.
  const bad = parseHistoryParams(new URLSearchParams("h=1&from=nope&to=2026-11-31"), TODAY)!;
  assert.deepStrictEqual([bad.from, bad.to], ["2026-11-12", TODAY]);
  // Before the floor / after today → clamped to the record.
  const wide = parseHistoryParams(new URLSearchParams("h=1&from=2026-08-01&to=2027-01-01"), TODAY)!;
  assert.deepStrictEqual([wide.from, wide.to], [HISTORY_FLOOR, TODAY]);
  // Reversed → swapped.
  const rev = parseHistoryParams(new URLSearchParams("h=1&from=2026-11-10&to=2026-11-02"), TODAY)!;
  assert.deepStrictEqual([rev.from, rev.to], ["2026-11-02", "2026-11-10"]);
});

test("parse: junk tails dropped, repeat params merged, mission=all", () => {
  const s = parseHistoryParams(
    new URLSearchParams("h=1&tail=N305DK&tail=<script>&tail=N2446X,N305DK&mission=all"),
    TODAY,
  )!;
  assert.deepStrictEqual(s.tails, ["N2446X", "N305DK"]);
  assert.strictEqual(s.missions.length, 8);
});

test("serialize: round-trips and keeps unrelated params", () => {
  const states: HistoryState[] = [
    { from: "2026-11-01", to: "2026-11-17", tails: ["N305DK"], missions: ["police"] },
    { from: "2026-10-16", to: "2026-10-31", tails: [], missions: ["police", "sar", "medevac"] },
    { from: "2026-11-18", to: "2026-11-18", tails: ["N2446X", "N305DK"], missions: ["sar"] },
  ];
  for (const s of states) {
    const p = serializeHistoryParams(s, new URLSearchParams("mock=up&h=0&tail=OLD"));
    assert.strictEqual(p.get("mock"), "up");
    assert.strictEqual(p.get("h"), "1");
    assert.strictEqual(p.getAll("tail").length, s.tails.length > 0 ? 1 : 0);
    const back = parseHistoryParams(p, TODAY);
    assert.ok(sameHistoryState(back, s), `${p.toString()} → ${JSON.stringify(back)}`);
  }
});

test("serialize: default Smokey mission stays implicit", () => {
  const p = serializeHistoryParams({ from: "2026-11-12", to: TODAY, tails: [], missions: ["police"] });
  assert.strictEqual(p.toString(), "h=1&from=2026-11-12&to=2026-11-18");
});

test("api query: tails win over missions", () => {
  assert.strictEqual(
    historyApiQuery({ from: "2026-11-01", to: "2026-11-30", tails: ["N305DK"], missions: ["police"] }),
    "from=2026-11-01&to=2026-11-30&tail=N305DK",
  );
  assert.strictEqual(
    historyApiQuery({ from: "2026-11-01", to: "2026-11-30", tails: [], missions: ["police", "sar"] }),
    "from=2026-11-01&to=2026-11-30&mission=police%2Csar",
  );
  // Every mission = no filter.
  const all = historyApiQuery({
    from: "2026-11-01",
    to: "2026-11-02",
    tails: [],
    missions: ["police", "federal_le", "sar", "wildfire", "medevac", "survey", "transport", "unknown"],
  });
  assert.strictEqual(all, "from=2026-11-01&to=2026-11-02");
});

// ─── presets ─────────────────────────────────────────────────────────

test("presets: rolling windows end today", () => {
  assert.deepStrictEqual(resolvePreset("last7", TODAY), { from: "2026-11-12", to: TODAY });
  assert.deepStrictEqual(resolvePreset("last30", TODAY), { from: "2026-10-20", to: TODAY });
});

test("presets: rolling windows stop at the floor", () => {
  assert.deepStrictEqual(resolvePreset("last30", "2026-11-01"), { from: HISTORY_FLOOR, to: "2026-11-01" });
  assert.deepStrictEqual(resolvePreset("last7", "2026-10-18"), { from: HISTORY_FLOOR, to: "2026-10-18" });
  assert.strictEqual(resolvePreset("last7", "2026-10-01"), null);
});

test("presets: months clip to the floor and to today", () => {
  assert.deepStrictEqual(resolvePreset("month:2026-10", TODAY), { from: "2026-10-16", to: "2026-10-31" });
  assert.deepStrictEqual(resolvePreset("month:2026-11", TODAY), { from: "2026-11-01", to: TODAY });
  assert.deepStrictEqual(resolvePreset("month:2026-12", "2027-01-05"), { from: "2026-12-01", to: "2026-12-31" });
  // Before the record, and in the future.
  assert.strictEqual(resolvePreset("month:2026-09", TODAY), null);
  assert.strictEqual(resolvePreset("month:2026-12", TODAY), null);
});

test("presets: month lengths, leap February", () => {
  assert.deepStrictEqual(resolvePreset("month:2027-02", "2027-06-01"), { from: "2027-02-01", to: "2027-02-28" });
  assert.deepStrictEqual(resolvePreset("month:2028-02", "2028-06-01"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepStrictEqual(resolvePreset("month:2027-04", "2027-06-01"), { from: "2027-04-01", to: "2027-04-30" });
});

test("presets: months on record, newest first, across a year end", () => {
  assert.deepStrictEqual(historyMonths(TODAY), ["2026-11", "2026-10"]);
  assert.deepStrictEqual(historyMonths("2027-01-02"), ["2027-01", "2026-12", "2026-11", "2026-10"]);
  assert.deepStrictEqual(historyMonths("2026-10-16"), ["2026-10"]);
  assert.deepStrictEqual(historyMonths("2026-10-15"), []);
  assert.deepStrictEqual(
    historyPresets(TODAY).map((p) => p.label),
    ["Last 7 days", "Last 30 days", "November 2026", "October 2026"],
  );
});

test("presets: a range maps back to its preset", () => {
  assert.strictEqual(presetForRange({ from: "2026-10-16", to: "2026-10-31" }, TODAY), "month:2026-10");
  assert.strictEqual(presetForRange({ from: "2026-11-12", to: TODAY }, TODAY), "last7");
  assert.strictEqual(presetForRange({ from: "2026-11-02", to: "2026-11-09" }, TODAY), null);
});

test("custom range: clamp, swap, cap", () => {
  assert.deepStrictEqual(clampRange("2026-11-05", "2026-11-01", TODAY), { from: "2026-11-01", to: "2026-11-05" });
  assert.deepStrictEqual(clampRange("2026-01-01", "2026-02-01", TODAY), { from: HISTORY_FLOOR, to: HISTORY_FLOOR });
  assert.deepStrictEqual(clampRange("2026-12-01", "2026-12-24", TODAY), { from: TODAY, to: TODAY });
  assert.strictEqual(clampRange("", TODAY, TODAY), null);
  assert.strictEqual(clampRange("2026-02-30", TODAY, TODAY), null);
  const long = clampRange("2026-10-16", "2028-01-01", "2028-01-01")!;
  assert.deepStrictEqual(long, { from: "2027-01-01", to: "2028-01-01" });
});

test("ptDate: Pacific calendar day, not UTC", () => {
  // 2026-11-18 06:30 UTC is 22:30 PST on the 17th.
  assert.strictEqual(ptDate(Date.UTC(2026, 10, 18, 6, 30)), "2026-11-17");
  assert.strictEqual(ptDate(Date.UTC(2026, 10, 18, 8, 30)), "2026-11-18");
  // PDT (UTC-7) before the 2026-11-01 fall-back.
  assert.strictEqual(ptDate(Date.UTC(2026, 9, 31, 6, 59)), "2026-10-30");
  assert.strictEqual(ptDate(Date.UTC(2026, 9, 31, 7, 0)), "2026-10-31");
});

// ─── colours ─────────────────────────────────────────────────────────

test("colours: palette is cool, distinct, never alert orange", () => {
  assert.strictEqual(HISTORY_TAIL_PALETTE.length, PER_TAIL_COLOR_MAX);
  assert.strictEqual(new Set(HISTORY_TAIL_PALETTE.map((c) => c.toLowerCase())).size, PER_TAIL_COLOR_MAX);
  for (const c of [...HISTORY_TAIL_PALETTE, HISTORY_SINGLE_COLOR]) {
    assert.ok(!isWarmHex(c), `${c} reads warm`);
    assert.notStrictEqual(c.toLowerCase(), SS_TOKENS.alert.toLowerCase());
    assert.notStrictEqual(c.toLowerCase(), SS_TOKENS.clear.toLowerCase());
    assert.notStrictEqual(c.toLowerCase(), SS_TOKENS.sky.toLowerCase());
  }
  assert.ok(isWarmHex(SS_TOKENS.alert), "the warm check itself must catch alert orange");
});

test("colours: one slot per tail up to six, stable order", () => {
  const a = assignTailColors(["N305DK", "n2446x", "N305DK"]);
  assert.deepStrictEqual(Object.keys(a), ["N2446X", "N305DK"]);
  assert.strictEqual(a.N2446X, HISTORY_TAIL_PALETTE[0]);
  assert.strictEqual(a.N305DK, HISTORY_TAIL_PALETTE[1]);
  assert.deepStrictEqual(assignTailColors(["N305DK", "N2446X"]), assignTailColors(["N2446X", "N305DK"]));
  const six = assignTailColors(["A1", "A2", "A3", "A4", "A5", "A6"]);
  assert.strictEqual(new Set(Object.values(six)).size, 6);
});

test("colours: more than six tails collapse to one colour", () => {
  const seven = assignTailColors(["A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
  assert.deepStrictEqual(new Set(Object.values(seven)), new Set([HISTORY_SINGLE_COLOR]));
  assert.deepStrictEqual(assignTailColors([]), {});
});

test("colours: line features carry their tail colour", () => {
  const fc = polylinesToGeoJSON(
    [
      { id: "f1", tail: "N305DK", points: [[47.1, -122.3, 1200, 1], [47.2, -122.4, 1500, 2]] },
      { id: "f2", tail: "N305DK", points: [[47.1, -122.3, 1200, 1]] },
    ],
    { N305DK: "#7FC8C2" },
  );
  assert.strictEqual(fc.features.length, 1, "single-vertex lines dropped");
  assert.deepStrictEqual(fc.features[0]!.geometry.coordinates, [[-122.3, 47.1], [-122.4, 47.2]]);
  assert.strictEqual(fc.features[0]!.properties.color, "#7FC8C2");
});

// ─── copy ────────────────────────────────────────────────────────────

test("summary chip: owner's example", () => {
  assert.strictEqual(
    formatSummaryChip({ subject: "N305DK", range: "Nov 2026", flights: 14, airborne_s: 68_760 }),
    "N305DK · Nov 2026 · 14 flights · 19.1 h",
  );
});

test("summary chip: singular flight, zero, rounding", () => {
  assert.strictEqual(
    formatSummaryChip({ subject: "Smokey", range: "Last 30 days", flights: 1, airborne_s: 1800 }),
    "Smokey · Last 30 days · 1 flight · 0.5 h",
  );
  assert.strictEqual(formatHours(0), "0.0 h");
  assert.strictEqual(formatHours(3600 * 2.25), "2.3 h");
});

test("subject: tail, tail count, mission set", () => {
  assert.strictEqual(historySubject({ tails: ["N305DK"], missions: ["police"] }), "N305DK");
  assert.strictEqual(historySubject({ tails: ["A1", "A2", "A3"], missions: ["police"] }), "3 tails");
  assert.strictEqual(historySubject({ tails: [], missions: ["police"] }), "Smokey");
  assert.strictEqual(historySubject({ tails: [], missions: ["police", "sar"] }), "Smokey + Search & Rescue");
  assert.strictEqual(historySubject({ tails: [], missions: ["police", "sar", "medevac"] }), "3 missions");
});

test("range label: months, presets, custom spans", () => {
  assert.strictEqual(rangeLabel({ from: "2026-11-01", to: TODAY }, TODAY), "Nov 2026");
  assert.strictEqual(rangeLabel({ from: "2026-10-16", to: "2026-10-31" }, TODAY), "Oct 2026");
  assert.strictEqual(rangeLabel({ from: "2026-11-12", to: TODAY }, TODAY), "Last 7 days");
  assert.strictEqual(rangeLabel({ from: "2026-10-20", to: TODAY }, TODAY), "Last 30 days");
  assert.strictEqual(rangeLabel({ from: "2026-11-03", to: "2026-11-09" }, TODAY), "Nov 3–9");
  assert.strictEqual(rangeLabel({ from: "2026-10-20", to: "2026-11-05" }, TODAY), "Oct 20–Nov 5");
  assert.strictEqual(rangeLabel({ from: "2026-11-09", to: "2026-11-09" }, TODAY), "Nov 9");
  assert.strictEqual(
    rangeLabel({ from: "2026-12-20", to: "2027-01-04" }, "2027-02-01"),
    "Dec 20 2026–Jan 4 2027",
  );
});

test("flight card: 24-hour Pacific, duration, altitude, link", () => {
  const c = flightCardText({
    tail: "N305DK",
    nickname: "Smokey 4",
    id: "20261111T0419",
    start_ts: Date.UTC(2026, 10, 11, 4, 19, 41),
    end_ts: Date.UTC(2026, 10, 11, 6, 7, 4),
    duration_s: 6443,
    max_alt_ft: 3700,
  });
  assert.strictEqual(c.date, "Tue 10 Nov 2026");
  assert.strictEqual(c.time, "20:19–22:07 PT");
  assert.strictEqual(c.duration, "1h 47m");
  assert.strictEqual(c.maxAlt, "3,700′");
  assert.strictEqual(c.href, "/flight/N305DK/20261111T0419");
});

test("3D adapter: polylines → paths with colour", () => {
  const paths = historyToFlight3DPaths(
    [{ id: "f1", tail: "N305DK", points: [[47.1, -122.3, 1200, 1], [47.2, -122.4, null, 2]] }],
    { N305DK: "#8FA9E0" },
  );
  assert.deepStrictEqual(paths, [
    {
      id: "f1",
      color: "#8FA9E0",
      points: [
        { lat: 47.1, lon: -122.3, alt: 1200, ts: 1 },
        { lat: 47.2, lon: -122.4, alt: null, ts: 2 },
      ],
    },
  ]);
});

test("layer paint stops are valid MapLibre interpolations", async () => {
  const { HISTORY_HEAT_OPACITY_STOPS, HISTORY_LINE_WIDTH_STOPS } = await import("./history-layers");
  const { stopsAreValid } = await import("./radar-zoom");
  assert.ok(stopsAreValid(HISTORY_HEAT_OPACITY_STOPS));
  assert.ok(stopsAreValid(HISTORY_LINE_WIDTH_STOPS));
  for (const [, v] of HISTORY_HEAT_OPACITY_STOPS) assert.ok(v > 0 && v < 1);
});
