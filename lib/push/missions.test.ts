// Run: npx tsx --test lib/push/missions.test.ts
//
// Push mission filtering: default prefs alert on police only, riders can
// opt in to other classes, legacy tier rows keep working, mutual-aid
// police outside WA match nothing, and prefs validation for `missions`.

import { test } from "node:test";
import assert from "node:assert";
import { missionForMatching, shouldSkip } from "./dispatcher";
import { DEFAULT_PREFS, effectiveMissions, type AlertPrefs } from "./types";
import { validatePrefsInput } from "./validate";
import { MISSIONS } from "../mission";

// Quiet hours off (start === end) so nothing depends on the wall clock.
const BASE: AlertPrefs = { ...DEFAULT_PREFS, quiet_start_h: 0, quiet_end_h: 0, tz: "UTC" };
const SEA = { lat: 47.6, lon: -122.3 };

function skip(prefs: AlertPrefs, role: string, extra: { scope?: "wa" | "mutual_aid"; lat?: number; lon?: number } = {}) {
  const lat = extra.lat ?? SEA.lat;
  const lon = extra.lon ?? SEA.lon;
  return shouldSkip(prefs, missionForMatching({ role, scope: extra.scope, lat, lon }), "N1", lat, lon, null);
}

test("default prefs are police only", () => {
  assert.deepEqual(DEFAULT_PREFS.missions, ["police"]);
  assert.deepEqual(effectiveMissions(DEFAULT_PREFS), ["police"]);
});

test("default prefs: police pings, every other mission is skipped", () => {
  assert.equal(skip(BASE, "police"), false);
  for (const m of MISSIONS.filter((x) => x !== "police")) {
    assert.equal(skip(BASE, m), true, m);
  }
});

test("opt-in: rider who adds wildfire hears fire runs and still hears police", () => {
  const p: AlertPrefs = { ...BASE, missions: ["police", "wildfire"] };
  assert.equal(skip(p, "wildfire"), false);
  assert.equal(skip(p, "police"), false);
  assert.equal(skip(p, "federal_le"), true);
});

test("opt-in without police: police no longer pings", () => {
  const p: AlertPrefs = { ...BASE, missions: ["sar"] };
  assert.equal(skip(p, "police"), true);
  assert.equal(skip(p, "sar"), false);
});

test("legacy rows: tier alert_only → police only; tier all → everything", () => {
  const legacyAlert = { ...BASE, missions: undefined, tier: "alert_only" as const };
  const legacyAll = { ...BASE, missions: undefined, tier: "all" as const };
  assert.equal(skip(legacyAlert, "police"), false);
  assert.equal(skip(legacyAlert, "federal_le"), true, "CBP no longer pings by default");
  assert.equal(skip(legacyAlert, "unknown"), true, "unconfirmed no longer pings by default");
  assert.equal(skip(legacyAll, "transport"), false);
  assert.equal(skip(legacyAll, "wildfire"), false);
});

test("legacy role values in the takeoff map to police", () => {
  assert.equal(skip(BASE, "smokey"), false);
  assert.equal(skip(BASE, "patrol"), false);
});

test("mutual aid: Oregon takeoff skipped for everyone, Vancouver counts", () => {
  const all: AlertPrefs = { ...BASE, missions: [...MISSIONS] };
  assert.equal(skip(all, "police", { scope: "mutual_aid", lat: 44.93, lon: -123.03 }), true);
  assert.equal(skip(BASE, "police", { scope: "mutual_aid", lat: 45.63, lon: -122.67 }), false);
});

test("tail allow-list narrows within the chosen missions", () => {
  const p: AlertPrefs = { ...BASE, tails: ["N305DK"] };
  assert.equal(shouldSkip(p, "police", "N305DK", SEA.lat, SEA.lon, null), false);
  assert.equal(shouldSkip(p, "police", "N422CT", SEA.lat, SEA.lon, null), true);
});

test("validatePrefsInput: missions accepted, normalized, and tier kept in step", () => {
  const r = validatePrefsInput({ missions: ["wildfire", "police", "smokey"] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.prefs.missions, ["police", "wildfire"]);
  assert.equal(r.prefs.tier, "alert_only");
  const all = validatePrefsInput({ missions: [...MISSIONS] });
  assert.equal(all.ok && all.prefs.tier, "all");
});

test("validatePrefsInput: bad missions rejected", () => {
  for (const missions of [[], "police", ["police", "helo"], [1], new Array(40).fill("police")]) {
    const r = validatePrefsInput({ missions });
    assert.equal(r.ok, false, JSON.stringify(missions).slice(0, 40));
    if (!r.ok) assert.equal(r.error, "invalid_missions");
  }
});

test("validatePrefsInput: tier-only payload from an old client becomes missions", () => {
  const r = validatePrefsInput({ tier: "alert_only" });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.prefs.missions, ["police"]);
});
