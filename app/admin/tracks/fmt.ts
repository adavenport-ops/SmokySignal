// Display helpers shared between the tracks pages. Time-format helpers
// take unix SECONDS (matching how TrackPoint stores ts); they wrap the
// canonical lib/time helpers, which take milliseconds.

import { fmtAgoTs, fmtDuration as fmtDurationMs, formatTs } from "@/lib/time";

export function fmtAgoFromTs(tsSec: number | null | undefined): string | null {
  if (tsSec == null) return null;
  const ago = fmtAgoTs(tsSec * 1000);
  return ago === "a while" ? null : ago;
}

/** YYYYMMDD → "Today" / "Yesterday" / "YYYY-MM-DD" (UTC-based key). */
export function humanDate(date: string): string {
  if (!/^\d{8}$/.test(date)) return date;
  const today = utcDateKey(new Date());
  const y = new Date(Date.now() - 86_400_000);
  const yesterday = utcDateKey(y);
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

export function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function fmtLocalTime(tsSec: number | null | undefined): string {
  if (tsSec == null) return "—";
  return formatTs(tsSec * 1000, "time-sec");
}

export function fmtLocalDateTime(tsSec: number | null | undefined): string {
  if (tsSec == null) return "—";
  return formatTs(tsSec * 1000, "datetime");
}

export function fmtDuration(spanSec: number): string {
  return fmtDurationMs(spanSec);
}

/** m/s → mph helper. KV stores spd in knots (we wrote ground_speed_kt) — */
/** but the value we end up storing in TrackPoint.spd is whatever logTracks */
/** captured (ground_speed_kt). Convert kt → mph for display. */
export function ktToMph(kt: number | null): number | null {
  if (kt == null) return null;
  return kt * 1.150779;
}
