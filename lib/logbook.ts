// Aircraft logbook for /plane/[tail]: the long view of one airframe.
//
// Pure aggregation. Inputs are this tail's rollup sessions (the permanent
// daily log, lib/rollup-core.ts) plus any recent flights read straight
// from tracks (which fill in today, not yet rolled up, and carry the
// points for departure / pattern detail). No I/O; components/Logbook.tsx
// does the reads.

import { SESSION_GAP_MS, flightIdFromTs } from "./flights";
import { corridorRoad, flightDetailFromPoints, type CorridorTime } from "./flight-detail";
import { distributeMinutes, stitchSessions, type RollupSession } from "./rollup-core";
import { LOG_START_DATE, dedupeSessions, lastMonths, ptMonth } from "./rollup-sessions";
import type { TrackPoint } from "./tracks";

export const LOGBOOK_MONTHS = 12;
export const LOGBOOK_RECENT = 8;
const TOP_N = 3;

export type TrackFlightInput = {
  session: { start_ts: number; end_ts: number; duration_s: number; max_alt_ft: number };
  points: ReadonlyArray<TrackPoint>;
  inProgress: boolean;
};

export type LogbookMonth = { month: string; sorties: number; airborne_s: number };

export type LogbookFlight = {
  flightId: string;
  start_ts: number;
  end_ts: number;
  duration_s: number;
  max_alt_ft: number;
  dep: string | null;
  arr: string | null;
  /** Null when no detail is on file for this flight. */
  orbit_s: number | null;
  /** Road of the corridor most worked on this flight, e.g. "I-5 · Fife". */
  corridor: string | null;
  inProgress: boolean;
};

export type CorridorWorked = { road: string; s: number; place: string | null };

export type Logbook = {
  tail: string;
  months: LogbookMonth[];
  totals: { sorties: number; airborne_s: number };
  avg_sortie_s: number | null;
  longest: { flightId: string; start_ts: number; duration_s: number; max_alt_ft: number } | null;
  /** Airborne minutes by Pacific hour of day, 0..23. */
  hour_minutes: number[];
  /** Busiest 3-hour Pacific window, wrapping past midnight. */
  peak_hours: { start: number; end: number; minutes: number } | null;
  departures: { id: string; count: number }[];
  /** Flights whose departure field resolved. */
  departures_known: number;
  station: {
    orbit_s: number;
    /** Flights with pattern detail on file (the denominator for orbit_s). */
    flights_with_detail: number;
    corridors: CorridorWorked[];
  };
  recent: LogbookFlight[];
};

/** Track flight → rollup-shaped session carrying its detail. */
function trackToSession(f: TrackFlightInput): RollupSession {
  return {
    start_ts: f.session.start_ts,
    end_ts: f.session.end_ts,
    duration_s: f.session.duration_s,
    max_alt_ft: f.session.max_alt_ft,
    ...flightDetailFromPoints(f.points, f.inProgress),
  };
}

/** Best `width`-hour window over a 24-slot circular histogram. */
export function peakWindow(
  hourMinutes: ReadonlyArray<number>,
  width = 3,
): { start: number; end: number; minutes: number } | null {
  let best = -1;
  let bestStart = 0;
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += hourMinutes[(h + k) % 24] ?? 0;
    if (sum > best) {
      best = sum;
      bestStart = h;
    }
  }
  if (best <= 0) return null;
  return { start: bestStart, end: (bestStart + width) % 24, minutes: Math.round(best) };
}

/** Group corridor labels by road, keeping the place with the most time. */
export function corridorsByRoad(list: ReadonlyArray<CorridorTime>): CorridorWorked[] {
  const roads = new Map<string, { s: number; places: Map<string, number> }>();
  for (const c of list) {
    const road = corridorRoad(c.label);
    const place = c.label.includes(" · ") ? c.label.split(" · ").slice(1).join(" · ") : null;
    const r = roads.get(road) ?? { s: 0, places: new Map<string, number>() };
    r.s += c.s;
    if (place) r.places.set(place, (r.places.get(place) ?? 0) + c.s);
    roads.set(road, r);
  }
  return [...roads.entries()]
    .map(([road, r]) => {
      let place: string | null = null;
      let ps = -1;
      for (const [p, s] of r.places) {
        if (s > ps || (s === ps && place !== null && p < place)) {
          place = p;
          ps = s;
        }
      }
      return { road, s: r.s, place };
    })
    .sort((a, b) => b.s - a.s || a.road.localeCompare(b.road));
}

export function buildLogbook(input: {
  tail: string;
  rollupSessions: ReadonlyArray<RollupSession>;
  trackFlights: ReadonlyArray<TrackFlightInput>;
  nowMs: number;
  months?: number;
  recent?: number;
}): Logbook {
  const { tail, nowMs } = input;
  const monthsN = input.months ?? LOGBOOK_MONTHS;
  const recentN = input.recent ?? LOGBOOK_RECENT;

  // Tracks go last so their (fresher) detail wins over a rollup copy of
  // the same session.
  const merged = dedupeSessions([
    ...input.rollupSessions,
    ...input.trackFlights.map(trackToSession),
  ]);
  const flights = stitchSessions(tail, null, merged);
  const liveEnds = new Set(
    input.trackFlights
      .filter((f) => f.inProgress && nowMs - f.session.end_ts < SESSION_GAP_MS)
      .map((f) => f.session.end_ts),
  );

  // Months: the last N Pacific months, never before the log began.
  const logStartMonth = LOG_START_DATE.slice(0, 7);
  const monthKeys = lastMonths(ptMonth(nowMs), monthsN).filter((m) => m >= logStartMonth);
  const monthMap = new Map<string, LogbookMonth>(
    monthKeys.map((m) => [m, { month: m, sorties: 0, airborne_s: 0 }]),
  );

  const hourMinutes = new Array<number>(24).fill(0);
  const depCounts = new Map<string, number>();
  let depKnown = 0;
  let orbitS = 0;
  let withDetail = 0;
  const corridorLists: CorridorTime[] = [];
  let totalS = 0;
  let longest: Logbook["longest"] = null;

  for (const f of flights) {
    totalS += f.duration_s;
    const mb = monthMap.get(ptMonth(f.start_ts));
    if (mb) {
      mb.sorties++;
      mb.airborne_s += f.duration_s;
    }
    distributeMinutes(f.start_ts, f.end_ts, (pt, min) => {
      hourMinutes[pt.hour]! += min;
    });
    if (f.dep) {
      depKnown++;
      depCounts.set(f.dep, (depCounts.get(f.dep) ?? 0) + 1);
    }
    if (typeof f.orbit_s === "number") {
      withDetail++;
      orbitS += f.orbit_s;
      corridorLists.push(...(f.corridors ?? []));
    }
    if (!longest || f.duration_s > longest.duration_s) {
      longest = {
        flightId: flightIdFromTs(f.start_ts),
        start_ts: f.start_ts,
        duration_s: f.duration_s,
        max_alt_ft: f.max_alt_ft,
      };
    }
  }

  const departures = [...depCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, TOP_N);

  const recent: LogbookFlight[] = [...flights]
    .sort((a, b) => b.start_ts - a.start_ts)
    .slice(0, recentN)
    .map((f) => ({
      flightId: flightIdFromTs(f.start_ts),
      start_ts: f.start_ts,
      end_ts: f.end_ts,
      duration_s: f.duration_s,
      max_alt_ft: f.max_alt_ft,
      dep: f.dep ?? null,
      arr: f.arr ?? null,
      orbit_s: typeof f.orbit_s === "number" ? f.orbit_s : null,
      corridor: f.corridors && f.corridors.length > 0 ? f.corridors[0]!.label : null,
      inProgress: liveEnds.has(f.end_ts),
    }));

  const rounded = hourMinutes.map((m) => Math.round(m * 10) / 10);
  return {
    tail,
    months: [...monthMap.values()],
    totals: { sorties: flights.length, airborne_s: totalS },
    avg_sortie_s: flights.length ? Math.round(totalS / flights.length) : null,
    longest,
    hour_minutes: rounded,
    peak_hours: peakWindow(rounded),
    departures,
    departures_known: depKnown,
    station: {
      orbit_s: orbitS,
      flights_with_detail: withDetail,
      corridors: corridorsByRoad(corridorLists).slice(0, TOP_N),
    },
    recent,
  };
}
