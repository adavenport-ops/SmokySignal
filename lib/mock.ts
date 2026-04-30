// Dev/preview-only: force two tails into an airborne state so the
// "Smoky's watching." hero can be eyeballed when no plane is actually up.
// Triggered via `?mock=up` on the page or API routes.
//
// Data mirrors design/data.jsx LIVE_SNAPSHOT for Smoky + Guardian.

import type { Snapshot } from "./types";

const OVERRIDES: Record<
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

export function mockAirborneSnapshot(snap: Snapshot): Snapshot {
  return {
    ...snap,
    source: "mock",
    aircraft: snap.aircraft.map((a) => {
      const o = OVERRIDES[a.tail];
      if (!o) return a;
      return { ...a, ...o, airborne: true, last_seen_min: 0 };
    }),
  };
}

export function isMockOn(req: Request): boolean {
  return new URL(req.url).searchParams.get("mock") === "up";
}
