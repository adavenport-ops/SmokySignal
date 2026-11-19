// Run: npx tsx --test lib/push/*.test.ts
//
// dispatchTakeoff() against in-memory KV + a fake push service. Pins the
// takeoff-alert contract: atomic per-tail cooldown, cooldown released on a
// KV error, an overall deadline that a tarpit endpoint can't outlast, and
// no sends to rows that fail the endpoint allow-list.

import { test } from "node:test";
import assert from "node:assert";
import { COOLDOWN_TTL_SECONDS, dispatchTakeoff, type DispatchTakeoffArgs } from "./dispatcher";
import type { PushDeps, PushRedis } from "./send";
import type { StoredSubscription } from "./store";
import { pushCooldownKey } from "../storage-keys";

const P256DH = Buffer.alloc(65, 4).toString("base64url");
const AUTH = Buffer.alloc(16, 7).toString("base64url");

const ARGS: DispatchTakeoffArgs = {
  tail: "N305DK",
  role: "police",
  roleConfidence: "unknown",
  nickname: "Smokey 3",
  lat: 47.6,
  lon: -122.3,
  alt_ft: 3500,
  ts_iso: "2026-11-18T18:00:00.000Z",
};

function makeSub(id: string, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`): StoredSubscription {
  return {
    id,
    sub: { endpoint, keys: { p256dh: P256DH, auth: AUTH } },
    // quiet_start_h === quiet_end_h disables quiet hours so tests don't
    // depend on the wall clock.
    prefs: { tier: "alert_only", zones: "any", quiet_start_h: 0, quiet_end_h: 0, tz: "UTC" },
    savedAt: 0,
  };
}

class MemRedis implements PushRedis {
  store = new Map<string, string>();
  ttls = new Map<string, number>();
  async set(key: string, value: string, opts: { nx: true; ex: number }) {
    if (opts.nx && this.store.has(key)) return null;
    this.store.set(key, value);
    this.ttls.set(key, opts.ex);
    return "OK";
  }
  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }
  async incr(key: string) {
    const n = Number(this.store.get(key) ?? "0") + 1;
    this.store.set(key, String(n));
    return n;
  }
  async expire(key: string, seconds: number) {
    this.ttls.set(key, seconds);
    return 1;
  }
}

type Harness = {
  deps: PushDeps;
  redis: MemRedis;
  sentTo: unknown[];
  removed: string[];
};

function harness(
  subs: StoredSubscription[] | (() => Promise<StoredSubscription[]>),
  send: PushDeps["sendNotification"] = async () => ({}),
): Harness {
  const redis = new MemRedis();
  const sentTo: unknown[] = [];
  const removed: string[] = [];
  const deps: PushDeps = {
    getRedis: async () => redis,
    listSubscriptions: typeof subs === "function" ? subs : async () => subs,
    removeSubscription: async (id) => {
      removed.push(id);
    },
    sendNotification: async (sub, payload, opts) => {
      sentTo.push(sub);
      return send(sub, payload, opts);
    },
  };
  return { deps, redis, sentTo, removed };
}

const OPTS = { skipVapidCheck: true };

test("dispatchTakeoff: sends once, then the NX cooldown skips the duplicate", async () => {
  const h = harness([makeSub("a"), makeSub("b")]);
  const first = await dispatchTakeoff(ARGS, h.deps, OPTS);
  assert.deepStrictEqual(first, { sent: 2, removed: 0, skipped: 0 });
  assert.equal(h.redis.ttls.get(pushCooldownKey("N305DK")), COOLDOWN_TTL_SECONDS);

  const second = await dispatchTakeoff(ARGS, h.deps, OPTS);
  assert.equal(second.reason, "duplicate");
  assert.equal(h.sentTo.length, 2, "no extra sends on the duplicate");
});

test("dispatchTakeoff: kv_error releases the cooldown so the next takeoff can alert", async () => {
  let failList = true;
  const h = harness(async () => {
    if (failList) throw new Error("KV down");
    return [makeSub("a")];
  });
  const r = await dispatchTakeoff(ARGS, h.deps, OPTS);
  assert.equal(r.reason, "kv_error");
  assert.equal(h.redis.store.has(pushCooldownKey("N305DK")), false);

  failList = false;
  const retry = await dispatchTakeoff(ARGS, h.deps, OPTS);
  assert.deepStrictEqual(retry, { sent: 1, removed: 0, skipped: 0 });
});

test("dispatchTakeoff: 25 never-resolving sends finish within the overall deadline", async () => {
  const subs = Array.from({ length: 25 }, (_, i) => makeSub(`s${i}`));
  const h = harness(subs, () => new Promise(() => {}));
  const started = Date.now();
  const r = await dispatchTakeoff(ARGS, h.deps, {
    ...OPTS,
    overallDeadlineMs: 150,
    sendDeadlineMs: 400,
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1000, `took ${elapsed}ms`);
  assert.deepStrictEqual(r, { sent: 0, removed: 0, skipped: 25 });
  // Only the first pool slots ever started; the rest were never sent.
  assert.equal(h.sentTo.length, 10);
});

test("dispatchTakeoff: off-list legacy row is skipped and extra fields never reach the sender", async () => {
  const legacyEvil = makeSub("evil", "https://evil.example/collect");
  const legacyExtra = makeSub("extra");
  (legacyExtra.sub as unknown as Record<string, unknown>).junk = "x";
  const h = harness([legacyEvil, legacyExtra]);
  const r = await dispatchTakeoff(ARGS, h.deps, OPTS);
  assert.deepStrictEqual(r, { sent: 1, removed: 0, skipped: 1 });
  assert.deepStrictEqual(h.sentTo, [
    {
      endpoint: "https://fcm.googleapis.com/fcm/send/extra",
      keys: { p256dh: P256DH, auth: AUTH },
    },
  ]);
});

test("dispatchTakeoff: 410 prunes at once; 403 prunes on the third strike", async () => {
  const gone = makeSub("gone");
  const forbidden = makeSub("forbidden");
  const send: PushDeps["sendNotification"] = async (sub) => {
    if (sub.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    if (sub.endpoint.endsWith("/forbidden")) throw Object.assign(new Error("no"), { statusCode: 403 });
    return {};
  };
  const h = harness([gone, forbidden], send);
  const tails = ["N1A", "N2B", "N3C"];
  const results = [];
  for (const tail of tails) results.push(await dispatchTakeoff({ ...ARGS, tail }, h.deps, OPTS));
  assert.deepStrictEqual(results[0], { sent: 0, removed: 1, skipped: 1 });
  assert.deepStrictEqual(results[1], { sent: 0, removed: 1, skipped: 1 });
  assert.deepStrictEqual(results[2], { sent: 0, removed: 2, skipped: 0 });
  assert.deepStrictEqual([...h.removed].sort(), ["forbidden", "gone", "gone", "gone"]);
});

test("dispatchTakeoff: rolling pool keeps exactly 10 in flight and never more", async () => {
  let inFlight = 0;
  let peak = 0;
  const subs = Array.from({ length: 35 }, (_, i) => makeSub(`p${i}`));
  const h = harness(subs, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return {};
  });
  const r = await dispatchTakeoff(ARGS, h.deps, OPTS);
  assert.deepStrictEqual(r, { sent: 35, removed: 0, skipped: 0 });
  assert.equal(peak, 10);
});
