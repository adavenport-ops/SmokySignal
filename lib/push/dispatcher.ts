// Push dispatcher. Called once per grounded→airborne transition from the
// snapshot regen path (lib/activity.ts → recordActivity). For each takeoff
// we compose a role-aware payload, fan out to every opted-in subscription
// matching tier + zone + quiet-hours, and best-effort send via web-push.
// Dead endpoints (HTTP 410/404) are pruned from KV. Failures never throw —
// the snapshot pipeline must keep flowing.
//
// Hardening: sends go through lib/push/send.ts (rolling pool of 10, per-send
// and overall deadlines, send-time allow-list check) so one slow or hostile
// endpoint can't hold up every other rider's alert.

import webpush from "web-push";
import { zoneIdForPoint } from "../hotzones";
import { pushCooldownKey } from "../storage-keys";
import {
  type AlertPrefs,
  type StoredSubscription,
  type UserZoneSpec,
} from "./store";
import {
  defaultPushDeps,
  sendToSubscriptions,
  type PushDeps,
  type SendOptions,
} from "./send";
import type { Mission, MissionScope, PoliceUnit, RoleConfidence } from "../types";
import { effectiveMissions } from "./types";
import { inWashingtonAirspace, normalizeMission } from "../mission";

/** One alert per tail per 20 minutes, claimed atomically (SET NX EX). */
export const COOLDOWN_TTL_SECONDS = 20 * 60;
const MAX_BODY_CHARS = 140;
/** Push TTL: an alert older than 10 minutes is stale, let the service drop it. */
const PUSH_TTL_SECONDS = 600;

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
  /** Mission (legacy role values are normalized). */
  role: Mission;
  policeUnit?: PoliceUnit;
  /** 'mutual_aid' police only match 'police' inside WA airspace. */
  scope?: MissionScope;
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

export type DispatchOptions = Partial<Omit<SendOptions, "ttl">> & {
  /** Test seam: skip the VAPID env check. */
  skipVapidCheck?: boolean;
};

export async function dispatchTakeoff(
  args: DispatchTakeoffArgs,
  deps: PushDeps = defaultPushDeps,
  opts: DispatchOptions = {},
): Promise<DispatchResult> {
  if (!opts.skipVapidCheck && !ensureVapid()) {
    return { sent: 0, skipped: 0, removed: 0, reason: "vapid_not_configured" };
  }

  const cooldownKey = pushCooldownKey(args.tail);
  let subs: StoredSubscription[];
  let redis: Awaited<ReturnType<PushDeps["getRedis"]>> = null;
  try {
    redis = await deps.getRedis();
    if (redis) {
      // Atomic claim: concurrent snapshot regens race on the same key and
      // exactly one wins. Upstash returns null when NX finds the key set.
      const claimed = await redis.set(cooldownKey, "1", {
        nx: true,
        ex: COOLDOWN_TTL_SECONDS,
      });
      if (claimed === null) {
        return { sent: 0, skipped: 0, removed: 0, reason: "duplicate" };
      }
    }
    subs = await deps.listSubscriptions();
  } catch (e) {
    console.warn("[push] cooldown/list failed:", e);
    // Nothing was sent, so release the claim; otherwise a KV blip would
    // silence this tail for the full cooldown. Best-effort.
    if (redis) {
      try {
        await redis.del(cooldownKey);
      } catch {
        /* best-effort */
      }
    }
    return { sent: 0, skipped: 0, removed: 0, reason: "kv_error" };
  }
  if (subs.length === 0) {
    return { sent: 0, skipped: 0, removed: 0, reason: "no_subs" };
  }

  const matchMission = missionForMatching(args);
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
      matchMission,
      args.tail,
      args.lat,
      args.lon,
      aircraftZone,
    );
    if (skip) skipped++;
    else targets.push(stored);
  }

  // The cooldown stays claimed from here on. If the process dies mid-send
  // the remaining riders miss this takeoff rather than getting a retry;
  // takeoffs are one-shot diffs, so a retry path would need its own queue.
  const summary = await sendToSubscriptions(
    targets,
    payload,
    { ...opts, ttl: PUSH_TTL_SECONDS },
    deps,
  );
  return {
    sent: summary.sent,
    removed: summary.removed,
    skipped: skipped + summary.skipped,
  };
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

/**
 * The mission a takeoff is matched against rider prefs as. Mutual-aid
 * police outside Washington airspace match nothing (null), so an Oregon
 * unit lifting off at Salem never pings a Washington rider.
 */
export function missionForMatching(args: {
  role: unknown;
  scope?: MissionScope;
  lat: number | null;
  lon: number | null;
}): Mission | null {
  const m = normalizeMission(args.role);
  if (m === "police" && args.scope === "mutual_aid" && !inWashingtonAirspace(args.lat, args.lon)) {
    return null;
  }
  return m;
}

export function shouldSkip(
  prefs: AlertPrefs,
  mission: Mission | null,
  tail: string,
  lat: number | null,
  lon: number | null,
  aircraftZone: string | null,
): boolean {
  // missions — default ['police'] (Smokey only). Rows from before the
  // taxonomy fall back to their legacy tier via effectiveMissions().
  if (mission === null || !effectiveMissions(prefs).includes(mission)) return true;
  // tail allow-list — applied AFTER the mission filter, so it narrows
  // within the missions the rider picked.
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
  const mission = normalizeMission(args.role);
  let title: string;
  let body: string;
  // Only police read "Smokey's up." Every other mission names itself.
  switch (mission) {
    case "police":
      title = "Smokey's up.";
      body =
        args.policeUnit === "wsp"
          ? trimBody(`${name} watching. ${altStr}.`)
          : trimBody(`${name} airborne. ${altStr}.`);
      break;
    case "federal_le":
      title = "Federal up.";
      body = trimBody(`${name} airborne. Not Smokey. ${altStr}.`);
      break;
    case "sar":
      title = "SAR run.";
      body = trimBody(`${name} on a rescue run.`);
      break;
    case "wildfire":
      title = "Fire run.";
      body = trimBody(`${name} on a fire run.`);
      break;
    case "medevac":
      title = "Medevac up.";
      body = trimBody(`${name} on a medical run.`);
      break;
    case "survey":
      title = "Survey up.";
      body = trimBody(`${name} airborne. ${altStr}.`);
      break;
    case "transport":
      title = "Transport up.";
      body = trimBody(`${name} airborne. ${altStr}.`);
      break;
    case "unknown":
    default:
      title = "Unconfirmed bird up.";
      body = trimBody(`${name} airborne. Not confirmed as Smokey. ${altStr}.`);
      break;
  }
  return {
    title,
    body,
    tag: `smokey-${args.tail}`,
    data: { url: `/plane/${args.tail}`, tail: args.tail, role: mission },
  };
}

function trimBody(s: string): string {
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS - 1) + "…";
}
