// History mode for /radar and the plane page. Pure and client-safe: no
// window, no MapLibre, no KV. (lib/pt-range.ts pulls lib/flights.ts and
// the KV cache in through lib/rollup-core.ts, so the few date helpers
// this needs are re-implemented here on plain UTC arithmetic.)
//
// Owns:
//   - URL state  ?h=1&from=YYYY-MM-DD&to=YYYY-MM-DD&tail=A,B&mission=police
//   - period presets (Last 7 days, Last 30 days, each month on record)
//     resolved to Pacific date ranges, floored at HISTORY_FLOOR
//   - per-tail line colours (cool, low saturation, never warm)
//   - copy: range labels, the summary chip, the flight mini card
//
// Data contract: GET /api/history (lib/history-core.ts HistoryBody).

import type { HistoryBody, HistoryPolyline, HistorySession, PolyVertex } from "./history-core";
import {
  DEFAULT_MISSIONS,
  MISSIONS,
  formatMissionsParam,
  normalizeMissionList,
  parseMissionsParam,
} from "./mission";
import { missionLabel } from "./role-display";
import { DEFAULT_PALETTE, PALETTES, assignPaletteTailColors, type RadarPalette } from "./radar-palettes";
import type { Mission } from "./types";
import { DATA_SINCE_FALLBACK } from "./data-since-core";

/**
 * First Pacific date with stored track history: the static fallback of
 * the data-since value (lib/data-since.ts). Server pages pass the live
 * value through as `floor`; this default is the same date.
 */
export const HISTORY_FLOOR = DATA_SINCE_FALLBACK;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-16" -> "16 Oct 2026", the brand's date style. Input echoed
 *  back when it is not a YYYY-MM-DD date. */
export function formatDayMonYear(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  const mon = m ? MONTH_SHORT[Number(m[2]) - 1] : undefined;
  if (!m || !mon) return ymd;
  return `${Number(m[3])} ${mon} ${m[1]}`;
}

/** Longest range the API serves (lib/history-core.ts MAX_RANGE_DAYS). */
export const HISTORY_MAX_DAYS = 366;
/** Most tails one request may name (lib/history-core.ts MAX_TAILS). */
export const HISTORY_MAX_TAILS = 32;
/** Per-tail colours apply up to this many tails; past it, one colour. */
export const PER_TAIL_COLOR_MAX = 6;

const PT_TZ = "America/Los_Angeles";
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const TAIL_RE = /^[A-Z0-9-]{2,10}$/;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ─── dates ───────────────────────────────────────────────────────────

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Shift a YYYY-MM-DD date by n calendar days. */
export function shiftDate(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive day count from `from` to `to`. */
export function rangeDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS) + 1;
}

/** Pacific calendar date of an instant, YYYY-MM-DD. */
export function ptDate(ms: number): string {
  // sv-SE renders ISO order regardless of the viewer's locale.
  return new Date(ms).toLocaleDateString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: PT_TZ,
  });
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}
function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

function monthFirstLast(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, "0")}` };
}

/** "2026-11" → "November 2026". */
export function monthLongLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "2026-11" → "Nov 2026". */
export function monthShortLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

// ─── presets ─────────────────────────────────────────────────────────

export type HistoryPreset = "last7" | "last30" | `month:${string}`;

export type DateRange = { from: string; to: string };

export function isHistoryPreset(v: unknown): v is HistoryPreset {
  if (v === "last7" || v === "last30") return true;
  return typeof v === "string" && v.startsWith("month:") && MONTH_RE.test(v.slice(6));
}

/**
 * Months that can hold history, newest first: every calendar month from
 * HISTORY_FLOOR's month through today's. Capture has run continuously
 * since the floor, so each of these has data.
 */
export function historyMonths(today: string, floor = HISTORY_FLOOR): string[] {
  if (!isIsoDate(today) || today < floor) return [];
  const out: string[] = [];
  let [y, m] = today.slice(0, 7).split("-").map(Number) as [number, number];
  const stop = floor.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key < stop) break;
    out.push(key);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Presets the sheet offers, in display order. */
export function historyPresets(today: string, floor = HISTORY_FLOOR): { id: HistoryPreset; label: string }[] {
  return [
    { id: "last7", label: "Last 7 days" },
    { id: "last30", label: "Last 30 days" },
    ...historyMonths(today, floor).map((m) => ({ id: `month:${m}` as HistoryPreset, label: monthLongLabel(m) })),
  ];
}

/**
 * A preset → Pacific date range [from, to], inclusive. Rolling presets
 * always span their full 7 or 30 days ending today (days before the
 * record simply hold nothing, and the label stays true); a month runs 1st
 * through last day, clipped to the floor and to today. null when the
 * preset covers no day on record.
 */
export function resolvePreset(
  preset: HistoryPreset,
  today: string,
  floor = HISTORY_FLOOR,
): DateRange | null {
  if (!isIsoDate(today) || today < floor) return null;
  if (preset === "last7" || preset === "last30") {
    const span = preset === "last7" ? 7 : 30;
    return { from: shiftDate(today, -(span - 1)), to: today };
  }
  const month = preset.slice(6);
  if (!MONTH_RE.test(month)) return null;
  const mo = Number(month.slice(5, 7));
  if (mo < 1 || mo > 12) return null;
  const { first, last } = monthFirstLast(month);
  const from = maxDate(first, floor);
  const to = minDate(last, today);
  return from <= to ? { from, to } : null;
}

/** The preset a range matches exactly today, if any. */
export function presetForRange(
  range: DateRange,
  today: string,
  floor = HISTORY_FLOOR,
): HistoryPreset | null {
  for (const { id } of historyPresets(today, floor)) {
    const r = resolvePreset(id, today, floor);
    if (r && r.from === range.from && r.to === range.to) return id;
  }
  return null;
}

/**
 * Validate and clamp a custom range: real dates, floor ≤ from ≤ to ≤
 * today, at most HISTORY_MAX_DAYS. A reversed pair is swapped. null when
 * a date is missing or malformed.
 */
export function clampRange(
  from: unknown,
  to: unknown,
  today: string,
  floor = HISTORY_FLOOR,
): DateRange | null {
  if (!isIsoDate(from) || !isIsoDate(to) || !isIsoDate(today)) return null;
  let a = from <= to ? from : to;
  let b = from <= to ? to : from;
  a = maxDate(a, floor);
  b = minDate(b, today);
  if (a > b) {
    // Entirely before the floor or after today: snap to the nearest edge.
    if (b < floor) b = a;
    else a = b;
  }
  if (rangeDays(a, b) > HISTORY_MAX_DAYS) a = shiftDate(b, -(HISTORY_MAX_DAYS - 1));
  return { from: a, to: b };
}

// ─── state + URL ─────────────────────────────────────────────────────

export type HistoryState = {
  from: string;
  to: string;
  /** Explicit tails, uppercased, sorted. Empty = any aircraft. */
  tails: string[];
  /** Mission chips. Ignored by the API query when tails are picked. */
  missions: Mission[];
};

const URL_KEYS = ["h", "from", "to", "tail", "mission"] as const;

function isDefaultMissions(m: readonly Mission[]): boolean {
  return m.length === DEFAULT_MISSIONS.length && DEFAULT_MISSIONS.every((x) => m.includes(x));
}

export function normalizeTails(raw: readonly string[]): string[] {
  const set = new Set<string>();
  for (const r of raw) {
    for (const part of r.split(",")) {
      const t = part.trim().toUpperCase();
      if (TAIL_RE.test(t)) set.add(t);
    }
  }
  return [...set].sort().slice(0, HISTORY_MAX_TAILS);
}

/**
 * `?h=1&from=&to=&tail=&mission=` → state, or null when history mode is
 * off (no `h=1`). A missing or bad range falls back to Last 7 days; a
 * range outside the record is clamped. Mission missing → Smokey default.
 */
export function parseHistoryParams(params: URLSearchParams, today: string): HistoryState | null {
  if (params.get("h") !== "1") return null;
  const range =
    clampRange(params.get("from"), params.get("to"), today) ??
    resolvePreset("last7", today) ??
    { from: today, to: today };
  const tails = normalizeTails(params.getAll("tail"));
  const missions = parseMissionsParam(params.get("mission"));
  return { from: range.from, to: range.to, tails, missions };
}

/**
 * State → search params. Keeps unrelated params (e.g. `mock`), rewrites
 * the history keys. The default mission (Smokey) is left implicit so the
 * common link stays short; parseHistoryParams reads it back the same.
 */
export function serializeHistoryParams(state: HistoryState, base?: URLSearchParams): URLSearchParams {
  const p = clearHistoryParams(base);
  p.set("h", "1");
  p.set("from", state.from);
  p.set("to", state.to);
  if (state.tails.length > 0) p.set("tail", state.tails.join(","));
  if (!isDefaultMissions(state.missions)) p.set("mission", formatMissionsParam(state.missions));
  return p;
}

/** Remove every history key, keeping the rest. */
export function clearHistoryParams(base?: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(base ? base.toString() : "");
  for (const k of URL_KEYS) p.delete(k);
  return p;
}

/**
 * State → /api/history query string. Picked tails win over missions (a
 * rider who names a plane wants that plane whatever its class), so the
 * mission filter is only sent for "any aircraft".
 */
export function historyApiQuery(state: HistoryState): string {
  const p = new URLSearchParams();
  p.set("from", state.from);
  p.set("to", state.to);
  if (state.tails.length > 0) {
    p.set("tail", state.tails.join(","));
  } else {
    const list = normalizeMissionList(state.missions);
    if (list.length > 0 && list.length < MISSIONS.length) p.set("mission", list.join(","));
  }
  return p.toString();
}

export function sameHistoryState(a: HistoryState | null, b: HistoryState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.tails.join(",") === b.tails.join(",") &&
    formatMissionsParam(a.missions) === formatMissionsParam(b.missions)
  );
}

// ─── colours ─────────────────────────────────────────────────────────

/**
 * Per-tail history line colours come from the rider's radar palette
 * (lib/radar-palettes.ts): six distinct colours that stay out of that
 * palette's heat hues and away from alert orange, all-clear green and
 * the rider's sky-blue dot. These two constants are the default (Ember)
 * set, kept for callers that have no palette in hand.
 */
export const HISTORY_TAIL_PALETTE = PALETTES[DEFAULT_PALETTE].history.tails;

/** One colour for every line once more than PER_TAIL_COLOR_MAX tails show. */
export const HISTORY_SINGLE_COLOR = PALETTES[DEFAULT_PALETTE].history.many;

/**
 * Tail → line colour. Tails are de-duped and sorted so the mapping is
 * stable across reloads and shared links. Six or fewer → one palette slot
 * each; more → all the palette's "many" colour (a legend of 20
 * near-identical colours helps nobody).
 */
export function assignTailColors(
  tails: readonly string[],
  palette: RadarPalette = PALETTES[DEFAULT_PALETTE],
): Record<string, string> {
  return assignPaletteTailColors(palette, tails, PER_TAIL_COLOR_MAX);
}

/** Hue in degrees (0-360) of a #rrggbb colour; null for greys. */
export function hexHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return (h * 60 + 360) % 360;
}

/** Red through yellow (0-70 degrees) or magenta-red (≥ 330). */
export function isWarmHex(hex: string): boolean {
  const h = hexHue(hex);
  return h !== null && (h <= 70 || h >= 330);
}

// ─── copy ────────────────────────────────────────────────────────────

function shortDay(iso: string): { mon: string; day: number; year: number } {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return { mon: MONTHS_SHORT[m - 1]!, day: d, year: y };
}

/**
 * Banner / chip label for a range:
 *   a whole month on record      "Nov 2026"
 *   the rolling presets          "Last 7 days" / "Last 30 days"
 *   one day                      "Nov 17"
 *   same month                   "Nov 3–17"
 *   across months                "Oct 20–Nov 5"
 *   across years                 "Dec 20 2026–Jan 4 2027"
 */
export function rangeLabel(range: DateRange, today: string, floor = HISTORY_FLOOR): string {
  const preset = presetForRange(range, today, floor);
  if (preset === "last7") return "Last 7 days";
  if (preset === "last30") return "Last 30 days";
  if (preset) return monthShortLabel(preset.slice(6));
  const a = shortDay(range.from);
  const b = shortDay(range.to);
  if (range.from === range.to) return `${a.mon} ${a.day}`;
  if (a.year !== b.year) return `${a.mon} ${a.day} ${a.year}–${b.mon} ${b.day} ${b.year}`;
  if (a.mon === b.mon) return `${a.mon} ${a.day}–${b.day}`;
  return `${a.mon} ${a.day}–${b.mon} ${b.day}`;
}

/** Who the overlay covers: a tail, a tail count, or the mission set. */
export function historySubject(state: Pick<HistoryState, "tails" | "missions">): string {
  if (state.tails.length === 1) return state.tails[0]!;
  if (state.tails.length > 1) return `${state.tails.length} tails`;
  const list = normalizeMissionList(state.missions);
  if (list.length === 0 || list.length === MISSIONS.length) return "All aircraft";
  if (list.length <= 2) return list.map((m) => missionLabel(m)).join(" + ");
  return `${list.length} missions`;
}

/** Airborne seconds → "19.1 h". */
export function formatHours(seconds: number): string {
  const h = Math.max(0, seconds) / 3600;
  return `${h.toFixed(1)} h`;
}

/** "N305DK · Nov 2026 · 14 flights · 19.1 h" */
export function formatSummaryChip(input: {
  subject: string;
  range: string;
  flights: number;
  airborne_s: number;
}): string {
  const flights = `${input.flights} ${input.flights === 1 ? "flight" : "flights"}`;
  return [input.subject, input.range, flights, formatHours(input.airborne_s)].join(" · ");
}

/** Pacific wall-clock parts of an instant. */
function ptClock(ms: number): { date: string; hhmm: string; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const dow = WEEKDAYS.indexOf(get("weekday") as (typeof WEEKDAYS)[number]);
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hhmm: `${get("hour")}:${get("minute")}`,
    dow: dow < 0 ? 0 : dow,
  };
}

/** "47m" / "1h 48m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export type FlightCardText = {
  tail: string;
  nickname: string | null;
  /** "Wed 11 Nov 2026" */
  date: string;
  /** "21:19–21:27 PT" (24-hour Pacific) */
  time: string;
  duration: string;
  /** "3,700′" or "—" */
  maxAlt: string;
  href: string;
};

/** Mini-card copy for a tapped history line. */
export function flightCardText(s: Pick<
  HistorySession,
  "tail" | "nickname" | "id" | "start_ts" | "end_ts" | "duration_s" | "max_alt_ft"
>): FlightCardText {
  const a = ptClock(s.start_ts);
  const b = ptClock(s.end_ts);
  const d = shortDay(a.date);
  return {
    tail: s.tail,
    nickname: s.nickname,
    date: `${WEEKDAYS[a.dow]} ${d.day} ${d.mon} ${d.year}`,
    time: `${a.hhmm}–${b.hhmm} PT`,
    duration: formatDuration(s.duration_s),
    maxAlt: s.max_alt_ft > 0 ? `${s.max_alt_ft.toLocaleString("en-US")}′` : "—",
    href: `/flight/${encodeURIComponent(s.tail)}/${encodeURIComponent(s.id)}`,
  };
}

// ─── geometry ────────────────────────────────────────────────────────

export type HistoryLineProps = { id: string; tail: string; color: string };

/** Polylines → one GeoJSON FeatureCollection for a single line source. */
export function polylinesToGeoJSON(
  polylines: readonly HistoryPolyline[],
  colors: Record<string, string>,
): GeoJSON.FeatureCollection<GeoJSON.LineString, HistoryLineProps> {
  const features: GeoJSON.Feature<GeoJSON.LineString, HistoryLineProps>[] = [];
  for (const p of polylines) {
    if (p.points.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: p.points.map((v) => [v[1], v[0]]) },
      properties: { id: p.id, tail: p.tail, color: colors[p.tail] ?? HISTORY_SINGLE_COLOR },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Heat cells → point FeatureCollection for the heatmap source. */
export function heatToGeoJSON(
  cells: HistoryBody["heat"]["cells"],
): GeoJSON.FeatureCollection<GeoJSON.Point, { count: number }> {
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      properties: { count: c.count },
    })),
  };
}

/** [west, south, east, north] of every vertex, or null when empty. */
export function polylineExtent(
  polylines: readonly HistoryPolyline[],
): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of polylines) {
    for (const [lat, lon] of p.points) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  return w === Infinity ? null : [w, s, e, n];
}

// ─── 3D hook ─────────────────────────────────────────────────────────

/**
 * Point shape handed to the 3D view: components/Flight3D.tsx takes
 * TrackPoint (lib/track-point.ts), whose capture fields are all optional.
 * The history payload carries no speed or track, so those are null.
 */
export type Flight3DPoint = {
  lat: number;
  lon: number;
  alt: number | null;
  spd: number | null;
  trk: number | null;
  ts: number;
};
export type Flight3DPath = { id: string; points: Flight3DPoint[]; color?: string };

/**
 * Props adapter for components/Flight3D.tsx (`paths: {id, points,
 * color?}[]`). Ids are the flight ids; lib/history-3d.ts historyPaths3D
 * re-keys them by tail and applies the 3D colour rules.
 */
export function historyToFlight3DPaths(
  polylines: readonly HistoryPolyline[],
  colors: Record<string, string>,
): Flight3DPath[] {
  return polylines
    .filter((p) => p.points.length >= 2)
    .map((p) => ({
      id: p.id,
      color: colors[p.tail] ?? HISTORY_SINGLE_COLOR,
      points: p.points.map((v: PolyVertex) => ({ lat: v[0], lon: v[1], alt: v[2], spd: null, trk: null, ts: v[3] })),
    }));
}

// ─── fetch status ────────────────────────────────────────────────────

export type HistoryFetchError = "too_large" | "bad_request" | "failed";

/** Rider-facing copy for each non-data state. */
export const HISTORY_COPY = {
  loading: "Pulling the logbook",
  empty: "No flights in this range",
  too_large: "Too much to draw. Narrow the range or pick a plane.",
  bad_request: "That range does not work. Pick dates on record.",
  failed: "History did not load. Try again.",
} as const;

/** HTTP status → error kind (200 is data, not an error). */
export function historyErrorForStatus(status: number): HistoryFetchError {
  if (status === 413) return "too_large";
  if (status === 400) return "bad_request";
  return "failed";
}
