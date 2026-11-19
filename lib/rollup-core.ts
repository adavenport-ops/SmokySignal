// Pure half of the permanent daily rollup. No Redis, no clock reads:
// every function takes its inputs (samples, docs, "now") as arguments so
// lib/rollup.test.ts can pin the arithmetic. The IO half lives in
// lib/rollup.ts.
//
// Why a rollup at all: tracks:* and activity:* carried a 35-day TTL when
// this shipped (tracks are permanent since 2026-11-18). One small JSON doc per UTC day,
// stored with no TTL, keeps "how the bird flew" forever without keeping
// a single position point.

import { sessionsFromDay, SESSION_GAP_MS } from "./flights";
import { PT_TZ } from "./time";
import type { TrackPoint } from "./tracks";
import type { FleetEntry, FleetRole } from "./types";
import { normalizeMission } from "./mission";
import { flightDetailFromPoints, mergeCorridors, type CorridorTime } from "./flight-detail";

export const ROLLUP_VERSION = 1 as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** One airborne session. Start/end/duration/altitude only, no points. */
export type RollupSession = {
  start_ts: number; // ms
  end_ts: number; // ms
  duration_s: number;
  max_alt_ft: number;
  // Optional detail (lib/flight-detail.ts). Absent on docs built before
  // the logbook shipped; runRollup rebuilds those while tracks exist.
  /** Departure field id, null when unresolved. */
  dep?: string | null;
  /** Arrival field id, null when unresolved. */
  arr?: string | null;
  /** Seconds in orbit / loiter patterns. */
  orbit_s?: number;
  /** Orbit seconds by corridor label. */
  corridors?: CorridorTime[];
};

/** True when every session in the doc carries the flight-detail fields. */
export function rollupHasDetail(doc: DailyRollup): boolean {
  return doc.tails.every((t) => t.sessions.every((s) => typeof s.orbit_s === "number"));
}

export type RollupTail = {
  tail: string;
  nickname: string | null;
  operator: string;
  role: FleetRole;
  flights: number;
  airborne_s: number;
  max_alt_ft: number;
  /** Start of the first session that UTC day, ms. */
  first_takeoff_ts: number | null;
  /** Start of the last session that UTC day, ms. */
  last_takeoff_ts: number | null;
  sessions: RollupSession[];
};

export type DailyRollup = {
  v: typeof ROLLUP_VERSION;
  /** UTC day, YYYYMMDD. Matches the tracks:{tail}:{YYYYMMDD} key it was built from. */
  date: string;
  built_at: number; // ms
  registry_size: number;
  /** Raw track samples read across the fleet. 0 means we heard nothing that day. */
  sample_count: number;
  /** Only tails with at least one session. */
  tails: RollupTail[];
  totals: {
    flights: number;
    airborne_s: number;
    max_alt_ft: number;
    tails_flown: number;
  };
  /** Airborne minutes per Pacific hour of day (index 0..23), fleet-wide. */
  pt_hour_minutes: number[];
};

// ─── Pacific-time helpers ────────────────────────────────────────────

const PT_PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type PtParts = { date: string; dow: number; hour: number };

/** Pacific calendar date (YYYY-MM-DD), weekday (0 = Sun) and hour (0..23). */
export function ptParts(tsMs: number): PtParts {
  let y = "",
    m = "",
    d = "",
    h = "0",
    wd = "Sun";
  for (const p of PT_PARTS_FMT.formatToParts(new Date(tsMs))) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") d = p.value;
    else if (p.type === "hour") h = p.value;
    else if (p.type === "weekday") wd = p.value;
  }
  return { date: `${y}-${m}-${d}`, dow: DOW[wd] ?? 0, hour: Number(h) % 24 };
}

/**
 * Split [startMs, endMs) at every hour boundary and hand each piece to
 * `add` with its Pacific date/weekday/hour and length in minutes.
 * America/Los_Angeles offsets are whole hours, so UTC hour boundaries are
 * Pacific hour boundaries too, DST transitions included.
 */
export function distributeMinutes(
  startMs: number,
  endMs: number,
  add: (pt: PtParts, minutes: number) => void,
): void {
  let t = startMs;
  while (t < endMs) {
    const next = Math.min(endMs, (Math.floor(t / HOUR_MS) + 1) * HOUR_MS);
    add(ptParts(t), (next - t) / 60_000);
    t = next;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "20261118" → "2026-11-18". Leaves anything else untouched. */
export function dashedDate(dateKey: string): string {
  return /^\d{8}$/.test(dateKey)
    ? `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`
    : dateKey;
}

/** UTC YYYYMMDD for an instant. */
export function utcDateKey(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ─── Daily doc ───────────────────────────────────────────────────────

export type TailDayInput = { entry: FleetEntry; samples: TrackPoint[] };

/** Build one day's rollup doc from each registry tail's raw samples. */
export function buildRollupDoc(
  dateKey: string,
  inputs: TailDayInput[],
  builtAt: number,
): DailyRollup {
  const tails: RollupTail[] = [];
  const hourMinutes = new Array<number>(24).fill(0);
  let sampleCount = 0;

  for (const { entry, samples } of inputs) {
    sampleCount += samples.length;
    const sessions = sessionsFromDay(entry, dateKey, samples);
    if (sessions.length === 0) continue;

    let airborne = 0;
    let maxAlt = 0;
    const out: RollupSession[] = [];
    for (const s of sessions) {
      airborne += s.duration_s;
      if (s.max_alt_ft > maxAlt) maxAlt = s.max_alt_ft;
      const startSec = Math.floor(s.start_ts / 1000);
      const endSec = Math.ceil(s.end_ts / 1000);
      const detail = flightDetailFromPoints(
        samples.filter((p) => p.ts >= startSec && p.ts <= endSec),
      );
      out.push({
        start_ts: s.start_ts,
        end_ts: s.end_ts,
        duration_s: s.duration_s,
        max_alt_ft: s.max_alt_ft,
        ...detail,
      });
      distributeMinutes(s.start_ts, s.end_ts, (pt, min) => {
        hourMinutes[pt.hour]! += min;
      });
    }
    tails.push({
      tail: entry.tail,
      nickname: entry.nickname,
      operator: entry.operator,
      role: entry.role,
      flights: out.length,
      airborne_s: airborne,
      max_alt_ft: maxAlt,
      first_takeoff_ts: out[0]!.start_ts,
      last_takeoff_ts: out[out.length - 1]!.start_ts,
      sessions: out,
    });
  }

  tails.sort((a, b) => b.airborne_s - a.airborne_s || a.tail.localeCompare(b.tail));

  return {
    v: ROLLUP_VERSION,
    date: dateKey,
    built_at: builtAt,
    registry_size: inputs.length,
    sample_count: sampleCount,
    tails,
    totals: {
      flights: tails.reduce((n, t) => n + t.flights, 0),
      airborne_s: tails.reduce((n, t) => n + t.airborne_s, 0),
      max_alt_ft: tails.reduce((n, t) => Math.max(n, t.max_alt_ft), 0),
      tails_flown: tails.length,
    },
    pt_hour_minutes: hourMinutes.map(round1),
  };
}

// ─── Backfill planning ───────────────────────────────────────────────

/**
 * Which UTC days the cron should build. Yesterday is always (re)built;
 * older days inside the track window are built only when missing from
 * the index. Today is never built: it is still being written.
 */
export function planRollupDates(
  nowMs: number,
  indexed: ReadonlySet<string>,
  windowDays: number,
): string[] {
  const out: string[] = [];
  for (let i = 1; i <= windowDays; i++) {
    const key = utcDateKey(nowMs - i * DAY_MS);
    if (i === 1 || !indexed.has(key)) out.push(key);
  }
  return out;
}

// ─── /stats summary ──────────────────────────────────────────────────

export type StitchedSession = RollupSession & {
  tail: string;
  nickname: string | null;
};

export type TailStat = {
  tail: string;
  nickname: string | null;
  operator: string;
  role: FleetRole;
  flights: number;
  airborne_s: number;
  last_takeoff_ts: number | null;
};

export type WeekBucket = {
  /** Monday of the Pacific week, YYYY-MM-DD. */
  week_start: string;
  airborne_s: number;
  /** True when the 30-day window cuts this week short on either end. */
  partial: boolean;
};

export type StatsSummary = {
  days_on_record: number;
  /** First indexed UTC day, YYYY-MM-DD. */
  first_date: string | null;
  totals: { flights: number; airborne_s: number };
  weekly: WeekBucket[];
  /** [dow 0 = Sun][hour 0..23] airborne minutes, Pacific. */
  week_grid: number[][];
  busiest_day: { date: string; airborne_s: number; flights: number } | null;
  longest_sortie: StitchedSession | null;
  per_tail: TailStat[];
};

/**
 * sessionsFromDay cuts every flight at 00:00 UTC (16:00 or 17:00 PT, the
 * middle of the afternoon) because tracks are keyed per UTC day. Rejoin
 * a tail's consecutive sessions when the gap between them is no wider
 * than the gap that splits sessions in the first place.
 */
export function stitchSessions(
  tail: string,
  nickname: string | null,
  sessions: RollupSession[],
): StitchedSession[] {
  const sorted = [...sessions].sort((a, b) => a.start_ts - b.start_ts);
  const out: StitchedSession[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start_ts - prev.end_ts <= SESSION_GAP_MS) {
      prev.end_ts = Math.max(prev.end_ts, s.end_ts);
      prev.duration_s = Math.round((prev.end_ts - prev.start_ts) / 1000);
      prev.max_alt_ft = Math.max(prev.max_alt_ft, s.max_alt_ft);
      // Detail: departure from the first part, arrival from the last.
      if ("arr" in s) prev.arr = s.arr;
      if (typeof prev.orbit_s === "number" && typeof s.orbit_s === "number") {
        prev.orbit_s += s.orbit_s;
        prev.corridors = mergeCorridors([prev.corridors ?? [], s.corridors ?? []]);
      } else {
        delete prev.orbit_s;
        delete prev.corridors;
      }
      continue;
    }
    out.push({ ...s, tail, nickname });
  }
  return out;
}

/** Monday (YYYY-MM-DD) of the week holding a Pacific calendar date. */
export function weekStartOf(ptDate: string, dow: number): string {
  const [y, m, d] = ptDate.split("-").map(Number) as [number, number, number];
  const back = (dow + 6) % 7; // Mon → 0, Sun → 6
  const t = Date.UTC(y, m - 1, d - back);
  return new Date(t).toISOString().slice(0, 10);
}

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const WEEKLY_WINDOW_DAYS = 30;

/**
 * Fold a set of daily docs into everything /stats renders. `indexDates`
 * is the full rollup:index (oldest first) so the "N days since" label
 * stays honest even if the caller only loaded a recent slice of docs.
 */
export function summarizeRollups(
  docs: DailyRollup[],
  indexDates: string[],
  nowMs: number,
): StatsSummary {
  // Latest metadata per tail (registry nicknames can change).
  const meta = new Map<string, { nickname: string | null; operator: string; role: FleetRole }>();
  const rawByTail = new Map<string, RollupSession[]>();
  const sortedDocs = [...docs].sort((a, b) => a.date.localeCompare(b.date));
  for (const doc of sortedDocs) {
    for (const t of doc.tails) {
      // Stored rollups keep the role value of their day; old docs hold
      // pre-taxonomy values (smokey, patrol), so normalize on read.
      meta.set(t.tail, { nickname: t.nickname, operator: t.operator, role: normalizeMission(t.role) });
      const list = rawByTail.get(t.tail) ?? [];
      list.push(...t.sessions);
      rawByTail.set(t.tail, list);
    }
  }

  const all: StitchedSession[] = [];
  const perTail: TailStat[] = [];
  for (const [tail, raw] of rawByTail) {
    const m = meta.get(tail)!;
    const stitched = stitchSessions(tail, m.nickname, raw);
    all.push(...stitched);
    perTail.push({
      tail,
      nickname: m.nickname,
      operator: m.operator,
      role: m.role,
      flights: stitched.length,
      airborne_s: stitched.reduce((n, s) => n + s.duration_s, 0),
      last_takeoff_ts: stitched.length ? stitched[stitched.length - 1]!.start_ts : null,
    });
  }
  perTail.sort((a, b) => b.airborne_s - a.airborne_s || a.tail.localeCompare(b.tail));

  // Hour × weekday grid and per-Pacific-day totals.
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const dayMinutes = new Map<string, number>();
  const dayFlights = new Map<string, number>();
  for (const s of all) {
    distributeMinutes(s.start_ts, s.end_ts, (pt, min) => {
      grid[pt.dow]![pt.hour]! += min;
      dayMinutes.set(pt.date, (dayMinutes.get(pt.date) ?? 0) + min);
    });
    const startDay = ptParts(s.start_ts).date;
    dayFlights.set(startDay, (dayFlights.get(startDay) ?? 0) + 1);
  }

  // Busiest Pacific day by minutes aloft; ties go to the most recent day.
  let busiestDate: string | null = null;
  let busiestMin = -1;
  for (const [date, min] of dayMinutes) {
    if (min > busiestMin || (min === busiestMin && date > busiestDate!)) {
      busiestDate = date;
      busiestMin = min;
    }
  }
  const busiest: StatsSummary["busiest_day"] = busiestDate
    ? {
        date: busiestDate,
        airborne_s: Math.round(busiestMin * 60),
        flights: dayFlights.get(busiestDate) ?? 0,
      }
    : null;

  let longest: StitchedSession | null = null;
  for (const s of all) {
    if (!longest || s.duration_s > longest.duration_s) longest = s;
  }

  // Last 30 days, bucketed by Pacific week (Monday start).
  const windowStart = nowMs - WEEKLY_WINDOW_DAYS * DAY_MS;
  const startPt = ptParts(windowStart);
  const nowPt = ptParts(nowMs);
  const firstWeek = weekStartOf(startPt.date, startPt.dow);
  const lastWeek = weekStartOf(nowPt.date, nowPt.dow);
  const weekSeconds = new Map<string, number>();
  for (let w = firstWeek; w <= lastWeek; w = addDays(w, 7)) weekSeconds.set(w, 0);
  for (const s of all) {
    const a = Math.max(s.start_ts, windowStart);
    const b = Math.min(s.end_ts, nowMs);
    if (b <= a) continue;
    distributeMinutes(a, b, (pt, min) => {
      const w = weekStartOf(pt.date, pt.dow);
      if (weekSeconds.has(w)) weekSeconds.set(w, weekSeconds.get(w)! + min * 60);
    });
  }
  const weekly: WeekBucket[] = [...weekSeconds.entries()].map(([week_start, sec]) => ({
    week_start,
    airborne_s: Math.round(sec),
    partial: week_start === firstWeek ? startPt.dow !== 1 || startPt.hour !== 0 : week_start === lastWeek,
  }));

  const sortedIndex = [...indexDates].sort();
  return {
    days_on_record: sortedIndex.length,
    first_date: sortedIndex.length ? dashedDate(sortedIndex[0]!) : null,
    totals: {
      flights: all.length,
      airborne_s: all.reduce((n, s) => n + s.duration_s, 0),
    },
    weekly,
    week_grid: grid.map((row) => row.map(round1)),
    busiest_day: busiest,
    longest_sortie: longest,
    per_tail: perTail,
  };
}
