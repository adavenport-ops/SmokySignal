// Mock state machine for ?mock=<state> on rider-facing pages and API
// routes. Deterministic — same query param yields the same response
// shape, no randomness, no time-of-day drift.
//
// Snapshot-level states (this file): up, down, eyes-up, multiple, stale.
//
// Data-layer states (deferred to a follow-up): learning, full-data —
// those need overrides in lib/learning.ts and lib/predictor.ts. Tracking
// in the issue queue.

import type { Snapshot, FleetRole } from "./types";

export const MOCK_STATES = [
  "up",
  "down",
  "eyes-up",
  "multiple",
  "stale",
] as const;
export type MockState = (typeof MOCK_STATES)[number];

const TAIL_OVERRIDES: Record<
  string,
  Partial<{
    lat: number;
    lon: number;
    altitude_ft: number;
    ground_speed_kt: number;
    heading: number;
    time_aloft_min: number;
    squawk: string | null;
  }>
> = {
  N305DK: {
    lat: 47.5301,
    lon: -122.2612,
    altitude_ft: 2800,
    ground_speed_kt: 118,
    heading: 184,
    time_aloft_min: 47,
    squawk: "1234",
  },
  N422CT: {
    lat: 47.671,
    lon: -122.3345,
    altitude_ft: 1400,
    ground_speed_kt: 88,
    heading: 270,
    time_aloft_min: 12,
    squawk: "1200",
  },
};

function liftAirborne(
  snap: Snapshot,
  predicate: (role: FleetRole) => boolean,
  cap?: number,
): Snapshot {
  let lifted = 0;
  return {
    ...snap,
    source: "mock",
    aircraft: snap.aircraft.map((a) => {
      if (!predicate(a.role)) return a;
      if (cap != null && lifted >= cap) return a;
      lifted++;
      const o = TAIL_OVERRIDES[a.tail] ?? {};
      return {
        ...a,
        ...o,
        airborne: true,
        last_seen_min: 0,
      };
    }),
  };
}

export function parseMockState(value: string | null | undefined): MockState | null {
  if (!value) return null;
  return (MOCK_STATES as readonly string[]).includes(value) ? (value as MockState) : null;
}

export function getMockStateFromRequest(req: Request): MockState | null {
  return parseMockState(new URL(req.url).searchParams.get("mock"));
}

export function applyMockState(snap: Snapshot, state: MockState | null): Snapshot {
  if (!state) return snap;
  switch (state) {
    case "down":
      // All clear — every aircraft grounded, even if upstream had something
      // up. Useful for previewing the calm-sky home screen at any time.
      return {
        ...snap,
        source: "mock",
        aircraft: snap.aircraft.map((a) => ({ ...a, airborne: false })),
      };
    case "up":
      // At least one smokey-class up. The original mock=up behavior.
      return liftAirborne(snap, (r) => r === "smokey");
    case "eyes-up":
      // Patrol or unknown airborne, no smokey. Drives the EYES UP pill +
      // the amber-but-not-SMOKEY home variant.
      return liftAirborne(snap, (r) => r === "patrol" || r === "unknown");
    case "multiple":
      // 3 smokey-class + 1 patrol. Drives the "X up" pill sub and the
      // others-also-up list.
      return liftAirborne(
        liftAirborne(snap, (r) => r === "smokey", 3),
        (r) => r === "patrol",
        1,
      );
    case "stale":
      // Last sample > 15 min ago. Flips the FreshnessLabel amber and
      // surfaces the "Live cron may be down" tooltip.
      return {
        ...snap,
        source: "mock",
        fetched_at: Date.now() - 16 * 60 * 1000,
      };
  }
}
