// Rider-facing alerts UX helpers that sit outside the push pipeline
// (lib/push/*): when to admit that the browser blocked alerts, and how
// to tell the rider to unblock them on the platform they're actually on.
//
// Rule: "ALERTS BLOCKED" only shows after the rider has tapped Arm at
// least once on this device. A browser that ships with notifications
// denied by default (headless, some privacy profiles, a permission set
// long ago) shouldn't greet a first-time visitor with an error about a
// thing they never asked for.

const ARM_TAPPED_KEY = "ss_arm_tapped_at";

/** Record that the rider tapped an Arm control. Storage failures are ignored. */
export function markArmTapped(): void {
  try {
    window.localStorage.setItem(ARM_TAPPED_KEY, String(Date.now()));
  } catch {
    // storage blocked: the blocked state just stays hidden
  }
}

/** True once the rider has tapped Arm on this device. */
export function hasTappedArm(): boolean {
  try {
    return Boolean(window.localStorage.getItem(ARM_TAPPED_KEY));
  } catch {
    return false;
  }
}

export type AlertsPlatform =
  | "ios"
  | "android"
  | "mac-safari"
  | "firefox"
  | "chromium-desktop"
  | "other";

/** Best-effort platform sniff from a user-agent string. Pure for tests. */
export function detectAlertsPlatform(
  ua: string,
  maxTouchPoints = 0,
): AlertsPlatform {
  const iPadOS = /Macintosh/.test(ua) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua)) {
    return "mac-safari";
  }
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return "chromium-desktop";
  return "other";
}

/**
 * One line telling the rider how to unblock notifications. Never names
 * Safari outside Apple platforms.
 */
export function blockedAlertsHelp(platform: AlertsPlatform): string {
  switch (platform) {
    case "ios":
      return "Alerts are blocked. Open iOS Settings → Notifications → SmokySignal and allow them.";
    case "android":
      return "Alerts are blocked. Tap the icon left of the address bar → Permissions → Notifications → Allow. Installed app: long-press the icon → App info → Notifications.";
    case "mac-safari":
      return "Alerts are blocked. Open Safari → Settings → Websites → Notifications and set SmokySignal to Allow.";
    case "firefox":
      return "Alerts are blocked. Click the icon left of the address bar and clear the notifications block.";
    case "chromium-desktop":
      return "Alerts are blocked. Click the icon left of the address bar → Notifications → Allow, then reload.";
    default:
      return "Alerts are blocked. Allow notifications for this site in your browser settings, then reload.";
  }
}

/** Convenience wrapper for components: sniff the current browser. */
export function currentBlockedAlertsHelp(): string {
  if (typeof navigator === "undefined") return blockedAlertsHelp("other");
  return blockedAlertsHelp(
    detectAlertsPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
  );
}
