// Push dispatcher. Called once per grounded→airborne transition from the
// snapshot regen path (lib/activity.ts → recordActivity). For each takeoff
// we compose a role-aware payload, fan out to every opted-in subscription
// matching tier + zone + quiet-hours, and best-effort send via web-push.
// Dead endpoints (HTTP 410/404) are pruned from KV. Failures never throw —
// the snapshot pipeline must keep flowing.
//
// Hardening: sends run in bounded-concurrency batches, each with a socket
// timeout plus an overall deadline, so one slow or hostile endpoint can't
// hold up every other rider's alert. Endpoints are re-checked against the
// push-service allow-list at send time, which covers rows stored before
// /api/push/subscribe enforced it.

import webpush from "web-push";
import { getRedis } from "../cache";
import { zoneIdForPoint } from "../hotzones";
import { pushCooldownKey } from "../storage-keys";
import {
  listSubscriptions,
  removeSubscription,
  type AlertPrefs,
  type StoredSubscription,
  type UserZoneSpec,
} from "./store";
import { parsePushSubscription } from "./validate";
import type { FleetRole, RoleConfidence } from "../types";

/** One alert per tail per 20 minutes, claimed atomically (SET NX EX). */
const COOLDOWN_TTL_SECONDS = 20 * 60;
const MAX_BODY_CHARS = 140;
/** Push TTL: an alert older than 10 minutes is stale, let the service drop it. */
const PUSH_TTL_SECONDS = 600;
/** web-push socket idle timeout. */
const SEND_SOCKET_TIMEOUT_MS = 5_000;
/** Hard ceiling per send, covers slow-drip responses the socket timeout misses. */
const SEND_DEADLINE_MS = 8_000;
/** Concurrent sends per batch. */
export const SEND_CONCURRENCY = 10;

const ALERT_ROLES: ReadonlySet<FleetRole> = new Set([
  "smokey",
  "patrol",
  "unknown",
]);

let vapidConfigured = false;
function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) return false;
  webpush.setVapidDetails(subj, pub, priv);
  vapidConfigured = true;
  return true;
}

export type DispatchTakeoffArgs = {
  tail: string;
  role: FleetRole;
  roleConfidence: RoleConfidence;
  nickname: string | null;
  /**
   * Coordinates at the moment of takeoff. Used for zone matching and
   * (where available) corridor labelling in the body. Null is tolerated;
   * we just skip zone filters and drop the corridor field.
   */
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
  /**
   * ISO timestamp of takeoff. Informational; dedupe is a per-tail cooldown
   * (pushCooldownKey) rather than a timestamp bucket.
   */
  ts_iso: string;
};

export type DispatchResult = {
  sent: number;
  skipped: number;
  removed: number;
  reason?: string;
};

export async function dispatchTakeoff(
  args: DispatchTakeoffArgs,
): Promise<DispatchResult> {
  if (!ensureVapid()) {
    return { sent: 0, skipped: 0, removed: 0, reason: "vapid_not_configured" };
  }

  let subs: StoredSubscription[];
  try {
    const redis = await getRedis();
    if (redis) {
      // Atomic claim: concurrent snapshot regens race on the same key and
      // exactly one wins. Upstash returns null when NX finds the key set.
      const claimed = await redis.set(pushCooldownKey(args.tail), "1", {
        nx: true,
        ex: COOLDOWN_TTL_SECONDS,
      });
      if (claimed === null) {
        return { sent: 0, skipped: 0, removed: 0, reason: "duplicate" };
      }
    }
    subs = await listSubscriptions();
  } catch (e) {
    console.warn("[push] cooldown/list failed:", e);
    return { sent: 0, skipped: 0, removed: 0, reason: "kv_error" };
  }
  if (subs.length === 0) {
    return { sent: 0, skipped: 0, removed: 0, reason: "no_subs" };
  }

  const payload = JSON.stringify(composePayload(args));
  const aircraftZone =
    args.lat != null && args.lon != null
      ? zoneIdForPoint(args.lat, args.lon)
      : null;

  let skipped = 0;
  const targets: StoredSubscription[] = [];
  for (const stored of subs) {
    const skip = shouldSkip(
      stored.prefs,
      args.role,
      args.tail,
      args.lat,
      args.lon,
      aircraftZone,
    );
    if (skip) skipped++;
    else targets.push(stored);
  }

  const results = await mapWithConcurrency(targets, SEND_CONCURRENCY, (s) =>
    sendOne(s, payload),
  );
  let sent = 0;
  let removed = 0;
  for (const r of results) {
    if (r.status === "fulfilled" && r.value === "sent") sent++;
    else if (r.status === "fulfilled" && r.value === "removed") removed++;
    else skipped++;
  }
  return { sent, skipped, removed };
}

/**
 * Runs `fn` over `items` in batches of `limit` via Promise.allSettled, so
 * at most `limit` requests are in flight and one rejection never aborts
 * the rest. Results are in input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const size = Math.max(1, Math.floor(limit));
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.allSettled(batch.map((item) => fn(item)))));
  }
  return out;
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`push send exceeded ${ms}ms`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

// Per-degree shorthand for the user-zone bbox check. 1° latitude is
// 60 nm everywhere; 1° longitude is ~41 nm at 47°N (Puget Sound).
// Slight over-inclusion outside that latitude band is acceptable —
// rider zone match is a "could you care?" check, not a hard fence.
const NM_PER_DEG_LAT = 60;
const NM_PER_DEG_LON_47N = 41;

function matchesUserZone(
  lat: number,
  lon: number,
  userZones?: UserZoneSpec[],
): boolean {
  if (!userZones || userZones.length === 0) return false;
  for (const z of userZones) {
    const latDeg = z.radiusNm / NM_PER_DEG_LAT;
    const lonDeg = z.radiusNm / NM_PER_DEG_LON_47N;
    if (Math.abs(lat - z.lat) <= latDeg && Math.abs(lon - z.lon) <= lonDeg) {
      return true;
    }
  }
  return false;
}

function shouldSkip(
  prefs: AlertPrefs,
  role: FleetRole,
  tail: string,
  lat: number | null,
  lon: number | null,
  aircraftZone: string | null,
): boolean {
  // tier
  if (prefs.tier === "alert_only" && !ALERT_ROLES.has(role)) return true;
  // tail allow-list — applied AFTER tier so a rider asking for "all
  // tiers, only N305DK" still gets every transition for that tail.
  if (Array.isArray(prefs.tails) && prefs.tails.length > 0) {
    if (!prefs.tails.includes(tail.toUpperCase())) return true;
  }
  // zone — predefined list AND/OR user-defined geofences. Any explicit
  // zone constraint imposes the gate; matching either kind passes it.
  // Empty constraints (no predefined + no user zones) means "any" — no gate.
  const hasPredefined = Array.isArray(prefs.zones) && prefs.zones.length > 0;
  const hasUser = Array.isArray(prefs.userZones) && prefs.userZones.length > 0;
  if (hasPredefined || hasUser) {
    const matchesPredefined =
      hasPredefined &&
      aircraftZone != null &&
      (prefs.zones as string[]).includes(aircraftZone);
    const matchesUser =
      hasUser && lat != null && lon != null
        ? matchesUserZone(lat, lon, prefs.userZones)
        : false;
    if (!matchesPredefined && !matchesUser) return true;
  }
  // quiet hours
  if (insideQuietHours(prefs)) return true;
  return false;
}

function insideQuietHours(prefs: AlertPrefs): boolean {
  const start = prefs.quiet_start_h;
  const end = prefs.quiet_end_h;
  if (start === end) return false; // zero-length window = always firing
  let hour: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: prefs.tz,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour")?.value ?? "0";
    hour = Number(h) % 24;
  } catch {
    // bad TZ → fall back to UTC; quiet hours are advisory at best in that case
    hour = new Date().getUTCHours();
  }
  if (start < end) {
    return hour >= start && hour < end;
  }
  // wrap-around: e.g. 23 → 6
  return hour >= start || hour < end;
}

type PushPayload = {
  title: string;
  body: string;
  tag: string;
  data: Record<string, unknown>;
};

function composePayload(args: DispatchTakeoffArgs): PushPayload {
  const name = args.nickname ?? args.tail;
  const altStr = args.alt_ft != null ? `${args.alt_ft.toLocaleString()}'` : "alt unk";
  let title: string;
  let body: string;
  // Title carries the Smokey umbrella for every law-enforcement role —
  // speed-enforcement fixed-wing, patrol helicopter, or unconfirmed
  // alert-class all read "Smokey's up." Body still distinguishes airframe.
  switch (args.role) {
    case "smokey":
      title = "Smokey's up.";
      body = trimBody(`${name} watching. ${altStr}.`);
      break;
    case "patrol":
      title = "Smokey's up.";
      body = trimBody(`${name} airborne. ${altStr}.`);
      break;
    case "unknown":
      title = "Smokey's up.";
      body = trimBody(`Unidentified bird airborne. ${altStr}.`);
      break;
    case "sar":
      title = "SAR run.";
      body = trimBody(`${name} on a rescue run.`);
      break;
    case "transport":
      title = "Transport up.";
      body = trimBody(`${name} airborne. ${altStr}.`);
      break;
  }
  return {
    title,
    body,
    tag: `smokey-${args.tail}`,
    data: { url: `/plane/${args.tail}`, tail: args.tail, role: args.role },
  };
}

function trimBody(s: string): string {
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS - 1) + "…";
}

type SendResult = "sent" | "removed" | "skipped";

async function sendOne(
  stored: StoredSubscription,
  payload: string,
): Promise<SendResult> {
  // Rebuild from validated fields only, and never POST to a host outside
  // the push-service allow-list (legacy rows predate that check).
  const sub = parsePushSubscription(stored.sub);
  if (!sub) {
    console.warn(`[push] skipping ${stored.id}: endpoint/keys failed validation`);
    return "skipped";
  }
  try {
    await withDeadline(
      webpush.sendNotification(sub, payload, {
        TTL: PUSH_TTL_SECONDS,
        timeout: SEND_SOCKET_TIMEOUT_MS,
      }),
      SEND_DEADLINE_MS,
    );
    return "sent";
  } catch (e: unknown) {
    const status =
      typeof e === "object" && e !== null && "statusCode" in e
        ? Number((e as { statusCode: unknown }).statusCode)
        : 0;
    if (status === 404 || status === 410) {
      // Subscription is dead at the push service — prune.
      try {
        await removeSubscription(stored.id);
      } catch {
        /* best-effort */
      }
      return "removed";
    }
    console.warn(`[push] send failed for ${stored.id}:`, e);
    return "skipped";
  }
}
