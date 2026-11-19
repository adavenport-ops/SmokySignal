// Pure half of GET /api/history. No Redis, no clock reads: the route
// (app/api/history/route.ts) and lib/history.ts do IO and hand inputs in,
// so lib/history-core.test.ts can pin validation, simplification and
// aggregation.

import { flightIdFromTs, sessionsFromDay, type FlightSession } from "./flights";
import { normalizeTail } from "./input-validation";
import { MISSIONS, normalizeMission, normalizeMissionList } from "./mission";
import { daysInclusive, isPtDate, ptRangeMs, todayPt, utcDateKeysForRange } from "./pt-range";
import { distributeMinutes, ptParts, utcDateKey } from "./rollup-core";
import type { TrackPoint } from "./track-point";
import type { FleetEntry, FleetRole } from "./types";
import { inTrackingEnvelope } from "./regions";
import { GRID_CELL_DEG, cellOrigin } from "./zone-id";

export const HISTORY_VERSION = 1 as const;
/** Longest range one request may cover, in Pacific calendar days. */
export const MAX_RANGE_DAYS = 366;
/** Most tails one request may name. */
export const MAX_TAILS = 32;
/** Total polyline vertices across the whole response. */
export const MAX_VERTICES = 20_000;
/** Raw points one request may read before it is refused as too large. */
export const MAX_POINTS_READ = 250_000;
/** Heat cells returned, densest first. */
export const MAX_HEAT_CELLS = 4_000;
/** Nothing is on record before this date. */
export const EARLIEST_DATE = "2025-01-01";

const ALLOWED_PARAMS = new Set(["tail", "from", "to", "mission"]);
const MISSION_RE = /^[a-z][a-z0-9_,-]{0,95}$/;

// ─── query validation ────────────────────────────────────────────────

export type HistoryQuery = {
  /** Explicit tails, uppercased and deduped; null means "every registry tail". */
  tails: string[] | null;
  from: string;
  to: string;
  days: number;
  mission: string | null;
  /** True when `to` is today (Pacific), so the range is still being written. */
  includesToday: boolean;
};

export type QueryResult =
  | { ok: true; query: HistoryQuery }
  | { ok: false; error: string; detail?: string };

/** Strict parse of /api/history search params against "now". */
export function parseHistoryQuery(params: URLSearchParams, nowMs: number): QueryResult {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return { ok: false, error: "unknown_param", detail: key };
  }
  for (const key of ["from", "to", "mission"]) {
    if (params.getAll(key).length > 1) return { ok: false, error: "duplicate_param", detail: key };
  }

  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) return { ok: false, error: "missing_range", detail: "from and to are required (YYYY-MM-DD, Pacific)" };
  if (!isPtDate(from)) return { ok: false, error: "bad_from" };
  if (!isPtDate(to)) return { ok: false, error: "bad_to" };
  if (from > to) return { ok: false, error: "from_after_to" };
  if (from < EARLIEST_DATE) return { ok: false, error: "from_too_early", detail: EARLIEST_DATE };
  const today = todayPt(nowMs);
  if (to > today) return { ok: false, error: "to_in_future", detail: today };
  const days = daysInclusive(from, to);
  if (days > MAX_RANGE_DAYS) return { ok: false, error: "range_too_long", detail: `max ${MAX_RANGE_DAYS} days` };

  let tails: string[] | null = null;
  const rawTails = params.getAll("tail").flatMap((v) => v.split(","));
  if (rawTails.length > 0) {
    const set = new Set<string>();
    for (const raw of rawTails) {
      const t = normalizeTail(raw);
      if (!t) return { ok: false, error: "bad_tail", detail: raw.slice(0, 16) };
      set.add(t);
    }
    if (set.size > MAX_TAILS) return { ok: false, error: "too_many_tails", detail: `max ${MAX_TAILS}` };
    tails = [...set].sort();
  }

  let mission: string | null = null;
  const rawMission = params.get("mission");
  if (rawMission !== null) {
    const m = rawMission.trim().toLowerCase();
    if (!MISSION_RE.test(m)) return { ok: false, error: "bad_mission" };
    mission = m;
  }

  return { ok: true, query: { tails, from, to, days, mission, includesToday: to === today } };
}

/** CDN cache header: closed ranges change only when the past is rebuilt. */
export function historyCacheControl(includesToday: boolean): string {
  return includesToday
    ? "public, s-maxage=30, stale-while-revalidate=60"
    : "public, s-maxage=300, stale-while-revalidate=600";
}

// ─── mission filter ──────────────────────────────────────────────────

/**
 * Which registry entries `?mission=` keeps. Accepts one mission or a
 * comma list in the lib/mission.ts taxonomy (police, federal_le, sar,
 * wildfire, medevac, survey, transport, unknown); legacy role names
 * (smokey, patrol) map through normalizeMissionList. "all", or a value
 * that names no known mission, applies no filter and the response says
 * `mission_applied: false`.
 */
export function filterByMission(
  fleet: FleetEntry[],
  mission: string | null,
): { entries: FleetEntry[]; applied: boolean } {
  if (!mission || mission === "all") return { entries: fleet, applied: false };
  const wanted = normalizeMissionList(mission.split(","));
  if (wanted.length === 0 || wanted.length === MISSIONS.length) {
    return { entries: fleet, applied: false };
  }
  return {
    entries: fleet.filter((f) => wanted.includes(normalizeMission(f.role))),
    applied: true,
  };
}

// ─── Douglas–Peucker ─────────────────────────────────────────────────

type LatLon = { lat: number; lon: number };

/**
 * Indices of the points Douglas–Peucker keeps at tolerance `epsDeg`
 * (degrees of latitude; longitude is scaled by cos(lat) so the test is
 * roughly isotropic). Iterative, so long tracks cannot blow the stack.
 * Endpoints are always kept.
 */
export function douglasPeuckerIndices(points: LatLon[], epsDeg: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const k = Math.cos((points[0]!.lat * Math.PI) / 180);
  const eps2 = epsDeg * epsDeg;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b <= a + 1) continue;
    const ax = points[a]!.lon * k;
    const ay = points[a]!.lat;
    const dx = points[b]!.lon * k - ax;
    const dy = points[b]!.lat - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i]!.lon * k - ax;
      const py = points[i]!.lat - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > eps2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function douglasPeucker<T extends LatLon>(points: T[], epsDeg: number): T[] {
  return douglasPeuckerIndices(points, epsDeg).map((i) => points[i]!);
}

/**
 * Base tolerance for a range: ~11 m for a single day, growing with the
 * square root of the range so a year-long overlay keeps its shape at
 * ~200 m while the vertex count stays sane.
 */
export function toleranceForDays(days: number): number {
  return 0.0001 * Math.sqrt(Math.max(1, days));
}

/** Even decimation keeping both endpoints. Last resort under the cap. */
function decimate<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  if (max <= 2) return [points[0]!, points[points.length - 1]!].slice(0, Math.max(1, max));
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

/**
 * Simplify every line, doubling the tolerance until the total vertex
 * count fits `maxVertices`. If it still does not fit after a few rounds,
 * each line is decimated to its proportional share (min 2 vertices).
 */
export function simplifyLines<T extends LatLon>(
  lines: T[][],
  baseEps: number,
  maxVertices = MAX_VERTICES,
): { lines: T[][]; tolerance: number; vertices: number } {
  let eps = baseEps;
  let out = lines.map((l) => douglasPeucker(l, eps));
  let total = out.reduce((n, l) => n + l.length, 0);
  for (let round = 0; round < 8 && total > maxVertices; round++) {
    eps *= 2;
    out = lines.map((l) => douglasPeucker(l, eps));
    total = out.reduce((n, l) => n + l.length, 0);
  }
  if (total > maxVertices) {
    const share = Math.max(2, Math.floor(maxVertices / Math.max(1, out.length)));
    out = out.map((l) => decimate(l, share));
    // Lines that cannot fit even at 2 vertices each: drop the shortest.
    total = out.reduce((n, l) => n + l.length, 0);
    if (total > maxVertices) {
      const order = out
        .map((l, i) => ({ i, n: lines[i]!.length }))
        .sort((a, b) => b.n - a.n);
      const keepIdx = new Set<number>();
      let budget = maxVertices;
      for (const { i } of order) {
        if (out[i]!.length <= budget) {
          keepIdx.add(i);
          budget -= out[i]!.length;
        }
      }
      out = out.map((l, i) => (keepIdx.has(i) ? l : []));
      total = out.reduce((n, l) => n + l.length, 0);
    }
  }
  return { lines: out, tolerance: eps, vertices: total };
}

// ─── heat grid ───────────────────────────────────────────────────────

export type HeatCell = { lat: number; lon: number; count: number; tails: string[] };

/** Same cells and tracking envelope as lib/hotzones.ts, over any point set. */
export function heatGrid(
  byTail: { tail: string; points: LatLon[] }[],
  maxCells = MAX_HEAT_CELLS,
): { cells: HeatCell[]; total_cells: number } {
  const cells = new Map<string, { cellLat: number; cellLon: number; count: number; tails: Set<string> }>();
  for (const { tail, points } of byTail) {
    for (const p of points) {
      if (!inTrackingEnvelope(p.lat, p.lon)) continue;
      const { cellLat, cellLon } = cellOrigin(p.lat, p.lon);
      const key = `${cellLat.toFixed(4)},${cellLon.toFixed(4)}`;
      const c = cells.get(key);
      if (c) {
        c.count += 1;
        c.tails.add(tail);
      } else {
        cells.set(key, { cellLat, cellLon, count: 1, tails: new Set([tail]) });
      }
    }
  }
  const out: HeatCell[] = [...cells.values()].map((c) => ({
    lat: round5(c.cellLat + GRID_CELL_DEG / 2),
    lon: round5(c.cellLon + GRID_CELL_DEG / 2),
    count: c.count,
    tails: [...c.tails].sort(),
  }));
  out.sort((a, b) => b.count - a.count || a.lat - b.lat || a.lon - b.lon);
  return { cells: out.slice(0, maxCells), total_cells: out.length };
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

// ─── response assembly ───────────────────────────────────────────────

export type HistorySession = Omit<FlightSession, "nickname"> & {
  /** flightIdFromTs(start_ts); resolves at /flight/{tail}/{id}. */
  id: string;
  nickname: string | null;
  operator: string;
  role: FleetRole;
};

/** [lat, lon, baro alt ft | null, unix seconds] */
export type PolyVertex = [number, number, number | null, number];

export type HistoryPolyline = { id: string; tail: string; points: PolyVertex[] };

export type TailSummary = {
  tail: string;
  nickname: string | null;
  flights: number;
  airborne_s: number;
  max_alt_ft: number;
};

export type HistorySummary = {
  flights: number;
  airborne_s: number;
  tails_flown: number;
  max_alt_ft: number;
  points_read: number;
  vertices: number;
  tolerance_deg: number;
  /** Pacific dates in range with at least one in-range point. */
  days_with_data: number;
  busiest_day: { date: string; airborne_s: number; flights: number } | null;
  busiest_hour: { dow: number; hour: number; minutes: number } | null;
  per_tail: TailSummary[];
};

export type HistoryBody = {
  v: typeof HISTORY_VERSION;
  range: {
    from: string;
    to: string;
    days: number;
    tz: "America/Los_Angeles";
    start_ts: number;
    end_ts: number;
    includes_today: boolean;
  };
  filter: { tails: string[] | null; mission: string | null; mission_applied: boolean };
  sessions: HistorySession[];
  polylines: HistoryPolyline[];
  heat: { cell_deg: number; cells: HeatCell[]; total_cells: number };
  summary: HistorySummary;
};

export type TailInput = { entry: FleetEntry; points: TrackPoint[] };

/**
 * Fold every tail's raw points (any order, possibly spanning several UTC
 * days) into the /api/history body. Points outside the Pacific range are
 * dropped first, so sessions are clipped at the range edges. Sessions are
 * cut with sessionsFromDay over the whole range at once, so a flight that
 * crosses 00:00 UTC stays one session.
 */
export function buildHistory(
  query: HistoryQuery,
  inputs: TailInput[],
  filter: { mission_applied: boolean },
): HistoryBody {
  const { startMs, endMs } = ptRangeMs(query.from, query.to);
  const startSec = startMs / 1000;
  const endSec = endMs / 1000;

  const sessions: HistorySession[] = [];
  const rawLines: { id: string; tail: string; points: TrackPoint[] }[] = [];
  const heatInput: { tail: string; points: TrackPoint[] }[] = [];
  const ptDays = new Set<string>();
  let pointsRead = 0;

  for (const { entry, points } of inputs) {
    pointsRead += points.length;
    // Sort, clip to the range, and drop same-second duplicates (two
    // instances can log the same snapshot tick).
    const inRange = points
      .filter((p) => p.ts >= startSec && p.ts < endSec)
      .sort((a, b) => a.ts - b.ts)
      .filter((p, i, arr) => i === 0 || p.ts !== arr[i - 1]!.ts);
    if (inRange.length === 0) continue;
    heatInput.push({ tail: entry.tail, points: inRange });
    // Pacific day per point, resolved once per UTC hour (Intl is slow).
    let lastHour = -1;
    for (const p of inRange) {
      const h = Math.floor(p.ts / 3600);
      if (h !== lastHour) {
        ptDays.add(ptParts(h * 3_600_000).date);
        lastHour = h;
      }
    }

    // sessionsFromDay walks inRange in order, so each session is a
    // contiguous slice; one forward cursor finds every slice.
    let cursor = 0;
    for (const s of sessionsFromDay(entry, "", inRange)) {
      const id = flightIdFromTs(s.start_ts);
      sessions.push({
        ...s,
        date: utcDateKey(s.start_ts),
        id,
        nickname: entry.nickname,
        operator: entry.operator,
        role: entry.role,
      });
      const a = s.start_ts / 1000;
      const b = s.end_ts / 1000;
      while (cursor < inRange.length && inRange[cursor]!.ts < a) cursor++;
      const first = cursor;
      while (cursor < inRange.length && inRange[cursor]!.ts <= b) cursor++;
      rawLines.push({ id, tail: entry.tail, points: inRange.slice(first, cursor) });
    }
  }
  sessions.sort((a, b) => a.start_ts - b.start_ts || a.tail.localeCompare(b.tail));
  rawLines.sort((a, b) => (a.points[0]?.ts ?? 0) - (b.points[0]?.ts ?? 0) || a.tail.localeCompare(b.tail));

  const simplified = simplifyLines(
    rawLines.map((l) => l.points),
    toleranceForDays(query.days),
  );
  const polylines: HistoryPolyline[] = rawLines.map((l, i) => ({
    id: l.id,
    tail: l.tail,
    points: simplified.lines[i]!.map(
      (p): PolyVertex => [round5(p.lat), round5(p.lon), p.alt, p.ts],
    ),
  }));

  const heat = heatGrid(heatInput);

  // Summary.
  const perTail = new Map<string, TailSummary>();
  const dayMin = new Map<string, number>();
  const dayFlights = new Map<string, number>();
  const hourMin = new Map<string, number>();
  let maxAlt = 0;
  let airborne = 0;
  for (const s of sessions) {
    airborne += s.duration_s;
    if (s.max_alt_ft > maxAlt) maxAlt = s.max_alt_ft;
    const t = perTail.get(s.tail) ?? {
      tail: s.tail,
      nickname: s.nickname,
      flights: 0,
      airborne_s: 0,
      max_alt_ft: 0,
    };
    t.flights += 1;
    t.airborne_s += s.duration_s;
    t.max_alt_ft = Math.max(t.max_alt_ft, s.max_alt_ft);
    perTail.set(s.tail, t);
    const d = ptParts(s.start_ts).date;
    dayFlights.set(d, (dayFlights.get(d) ?? 0) + 1);
    distributeMinutes(s.start_ts, s.end_ts, (pt, min) => {
      dayMin.set(pt.date, (dayMin.get(pt.date) ?? 0) + min);
      const k = `${pt.dow}:${pt.hour}`;
      hourMin.set(k, (hourMin.get(k) ?? 0) + min);
    });
  }
  // Busiest Pacific day by minutes aloft; ties go to the most recent day.
  let bestDate: string | null = null;
  let bestMin = -1;
  for (const [date, min] of dayMin) {
    if (min > bestMin || (min === bestMin && date > bestDate!)) {
      bestDate = date;
      bestMin = min;
    }
  }
  const busiestDay: HistorySummary["busiest_day"] = bestDate
    ? { date: bestDate, airborne_s: Math.round(bestMin * 60), flights: dayFlights.get(bestDate) ?? 0 }
    : null;
  let busiestHour: HistorySummary["busiest_hour"] = null;
  for (const [k, min] of hourMin) {
    if (!busiestHour || min > busiestHour.minutes) {
      const [dow, hour] = k.split(":").map(Number) as [number, number];
      busiestHour = { dow, hour, minutes: Math.round(min * 10) / 10 };
    }
  }

  return {
    v: HISTORY_VERSION,
    range: {
      from: query.from,
      to: query.to,
      days: query.days,
      tz: "America/Los_Angeles",
      start_ts: startMs,
      end_ts: endMs,
      includes_today: query.includesToday,
    },
    filter: { tails: query.tails, mission: query.mission, mission_applied: filter.mission_applied },
    sessions,
    polylines,
    heat: { cell_deg: GRID_CELL_DEG, ...heat },
    summary: {
      flights: sessions.length,
      airborne_s: airborne,
      tails_flown: perTail.size,
      max_alt_ft: maxAlt,
      points_read: pointsRead,
      vertices: simplified.vertices,
      tolerance_deg: Math.round(simplified.tolerance * 1e7) / 1e7,
      days_with_data: ptDays.size,
      busiest_day: busiestDay,
      busiest_hour: busiestHour,
      per_tail: [...perTail.values()].sort(
        (a, b) => b.airborne_s - a.airborne_s || a.tail.localeCompare(b.tail),
      ),
    },
  };
}

/** UTC day keys a Pacific range touches (for deterministic key reads). */
export function utcKeysForQuery(query: Pick<HistoryQuery, "from" | "to">): string[] {
  const { startMs, endMs } = ptRangeMs(query.from, query.to);
  return utcDateKeysForRange(startMs, endMs);
}
