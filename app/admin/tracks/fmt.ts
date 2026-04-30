// Display helpers shared between the tracks pages.

export function fmtAgoFromTs(tsSec: number | null | undefined): string | null {
  if (tsSec == null) return null;
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

/** Format a unix-seconds timestamp in viewer's local time. */
export function fmtLocalTime(tsSec: number | null | undefined): string {
  if (tsSec == null) return "—";
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtLocalDateTime(tsSec: number | null | undefined): string {
  if (tsSec == null) return "—";
  return new Date(tsSec * 1000).toLocaleString();
}

export function fmtDuration(spanSec: number): string {
  const s = Math.max(0, Math.floor(spanSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** m/s → mph helper. KV stores spd in knots (we wrote ground_speed_kt) — */
/** but the value we end up storing in TrackPoint.spd is whatever logTracks */
/** captured (ground_speed_kt). Convert kt → mph for display. */
export function ktToMph(kt: number | null): number | null {
  if (kt == null) return null;
  return kt * 1.150779;
}
