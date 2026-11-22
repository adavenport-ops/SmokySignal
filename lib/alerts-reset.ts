// Alerts-reset nudge (B21). The 2026-11-19 store overwrite dropped every
// push subscription on the server. /api/push/resync brings back browsers
// that still hold one; this covers the rest: the browser still says
// notifications are allowed, but it holds no push subscription, so the
// rider gets nothing and never learns why.
//
// The rule is pure (alertsResetVisible) so it can be pinned in tests; the
// storage helpers below are the only browser-touching part. Everything
// stays in localStorage on the device.
//
//   ss_alerts_reset_dismissed_at  epoch ms; "Not now" hides it 30 days
//   ss_alerts_disarmed_at         epoch ms; the rider turned alerts off
//                                 themselves, so never call that a reset
//   ss_alerts_arm_failed_at       epoch ms; the rider's own Arm got as far
//                                 as "granted" and then failed. Also not an
//                                 update: they get the normal Arm card back

export const ALERTS_RESET_DISMISS_KEY = "ss_alerts_reset_dismissed_at";
export const ALERTS_DISARMED_KEY = "ss_alerts_disarmed_at";
export const ALERTS_ARM_FAILED_KEY = "ss_alerts_arm_failed_at";
export const ALERTS_RESET_DISMISS_DAYS = 30;
export const ALERTS_RESET_DISMISS_MS = ALERTS_RESET_DISMISS_DAYS * 24 * 60 * 60 * 1000;

/** Fired on window when this device's push subscription changes. */
export const PUSH_CHANGED_EVENT = "ss:push-changed";

export const ALERTS_RESET_LINE = "Alerts were switched off by an update.";
export const ALERTS_RESET_ACTION = "Turn them back on";

export type AlertsResetInput = {
  /** serviceWorker + PushManager + Notification all present. */
  supported: boolean;
  /** Push can run here (false for iOS Safari outside the home-screen app). */
  contextAvailable: boolean;
  permission: NotificationPermission;
  /** The browser holds a push subscription for this site. */
  hasSubscription: boolean;
  /** When the rider last tapped "Not now", or null. */
  dismissedAt: number | null;
  /** The rider turned alerts off in /settings/alerts, or their own Arm
   *  failed after permission was granted. Either way no update did it. */
  disarmedByRider: boolean;
  now: number;
};

/** True while a "Not now" from `dismissedAt` still holds at `now`. */
export function resetDismissedRecently(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt == null || !Number.isFinite(dismissedAt)) return false;
  const age = now - dismissedAt;
  // A timestamp from the future (clock change) counts as just dismissed.
  return age < ALERTS_RESET_DISMISS_MS;
}

/**
 * Show the nudge only when the rider once allowed alerts and the browser
 * no longer has the subscription: permission "granted", no subscription,
 * not switched off by the rider, not dismissed in the last 30 days.
 * Never for "default" or "denied" permission; those riders get the normal
 * opt-in card or the blocked help.
 */
export function alertsResetVisible(i: AlertsResetInput): boolean {
  if (!i.supported || !i.contextAvailable) return false;
  if (i.permission !== "granted") return false;
  if (i.hasSubscription) return false;
  if (i.disarmedByRider) return false;
  return !resetDismissedRecently(i.dismissedAt, i.now);
}

/** Stored epoch ms, or null for missing, empty or garbage values. */
export function parseStoredMs(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// --- storage (browser only; every call tolerates blocked storage) ------

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: holds for this page view only
  }
}

export function readResetDismissedAt(): number | null {
  return parseStoredMs(read(ALERTS_RESET_DISMISS_KEY));
}

export function dismissAlertsReset(now: number = Date.now()): void {
  write(ALERTS_RESET_DISMISS_KEY, String(Math.round(now)));
}

/** True when the missing subscription is the rider's own doing: they
 *  switched alerts off, or their own Arm failed after "granted". */
export function wasDisarmedByRider(): boolean {
  return (
    parseStoredMs(read(ALERTS_DISARMED_KEY)) != null ||
    parseStoredMs(read(ALERTS_ARM_FAILED_KEY)) != null
  );
}

/** The rider's Arm got permission, then the subscribe failed. */
export function markArmFailed(now: number = Date.now()): void {
  write(ALERTS_ARM_FAILED_KEY, String(Math.round(now)));
}

/** The rider switched alerts off on purpose. */
export function markDisarmedByRider(now: number = Date.now()): void {
  write(ALERTS_DISARMED_KEY, String(Math.round(now)));
}

/** Alerts are on again: forget the disarm and any failed Arm. */
export function clearDisarmedByRider(): void {
  write(ALERTS_DISARMED_KEY, null);
  write(ALERTS_ARM_FAILED_KEY, null);
}

export function announcePushChanged(): void {
  try {
    window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
  } catch {
    // no window
  }
}
