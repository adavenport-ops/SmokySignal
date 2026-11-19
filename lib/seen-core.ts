// Pure half of GET /api/seen ("Was that the plane I saw?"). No Redis, no
// clock reads: the route and lib/seen.ts do IO and hand inputs in, so
// lib/seen-core.test.ts can pin validation, the UTC-day split, the
// closest-approach math and the result fold.
//
// Server-only in practice: it imports lib/flights.ts (for the flight-page
// session cut), which pulls the KV client. Client code uses
// lib/seen-view.ts.

import { airportById, inferDeparture } from "./airports";
import { cleanPoints, parseBase, plainAirframe, splitSessions } from "./circling";
import { corridorLabel, nearestCorridor } from "./corridor";
import { flightIdFromTs, sessionsFromDay } from "./flights";
import { bearingDeg, haversineNm } from "./geo";
import { douglasPeucker } from "./history-core";
import { countsAsSmokey, normalizeMission } from "./mission";
import { classifyFlightPhase, detectOrbits } from "./orbit";
import { areaName, nearestPlaceName } from "./places";
import { utcDateKeysForRange } from "./pt-range";
import { inTrackingEnvelope } from "./regions";
import { missionLabel, roleBadgeText } from "./role-display";
import type { TrackPoint } from "./tracks";
import type { FleetEntry } from "./types";
import {
  DEFAULT_WINDOW_MIN,
  MAX_RADIUS_NM,
  MIN_RADIUS_NM,
  SEEN_EARLIEST_DATE,
  SEEN_VERSION,
  ALL_WINDOW_CHOICES,
  compassWord,
  isoMinute,
  miToNm,
  nmToMi,
  roundCoord,
  DEFAULT_RADIUS_MI,
  type SeenBody,
  type SeenItem,
  type SeenStatus,
  type SeenVertex,
} from "./seen-view";

/** A sample gap longer than this is not interpolated across, seconds. */
export const INTERP_MAX_GAP_S = 120;
/** Pattern check looks this far either side of the closest approach, seconds. */
export const PATTERN_PAD_S = 10 * 60;
/** Read this much track either side of the window (pattern context), seconds. */
export const READ_PAD_S = 20 * 60;
/** Same split the flight page and /circling use, seconds. */
export const SESSION_GAP_S = 5 * 60;
/** A window ending within this of now still counts as "now" (ingest lag), ms. */
export const INGEST_LAG_MS = 2 * 60_000;
/** Track vertices per result card. */
export const MAX_TRACK_VERTICES = 240;
/** t may not be later than this past now; further out is a malformed link. */
const MAX_FUTURE_MS = 2 * 86_400_000;
const MIN_T_MS = Date.UTC(2020, 0, 1);

const ALLOWED_PARAMS = new Set(["lat", "lon", "t", "window_min", "radius_nm"]);
const COORD_RE = /^-?\d{1,3}(?:\.\d{1,6})?$/;
const RADIUS_RE = /^\d{1,2}(?:\.\d{1,3})?$/;
const WINDOW_RE = /^\d{1,3}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

// ─── query validation ────────────────────────────────────────────────

export type SeenQuery = {
  /** Rounded to 2 decimals. */
  lat: number;
  lon: number;
  /** Rounded down to the minute, ms. */
  tMs: number;
  windowMin: number;
  /** Rounded to 2 decimals. */
  radiusNm: number;
  fromMs: number;
  toMs: number;
  status: SeenStatus;
  includesNow: boolean;
};

export type SeenQueryResult =
  | { ok: true; query: SeenQuery; canonical: boolean }
  | { ok: false; error: string; detail?: string };

/** ms of 00:00 Pacific on a YYYY-MM-DD date (only used for the floor). */
function ptMidnightMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // 00:00 PT is 07:00 or 08:00 UTC; the floor is in October (PDT, -7).
  for (const h of [7, 8]) {
    const t = Date.UTC(y, m - 1, d, h);
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(t));
    if (Number(s) % 24 === 0) return t;
  }
  return Date.UTC(y, m - 1, d, 8);
}

export const SEEN_EARLIEST_MS = ptMidnightMs(SEEN_EARLIEST_DATE);

/** Strict parse of /api/seen search params against "now". */
export function parseSeenQuery(params: URLSearchParams, nowMs: number): SeenQueryResult {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return { ok: false, error: "unknown_param", detail: key.slice(0, 24) };
  }
  for (const key of ALLOWED_PARAMS) {
    if (params.getAll(key).length > 1) return { ok: false, error: "duplicate_param", detail: key };
  }

  const latRaw = params.get("lat");
  const lonRaw = params.get("lon");
  if (latRaw == null || lonRaw == null) return { ok: false, error: "missing_point", detail: "lat and lon are required" };
  if (!COORD_RE.test(latRaw)) return { ok: false, error: "bad_lat" };
  if (!COORD_RE.test(lonRaw)) return { ok: false, error: "bad_lon" };
  const latIn = Number(latRaw);
  const lonIn = Number(lonRaw);
  if (!Number.isFinite(latIn) || latIn < -90 || latIn > 90) return { ok: false, error: "bad_lat" };
  if (!Number.isFinite(lonIn) || lonIn < -180 || lonIn > 180) return { ok: false, error: "bad_lon" };
  if (!inTrackingEnvelope(latIn, lonIn)) return { ok: false, error: "outside_area" };

  const tRaw = params.get("t");
  if (tRaw == null) return { ok: false, error: "missing_t", detail: "t is required (ISO 8601 with a zone)" };
  if (!ISO_RE.test(tRaw)) return { ok: false, error: "bad_t" };
  const tParsed = Date.parse(tRaw);
  if (!Number.isFinite(tParsed)) return { ok: false, error: "bad_t" };
  if (tParsed < MIN_T_MS || tParsed > nowMs + MAX_FUTURE_MS) return { ok: false, error: "t_out_of_range" };

  let windowMin: number = DEFAULT_WINDOW_MIN;
  const wRaw = params.get("window_min");
  if (wRaw != null) {
    if (!WINDOW_RE.test(wRaw)) return { ok: false, error: "bad_window", detail: ALL_WINDOW_CHOICES.join(",") };
    const w = Number(wRaw);
    if (!(ALL_WINDOW_CHOICES as readonly number[]).includes(w)) {
      return { ok: false, error: "bad_window", detail: ALL_WINDOW_CHOICES.join(",") };
    }
    windowMin = w;
  }

  let radiusNm = miToNm(DEFAULT_RADIUS_MI);
  const rRaw = params.get("radius_nm");
  if (rRaw != null) {
    if (!RADIUS_RE.test(rRaw)) return { ok: false, error: "bad_radius" };
    const r = Number(rRaw);
    if (!Number.isFinite(r) || r < MIN_RADIUS_NM || r > MAX_RADIUS_NM) {
      return { ok: false, error: "bad_radius", detail: `${MIN_RADIUS_NM}..${MAX_RADIUS_NM} nm` };
    }
    radiusNm = Math.round(r * 100) / 100;
  }

  const lat = roundCoord(latIn);
  const lon = roundCoord(lonIn);
  const tMs = Math.floor(tParsed / 60_000) * 60_000;
  const { fromMs, toMs } = seenWindow(tMs, windowMin);
  const status: SeenStatus =
    toMs < SEEN_EARLIEST_MS ? "before_data" : fromMs > nowMs ? "future" : "ok";
  const query: SeenQuery = {
    lat,
    lon,
    tMs,
    windowMin,
    radiusNm,
    fromMs,
    toMs,
    status,
    includesNow: toMs >= nowMs - INGEST_LAG_MS,
  };
  const canonical =
    latRaw === lat.toFixed(2) &&
    lonRaw === lon.toFixed(2) &&
    tRaw === isoMinute(tMs) &&
    wRaw === String(windowMin) &&
    rRaw === radiusNm.toFixed(2);
  return { ok: true, query, canonical };
}

/** Rounded inputs as the one URL the CDN caches. */
export function canonicalSeenSearch(q: SeenQuery): string {
  return new URLSearchParams({
    lat: q.lat.toFixed(2),
    lon: q.lon.toFixed(2),
    t: isoMinute(q.tMs),
    window_min: String(q.windowMin),
    radius_nm: q.radiusNm.toFixed(2),
  }).toString();
}

/**
 * Past windows can only change if the past is rebuilt: cache 5 minutes.
 * A window that reaches now is private and never stored.
 */
export function seenCacheControl(includesNow: boolean): string {
  return includesNow ? "private, no-store" : "public, s-maxage=300, stale-while-revalidate=600";
}

// ─── window and UTC days ─────────────────────────────────────────────

export function seenWindow(tMs: number, windowMin: number): { fromMs: number; toMs: number } {
  return { fromMs: tMs - windowMin * 60_000, toMs: tMs + windowMin * 60_000 };
}

/**
 * UTC YYYYMMDD keys the window (plus pattern padding) touches. A window
 * across 00:00 UTC (16:00 or 17:00 PT) reads both days.
 */
export function utcDaysForWindow(fromMs: number, toMs: number, padS = READ_PAD_S): string[] {
  return utcDateKeysForRange(fromMs - padS * 1000, toMs + padS * 1000 + 1);
}

/** The UTC day before a YYYYMMDD key. */
export function previousUtcDay(key: string): string {
  const t = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8))) - 86_400_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function utcDayOfSec(tsS: number): string {
  const d = new Date(tsS * 1000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ─── closest approach ────────────────────────────────────────────────

export type Approach = {
  /** Unix seconds (interpolated between samples when closer there). */
  ts: number;
  lat: number;
  lon: number;
  alt: number | null;
  distanceNm: number;
  /** Index of the nearest real sample, for session lookup. */
  sampleIdx: number;
};

/**
 * Closest point of a sorted track to `user` within [fromS, toS]. Checks
 * every sample in the window and every segment between consecutive
 * samples no more than `maxGapS` apart, clipped to the window, using a
 * local planar projection for the foot of the perpendicular and haversine
 * for the distance. Null when no part of the track is in the window.
 */
export function closestApproach(
  points: ReadonlyArray<TrackPoint>,
  user: { lat: number; lon: number },
  fromS: number,
  toS: number,
  maxGapS = INTERP_MAX_GAP_S,
): Approach | null {
  let best: Approach | null = null;
  const consider = (a: Approach) => {
    if (!best || a.distanceNm < best.distanceNm - 1e-9) best = a;
  };
  const kx = Math.cos((user.lat * Math.PI) / 180);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.ts >= fromS && p.ts <= toS) {
      consider({
        ts: p.ts,
        lat: p.lat,
        lon: p.lon,
        alt: finiteOrNull(p.alt),
        distanceNm: haversineNm(user.lat, user.lon, p.lat, p.lon),
        sampleIdx: i,
      });
    }
    const q = points[i + 1];
    if (!q) continue;
    const gap = q.ts - p.ts;
    if (gap <= 0 || gap > maxGapS) continue;
    if (q.ts < fromS || p.ts > toS) continue;
    // Segment parameter range that lies inside the window.
    const t0 = Math.max(0, (fromS - p.ts) / gap);
    const t1 = Math.min(1, (toS - p.ts) / gap);
    if (t1 < t0) continue;
    const ax = (p.lon - user.lon) * kx;
    const ay = p.lat - user.lat;
    const dx = (q.lon - p.lon) * kx;
    const dy = q.lat - p.lat;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? t0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(t0, Math.min(t1, t));
    if (t <= 0 || t >= 1) continue; // endpoints are covered by the sample pass
    const lat = p.lat + t * (q.lat - p.lat);
    const lon = p.lon + t * (q.lon - p.lon);
    const pa = finiteOrNull(p.alt);
    const qa = finiteOrNull(q.alt);
    const alt = pa != null && qa != null ? pa + t * (qa - pa) : (t < 0.5 ? pa ?? qa : qa ?? pa);
    consider({
      ts: Math.round(p.ts + t * gap),
      lat,
      lon,
      alt: alt == null ? null : Math.round(alt),
      distanceNm: haversineNm(user.lat, user.lon, lat, lon),
      sampleIdx: t < 0.5 ? i : i + 1,
    });
  }
  return best;
}

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ─── one aircraft ────────────────────────────────────────────────────

/** One (UTC day, raw LRANGE list) pair for a tail, in read order. */
export type DayTrack = { date: string; points: TrackPoint[] };

type EntryLike = Pick<FleetEntry, "tail" | "nickname" | "model" | "operator" | "role" | "base"> &
  Partial<Pick<FleetEntry, "scope">>;

export type SeenBuild = {
  item: SeenItem;
  /** First sample of the session the closest approach is in, unix s. */
  sessionStartS: number;
};

/**
 * Fold one tail's raw track days into a result card, or null when no
 * part of its track inside the window came within the radius.
 */
export function buildSeenItem(
  entry: EntryLike,
  days: ReadonlyArray<DayTrack>,
  q: Pick<SeenQuery, "lat" | "lon" | "fromMs" | "toMs" | "radiusNm">,
): SeenBuild | null {
  const all = cleanPoints(days.flatMap((d) => d.points));
  if (all.length === 0) return null;
  const fromS = Math.floor(q.fromMs / 1000);
  const toS = Math.floor(q.toMs / 1000);
  const user = { lat: q.lat, lon: q.lon };
  const cp = closestApproach(all, user, fromS, toS);
  if (!cp || cp.distanceNm > q.radiusNm) return null;

  // The session (5 min gap split) the closest approach sits in.
  const anchor = all[cp.sampleIdx]!;
  const session =
    splitSessions(all, SESSION_GAP_S).find(
      (s) => s[0]!.ts <= anchor.ts && anchor.ts <= s[s.length - 1]!.ts,
    ) ?? [anchor];

  // Working a pattern then: an orbit overlapping ±10 min of the closest
  // approach, or the phase classifier over that 20 min stretch.
  const lo = cp.ts - PATTERN_PAD_S;
  const hi = cp.ts + PATTERN_PAD_S;
  const around = session.filter((p) => p.ts >= lo && p.ts <= hi);
  const orbit = detectOrbits(session).find((s) => s.endTs >= lo && s.startTs <= hi);
  const working =
    Boolean(orbit) ||
    (around.length >= 3 && classifyFlightPhase(around, { lookbackS: 2 * PATTERN_PAD_S }) === "working a pattern");
  let over: string | null = null;
  if (working) {
    const c = orbit?.centroid ?? centroid(around.length > 0 ? around : [anchor]);
    const m = nearestCorridor(c.lat, c.lon, 2);
    over = m?.name ?? nearestPlaceName(c.lat, c.lon) ?? null;
  }

  const corridor = nearestCorridor(cp.lat, cp.lon, 2);
  const near = corridor?.nearestPlace ?? nearestPlaceName(cp.lat, cp.lon);

  // Departure: this flight's takeoff field (same strict read as
  // /circling), else the registry home base.
  let departure: SeenItem["departure"] = null;
  const dep = inferDeparture(session, { maxAltFt: 1500, windowS: 300 });
  if (dep) departure = { id: dep.id, name: dep.name, from_takeoff: true };
  else {
    const base = parseBase(entry.base);
    const ap = base ? airportById(base.id) : null;
    if (ap) departure = { id: ap.id, name: ap.name, from_takeoff: false };
  }

  // Flight page link: cut sessions exactly as /flight/[tail]/[flightId]
  // does (that UTC day's raw list), so the id resolves.
  let flight: SeenItem["flight"] = null;
  const day = days.find((d) => d.date === utcDayOfSec(anchor.ts));
  if (day) {
    const s = sessionsFromDay(entry as FleetEntry, day.date, day.points).find(
      (x) => x.start_ts / 1000 <= anchor.ts && anchor.ts <= x.end_ts / 1000,
    );
    if (s) {
      const id = flightIdFromTs(s.start_ts);
      flight = { id, href: `/flight/${entry.tail}/${id}` };
    }
  }

  const inWindow = all.filter((p) => p.ts >= fromS && p.ts <= toS);
  const track: SeenVertex[] = douglasPeucker(inWindow, 0.0002)
    .slice(0, MAX_TRACK_VERTICES)
    .map((p) => [round(p.lat, 5), round(p.lon, 5), finiteOrNull(p.alt), p.ts]);

  const mission = normalizeMission(entry.role);
  const bearing = bearingDeg(user.lat, user.lon, cp.lat, cp.lon);
  const item: SeenItem = {
    tail: entry.tail,
    name: entry.nickname?.trim() || entry.tail,
    nickname: entry.nickname ?? null,
    operator: entry.operator,
    airframe: plainAirframe(entry.model),
    mission,
    mission_label: missionLabel(mission),
    mission_badge: roleBadgeText(mission),
    smokey: countsAsSmokey({ role: mission, scope: entry.scope ?? null, lat: cp.lat, lon: cp.lon }),
    closest: {
      ts: cp.ts * 1000,
      lat: round(cp.lat, 5),
      lon: round(cp.lon, 5),
      alt_ft: cp.alt,
      distance_nm: round(cp.distanceNm, 2),
      distance_mi: round(nmToMi(cp.distanceNm), 2),
      bearing_deg: Math.round(bearing),
      direction: compassWord(bearing),
    },
    pattern: { working, over },
    corridor: corridor
      ? { id: corridor.id, name: corridor.name, label: corridorLabel(cp.lat, cp.lon, 2) ?? corridor.name }
      : null,
    near: near ?? null,
    departure,
    flight,
    track,
  };
  return { item, sessionStartS: session[0]!.ts };
}

function centroid(points: ReadonlyArray<{ lat: number; lon: number }>): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const p of points) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}

/** Closest first; ties by time, then tail. */
export function sortSeen(items: ReadonlyArray<SeenItem>): SeenItem[] {
  return [...items].sort(
    (a, b) =>
      a.closest.distance_nm - b.closest.distance_nm ||
      a.closest.ts - b.closest.ts ||
      a.tail.localeCompare(b.tail),
  );
}

/** Response body around a list of items. */
export function seenBody(q: SeenQuery, items: ReadonlyArray<SeenItem>): SeenBody {
  return {
    v: SEEN_VERSION,
    query: {
      lat: q.lat,
      lon: q.lon,
      t: isoMinute(q.tMs),
      window_min: q.windowMin,
      radius_nm: q.radiusNm,
      radius_mi: round(nmToMi(q.radiusNm), 2),
      from_ts: q.fromMs,
      to_ts: q.toMs,
    },
    data: { status: q.status, earliest: SEEN_EARLIEST_DATE, includes_now: q.includesNow },
    area: areaName(q.lat, q.lon),
    aircraft: sortSeen(items),
  };
}
