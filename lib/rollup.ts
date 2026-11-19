// IO half of the permanent daily rollup. Reads the (now permanent) tracks:* tank
// through the existing helpers, folds one UTC day into a DailyRollup
// (lib/rollup-core.ts), and writes it with NO TTL:
//
//   rollup:daily:{YYYYMMDD} → JSON DailyRollup
//   rollup:index            → sorted set of YYYYMMDD, score = Number(YYYYMMDD)
//
// Written once a day by /api/cron/rollup. Read by /stats.

import { getRedis } from "./cache";
import { getRegistry } from "./registry";
import { getTracksForDay } from "./tracks";
import { rollupDailyKey, rollupIndexKey } from "./storage-keys";
import {
  buildRollupDoc,
  planRollupDates,
  rollupHasDetail,
  type DailyRollup,
} from "./rollup-core";

/**
 * Days back the cron may still backfill. tracks:{tail}:{day} keys expire
 * 35 days after their last write, so day N-34 is the oldest day whose
 * points are guaranteed to be complete.
 */
export const ROLLUP_BACKFILL_DAYS = 34;

/** Read every registry tail's samples for one UTC day and fold them. */
export async function buildDailyRollup(dateKey: string): Promise<DailyRollup> {
  const fleet = await getRegistry();
  const inputs = await Promise.all(
    fleet.map(async (entry) => ({
      entry,
      samples: await getTracksForDay(entry.tail, dateKey),
    })),
  );
  return buildRollupDoc(dateKey, inputs, Date.now());
}

/** Persist one doc and index it. Overwrites in place, so re-runs are idempotent. */
export async function writeDailyRollup(doc: DailyRollup): Promise<void> {
  const redis = await getRedis();
  if (!redis) throw new Error("kv_not_configured");
  const p = redis.pipeline();
  // No `ex`: this key is the permanent record.
  p.set(rollupDailyKey(doc.date), JSON.stringify(doc));
  p.zadd(rollupIndexKey(), { score: Number(doc.date), member: doc.date });
  await p.exec();
}

/** All indexed rollup days, oldest first. Empty when KV is absent. */
export async function getRollupIndex(): Promise<string[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const raw = (await redis.zrange(rollupIndexKey(), 0, -1)) as unknown[];
  // Upstash auto-deserializes "20261118" to a number; normalize back.
  return raw.map((m) => String(m)).filter((d) => /^\d{8}$/.test(d));
}

const MGET_CHUNK = 50;

/** Fetch docs for the given days. Missing or unparseable docs are skipped. */
export async function getRollups(dates: string[]): Promise<DailyRollup[]> {
  const redis = await getRedis();
  if (!redis || dates.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < dates.length; i += MGET_CHUNK) {
    chunks.push(dates.slice(i, i + MGET_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((c) => redis.mget<unknown[]>(...c.map((d) => rollupDailyKey(d)))),
  );
  const out: DailyRollup[] = [];
  for (const v of results.flat()) {
    const doc = parseRollup(v);
    if (doc) out.push(doc);
  }
  return out;
}

function parseRollup(v: unknown): DailyRollup | null {
  let obj: unknown = v;
  if (typeof v === "string") {
    try {
      obj = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const d = obj as Partial<DailyRollup>;
  if (typeof d.date !== "string" || !Array.isArray(d.tails)) return null;
  return d as DailyRollup;
}

export type RollupRunResult = {
  built: string[];
  /** Older days rebuilt to add flight detail (departures, patterns). */
  upgraded: string[];
  /** Days the deadline cut off; the next run picks them up. */
  remaining: string[];
};

const DAY_CONCURRENCY = 4;

/**
 * Build yesterday plus any day in the backfill window that is not yet
 * indexed. Stops starting new days once `deadlineMs` passes so the
 * route stays inside its maxDuration; unfinished days roll to tomorrow.
 */
export async function runRollup(opts: {
  nowMs: number;
  deadlineMs: number;
}): Promise<RollupRunResult> {
  const index = await getRollupIndex();
  const indexed = new Set(index);
  const plan = planRollupDates(opts.nowMs, indexed, ROLLUP_BACKFILL_DAYS);
  const built: string[] = [];
  const upgraded: string[] = [];
  const queue = [...plan];

  // Docs written before flight detail existed get rebuilt from tracks,
  // newest first, after the regular plan. Tracks are permanent now, but a
  // day whose points were pruned under the old TTL would rebuild thinner
  // than the stored doc; those keep the stored doc.
  const planned = new Set(plan);
  const stale = (await getRollups(index.filter((d) => !planned.has(d))))
    .filter((d) => !rollupHasDetail(d))
    .sort((a, b) => b.date.localeCompare(a.date));

  async function worker() {
    while (queue.length > 0 && Date.now() < opts.deadlineMs) {
      const date = queue.shift()!;
      const doc = await buildDailyRollup(date);
      await writeDailyRollup(doc);
      built.push(date);
    }
    while (stale.length > 0 && Date.now() < opts.deadlineMs) {
      const old = stale.shift()!;
      const doc = await buildDailyRollup(old.date);
      if (doc.sample_count < old.sample_count) continue;
      await writeDailyRollup(doc);
      upgraded.push(old.date);
    }
  }
  await Promise.all(Array.from({ length: DAY_CONCURRENCY }, worker));

  return {
    built: built.sort().reverse(),
    upgraded: upgraded.sort().reverse(),
    remaining: [...queue, ...stale.map((d) => d.date)],
  };
}
