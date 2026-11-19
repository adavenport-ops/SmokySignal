// Push send machinery shared by the takeoff dispatcher and the admin test
// route. Everything that talks to a push service goes through
// sendToSubscriptions() so the same guarantees hold on every path:
//
//   - each stored subscription is re-validated (allow-listed host,
//     base64url keys) and rebuilt to { endpoint, keys } before sending,
//     which covers rows stored before /api/push/subscribe enforced it;
//   - a rolling pool keeps at most `concurrency` requests in flight;
//   - every send has a socket timeout plus a per-send deadline, and the
//     whole fan-out has an overall deadline; anything unsent by then is
//     counted as skipped;
//   - 404/410 prune the subscription at once; repeated 400/401/403 prune
//     it after PRUNE_AFTER_FAILURES strikes.
//
// I/O is injectable (PushDeps) so the pipeline is unit-testable without
// KV or the network.

import webpush from "web-push";
import { getRedis } from "../cache";
import { pushFailCountKey } from "../storage-keys";
import {
  listSubscriptions,
  removeSubscription,
  type StoredSubscription,
} from "./store";
import { parsePushSubscription, type StoredPushSubscription } from "./validate";

/** Concurrent in-flight sends. */
export const SEND_CONCURRENCY = 10;
/** web-push socket idle timeout. */
export const SEND_SOCKET_TIMEOUT_MS = 5_000;
/** Hard ceiling per send; covers slow-drip responses the socket timeout misses. */
export const SEND_DEADLINE_MS = 8_000;
/**
 * Ceiling for one whole fan-out. Kept under the 30s maxDuration on the
 * routes that trigger it (app/api/aircraft, app/api/cron/refresh-snapshot)
 * so waitUntil work finishes before the function is frozen.
 */
export const OVERALL_DEADLINE_MS = 25_000;
/** 400/401/403 strikes before a subscription is pruned. */
export const PRUNE_AFTER_FAILURES = 3;
/** Window the strike counter lives for. */
const FAIL_COUNT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The slice of the Upstash client the push pipeline uses. */
export interface PushRedis {
  set(
    key: string,
    value: string,
    opts: { nx: true; ex: number },
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export type SendNotificationFn = (
  sub: StoredPushSubscription,
  payload: string,
  opts: { TTL: number; timeout: number },
) => Promise<unknown>;

export type PushDeps = {
  getRedis: () => Promise<PushRedis | null>;
  listSubscriptions: () => Promise<StoredSubscription[]>;
  removeSubscription: (id: string) => Promise<void>;
  sendNotification: SendNotificationFn;
};

export const defaultPushDeps: PushDeps = {
  getRedis: async () => (await getRedis()) as unknown as PushRedis | null,
  listSubscriptions,
  removeSubscription,
  sendNotification: (sub, payload, opts) =>
    webpush.sendNotification(sub, payload, opts),
};

export type SendOptions = {
  /** Push-service TTL in seconds. */
  ttl: number;
  concurrency?: number;
  sendDeadlineMs?: number;
  overallDeadlineMs?: number;
};

export type SendOutcome = "sent" | "removed" | "skipped" | "failed";

export type SendSummary = {
  sent: number;
  removed: number;
  /** Invalid rows, failed sends, and sends cut off by the overall deadline. */
  skipped: number;
};

/**
 * Rolling pool: `limit` workers pull the next item as soon as their
 * current one settles, so one slow send only ties up one slot. Stops
 * starting new work at `deadlineMs` and returns; entries still running or
 * never started are `undefined`. Results are in input order.
 */
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  deadlineMs: number = Number.POSITIVE_INFINITY,
): Promise<Array<PromiseSettledResult<R> | undefined>> {
  const results: Array<PromiseSettledResult<R> | undefined> = new Array(
    items.length,
  ).fill(undefined);
  let next = 0;
  let expired = false;
  const worker = async () => {
    while (!expired && next < items.length) {
      const i = next++;
      try {
        const value = await fn(items[i] as T);
        if (!expired) results[i] = { status: "fulfilled", value };
      } catch (reason) {
        if (!expired) results[i] = { status: "rejected", reason };
      }
    }
  };
  const size = Math.max(1, Math.min(Math.floor(limit), items.length));
  const all = Promise.all(Array.from({ length: size }, worker));
  if (!Number.isFinite(deadlineMs)) {
    await all;
    return results;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    all,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
    }),
  ]);
  clearTimeout(timer);
  expired = true;
  return results.slice();
}

export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`push send exceeded ${ms}ms`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

function statusOf(e: unknown): number {
  return typeof e === "object" && e !== null && "statusCode" in e
    ? Number((e as { statusCode: unknown }).statusCode)
    : 0;
}

export async function sendOne(
  stored: StoredSubscription,
  payload: string,
  opts: SendOptions,
  deps: PushDeps = defaultPushDeps,
): Promise<SendOutcome> {
  // Rebuild from validated fields only, and never POST to a host outside
  // the push-service allow-list.
  const sub = parsePushSubscription(stored.sub);
  if (!sub) {
    console.warn(`[push] skipping ${stored.id}: endpoint/keys failed validation`);
    return "skipped";
  }
  try {
    await withDeadline(
      deps.sendNotification(sub, payload, {
        TTL: opts.ttl,
        timeout: SEND_SOCKET_TIMEOUT_MS,
      }),
      opts.sendDeadlineMs ?? SEND_DEADLINE_MS,
    );
    return "sent";
  } catch (e: unknown) {
    const status = statusOf(e);
    if (status === 404 || status === 410) {
      // Subscription is dead at the push service — prune.
      await pruneSubscription(stored.id, deps);
      return "removed";
    }
    if (status === 400 || status === 401 || status === 403) {
      // Bad keys or VAPID mismatch. Usually permanent, but count strikes
      // so one transient error doesn't drop a rider.
      if (await recordStrike(stored.id, deps)) return "removed";
    }
    console.warn(`[push] send failed for ${stored.id} (status ${status || "n/a"}):`, e);
    return "failed";
  }
}

async function pruneSubscription(id: string, deps: PushDeps): Promise<void> {
  try {
    await deps.removeSubscription(id);
  } catch {
    /* best-effort */
  }
  try {
    const redis = await deps.getRedis();
    await redis?.del(pushFailCountKey(id));
  } catch {
    /* best-effort */
  }
}

/** Returns true when the strike pruned the subscription. */
async function recordStrike(id: string, deps: PushDeps): Promise<boolean> {
  try {
    const redis = await deps.getRedis();
    if (!redis) return false;
    const key = pushFailCountKey(id);
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, FAIL_COUNT_TTL_SECONDS);
    if (n >= PRUNE_AFTER_FAILURES) {
      await pruneSubscription(id, deps);
      return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
}

/**
 * Fans `payload` out to `targets` with bounded concurrency and an overall
 * deadline. Never throws.
 */
export async function sendToSubscriptions(
  targets: readonly StoredSubscription[],
  payload: string,
  opts: SendOptions,
  deps: PushDeps = defaultPushDeps,
): Promise<SendSummary> {
  const results = await runPool(
    targets,
    opts.concurrency ?? SEND_CONCURRENCY,
    (s) => sendOne(s, payload, opts, deps),
    opts.overallDeadlineMs ?? OVERALL_DEADLINE_MS,
  );
  const summary: SendSummary = { sent: 0, removed: 0, skipped: 0 };
  let unfinished = 0;
  for (const r of results) {
    if (r?.status === "fulfilled" && r.value === "sent") summary.sent++;
    else if (r?.status === "fulfilled" && r.value === "removed") summary.removed++;
    else {
      summary.skipped++;
      if (!r) unfinished++;
    }
  }
  if (unfinished > 0) {
    console.warn(`[push] overall deadline hit; ${unfinished} send(s) unfinished`);
  }
  return summary;
}
