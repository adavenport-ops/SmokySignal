// Speed-warning evaluation (N1a trigger, N1b rider surface). Pure: no
// DOM, no storage, no network. Every function in this file takes plain
// values and returns plain values, so the whole warning path runs on the
// rider's device and nothing about position or speed can leave it from
// here (lib/speed-warning.test.ts asserts this).
//
// Used by components/SpeedWarning.tsx on /flights (Now) and /glance.
//
// Trigger condition (all must hold):
//   1. Rider speed > limit by more than SPEED_TOLERANCE_MPH (GPS jitter)
//   2. Rider is inside a hot zone (cell center within riderZoneRadiusNm)
//   3. A police-mission aircraft (countsAsSmokey) is airborne within
//      `birdThresholdNm` nautical miles of the rider (the rider's pick
//      in /settings: 2, 3 or 5 nm, default 5)
//
// All three are required because any one alone is too noisy:
//   - Speeding alone fires constantly on freeways
//   - In-a-hot-zone alone is the same as the existing zone alerts
//   - Bird-nearby alone is the existing proximity alert (P14)
//
// On top of the trigger sits a small hysteresis machine (stepWarning):
// show after SHOW_AFTER_POSITIVE_TICKS consecutive positive GPS fixes,
// clear after CLEAR_AFTER_MS without a positive fix, and clear at once
// when the bird leaves the radius.

import { haversineNm } from "./geo";
import type { Aircraft } from "./types";
import { countsAsSmokey } from "./mission";
import type { HotZone } from "./hotzones";
import { corridorDefaultLimit } from "./corridor";

// GPS speed jitters by ~2 mph at highway speeds. Don't fire on +1.
export const SPEED_TOLERANCE_MPH = 2;
/** "Bird nearby" radius, nm. The default; riders can pick a closer one. */
export const BIRD_RADIUS_NM = 5;
/** Radius picks offered in /settings, nm (B20). */
export const BIRD_RADIUS_CHOICES_NM = [2, 3, 5] as const;
export type BirdRadiusNm = (typeof BIRD_RADIUS_CHOICES_NM)[number];

/** A stored or tapped radius to one of the offered picks; anything else
 *  (missing, garbage, an old or hand-edited value) reads as the default. */
export function clampBirdRadiusNm(v: unknown): BirdRadiusNm {
  if (typeof v !== "number" && typeof v !== "string") return BIRD_RADIUS_NM;
  if (typeof v === "string" && v.trim() === "") return BIRD_RADIUS_NM;
  const n = Number(v);
  return (BIRD_RADIUS_CHOICES_NM as readonly number[]).includes(n)
    ? (n as BirdRadiusNm)
    : BIRD_RADIUS_NM;
}
/** "In a hot zone" radius around a cell center, nm. */
export const ZONE_RADIUS_NM = 0.5;

export type SpeedWarningInput = {
  riderLat: number;
  riderLon: number;
  riderSpeedMph: number;
  postedLimitMph: number;
  /** Center of recent fleet activity (lib/hotzones.ts). Only lat/lon used. */
  hotZones: Pick<HotZone, "lat" | "lon">[];
  /** Live snapshot of airborne aircraft (lib/snapshot.ts). */
  airborneAircraft: Aircraft[];
  /** Distance threshold for "bird nearby." Default 5nm. */
  birdThresholdNm?: number;
  /** Distance threshold for "in a hot zone." Default 0.5nm. */
  riderZoneRadiusNm?: number;
};

export type SpeedWarningResult = {
  /** All three conditions met. */
  wouldFire: boolean;
  /** Human-readable reason for the result (warning text or non-fire cause). */
  reason: string;
  /** Rider speed minus posted limit. Negative if under. */
  riderOverLimitBy: number;
  /** Distance to nearest hot-zone center, or null when no zones at all. */
  nearestZoneMi: number | null;
  /** Distance to the nearest airborne police-mission aircraft, or null
   *  when none is up. NAUTICAL miles despite the legacy name. */
  nearestBirdMi: number | null;
};

export function evaluateWarning(
  input: SpeedWarningInput,
): SpeedWarningResult {
  const birdThreshold = input.birdThresholdNm ?? BIRD_RADIUS_NM;
  const riderZoneRadius = input.riderZoneRadiusNm ?? ZONE_RADIUS_NM;
  const overLimit = input.riderSpeedMph - input.postedLimitMph;

  let nearestZoneMi: number | null = null;
  for (const z of input.hotZones) {
    const d = haversineNm(input.riderLat, input.riderLon, z.lat, z.lon);
    if (nearestZoneMi == null || d < nearestZoneMi) nearestZoneMi = d;
  }

  let nearestBirdMi: number | null = null;
  for (const a of input.airborneAircraft) {
    if (!a.airborne) continue;
    if (a.lat == null || a.lon == null) continue;
    if (!countsAsSmokey(a)) continue;
    const d = haversineNm(input.riderLat, input.riderLon, a.lat, a.lon);
    if (nearestBirdMi == null || d < nearestBirdMi) nearestBirdMi = d;
  }

  const speeding =
    Number.isFinite(overLimit) && overLimit > SPEED_TOLERANCE_MPH;
  const inZone = nearestZoneMi != null && nearestZoneMi <= riderZoneRadius;
  const birdNearby = nearestBirdMi != null && nearestBirdMi <= birdThreshold;

  if (speeding && inZone && birdNearby) {
    return {
      wouldFire: true,
      reason: `Over by ${overLimit.toFixed(0)} mph in a hot zone, bird ${nearestBirdMi!.toFixed(1)} nm out`,
      riderOverLimitBy: overLimit,
      nearestZoneMi,
      nearestBirdMi,
    };
  }

  // Build a non-firing reason explaining what's missing.
  const missing: string[] = [];
  if (!speeding) missing.push("under limit");
  if (!inZone) missing.push("not in zone");
  if (!birdNearby) missing.push("no bird nearby");
  return {
    wouldFire: false,
    reason: missing.join(", "),
    riderOverLimitBy: overLimit,
    nearestZoneMi,
    nearestBirdMi,
  };
}

// ---------------------------------------------------------------------
// Limit source. There is no posted-limit feed, so the limit is the
// rider's own number from /settings (default 60 mph). When the rider opts
// in, a corridor's usual limit (lib/corridor.ts) replaces it while the
// rider is on that corridor.
// ---------------------------------------------------------------------

export const DEFAULT_RIDER_LIMIT_MPH = 60;
export const MIN_RIDER_LIMIT_MPH = 15;
export const MAX_RIDER_LIMIT_MPH = 85;

/** Clamp a stored or typed limit to a sane whole number of mph. */
export function clampRiderLimitMph(v: unknown): number {
  if (typeof v === "string" && v.trim() === "") return DEFAULT_RIDER_LIMIT_MPH;
  if (typeof v !== "number" && typeof v !== "string") return DEFAULT_RIDER_LIMIT_MPH;
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_RIDER_LIMIT_MPH;
  return Math.min(MAX_RIDER_LIMIT_MPH, Math.max(MIN_RIDER_LIMIT_MPH, Math.round(n)));
}

export type ResolvedLimit = {
  limitMph: number;
  source: "rider" | "corridor";
  /** Corridor name when source is "corridor", e.g. "I-5". */
  corridor: string | null;
};

export function resolveLimitMph(opts: {
  riderLimitMph: number;
  useCorridorDefaults: boolean;
  lat: number;
  lon: number;
}): ResolvedLimit {
  const rider = clampRiderLimitMph(opts.riderLimitMph);
  if (opts.useCorridorDefaults) {
    const c = corridorDefaultLimit(opts.lat, opts.lon);
    if (c) return { limitMph: c.limitMph, source: "corridor", corridor: c.name };
  }
  return { limitMph: rider, source: "rider", corridor: null };
}

// ---------------------------------------------------------------------
// Hysteresis. A "tick" is one GPS fix evaluated with evaluateWarning().
// Fleet refreshes and the 1 s clock can only clear the warning, never
// count toward showing it.
// ---------------------------------------------------------------------

export const SHOW_AFTER_POSITIVE_TICKS = 2;
export const CLEAR_AFTER_MS = 10_000;

export type WarnPhase = "idle" | "arming" | "showing";

export type WarnDetail = {
  /** Rider speed minus limit, mph, at the last positive fix. */
  overMph: number;
  /** Rider to nearest police-mission bird, nm, at the last positive fix. */
  birdNm: number;
};

export type WarnState = {
  phase: WarnPhase;
  /** Consecutive positive fixes. */
  streak: number;
  /** When the current run of non-positive fixes began (showing only). */
  belowSince: number | null;
  /** Time of the last GPS fix seen. */
  lastFixAt: number | null;
  /** Numbers for the overlay; the last positive fix wins. */
  detail: WarnDetail | null;
};

export const INITIAL_WARN_STATE: WarnState = {
  phase: "idle",
  streak: 0,
  belowSince: null,
  lastFixAt: null,
  detail: null,
};

export type WarnEvent =
  | { kind: "fix"; now: number; result: SpeedWarningResult; birdRadiusNm?: number }
  | { kind: "fleet"; now: number; result: SpeedWarningResult; birdRadiusNm?: number }
  | { kind: "clock"; now: number }
  | { kind: "reset" };

function birdInRange(r: SpeedWarningResult, radiusNm: number): boolean {
  return r.nearestBirdMi != null && r.nearestBirdMi <= radiusNm;
}

function detailOf(r: SpeedWarningResult): WarnDetail {
  return { overMph: r.riderOverLimitBy, birdNm: r.nearestBirdMi ?? 0 };
}

function idleFrom(lastFixAt: number | null): WarnState {
  return { ...INITIAL_WARN_STATE, lastFixAt };
}

/** Pure hysteresis step. Never mutates `s`. */
export function stepWarning(s: WarnState, ev: WarnEvent): WarnState {
  if (ev.kind === "reset") return INITIAL_WARN_STATE;

  if (ev.kind === "clock") {
    if (s.phase === "idle") return s;
    // No fresh GPS fix for CLEAR_AFTER_MS: we can no longer say the rider
    // is over, so stand down.
    const fixStale = s.lastFixAt == null || ev.now - s.lastFixAt >= CLEAR_AFTER_MS;
    if (fixStale) return idleFrom(s.lastFixAt);
    if (s.phase === "showing" && s.belowSince != null && ev.now - s.belowSince >= CLEAR_AFTER_MS) {
      return idleFrom(s.lastFixAt);
    }
    return s;
  }

  const radiusNm = ev.birdRadiusNm ?? BIRD_RADIUS_NM;

  if (ev.kind === "fleet") {
    if (s.phase === "idle") return s;
    // The bird left the radius (or landed): clear at once.
    if (!birdInRange(ev.result, radiusNm)) return idleFrom(s.lastFixAt);
    if (s.phase === "showing" && ev.result.wouldFire) {
      return { ...s, detail: detailOf(ev.result) };
    }
    return s;
  }

  // GPS fix.
  const r = ev.result;
  if (r.wouldFire) {
    const streak = s.streak + 1;
    const showing = s.phase === "showing" || streak >= SHOW_AFTER_POSITIVE_TICKS;
    return {
      phase: showing ? "showing" : "arming",
      streak,
      belowSince: null,
      lastFixAt: ev.now,
      detail: detailOf(r),
    };
  }
  // Not positive. Arming resets; showing clears at once if the bird is
  // out of range, otherwise waits out CLEAR_AFTER_MS.
  if (s.phase !== "showing" || !birdInRange(r, radiusNm)) return idleFrom(ev.now);
  const belowSince = s.belowSince ?? ev.now;
  if (ev.now - belowSince >= CLEAR_AFTER_MS) return idleFrom(ev.now);
  return { ...s, streak: 0, belowSince, lastFixAt: ev.now };
}

/**
 * One evaluated tick: evaluateWarning() then stepWarning(). `input` null
 * means "no usable fix" (the device reported no speed). It counts as a
 * non-positive fix, so a showing warning starts its clear timer rather
 * than vanishing on one dropped reading. `birdRadiusNm` is the rider's
 * pick (default 5 nm); it overrides `input.birdThresholdNm` so the trigger
 * and the clear rule always use the same radius.
 */
export function runWarningTick(
  s: WarnState,
  kind: "fix" | "fleet",
  input: SpeedWarningInput | null,
  now: number,
  birdRadiusNm: number = input?.birdThresholdNm ?? BIRD_RADIUS_NM,
): WarnState {
  const result: SpeedWarningResult = input
    ? evaluateWarning({ ...input, birdThresholdNm: birdRadiusNm })
    : {
        wouldFire: false,
        reason: "no speed",
        riderOverLimitBy: Number.NaN,
        nearestZoneMi: null,
        nearestBirdMi: s.detail?.birdNm ?? null,
      };
  return stepWarning(s, { kind, now, result, birdRadiusNm });
}

// ---------------------------------------------------------------------
// Mute. "Mute 10 min" for when the rider is stopped. The overlay, voice
// and haptic all stay quiet until the timestamp passes.
// ---------------------------------------------------------------------

export const MUTE_MS = 10 * 60_000;

export function muteUntilFrom(now: number): number {
  return now + MUTE_MS;
}

export function isMuted(muteUntil: number | null | undefined, now: number): boolean {
  return typeof muteUntil === "number" && Number.isFinite(muteUntil) && now < muteUntil;
}

/** Whole minutes left on a mute, rounded up; 0 when not muted. */
export function muteMinutesLeft(muteUntil: number | null | undefined, now: number): number {
  if (!isMuted(muteUntil, now)) return 0;
  return Math.ceil(((muteUntil as number) - now) / 60_000);
}

// ---------------------------------------------------------------------
// Copy. design/BRAND.md section 3, verbatim template:
//   "EASE OFF — bird 4mi out, you're 7 over."
// ---------------------------------------------------------------------

export const NM_TO_MI = 1.150779;

/** Settings label for a radius pick: "3 nm · 3.5 mi". */
export function birdRadiusLabel(nm: number): { nm: string; mi: string } {
  return { nm: `${nm} nm`, mi: `${(Math.round(nm * NM_TO_MI * 10) / 10).toFixed(1)} mi` };
}
export type WarnUnits = "mi" | "nm";

export type WarningCopy = {
  headline: "EASE OFF";
  /** "bird 1.2mi out, you're 9 over." */
  detail: string;
  /** Full canonical line, "EASE OFF — bird 1.2mi out, you're 9 over." */
  text: string;
  /** Voice readback, spelled out for the synthesizer. */
  spoken: string;
};

/** One decimal under 10, whole numbers above; never reads below 0.1. */
function fmtDistance(v: number): string {
  if (!Number.isFinite(v) || v < 0.05) return "0.1";
  const tenths = Math.round(v * 10) / 10;
  return tenths < 10 ? tenths.toFixed(1) : String(Math.round(v));
}

/**
 * Rider-facing warning copy. `birdNm` is the evaluateWarning distance
 * (nautical miles). Units "mi" reads statute miles and mph over; "nm"
 * reads nautical miles and knots over. Over-by rounds to a whole number
 * and never reads below 1.
 */
export function formatWarning(opts: {
  birdNm: number;
  overMph: number;
  units?: WarnUnits;
}): WarningCopy {
  const units = opts.units ?? "mi";
  const dist = fmtDistance(units === "mi" ? opts.birdNm * NM_TO_MI : opts.birdNm);
  const overRaw = units === "mi" ? opts.overMph : opts.overMph / NM_TO_MI;
  const over = Math.max(1, Math.round(Number.isFinite(overRaw) ? overRaw : 1));
  const detail =
    units === "mi"
      ? `bird ${dist}mi out, you're ${over} over.`
      : `bird ${dist}nm out, you're ${over} kt over.`;
  const spoken =
    units === "mi"
      ? `Ease off. Bird ${dist} miles out. You're ${over} over.`
      : `Ease off. Bird ${dist} nautical miles out. You're ${over} knots over.`;
  return { headline: "EASE OFF", detail, text: `EASE OFF — ${detail}`, spoken };
}

/** m/s (Geolocation coords.speed) to mph. */
export const MPS_TO_MPH = 2.236936;

/** Device speed reading to mph, or null when the device gave none. */
export function speedMphFromMps(mps: number | null | undefined): number | null {
  if (typeof mps !== "number" || !Number.isFinite(mps) || mps < 0) return null;
  return mps * MPS_TO_MPH;
}
