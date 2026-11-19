// "Data since": the first Pacific date with stored track points. One
// value, used everywhere a page says how far back the record goes or
// floors a date picker (history presets and custom range, /seen, /stats,
// /wrap, /data, llms.txt facts, the forecast month list).
//
// Pure and client-safe. The IO half (KV cache at meta:data_since,
// recomputed by the rollup cron) is lib/data-since.ts.
//
// Tracks are permanent since 2026-11-18 (#149), so the value can only
// move earlier, never later.

/**
 * Fallback when KV is absent or not yet computed. The earliest stored
 * point is 2026-10-15T01:00:36Z (Smokey 4), which is 2026-10-14 18:00 PT.
 */
export const DATA_SINCE_FALLBACK = "2026-10-14";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_KEY_RE = /^\d{8}$/;

const PT_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** True for a YYYY-MM-DD string that is a real calendar date. */
export function isDataSinceDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** A stored value if it is a real date, else the fallback. */
export function resolveDataSince(stored: unknown): string {
  const v = typeof stored === "number" ? String(stored) : stored;
  return isDataSinceDate(v) ? v : DATA_SINCE_FALLBACK;
}

/**
 * Track keys look like `tracks:{tail}:{YYYYMMDD}` (optionally region
 * prefixed). The earliest UTC day across all of them, or null.
 */
export function earliestTrackDay(keys: ReadonlyArray<string>): string | null {
  let min: string | null = null;
  for (const k of keys) {
    const day = k.slice(k.lastIndexOf(":") + 1);
    if (!DAY_KEY_RE.test(day)) continue;
    if (min === null || day < min) min = day;
  }
  return min;
}

/** Every distinct UTC day across track keys, oldest first. */
export function trackDays(keys: ReadonlyArray<string>): string[] {
  const days = new Set<string>();
  for (const k of keys) {
    const day = k.slice(k.lastIndexOf(":") + 1);
    if (DAY_KEY_RE.test(day)) days.add(day);
  }
  return [...days].sort();
}

/** Pacific calendar date (YYYY-MM-DD) of an instant in ms. */
export function ptDateOf(tsMs: number): string {
  return PT_DATE_FMT.format(new Date(tsMs));
}

/**
 * Data since from the earliest UTC track day and the earliest point
 * timestamp (seconds) found in it. Without a point, the UTC day's start
 * in Pacific time (the evening before) is the conservative answer.
 */
export function dataSinceFrom(earliestDay: string | null, earliestPointTsSec: number | null): string {
  if (typeof earliestPointTsSec === "number" && Number.isFinite(earliestPointTsSec)) {
    return ptDateOf(earliestPointTsSec * 1000);
  }
  if (!earliestDay || !DAY_KEY_RE.test(earliestDay)) return DATA_SINCE_FALLBACK;
  const y = Number(earliestDay.slice(0, 4));
  const m = Number(earliestDay.slice(4, 6));
  const d = Number(earliestDay.slice(6, 8));
  return ptDateOf(Date.UTC(y, m - 1, d));
}

/** "2026-10-14" → "Oct 14 2026" for prose. */
export function dataSinceLabel(date: string): string {
  if (!isDataSinceDate(date)) return date;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${mon} ${d} ${y}`;
}
