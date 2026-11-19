// Town pages (/near/[town]): which tracked flights came within about
// 8 nm of a town in the last 30 days, how long they stayed, on what
// mission, on which weekday and hour (Pacific), and over which roads.
//
// Pure: no I/O, no clock reads. lib/history-digest.ts reads the tracks
// once for every road and town page and hands them in here. History
// only: a quiet hour or weekday on these pages says nothing about the
// next ride, and the page copy says so.

import { haversineNm } from "./geo";
import { nearestCorridor } from "./corridor";
import { detectOrbits } from "./orbit";
import { distributeMinutes, utcDateKey } from "./rollup-core";
import { normalizeMission, MISSIONS } from "./mission";
import { missionLabel } from "./role-display";
import { agencyName } from "./agencies";
import { cleanPoints, splitSessions } from "./circling";
import { flightIdFromTs, sessionsFromDay } from "./flights";
import { TOWN_RADIUS_NM, type Town } from "./towns";
import type { TrackPoint } from "./tracks";
import type { FleetEntry, Mission } from "./types";

export const TOWN_WINDOW_DAYS = 30;
const TOWN_WEEK_DAYS = 7;
/** One sample stands for at most this much time, seconds. */
const MAX_SAMPLE_WEIGHT_S = 60;
/** Weight for the last sample of a session. */
const TAIL_SAMPLE_WEIGHT_S = 30;
const RECENT_PASSES = 12;
const DAY_MS = 86_400_000;
/** A point within this distance of a corridor counts toward that road, nm. */
const ROAD_MATCH_NM = 2;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type TownPass = {
  tail: string;
  name: string;
  operator: string;
  mission: Mission;
  /** First / last point within the radius, ms. */
  startTs: number;
  endTs: number;
  /** Time within the radius (sample-weighted), minutes, one decimal. */
  minutes: number;
  /** Closest point to the town centre, nm, one decimal. */
  closestNm: number;
  /** Corridor label with the most time in this pass ("SR-512 · Puyallup"). */
  road: string | null;
  /** Minutes per corridor id within the radius. */
  roads: Record<string, number>;
  /** Minutes per corridor label within the radius, with the corridor id. */
  labels: Record<string, { id: string; minutes: number }>;
  /** A full orbit was flown within the radius. */
  pattern: boolean;
  /** /flight/{tail}/{id}, cut the way that page cuts sessions; null when too short. */
  flight: { id: string; href: string } | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

export function townBbox(town: Pick<Town, "lat" | "lon">, radiusNm = TOWN_RADIUS_NM): Bbox {
  const dLat = radiusNm / 60;
  const dLon = dLat / Math.max(0.2, Math.cos((town.lat * Math.PI) / 180));
  return { latMin: town.lat - dLat, latMax: town.lat + dLat, lonMin: town.lon - dLon, lonMax: town.lon + dLon };
}

/** Distance to the town in nm, or Infinity outside the bbox (cheap reject). */
function distWithin(p: { lat: number; lon: number }, town: Pick<Town, "lat" | "lon">, box: Bbox): number {
  if (p.lat < box.latMin || p.lat > box.latMax || p.lon < box.lonMin || p.lon > box.lonMax) return Infinity;
  return haversineNm(p.lat, p.lon, town.lat, town.lon);
}

/** The flight page a point belongs to, cut from that UTC day's raw list. */
function flightFor(
  entry: Pick<FleetEntry, "tail" | "nickname">,
  dayPoints: ReadonlyMap<string, TrackPoint[]>,
  anchorTs: number,
): TownPass["flight"] {
  const day = utcDateKey(anchorTs * 1000);
  const pts = dayPoints.get(day);
  if (!pts) return null;
  const s = sessionsFromDay(entry as FleetEntry, day, pts).find(
    (x) => x.start_ts / 1000 <= anchorTs && anchorTs <= x.end_ts / 1000,
  );
  if (!s) return null;
  const id = flightIdFromTs(s.start_ts);
  return { id, href: `/flight/${encodeURIComponent(entry.tail)}/${id}` };
}

/** Raw points grouped by UTC day key, each list sorted by ts. */
export function groupByUtcDay(points: ReadonlyArray<TrackPoint>): Map<string, TrackPoint[]> {
  const out = new Map<string, TrackPoint[]>();
  for (const p of points) {
    if (!p || !Number.isFinite(p.ts)) continue;
    const k = utcDateKey(p.ts * 1000);
    const list = out.get(k) ?? [];
    list.push(p);
    out.set(k, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}

/**
 * One pass per flight session (no gap over 5 minutes) that put at least
 * two samples within `radiusNm` of the town. `dayPoints` is the tail's
 * raw points by UTC day (groupByUtcDay), used only for the flight link.
 */
export function passesForTown(
  entry: Pick<FleetEntry, "tail" | "nickname" | "operator" | "role">,
  points: ReadonlyArray<TrackPoint>,
  town: Pick<Town, "lat" | "lon">,
  opts: { radiusNm?: number; sinceS?: number; dayPoints?: ReadonlyMap<string, TrackPoint[]> } = {},
): TownPass[] {
  const radiusNm = opts.radiusNm ?? TOWN_RADIUS_NM;
  const box = townBbox(town, radiusNm);
  const pts = cleanPoints(points).filter((p) => opts.sinceS == null || p.ts >= opts.sinceS);
  const mission = normalizeMission(entry.role);
  const name = entry.nickname?.trim() || entry.tail;
  const out: TownPass[] = [];
  for (const session of splitSessions(pts)) {
    const near: TrackPoint[] = [];
    const roads: Record<string, number> = {};
    const labels: Record<string, { id: string; minutes: number }> = {};
    let seconds = 0;
    let closest = Infinity;
    for (let k = 0; k < session.length; k++) {
      const p = session[k]!;
      const d = distWithin(p, town, box);
      if (d > radiusNm) continue;
      near.push(p);
      closest = Math.min(closest, d);
      const next = session[k + 1];
      const w = next ? Math.min(next.ts - p.ts, MAX_SAMPLE_WEIGHT_S) : TAIL_SAMPLE_WEIGHT_S;
      seconds += w;
      const m = nearestCorridor(p.lat, p.lon, ROAD_MATCH_NM);
      if (m) {
        roads[m.id] = (roads[m.id] ?? 0) + w / 60;
        const label = m.nearestPlace ? `${m.name} · ${m.nearestPlace}` : m.name;
        const cur = labels[label] ?? { id: m.id, minutes: 0 };
        cur.minutes += w / 60;
        labels[label] = cur;
      }
    }
    if (near.length < 2) continue;
    let top: string | null = null;
    for (const [k, v] of Object.entries(labels)) if (!top || v.minutes > labels[top]!.minutes) top = k;
    for (const k of Object.keys(roads)) roads[k] = round1(roads[k]!);
    for (const v of Object.values(labels)) v.minutes = round1(v.minutes);
    out.push({
      tail: entry.tail,
      name,
      operator: entry.operator,
      mission,
      startTs: near[0]!.ts * 1000,
      endTs: near[near.length - 1]!.ts * 1000,
      minutes: round1(seconds / 60),
      closestNm: round1(closest),
      road: top,
      roads,
      labels,
      pattern: detectOrbits(near).length > 0,
      flight: opts.dayPoints ? flightFor(entry, opts.dayPoints, near[0]!.ts) : null,
    });
  }
  return out;
}

export type TownMissionRow = { mission: Mission; label: string; flights: number; minutes: number };
export type TownAgencyRow = { code: string; name: string; flights: number };
export type TownRoadRow = { id: string; label: string; minutes: number; share: number };

export type TownSummary = {
  slug: string;
  name: string;
  windowDays: number;
  flights30d: number;
  flights7d: number;
  minutes30d: number;
  /** Distinct tails among the passes. */
  tails: number;
  /** Minutes within the radius per Pacific hour, 0..23. */
  hourMinutes: number[];
  /** Minutes within the radius per Pacific weekday, 0 = Sunday. */
  weekdayMinutes: number[];
  /** Busiest Pacific weekday / hour by minutes; null with no passes. */
  busiestWeekday: { dow: number; label: string; minutes: number } | null;
  busiestHour: { hour: number; minutes: number } | null;
  missions: TownMissionRow[];
  /** Operators by flights, busiest first, with the agencies.ts name. */
  agencies: TownAgencyRow[];
  /** Corridor labels by minutes, busiest first ("SR-512 · Puyallup"). */
  roads: TownRoadRow[];
  /** Corridor ids with any time within the radius. */
  roadIds: string[];
  /** Flights that flew a full orbit within the radius. */
  patterns: number;
  /** Newest first, capped. */
  recent: TownPass[];
};

export function summarizeTown(
  town: Pick<Town, "slug" | "name">,
  passes: ReadonlyArray<TownPass>,
  nowMs: number,
  windowDays = TOWN_WINDOW_DAYS,
): TownSummary {
  const since = nowMs - windowDays * DAY_MS;
  const weekSince = nowMs - TOWN_WEEK_DAYS * DAY_MS;
  const inWindow = passes.filter((p) => p.endTs >= since);

  const hourMinutes = new Array<number>(24).fill(0);
  const weekdayMinutes = new Array<number>(7).fill(0);
  const missionAgg = new Map<Mission, { flights: number; minutes: number }>();
  const agencyAgg = new Map<string, number>();
  const labelMin = new Map<string, { id: string; minutes: number }>();
  const roadIds = new Set<string>();
  const tails = new Set<string>();
  let minutes = 0;
  let week = 0;
  let patterns = 0;

  for (const p of inWindow) {
    minutes += p.minutes;
    tails.add(p.tail);
    if (p.endTs >= weekSince) week++;
    if (p.pattern) patterns++;
    // Spread the pass's minutes across the Pacific hours it spanned, in
    // proportion to wall-clock time, so the bins sum to the pass total.
    const spanMin = (p.endTs - p.startTs) / 60_000;
    const end = spanMin > 0 ? p.endTs : p.startTs + 1;
    const scale = spanMin > 0 ? p.minutes / spanMin : p.minutes / (1 / 60_000);
    distributeMinutes(p.startTs, end, (pt, m) => {
      hourMinutes[pt.hour] = hourMinutes[pt.hour]! + m * scale;
      weekdayMinutes[pt.dow] = weekdayMinutes[pt.dow]! + m * scale;
    });
    const agg = missionAgg.get(p.mission) ?? { flights: 0, minutes: 0 };
    agg.flights++;
    agg.minutes += p.minutes;
    missionAgg.set(p.mission, agg);
    agencyAgg.set(p.operator, (agencyAgg.get(p.operator) ?? 0) + 1);
    for (const id of Object.keys(p.roads)) roadIds.add(id);
    for (const [label, v] of Object.entries(p.labels)) {
      const cur = labelMin.get(label) ?? { id: v.id, minutes: 0 };
      cur.minutes += v.minutes;
      labelMin.set(label, cur);
    }
  }

  const missions: TownMissionRow[] = MISSIONS.filter((m) => missionAgg.has(m)).map((m) => ({
    mission: m,
    label: missionLabel(m),
    flights: missionAgg.get(m)!.flights,
    minutes: round1(missionAgg.get(m)!.minutes),
  }));
  missions.sort((a, b) => b.flights - a.flights || b.minutes - a.minutes);

  const agencies: TownAgencyRow[] = [...agencyAgg.entries()]
    .map(([code, flights]) => ({ code, name: agencyName(code), flights }))
    .sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name));

  const roadTotal = [...labelMin.values()].reduce((s, v) => s + v.minutes, 0);
  const roads: TownRoadRow[] = [...labelMin.entries()]
    .map(([label, v]) => ({
      id: v.id,
      label,
      minutes: round1(v.minutes),
      share: roadTotal > 0 ? Math.round((v.minutes / roadTotal) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label));

  const hours = hourMinutes.map(round1);
  const days = weekdayMinutes.map(round1);
  const maxDay = Math.max(...days);
  const maxHour = Math.max(...hours);

  return {
    slug: town.slug,
    name: town.name,
    windowDays,
    flights30d: inWindow.length,
    flights7d: week,
    minutes30d: round1(minutes),
    tails: tails.size,
    hourMinutes: hours,
    weekdayMinutes: days,
    busiestWeekday: maxDay > 0 ? { dow: days.indexOf(maxDay), label: WEEKDAYS[days.indexOf(maxDay)]!, minutes: maxDay } : null,
    busiestHour: maxHour > 0 ? { hour: hours.indexOf(maxHour), minutes: maxHour } : null,
    missions,
    agencies,
    roads,
    roadIds: [...roadIds].sort(),
    patterns,
    recent: [...inWindow].sort((a, b) => b.startTs - a.startTs).slice(0, RECENT_PASSES),
  };
}

export function emptyTownSummary(town: Pick<Town, "slug" | "name">, windowDays = TOWN_WINDOW_DAYS): TownSummary {
  return summarizeTown(town, [], 0, windowDays);
}

/** "14:00" for an hour index. */
export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/**
 * The plain-language intro: which agencies flew here and how often,
 * from the passes and the registry counts. Never names an agency that
 * did not fly within the radius.
 */
export function townIntro(
  s: Pick<TownSummary, "name" | "flights30d" | "tails" | "agencies">,
  registryCounts: ReadonlyMap<string, number>,
  radiusMi: number,
): string {
  if (s.flights30d === 0) {
    return `No tracked flight came within about ${radiusMi} mi of ${s.name} in the last 30 days. That is history, not a promise about tomorrow.`;
  }
  const lead = `In the last 30 days, ${s.flights30d} tracked flight${s.flights30d === 1 ? "" : "s"} by ${s.tails} aircraft came within about ${radiusMi} mi of ${s.name}.`;
  const named = s.agencies.slice(0, 3).map((a) => {
    const fleet = registryCounts.get(a.code);
    return `${a.name} (${a.flights} flight${a.flights === 1 ? "" : "s"}${fleet ? `, ${fleet} aircraft on our list` : ""})`;
  });
  const more = s.agencies.length - named.length;
  const rest = more > 0 ? `, plus ${more} other agenc${more === 1 ? "y" : "ies"}` : "";
  // Ordered by flights; no "the most" claim, so a tie never reads wrong.
  const who =
    named.length === 1 ? `All of them were ${named[0]}.` : `Who flew: ${named.join(", ")}${rest}.`;
  return `${lead} ${who}`;
}
