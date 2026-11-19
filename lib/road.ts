// Road pages (/road/[id]): which flights spent time over one corridor in
// the last 30 days, when, over which stretch, and on what mission.
//
// Pure: no I/O, no clock reads. lib/history-digest.ts reads the tracks and
// activity feed and hands them in. History only: a quiet hour or stretch
// on these pages says nothing about the next ride.

import { CORRIDORS, distanceToPolylineNm, type Corridor } from "./corridor";
import { detectOrbits } from "./orbit";
import { haversineNm } from "./geo";
import { distributeMinutes } from "./rollup-core";
import { normalizeMission, MISSIONS } from "./mission";
import { missionLabel } from "./role-display";
import { cleanPoints, splitSessions } from "./circling";
import type { TrackPoint } from "./tracks";
import type { Mission } from "./types";

/** A point within this distance of the polyline counts as over the road, nm. */
export const ROAD_BUFFER_NM = 2;
export const ROAD_WINDOW_DAYS = 30;
export const ROAD_WEEK_DAYS = 7;
/** One sample stands for at most this much time, seconds. */
const MAX_SAMPLE_WEIGHT_S = 60;
/** Weight for the last sample of a session (no next point to measure to). */
const TAIL_SAMPLE_WEIGHT_S = 30;
/** Rows kept in the "recent passes" and "recent events" lists. */
const RECENT_PASSES = 15;
const RECENT_EVENTS = 10;
const DAY_MS = 86_400_000;

export function corridorById(id: string): Corridor | null {
  const k = id.trim().toLowerCase();
  return CORRIDORS.find((c) => c.id === k) ?? null;
}

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

/** Polyline bbox grown by `bufferNm`, for a cheap reject before the real distance. */
export function corridorBbox(c: Corridor, bufferNm = ROAD_BUFFER_NM): Bbox {
  let latMin = Infinity,
    latMax = -Infinity,
    lonMin = Infinity,
    lonMax = -Infinity;
  for (const [lat, lon] of c.path) {
    latMin = Math.min(latMin, lat);
    latMax = Math.max(latMax, lat);
    lonMin = Math.min(lonMin, lon);
    lonMax = Math.max(lonMax, lon);
  }
  const dLat = bufferNm / 60;
  const midLat = (latMin + latMax) / 2;
  const dLon = bufferNm / (60 * Math.cos((midLat * Math.PI) / 180));
  return { latMin: latMin - dLat, latMax: latMax + dLat, lonMin: lonMin - dLon, lonMax: lonMax + dLon };
}

/** True when the point sits within `bufferNm` of the corridor polyline. */
export function isOverRoad(
  lat: number,
  lon: number,
  c: Corridor,
  bufferNm = ROAD_BUFFER_NM,
  box: Bbox = corridorBbox(c, bufferNm),
): boolean {
  if (lat < box.latMin || lat > box.latMax || lon < box.lonMin || lon > box.lonMax) return false;
  return distanceToPolylineNm(lat, lon, c.path) <= bufferNm;
}

/** Nearest named place on this corridor (no distance cap: it is on the road). */
export function stretchFor(lat: number, lon: number, c: Corridor): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of c.places) {
    const d = haversineNm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p.name;
    }
  }
  return best;
}

/** Shorter brushes with a road or town are noise and are not listed or counted. */
export const MIN_PASS_S = 60;

export type RoadPass = {
  tail: string;
  name: string;
  /** Registry operator code ("WSP"); empty when unknown. */
  operator?: string;
  mission: Mission;
  /** First / last point over the road, ms. */
  startTs: number;
  endTs: number;
  /** Time over the road (sample-weighted), minutes, one decimal. */
  minutes: number;
  /** Stretch with the most time in this pass. */
  place: string | null;
  /** Minutes per stretch, for the busiest-stretch tally. */
  places: Record<string, number>;
  /** A full orbit was flown over the road. */
  pattern: boolean;
};

/**
 * One pass per flight session that spent time over the corridor. A session
 * is a run of samples with no gap over 5 minutes, the same rule the flight
 * list uses. Needs at least two points over the road, so a single stray
 * sample is not a pass.
 */
export function passesForTrack(
  entry: { tail: string; nickname?: string | null; operator?: string | null; role: unknown },
  points: ReadonlyArray<TrackPoint>,
  c: Corridor,
  opts: { bufferNm?: number; sinceS?: number } = {},
): RoadPass[] {
  const bufferNm = opts.bufferNm ?? ROAD_BUFFER_NM;
  const box = corridorBbox(c, bufferNm);
  const pts = cleanPoints(points).filter((p) => opts.sinceS == null || p.ts >= opts.sinceS);
  const mission = normalizeMission(entry.role);
  const name = entry.nickname?.trim() || entry.tail;
  const out: RoadPass[] = [];
  for (const session of splitSessions(pts)) {
    const over: TrackPoint[] = [];
    const places: Record<string, number> = {};
    let seconds = 0;
    for (let k = 0; k < session.length; k++) {
      const p = session[k]!;
      if (!isOverRoad(p.lat, p.lon, c, bufferNm, box)) continue;
      over.push(p);
      const next = session[k + 1];
      const w = next ? Math.min(next.ts - p.ts, MAX_SAMPLE_WEIGHT_S) : TAIL_SAMPLE_WEIGHT_S;
      seconds += w;
      const place = stretchFor(p.lat, p.lon, c);
      if (place) places[place] = (places[place] ?? 0) + w / 60;
    }
    // Under a minute over the road reads "0m": a clipped corner, not a pass.
    if (over.length < 2 || seconds < MIN_PASS_S) continue;
    let top: string | null = null;
    for (const [k, v] of Object.entries(places)) if (!top || v > places[top]!) top = k;
    for (const k of Object.keys(places)) places[k] = round1(places[k]!);
    out.push({
      tail: entry.tail,
      name,
      operator: entry.operator ?? "",
      mission,
      startTs: over[0]!.ts * 1000,
      endTs: over[over.length - 1]!.ts * 1000,
      minutes: round1(seconds / 60),
      place: top,
      places,
      pattern: detectOrbits(over).length > 0,
    });
  }
  return out;
}

export type RoadEvent = {
  ts: number;
  tail: string;
  kind: string;
  description: string;
  place: string | null;
};

/** Activity events (takeoffs, landings) within the buffer of the corridor since `sinceMs`. */
export function eventsNearRoad(
  events: ReadonlyArray<{
    ts: number;
    tail: string;
    kind: string;
    description: string;
    lat?: number | null;
    lon?: number | null;
  }>,
  c: Corridor,
  sinceMs: number,
  bufferNm = ROAD_BUFFER_NM,
): RoadEvent[] {
  const box = corridorBbox(c, bufferNm);
  const out: RoadEvent[] = [];
  for (const e of events) {
    if (e.ts < sinceMs) continue;
    if (typeof e.lat !== "number" || typeof e.lon !== "number") continue;
    if (!isOverRoad(e.lat, e.lon, c, bufferNm, box)) continue;
    out.push({
      ts: e.ts,
      tail: e.tail,
      kind: e.kind,
      description: e.description,
      place: stretchFor(e.lat, e.lon, c),
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

export type RoadMissionRow = { mission: Mission; label: string; flights: number; minutes: number };
export type RoadStretch = { place: string; minutes: number; share: number };

export type RoadSummary = {
  id: string;
  name: string;
  windowDays: number;
  flights30d: number;
  flights7d: number;
  minutes30d: number;
  /** Minutes over the road per Pacific hour of day, index 0..23. */
  hourMinutes: number[];
  /** Stretches by minutes, busiest first. */
  stretches: RoadStretch[];
  missions: RoadMissionRow[];
  /** Newest first, capped. */
  recent: RoadPass[];
  events: RoadEvent[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function summarizeRoad(
  c: Corridor,
  passes: ReadonlyArray<RoadPass>,
  events: ReadonlyArray<RoadEvent>,
  nowMs: number,
  windowDays = ROAD_WINDOW_DAYS,
): RoadSummary {
  const since = nowMs - windowDays * DAY_MS;
  const weekSince = nowMs - ROAD_WEEK_DAYS * DAY_MS;
  const inWindow = passes.filter((p) => p.endTs >= since);

  const hourMinutes = new Array<number>(24).fill(0);
  const stretchMin = new Map<string, number>();
  const missionAgg = new Map<Mission, { flights: number; minutes: number }>();
  let minutes = 0;
  let week = 0;
  for (const p of inWindow) {
    minutes += p.minutes;
    if (p.endTs >= weekSince) week++;
    // Spread the pass's minutes across the Pacific hours it spanned, in
    // proportion to wall-clock time, so the bins sum to the pass total.
    const spanMin = (p.endTs - p.startTs) / 60_000;
    if (spanMin > 0) {
      const scale = p.minutes / spanMin;
      distributeMinutes(p.startTs, p.endTs, (pt, m) => {
        hourMinutes[pt.hour] = hourMinutes[pt.hour]! + m * scale;
      });
    } else {
      distributeMinutes(p.startTs, p.startTs + 1, (pt) => {
        hourMinutes[pt.hour] = hourMinutes[pt.hour]! + p.minutes;
      });
    }
    for (const [place, m] of Object.entries(p.places)) {
      stretchMin.set(place, (stretchMin.get(place) ?? 0) + m);
    }
    const agg = missionAgg.get(p.mission) ?? { flights: 0, minutes: 0 };
    agg.flights++;
    agg.minutes += p.minutes;
    missionAgg.set(p.mission, agg);
  }

  const totalStretch = [...stretchMin.values()].reduce((s, v) => s + v, 0);
  const stretches: RoadStretch[] = [...stretchMin.entries()]
    .map(([place, m]) => ({
      place,
      minutes: round1(m),
      share: totalStretch > 0 ? Math.round((m / totalStretch) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.place.localeCompare(b.place));

  const missions: RoadMissionRow[] = MISSIONS.filter((m) => missionAgg.has(m)).map((m) => ({
    mission: m,
    label: missionLabel(m),
    flights: missionAgg.get(m)!.flights,
    minutes: round1(missionAgg.get(m)!.minutes),
  }));
  missions.sort((a, b) => b.flights - a.flights || b.minutes - a.minutes);

  return {
    id: c.id,
    name: c.name,
    windowDays,
    flights30d: inWindow.length,
    flights7d: week,
    minutes30d: round1(minutes),
    hourMinutes: hourMinutes.map(round1),
    stretches,
    missions,
    recent: [...inWindow].sort((a, b) => b.endTs - a.endTs).slice(0, RECENT_PASSES),
    events: events.filter((e) => e.ts >= since).slice(0, RECENT_EVENTS),
  };
}

/** Empty summary for a corridor with no data (KV absent, or a quiet month). */
export function emptyRoadSummary(c: Corridor, windowDays = ROAD_WINDOW_DAYS): RoadSummary {
  return summarizeRoad(c, [], [], 0, windowDays);
}

/** Share-card headline: "Planes over SR-512 this week: 7 flights". */
export function roadCardHeadline(name: string, flights7d: number): string {
  return `Planes over ${name} this week: ${flights7d} flight${flights7d === 1 ? "" : "s"}`;
}

/**
 * Badge on a pass or event row: the agency code ("WSP", "CBP") when the
 * registry has one, else the mission label ("Medevac"). The orange Smokey
 * badge on every row said nothing the page title did not.
 */
export function passBadgeLabel(p: { operator?: string | null; mission: Mission | string }): string {
  const op = p.operator?.trim();
  return op ? op : missionLabel(p.mission);
}
