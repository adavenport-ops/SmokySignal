// Pure types + defaults for the push pipeline. No node:* imports — this
// file is safe for client bundles. Server-only code (KV ops, web-push
// sending) lives in lib/push/store.ts and lib/push/dispatcher.ts.

import type { Mission } from "../types";
import { DEFAULT_MISSIONS, MISSIONS, normalizeMissionList } from "../mission";

/**
 * @deprecated Superseded by `missions`. Still read for rows and clients
 * from before the mission taxonomy: 'alert_only' → ['police'],
 * 'all' → every mission.
 */
export type AlertTier = "all" | "alert_only";

/** Server-side mirror of a UserZone — coordinates + radius + label only,
 *  no IDs, no timestamps. The dispatcher matches takeoff coords against
 *  these on the server so a rider's zone list drives push routing. */
export type UserZoneSpec = {
  lat: number;
  lon: number;
  radiusNm: number;
  label: string;
};

export type AlertPrefs = {
  /**
   * Legacy tier, kept in sync with `missions` so older clients still read
   * a sensible value: 'all' when every mission is on, else 'alert_only'.
   */
  tier: AlertTier;
  /**
   * Which missions ping this rider. Default ['police'] (Smokey only).
   * Optional on the type because rows stored before the taxonomy lack it;
   * read it through effectiveMissions().
   */
  missions?: Mission[];
  /**
   * 'any' → push for any qualifying takeoff regardless of where it happens.
   * Otherwise an array of hot-zone cell IDs the rider has opted into.
   */
  zones: string[] | "any";
  /**
   * Rider-defined geofences (synced from lib/user-zones.ts). When present
   * + non-empty, the dispatcher matches takeoff coords against these in
   * addition to the predefined `zones` list — predefined OR user match
   * makes the takeoff eligible for that subscriber.
   */
  userZones?: UserZoneSpec[];
  /**
   * Optional per-tail allow-list. When present + non-empty, the dispatcher
   * only fires for takeoffs of these specific tails (after tier filter).
   * Empty / undefined = no tail restriction. Useful for riders who only
   * care about a specific Smokey.
   */
  tails?: string[];
  /** Rider-local hour at which quiet hours START (24-hour, 0-23). */
  quiet_start_h: number;
  /** Rider-local hour at which quiet hours END (24-hour, 0-23). */
  quiet_end_h: number;
  /** IANA TZ name; rider browser supplies it via Intl.DateTimeFormat. */
  tz: string;
};

export const DEFAULT_PREFS: AlertPrefs = {
  tier: "alert_only",
  missions: [...DEFAULT_MISSIONS],
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

/** Missions implied by a legacy tier value. */
export function missionsForTier(tier: AlertTier | undefined): Mission[] {
  return tier === "all" ? [...MISSIONS] : [...DEFAULT_MISSIONS];
}

/** Legacy tier implied by a mission set. */
export function tierForMissions(missions: readonly Mission[]): AlertTier {
  return MISSIONS.every((m) => missions.includes(m)) ? "all" : "alert_only";
}

/**
 * The missions a stored prefs row alerts on. A valid non-empty `missions`
 * list wins; otherwise the legacy tier decides; otherwise police only.
 */
export function effectiveMissions(
  prefs: { tier?: AlertTier; missions?: unknown },
): Mission[] {
  const list = normalizeMissionList(prefs.missions);
  if (list.length > 0) return list;
  return missionsForTier(prefs.tier);
}
