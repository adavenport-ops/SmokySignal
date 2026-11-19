// Run: npx tsx --test lib/alerts-ux.test.ts
//
// The blocked-alerts help line must match the rider's platform. The
// audit caught Android/Chrome riders being told to open "Safari".

import { test } from "node:test";
import assert from "node:assert";
import { blockedAlertsHelp, detectAlertsPlatform } from "./alerts-ux";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  ipadOS:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  firefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  edge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
};

test("detectAlertsPlatform: iPhone and touch-Mac iPad are ios", () => {
  assert.equal(detectAlertsPlatform(UA.iphone), "ios");
  assert.equal(detectAlertsPlatform(UA.ipadOS, 5), "ios");
});

test("detectAlertsPlatform: Android Chrome is android, not mac-safari", () => {
  assert.equal(detectAlertsPlatform(UA.androidChrome), "android");
});

test("detectAlertsPlatform: desktop browsers", () => {
  assert.equal(detectAlertsPlatform(UA.macChrome), "chromium-desktop");
  assert.equal(detectAlertsPlatform(UA.edge), "chromium-desktop");
  assert.equal(detectAlertsPlatform(UA.macSafari), "mac-safari");
  assert.equal(detectAlertsPlatform(UA.firefox), "firefox");
});

test("blockedAlertsHelp: never says Safari off Apple platforms", () => {
  for (const p of ["android", "firefox", "chromium-desktop", "other"] as const) {
    assert.ok(!/safari/i.test(blockedAlertsHelp(p)), p);
  }
});

test("blockedAlertsHelp: no exclamation marks", () => {
  for (const p of [
    "ios",
    "android",
    "mac-safari",
    "firefox",
    "chromium-desktop",
    "other",
  ] as const) {
    assert.ok(!blockedAlertsHelp(p).includes("!"), p);
  }
});
