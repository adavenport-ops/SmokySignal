// Activity feed: state-change events derived from successive snapshots.
// Stored as a Redis list at activity:feed (last 500 entries, 35-day TTL).
// Surfaced on /activity, on the Glanceable home as a one-line strip,
// and via /api/activity.
//
// The pure diff (event kinds, landing debounce, degraded-snapshot guard)
// lives in lib/activity-diff.ts so it can be tested without Redis. This
// module owns the KV side: read prev, write-time dedupe, append, persist.

import { getRedis, cacheGet, cacheSet } from "./cache";
import { activityDedupeKey } from "./storage-keys";
import {
  diffActivity,
  type ActivityEntry,
  type ActivityKind,
  type PrevState,
} from "./activity-diff";
import type { Snapshot } from "./types";
import { normalizeMission } from "./mission";

export {
  describeEvent,
  type ActivityEntry,
  type ActivityKind,
} from "./activity-diff";

const FEED_KEY = "activity:feed";
const PREV_KEY = "aircraft:prev";
const FEED_LIMIT = 500;
const FEED_TTL_SECONDS = 35 * 24 * 60 * 60;
const PREV_TTL_SECONDS = 24 * 60 * 60;
const READ_CACHE_TTL = 8;
// Same (tail, kind) cannot be appended twice inside this window, no matter
// how many instances race on the same snapshot pair. A genuine opposite
// transition clears the slot early (see OPPOSITE_KIND), so a real
// down→up inside the window still records both rows.
const DEDUPE_TTL_SECONDS = 600;

/**
 * Claiming one side of an airborne/grounded transition releases the other
 * side's slot. Without this, takeoff → landing → takeoff inside 10 min
 * dropped the second takeoff and the feed ended on "down" while the tail
 * was airborne.
 */
const OPPOSITE_KIND: Partial<Record<ActivityKind, ActivityKind>> = {
  takeoff: "landing",
  first_seen: "landing",
  landing: "takeoff",
};

/** The two KV calls the dedupe needs. @upstash/redis satisfies it. */
export type DedupeStore = {
  set(
    key: string,
    value: string,
    opts: { nx: true; ex: number },
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
};

/**
 * Claim the write-time dedupe slot for each event. Returns only the events
 * this caller won. Fails open on a KV error: a rare duplicate row beats
 * silently dropping a real takeoff.
 */
export async function claimEvents(
  store: DedupeStore,
  events: ActivityEntry[],
): Promise<ActivityEntry[]> {
  const claimed = await Promise.all(
    events.map(async (e) => {
      try {
        const ok = await store.set(activityDedupeKey(e.tail, e.kind), "1", {
          nx: true,
          ex: DEDUPE_TTL_SECONDS,
        });
        if (ok === null) return null;
      } catch (err) {
        console.warn("[activity] dedupe claim failed, writing anyway:", err);
        return e;
      }
      const opposite = OPPOSITE_KIND[e.kind];
      if (opposite) {
        try {
          await store.del(activityDedupeKey(e.tail, opposite));
        } catch (err) {
          console.warn("[activity] dedupe release (opposite) failed:", err);
        }
      }
      return e;
    }),
  );
  return claimed.filter((e): e is ActivityEntry => e !== null);
}

/**
 * Give back slots claimed for events that never reached the feed, so the
 * next tick (which re-diffs against the unchanged prev) can write them.
 */
export async function releaseClaims(
  store: DedupeStore,
  events: ActivityEntry[],
): Promise<void> {
  if (events.length === 0) return;
  try {
    await store.del(...events.map((e) => activityDedupeKey(e.tail, e.kind)));
  } catch (err) {
    console.warn("[activity] dedupe release failed:", err);
  }
}

/**
 * Diff current snapshot vs previous, append events to the feed, persist
 * current as the new "previous" for next call. Best-effort; never throws.
 * Degraded snapshots (upstream outage) are ignored entirely: no events,
 * and the stored prev is left as the last real observation.
 */
export async function recordActivity(curr: Snapshot): Promise<void> {
  if (curr.degraded) return;
  const redis = await getRedis();
  if (!redis) return;

  let prev: PrevState | null = null;
  try {
    const raw = await redis.get(PREV_KEY);
    if (raw) {
      prev =
        typeof raw === "string"
          ? (JSON.parse(raw) as PrevState)
          : (raw as PrevState);
    }
  } catch (e) {
    console.warn("[activity] read prev failed:", e);
  }

  const diff = diffActivity(prev, curr, Date.now());
  if (!diff.next) return;

  const events =
    diff.events.length > 0 ? await claimEvents(redis, diff.events) : [];
  let feedWritten = true;
  if (events.length > 0) {
    try {
      const payload = events.map((e) => JSON.stringify(e));
      await redis.rpush(FEED_KEY, ...payload);
      await redis.ltrim(FEED_KEY, -FEED_LIMIT, -1);
      await redis.expire(FEED_KEY, FEED_TTL_SECONDS);
    } catch (e) {
      console.warn("[activity] rpush failed:", e);
      feedWritten = false;
      await releaseClaims(redis, events);
    }
  }

  // Persist prev BEFORE the push fan-out, so a slow dispatch does not keep
  // other instances diffing against the old prev. If the feed write
  // failed, leave prev unchanged: the next tick re-diffs the same
  // transition and, with the claims released above, writes it then.
  if (feedWritten) {
    try {
      await redis.set(PREV_KEY, JSON.stringify(diff.next), {
        ex: PREV_TTL_SECONDS,
      });
    } catch (e) {
      console.warn("[activity] write prev failed:", e);
    }
  }

  if (events.length > 0) {
    // Fan out push notifications for each takeoff. Best-effort; the
    // dispatcher's own try/catch + dedupe key keep this from breaking
    // the snapshot pipeline. Fire all in parallel since the dispatcher
    // already de-duplicates per (tail, minute).
    const takeoffs = events.filter((e) => e.kind === "takeoff");
    if (takeoffs.length > 0) {
      try {
        const { dispatchTakeoff } = await import("./push/dispatcher");
        // Don't block the snapshot request on push fan-out. waitUntil keeps
        // the Vercel function alive until sends settle (no-op off Vercel).
        const { waitUntil } = await import("@vercel/functions");
        waitUntil(Promise.all(
          takeoffs.map((e) =>
            dispatchTakeoff({
              tail: e.tail,
              role: normalizeMission(e.role),
              policeUnit: curr.aircraft.find((a) => a.tail === e.tail)?.policeUnit,
              scope: curr.aircraft.find((a) => a.tail === e.tail)?.scope,
              roleConfidence: "unknown",
              nickname:
                curr.aircraft.find((a) => a.tail === e.tail)?.nickname ?? null,
              lat: e.lat ?? null,
              lon: e.lon ?? null,
              alt_ft: e.alt_ft ?? null,
              ts_iso: new Date(e.ts).toISOString(),
            }).catch((err) => {
              console.warn("[activity] dispatchTakeoff failed:", err);
              return null;
            }),
          ),
        ));
      } catch (e) {
        console.warn("[activity] push dispatch import/init failed:", e);
      }
    }
  }
}

/**
 * Most recent N events, newest-first. Tolerates the older feed-entry
 * shape (no icao24/squawk/lat/lon/alt_ft, ts in seconds) by leaving
 * those fields undefined.
 */
export async function getRecentActivity(limit = 50): Promise<ActivityEntry[]> {
  const cacheKey = `ss:activity-recent:${limit}`;
  const cached = await cacheGet<ActivityEntry[]>(cacheKey);
  if (cached) return cached;

  const redis = await getRedis();
  if (!redis) return [];

  let raw: unknown[] = [];
  try {
    raw = (await redis.lrange(FEED_KEY, -limit, -1)) as unknown[];
  } catch {
    return [];
  }

  const entries = raw
    .map((s) => {
      if (typeof s === "string") {
        try {
          return JSON.parse(s) as ActivityEntry;
        } catch {
          return null;
        }
      }
      if (s && typeof s === "object") return s as ActivityEntry;
      return null;
    })
    .filter((e): e is ActivityEntry => e !== null)
    // Normalize: if ts looks like seconds (10-digit unix), promote to ms.
    .map((e) => (e.ts < 1e12 ? { ...e, ts: e.ts * 1000 } : e))
    .reverse(); // newest first

  await cacheSet(cacheKey, entries, READ_CACHE_TTL);
  return entries;
}
