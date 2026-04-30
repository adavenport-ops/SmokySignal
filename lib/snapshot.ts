import { buildSnapshot } from "./adsb";
import { cacheGet, cacheSet } from "./cache";
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
      await cacheSet(KEY, snap, TTL_SECONDS);
      lastSource = snap.source;
      return snap;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
