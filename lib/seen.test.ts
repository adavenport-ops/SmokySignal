// Run: npx tsx --test lib/seen.test.ts
//
// /seen and /api/seen: query validation, coordinate rounding, the UTC-day
// split across midnight, closest-approach math and the result formatter.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERP_MAX_GAP_S,
  SEEN_EARLIEST_MS,
  buildSeenItem,
  canonicalSeenSearch,
  closestApproach,
  parseSeenQuery,
  previousUtcDay,
  seenBody,
  seenCacheControl,
  seenWindow,
  sortSeen,
  utcDaysForWindow,
  type SeenQuery,
} from "./seen-core";
import {
  SEEN_EARLIEST_DATE,
  emptyMessage,
  isKnownAreaName,
  isoMinute,
  miToNm,
  ogTitle,
  outsideMessage,
  parseSeenPageParams,
  ptLocal,
  ptLocalToMs,
  radiusMiLabel,
  resultsHeading,
  roundCoord,
  searchPlaces,
  seenApiHref,
  seenHeadline,
  seenLine,
  seenPageHref,
  seenSentence,
  type SeenItem,
} from "./seen-view";
import { haversineNm } from "./geo";
import { circle, offsetNm, straight } from "./geo-fixtures.test-helpers";
import type { TrackPoint } from "./tracks";
import type { FleetEntry } from "./types";

const NOW = Date.UTC(2026, 10, 18, 20, 0); // 2026-11-18 12:00 PT
const PUYALLUP = { lat: 47.19, lon: -122.29 };

function q(params: Record<string, string>, now = NOW) {
  return parseSeenQuery(new URLSearchParams(params), now);
}

const BASE = {
  lat: "47.19",
  lon: "-122.29",
  t: "2026-11-17T22:30:00Z",
  window_min: "30",
  radius_nm: "4.34",
};

// ─── input validation ────────────────────────────────────────────────

test("parseSeenQuery: canonical input parses and is marked canonical", () => {
  const r = q(BASE);
  assert.ok(r.ok);
  assert.equal(r.canonical, true);
  assert.equal(r.query.lat, 47.19);
  assert.equal(r.query.lon, -122.29);
  assert.equal(r.query.windowMin, 30);
  assert.equal(r.query.radiusNm, 4.34);
  assert.equal(r.query.tMs, Date.UTC(2026, 10, 17, 22, 30));
  assert.equal(r.query.fromMs, Date.UTC(2026, 10, 17, 22, 0));
  assert.equal(r.query.toMs, Date.UTC(2026, 10, 17, 23, 0));
  assert.equal(r.query.status, "ok");
  assert.equal(r.query.includesNow, false);
});

test("parseSeenQuery: rejects unknown, duplicate and missing params", () => {
  assert.deepEqual(q({ ...BASE, foo: "1" }), { ok: false, error: "unknown_param", detail: "foo" });
  const dup = new URLSearchParams(BASE);
  dup.append("lat", "47.2");
  assert.equal((parseSeenQuery(dup, NOW) as { error: string }).error, "duplicate_param");
  const { lat: _lat, ...noLat } = BASE;
  assert.equal((q(noLat) as { error: string }).error, "missing_point");
  const { t: _t, ...noT } = BASE;
  assert.equal((q(noT) as { error: string }).error, "missing_t");
});

test("parseSeenQuery: strict numeric and time shapes", () => {
  for (const lat of ["47,19", "1e1", "47.1234567", " 47.19", "NaN", "Infinity", "0x2F", ""]) {
    assert.equal((q({ ...BASE, lat }) as { error: string }).error, "bad_lat", lat);
  }
  assert.equal((q({ ...BASE, lat: "95" }) as { error: string }).error, "bad_lat");
  assert.equal((q({ ...BASE, lon: "-190" }) as { error: string }).error, "bad_lon");
  // Outside the tracking envelope (New York).
  assert.equal((q({ ...BASE, lat: "40.71", lon: "-74.01" }) as { error: string }).error, "outside_area");
  for (const t of ["2026-11-17", "2026-11-17 22:30Z", "2026-11-17T22:30", "yesterday", "1763418600"]) {
    assert.equal((q({ ...BASE, t }) as { error: string }).error, "bad_t", t);
  }
  assert.equal((q({ ...BASE, t: "2019-06-01T12:00:00Z" }) as { error: string }).error, "t_out_of_range");
  assert.equal((q({ ...BASE, t: "2026-11-25T12:00:00Z" }) as { error: string }).error, "t_out_of_range");
  for (const w of ["20", "0", "-30", "30.0", "abc"]) {
    assert.equal((q({ ...BASE, window_min: w }) as { error: string }).error, "bad_window", w);
  }
  for (const r of ["0.4", "10.5", "-1", "5mi", "1e1"]) {
    assert.equal((q({ ...BASE, radius_nm: r }) as { error: string }).error, "bad_radius", r);
  }
});

test("parseSeenQuery: offsets and seconds are accepted but not canonical", () => {
  const r = q({ ...BASE, t: "2026-11-17T14:30:42-08:00" });
  assert.ok(r.ok);
  assert.equal(r.canonical, false);
  assert.equal(isoMinute(r.query.tMs), "2026-11-17T22:30:00Z");
  assert.equal(
    canonicalSeenSearch(r.query),
    "lat=47.19&lon=-122.29&t=2026-11-17T22%3A30%3A00Z&window_min=30&radius_nm=4.34",
  );
});

test("parseSeenQuery: defaults fill in, but the URL is not canonical", () => {
  const r = q({ lat: "47.19", lon: "-122.29", t: "2026-11-17T22:30:00Z" });
  assert.ok(r.ok);
  assert.equal(r.canonical, false);
  assert.equal(r.query.windowMin, 30);
  assert.equal(r.query.radiusNm, miToNm(5));
});

test("parseSeenQuery: status before the track history and in the future", () => {
  const early = q({ ...BASE, t: "2026-10-01T18:00:00Z" });
  assert.ok(early.ok);
  assert.equal(early.query.status, "before_data");
  // A window that ends on the floor day still reads.
  const floor = q({ ...BASE, t: new Date(SEEN_EARLIEST_MS + 10 * 60_000).toISOString().replace(/\.000Z$/, "Z") });
  assert.ok(floor.ok);
  assert.equal(floor.query.status, "ok");
  const future = q({ ...BASE, t: "2026-11-18T21:00:00Z" });
  assert.ok(future.ok);
  assert.equal(future.query.status, "future");
  assert.equal(future.query.includesNow, true);
});

test("seenCacheControl: no-store when the window reaches now", () => {
  const live = q({ ...BASE, t: "2026-11-18T19:50:00Z" });
  assert.ok(live.ok);
  assert.equal(live.query.includesNow, true);
  assert.equal(seenCacheControl(true), "private, no-store");
  assert.match(seenCacheControl(false), /^public, s-maxage=300/);
});

// ─── coordinate rounding ─────────────────────────────────────────────

test("roundCoord: two decimals, no negative zero", () => {
  assert.equal(roundCoord(47.18764), 47.19);
  assert.equal(roundCoord(-122.29499), -122.29);
  assert.equal(roundCoord(-122.295), -122.29); // half rounds toward +inf
  assert.equal(Object.is(roundCoord(-0.001), -0), false);
});

test("parseSeenQuery: more decimals round to 2 and redirect", () => {
  const r = q({ ...BASE, lat: "47.187641", lon: "-122.294213" });
  assert.ok(r.ok);
  assert.equal(r.canonical, false);
  assert.equal(r.query.lat, 47.19);
  assert.equal(r.query.lon, -122.29);
});

test("seenPageHref / seenApiHref: coordinates leave rounded", () => {
  const state = {
    lat: 47.187641,
    lon: -122.294213,
    place: null,
    date: "2026-11-17",
    time: "14:30",
    w: 30 as const,
    r: 5 as const,
  };
  const page = seenPageHref(state);
  assert.match(page, /lat=47\.19&lon=-122\.29/);
  assert.ok(!page.includes("47.1876"));
  const api = seenApiHref(state)!;
  assert.equal(
    api,
    "/api/seen?lat=47.19&lon=-122.29&t=2026-11-17T22%3A30%3A00Z&window_min=30&radius_nm=4.34",
  );
  // The API treats the page's request as canonical: no redirect hop.
  const parsed = parseSeenQuery(new URL(api, "https://x").searchParams, NOW);
  assert.ok(parsed.ok && parsed.canonical);
});

test("parseSeenPageParams: place fills the point; junk falls back to defaults", () => {
  const s = parseSeenPageParams({ place: "puyallup", date: "2026-11-17", time: "14:30", w: "60", r: "10" }, NOW);
  assert.equal(s.place, "Puyallup");
  assert.equal(s.lat, 47.2);
  assert.equal(s.lon, -122.28);
  assert.equal(s.w, 60);
  assert.equal(s.r, 10);
  const junk = parseSeenPageParams({ lat: "abc", lon: "-122.3", date: "2026-02-30", time: "25:00", w: "7", r: "4" }, NOW);
  assert.equal(junk.lat, null);
  assert.equal(junk.lon, null);
  assert.equal(junk.date, "2026-11-18");
  assert.equal(junk.time, "12:00");
  assert.equal(junk.w, 30);
  assert.equal(junk.r, 5);
});

test("searchPlaces: prefix matches first", () => {
  const names = searchPlaces("fi").map((p) => p.name);
  assert.equal(names[0], "Fife");
  assert.ok(searchPlaces("lynn").some((p) => p.name === "Lynnwood"));
  assert.equal(searchPlaces("zzzz").length, 0);
  assert.equal(searchPlaces("")[0]!.name, "Puyallup");
});

// ─── PT time and the UTC day split ───────────────────────────────────

test("ptLocalToMs: PST, PDT and the DST edges", () => {
  assert.equal(ptLocalToMs("2026-11-17", "14:30"), Date.UTC(2026, 10, 17, 22, 30)); // PST -8
  assert.equal(ptLocalToMs("2026-07-04", "14:30"), Date.UTC(2026, 6, 4, 21, 30)); // PDT -7
  // 2026-03-08 02:30 does not exist; resolves as standard time.
  assert.equal(ptLocalToMs("2026-03-08", "02:30"), Date.UTC(2026, 2, 8, 10, 30));
  assert.equal(ptLocalToMs("2026-11-17", "24:00"), null);
  assert.deepEqual(ptLocal(Date.UTC(2026, 10, 18, 0, 5)), { date: "2026-11-17", time: "16:05" });
});

test("utcDaysForWindow: a window inside one UTC day reads one key", () => {
  const { fromMs, toMs } = seenWindow(Date.UTC(2026, 10, 17, 19, 0), 30);
  assert.deepEqual(utcDaysForWindow(fromMs, toMs), ["20261117"]);
});

test("utcDaysForWindow: 16:00 PT (00:00 UTC) splits across two UTC days", () => {
  const t = ptLocalToMs("2026-11-17", "16:00")!;
  assert.equal(t, Date.UTC(2026, 10, 18, 0, 0));
  for (const w of [15, 30, 60]) {
    const { fromMs, toMs } = seenWindow(t, w);
    assert.deepEqual(utcDaysForWindow(fromMs, toMs), ["20261117", "20261118"], `±${w}`);
  }
  // Padding alone pulls in the next day for a window ending 23:50 UTC.
  const late = seenWindow(Date.UTC(2026, 10, 17, 23, 20), 30);
  assert.deepEqual(utcDaysForWindow(late.fromMs, late.toMs), ["20261117", "20261118"]);
  assert.deepEqual(utcDaysForWindow(late.fromMs, late.toMs, 0), ["20261117"]);
});

test("previousUtcDay: month and year rollover", () => {
  assert.equal(previousUtcDay("20261101"), "20261031");
  assert.equal(previousUtcDay("20270101"), "20261231");
});

// ─── closest approach ────────────────────────────────────────────────

function pt(lat: number, lon: number, ts: number, alt: number | null = 2000): TrackPoint {
  return { lat, lon, alt, spd: 110, trk: null, ts };
}

test("closestApproach: interpolates between samples on a straight pass", () => {
  // East-bound pass 1 nm north of the user; samples 2 nm either side.
  const user = { lat: 47.2, lon: -122.3 };
  const a = offsetNm(user.lat, user.lon, -2, 1);
  const b = offsetNm(user.lat, user.lon, 2, 1);
  const pts = [pt(a.lat, a.lon, 1000, 1000), pt(b.lat, b.lon, 1100, 3000)];
  const cp = closestApproach(pts, user, 0, 5000)!;
  assert.ok(Math.abs(cp.distanceNm - 1) < 0.02, `distance ${cp.distanceNm}`);
  assert.equal(cp.ts, 1050);
  assert.equal(cp.alt, 2000);
  // The samples themselves are ~2.24 nm out.
  assert.ok(haversineNm(user.lat, user.lon, a.lat, a.lon) > 2.2);
});

test("closestApproach: no interpolation across a long gap", () => {
  const user = { lat: 47.2, lon: -122.3 };
  const a = offsetNm(user.lat, user.lon, -2, 1);
  const b = offsetNm(user.lat, user.lon, 2, 1);
  const pts = [pt(a.lat, a.lon, 1000), pt(b.lat, b.lon, 1000 + INTERP_MAX_GAP_S + 1)];
  const cp = closestApproach(pts, user, 0, 5000)!;
  assert.ok(cp.distanceNm > 2.2);
  assert.ok(cp.ts === 1000 || cp.ts === 1000 + INTERP_MAX_GAP_S + 1);
});

test("closestApproach: clipped to the window", () => {
  const user = { lat: 47.2, lon: -122.3 };
  const a = offsetNm(user.lat, user.lon, -2, 1);
  const b = offsetNm(user.lat, user.lon, 2, 1);
  const pts = [pt(a.lat, a.lon, 1000), pt(b.lat, b.lon, 1100)];
  // Window ends at 1025: the closest the track gets by then is a quarter of the way.
  const cp = closestApproach(pts, user, 0, 1025)!;
  assert.equal(cp.ts, 1025);
  const quarter = offsetNm(user.lat, user.lon, -1, 1);
  assert.ok(Math.abs(cp.distanceNm - haversineNm(user.lat, user.lon, quarter.lat, quarter.lon)) < 0.02);
  // Entirely outside the window.
  assert.equal(closestApproach(pts, user, 2000, 3000), null);
});

test("closestApproach: picks the nearest sample over a circle", () => {
  const user = { lat: 47.2, lon: -122.3 };
  const center = offsetNm(user.lat, user.lon, 3, 0);
  const pts = circle(center.lat, center.lon, 600, { radiusNm: 1, startTs: 0, stepS: 10 });
  const cp = closestApproach(pts, user, 0, 600)!;
  assert.ok(Math.abs(cp.distanceNm - 2) < 0.05, `distance ${cp.distanceNm}`);
});

// ─── one aircraft ────────────────────────────────────────────────────

const SMOKEY: FleetEntry = {
  tail: "N2446X",
  nickname: "Smokey 3",
  operator: "WSP",
  model: "Cessna 206H Stationair (FLIR)",
  roleDescription: "Speed enforcement",
  base: "KOLM Olympia",
  role: "police",
  roleConfidence: "confirmed",
  sources: [],
};

function utcKey(tsS: number): string {
  return new Date(tsS * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

function byDay(points: TrackPoint[]) {
  const m = new Map<string, TrackPoint[]>();
  for (const p of points) {
    const k = utcKey(p.ts);
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return [...m.entries()].map(([date, pts]) => ({ date, points: pts }));
}

function query(tMs: number, windowMin = 30, radiusNm = 4.34, at = PUYALLUP): SeenQuery {
  const { fromMs, toMs } = seenWindow(tMs, windowMin);
  return { lat: at.lat, lon: at.lon, tMs, windowMin, radiusNm, fromMs, toMs, status: "ok", includesNow: false };
}

test("buildSeenItem: an orbit over SR-512 across 00:00 UTC is one card with a resolvable flight link", () => {
  // Pattern centred 1.2 nm north of the user, 23:40 to 00:20 UTC.
  const c = offsetNm(PUYALLUP.lat, PUYALLUP.lon, 0, 1.2);
  const startS = Date.UTC(2026, 10, 17, 23, 40) / 1000;
  const pts = circle(c.lat, c.lon, 40 * 60, { radiusNm: 0.6, startTs: startS, stepS: 30, alt: 2500 });
  const days = byDay(pts);
  assert.equal(days.length, 2);
  const built = buildSeenItem(SMOKEY, days, query(Date.UTC(2026, 10, 18, 0, 0)))!;
  assert.ok(built);
  const it = built.item;
  assert.equal(it.name, "Smokey 3");
  assert.equal(it.airframe, "Cessna 206H Stationair with a FLIR camera");
  assert.equal(it.mission, "police");
  assert.equal(it.mission_label, "Smokey");
  assert.equal(it.smokey, true);
  assert.equal(it.pattern.working, true);
  assert.equal(it.closest.direction, "north");
  assert.ok(it.closest.distance_nm > 0.4 && it.closest.distance_nm < 0.8);
  assert.equal(it.closest.alt_ft, 2500);
  assert.equal(it.departure?.id, "KOLM");
  assert.equal(it.departure?.from_takeoff, false);
  // The link is cut from the closest sample's own UTC day.
  assert.ok(it.flight);
  const day = utcKey(it.closest.ts / 1000);
  assert.ok(it.flight!.id.startsWith(day), `${it.flight!.id} vs ${day}`);
  assert.equal(it.flight!.href, `/flight/N2446X/${it.flight!.id}`);
  assert.ok(it.track.length > 3);
  assert.ok(it.track.every((v) => v[3] >= built.item.closest.ts / 1000 - 31 * 60));
});

test("buildSeenItem: outside the radius or the window is null", () => {
  const far = offsetNm(PUYALLUP.lat, PUYALLUP.lon, 0, 8);
  const startS = Date.UTC(2026, 10, 17, 22, 0) / 1000;
  const pts = straight(far.lat, far.lon, 90, 1800, { startTs: startS });
  assert.equal(buildSeenItem(SMOKEY, byDay(pts), query(Date.UTC(2026, 10, 17, 22, 15))), null);
  const near = straight(PUYALLUP.lat, PUYALLUP.lon - 0.05, 90, 600, { startTs: startS });
  assert.ok(buildSeenItem(SMOKEY, byDay(near), query(Date.UTC(2026, 10, 17, 22, 15))));
  assert.equal(buildSeenItem(SMOKEY, byDay(near), query(Date.UTC(2026, 10, 17, 23, 30))), null);
});

test("buildSeenItem: a straight transit along SR-167 is not a pattern", () => {
  // South-bound through Puyallup on SR-167, no turning.
  const start = { lat: 47.30, lon: -122.245 };
  const startS = Date.UTC(2026, 10, 17, 22, 0) / 1000;
  const pts = straight(start.lat, start.lon, 185, 900, { startTs: startS, speedKt: 110 });
  const built = buildSeenItem(SMOKEY, byDay(pts), query(Date.UTC(2026, 10, 17, 22, 10)))!;
  assert.ok(built);
  assert.equal(built.item.pattern.working, false);
});

test("sortSeen + seenBody: closest first, area named", () => {
  const c1 = offsetNm(PUYALLUP.lat, PUYALLUP.lon, 2, 0);
  const c2 = offsetNm(PUYALLUP.lat, PUYALLUP.lon, 0, 0.5);
  const startS = Date.UTC(2026, 10, 17, 22, 0) / 1000;
  const qq = query(Date.UTC(2026, 10, 17, 22, 10));
  const a = buildSeenItem(SMOKEY, byDay(circle(c1.lat, c1.lon, 900, { startTs: startS, radiusNm: 0.3 })), qq)!;
  const b = buildSeenItem(
    { ...SMOKEY, tail: "N305DK", nickname: "Smokey 4" },
    byDay(circle(c2.lat, c2.lon, 900, { startTs: startS, radiusNm: 0.3 })),
    qq,
  )!;
  const body = seenBody(qq, [a.item, b.item]);
  assert.deepEqual(body.aircraft.map((x) => x.tail), ["N305DK", "N2446X"]);
  assert.equal(body.area, "Puyallup");
  assert.equal(body.query.t, "2026-11-17T22:10:00Z");
  assert.equal(sortSeen([a.item, b.item])[0]!.tail, "N305DK");
});

// ─── formatter ───────────────────────────────────────────────────────

function item(over: Partial<SeenItem> = {}): SeenItem {
  return {
    tail: "N2446X",
    name: "Smokey 3",
    nickname: "Smokey 3",
    operator: "WSP",
    airframe: "Cessna 206 with a FLIR camera",
    mission: "police",
    mission_label: "Smokey",
    mission_badge: "SMOKEY",
    smokey: true,
    closest: {
      ts: Date.UTC(2026, 10, 17, 22, 32),
      lat: 47.2,
      lon: -122.29,
      alt_ft: 2500,
      distance_nm: 1.04,
      distance_mi: 1.2,
      bearing_deg: 2,
      direction: "north",
    },
    pattern: { working: true, over: "SR-512" },
    corridor: { id: "sr-512", name: "SR-512", label: "SR-512 · Puyallup" },
    near: "Puyallup",
    departure: { id: "KOLM", name: "Olympia Regional", from_takeoff: true },
    flight: { id: "20261117T2201", href: "/flight/N2446X/20261117T2201" },
    track: [],
    ...over,
  };
}

test("seenLine: the example card", () => {
  const it = item();
  assert.equal(seenHeadline(it), "Smokey 3 · WSP Cessna 206 with a FLIR camera");
  assert.equal(
    seenLine(it),
    "passed 1.2 mi north of you at 14:32 · 2,500 ft · working a pattern over SR-512",
  );
  assert.equal(
    seenSentence(it),
    "Smokey 3 · WSP Cessna 206 with a FLIR camera · passed 1.2 mi north of you at 14:32 · 2,500 ft · working a pattern over SR-512. Out of Olympia Regional (KOLM).",
  );
  assert.equal(seenLine(it, { hour12: true }).includes("2:32 PM"), true);
});

test("seenLine: overhead, no altitude, transit along a road, nothing named", () => {
  assert.equal(
    seenLine(item({ closest: { ...item().closest, distance_mi: 0.1, alt_ft: null }, pattern: { working: false, over: null } })),
    "passed right over you at 14:32 · along SR-512",
  );
  assert.equal(
    seenLine(item({ pattern: { working: false, over: null }, corridor: null })),
    "passed 1.2 mi north of you at 14:32 · 2,500 ft",
  );
  assert.equal(
    seenLine(item({ pattern: { working: true, over: null } })),
    "passed 1.2 mi north of you at 14:32 · 2,500 ft · working a pattern",
  );
});

test("emptyMessage / outsideMessage / ogTitle / radiusMiLabel", () => {
  const from = Date.UTC(2026, 10, 17, 22, 0);
  const to = Date.UTC(2026, 10, 17, 23, 0);
  assert.equal(
    emptyMessage({ radius_nm: miToNm(5), from_ts: from, to_ts: to }),
    "Nothing we tracked passed within 5 mi between 14:00 and 15:00. Low-level coverage can miss aircraft.",
  );
  assert.equal(radiusMiLabel(miToNm(3)), "3");
  assert.equal(radiusMiLabel(miToNm(10)), "10");
  assert.equal(radiusMiLabel(2), "2.3");
  assert.equal(outsideMessage("before_data"), `Our track history starts ${SEEN_EARLIEST_DATE}. Pick a date on or after that.`);
  assert.match(outsideMessage("future"), /not happened yet/);
  assert.equal(ogTitle("Puyallup", "14:30"), "What flew over Puyallup at 14:30");
  assert.equal(
    resultsHeading({ radius_nm: miToNm(5), from_ts: from, to_ts: to }, "Fife"),
    "Within 5 mi of Fife, 14:00 to 15:00",
  );
  assert.equal(
    resultsHeading({ radius_nm: miToNm(5), from_ts: from, to_ts: to }, "Olympic Peninsula"),
    "Within 5 mi of your point, 14:00 to 15:00",
  );
  assert.equal(ogTitle(null, "14:30"), "What flew overhead at 14:30");
  assert.equal(isKnownAreaName("Puyallup"), true);
  assert.equal(isKnownAreaName("<script>"), false);
});

test("copy: no exclamation marks, no safety framing", () => {
  const strings = [
    seenSentence(item()),
    emptyMessage({ radius_nm: 4.34, from_ts: 0, to_ts: 3_600_000 }),
    outsideMessage("before_data"),
    outsideMessage("future"),
  ];
  for (const s of strings) {
    assert.ok(!s.includes("!"), s);
    assert.ok(!/\b(safe|all clear|clear to)\b/i.test(s), s);
  }
});
