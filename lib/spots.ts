// Rider-logged "I see this aircraft right now" pings. Stored at
// spots:{YYYYMMDD}:{uuid} in KV with a 35-day TTL. Read aggregate via
// listRecentSpots() (30s cache).

import { getRedis, cacheGet, cacheSet } from "./cache";
import {
  SPOTS_PREFIX,
  spotKey,
  spotScanPattern,
  spotsRecentCacheKey,
} from "./storage-keys";

export type SpotAirborneTail = {
  tail: string;
  lat: number | null;
  lon: number | null;
  distance_nm: number | null;
};

export type SpotPayload = {
  lat: number;
  lon: number;
  ts: number;
  airborne_tails: SpotAirborneTail[];
};

export type StoredSpot = SpotPayload & { id: string };

const SPOT_TTL_SECONDS = 35 * 24 * 60 * 60;
const RECENT_CACHE_KEY = spotsRecentCacheKey();
const RECENT_CACHE_TTL = 30;

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export async function saveSpot(payload: SpotPayload): Promise<StoredSpot> {
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured");

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stored: StoredSpot = { ...payload, id };
  const date = utcDateKey(new Date(payload.ts));
  const key = spotKey(date, id);

  await redis.set(key, JSON.stringify(stored), { ex: SPOT_TTL_SECONDS });
  // Bust the recent-cache so the admin page reflects the new spot
  // immediately on next read.
  try {
    await redis.del(RECENT_CACHE_KEY);
  } catch {
    /* ignore */
  }
  return stored;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const keys: string[] = [];
  let cursor: string | number = 0;
  do {
    const result = (await redis.scan(cursor, {
      match: pattern,
      count: 200,
    })) as [string | number, string[]];
    keys.push(...result[1]);
    cursor = result[0];
  } while (String(cursor) !== "0");
  return keys;
}

function safeParse(raw: unknown): StoredSpot | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoredSpot;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as StoredSpot;
  return null;
}

/**
 * All spots in the rolling window (last LOOKBACK_DAYS), newest-first by
 * `ts`. 30s cached. `limit` truncates the result.
 */
const LOOKBACK_DAYS = 7;

export async function listRecentSpots(limit = 100): Promise<StoredSpot[]> {
  const cached = await cacheGet<StoredSpot[]>(RECENT_CACHE_KEY);
  if (cached) return cached.slice(0, limit);

  const redis = await getRedis();
  if (!redis) return [];

  // Scan only the date-prefixed keys we care about.
  const cutoff = utcDateKey(new Date(Date.now() - LOOKBACK_DAYS * 86_400_000));
  const allKeys = await scanKeys(spotScanPattern());
  const keys = allKeys.filter((k) => {
    const date = k.slice(SPOTS_PREFIX.length).split(":")[0];
    return date != null && date >= cutoff;
  });
  if (keys.length === 0) {
    await cacheSet(RECENT_CACHE_KEY, [], RECENT_CACHE_TTL);
    return [];
  }

  const values = (await redis.mget(...keys)) as unknown[];
  const spots = values
    .map(safeParse)
    .filter((s): s is StoredSpot => s !== null);
  spots.sort((a, b) => b.ts - a.ts);

  await cacheSet(RECENT_CACHE_KEY, spots, RECENT_CACHE_TTL);
  return spots.slice(0, limit);
}
