// Run: npx tsx --test lib/alerts-reset.test.ts
//
// B21 alerts-reset nudge: when it shows (granted, no subscription, not
// switched off by the rider, not dismissed in 30 days), the copy, and the
// localStorage helpers behind "Not now" and the rider's own disarm.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALERTS_ARM_FAILED_KEY,
  ALERTS_DISARMED_KEY,
  ALERTS_RESET_ACTION,
  ALERTS_RESET_DISMISS_KEY,
  ALERTS_RESET_DISMISS_MS,
  ALERTS_RESET_LINE,
  PUSH_CHANGED_EVENT,
  alertsResetVisible,
  announcePushChanged,
  clearDisarmedByRider,
  dismissAlertsReset,
  markArmFailed,
  markDisarmedByRider,
  parseStoredMs,
  readResetDismissedAt,
  resetDismissedRecently,
  wasDisarmedByRider,
  type AlertsResetInput,
} from "./alerts-reset";

const NOW = Date.parse("2026-11-21T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function base(over: Partial<AlertsResetInput> = {}): AlertsResetInput {
  return {
    supported: true,
    contextAvailable: true,
    permission: "granted",
    hasSubscription: false,
    dismissedAt: null,
    disarmedByRider: false,
    now: NOW,
    ...over,
  };
}

test("shows when notifications are allowed but the browser holds no subscription", () => {
  assert.equal(alertsResetVisible(base()), true);
});

test("never shows for default or denied permission", () => {
  assert.equal(alertsResetVisible(base({ permission: "default" })), false);
  assert.equal(alertsResetVisible(base({ permission: "denied" })), false);
});

test("never shows when a subscription exists", () => {
  assert.equal(alertsResetVisible(base({ hasSubscription: true })), false);
});

test("never shows after the rider switched alerts off themselves", () => {
  assert.equal(alertsResetVisible(base({ disarmedByRider: true })), false);
});

test("never shows where push cannot run", () => {
  assert.equal(alertsResetVisible(base({ supported: false })), false);
  assert.equal(alertsResetVisible(base({ contextAvailable: false })), false);
});

test("Not now holds for 30 days, then the line can come back", () => {
  assert.equal(ALERTS_RESET_DISMISS_MS, 30 * DAY);
  assert.equal(alertsResetVisible(base({ dismissedAt: NOW - DAY })), false);
  assert.equal(alertsResetVisible(base({ dismissedAt: NOW - 30 * DAY + 1 })), false);
  assert.equal(alertsResetVisible(base({ dismissedAt: NOW - 30 * DAY })), true);
  assert.equal(alertsResetVisible(base({ dismissedAt: NOW - 45 * DAY })), true);
});

test("a dismissal stamped in the future still counts as dismissed", () => {
  assert.equal(resetDismissedRecently(NOW + DAY, NOW), true);
  assert.equal(resetDismissedRecently(null, NOW), false);
  assert.equal(resetDismissedRecently(Number.NaN, NOW), false);
});

test("stored timestamps: garbage, empty and non-positive read as none", () => {
  assert.equal(parseStoredMs(null), null);
  assert.equal(parseStoredMs(undefined), null);
  assert.equal(parseStoredMs(""), null);
  assert.equal(parseStoredMs("  "), null);
  assert.equal(parseStoredMs("abc"), null);
  assert.equal(parseStoredMs("0"), null);
  assert.equal(parseStoredMs("-5"), null);
  assert.equal(parseStoredMs(String(NOW)), NOW);
});

test("copy: the backlog line, no exclamation marks, no emoji", () => {
  assert.equal(`${ALERTS_RESET_LINE} ${ALERTS_RESET_ACTION}`, "Alerts were switched off by an update. Turn them back on");
  for (const s of [ALERTS_RESET_LINE, ALERTS_RESET_ACTION]) {
    assert.ok(!s.includes("!"));
    assert.ok(!/\p{Extended_Pictographic}/u.test(s));
  }
});

// --- storage -------------------------------------------------------------

const store = new Map<string, string>();
const events: string[] = [];
const g = globalThis as unknown as { window?: unknown };

beforeEach(() => {
  store.clear();
  events.length = 0;
  g.window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  };
});

test("Not now writes a timestamp that the rule then honours", () => {
  assert.equal(readResetDismissedAt(), null);
  dismissAlertsReset(NOW);
  assert.equal(store.get(ALERTS_RESET_DISMISS_KEY), String(NOW));
  assert.equal(readResetDismissedAt(), NOW);
  assert.equal(alertsResetVisible(base({ dismissedAt: readResetDismissedAt(), now: NOW + DAY })), false);
});

test("the rider's disarm is remembered until alerts are on again", () => {
  assert.equal(wasDisarmedByRider(), false);
  markDisarmedByRider(NOW);
  assert.equal(store.get(ALERTS_DISARMED_KEY), String(NOW));
  assert.equal(wasDisarmedByRider(), true);
  clearDisarmedByRider();
  assert.equal(wasDisarmedByRider(), false);
});

test("blocked storage never throws", () => {
  g.window = {
    localStorage: {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    },
    dispatchEvent: () => {
      throw new Error("no");
    },
  };
  assert.equal(readResetDismissedAt(), null);
  assert.equal(wasDisarmedByRider(), false);
  dismissAlertsReset(NOW);
  markDisarmedByRider(NOW);
  clearDisarmedByRider();
  announcePushChanged();
});

test("announcePushChanged fires the event the alerts chip listens for", () => {
  announcePushChanged();
  assert.deepEqual(events, [PUSH_CHANGED_EVENT]);
});

test("the push client marks a rider disarm and clears it on a fresh subscribe", () => {
  const src = readFileSync(join(__dirname, "push", "client.ts"), "utf8");
  const unsub = src.slice(src.indexOf("export async function unsubscribePush"));
  assert.match(unsub.slice(0, 400), /markDisarmedByRider\(\)/);
  const sub = src.slice(src.indexOf("export async function subscribePush"), src.indexOf("export async function unsubscribePush"));
  assert.match(sub, /accepted = true;\s*clearDisarmedByRider\(\);\s*announcePushChanged\(\);/);
  assert.ok(sub.indexOf("accepted = true") > sub.indexOf("if (!r.ok)"));
});

test("a rider's own failed Arm is not an update: no nudge, and a later subscribe clears it", () => {
  markArmFailed(NOW);
  assert.equal(store.get(ALERTS_ARM_FAILED_KEY), String(NOW));
  assert.equal(wasDisarmedByRider(), true);
  assert.equal(alertsResetVisible(base({ disarmedByRider: wasDisarmedByRider() })), false);
  markDisarmedByRider(NOW);
  clearDisarmedByRider();
  assert.equal(store.has(ALERTS_ARM_FAILED_KEY), false);
  assert.equal(store.has(ALERTS_DISARMED_KEY), false);
  assert.equal(wasDisarmedByRider(), false);
});

test("the push client marks a failed Arm on the rollback path and on a throw after granted", () => {
  const src = readFileSync(join(__dirname, "push", "client.ts"), "utf8");
  const sub = src.slice(src.indexOf("export async function subscribePush"), src.indexOf("export async function unsubscribePush"));
  // Granted is only set after the permission check passes.
  assert.ok(sub.indexOf("granted = true") > sub.indexOf('if (perm !== "granted")'));
  assert.match(sub, /await sub\.unsubscribe\(\);[\s\S]*?markArmFailed\(\);\s*return \{ ok: false, reason: "error"/);
  assert.match(sub, /catch \(error\) \{\s*if \(granted && !accepted\) markArmFailed\(\);/);
  // Denied and vapid_missing never mark it.
  const beforeGranted = sub.slice(0, sub.indexOf("granted = true"));
  assert.ok(!beforeGranted.includes("markArmFailed()"));
});
