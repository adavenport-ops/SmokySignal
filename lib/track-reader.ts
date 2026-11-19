// Read-only, batched access to tracks:{tail}:{YYYYMMDD} for /circling,
// /road and the coverage digest. A thin adapter over lib/tracks.ts's
// getTrackLengths + getTracksForPairs (deterministic keys, LLEN-sized
// LRANGE pipelines, no SCAN). Never writes.

import { getTrackLengths, getTracksForPairs } from "./tracks";
import type { TrackPoint } from "./tracks";

const DAY_MS = 86_400_000;

/** UTC YYYYMMDD for an instant. Same scheme the writer uses. */
export function utcDay(tsMs: number): string {
  const d = new Date(tsMs);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/** The last `days` UTC day keys ending today, oldest first. */
export function lastUtcDays(nowMs: number, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(utcDay(nowMs - i * DAY_MS));
  return out;
}

/**
 * Every point for each tail across the given UTC days, concatenated and
 * sorted by ts. Tails with no points are absent from the map. Empty map
 * when KV is not configured.
 */
export async function readTrackDays(
  tails: ReadonlyArray<string>,
  dates: ReadonlyArray<string>,
): Promise<Map<string, TrackPoint[]>> {
  const out = new Map<string, TrackPoint[]>();
  if (tails.length === 0 || dates.length === 0) return out;
  const pairs: { tail: string; date: string }[] = [];
  for (const tail of tails) for (const date of dates) pairs.push({ tail, date });
  const lengths = await getTrackLengths(pairs);
  const days = await getTracksForPairs(pairs, lengths);
  pairs.forEach(({ tail }, i) => {
    const pts = days[i] ?? [];
    if (pts.length === 0) return;
    const list = out.get(tail) ?? [];
    list.push(...pts);
    out.set(tail, list);
  });
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}
