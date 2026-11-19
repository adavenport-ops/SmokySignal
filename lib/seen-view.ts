// "Was that the plane I saw?" (/seen). Client-safe half: constants, the
// response contract, Pacific date/time arithmetic, URL state and every
// rider-facing string. No KV, no node:*, nothing that pulls lib/flights.ts
// into a client bundle (lib/pt-range.ts does, via lib/rollup-core.ts, so
// the PT helpers here are re-implemented on Intl).
//
// The server half (query validation, closest approach, the result fold)
// is lib/seen-core.ts; the IO is lib/seen.ts; the route is /api/seen.
//
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks, and a
// result is what flew, never a statement that a place or time was clear.

import { compass8 } from "./geo";
import { HISTORY_FLOOR } from "./history-view";
import { PLACES } from "./places";
import { REGIONS } from "./regions";
import { formatTsBare } from "./time";
import type { Mission } from "./types";

export const SEEN_VERSION = 1 as const;

/** First Pacific date with permanent track history (same floor as /radar history). */
export const SEEN_EARLIEST_DATE = HISTORY_FLOOR;

/** ± minutes around the time the rider saw it. */
export const WINDOW_CHOICES = [15, 30, 60] as const;
export type WindowMin = (typeof WINDOW_CHOICES)[number];
export const DEFAULT_WINDOW_MIN: WindowMin = 30;

/** Radius choices on the page, statute miles. */
export const RADIUS_MI_CHOICES = [3, 5, 10] as const;
export type RadiusMi = (typeof RADIUS_MI_CHOICES)[number];
export const DEFAULT_RADIUS_MI: RadiusMi = 5;

/** API radius bounds, nautical miles. */
export const MIN_RADIUS_NM = 0.5;
export const MAX_RADIUS_NM = 10;

export const NM_PER_MI = 0.868976;

/** Decimals rider coordinates are rounded to before they leave the browser. */
export const COORD_DECIMALS = 2;

const PT_TZ = "America/Los_Angeles";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ─── response contract (GET /api/seen) ───────────────────────────────

/** [lat, lon, baro alt ft | null, unix seconds] */
export type SeenVertex = [number, number, number | null, number];

export type SeenStatus = "ok" | "before_data" | "future";

export type SeenItem = {
  tail: string;
  /** Nickname when there is one ("Smokey 3"), else the tail. */
  name: string;
  nickname: string | null;
  operator: string;
  /** "Cessna 206H Stationair with a FLIR camera". */
  airframe: string;
  mission: Mission;
  /** "Smokey", "Wildfire", "Federal". */
  mission_label: string;
  /** "SMOKEY", "WILDFIRE". */
  mission_badge: string;
  /** Counts toward "Smokey's up" (police, in WA airspace). */
  smokey: boolean;
  closest: {
    /** ms */
    ts: number;
    lat: number;
    lon: number;
    alt_ft: number | null;
    distance_nm: number;
    distance_mi: number;
    /** From the rider's (rounded) point to the aircraft, degrees, 0 = north. */
    bearing_deg: number;
    /** "north", "southwest". */
    direction: string;
  };
  /** Was it working a pattern within 10 min of the closest approach. */
  pattern: { working: boolean; over: string | null };
  /** Road the closest approach sat on (within 2 nm), e.g. "SR-512 · Puyallup". */
  corridor: { id: string; name: string; label: string } | null;
  /** Nearest named place to the closest approach. */
  near: string | null;
  /** Field it took off from this flight, else the registry home base. */
  departure: { id: string; name: string; from_takeoff: boolean } | null;
  /** /flight/{tail}/{id}; null when the flight is too short to have a page. */
  flight: { id: string; href: string } | null;
  /** The aircraft's track inside the window, simplified, oldest first. */
  track: SeenVertex[];
};

export type SeenBody = {
  v: typeof SEEN_VERSION;
  query: {
    lat: number;
    lon: number;
    /** Canonical ISO instant, minute precision. */
    t: string;
    window_min: number;
    radius_nm: number;
    radius_mi: number;
    from_ts: number;
    to_ts: number;
  };
  data: {
    status: SeenStatus;
    earliest: string;
    /** The window reaches the present, so the answer can still change. */
    includes_now: boolean;
  };
  /** Name for the rider's area ("Puyallup"), null when none is close. */
  area: string | null;
  aircraft: SeenItem[];
};

// ─── numbers ─────────────────────────────────────────────────────────

function roundN(n: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Rider coordinate → 2 decimals (about 1 km). */
export function roundCoord(n: number): number {
  return roundN(n, COORD_DECIMALS);
}

export function miToNm(mi: number): number {
  return roundN(mi * NM_PER_MI, 2);
}

export function nmToMi(nm: number): number {
  return nm / NM_PER_MI;
}

/** "1.2" for display; whole numbers past 10 mi. */
export function fmtMiles(mi: number): string {
  if (!Number.isFinite(mi)) return "—";
  return mi >= 10 ? String(Math.round(mi)) : mi.toFixed(1);
}

/** Radius as the rider picked it: 4.34 nm → "5". */
export function radiusMiLabel(radiusNm: number): string {
  const mi = nmToMi(radiusNm);
  const whole = Math.round(mi);
  return Math.abs(mi - whole) < 0.05 ? String(whole) : mi.toFixed(1);
}

const COMPASS_WORD: Record<string, string> = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
};

export function compassWord(deg: number): string {
  return COMPASS_WORD[compass8(deg)] ?? "north";
}

// ─── Pacific date / time ─────────────────────────────────────────────

const PT_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** { date: "YYYY-MM-DD", time: "HH:MM" } in Pacific time. */
export function ptLocal(tsMs: number): { date: string; time: string } {
  const parts: Record<string, string> = {};
  for (const p of PT_FMT.formatToParts(new Date(tsMs))) parts[p.type] = p.value;
  const hour = String(Number(parts.hour ?? "0") % 24).padStart(2, "0");
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute ?? "00"}`,
  };
}

export function isDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isTimeString(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/**
 * Pacific wall-clock date + time → instant (ms). The offset is -7 or -8;
 * pick the one that reads back as the same wall clock. A time skipped by
 * the spring-forward jump (02:30 on that Sunday) resolves as standard
 * time. Null on malformed input.
 */
export function ptLocalToMs(date: string, time: string): number | null {
  if (!isDateString(date) || !isTimeString(time)) return null;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  for (const off of [7, 8]) {
    const t = Date.UTC(y, mo - 1, d, hh + off, mm);
    const back = ptLocal(t);
    if (back.date === date && back.time === time) return t;
  }
  return Date.UTC(y, mo - 1, d, hh + 8, mm);
}

/** Today's Pacific date. */
export function todayPtDate(nowMs: number): string {
  return ptLocal(nowMs).date;
}

/** Now, rounded down to 5 minutes, as Pacific HH:MM. */
export function nowPtTime(nowMs: number): string {
  return ptLocal(Math.floor(nowMs / 300_000) * 300_000).time;
}

// ─── page URL state ──────────────────────────────────────────────────

export type SeenPageState = {
  lat: number | null;
  lon: number | null;
  /** Known place name the point came from, when picked from the list. */
  place: string | null;
  date: string;
  time: string;
  w: WindowMin;
  r: RadiusMi;
};

const PLACE_BY_LOWER = new Map(PLACES.map((p) => [p.name.toLowerCase(), p]));

/** A gazetteer place by name (case-insensitive), or null. */
export function placeByName(name: unknown) {
  if (typeof name !== "string" || name.length > 40) return null;
  return PLACE_BY_LOWER.get(name.trim().toLowerCase()) ?? null;
}

/** Places sorted by name, for the picker. */
export const PLACE_LIST = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));

/** Shown before the rider types: the towns people most often ask about. */
export const POPULAR_PLACES = [
  "Puyallup",
  "Fife",
  "Tacoma",
  "Lakewood",
  "Federal Way",
  "Kent",
  "Lynnwood",
  "Everett",
  "Olympia",
] as const;

/** Case-insensitive prefix match first, then substring, capped. Empty query → popular towns. */
export function searchPlaces(q: string, limit = 8) {
  const s = q.trim().toLowerCase();
  if (!s) {
    return POPULAR_PLACES.map((n) => placeByName(n)).filter((p): p is NonNullable<typeof p> => p != null).slice(0, limit);
  }
  const starts = PLACE_LIST.filter((p) => p.name.toLowerCase().startsWith(s));
  const contains = PLACE_LIST.filter(
    (p) => !p.name.toLowerCase().startsWith(s) && p.name.toLowerCase().includes(s),
  );
  return [...starts, ...contains].slice(0, limit);
}

function first(v: string | string[] | undefined | null): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const COORD_RE = /^-?\d{1,3}(?:\.\d{1,6})?$/;

function parseCoord(v: string | null, min: number, max: number): number | null {
  if (v == null || !COORD_RE.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return roundCoord(n);
}

/**
 * /seen search params → page state. Anything malformed falls back to the
 * default (today, now, ±30 min, 5 mi, no point) instead of erroring, so a
 * mangled share link still opens the form.
 */
export function parseSeenPageParams(
  sp: Record<string, string | string[] | undefined>,
  nowMs: number,
): SeenPageState {
  const place = placeByName(first(sp.place));
  let lat = parseCoord(first(sp.lat), -90, 90);
  let lon = parseCoord(first(sp.lon), -180, 180);
  if (lat == null || lon == null) {
    lat = null;
    lon = null;
  }
  if (place && lat == null) {
    lat = roundCoord(place.lat);
    lon = roundCoord(place.lon);
  }
  const dateRaw = first(sp.date);
  const timeRaw = first(sp.time);
  const date = isDateString(dateRaw) ? dateRaw : todayPtDate(nowMs);
  const time = isTimeString(timeRaw) ? timeRaw : nowPtTime(nowMs);
  const wNum = Number(first(sp.w));
  const rNum = Number(first(sp.r));
  const w = (WINDOW_CHOICES as readonly number[]).includes(wNum) ? (wNum as WindowMin) : DEFAULT_WINDOW_MIN;
  const r = (RADIUS_MI_CHOICES as readonly number[]).includes(rNum) ? (rNum as RadiusMi) : DEFAULT_RADIUS_MI;
  return { lat, lon, place: place?.name ?? null, date, time, w, r };
}

/** Shareable /seen URL. Coordinates are rounded again here, defensively. */
export function seenPageHref(s: SeenPageState): string {
  const p = new URLSearchParams();
  if (s.place) p.set("place", s.place);
  if (s.lat != null && s.lon != null) {
    p.set("lat", roundCoord(s.lat).toFixed(COORD_DECIMALS));
    p.set("lon", roundCoord(s.lon).toFixed(COORD_DECIMALS));
  }
  p.set("date", s.date);
  p.set("time", s.time);
  p.set("w", String(s.w));
  p.set("r", String(s.r));
  return `/seen?${p.toString()}`;
}

/** Canonical ISO instant at minute precision: "2026-11-17T23:30:00Z". */
export function isoMinute(tsMs: number): string {
  return new Date(Math.floor(tsMs / 60_000) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** /api/seen URL for a page state, or null without a point or a valid time. */
export function seenApiHref(s: SeenPageState): string | null {
  if (s.lat == null || s.lon == null) return null;
  const t = ptLocalToMs(s.date, s.time);
  if (t == null) return null;
  const p = new URLSearchParams({
    lat: roundCoord(s.lat).toFixed(COORD_DECIMALS),
    lon: roundCoord(s.lon).toFixed(COORD_DECIMALS),
    t: isoMinute(t),
    window_min: String(s.w),
    radius_nm: miToNm(s.r).toFixed(2),
  });
  return `/api/seen?${p.toString()}`;
}

// ─── copy ────────────────────────────────────────────────────────────

type TimeOpts = { hour12?: boolean };

function hhmm(tsMs: number, opts: TimeOpts): string {
  return formatTsBare(tsMs, "time", { hour12: opts.hour12 ?? false });
}

/** "Smokey 3 · WSP Cessna 206H Stationair with a FLIR camera" */
export function seenHeadline(item: Pick<SeenItem, "name" | "operator" | "airframe">): string {
  const what = [item.operator, item.airframe].filter((s) => s && s.trim()).join(" ");
  return what ? `${item.name} · ${what}` : item.name;
}

/** "passed 1.2 mi north of you at 14:32" */
export function passPhrase(item: Pick<SeenItem, "closest">, opts: TimeOpts = {}): string {
  const at = hhmm(item.closest.ts, opts);
  if (item.closest.distance_mi < 0.25) return `passed right over you at ${at}`;
  return `passed ${fmtMiles(item.closest.distance_mi)} mi ${item.closest.direction} of you at ${at}`;
}

/** "2,500 ft", or null without an altitude. */
export function altPhrase(altFt: number | null): string | null {
  if (altFt == null || !Number.isFinite(altFt)) return null;
  return `${Math.round(altFt).toLocaleString("en-US")} ft`;
}

/** "working a pattern over SR-512" / "along I-5" / null. */
export function activityPhrase(item: Pick<SeenItem, "pattern" | "corridor" | "near">): string | null {
  if (item.pattern.working) {
    return item.pattern.over ? `working a pattern over ${item.pattern.over}` : "working a pattern";
  }
  if (item.corridor) return `along ${item.corridor.name}`;
  return null;
}

/**
 * The plain-language line for one card:
 * "passed 1.2 mi north of you at 14:32 · 2,500 ft · working a pattern over SR-512"
 */
export function seenLine(item: SeenItem, opts: TimeOpts = {}): string {
  return [passPhrase(item, opts), altPhrase(item.closest.alt_ft), activityPhrase(item)]
    .filter(Boolean)
    .join(" · ");
}

/** "Out of Olympia Regional (KOLM)." / "Based at Renton Municipal (KRNT)." */
export function departurePhrase(dep: SeenItem["departure"]): string | null {
  if (!dep) return null;
  return dep.from_takeoff ? `Out of ${dep.name} (${dep.id}).` : `Based at ${dep.name} (${dep.id}).`;
}

/** The whole card as one sentence, for screen readers and share text. */
export function seenSentence(item: SeenItem, opts: TimeOpts = {}): string {
  const dep = departurePhrase(item.departure);
  return `${seenHeadline(item)} · ${seenLine(item, opts)}.${dep ? ` ${dep}` : ""}`;
}

/**
 * "Nothing we tracked passed within 5 mi between 14:00 and 15:00. Low-level
 * coverage can miss aircraft."
 */
export function emptyMessage(
  q: Pick<SeenBody["query"], "radius_nm" | "from_ts" | "to_ts">,
  opts: TimeOpts = {},
): string {
  return `Nothing we tracked passed within ${radiusMiLabel(q.radius_nm)} mi between ${hhmm(
    q.from_ts,
    opts,
  )} and ${hhmm(q.to_ts, opts)}. Low-level coverage can miss aircraft.`;
}

/** Copy for a window outside the track history. */
export function outsideMessage(status: Exclude<SeenStatus, "ok">, earliest = SEEN_EARLIEST_DATE): string {
  return status === "future"
    ? "That time has not happened yet. Pick a time that has."
    : `Our track history starts ${earliest}. Pick a date on or after that.`;
}

/** Results heading: "What flew within 5 mi of Puyallup, 14:00 to 15:00". */
export function resultsHeading(
  q: Pick<SeenBody["query"], "radius_nm" | "from_ts" | "to_ts">,
  area: string | null,
  opts: TimeOpts = {},
): string {
  const where = area && placeByName(area) ? `of ${area}` : "of your point";
  return `Within ${radiusMiLabel(q.radius_nm)} mi ${where}, ${hhmm(q.from_ts, opts)} to ${hhmm(q.to_ts, opts)}`;
}

/** Names the OG card may print: gazetteer places and region labels. */
export function isKnownAreaName(name: unknown): name is string {
  if (typeof name !== "string" || name.length > 40) return false;
  if (placeByName(name)) return true;
  return Object.values(REGIONS).some((r) => r.label.toLowerCase() === name.trim().toLowerCase());
}

/** "What flew over Puyallup at 14:30" */
export function ogTitle(area: string | null, time: string | null): string {
  const where = area ? ` over ${area}` : " overhead";
  return time ? `What flew${where} at ${time}` : `What flew${where}`;
}
