import { buildSnapshot } from "./adsb";
import { cacheGet, cacheSet } from "./cache";
import { logTracks } from "./tracks";
import type { Snapshot, SnapshotSource } from "./types";

const KEY = "ss:snapshot:v1";
const TTL_SECONDS = 10;

// Last successful upstream source. Surfaced via /api/health.
let lastSource: SnapshotSource | null = null;

export function getLastSource(): SnapshotSource | null {
  return lastSource;
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
      // Append airborne positions to KV time-series. Best-effort: never fail
      // /api/aircraft on a track-log error.
      try {
        await logTracks(snap);
      } catch (e) {
        console.warn("[snapshot] track logging failed:", e);
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
