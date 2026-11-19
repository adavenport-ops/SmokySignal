import { buildSnapshot } from "./adsb";
import { cacheGet, cacheSet, getRedis } from "./cache";
import { logTracks } from "./tracks";
import { recordActivity } from "./activity";
import type { Snapshot, SnapshotSource } from "./types";

const KEY = "ss:snapshot:v1";
const TTL_SECONDS = 10;
// Degraded snapshots (every upstream feed failed) stay cached just long
// enough to absorb a burst of requests, then the next caller retries.
const DEGRADED_TTL_SECONDS = 5;
// /api/health needs to know "is the snapshot pipeline working?" without
// being dependent on the 10s hot-path cache, which is empty 50s/min
// between cron ticks. This mirror gets a 10-min TTL so /api/health
// shows accurate counts even when the hot-path cache has expired.
const HEALTH_KEY = "ss:snapshot:health:v1";
const HEALTH_TTL_SECONDS = 10 * 60;
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

/**
 * Most recent successful snapshot regardless of whether the 10s hot-path
 * cache is current. /api/health uses this to discriminate "cron is dead"
 * (this returns null) from "cron just ran but the hot-path TTL expired".
 */
export async function peekHealthSnapshot(): Promise<Snapshot | null> {
  return await cacheGet<Snapshot>(HEALTH_KEY);
}

// Single-flight: collapse concurrent calls within the cache window into one
// upstream fetch so 100 riders = 1 adsb.fi call.
let inflight: Promise<Snapshot> | null = null;

export async function getSnapshot(): Promise<Snapshot> {
  const cached = await cacheGet<Snapshot>(KEY);
  if (cached) {
    if (!cached.degraded) lastSource = cached.source;
    return cached;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const snap = await buildSnapshot();
      // Write the hot-path cache FIRST. Other instances that miss the cache
      // rebuild and diff on their own, so the sooner this lands the smaller
      // the window in which two instances record activity for the same
      // tick. (lib/activity.ts also dedupes at write time.)
      //
      // A degraded snapshot (both feeds down) is cached only briefly so
      // riders get a fresh retry within seconds instead of a placeholder
      // for the full TTL.
      try {
        await cacheSet(
          KEY,
          snap,
          snap.degraded ? DEGRADED_TTL_SECONDS : TTL_SECONDS,
        );
      } catch (e) {
        console.warn("[snapshot] hot-path cache write failed:", e);
      }

      if (snap.degraded) {
        // No observation this tick: skip the activity diff, the track log,
        // the freshness pointer, the airborne canary and the health mirror,
        // so none of them report a dead feed as current.
        return snap;
      }

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
      // Health mirror gets a much longer TTL so the cron pipeline is
      // observable between hot-path cache expirations.
      try {
        await cacheSet(HEALTH_KEY, snap, HEALTH_TTL_SECONDS);
      } catch (e) {
        console.warn("[snapshot] health-mirror write failed:", e);
      }
      lastSource = snap.source;
      return snap;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
