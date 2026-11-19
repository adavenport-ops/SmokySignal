// Run: npx tsx --test lib/speed-warning.test.ts
//
// N1b speed warning: the trigger (police only), the hysteresis machine,
// the copy formatter, the mute timer, the limit source, and the privacy
// guarantee that nothing in the warning path touches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BIRD_RADIUS_NM,
  CLEAR_AFTER_MS,
  DEFAULT_RIDER_LIMIT_MPH,
  INITIAL_WARN_STATE,
  MAX_RIDER_LIMIT_MPH,
  MIN_RIDER_LIMIT_MPH,
  MUTE_MS,
  SHOW_AFTER_POSITIVE_TICKS,
  clampRiderLimitMph,
  evaluateWarning,
  formatWarning,
  isMuted,
  muteMinutesLeft,
  muteUntilFrom,
  resolveLimitMph,
  runWarningTick,
  speedMphFromMps,
  stepWarning,
  type SpeedWarningInput,
  type SpeedWarningResult,
  type WarnState,
} from "./speed-warning";
import { CORRIDOR_DEFAULT_LIMIT_MPH, CORRIDORS, corridorDefaultLimit } from "./corridor";
import { offsetNm } from "./geo-fixtures.test-helpers";
import type { Aircraft } from "./types";

// Fife, on I-5.
const RIDER = { lat: 47.24, lon: -122.36 };
const T0 = Date.parse("2026-11-18T15:12:00Z");

function ac(
  tail: string,
  role: string,
  pos: { lat: number; lon: number } | null,
  extra: Partial<Aircraft> = {},
): Aircraft {
  return {
    tail,
    icao24: "a00000",
    operator: "WSP",
    model: "Cessna 206H",
    nickname: null,
    roleDescription: "",
    base: "KOLM Olympia",
    role,
    roleConfidence: "confirmed",
    sources: [],
    airborne: true,
    ...(pos ?? {}),
    ...extra,
  } as unknown as Aircraft;
}

const birdAt = (eastNm: number, role = "police", extra: Partial<Aircraft> = {}) =>
  ac("N305DK", role, offsetNm(RIDER.lat, RIDER.lon, eastNm, 0), extra);

function input(over: Partial<SpeedWarningInput> = {}): SpeedWarningInput {
  return {
    riderLat: RIDER.lat,
    riderLon: RIDER.lon,
    riderSpeedMph: 69,
    postedLimitMph: 60,
    hotZones: [offsetNm(RIDER.lat, RIDER.lon, 0.2, 0)],
    airborneAircraft: [birdAt(1)],
    ...over,
  };
}

const fire: SpeedWarningResult = evaluateWarning(input());
const under: SpeedWarningResult = evaluateWarning(input({ riderSpeedMph: 55 }));
const birdGone: SpeedWarningResult = evaluateWarning(input({ airborneAircraft: [birdAt(8)] }));

function fix(s: WarnState, result: SpeedWarningResult, now: number): WarnState {
  return stepWarning(s, { kind: "fix", now, result });
}

// --- trigger ----------------------------------------------------------

test("fires when over by more than 2 mph, in a zone, police bird within 5 nm", () => {
  assert.equal(fire.wouldFire, true);
  assert.ok(Math.abs(fire.riderOverLimitBy - 9) < 1e-9);
  assert.ok(fire.nearestBirdMi! > 0.99 && fire.nearestBirdMi! < 1.01);
});

test("2 mph tolerance: +2 does not fire, +2.5 does", () => {
  assert.equal(evaluateWarning(input({ riderSpeedMph: 62 })).wouldFire, false);
  assert.equal(evaluateWarning(input({ riderSpeedMph: 62.5 })).wouldFire, true);
});

test("outside every hot zone (> 0.5 nm from a cell center) does not fire", () => {
  const r = evaluateWarning(input({ hotZones: [offsetNm(RIDER.lat, RIDER.lon, 0.6, 0)] }));
  assert.equal(r.wouldFire, false);
  assert.match(r.reason, /not in zone/);
});

test("bird past 5 nm does not fire", () => {
  assert.equal(birdGone.wouldFire, false);
  assert.match(birdGone.reason, /no bird nearby/);
});

test("NaN speed never fires", () => {
  assert.equal(evaluateWarning(input({ riderSpeedMph: Number.NaN })).wouldFire, false);
});

// --- police-only filtering ----------------------------------------------

test("police only: sar, medevac, wildfire, survey, transport, federal_le, unknown never fire", () => {
  for (const role of ["sar", "medevac", "wildfire", "survey", "transport", "federal_le", "unknown"]) {
    const r = evaluateWarning(input({ airborneAircraft: [birdAt(1, role)] }));
    assert.equal(r.wouldFire, false, role);
    assert.equal(r.nearestBirdMi, null, `${role} must not count as the nearest bird`);
  }
});

test("legacy smokey and patrol roles map to police and fire", () => {
  for (const role of ["smokey", "patrol", "police"]) {
    assert.equal(evaluateWarning(input({ airborneAircraft: [birdAt(1, role)] })).wouldFire, true, role);
  }
});

test("a close medevac does not mask a farther police bird; distance is the police one", () => {
  const r = evaluateWarning(
    input({ airborneAircraft: [birdAt(0.3, "medevac"), birdAt(3, "police")] }),
  );
  assert.equal(r.wouldFire, true);
  assert.ok(r.nearestBirdMi! > 2.9 && r.nearestBirdMi! < 3.1);
});

test("grounded police, or police with no position, does not fire", () => {
  assert.equal(
    evaluateWarning(input({ airborneAircraft: [birdAt(1, "police", { airborne: false })] })).wouldFire,
    false,
  );
  assert.equal(evaluateWarning(input({ airborneAircraft: [ac("N1", "police", null)] })).wouldFire, false);
});

test("mutual-aid police counts only inside Washington airspace", () => {
  const inWa = birdAt(1, "police", { scope: "mutual_aid" } as Partial<Aircraft>);
  assert.equal(evaluateWarning(input({ airborneAircraft: [inWa] })).wouldFire, true);
  // Same aircraft over Portland (lat < 45.5), rider too.
  const pdx = { lat: 45.4, lon: -122.68 };
  const out = ac("N2", "police", offsetNm(pdx.lat, pdx.lon, 1, 0), { scope: "mutual_aid" } as Partial<Aircraft>);
  const r = evaluateWarning(
    input({ riderLat: pdx.lat, riderLon: pdx.lon, hotZones: [pdx], airborneAircraft: [out] }),
  );
  assert.equal(r.wouldFire, false);
});

// --- hysteresis ---------------------------------------------------------

test(`shows only after ${SHOW_AFTER_POSITIVE_TICKS} consecutive positive fixes`, () => {
  let s = fix(INITIAL_WARN_STATE, fire, T0);
  assert.equal(s.phase, "arming");
  s = fix(s, fire, T0 + 1000);
  assert.equal(s.phase, "showing");
  assert.ok(s.detail && Math.round(s.detail.overMph) === 9);
});

test("a non-positive fix between positives resets the streak", () => {
  let s = fix(INITIAL_WARN_STATE, fire, T0);
  s = fix(s, under, T0 + 1000);
  assert.equal(s.phase, "idle");
  s = fix(s, fire, T0 + 2000);
  assert.equal(s.phase, "arming");
  s = fix(s, fire, T0 + 3000);
  assert.equal(s.phase, "showing");
});

test("fleet refreshes and clock ticks never count toward showing", () => {
  let s = fix(INITIAL_WARN_STATE, fire, T0);
  s = stepWarning(s, { kind: "fleet", now: T0 + 200, result: fire });
  s = stepWarning(s, { kind: "fleet", now: T0 + 400, result: fire });
  s = stepWarning(s, { kind: "clock", now: T0 + 500 });
  assert.equal(s.phase, "arming");
});

test("stays up while under for < 10 s, clears at 10 s below threshold", () => {
  let s = fix(fix(INITIAL_WARN_STATE, fire, T0), fire, T0 + 1000);
  s = fix(s, under, T0 + 2000);
  assert.equal(s.phase, "showing");
  s = fix(s, under, T0 + 2000 + CLEAR_AFTER_MS - 1);
  assert.equal(s.phase, "showing");
  s = fix(s, under, T0 + 2000 + CLEAR_AFTER_MS);
  assert.equal(s.phase, "idle");
});

test("the 10 s clear also runs off the clock when fixes stop arriving", () => {
  let s = fix(fix(INITIAL_WARN_STATE, fire, T0), fire, T0 + 1000);
  s = fix(s, under, T0 + 2000);
  s = stepWarning(s, { kind: "clock", now: T0 + 2000 + CLEAR_AFTER_MS - 1 });
  assert.equal(s.phase, "showing");
  s = stepWarning(s, { kind: "clock", now: T0 + 2000 + CLEAR_AFTER_MS });
  assert.equal(s.phase, "idle");
});

test("no GPS fix for 10 s stands a showing warning down", () => {
  let s = fix(fix(INITIAL_WARN_STATE, fire, T0), fire, T0 + 1000);
  s = stepWarning(s, { kind: "clock", now: T0 + 1000 + CLEAR_AFTER_MS });
  assert.equal(s.phase, "idle");
});

test("a positive fix during the grace period cancels the clear timer", () => {
  let s = fix(fix(INITIAL_WARN_STATE, fire, T0), fire, T0 + 1000);
  s = fix(s, under, T0 + 2000);
  s = fix(s, fire, T0 + 9000);
  assert.equal(s.belowSince, null);
  s = fix(s, under, T0 + 10_000);
  s = stepWarning(s, { kind: "clock", now: T0 + 15_000 });
  assert.equal(s.phase, "showing");
});

test("clears at once when the bird leaves the 5 nm radius (fix or fleet refresh)", () => {
  const up = fix(fix(INITIAL_WARN_STATE, fire, T0), fire, T0 + 1000);
  assert.equal(fix(up, birdGone, T0 + 1500).phase, "idle");
  assert.equal(stepWarning(up, { kind: "fleet", now: T0 + 1500, result: birdGone }).phase, "idle");
  // Bird landed / feed dropped it entirely.
  const none = evaluateWarning(input({ airborneAircraft: [] }));
  assert.equal(stepWarning(up, { kind: "fleet", now: T0 + 1500, result: none }).phase, "idle");
  assert.ok(birdGone.nearestBirdMi! > BIRD_RADIUS_NM);
});

test("a missing speed reading waits out the timer instead of clearing on one dropout", () => {
  let s = runWarningTick(INITIAL_WARN_STATE, "fix", input(), T0);
  s = runWarningTick(s, "fix", input(), T0 + 1000);
  assert.equal(s.phase, "showing");
  s = runWarningTick(s, "fix", null, T0 + 2000);
  assert.equal(s.phase, "showing");
  s = runWarningTick(s, "fix", null, T0 + 2000 + CLEAR_AFTER_MS);
  assert.equal(s.phase, "idle");
  // From idle, a missing reading stays idle.
  assert.equal(runWarningTick(INITIAL_WARN_STATE, "fix", null, T0).phase, "idle");
});

test("reset returns the initial state; steps never mutate their input", () => {
  const a = fix(INITIAL_WARN_STATE, fire, T0);
  const frozen = JSON.stringify(a);
  fix(a, fire, T0 + 1000);
  assert.equal(JSON.stringify(a), frozen);
  assert.deepEqual(stepWarning(a, { kind: "reset" }), INITIAL_WARN_STATE);
});

// --- copy -------------------------------------------------------------

test("copy uses the BRAND.md template verbatim", () => {
  const c = formatWarning({ birdNm: 4 / 1.150779, overMph: 7 });
  assert.equal(c.text, "EASE OFF — bird 4.0mi out, you're 7 over.");
  assert.equal(c.headline, "EASE OFF");
  assert.equal(c.detail, "bird 4.0mi out, you're 7 over.");
});

test("copy: nm converts to statute miles, one decimal under 10, whole above", () => {
  assert.equal(formatWarning({ birdNm: 1, overMph: 9 }).detail, "bird 1.2mi out, you're 9 over.");
  assert.equal(formatWarning({ birdNm: 9.5, overMph: 9 }).detail, "bird 11mi out, you're 9 over.");
  assert.equal(formatWarning({ birdNm: 0.01, overMph: 9 }).detail, "bird 0.1mi out, you're 9 over.");
});

test("copy: over-by rounds half up and never reads below 1", () => {
  assert.match(formatWarning({ birdNm: 1, overMph: 8.5 }).detail, /you're 9 over/);
  assert.match(formatWarning({ birdNm: 1, overMph: 8.49 }).detail, /you're 8 over/);
  assert.match(formatWarning({ birdNm: 1, overMph: 0.2 }).detail, /you're 1 over/);
  assert.match(formatWarning({ birdNm: 1, overMph: Number.NaN }).detail, /you're 1 over/);
});

test("copy: nm units read nautical miles and knots", () => {
  const c = formatWarning({ birdNm: 1.04, overMph: 9.2, units: "nm" });
  assert.equal(c.detail, "bird 1.0nm out, you're 8 kt over.");
  assert.equal(c.spoken, "Ease off. Bird 1.0 nautical miles out. You're 8 knots over.");
});

test("copy: spoken line spells units out; no exclamation marks, no emoji", () => {
  const c = formatWarning({ birdNm: 1, overMph: 9 });
  assert.equal(c.spoken, "Ease off. Bird 1.2 miles out. You're 9 over.");
  for (const line of [c.text, c.spoken, c.detail]) {
    assert.ok(!line.includes("!"), line);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(line), line);
    assert.ok(!/police|cop|slow down/i.test(line), line);
  }
});

// --- mute -------------------------------------------------------------

test("mute lasts exactly 10 minutes", () => {
  const until = muteUntilFrom(T0);
  assert.equal(until - T0, MUTE_MS);
  assert.equal(MUTE_MS, 600_000);
  assert.equal(isMuted(until, T0), true);
  assert.equal(isMuted(until, until - 1), true);
  assert.equal(isMuted(until, until), false);
  assert.equal(isMuted(null, T0), false);
  assert.equal(isMuted(Number.NaN, T0), false);
});

test("mute minutes left rounds up and hits 0 when expired", () => {
  const until = muteUntilFrom(T0);
  assert.equal(muteMinutesLeft(until, T0), 10);
  assert.equal(muteMinutesLeft(until, T0 + 1), 10);
  assert.equal(muteMinutesLeft(until, T0 + 9 * 60_000 + 1), 1);
  assert.equal(muteMinutesLeft(until, until), 0);
  assert.equal(muteMinutesLeft(undefined, T0), 0);
});

// --- limit source -------------------------------------------------------

test("rider limit defaults to 60 and clamps to a sane range", () => {
  assert.equal(DEFAULT_RIDER_LIMIT_MPH, 60);
  assert.equal(clampRiderLimitMph(undefined), 60);
  assert.equal(clampRiderLimitMph(""), 60);
  assert.equal(clampRiderLimitMph("abc"), 60);
  assert.equal(clampRiderLimitMph("62.4"), 62);
  assert.equal(clampRiderLimitMph(3), MIN_RIDER_LIMIT_MPH);
  assert.equal(clampRiderLimitMph(200), MAX_RIDER_LIMIT_MPH);
});

test("corridor defaults apply only when opted in and on the corridor", () => {
  const onI5 = resolveLimitMph({ riderLimitMph: 50, useCorridorDefaults: true, ...RIDER });
  assert.deepEqual(onI5, { limitMph: 60, source: "corridor", corridor: "I-5" });
  const optedOut = resolveLimitMph({ riderLimitMph: 50, useCorridorDefaults: false, ...RIDER });
  assert.deepEqual(optedOut, { limitMph: 50, source: "rider", corridor: null });
  // Middle of Puget Sound, nowhere near a corridor.
  const offRoad = resolveLimitMph({ riderLimitMph: 45, useCorridorDefaults: true, lat: 47.62, lon: -122.45 });
  assert.equal(offRoad.source, "rider");
  assert.equal(offRoad.limitMph, 45);
  assert.equal(corridorDefaultLimit(47.62, -122.45), null);
});

test("every corridor has a default limit and every default names a corridor", () => {
  const ids = new Set(CORRIDORS.map((c) => c.id));
  for (const c of CORRIDORS) assert.ok(CORRIDOR_DEFAULT_LIMIT_MPH[c.id], c.id);
  for (const id of Object.keys(CORRIDOR_DEFAULT_LIMIT_MPH)) assert.ok(ids.has(id), id);
});

test("device speed: m/s to mph, null for no reading", () => {
  assert.ok(Math.abs(speedMphFromMps(26.8224)! - 60) < 0.01);
  assert.equal(speedMphFromMps(null), null);
  assert.equal(speedMphFromMps(-1), null);
  assert.equal(speedMphFromMps(Number.NaN), null);
});

// --- privacy: nothing in the warning path touches the network -----------

test("the warning path makes no network call", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = {
    fetch: g.fetch,
    XMLHttpRequest: g.XMLHttpRequest,
    WebSocket: g.WebSocket,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  let calls = 0;
  const trap = () => {
    calls += 1;
    throw new Error("network call from the warning path");
  };
  g.fetch = trap;
  g.XMLHttpRequest = trap;
  g.WebSocket = trap;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { sendBeacon: trap },
  });
  try {
    let s = INITIAL_WARN_STATE;
    for (let i = 0; i < 30; i++) {
      const lim = resolveLimitMph({ riderLimitMph: 60, useCorridorDefaults: true, ...RIDER });
      s = runWarningTick(s, "fix", input({ postedLimitMph: lim.limitMph }), T0 + i * 1000);
      s = runWarningTick(s, "fleet", input(), T0 + i * 1000 + 500);
      s = stepWarning(s, { kind: "clock", now: T0 + i * 1000 + 900 });
      if (s.detail) formatWarning({ birdNm: s.detail.birdNm, overMph: s.detail.overMph });
    }
    muteMinutesLeft(muteUntilFrom(T0), T0);
    assert.equal(s.phase, "showing");
  } finally {
    g.fetch = saved.fetch;
    g.XMLHttpRequest = saved.XMLHttpRequest;
    g.WebSocket = saved.WebSocket;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator);
    else delete g.navigator;
  }
  assert.equal(calls, 0);
});

test("the warning path takes no fetch: no network API named in its source", () => {
  for (const file of ["speed-warning.ts", "corridor.ts", "geo.ts", "mission.ts"]) {
    const src = readFileSync(join(__dirname, file), "utf8")
      // comments may mention the words; code may not
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const api of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "localStorage", "import(\""]) {
      assert.ok(!src.includes(api), `${file} must not use ${api}`);
    }
  }
  // Every exported function is a plain function of its arguments.
  for (const fn of [evaluateWarning, stepWarning, runWarningTick, formatWarning, resolveLimitMph]) {
    assert.equal(typeof fn, "function");
    assert.ok(!/\bfetch\b/.test(String(fn)), fn.name);
  }
});
