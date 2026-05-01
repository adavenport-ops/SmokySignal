// Push subscription storage in KV. Each subscription is keyed by a stable
// hash of its endpoint URL — that's a Push-service URL (e.g. fcm.googleapis,
// web.push.apple) which already isn't personally identifying, so we don't
// store browser fingerprints, IPs, or any rider PII. Just the endpoint +
// p256dh + auth keys we need to send a push, plus the rider's preferences.
//
// Storage shape:
//   push:sub:${id}       JSON { sub, prefs, savedAt } — 90-day TTL
//   push:subs            Redis SET of subscription IDs (no TTL, manually pruned
//                        when removeSubscription() runs or the dispatcher hits
//                        a 410/404 and culls a dead endpoint)

import { createHash } from "node:crypto";
import { getRedis } from "../cache";

export type AlertTier = "all" | "alert_only";

export type AlertPrefs = {
  /**
   * 'alert_only' (default) → only fire pushes for smokey + patrol + unknown
   * (matches computeStatus() alert tiers). 'all' also fires for sar +
   * transport so curious riders can hear about every wing in the air.
   */
  tier: AlertTier;
  /**
   * 'any' → push for any qualifying takeoff regardless of where it happens.
   * Otherwise an array of hot-zone cell IDs the rider has opted into.
   */
  zones: string[] | "any";
  /** Rider-local hour at which quiet hours START (24-hour, 0-23). */
  quiet_start_h: number;
  /** Rider-local hour at which quiet hours END (24-hour, 0-23). */
  quiet_end_h: number;
  /** IANA TZ name; rider browser supplies it via Intl.DateTimeFormat. */
  tz: string;
};

export const DEFAULT_PREFS: AlertPrefs = {
  tier: "alert_only",
  zones: "any",
  quiet_start_h: 23,
  quiet_end_h: 6,
  tz: "America/Los_Angeles",
};

export type StoredSubscription = {
  id: string;
  sub: PushSubscriptionJSON;
  prefs: AlertPrefs;
  savedAt: number;
};

const SUB_PREFIX = "push:sub:";
const SUBS_INDEX = "push:subs";
const SUB_TTL_SECONDS = 90 * 24 * 60 * 60;

export function subscriptionId(sub: PushSubscriptionJSON): string {
  if (!sub.endpoint) throw new Error("subscription endpoint missing");
  return createHash("sha256").update(sub.endpoint).digest("hex").slice(0, 24);
}

function mergePrefs(partial?: Partial<AlertPrefs>): AlertPrefs {
  if (!partial) return { ...DEFAULT_PREFS };
  return {
    tier: partial.tier === "all" ? "all" : "alert_only",
    zones: Array.isArray(partial.zones) ? partial.zones : "any",
    quiet_start_h: clampHour(partial.quiet_start_h, DEFAULT_PREFS.quiet_start_h),
    quiet_end_h: clampHour(partial.quiet_end_h, DEFAULT_PREFS.quiet_end_h),
    tz: typeof partial.tz === "string" && partial.tz ? partial.tz : DEFAULT_PREFS.tz,
  };
}

function clampHour(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 0 || i > 23) return fallback;
  return i;
}

export async function saveSubscription(
  sub: PushSubscriptionJSON,
  prefsPartial?: Partial<AlertPrefs>,
): Promise<string> {
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured");
  const id = subscriptionId(sub);
  const prefs = mergePrefs(prefsPartial);
  const stored: StoredSubscription = {
    id,
    sub,
    prefs,
    savedAt: Date.now(),
  };
  await redis.set(`${SUB_PREFIX}${id}`, JSON.stringify(stored), {
    ex: SUB_TTL_SECONDS,
  });
  await redis.sadd(SUBS_INDEX, id);
  return id;
}

export async function getSubscription(
  id: string,
): Promise<StoredSubscription | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`${SUB_PREFIX}${id}`);
    if (!raw) return null;
    if (typeof raw === "string") return JSON.parse(raw) as StoredSubscription;
    if (typeof raw === "object") return raw as StoredSubscription;
    return null;
  } catch {
    return null;
  }
}

/**
 * Updates only the prefs field on an existing subscription. The endpoint +
 * keys are immutable across pref updates — riders edit their alert config
 * without re-subscribing.
 */
export async function updatePrefs(
  id: string,
  prefsPartial: Partial<AlertPrefs>,
): Promise<StoredSubscription | null> {
  const existing = await getSubscription(id);
  if (!existing) return null;
  const prefs = mergePrefs({ ...existing.prefs, ...prefsPartial });
  const next: StoredSubscription = { ...existing, prefs, savedAt: Date.now() };
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured");
  await redis.set(`${SUB_PREFIX}${id}`, JSON.stringify(next), {
    ex: SUB_TTL_SECONDS,
  });
  return next;
}

export async function removeSubscription(id: string): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.del(`${SUB_PREFIX}${id}`);
  await redis.srem(SUBS_INDEX, id);
}

/**
 * Used by the dispatcher only. Returns every active subscription. Single-
 * digit subscriber count expected for the foreseeable future; if this ever
 * climbs past ~500 we'd batch + paginate instead of scanning the full set.
 */
export async function listSubscriptions(): Promise<StoredSubscription[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const ids = (await redis.smembers(SUBS_INDEX)) as string[];
  if (ids.length === 0) return [];
  const out: StoredSubscription[] = [];
  for (const id of ids) {
    const s = await getSubscription(id);
    if (s) {
      out.push(s);
    } else {
      // The TTL expired or the row was manually deleted — clean the index.
      await redis.srem(SUBS_INDEX, id);
    }
  }
  return out;
}
