// Position-history time-series in Upstash KV. Internal-only — there's no
// public endpoint surfacing this yet. Foundation for Phase 4 hot-zone
// learning and the orbit glyph on the plane detail screen.
//
// Storage shape:
//   tracks:{tail}:{YYYYMMDD}  →  Redis list of compact JSON strings
//   each entry: {"lat":47.5,"lon":-122.3,"alt":3200,"spd":118,"trk":85,"ts":1746024518}
//
// Each daily key gets a 35-day TTL so the rolling window auto-cleans.

import { getRedis, cacheGet, cacheSet } from "./cache";
import type { Snapshot } from "./types";

export type TrackPoint = {
  lat: number;
  lon: number;
  alt: number | null;
  spd: number | null;
  trk: number | null;
  ts: number;
};

const TTL_SECONDS = 35 * 24 * 60 * 60; // 35 days
const READ_CACHE_TTL = 60; // seconds — avoids hammering KV on detail-page renders

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Append airborne-plane positions to today's track-history list. Best-effort:
 * any failure logs and returns; never throws to the caller.
 */
export async function logTracks(snap: Snapshot): Promise<void> {
  const redis = await getRedis();
  if (!redis) return; // dev or unconfigured KV — skip

  const date = utcDateKey(new Date(snap.fetched_at));
  const tsSec = Math.floor(snap.fetched_at / 1000);

  const writes = snap.aircraft
    .filter((a) => a.airborne && a.lat != null && a.lon != null)
    .map(async (a) => {
      const key = `tracks:${a.tail}:${date}`;
      const point: TrackPoint = {
        lat: a.lat as number,
        lon: a.lon as number,
        alt: a.altitude_ft ?? null,
        spd: a.ground_speed_kt ?? null,
        trk: a.heading ?? null,
        ts: tsSec,
      };
      try {
        await redis.rpush(key, JSON.stringify(point));
        await redis.expire(key, TTL_SECONDS);
      } catch (e) {
        console.warn(`[tracks] rpush failed for ${a.tail}:`, e);
      }
    });

  await Promise.allSettled(writes);
}

/**
 * Most recent N positions for a given tail, oldest → newest. Reads today's
 * list and falls back to yesterday if today has fewer than N samples (so the
 * orbit glyph stays useful right after midnight UTC).
 */
export async function getRecentPositions(
  tail: string,
  count: number,
): Promise<TrackPoint[]> {
  const cacheKey = `ss:tracks-recent:${tail}:${count}`;
  const cached = await cacheGet<TrackPoint[]>(cacheKey);
  if (cached) return cached;

  const redis = await getRedis();
  if (!redis) return [];

  const now = new Date();
  const today = `tracks:${tail}:${utcDateKey(now)}`;
  const yesterday = `tracks:${tail}:${utcDateKey(new Date(now.getTime() - 86_400_000))}`;

  const todayRaw = (await redis.lrange(today, -count, -1)) as string[];
  let collected = todayRaw;
  if (todayRaw.length < count) {
    const need = count - todayRaw.length;
    const yesterdayRaw = (await redis.lrange(yesterday, -need, -1)) as string[];
    collected = [...yesterdayRaw, ...todayRaw];
  }

  const points = collected
    .map((s) => safeParse(s))
    .filter((p): p is TrackPoint => p !== null);

  await cacheSet(cacheKey, points, READ_CACHE_TTL);
  return points;
}

/** Distinct UTC date count we have track history for, capped at 30 for display. */
/** Sorted list of YYYYMMDD dates that have tracks for this tail (newest first). */
export async function listTrackKeys(tail: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const dates = new Set<string>();
  let cursor: string | number = 0;
  do {
    const result = (await redis.scan(cursor, {
      match: `tracks:${tail}:*`,
      count: 100,
    })) as [string | number, string[]];
    for (const k of result[1]) {
      const d = k.split(":")[2];
      if (d) dates.add(d);
    }
    cursor = result[0];
  } while (String(cursor) !== "0");
  return [...dates].sort().reverse();
}

/** All track points for a single UTC day, oldest → newest. */
export async function getTracksForDay(
  tail: string,
  date: string,
): Promise<TrackPoint[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const key = `tracks:${tail}:${date}`;
  let raw: unknown[] = [];
  try {
    raw = (await redis.lrange(key, 0, -1)) as unknown[];
  } catch {
    return [];
  }
  return raw
    .map((s) => safeParse(s))
    .filter((p): p is TrackPoint => p !== null);
}

export type TrackSummary = {
  totalSamples: number;
  daysWithData: number;
  firstSampleTs: number | null;
  lastSampleTs: number | null;
};

/** Summary stats for the debug overview — total count, day count, span. */
export async function getTrackSummary(tail: string): Promise<TrackSummary> {
  const redis = await getRedis();
  if (!redis) {
    return {
      totalSamples: 0,
      daysWithData: 0,
      firstSampleTs: null,
      lastSampleTs: null,
    };
  }
  const dates = await listTrackKeys(tail); // newest first
  if (dates.length === 0) {
    return {
      totalSamples: 0,
      daysWithData: 0,
      firstSampleTs: null,
      lastSampleTs: null,
    };
  }

  // Sum LLEN across each day. Done sequentially — at most 35 days
  // (matches our 35-day TTL on track keys), so 35 round-trips worst case.
  let total = 0;
  for (const date of dates) {
    try {
      const len = (await redis.llen(`tracks:${tail}:${date}`)) as number;
      total += typeof len === "number" ? len : 0;
    } catch {
      /* skip */
    }
  }

  const newest = dates[0]!;
  const oldest = dates[dates.length - 1]!;
  const lastRaw = (await redis.lrange(`tracks:${tail}:${newest}`, -1, -1)) as unknown[];
  const firstRaw = (await redis.lrange(`tracks:${tail}:${oldest}`, 0, 0)) as unknown[];
  const last = safeParse(lastRaw[0]);
  const first = safeParse(firstRaw[0]);

  return {
    totalSamples: total,
    daysWithData: dates.length,
    firstSampleTs: first?.ts ?? null,
    lastSampleTs: last?.ts ?? null,
  };
}

export async function getDistinctDayCount(tail: string): Promise<number> {
  const cacheKey = `ss:tracks-days:${tail}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached != null) return cached;

  const redis = await getRedis();
  if (!redis) return 0;

  const days = new Set<string>();
  let cursor: string | number = 0;
  do {
    const result = (await redis.scan(cursor, {
      match: `tracks:${tail}:*`,
      count: 100,
    })) as [string | number, string[]];
    const [next, keys] = result;
    for (const k of keys) {
      const date = k.split(":")[2];
      if (date) days.add(date);
    }
    cursor = next;
    // Upstash returns "0" (string) when scan completes.
  } while (String(cursor) !== "0");

  const count = days.size;
  await cacheSet(cacheKey, count, READ_CACHE_TTL);
  return count;
}

function safeParse(s: unknown): TrackPoint | null {
  if (typeof s !== "string") {
    // Upstash sometimes auto-deserializes JSON strings into objects.
    if (s && typeof s === "object") return s as TrackPoint;
    return null;
  }
  try {
    return JSON.parse(s) as TrackPoint;
  } catch {
    return null;
  }
}
