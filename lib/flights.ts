// Read-time derivation of "flights" (continuous airborne sessions) from the
// existing tracks:* time-series. No new write paths. Empty result is the
// expected initial state — the page populates as planes fly with our
// snapshot regen running in the background.

import {
  listTrackKeys,
  getTracksForDay,
  type TrackPoint,
} from "./tracks";
import { getRegistry } from "./registry";
import { cacheGet, cacheSet } from "./cache";
import { flightsRecentCacheKey } from "./storage-keys";
import type { FleetEntry } from "./types";

const CACHE_KEY = flightsRecentCacheKey();
const CACHE_TTL_SECONDS = 30;

const LOOKBACK_DAYS = 7;
// Two samples more than 5 minutes apart belong to different flights.
export const SESSION_GAP_MS = 5 * 60 * 1000;
// Filter out sessions with fewer than this many samples (noise / scratches).
const MIN_SAMPLES = 3;

export type FlightSession = {
  tail: string;
  nickname: string | null;
  date: string; // YYYYMMDD (UTC)
  start_ts: number; // ms
  end_ts: number; // ms
  duration_s: number;
  sample_count: number;
  max_alt_ft: number;
  start_coord: { lat: number; lon: number };
  end_coord: { lat: number; lon: number };
};

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Walk a day's chronological samples and emit one FlightSession per
 * uninterrupted run (gap > 5 min splits sessions). Sessions shorter than
 * MIN_SAMPLES samples are dropped as noise.
 */
export function sessionsFromDay(
  entry: FleetEntry,
  date: string,
  samples: TrackPoint[],
): FlightSession[] {
  if (samples.length < MIN_SAMPLES) return [];
  const out: FlightSession[] = [];

  let session: TrackPoint[] = [];
  const flush = () => {
    if (session.length < MIN_SAMPLES) return;
    const first = session[0]!;
    const last = session[session.length - 1]!;
    const startMs = first.ts * 1000;
    const endMs = last.ts * 1000;
    let maxAlt = 0;
    for (const p of session) {
      if (typeof p.alt === "number" && p.alt > maxAlt) maxAlt = p.alt;
    }
    out.push({
      tail: entry.tail,
      nickname: entry.nickname,
      date,
      start_ts: startMs,
      end_ts: endMs,
      duration_s: Math.max(0, Math.round((endMs - startMs) / 1000)),
      sample_count: session.length,
      max_alt_ft: maxAlt,
      start_coord: { lat: first.lat, lon: first.lon },
      end_coord: { lat: last.lat, lon: last.lon },
    });
  };

  for (const p of samples) {
    if (session.length === 0) {
      session.push(p);
      continue;
    }
    const prev = session[session.length - 1]!;
    const gapMs = (p.ts - prev.ts) * 1000;
    if (gapMs > SESSION_GAP_MS) {
      flush();
      session = [p];
    } else {
      session.push(p);
    }
  }
  flush();
  return out;
}

/**
 * Sessions from the last LOOKBACK_DAYS calendar days, newest-first by
 * end timestamp, capped at `limit`. 30s KV cache fronts repeated calls
 * (admin page refresh, multiple tabs, etc.).
 */
export async function getRecentFlights(limit = 20): Promise<FlightSession[]> {
  const cached = await cacheGet<FlightSession[]>(CACHE_KEY);
  if (cached) return cached;

  const fleet = await getRegistry();
  const cutoff = utcDateKey(new Date(Date.now() - LOOKBACK_DAYS * 86_400_000));

  const all: FlightSession[] = [];
  for (const entry of fleet) {
    const dates = await listTrackKeys(entry.tail);
    const recent = dates.filter((d) => d >= cutoff);
    for (const date of recent) {
      const samples = await getTracksForDay(entry.tail, date);
      all.push(...sessionsFromDay(entry, date, samples));
    }
  }

  all.sort((a, b) => b.end_ts - a.end_ts);
  const result = all.slice(0, limit);
  await cacheSet(CACHE_KEY, result, CACHE_TTL_SECONDS);
  return result;
}

export type RecentFlightForTail = {
  session: FlightSession;
  /** All track points belonging to this session, oldest → newest. */
  points: TrackPoint[];
  /** True when this is the in-progress trailing session for an airborne tail. */
  inProgress: boolean;
};

/**
 * Most recent flight session for a single tail, with its track points
 * for rendering. Walks back through the daily track keys and returns
 * the last session found. The newest session of the newest day with
 * data is the "most recent" — when the tail is currently airborne,
 * that session is in-progress and `inProgress` is true. Returns null
 * when no day has enough samples to count as a session.
 */
export async function getMostRecentFlightForTail(
  tail: string,
  nickname: string | null,
): Promise<RecentFlightForTail | null> {
  const dates = await listTrackKeys(tail); // newest first
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    const samples = await getTracksForDay(tail, date);
    if (sessionsFromDay({ tail, nickname } as FleetEntry, date, samples).length === 0) continue;
    // Read the day before too, so a flight that crossed 00:00 UTC is one
    // session with its real takeoff, the same one the logbook lists.
    const prev = utcDayBefore(date);
    const prevSamples = dates.includes(prev) ? await getTracksForDay(tail, prev) : [];
    const merged = mergeDaySamples([prevSamples, samples]);
    const sessions = sessionsFromDay({ tail, nickname } as FleetEntry, date, merged);
    const last = sessions[sessions.length - 1]!;
    const points = pointsForSession(merged, last);
    const inProgress = Date.now() - last.end_ts < SESSION_GAP_MS;
    return { session: { ...last, date: utcDateKey(new Date(last.start_ts)) }, points, inProgress };
  }
  return null;
}

/** YYYYMMDD of the UTC day before / after a YYYYMMDD key. */
export function utcDayBefore(dateKey: string): string {
  return shiftUtcDay(dateKey, -1);
}
export function utcDayAfter(dateKey: string): string {
  return shiftUtcDay(dateKey, 1);
}
function shiftUtcDay(dateKey: string, n: number): string {
  const y = Number(dateKey.slice(0, 4));
  const m = Number(dateKey.slice(4, 6));
  const d = Number(dateKey.slice(6, 8));
  return utcDateKey(new Date(Date.UTC(y, m - 1, d + n)));
}

/**
 * Concatenate several UTC days of samples into one chronological run,
 * dropping same-second repeats. sessionsFromDay over the result cuts
 * sessions the same way the rollup does after stitching across 00:00
 * UTC (lib/rollup-core.ts stitchSessions), so a flight page, the
 * logbook and /stats agree on start, end and duration.
 */
export function mergeDaySamples(days: ReadonlyArray<ReadonlyArray<TrackPoint>>): TrackPoint[] {
  return days
    .flat()
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .filter((p, i, arr) => i === 0 || p.ts !== arr[i - 1]!.ts);
}

/**
 * The session a public flightId names: the one that took off in that
 * minute, or, for an old link minted from the 00:00 UTC half of a split
 * flight, the session that was airborne at that minute.
 */
export function findFlightSession(
  sessions: ReadonlyArray<FlightSession>,
  flightTsMs: number,
): FlightSession | null {
  return (
    sessions.find((s) => sessionMatchesFlightId(s.start_ts, flightTsMs)) ??
    sessions.find((s) => s.start_ts <= flightTsMs && flightTsMs <= s.end_ts) ??
    null
  );
}

/**
 * Pull only the points that fall within the session's start/end window.
 * Samples are already chronological from getTracksForDay.
 */
function pointsForSession(
  samples: TrackPoint[],
  session: FlightSession,
): TrackPoint[] {
  const startSec = Math.floor(session.start_ts / 1000);
  const endSec = Math.ceil(session.end_ts / 1000);
  return samples.filter((p) => p.ts >= startSec && p.ts <= endSec);
}

/**
 * Compact UTC stamp at minute precision: "20260501T0629". Used as the
 * flightId in /flight/[tail]/[flightId] URLs so a flight has a stable,
 * shareable canonical address. Tracks are permanent (no TTL since
 * 2026-11-18), so the address keeps working.
 */
export function flightIdFromTs(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}`;
}

/**
 * Inverse of flightIdFromTs — decodes a "YYYYMMDDTHHMM" stamp back to
 * { dateKey: "YYYYMMDD", timestampMs }. Returns null on malformed input.
 */
export function parseFlightId(
  flightId: string,
): { dateKey: string; tsMs: number } | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(flightId);
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  const tsMs = Date.UTC(+y!, +mo! - 1, +d!, +h!, +min!);
  if (!Number.isFinite(tsMs)) return null;
  return { dateKey: `${y}${mo}${d}`, tsMs };
}

/**
 * flightIdFromTs truncates to the minute, so a session that started at
 * 00:32:45 gets id "...T0032". Match on the minute bucket, not on a
 * ±30s window around the truncated stamp (which missed any session that
 * started in the back half of its minute).
 */
export function sessionMatchesFlightId(startTsMs: number, flightTsMs: number): boolean {
  return Math.floor(startTsMs / 60_000) * 60_000 === flightTsMs;
}

/**
 * Look up a single flight session by its public flightId. Returns the
 * session (with its raw points + nickname) or null when no flight
 * matches the id. Used by the public /flight/[tail]/[flightId]
 * share page.
 */
export async function getFlightById(
  tail: string,
  nickname: string | null,
  flightId: string,
): Promise<RecentFlightForTail | null> {
  const parsed = parseFlightId(flightId);
  if (!parsed) return null;
  const { dateKey, tsMs } = parsed;

  // The flight can run past 00:00 UTC into the next track day, and an
  // old id can point into the second half of a split flight: read both
  // neighbours and cut sessions over the joined run.
  const [prev, cur, next] = await Promise.all([
    getTracksForDay(tail, utcDayBefore(dateKey)),
    getTracksForDay(tail, dateKey),
    getTracksForDay(tail, utcDayAfter(dateKey)),
  ]);
  const samples = mergeDaySamples([prev, cur, next]);
  const sessions = sessionsFromDay({ tail, nickname } as FleetEntry, dateKey, samples);
  const match = findFlightSession(sessions, tsMs);
  if (!match) return null;
  const points = pointsForSession(samples, match);
  return {
    session: { ...match, date: utcDateKey(new Date(match.start_ts)) },
    points,
    inProgress: false, // public share pages are always for completed flights
  };
}
