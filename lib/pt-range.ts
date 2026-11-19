// Pacific-date range helpers. Pure, so node:test can pin DST edges.
//
// Riders think in Pacific calendar dates; KV keys (tracks:*, rollup:*,
// activity:day:*) are UTC days. A Pacific date range [from, to] maps to
// the instant range [00:00 PT on `from`, 00:00 PT on the day after `to`),
// which touches every UTC day from utcDateKey(start) to utcDateKey(end-1).

import { ptParts, utcDateKey } from "./rollup-core";

const DAY_MS = 86_400_000;
const PT_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isPtDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = PT_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Shift a YYYY-MM-DD date by n calendar days. */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive count of calendar days from `from` to `to`. */
export function daysInclusive(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS) + 1;
}

/**
 * The instant of 00:00 America/Los_Angeles on a Pacific date. The offset
 * is -7 or -8 hours and transitions happen at 02:00, so midnight always
 * exists and is one of two candidate UTC instants.
 */
export function ptDayStartMs(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  for (const h of [8, 7]) {
    const t = Date.UTC(y, m - 1, d, h);
    const p = ptParts(t);
    if (p.date === isoDate && p.hour === 0) return t;
  }
  return Date.UTC(y, m - 1, d, 8);
}

/** [start, end) instants covering Pacific dates from..to inclusive. */
export function ptRangeMs(from: string, to: string): { startMs: number; endMs: number } {
  return { startMs: ptDayStartMs(from), endMs: ptDayStartMs(addDays(to, 1)) };
}

/** Every UTC YYYYMMDD key the instant range [startMs, endMs) touches. */
export function utcDateKeysForRange(startMs: number, endMs: number): string[] {
  if (endMs <= startMs) return [];
  const out: string[] = [];
  const first = utcDateKey(startMs);
  const last = utcDateKey(endMs - 1);
  let t = Date.UTC(Number(first.slice(0, 4)), Number(first.slice(4, 6)) - 1, Number(first.slice(6, 8)));
  for (let key = first; key <= last; ) {
    out.push(key);
    t += DAY_MS;
    key = utcDateKey(t);
  }
  return out;
}

/** Today's Pacific date, YYYY-MM-DD. */
export function todayPt(nowMs: number): string {
  return ptParts(nowMs).date;
}

// ─── months ──────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** True for YYYY-MM with a real month. */
export function isMonthKey(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 && Number(m[1]) >= 2000;
}

/** "2026-11" → "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** First and last Pacific dates of a month, YYYY-MM-DD. */
export function monthBounds(month: string): { first: string; last: string; days: number } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}`, days };
}
