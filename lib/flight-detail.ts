// Per-flight detail derived from one session's track points: departure
// and arrival fields (lib/airports.ts), time spent in orbit patterns
// (lib/orbit.ts) and which corridors those patterns sat over
// (lib/corridor.ts).
//
// Pure: no I/O. Shared by the daily rollup (lib/rollup-core.ts, which
// stores the summary so it outlives any read of the raw points), the
// aircraft logbook (lib/logbook.ts) and the flight card.

import { inferArrival, inferDeparture } from "./airports";
import { detectOrbits, type OrbitSegment } from "./orbit";
import type { TrackPoint } from "./tracks";

/** Orbit seconds over one corridor label, e.g. "I-5 · Fife". */
export type CorridorTime = { label: string; s: number };

export type FlightDetail = {
  /** Departure field id (ICAO or FAA LID), or null when unresolved. */
  dep: string | null;
  /** Arrival field id, or null when unresolved or still airborne. */
  arr: string | null;
  /** Seconds spent in detected orbit / loiter patterns. */
  orbit_s: number;
  /** Orbit seconds by corridor label, most time first. Unlabelled patterns are left out. */
  corridors: CorridorTime[];
};

/** "I-5 · Fife" → "I-5". The road part of a corridor label. */
export function corridorRoad(label: string): string {
  return label.split(" · ")[0]!.trim();
}

/** Fold orbit segments into total seconds plus a per-corridor breakdown. */
export function summarizeOrbits(orbits: ReadonlyArray<OrbitSegment>): {
  orbit_s: number;
  corridors: CorridorTime[];
} {
  let total = 0;
  const by = new Map<string, number>();
  for (const o of orbits) {
    total += o.durationS;
    if (o.corridor) by.set(o.corridor, (by.get(o.corridor) ?? 0) + o.durationS);
  }
  return { orbit_s: total, corridors: sortCorridors(by) };
}

export function sortCorridors(by: Map<string, number>): CorridorTime[] {
  return [...by.entries()]
    .map(([label, s]) => ({ label, s }))
    .sort((a, b) => b.s - a.s || a.label.localeCompare(b.label));
}

/** Merge several corridor breakdowns into one, summing by label. */
export function mergeCorridors(lists: ReadonlyArray<ReadonlyArray<CorridorTime>>): CorridorTime[] {
  const by = new Map<string, number>();
  for (const list of lists) {
    for (const c of list) by.set(c.label, (by.get(c.label) ?? 0) + c.s);
  }
  return sortCorridors(by);
}

/** Departure, arrival and pattern summary for one session's points. */
export function flightDetailFromPoints(
  points: ReadonlyArray<TrackPoint>,
  inProgress = false,
): FlightDetail {
  if (points.length < 2) return { dep: null, arr: null, orbit_s: 0, corridors: [] };
  const dep = inferDeparture(points)?.id ?? null;
  const arr = inProgress ? null : (inferArrival(points)?.id ?? null);
  return { dep, arr, ...summarizeOrbits(detectOrbits(points)) };
}
