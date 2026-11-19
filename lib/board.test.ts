// Run: npx tsx --test lib/board.test.ts
//
// Pins the /board row formatter: one padded line per tail, 24-hour
// Pacific clock, UP rows ahead of event rows, one row per tail, and the
// ?region= guard that must not resolve prototype keys.

import { test } from "node:test";
import assert from "node:assert";
import {
  BOARD_COMPACT_CELLS,
  BOARD_EVENT_WINDOW_MS,
  BOARD_WIDE_CELLS,
  baseCode,
  boardLayout,
  boardName,
  boardRowText,
  buildBoardRows,
  filterSnapshotToRegion,
  fmtClockPT,
  fmtUpFor,
  formatBoardRow,
  parseBoardRegion,
} from "./board";
import type { ActivityEntry } from "./activity";
import type { Aircraft, FleetRole, Snapshot } from "./types";

// 07:12 PST.
const T0712 = Date.parse("2026-11-18T15:12:00Z");
const NOW = Date.parse("2026-11-18T17:00:00Z"); // 09:00 PST

test("formatBoardRow: departure reads like the board", () => {
  const row = formatBoardRow({
    kind: "takeoff",
    tail: "N305DK",
    nickname: "Smokey 4",
    base: "KOLM Olympia",
    role: "police",
    ts: T0712,
  });
  assert.deepEqual(row, {
    key: "N305DK",
    base: "KOLM",
    name: "SMOKEY 4",
    status: "DEPARTED 07:12",
    tone: "dim",
  });
  assert.equal(boardRowText(row), "KOLM  SMOKEY 4        DEPARTED 07:12");
});

test("formatBoardRow: airborne smokey is UP with minutes, alert tone", () => {
  const row = formatBoardRow({
    kind: "up",
    tail: "N305DK",
    nickname: "Smokey 4",
    base: "KOLM Olympia",
    role: "police",
    aloftMin: 47,
  });
  assert.equal(row.status, "UP 47M");
  assert.equal(row.tone, "alert");
  assert.equal(boardRowText(row), "KOLM  SMOKEY 4        UP 47M");
});

test("formatBoardRow: SAR up is neutral, not orange", () => {
  const row = formatBoardRow({
    kind: "up",
    tail: "N815SC",
    nickname: "SnoHawk 10",
    base: "Taylor's Landing",
    role: "sar",
    aloftMin: 5,
  });
  assert.equal(row.tone, "neutral");
  assert.equal(row.base, "----");
});

test("formatBoardRow: landing and first-seen words", () => {
  const base = { tail: "N422CT", nickname: "Guardian One", base: "KRNT Renton", role: "police" as const };
  assert.equal(formatBoardRow({ ...base, kind: "landing", ts: T0712 }).status, "LANDED 07:12");
  assert.equal(formatBoardRow({ ...base, kind: "first_seen", ts: T0712 }).status, "SPOTTED 07:12");
});

test("fmtUpFor: minutes, hours, unknown", () => {
  assert.equal(fmtUpFor(0), "UP 0M");
  assert.equal(fmtUpFor(47.9), "UP 47M");
  assert.equal(fmtUpFor(60), "UP 1H");
  assert.equal(fmtUpFor(72), "UP 1H 12M");
  assert.equal(fmtUpFor(undefined), "UP");
  assert.equal(fmtUpFor(null), "UP");
  assert.equal(fmtUpFor(-3), "UP");
});

test("fmtClockPT: 24-hour Pacific, midnight is 00 not 24", () => {
  assert.equal(fmtClockPT(T0712), "07:12");
  assert.equal(fmtClockPT(Date.parse("2026-11-18T08:05:00Z")), "00:05");
  assert.equal(fmtClockPT(Date.parse("2026-11-18T23:40:00Z")), "15:40");
  // PDT side of the DST line.
  assert.equal(fmtClockPT(Date.parse("2026-07-04T19:30:00Z")), "12:30");
});

test("baseCode and boardName", () => {
  assert.equal(baseCode("KOLM Olympia"), "KOLM");
  assert.equal(baseCode("KPLU Thun Field, Puyallup"), "KPLU");
  assert.equal(baseCode("Taylor's Landing"), "----");
  assert.equal(baseCode(""), "----");
  assert.equal(boardName("Guardian One (legacy)", "N407KS"), "GUARDIAN ONE");
  assert.equal(boardName(null, "N305RC"), "N305RC");
  assert.equal(boardName("A Very Long Nickname Indeed", "N1"), "A VERY LONG NI");
});

test("parseBoardRegion: known ids only, no prototype keys", () => {
  assert.equal(parseBoardRegion("puget_sound"), "puget_sound");
  assert.equal(parseBoardRegion(["east_wa", "olympic"]), "east_wa");
  assert.equal(parseBoardRegion("constructor"), null);
  assert.equal(parseBoardRegion("__proto__"), null);
  assert.equal(parseBoardRegion("toString"), null);
  assert.equal(parseBoardRegion("mars"), null);
  assert.equal(parseBoardRegion(""), null);
  assert.equal(parseBoardRegion(undefined), null);
});

// ── buildBoardRows ────────────────────────────────────────────────────

function ac(
  tail: string,
  role: FleetRole,
  nickname: string | null,
  base: string,
  live: Partial<Aircraft> = {},
): Aircraft {
  return {
    tail,
    operator: "x",
    model: "x",
    nickname,
    roleDescription: "",
    base,
    role,
    roleConfidence: "confirmed",
    sources: [],
    icao24: "a00000",
    airborne: false,
    ...live,
  };
}

const SEATTLE = { lat: 47.6, lon: -122.3 };
const SPOKANE = { lat: 47.66, lon: -117.4 };

function snapshot(aircraft: Aircraft[]): Snapshot {
  return { fetched_at: NOW, source: "adsbfi", live_seen_count: 5, aircraft };
}

function ev(tail: string, kind: ActivityEntry["kind"], ts: number, pos = SEATTLE): ActivityEntry {
  return { ts, tail, kind, description: "", ...pos };
}

test("buildBoardRows: UP first (alert before SAR), then latest event per tail", () => {
  const snap = snapshot([
    ac("N815SC", "sar", "SnoHawk 10", "Taylor's Landing", { airborne: true, time_aloft_min: 90, ...SEATTLE }),
    ac("N305DK", "police", "Smokey 4", "KOLM Olympia", { airborne: true, time_aloft_min: 47, ...SEATTLE }),
    ac("N422CT", "police", "Guardian One", "KRNT Renton"),
  ]);
  const activity = [
    ev("N422CT", "takeoff", NOW - 3 * 3600_000),
    ev("N422CT", "landing", NOW - 3600_000), // latest for N422CT
    ev("N305DK", "takeoff", NOW - 47 * 60_000), // covered by the UP row
  ];
  const rows = buildBoardRows({ snapshot: snap, activity, regionId: null, now: NOW });
  assert.deepEqual(rows.map(boardRowText), [
    "KOLM  SMOKEY 4        UP 47M",
    "----  SNOHAWK 10      UP 1H 30M",
    "KRNT  GUARDIAN ONE    LANDED 08:00",
  ]);
});

test("buildBoardRows: events older than the window drop off", () => {
  const snap = snapshot([ac("N422CT", "police", "Guardian One", "KRNT Renton")]);
  const rows = buildBoardRows({
    snapshot: snap,
    activity: [ev("N422CT", "landing", NOW - BOARD_EVENT_WINDOW_MS - 1)],
    regionId: null,
    now: NOW,
  });
  assert.equal(rows.length, 0);
});

test("buildBoardRows: region filter uses position, and drops unpositioned rows", () => {
  const snap = snapshot([
    ac("N305DK", "police", "Smokey 4", "KOLM Olympia", { airborne: true, time_aloft_min: 10, ...SEATTLE }),
    ac("N509DV", "police", "Air 1", "KSFF Felts Field, Spokane", { airborne: true, time_aloft_min: 10, ...SPOKANE }),
    ac("N1977G", "police", "TROY 188", "KBLI Bellingham AMB", { airborne: true, time_aloft_min: 10 }),
  ]);
  const puget = buildBoardRows({ snapshot: snap, activity: [], regionId: "puget_sound", now: NOW });
  assert.deepEqual(puget.map((r) => r.key), ["N305DK"]);
  const all = buildBoardRows({ snapshot: snap, activity: [], regionId: "all_wa", now: NOW });
  assert.equal(all.length, 3);
});

test("filterSnapshotToRegion: out-of-region birds read as down", () => {
  const snap = snapshot([
    ac("N509DV", "police", "Air 1", "KSFF", { airborne: true, ...SPOKANE }),
  ]);
  const f = filterSnapshotToRegion(snap, "puget_sound");
  assert.equal(f.aircraft[0]!.airborne, false);
  assert.equal(filterSnapshotToRegion(snap, null), snap);
});

test("buildBoardRows: caps at maxRows", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    ac(`N${i}`, "police", null, "KOLM", { airborne: true, time_aloft_min: i, ...SEATTLE }),
  );
  const rows = buildBoardRows({ snapshot: snapshot(many), activity: [], regionId: null, now: NOW, maxRows: 8 });
  assert.equal(rows.length, 8);
});

// ─── tile geometry ──────────────────────────────────────────────────────

function assertWholePixels(l: ReturnType<typeof boardLayout>) {
  for (const k of ["tileW", "tileH", "gap", "rowGap", "lineGap", "fontSize", "splitY", "radius", "rows"] as const) {
    assert.ok(Number.isInteger(l[k]), `${k} = ${l[k]} is not a whole pixel`);
  }
  assert.equal(l.tileH % 2, 0, "tile height is even so the split sits on a whole pixel");
  assert.equal(l.splitY, l.tileH / 2 - 1);
}

test("boardLayout: whole-pixel tiles at 1080p, 720p and odd sizes", () => {
  for (const [w, h] of [
    [1804, 640],
    [1203, 420],
    [1366.4, 512.7],
    [2560, 1100],
    [3840, 1500],
    [1023, 777],
  ] as const) {
    const l = boardLayout(w, h);
    assertWholePixels(l);
    assert.equal(l.compact, false, `${w}x${h} is a wide board`);
    assert.equal(l.rows, 8);
    // Everything fits the measured box.
    assert.ok(BOARD_WIDE_CELLS * (l.tileW + l.gap) <= Math.floor(w), `width fits at ${w}`);
    assert.ok(8 * l.tileH + 7 * l.rowGap <= Math.floor(h), `height fits at ${h}`);
  }
});

test("boardLayout: 1080p tiles stay TV-sized", () => {
  const l = boardLayout(1804, 640);
  assert.ok(l.tileH >= 56 && l.tileH <= 72, `tileH ${l.tileH}`);
  assert.ok(l.tileW >= 36 && l.tileW <= 48, `tileW ${l.tileW}`);
});

test("boardLayout: phones stack each departure and grow the tiles", () => {
  const phone = boardLayout(358, 560);
  assertWholePixels(phone);
  assert.equal(phone.compact, true);
  assert.ok(BOARD_COMPACT_CELLS * (phone.tileW + phone.gap) <= 358);
  // Far bigger than the 9 x 15 px wide-row tile a phone used to get.
  assert.ok(phone.tileW >= 14, `tileW ${phone.tileW}`);
  assert.ok(phone.rows >= 3 && phone.rows <= 8, `rows ${phone.rows}`);
  const used = phone.rows * (2 * phone.tileH + phone.lineGap) + (phone.rows - 1) * phone.rowGap;
  assert.ok(used <= 560, "rows fit the height");
  // A shorter screen shows fewer departures, not smaller tiles.
  const short = boardLayout(358, 300);
  assert.equal(short.tileW, phone.tileW);
  assert.ok(short.rows < phone.rows);
});

test("boardLayout: degenerate boxes still return sane whole pixels", () => {
  for (const [w, h] of [
    [0, 0],
    [NaN, 100],
    [200, 20],
  ] as const) {
    const l = boardLayout(w, h);
    assertWholePixels(l);
    assert.ok(l.rows >= 1 && l.tileH >= 4);
  }
});
