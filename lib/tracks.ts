// Position-history time-series in Upstash KV. Internal-only — there's no
// public endpoint surfacing this yet. Foundation for Phase 4 hot-zone
// learning and the orbit glyph on the plane detail screen.
//
// Storage shape:
//   tracks:{tail}:{YYYYMMDD}  →  Redis list of compact JSON strings
//   each entry: {"lat":47.5,"lon":-122.3,"alt":3200,"spd":118,"trk":85,"ts":1746024518}
//   plus, since 2026-11-18, optional compact capture keys (ag, vr, vg, sq,
//   em, ml, cat, nic, rc, nacp, sp, rs, rx, cs, src) documented in
//   lib/track-point.ts. Older points without them still parse.
//
// Daily keys are permanent (no TTL) since 2026-11-18: this is the flight history.

import { getRedis } from "./cache";
import { recordFirstSampleIfMissing } from "./learning";
import { recordLastSample } from "./freshness";
import { trackKey, trackScanPattern, trackScanAllPattern } from "./storage-keys";
import { parseTrackPoint, type TrackPoint } from "./track-point";
import type { Snapshot } from "./types";

export type { TrackPoint } from "./track-point";


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
  // A degraded snapshot is a placeholder from a failed upstream fetch, not
  // an observation. Writing it would bump the freshness pointer and make
  // FreshnessLabel read "fresh" while every feed is dead.
  if (snap.degraded) return;
  const redis = await getRedis();
  if (!redis) return; // dev or unconfigured KV — skip

  const date = utcDateKey(new Date(snap.fetched_at));
  const tsSec = Math.floor(snap.fetched_at / 1000);

  const points = snap.aircraft.filter(
    (a) => a.airborne && a.lat != null && a.lon != null,
  );
  // Seed the learning-state timer on the first ingest after this code
  // ships. Idempotent NX-write — a no-op after the first call. Skip when
  // we have nothing to write so an empty-sky deploy doesn't start the
  // clock prematurely.
  if (points.length > 0) {
    await recordFirstSampleIfMissing(new Date(snap.fetched_at));
  }
  // Update the freshness pointer on every non-degraded snapshot so /radar
  // + / can flip the LAST SAMPLE label amber when this cron silently dies
  // or the upstream feeds fail. Best-effort; never throws.
  await recordLastSample(snap.fetched_at);

  const writes = points.map(async (a) => {
    const key = trackKey(a.tail, date);
    const point: TrackPoint = {
      lat: a.lat as number,
      lon: a.lon as number,
      alt: a.altitude_ft ?? null,
      spd: a.ground_speed_kt ?? null,
      trk: a.heading ?? null,
      ts: tsSec,
      // Optional capture keys; undefined ones vanish in JSON.stringify.
      ...(a.obs ?? {}),
    };
    try {
      // No TTL: tracks are the permanent flight history (owner decision
      // 2026-11-18). ~5 MB/month at a 30s cadence.
      await redis.rpush(key, JSON.stringify(point));
    } catch (e) {
      console.warn(`[tracks] rpush failed for ${a.tail}:`, e);
    }
  });

  await Promise.allSettled(writes);
}

/** Sorted list of YYYYMMDD dates that have tracks for this tail (newest first). */
export async function listTrackKeys(tail: string): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const dates = new Set<string>();
  let cursor: string | number = 0;
  do {
    const result = (await redis.scan(cursor, {
      match: trackScanPattern(tail),
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
  const key = trackKey(tail, date);
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
      const len = (await redis.llen(trackKey(tail, date))) as number;
      total += typeof len === "number" ? len : 0;
    } catch {
      /* skip */
    }
  }

  const newest = dates[0]!;
  const oldest = dates[dates.length - 1]!;
  const lastRaw = (await redis.lrange(trackKey(tail, newest), -1, -1)) as unknown[];
  const firstRaw = (await redis.lrange(trackKey(tail, oldest), 0, 0)) as unknown[];
  const last = safeParse(lastRaw[0]);
  const first = safeParse(firstRaw[0]);

  return {
    totalSamples: total,
    daysWithData: dates.length,
    firstSampleTs: first?.ts ?? null,
    lastSampleTs: last?.ts ?? null,
  };
}

function safeParse(s: unknown): TrackPoint | null {
  return parseTrackPoint(s);
}

/** Keys per pipeline when reading many track days at once. */
const PIPELINE_CHUNK = 100;

/**
 * LLEN for many (tail, UTC day) pairs in pipelined batches. Deterministic
 * keys, no SCAN. Missing keys read as 0.
 */
export async function getTrackLengths(
  pairs: { tail: string; date: string }[],
): Promise<number[]> {
  const redis = await getRedis();
  if (!redis || pairs.length === 0) return pairs.map(() => 0);
  const out: number[] = [];
  for (let i = 0; i < pairs.length; i += PIPELINE_CHUNK * 5) {
    const chunk = pairs.slice(i, i + PIPELINE_CHUNK * 5);
    const p = redis.pipeline();
    for (const { tail, date } of chunk) p.llen(trackKey(tail, date));
    const res = (await p.exec()) as unknown[];
    for (const v of res) out.push(typeof v === "number" ? v : Number(v) || 0);
  }
  return out;
}

/**
 * Read whole track days for many (tail, UTC day) pairs, pipelined in
 * batches sized by `lengths` so no single pipeline response grows past
 * ~`pointsPerBatch` points. Returns points per pair, oldest → newest.
 */
export async function getTracksForPairs(
  pairs: { tail: string; date: string }[],
  lengths: number[],
  pointsPerBatch = 20_000,
  concurrency = 4,
): Promise<TrackPoint[][]> {
  const redis = await getRedis();
  const out: TrackPoint[][] = pairs.map(() => []);
  if (!redis || pairs.length === 0) return out;

  const batches: number[][] = [];
  let cur: number[] = [];
  let curPoints = 0;
  pairs.forEach((_, i) => {
    const n = lengths[i] ?? 0;
    if (n <= 0) return;
    if (cur.length > 0 && (curPoints + n > pointsPerBatch || cur.length >= PIPELINE_CHUNK)) {
      batches.push(cur);
      cur = [];
      curPoints = 0;
    }
    cur.push(i);
    curPoints += n;
  });
  if (cur.length > 0) batches.push(cur);

  const queue = [...batches];
  async function worker() {
    while (queue.length > 0) {
      const batch = queue.shift()!;
      const p = redis!.pipeline();
      for (const i of batch) p.lrange(trackKey(pairs[i]!.tail, pairs[i]!.date), 0, -1);
      const res = (await p.exec()) as unknown[];
      batch.forEach((pairIdx, k) => {
        const raw = Array.isArray(res[k]) ? (res[k] as unknown[]) : [];
        out[pairIdx] = raw
          .map((s) => safeParse(s))
          .filter((pt): pt is TrackPoint => pt !== null);
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return out;
}

/**
 * One-time-and-idempotent: strip the legacy 35-day TTL from every stored
 * track day so history is kept forever. Called by the daily rollup cron.
 * Returns how many keys were made permanent.
 */
export async function persistTrackHistory(): Promise<number> {
  const redis = await getRedis();
  if (!redis) return 0;
  let cursor: string | number = 0;
  let persisted = 0;
  do {
    const [next, keys] = (await redis.scan(cursor, {
      match: trackScanAllPattern(),
      count: 500,
    })) as [string | number, string[]];
    cursor = next;
    for (const k of keys) {
      if ((await redis.ttl(k)) > 0) {
        await redis.persist(k);
        persisted++;
      }
    }
  } while (String(cursor) !== "0");
  return persisted;
}
