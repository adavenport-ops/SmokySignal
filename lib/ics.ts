// iCalendar (RFC 5545) builder for /calendar.ics. Pure: no KV, no fetch,
// no Date.now() inside the builders (callers pass `now`), so
// lib/ics.test.ts can pin folding, escaping and time zone output.
//
// The feed carries "busy windows": the Pacific-time hours with the
// highest historical takeoff likelihood, taken from the forecast grid.
// It is history, never a promise. Text never calls any hour safe.

import { PT_TZ } from "./time";
import type { ForecastCell, ForecastGrid } from "./predictor";
import { SITE_URL } from "./seo/site";

const CRLF = "\r\n";

/** Escape a TEXT value (RFC 5545 3.3.11). Backslash first. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line at 75 octets (RFC 5545 3.1). Continuation lines
 * start with one space, which counts toward their 75. Never splits a
 * UTF-8 multi-byte character.
 */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // the leading space of a continuation line takes one octet
    }
    cur += ch;
    curBytes += n;
  }
  if (cur) out.push(cur);
  return out.join(CRLF + " ");
}

/** "20261124T130000": wall-clock digits with no zone marker. */
export function icsLocal(y: number, m: number, d: number, hour: number): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(y, 4)}${p(m)}${p(d)}T${p(hour)}0000`;
}

/** "20261124T210000Z" for DTSTAMP. */
export function icsUtc(tsMs: number): string {
  return new Date(tsMs).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * VTIMEZONE for America/Los_Angeles with the current US rules (second
 * Sunday of March, first Sunday of November, in force since 2007).
 */
export const VTIMEZONE_LA: readonly string[] = [
  "BEGIN:VTIMEZONE",
  `TZID:${PT_TZ}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "TZNAME:PDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "TZNAME:PST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export type IcsEvent = {
  uid: string;
  /** Wall-clock start in America/Los_Angeles, already formatted. */
  startLocal: string;
  endLocal: string;
  summary: string;
  description?: string;
};

export type IcsCalendar = {
  name: string;
  description?: string;
  events: IcsEvent[];
  /** ms since epoch; stamped on every event. */
  now: number;
};

/** Assemble the full VCALENDAR text, CRLF line endings, folded. */
export function buildIcs(cal: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SmokySignal//Busy windows//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(cal.name)}`,
    `X-WR-TIMEZONE:${PT_TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  if (cal.description) {
    lines.push(`X-WR-CALDESC:${escapeIcsText(cal.description)}`);
  }
  lines.push(...VTIMEZONE_LA);
  const stamp = icsUtc(cal.now);
  for (const e of cal.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${PT_TZ}:${e.startLocal}`,
      `DTEND;TZID=${PT_TZ}:${e.endLocal}`,
      `SUMMARY:${escapeIcsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    // Transparent: these never block a rider's own availability.
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

// ─── busy windows ──────────────────────────────────────────────────────────

export type BusyWindow = {
  dow: number;
  startHour: number;
  /** Exclusive end hour, 1..24. */
  endHour: number;
  /** Takeoffs logged inside the window across all weeks seen. */
  samples: number;
};

/** Below this many logged takeoffs the feed stays empty rather than guess. */
export const MIN_TOTAL_EVENTS = 30;
/** An hour needs at least this many logged takeoffs to count. */
export const MIN_HOUR_SAMPLES = 2;
/** An hour counts when its likelihood is at least this share of the peak. */
export const PEAK_SHARE = 0.6;
/** At most this many windows per day. */
export const MAX_WINDOWS_PER_DAY = 2;
export const HORIZON_DAYS = 14;

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Busy windows per day-of-week from the forecast grid. Picks the hours
 * whose historical takeoff likelihood sits near that weekday's peak,
 * merges consecutive hours, keeps the strongest MAX_WINDOWS_PER_DAY.
 */
export function busyWindowsByDow(grid: ForecastGrid): BusyWindow[][] {
  const out: BusyWindow[][] = [[], [], [], [], [], [], []];
  if (grid.total_events < MIN_TOTAL_EVENTS) return out;
  for (let dow = 0; dow < 7; dow++) {
    const cells: ForecastCell[] = grid.cells
      .filter((c) => c.dow === dow)
      .sort((a, b) => a.hour - b.hour);
    const peak = cells.reduce((m, c) => Math.max(m, c.probability), 0);
    if (peak <= 0) continue;
    const hot = cells.filter(
      (c) => c.sample_count >= MIN_HOUR_SAMPLES && c.probability >= peak * PEAK_SHARE,
    );
    const wins: BusyWindow[] = [];
    for (const c of hot) {
      const last = wins[wins.length - 1];
      if (last && last.endHour === c.hour) {
        last.endHour = c.hour + 1;
        last.samples += c.sample_count;
      } else {
        wins.push({ dow, startHour: c.hour, endHour: c.hour + 1, samples: c.sample_count });
      }
    }
    wins.sort((a, b) => b.samples - a.samples);
    out[dow] = wins
      .slice(0, MAX_WINDOWS_PER_DAY)
      .sort((a, b) => a.startHour - b.startHour);
  }
  return out;
}

/** Pacific calendar date (y, m, d) of an instant. */
export function pacificDate(tsMs: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(tsMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const hh = (n: number) => String(n).padStart(2, "0");

/** "Smokey often up · Tue 13:00–15:00" (24-hour, Pacific). */
export function busySummary(dow: number, startHour: number, endHour: number): string {
  return `Smokey often up · ${DOW_NAMES[dow]} ${hh(startHour)}:00–${hh(endHour % 24)}:00`;
}

/**
 * Expand the weekly windows onto the next `days` Pacific dates, starting
 * with today. Dates walk on the calendar (UTC arithmetic on y/m/d), so
 * DST changes never shift a window; the TZID on each event does the
 * zone work.
 */
export function busyEvents(
  grid: ForecastGrid,
  now: number,
  days = HORIZON_DAYS,
): IcsEvent[] {
  const byDow = busyWindowsByDow(grid);
  const start = pacificDate(now);
  const events: IcsEvent[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const dow = day.getUTCDay();
    for (const w of byDow[dow] ?? []) {
      // A window ending at midnight rolls to the next date.
      const endDay = w.endHour >= 24 ? new Date(Date.UTC(y, m - 1, d + 1)) : day;
      events.push({
        uid: `busy-${y}${hh(m)}${hh(d)}-${hh(w.startHour)}@smokysignal.app`,
        startLocal: icsLocal(y, m, d, w.startHour),
        endLocal: icsLocal(
          endDay.getUTCFullYear(),
          endDay.getUTCMonth() + 1,
          endDay.getUTCDate(),
          w.endHour % 24,
        ),
        summary: busySummary(dow, w.startHour, w.endHour),
        description:
          `History, not a forecast of any one day. ${w.samples} takeoffs logged in this window on past ${DOW_NAMES[dow]}s. ` +
          `Smokey can be up at any hour. No hour is a safe one. Live status: ${SITE_URL}`,
      });
    }
  }
  return events;
}

export const CALENDAR_NAME = "SmokySignal busy windows";
export const CALENDAR_DESCRIPTION =
  "Hours when Smokey has most often been up, drawn from logged takeoffs. History, not a prediction. Times are Pacific.";

export function buildBusyCalendar(grid: ForecastGrid, now: number): string {
  return buildIcs({
    name: CALENDAR_NAME,
    description: CALENDAR_DESCRIPTION,
    events: busyEvents(grid, now),
    now,
  });
}
