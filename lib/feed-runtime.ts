// KV-backed side of the multi-feed pipeline:
//   - a per-feed rate gate, shared across serverless instances, so a
//     metered feed (adsb.lol) is asked at most once per budget interval
//     no matter how many instances regenerate the snapshot;
//   - the last tick's per-feed status, read by /api/health.
// Falls back to process memory when KV is absent or erroring (dev, or a
// KV outage), which is per-instance and so only best-effort.

import { cacheGet, cacheSet, getRedis } from "./cache";
import type { SourceStatus } from "./feed-select";
import type { FeedSrc, NormalizedAc } from "./types";

const gateKey = (src: FeedSrc) => `feeds:gate:${src}`;
const STATUS_KEY = "feeds:status:v1";
const STATUS_TTL_S = 10 * 60;
/** Longest we will sit out a feed on a Retry-After header. */
const MAX_BACKOFF_S = 24 * 60 * 60;

const memoryGate = new Map<FeedSrc, number>();

function claimMemory(src: FeedSrc, intervalS: number, now: number): boolean {
  const until = memoryGate.get(src) ?? 0;
  if (until > now) return false;
  memoryGate.set(src, now + intervalS * 1000);
  return true;
}

/**
 * Claims this feed's slot for the next `intervalS` seconds. True means
 * "go ahead and fetch"; false means another tick (here or on another
 * instance) already asked inside the window.
 */
export async function claimFeedSlot(src: FeedSrc, intervalS: number): Promise<boolean> {
  if (!(intervalS > 0)) return true;
  const now = Date.now();
  const ttl = Math.ceil(intervalS);
  try {
    const redis = await getRedis();
    if (redis) {
      const res = await redis.set(gateKey(src), now, { nx: true, ex: ttl });
      return res === "OK";
    }
  } catch (e) {
    console.warn(`[feeds] gate claim for ${src} fell back to memory:`, e);
  }
  return claimMemory(src, ttl, now);
}

/**
 * Cheap per-instance check for feeds that need no shared gate (adsb.fi):
 * false only while a 429 backoff set on this instance is running.
 */
export function feedBackedOff(src: FeedSrc): boolean {
  return (memoryGate.get(src) ?? 0) > Date.now();
}

/** Holds the gate shut for `seconds` (a 429's Retry-After). */
export async function backoffFeed(src: FeedSrc, seconds: number): Promise<void> {
  const ttl = Math.ceil(Math.min(MAX_BACKOFF_S, Math.max(1, seconds)));
  memoryGate.set(src, Date.now() + ttl * 1000);
  try {
    const redis = await getRedis();
    if (redis) await redis.set(gateKey(src), Date.now(), { ex: ttl });
  } catch (e) {
    console.warn(`[feeds] backoff write for ${src} failed:`, e);
  }
}

const lastKey = (src: FeedSrc) => `feeds:last:${src}`;
type Remembered = { at: number; rows: NormalizedAc[] };
const memoryLast = new Map<FeedSrc, Remembered>();

/**
 * Keeps a feed's last answer for `ttlS` seconds so skipped ticks can reuse
 * it (see FeedSpec.recall). Callers pass only the rows worth carrying
 * (lib/adsb.ts keeps fleet rows) to keep the KV value small.
 */
export async function rememberFeedRows(
  src: FeedSrc,
  rows: NormalizedAc[],
  ttlS: number,
): Promise<void> {
  const value: Remembered = { at: Date.now(), rows };
  memoryLast.set(src, value);
  await cacheSet(lastKey(src), value, Math.max(1, Math.ceil(ttlS)));
}

/** The remembered answer if younger than `maxAgeS`, else null. */
export async function recallFeedRows(
  src: FeedSrc,
  maxAgeS: number,
): Promise<NormalizedAc[] | null> {
  let v: Remembered | null = null;
  try {
    v = await cacheGet<Remembered>(lastKey(src));
  } catch {
    v = memoryLast.get(src) ?? null;
  }
  if (!v || Date.now() - v.at > maxAgeS * 1000) return null;
  return v.rows;
}

export type FeedStatusRecord = { at: number; feeds: SourceStatus[] };

export async function writeFeedStatus(feeds: SourceStatus[], at = Date.now()): Promise<void> {
  // Skipped feeds keep their last real status, so /api/health shows when
  // adsb.lol last answered rather than "skipped" for most of its interval.
  let prev: FeedStatusRecord | null = null;
  try {
    prev = await cacheGet<FeedStatusRecord>(STATUS_KEY);
  } catch {
    prev = null;
  }
  const merged = feeds.map((f) => {
    if (f.status !== "skipped") return { ...f, at };
    const last = prev?.feeds.find((p) => p.src === f.src) as
      | (SourceStatus & { at?: number })
      | undefined;
    return last && last.status !== "skipped" ? { ...last, skipped_since: at } : { ...f, at };
  });
  await cacheSet(STATUS_KEY, { at, feeds: merged }, STATUS_TTL_S);
}

export async function readFeedStatus(): Promise<FeedStatusRecord | null> {
  return await cacheGet<FeedStatusRecord>(STATUS_KEY);
}
