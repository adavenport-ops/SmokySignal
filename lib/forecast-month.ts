// Monthly view for /forecast. Pure: folds permanent daily rollup docs
// (lib/rollup-core.ts) into one Pacific calendar month. No Redis, no
// clock reads, so lib/forecast-month.test.ts can pin it.
//
// Why rollups and not tracks: every DailyRollup keeps each tail's
// sessions (start/end/max altitude), which is all an hour × weekday grid
// needs. No rollup schema change and no rebuild of existing days.
//
// Rollup docs are UTC days; a Pacific month starts at 07:00 or 08:00 UTC
// on the 1st. The month reads the UTC docs from the 1st through the 1st
// of the next month, stitches sessions across 00:00 UTC, then clips each
// session to the month's Pacific bounds.

import {
  dashedDate,
  distributeMinutes,
  ptParts,
  stitchSessions,
  type DailyRollup,
  type RollupSession,
} from "./rollup-core";
import { addDays, isMonthKey, monthBounds, monthLabel, ptRangeMs } from "./pt-range";
import { MISSIONS, normalizeMissionList } from "./mission";
import type { FleetRole, Mission } from "./types";

// ─── /forecast mission picker ────────────────────────────────────────

/** One mission at a time, or "all" (Everything). Smokey by default. */
export type ForecastMission = Mission | "all";
export const FORECAST_DEFAULT_MISSION: ForecastMission = "police";

/**
 * Resolve /forecast's ?mission= (single value). Falls back to the older
 * shared ?missions= list when it names exactly one mission or every
 * mission, so old links keep working; anything else is Smokey.
 */
export function parseForecastMission(
  raw: string | null | undefined,
  legacy?: string | null,
): ForecastMission {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "all") return "all";
  if (v) {
    const one = normalizeMissionList([v]);
    return one.length === 1 ? one[0]! : FORECAST_DEFAULT_MISSION;
  }
  const l = (legacy ?? "").trim().toLowerCase();
  if (l === "all") return "all";
  if (l) {
    const list = normalizeMissionList(l.split(","));
    if (list.length === 1) return list[0]!;
    if (list.length === MISSIONS.length) return "all";
  }
  return FORECAST_DEFAULT_MISSION;
}

/** The roles list resolveAllowedTails() takes ([] = no constraint). */
export function forecastRoles(m: ForecastMission): Mission[] {
  return m === "all" ? [] : [m];
}

export type MonthOption = { value: string; label: string };

/** "Last 30 days" is the default view; months are YYYY-MM. */
export const LAST_30 = "last30" as const;

/**
 * Calendar months on record, newest first. With `span` (the data-since
 * date and today, both Pacific YYYY-MM-DD) every month from the first
 * day on record through this month is listed, the same list the history
 * presets show; months before data-since are dropped. Without it, the
 * months that hold an indexed rollup day (UTC day key, which matches the
 * Pacific month for all but the first hours of the 1st).
 */
export function rollupMonths(
  indexDates: string[],
  span?: { since: string; today: string },
): MonthOption[] {
  const months = new Set<string>();
  for (const d of indexDates) {
    if (/^\d{8}$/.test(d)) months.add(`${d.slice(0, 4)}-${d.slice(4, 6)}`);
  }
  if (span && /^\d{4}-\d{2}-\d{2}$/.test(span.since) && /^\d{4}-\d{2}-\d{2}$/.test(span.today)) {
    const first = span.since.slice(0, 7);
    const last = span.today.slice(0, 7);
    for (const m of [...months]) if (m < first || m > last) months.delete(m);
    let [y, mo] = first.split("-").map(Number) as [number, number];
    for (let guard = 0; guard < 600; guard++) {
      const key = `${y}-${String(mo).padStart(2, "0")}`;
      if (key > last) break;
      months.add(key);
      mo++;
      if (mo > 12) {
        mo = 1;
        y++;
      }
    }
  }
  return [...months]
    .sort()
    .reverse()
    .map((value) => ({ value, label: monthLabel(value) }));
}

/** Resolve the ?month= param against what is on record. */
export function resolveMonthParam(raw: unknown, options: MonthOption[]): string {
  if (typeof raw !== "string" || !isMonthKey(raw)) return LAST_30;
  return options.some((o) => o.value === raw) ? raw : LAST_30;
}

/** UTC rollup day keys a Pacific month needs (1st through 1st of next month). */
export function utcDaysForMonth(month: string): string[] {
  const { first, last } = monthBounds(month);
  const out: string[] = [];
  for (let d = first; d <= addDays(last, 1); d = addDays(d, 1)) out.push(d.replace(/-/g, ""));
  return out;
}

export type MonthTail = {
  tail: string;
  nickname: string | null;
  operator: string;
  role: FleetRole;
  flights: number;
  airborne_s: number;
};

export type MonthSummary = {
  month: string;
  label: string;
  days_in_month: number;
  /** Indexed rollup days whose UTC date falls inside the month. */
  days_of_data: number;
  /** First and last such day, YYYY-MM-DD. */
  first_data_date: string | null;
  last_data_date: string | null;
  /** True for the month that holds "now" (it is still being written). */
  in_progress: boolean;
  totals: { flights: number; airborne_s: number; tails_flown: number };
  /** [dow 0 = Sun][hour 0..23] airborne minutes, Pacific, one decimal. */
  week_grid: number[][];
  busiest_day: { date: string; airborne_s: number; flights: number } | null;
  busiest_hour: { dow: number; hour: number; minutes: number } | null;
  per_tail: MonthTail[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Fold rollup docs into one Pacific month. `docs` may include days
 * outside the month (they are clipped); `indexDates` is the full
 * rollup:index so "days of data" counts what is on record, not what
 * this call happened to load. `tails` narrows to a mission filter.
 */
export function summarizeMonth(
  docs: DailyRollup[],
  month: string,
  indexDates: string[],
  nowMs: number,
  /** Keep only these tails (mission filter); null keeps every tail. */
  tails: ReadonlySet<string> | null = null,
): MonthSummary {
  const { first, last, days } = monthBounds(month);
  const { startMs, endMs } = ptRangeMs(first, last);

  const meta = new Map<string, { nickname: string | null; operator: string; role: FleetRole }>();
  const rawByTail = new Map<string, RollupSession[]>();
  for (const doc of [...docs].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const t of doc.tails) {
      if (tails && !tails.has(t.tail)) continue;
      meta.set(t.tail, { nickname: t.nickname, operator: t.operator, role: t.role });
      const list = rawByTail.get(t.tail) ?? [];
      list.push(...t.sessions);
      rawByTail.set(t.tail, list);
    }
  }

  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const dayMin = new Map<string, number>();
  const dayFlights = new Map<string, number>();
  const perTail: MonthTail[] = [];
  let flights = 0;
  let airborneS = 0;

  for (const [tail, raw] of rawByTail) {
    const m = meta.get(tail)!;
    let tFlights = 0;
    let tSeconds = 0;
    for (const s of stitchSessions(tail, m.nickname, raw)) {
      const a = Math.max(s.start_ts, startMs);
      const b = Math.min(s.end_ts, endMs);
      if (b <= a) continue;
      tSeconds += (b - a) / 1000;
      distributeMinutes(a, b, (pt, min) => {
        grid[pt.dow]![pt.hour]! += min;
        dayMin.set(pt.date, (dayMin.get(pt.date) ?? 0) + min);
      });
      // A flight belongs to the month it took off in.
      if (s.start_ts >= startMs && s.start_ts < endMs) {
        tFlights++;
        const d = ptParts(s.start_ts).date;
        dayFlights.set(d, (dayFlights.get(d) ?? 0) + 1);
      }
    }
    if (tFlights === 0 && tSeconds === 0) continue;
    flights += tFlights;
    airborneS += tSeconds;
    perTail.push({
      tail,
      nickname: m.nickname,
      operator: m.operator,
      role: m.role,
      flights: tFlights,
      airborne_s: Math.round(tSeconds),
    });
  }
  perTail.sort((a, b) => b.airborne_s - a.airborne_s || a.tail.localeCompare(b.tail));

  let busiestDate: string | null = null;
  let busiestMin = -1;
  for (const [date, min] of dayMin) {
    if (min > busiestMin || (min === busiestMin && date > busiestDate!)) {
      busiestDate = date;
      busiestMin = min;
    }
  }

  let busiestHour: MonthSummary["busiest_hour"] = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = grid[d]![h]!;
      if (v > 0 && (!busiestHour || v > busiestHour.minutes)) {
        busiestHour = { dow: d, hour: h, minutes: v };
      }
    }
  }

  const prefix = month.replace("-", "");
  const inMonth = indexDates.filter((d) => d.startsWith(prefix)).sort();

  return {
    month,
    label: monthLabel(month),
    days_in_month: days,
    days_of_data: inMonth.length,
    first_data_date: inMonth.length ? dashedDate(inMonth[0]!) : null,
    last_data_date: inMonth.length ? dashedDate(inMonth[inMonth.length - 1]!) : null,
    in_progress: nowMs >= startMs && nowMs < endMs,
    totals: { flights, airborne_s: Math.round(airborneS), tails_flown: perTail.length },
    week_grid: grid.map((row) => row.map(round1)),
    busiest_day: busiestDate
      ? {
          date: busiestDate,
          airborne_s: Math.round(busiestMin * 60),
          flights: dayFlights.get(busiestDate) ?? 0,
        }
      : null,
    busiest_hour: busiestHour ? { ...busiestHour, minutes: round1(busiestHour.minutes) } : null,
    per_tail: perTail,
  };
}
