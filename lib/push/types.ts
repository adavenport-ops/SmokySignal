// Pure types + defaults for the push pipeline. No node:* imports — this
// file is safe for client bundles. Server-only code (KV ops, web-push
// sending) lives in lib/push/store.ts and lib/push/dispatcher.ts.

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
