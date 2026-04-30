import { buildSnapshot } from "./adsb";
import { cacheGet, cacheSet, getRedis } from "./cache";
import { logTracks } from "./tracks";
import { recordActivity } from "./activity";
import type { Snapshot, SnapshotSource } from "./types";

const KEY = "ss:snapshot:v1";
const TTL_SECONDS = 10;
// Stale-data canary — written every time we observe ≥1 airborne tail.
// Read by /api/health; if it's been more than ~12h during daytime, either
// there's no fleet activity or the upstream parser is broken.
const LAST_AIRBORNE_KEY = "adsb:last_airborne_ts";
const LAST_AIRBORNE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Force the next /api/aircraft fetch to rebuild the snapshot from scratch
 * — used after registry edits so changes are visible immediately rather
 * than after the 10s KV TTL.
 */
export async function invalidateSnapshot(): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(KEY);
    } catch (e) {
      console.warn("[snapshot] invalidate failed:", e);
    }
  }
}

// Last successful upstream source. Surfaced via /api/health.
let lastSource: SnapshotSource | null = null;

export function getLastSource(): SnapshotSource | null {
  return lastSource;
}

export async function getLastAirborneTs(): Promise<number | null> {
  return await cacheGet<number>(LAST_AIRBORNE_KEY);
}

/** Read-only access to the cached snapshot (no fresh fetch). */
export async function peekSnapshot(): Promise<Snapshot | null> {
  return await cacheGet<Snapshot>(KEY);
}

// Single-flight: collapse concurrent calls within the cache window into one
// upstream fetch so 100 riders = 1 adsb.fi call.
let inflight: Promise<Snapshot> | null = null;

export async function getSnapshot(): Promise<Snapshot> {
  const cached = await cacheGet<Snapshot>(KEY);
  if (cached) {
    lastSource = cached.source;
    return cached;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const snap = await buildSnapshot();
      // Append airborne positions + record state-change activity events.
      // Both are best-effort: never fail /api/aircraft on a side-channel error.
      try {
        await Promise.all([logTracks(snap), recordActivity(snap)]);
      } catch (e) {
        console.warn("[snapshot] side-channel write failed:", e);
      }
      // Stamp the canary if any tail is airborne.
      if (snap.aircraft.some((a) => a.airborne)) {
        try {
          await cacheSet(
            LAST_AIRBORNE_KEY,
            snap.fetched_at,
            LAST_AIRBORNE_TTL_SECONDS,
          );
        } catch (e) {
          console.warn("[snapshot] last-airborne stamp failed:", e);
        }
      }
      await cacheSet(KEY, snap, TTL_SECONDS);
      lastSource = snap.source;
      return snap;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
