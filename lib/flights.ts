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
import type { FleetEntry } from "./types";

const CACHE_KEY = "flights:recent_cache_v1";
const CACHE_TTL_SECONDS = 30;

const LOOKBACK_DAYS = 7;
// Two samples more than 5 minutes apart belong to different flights.
const SESSION_GAP_MS = 5 * 60 * 1000;
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
function sessionsFromDay(
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
