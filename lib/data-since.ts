// IO half of "data since" (pure half: lib/data-since-core.ts).
//
//   meta:data_since → "YYYY-MM-DD", the first Pacific date with a stored
//                     track point. No TTL.
//
// refreshDataSince() scans the track keys, reads the earliest UTC day's
// points, and writes the value. The rollup cron runs it daily. Pages read
// it through getDataSince(), cached for an hour, falling back to
// DATA_SINCE_FALLBACK when KV is absent or the key is not written yet.

import { unstable_cache } from "next/cache";
import { getRedis } from "./cache";
import { dataSinceKey } from "./storage-keys";
import { getTracksForDay, listAllTrackKeys } from "./tracks";
import { DATA_SINCE_FALLBACK, dataSinceFrom, earliestTrackDay, ptDateOf, resolveDataSince } from "./data-since-core";

export { DATA_SINCE_FALLBACK } from "./data-since-core";

/** Recompute from the stored tracks and write meta:data_since. */
export async function refreshDataSince(): Promise<{ data_since: string; earliest_day: string | null }> {
  const redis = await getRedis();
  if (!redis) return { data_since: DATA_SINCE_FALLBACK, earliest_day: null };
  const keys = await listAllTrackKeys();
  const day = earliestTrackDay(keys);
  let minTs: number | null = null;
  if (day) {
    const tails = keys
      .filter((k) => k.endsWith(`:${day}`))
      .map((k) => k.split(":").slice(-2, -1)[0]!)
      .filter(Boolean);
    const days = await Promise.all(tails.map((t) => getTracksForDay(t, day)));
    for (const pts of days) {
      for (const p of pts) if (minTs === null || p.ts < minTs) minTs = p.ts;
    }
  }
  // No tracks yet: report today and write nothing, so a later run records
  // the real first day instead of a guessed one.
  if (!day) return { data_since: ptDateOf(Date.now()), earliest_day: null };
  const value = dataSinceFrom(day, minTs);
  await redis.set(dataSinceKey(), value);
  return { data_since: value, earliest_day: day };
}

async function readDataSince(): Promise<string> {
  try {
    const redis = await getRedis();
    if (!redis) return DATA_SINCE_FALLBACK;
    const stored = await redis.get<unknown>(dataSinceKey());
    if (stored !== null && stored !== undefined) return resolveDataSince(stored);
    // First read before the cron has run: compute once and store it.
    return (await refreshDataSince()).data_since;
  } catch (e) {
    console.warn("[data-since] read failed:", e);
    return DATA_SINCE_FALLBACK;
  }
}

/** First Pacific date with stored tracks, YYYY-MM-DD. Cached for an hour. */
export const getDataSince = unstable_cache(readDataSince, ["data-since-v1"], {
  revalidate: 3600,
});
