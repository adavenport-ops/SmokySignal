// Batched, read-only access to tracks:{tail}:{YYYYMMDD}. Deterministic
// keys (tails × dates) through lib/storage-keys.ts, LRANGE in pipelines,
// no SCAN. lib/tracks.ts stays the only writer; this module never writes.

import { getRedis } from "./cache";
import { trackKey } from "./storage-keys";
import type { TrackPoint } from "./tracks";

/** LRANGEs per pipeline round-trip. Keeps each response well under 1 MB on a busy day. */
const PIPELINE_CHUNK = 12;
/** Pipelines in flight at once. */
const CONCURRENCY = 4;

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

/** Parse one stored entry. Upstash may hand back an object or a JSON string. */
export function parseTrackPoint(raw: unknown): TrackPoint | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<TrackPoint>;
  if (typeof p.lat !== "number" || typeof p.lon !== "number" || typeof p.ts !== "number") {
    return null;
  }
  return {
    lat: p.lat,
    lon: p.lon,
    alt: typeof p.alt === "number" ? p.alt : null,
    spd: typeof p.spd === "number" ? p.spd : null,
    trk: typeof p.trk === "number" ? p.trk : null,
    ts: p.ts,
  };
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
  const redis = await getRedis();
  if (!redis || tails.length === 0 || dates.length === 0) return out;

  const jobs: { tail: string; key: string }[] = [];
  for (const tail of tails) for (const date of dates) jobs.push({ tail, key: trackKey(tail, date) });

  const chunks: (typeof jobs)[] = [];
  for (let i = 0; i < jobs.length; i += PIPELINE_CHUNK) chunks.push(jobs.slice(i, i + PIPELINE_CHUNK));

  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++]!;
      const p = redis!.pipeline();
      for (const j of chunk) p.lrange(j.key, 0, -1);
      let results: unknown[] = [];
      try {
        results = (await p.exec()) as unknown[];
      } catch (e) {
        console.warn("[track-reader] pipeline failed:", e);
        continue;
      }
      chunk.forEach((j, i) => {
        const rows = results[i];
        if (!Array.isArray(rows) || rows.length === 0) return;
        const list = out.get(j.tail) ?? [];
        for (const r of rows) {
          const pt = parseTrackPoint(r);
          if (pt) list.push(pt);
        }
        if (list.length > 0) out.set(j.tail, list);
      });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}
