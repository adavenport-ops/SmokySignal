// Open ledger for /data: monthly flight hours by tail and by mission, and
// the CSV export at /data/flight-hours.csv.
//
// Pure. Coarse on purpose: month, tail, counts, hours, peak altitude.
// No positions, no times of day, nothing about crew.

import { MISSIONS } from "./mission";
import type { DailyRollup } from "./rollup-core";
import { collectTailSessions, ptMonth, type TailMeta } from "./rollup-sessions";
import type { Mission } from "./types";

export type LedgerRow = {
  month: string; // YYYY-MM, Pacific, by takeoff
  tail: string;
  nickname: string | null;
  operator: string;
  mission: Mission;
  flights: number;
  airborne_s: number;
  max_alt_ft: number;
};

export type MissionRow = {
  month: string;
  mission: Mission;
  flights: number;
  airborne_s: number;
  tails: number;
};

export type MonthRange = { from?: string | null; to?: string | null };

/** Column order of the CSV. Part of the public contract; append only. */
export const CSV_COLUMNS = [
  "month",
  "tail",
  "nickname",
  "operator",
  "mission",
  "flights",
  "hours",
  "max_alt_ft",
] as const;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-11" → "2026-11"; anything else → null. */
export function parseMonthParam(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return MONTH_RE.test(s) ? s : null;
}

function inRange(month: string, r: MonthRange): boolean {
  if (r.from && month < r.from) return false;
  if (r.to && month > r.to) return false;
  return true;
}

/** Monthly rows per tail, oldest month first, then by tail. */
export function buildLedgerRows(
  docs: ReadonlyArray<DailyRollup>,
  opts: { registry?: ReadonlyMap<string, Partial<TailMeta>>; range?: MonthRange } = {},
): LedgerRow[] {
  const range = opts.range ?? {};
  const by = new Map<string, LedgerRow>();
  for (const t of collectTailSessions(docs, opts.registry)) {
    for (const s of t.sessions) {
      const month = ptMonth(s.start_ts);
      if (!inRange(month, range)) continue;
      const key = `${month}|${t.tail}`;
      const row =
        by.get(key) ??
        ({
          month,
          tail: t.tail,
          nickname: t.nickname,
          operator: t.operator,
          mission: t.mission,
          flights: 0,
          airborne_s: 0,
          max_alt_ft: 0,
        } satisfies LedgerRow);
      row.flights++;
      row.airborne_s += s.duration_s;
      if (s.max_alt_ft > row.max_alt_ft) row.max_alt_ft = s.max_alt_ft;
      by.set(key, row);
    }
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month) || a.tail.localeCompare(b.tail));
}

/** Roll tail rows up to month × mission, missions in canonical order. */
export function buildMissionRows(rows: ReadonlyArray<LedgerRow>): MissionRow[] {
  const by = new Map<string, MissionRow>();
  for (const r of rows) {
    const key = `${r.month}|${r.mission}`;
    const m = by.get(key) ?? { month: r.month, mission: r.mission, flights: 0, airborne_s: 0, tails: 0 };
    m.flights += r.flights;
    m.airborne_s += r.airborne_s;
    m.tails++;
    by.set(key, m);
  }
  const order = (m: Mission) => MISSIONS.indexOf(m);
  return [...by.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || order(a.mission) - order(b.mission),
  );
}

/** Seconds → decimal hours, two places, as a string. */
export function hoursString(seconds: number): string {
  return (Math.max(0, seconds) / 3600).toFixed(2);
}

/**
 * One CSV field per RFC 4180: quote when it holds a comma, quote, CR or
 * LF, doubling inner quotes. Text that a spreadsheet would run as a
 * formula (leading = + - @, tab or CR) gets a leading apostrophe first.
 */
export function csvField(v: string | number | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row plus one line per tail-month, CRLF line endings. */
export function ledgerCsv(rows: ReadonlyArray<LedgerRow>): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.month),
        csvField(r.tail),
        csvField(r.nickname),
        csvField(r.operator),
        csvField(r.mission),
        csvField(r.flights),
        hoursString(r.airborne_s),
        csvField(r.max_alt_ft),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Distinct months present in the rows, oldest first. */
export function ledgerMonths(rows: ReadonlyArray<{ month: string }>): string[] {
  return [...new Set(rows.map((r) => r.month))].sort();
}
