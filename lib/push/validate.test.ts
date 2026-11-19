// Run: npx tsx --test lib/push/*.test.ts
//
// Pins the push hardening contract: the server only stores and POSTs to
// browser push-service endpoints, keeps only { endpoint, keys }, and
// rejects malformed prefs before they reach KV.

import { test } from "node:test";
import assert from "node:assert";
import {
  isAllowedPushEndpoint,
  normalizeUserZone,
  parsePushSubscription,
  validatePrefsInput,
  validateTz,
  MAX_USER_ZONES,
} from "./validate";
import { DEFAULT_PREFS } from "./types";

// 65-byte P-256 point and 16-byte auth secret, base64url, as browsers emit.
const P256DH = Buffer.alloc(65, 4).toString("base64url");
const AUTH = Buffer.alloc(16, 7).toString("base64url");

function sub(endpoint: string, extra: Record<string, unknown> = {}) {
  return { endpoint, keys: { p256dh: P256DH, auth: AUTH }, ...extra };
}

// ─── Endpoint allow-list ─────────────────────────────────────────────

test("endpoint allow-list: accepts the browser push services", () => {
  for (const ep of [
    "https://fcm.googleapis.com/fcm/send/abc123:APA91b",
    "https://web.push.apple.com/QGx1Y2t5",
    "https://api.push.apple.com/3/device/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    "https://FCM.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:443/fcm/send/x",
  ]) {
    assert.equal(isAllowedPushEndpoint(ep), true, ep);
  }
});

test("endpoint allow-list: rejects other hosts, http, and suffix tricks", () => {
  for (const ep of [
    "https://evil.com/fcm/send/x",
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.com/fcm/send/x",
    "https://evilfcm.googleapis.com/x",
    "https://evilpush.apple.com/x",
    "https://push.apple.com.evil.com/x",
    "https://notify.windows.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "ftp://fcm.googleapis.com/x",
    "not a url",
    "",
    `https://fcm.googleapis.com/${"a".repeat(3000)}`,
    // trailing dot: a different DNS name to the exact-match set
    "https://fcm.googleapis.com./fcm/send/x",
    "https://web.push.apple.com./x",
    // IPv6 literals
    "https://[::1]/x",
    "https://[2001:db8::1]/fcm/send/x",
    "https://[::ffff:169.254.169.254]/x",
    // backslash: WHATWG reads it as "/", legacy url.parse may not
    "https://evil.com\\@fcm.googleapis.com/x",
    "https://fcm.googleapis.com\\.evil.com/x",
    // percent-escapes in the authority
    "https://fcm%2egoogleapis.com/x",
    "https://fcm.googleapis.com%2eevil.com/x",
    "https://evil.com%2f@fcm.googleapis.com/x",
  ]) {
    assert.equal(isAllowedPushEndpoint(ep), false, ep);
  }
  assert.equal(isAllowedPushEndpoint(undefined), false);
  assert.equal(isAllowedPushEndpoint(42), false);
});

// ─── Subscription parsing ────────────────────────────────────────────

test("parsePushSubscription: keeps only endpoint + keys", () => {
  const parsed = parsePushSubscription(
    sub("https://fcm.googleapis.com/fcm/send/x", {
      expirationTime: null,
      junk: "x".repeat(10_000),
      keys: { p256dh: P256DH, auth: AUTH, extra: "nope" },
    }),
  );
  assert.deepStrictEqual(parsed, {
    endpoint: "https://fcm.googleapis.com/fcm/send/x",
    keys: { p256dh: P256DH, auth: AUTH },
  });
});

test("parsePushSubscription: stores the normalized new URL(endpoint).href", () => {
  const parsed = parsePushSubscription(sub("https://FCM.googleapis.com:443/fcm/send/a/../x"));
  assert.equal(parsed?.endpoint, "https://fcm.googleapis.com/fcm/send/x");
  // Path escapes are fine (only the authority is restricted) and normalize.
  const dotted = parsePushSubscription(sub("https://fcm.googleapis.com/fcm/send/%2e%2e/x"));
  assert.equal(dotted?.endpoint, "https://fcm.googleapis.com/fcm/x");
});

test("parsePushSubscription: rejects off-list endpoints and bad keys", () => {
  assert.equal(parsePushSubscription(sub("https://evil.com/x")), null);
  assert.equal(parsePushSubscription(null), null);
  assert.equal(parsePushSubscription("x"), null);
  const ep = "https://fcm.googleapis.com/fcm/send/x";
  assert.equal(parsePushSubscription({ endpoint: ep }), null);
  assert.equal(
    parsePushSubscription({ endpoint: ep, keys: { p256dh: "short", auth: AUTH } }),
    null,
  );
  assert.equal(
    parsePushSubscription({ endpoint: ep, keys: { p256dh: P256DH, auth: "a+b/c==" } }),
    null,
  );
  assert.equal(
    parsePushSubscription({ endpoint: ep, keys: { p256dh: P256DH, auth: "A".repeat(500) } }),
    null,
  );
  assert.equal(
    parsePushSubscription({ endpoint: ep, keys: { p256dh: 1, auth: AUTH } }),
    null,
  );
});

// ─── Prefs validation ────────────────────────────────────────────────

test("validateTz: accepts IANA zones, rejects junk and overlong strings", () => {
  assert.equal(validateTz("America/Los_Angeles"), "America/Los_Angeles");
  assert.equal(validateTz("UTC"), "UTC");
  assert.equal(validateTz("Not/AZone"), null);
  assert.equal(validateTz(""), null);
  assert.equal(validateTz(123), null);
  assert.equal(validateTz("A".repeat(65)), null);
});

test("validatePrefsInput: empty input is valid", () => {
  assert.deepStrictEqual(validatePrefsInput(undefined), { ok: true, prefs: {} });
  assert.deepStrictEqual(validatePrefsInput(null), { ok: true, prefs: {} });
});

test("validatePrefsInput: accepts a normal client payload and drops unknown keys", () => {
  const r = validatePrefsInput({
    tier: "all",
    zones: "any",
    quiet_start_h: 23,
    quiet_end_h: 6,
    tz: "America/Los_Angeles",
    tails: ["N305DK"],
    evil: "x",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepStrictEqual(r.prefs, {
    tier: "all",
    zones: "any",
    quiet_start_h: 23,
    quiet_end_h: 6,
    tz: "America/Los_Angeles",
    tails: ["N305DK"],
  });
});

test("validatePrefsInput: unrecognized tz falls back to the default instead of failing", () => {
  for (const tz of ["Mars/Olympus_Mons", "A".repeat(100), 42, ""]) {
    assert.deepStrictEqual(
      validatePrefsInput({ tz }),
      { ok: true, prefs: { tz: DEFAULT_PREFS.tz } },
      String(tz),
    );
  }
});

test("validatePrefsInput: rejects bad tier, hours, and non-object", () => {
  for (const [input, error] of [
    [{ tier: "everything" }, "invalid_tier"],
    [{ quiet_start_h: 24 }, "invalid_quiet_start_h"],
    [{ quiet_end_h: 1.5 }, "invalid_quiet_end_h"],
    [[1, 2], "invalid_prefs"],
    ["x", "invalid_prefs"],
  ] as const) {
    const r = validatePrefsInput(input);
    assert.deepStrictEqual(r, { ok: false, error }, JSON.stringify(input));
  }
});

test("validatePrefsInput: zones must be <= 20 known hot-zone cell ids", () => {
  const ok = validatePrefsInput({ zones: ["47.6000,-122.3000", "47.6000,-122.3000"] });
  assert.deepStrictEqual(ok, { ok: true, prefs: { zones: ["47.6000,-122.3000"] } });

  const tooMany = Array.from({ length: 21 }, (_, i) => `47.${String(i).padStart(4, "0")},-122.3000`);
  assert.deepStrictEqual(validatePrefsInput({ zones: tooMany }), {
    ok: false,
    error: "invalid_zones",
  });
  for (const zones of [["evil"], ["47.6,-122.3"], ["99.0000,-122.3000"], [1], "some"]) {
    assert.deepStrictEqual(
      validatePrefsInput({ zones }),
      { ok: false, error: "invalid_zones" },
      JSON.stringify(zones),
    );
  }
});

test("validatePrefsInput: userZones are range-checked, rounded to ~1 km, and capped", () => {
  const r = validatePrefsInput({
    userZones: [{ lat: 47.608013, lon: -122.335167, radiusNm: 5, label: "Home", id: "x" }],
  });
  assert.deepStrictEqual(r, {
    ok: true,
    prefs: { userZones: [{ lat: 47.61, lon: -122.34, radiusNm: 5, label: "Home" }] },
  });

  const many = Array.from({ length: 30 }, () => ({
    lat: 47.6,
    lon: -122.3,
    radiusNm: 5,
    label: "z",
  }));
  const capped = validatePrefsInput({ userZones: many });
  assert.equal(capped.ok, true);
  if (capped.ok) assert.equal(capped.prefs.userZones?.length, MAX_USER_ZONES);

  for (const z of [
    { lat: 91, lon: 0, radiusNm: 5, label: "x" },
    { lat: 0, lon: -181, radiusNm: 5, label: "x" },
    { lat: 0, lon: 0, radiusNm: 0, label: "x" },
    { lat: 0, lon: 0, radiusNm: 10_000, label: "x" },
    { lat: Number.NaN, lon: 0, radiusNm: 5, label: "x" },
    { lat: "47", lon: 0, radiusNm: 5, label: "x" },
    { lat: 0, lon: 0, radiusNm: 5 },
  ]) {
    assert.deepStrictEqual(
      validatePrefsInput({ userZones: [z] }),
      { ok: false, error: "invalid_user_zones" },
      JSON.stringify(z),
    );
  }
  assert.deepStrictEqual(validatePrefsInput({ userZones: "x" }), {
    ok: false,
    error: "invalid_user_zones",
  });
});

test("normalizeUserZone: truncates long labels", () => {
  const z = normalizeUserZone({ lat: 47, lon: -122, radiusNm: 5, label: "x".repeat(200) });
  assert.equal(z?.label.length, 64);
});
