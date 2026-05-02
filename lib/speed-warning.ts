// Speed-warning evaluation. Pure function, no side effects. Used by:
//   - DashShell to log dry-run candidates to /api/dryrun-warnings
//   - (future N1b) the rider-facing warning surface
//
// Trigger condition (all must hold):
//   1. Rider speed > posted limit (with a small tolerance to absorb GPS jitter)
//   2. Rider is inside an active hot zone (zone center within riderZoneRadiusNm)
//   3. A tracked alert-tier (smokey | patrol | unknown) plane is airborne
//      within `birdThresholdNm` nautical miles of the rider
//
// All three are required because any one alone is too noisy:
//   - Speeding alone fires constantly on freeways
//   - In-a-hot-zone alone is the same as the existing zone alerts
//   - Bird-nearby alone is the existing proximity alert (P14)
//
// The combination — over-the-limit, where Smokey patrols, with Smokey overhead —
// is the actual "you're about to get a ticket" signal worth surfacing.

import { haversineNm } from "./geo";
import type { Aircraft, FleetRole } from "./types";
import type { HotZone } from "./hotzones";

// km per nautical mile (for the zone-radius check). 1 nm ≈ 1.852 km.
const ALERT_ROLES: ReadonlySet<FleetRole> = new Set([
  "smokey",
  "patrol",
  "unknown",
]);

// GPS speed jitters by ~2 mph at highway speeds. Don't fire on +1.
const SPEED_TOLERANCE_MPH = 2;

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
  /** Distance to nearest alert-tier airborne plane, or null when none up. */
  nearestBirdMi: number | null;
};

export function evaluateWarning(
  input: SpeedWarningInput,
): SpeedWarningResult {
  const birdThreshold = input.birdThresholdNm ?? 5;
  const riderZoneRadius = input.riderZoneRadiusNm ?? 0.5;
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
    if (!ALERT_ROLES.has(a.role)) continue;
    const d = haversineNm(input.riderLat, input.riderLon, a.lat, a.lon);
    if (nearestBirdMi == null || d < nearestBirdMi) nearestBirdMi = d;
  }

  const speeding = overLimit > SPEED_TOLERANCE_MPH;
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
