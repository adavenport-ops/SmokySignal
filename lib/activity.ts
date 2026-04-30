// Activity feed: state-change events derived from comparing successive
// snapshots. Stored in a Redis list at activity:feed (last 100 entries).
// Surfaced on the dashboard home and via /api/activity.

import { getRedis, cacheGet, cacheSet } from "./cache";
import type { Aircraft, Snapshot } from "./types";

const FEED_KEY = "activity:feed";
const PREV_KEY = "aircraft:prev";
const FEED_LIMIT = 100;
const PREV_TTL_SECONDS = 24 * 60 * 60;
const READ_CACHE_TTL = 8;

const MIN_ALT_DELTA_FT = 1000;

export type ActivityKind = "takeoff" | "landing" | "altitude_change";

export type ActivityEntry = {
  ts: number; // unix seconds
  tail: string;
  kind: ActivityKind;
  description: string;
};

function describe(
  kind: ActivityKind,
  tail: string,
  nickname: string | null | undefined,
  altDelta?: number,
): string {
  const display = nickname || tail;
  switch (kind) {
    case "takeoff":
      return `${display} off the deck`;
    case "landing":
      return `${display} wheels down`;
    case "altitude_change": {
      if (altDelta == null) return `${display} altitude shift`;
      const verb = altDelta > 0 ? "climbing" : "descending";
      return `${display} ${verb} · ${Math.abs(Math.round(altDelta / 100) * 100)}ft swing`;
    }
  }
}

function diffEvents(prev: Snapshot | null, curr: Snapshot): ActivityEntry[] {
  if (!prev) return [];
  const prevByTail = new Map<string, Aircraft>();
  for (const a of prev.aircraft) prevByTail.set(a.tail, a);

  const ts = Math.floor(curr.fetched_at / 1000);
  const out: ActivityEntry[] = [];

  for (const a of curr.aircraft) {
    const p = prevByTail.get(a.tail);
    if (!p) continue;

    if (!p.airborne && a.airborne) {
      out.push({
        ts,
        tail: a.tail,
        kind: "takeoff",
        description: describe("takeoff", a.tail, a.nickname),
      });
      continue;
    }
    if (p.airborne && !a.airborne) {
      out.push({
        ts,
        tail: a.tail,
        kind: "landing",
        description: describe("landing", a.tail, a.nickname),
      });
      continue;
    }
    if (
      p.airborne &&
      a.airborne &&
      typeof p.altitude_ft === "number" &&
      typeof a.altitude_ft === "number"
    ) {
      const delta = a.altitude_ft - p.altitude_ft;
      if (Math.abs(delta) >= MIN_ALT_DELTA_FT) {
        out.push({
          ts,
          tail: a.tail,
          kind: "altitude_change",
          description: describe("altitude_change", a.tail, a.nickname, delta),
        });
      }
    }
  }

  return out;
}

/**
 * Compute state-change events between previous and current snapshots, append
 * any to the activity feed in KV, and persist current as the new "previous".
 * Best-effort — never throws.
 */
export async function recordActivity(curr: Snapshot): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  let prev: Snapshot | null = null;
  try {
    const raw = await redis.get(PREV_KEY);
    if (raw) {
      prev = typeof raw === "string" ? (JSON.parse(raw) as Snapshot) : (raw as Snapshot);
    }
  } catch (e) {
    console.warn("[activity] read prev failed:", e);
  }

  const events = diffEvents(prev, curr);
  if (events.length > 0) {
    try {
      const payload = events.map((e) => JSON.stringify(e));
      await redis.rpush(FEED_KEY, ...payload);
      await redis.ltrim(FEED_KEY, -FEED_LIMIT, -1);
    } catch (e) {
      console.warn("[activity] rpush failed:", e);
    }
  }

  try {
    await redis.set(PREV_KEY, JSON.stringify(curr), {
      ex: PREV_TTL_SECONDS,
    });
  } catch (e) {
    console.warn("[activity] write prev failed:", e);
  }
}

export async function getRecentActivity(limit = 10): Promise<ActivityEntry[]> {
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
    .reverse(); // newest first

  await cacheSet(cacheKey, entries, READ_CACHE_TTL);
  return entries;
}
