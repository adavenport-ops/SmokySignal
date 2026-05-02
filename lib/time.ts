// Canonical time-display formatter. One source of truth so per-page
// helpers don't drift on tz, format, or 24-hour invariants.
//
// Defaults to the rider's browser tz. Pattern surfaces (forecast grid,
// prediction windows) and OG images call formatTsPacific instead — they
// describe PT-anchored aircraft patterns or render for unknown viewers.
//
// Brand voice (design/BRAND.md §3): 24-hour clock, mono numerics, no AM/PM.

export const PT_TZ = "America/Los_Angeles";

/** Browser tz, or PT on SSR (client re-renders correct it via LocalTime). */
export function getViewerTz(): string {
  if (typeof window === "undefined") return PT_TZ;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || PT_TZ;
  } catch {
    return PT_TZ;
  }
}

export type FormatStyle =
  | "time"
  | "time-sec"
  | "date"
  | "date-short"
  | "date-weekday"
  | "datetime"
  | "hour-min"
  | "iso-utc";

export function formatTs(
  tsMs: number | null | undefined,
  style: FormatStyle,
  opts?: { tz?: string },
): string {
  if (tsMs == null || Number.isNaN(tsMs)) return "—";
  const tz = opts?.tz ?? getViewerTz();
  const d = new Date(tsMs);
  switch (style) {
    case "time":
    case "hour-min":
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
      });
    case "time-sec":
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: tz,
      });
    case "date":
      // sv-SE forces ISO-style YYYY-MM-DD regardless of viewer locale.
      return d.toLocaleDateString("sv-SE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: tz,
      });
    case "date-short":
      return d.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        timeZone: tz,
      });
    case "date-weekday":
      return d.toLocaleDateString([], {
        weekday: "long",
        timeZone: tz,
      });
    case "datetime": {
      const date = formatTs(tsMs, "date", opts);
      const time = formatTs(tsMs, "time", opts);
      return `${date} ${time}`;
    }
    case "iso-utc":
      return d.toISOString();
  }
}

/** Force PT regardless of viewer. Forecast/prediction patterns + OG images. */
export function formatTsPacific(tsMs: number, style: FormatStyle): string {
  return formatTs(tsMs, style, { tz: PT_TZ });
}

/**
 * Pacific-anchored "now" hour-of-week. Used by the forecast grid to
 * highlight the current cell.
 */
export function pacificNow(): { dow: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  let hourStr: string | null = null;
  let weekdayStr: string | null = null;
  for (const p of parts) {
    if (p.type === "hour") hourStr = p.value;
    if (p.type === "weekday") weekdayStr = p.value;
  }
  const hour = Number(hourStr ?? 0) % 24;
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = weekdayStr ? (dowMap[weekdayStr] ?? 0) : 0;
  return { dow, hour };
}

/** "Just now" / "Xm ago" / "Xh ago" / "Xd ago" — tz-agnostic. */
export function fmtAgo(min: number | null | undefined): string {
  if (min == null || Number.isNaN(min) || min <= 0) return "a while";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

/** Same as fmtAgo, but takes an absolute timestamp instead of pre-computed minutes. */
export function fmtAgoTs(tsMs: number | null | undefined): string {
  if (tsMs == null || Number.isNaN(tsMs)) return "a while";
  const sec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (sec < 60) return "just now";
  return fmtAgo(Math.floor(sec / 60));
}

/** "Today" / "Yesterday" / weekday / short date — tz-aware. */
export function fmtRelativeDay(tsMs: number, opts?: { tz?: string }): string {
  const tz = opts?.tz ?? getViewerTz();
  const target = new Date(tsMs);
  const now = new Date();
  const dayKey = (d: Date) =>
    d.toLocaleDateString("sv-SE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    });
  const targetDay = dayKey(target);
  const todayDay = dayKey(now);
  const yestDay = dayKey(new Date(now.getTime() - 86_400_000));
  if (targetDay === todayDay) return "Today";
  if (targetDay === yestDay) return "Yesterday";
  const daysApart = Math.abs(now.getTime() - target.getTime()) / 86_400_000;
  if (daysApart < 7) return formatTs(tsMs, "date-weekday", opts);
  return formatTs(tsMs, "date-short", opts);
}

/** "MM:SS" or "HH:MM:SS" — clock-style duration for precision contexts. */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h === 0) {
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** "47m" / "3h 45m" — human-readable duration for narrative contexts. */
export function fmtDurationHuman(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** "47m aloft" / "3h 12m aloft" — tz-agnostic. */
export function fmtAloft(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${min}m aloft`;
  return `${Math.floor(min / 60)}h ${min % 60}m aloft`;
}
