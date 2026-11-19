// Season wrap for /wrap/[year]: how the birds flew over one calendar
// year (Pacific), built from the permanent daily rollup.
//
// Pure. About the aircraft, never about riders: no counts of anyone
// "caught", no rankings of tails against each other.

import { MISSIONS } from "./mission";
import { distributeMinutes, ptParts, type DailyRollup, type StitchedSession } from "./rollup-core";
import { corridorsByRoad, type CorridorWorked } from "./logbook";
import { collectTailSessions, LOG_START_DATE, monthRange, ptMonth, type TailMeta } from "./rollup-sessions";
import type { Mission } from "./types";

/** First year with a wrap. The log begins in it. */
export const FIRST_WRAP_YEAR = Number(LOG_START_DATE.slice(0, 4));

export type WrapMonth = {
  month: string;
  sorties: number;
  airborne_s: number;
  /** True when the log start or the last closed day cuts the month short. */
  partial: boolean;
  /** Days of this month the wrap covers. */
  days: number;
  /** Airborne seconds per covered day: what busiest and quietest compare. */
  per_day_s: number;
};

/**
 * A month needs at least this many covered days before it can be the
 * busiest or quietest one. Shorter stubs (a log that began on the 28th)
 * would swing either way on a single flight.
 */
export const WRAP_MIN_COMPARE_DAYS = 7;

export type WrapSummary = {
  year: number;
  /** First and last Pacific day the wrap covers, YYYY-MM-DD. */
  from: string;
  to: string;
  /** True when the log began after Jan 1 of this year. */
  limited: boolean;
  /** True while the year is still running. */
  in_progress: boolean;
  totals: { sorties: number; airborne_s: number; tails: number };
  months: WrapMonth[];
  busiest_month: WrapMonth | null;
  quietest_month: WrapMonth | null;
  busiest_day: { date: string; airborne_s: number; sorties: number } | null;
  busiest_hour: { hour: number; minutes: number } | null;
  longest: { tail: string; nickname: string | null; start_ts: number; duration_s: number } | null;
  corridor: CorridorWorked | null;
  /** Sorties carrying pattern detail, the base for `corridor`. */
  sorties_with_detail: number;
  by_mission: { mission: Mission; sorties: number; airborne_s: number; tails: number }[];
};

/** Valid wrap year: from the log's first year up to the current Pacific year. */
export function isWrapYear(year: number, nowMs: number): boolean {
  const current = Number(ptParts(nowMs).date.slice(0, 4));
  return Number.isInteger(year) && year >= FIRST_WRAP_YEAR && year <= current;
}

/** The season the hub and the stats/data cards point at: this PT year. */
export function currentWrapYear(nowMs: number): number {
  return Math.max(FIRST_WRAP_YEAR, Number(ptParts(nowMs).date.slice(0, 4)));
}

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function summarizeWrap(
  docs: ReadonlyArray<DailyRollup>,
  year: number,
  nowMs: number,
  registry?: ReadonlyMap<string, Partial<TailMeta>>,
  /** First Pacific date on record (lib/data-since.ts). */
  since: string = LOG_START_DATE,
): WrapSummary {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const today = ptParts(nowMs).date;
  const from = since > yearStart ? since : yearStart;
  // The rollup closes a day once it is over, so "through yesterday".
  const lastClosed = addDays(today, -1);
  const to = yearEnd < lastClosed ? yearEnd : lastClosed;
  const inYear = (s: StitchedSession) => ptParts(s.start_ts).date.slice(0, 4) === String(year);

  const tails = collectTailSessions(docs, registry);
  const sessions: (StitchedSession & { mission: Mission })[] = [];
  for (const t of tails) {
    for (const s of t.sessions) if (inYear(s)) sessions.push({ ...s, mission: t.mission });
  }

  // Months the log was running, in order. Partial when the window cuts it.
  const monthKeys = from <= to ? monthRange(from.slice(0, 7), to.slice(0, 7)) : [];
  const months = new Map<string, WrapMonth>(
    monthKeys.map((m) => [
      m,
      {
        month: m,
        sorties: 0,
        airborne_s: 0,
        partial: m === from.slice(0, 7) && !from.endsWith("-01") ? true : m === to.slice(0, 7) && to !== lastDayOf(m),
        days: coveredDays(m, from, to),
        per_day_s: 0,
      },
    ]),
  );

  const dayMin = new Map<string, number>();
  const daySorties = new Map<string, number>();
  const hourMin = new Array<number>(24).fill(0);
  const missions = new Map<Mission, { sorties: number; airborne_s: number; tails: Set<string> }>();
  const corridorLists: { label: string; s: number }[] = [];
  let withDetail = 0;
  let total = 0;
  let longest: WrapSummary["longest"] = null;
  const tailSet = new Set<string>();

  for (const s of sessions) {
    total += s.duration_s;
    tailSet.add(s.tail);
    const mb = months.get(ptMonth(s.start_ts));
    if (mb) {
      mb.sorties++;
      mb.airborne_s += s.duration_s;
    }
    const startDay = ptParts(s.start_ts).date;
    daySorties.set(startDay, (daySorties.get(startDay) ?? 0) + 1);
    distributeMinutes(s.start_ts, s.end_ts, (pt, min) => {
      dayMin.set(pt.date, (dayMin.get(pt.date) ?? 0) + min);
      hourMin[pt.hour]! += min;
    });
    const m = missions.get(s.mission) ?? { sorties: 0, airborne_s: 0, tails: new Set<string>() };
    m.sorties++;
    m.airborne_s += s.duration_s;
    m.tails.add(s.tail);
    missions.set(s.mission, m);
    if (typeof s.orbit_s === "number") {
      withDetail++;
      corridorLists.push(...(s.corridors ?? []));
    }
    if (!longest || s.duration_s > longest.duration_s) {
      longest = { tail: s.tail, nickname: s.nickname, start_ts: s.start_ts, duration_s: s.duration_s };
    }
  }

  const monthList = [...months.values()];
  for (const m of monthList) m.per_day_s = m.days > 0 ? Math.round(m.airborne_s / m.days) : 0;
  const { busiest: busiestMonth, quietest: quietestMonth } = monthExtremes(monthList);

  let busiestDay: WrapSummary["busiest_day"] = null;
  for (const [date, min] of dayMin) {
    if (!busiestDay || min * 60 > busiestDay.airborne_s || (min * 60 === busiestDay.airborne_s && date > busiestDay.date)) {
      busiestDay = { date, airborne_s: Math.round(min * 60), sorties: daySorties.get(date) ?? 0 };
    }
  }

  let busiestHour: WrapSummary["busiest_hour"] = null;
  for (let h = 0; h < 24; h++) {
    if (hourMin[h]! > 0 && (!busiestHour || hourMin[h]! > busiestHour.minutes)) {
      busiestHour = { hour: h, minutes: hourMin[h]! };
    }
  }
  if (busiestHour) busiestHour.minutes = Math.round(busiestHour.minutes);

  return {
    year,
    from,
    to,
    limited: from > yearStart,
    in_progress: to < yearEnd,
    totals: { sorties: sessions.length, airborne_s: total, tails: tailSet.size },
    months: monthList,
    busiest_month: busiestMonth,
    quietest_month: quietestMonth,
    busiest_day: busiestDay,
    busiest_hour: busiestHour,
    longest,
    corridor: corridorsByRoad(corridorLists)[0] ?? null,
    sorties_with_detail: withDetail,
    by_mission: MISSIONS.filter((m) => missions.has(m)).map((m) => {
      const v = missions.get(m)!;
      return { mission: m, sorties: v.sorties, airborne_s: v.airborne_s, tails: v.tails.size };
    }),
  };
}

/**
 * Busiest and quietest month by airborne time per covered day, so a
 * 16-day partial month is not "quiet" next to a whole one. Months with
 * fewer than WRAP_MIN_COMPARE_DAYS covered days sit out; quietest needs
 * two comparable months.
 */
export function monthExtremes(list: ReadonlyArray<WrapMonth>): {
  busiest: WrapMonth | null;
  quietest: WrapMonth | null;
} {
  const pool = list.filter((m) => m.days >= WRAP_MIN_COMPARE_DAYS);
  let busiest: WrapMonth | null = null;
  let quietest: WrapMonth | null = null;
  for (const m of pool) {
    if (m.sorties > 0 && (!busiest || m.per_day_s > busiest.per_day_s)) busiest = m;
  }
  if (pool.length >= 2) {
    for (const m of pool) {
      if (!quietest || m.per_day_s < quietest.per_day_s) quietest = m;
    }
  }
  if (quietest && busiest && quietest.month === busiest.month) quietest = null;
  return { busiest, quietest };
}

/** Days of `month` inside [from, to], both YYYY-MM-DD. */
export function coveredDays(month: string, from: string, to: string): number {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const a = from > first ? from : first;
  const b = to < last ? to : last;
  if (a > b) return 0;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
