// What's circling: which airborne tails are working a pattern right now,
// described in plain language for someone who just looked up.
//
// Pure: no I/O, no clock reads. lib/circling-server.ts feeds it the
// snapshot and today's track points. The classifier is lib/orbit.ts
// (classifyFlightPhase over the trailing ~15 min, detectOrbits for how
// long the pattern has been going); place names come from lib/corridor.ts
// and lib/places.ts; the home field from lib/airports.ts.
//
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks.

import { classifyFlightPhase, detectOrbits } from "./orbit";
import { nearestCorridor } from "./corridor";
import { airportById, inferDeparture } from "./airports";
import { nearestPlaceName } from "./places";
import { countsAsSmokey, normalizeMission } from "./mission";
import { missionLabel, roleBadgeText, roleTooltip } from "./role-display";
import type { TrackPoint } from "./tracks";
import type { FleetEntry, Mission, MissionScope } from "./types";

/** Look-back the classifier sees, seconds. */
export const CIRCLING_LOOKBACK_S = 15 * 60;
/** A sample gap longer than this starts a new session, seconds. */
export const CIRCLING_SESSION_GAP_S = 5 * 60;
/** A tail whose newest point is older than this is not circling "now". */
export const CIRCLING_STALE_S = 5 * 60;

export type CirclingAirport = {
  id: string;
  /** "Olympia" for a registry base like "KOLM Olympia", else the field name. */
  city: string;
  /** True when inferred from this flight's takeoff; false = registry home base. */
  fromTakeoff: boolean;
};

export type CirclingItem = {
  tail: string;
  /** Nickname when there is one ("Smokey 3"), else the tail. */
  name: string;
  /** "Cessna 206H Stationair with a FLIR camera". */
  airframe: string;
  operator: string;
  mission: Mission;
  /** Title-case mission label ("Smokey", "Wildfire", "Federal"). */
  missionLabel: string;
  /** Badge text ("SMOKEY", "WILDFIRE"). */
  missionBadge: string;
  /** One-line mission explainer from lib/role-display.ts. */
  missionNote: string;
  /** Counts toward "Smokey's up" (police, in WA airspace). */
  smokey: boolean;
  /** Centre of the last ~15 min of the pattern. */
  lat: number;
  lon: number;
  altFt: number | null;
  road: string | null;
  roadId: string | null;
  near: string | null;
  /** Whole minutes in the pattern, at least 1. */
  patternMin: number;
  /** Pattern start, ms. */
  sinceTs: number;
  /** Newest point, ms. */
  lastTs: number;
  airport: CirclingAirport | null;
  /** "Working a pattern over SR-512 near Puyallup for 22 min · out of Olympia (KOLM)." */
  sentence: string;
};

type EntryLike = Pick<
  FleetEntry,
  "tail" | "nickname" | "model" | "operator" | "role" | "base"
> & { scope?: MissionScope };

/** Finite points, sorted by ts, duplicate timestamps dropped. */
export function cleanPoints(points: ReadonlyArray<TrackPoint>): TrackPoint[] {
  const valid = points.filter(
    (p) =>
      p != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Number.isFinite(p.ts),
  );
  valid.sort((a, b) => a.ts - b.ts);
  const out: TrackPoint[] = [];
  for (const p of valid) {
    if (out.length > 0 && out[out.length - 1]!.ts === p.ts) continue;
    out.push(p);
  }
  return out;
}

/** Split sorted points into sessions wherever the gap exceeds `gapS`. */
export function splitSessions(
  points: ReadonlyArray<TrackPoint>,
  gapS = CIRCLING_SESSION_GAP_S,
): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  let cur: TrackPoint[] = [];
  for (const p of points) {
    if (cur.length > 0 && p.ts - cur[cur.length - 1]!.ts > gapS) {
      out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/**
 * "Cessna 206H Stationair (FLIR)" → "Cessna 206H Stationair with a FLIR
 * camera". Drops other parenthetical notes (build year, maker).
 */
export function plainAirframe(model: string | null | undefined): string {
  const raw = (model ?? "").trim();
  if (!raw) return "Unlisted airframe";
  const flir = /\bFLIR\b/i.test(raw);
  const base = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return flir ? `${base} with a FLIR camera` : base;
}

/** "22 min" / "1 h 05 min". */
export function fmtPatternMinutes(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Registry base "KOLM Olympia" → { id: "KOLM", city: "Olympia" }. */
export function parseBase(base: string | null | undefined): { id: string; city: string } | null {
  const raw = (base ?? "").trim();
  if (!raw) return null;
  const [head, ...rest] = raw.split(/\s+/);
  const ap = head ? airportById(head) : null;
  if (!ap) return null;
  const city = rest.join(" ").trim();
  return { id: ap.id, city: city || ap.name };
}

function airportFor(entry: EntryLike, session: ReadonlyArray<TrackPoint>): CirclingAirport | null {
  const base = parseBase(entry.base);
  // Stricter than the flight page's default: a session first heard at
  // 2,500 ft near a field is not evidence it took off there.
  const dep = inferDeparture(session, { maxAltFt: 1500, windowS: 300 });
  if (dep) {
    const city = base && base.id === dep.id ? base.city : dep.name;
    return { id: dep.id, city, fromTakeoff: true };
  }
  return base ? { ...base, fromTakeoff: false } : null;
}

/** The plain-language line under the name. */
export function describePattern(p: {
  road: string | null;
  near: string | null;
  patternMin: number;
  airport: CirclingAirport | null;
}): string {
  let where: string;
  if (p.road && p.near) where = `over ${p.road} near ${p.near}`;
  else if (p.road) where = `over ${p.road}`;
  else if (p.near) where = `near ${p.near}`;
  else where = "away from any named road";
  let s = `Working a pattern ${where} for ${fmtPatternMinutes(p.patternMin)}`;
  if (p.airport) {
    s += p.airport.fromTakeoff
      ? ` · out of ${p.airport.city} (${p.airport.id})`
      : ` · based at ${p.airport.city} (${p.airport.id})`;
  }
  return `${s}.`;
}

/**
 * One tail's pattern, or null when it is not working one right now.
 * `points` is today's track (any order); `nowS` is unix seconds.
 */
export function circlingFromTrack(
  entry: EntryLike,
  points: ReadonlyArray<TrackPoint>,
  nowS: number,
): CirclingItem | null {
  const pts = cleanPoints(points);
  if (pts.length < 3) return null;
  const last = pts[pts.length - 1]!;
  if (nowS - last.ts > CIRCLING_STALE_S) return null;

  const sessions = splitSessions(pts);
  const session = sessions[sessions.length - 1]!;
  const recent = session.filter((p) => p.ts >= last.ts - CIRCLING_LOOKBACK_S);
  if (recent.length < 3) return null;
  if (classifyFlightPhase(recent, { lookbackS: CIRCLING_LOOKBACK_S }) !== "working a pattern") {
    return null;
  }

  // How long: the orbit segment that is still going (it ends inside the
  // look-back). A loiter that never closes a full circle falls back to
  // the classifier window.
  const segs = detectOrbits(session);
  const live = [...segs].reverse().find((s) => s.endTs >= last.ts - CIRCLING_LOOKBACK_S);
  const sinceS = live ? live.startTs : recent[0]!.ts;
  const patternMin = Math.max(1, Math.round((last.ts - sinceS) / 60));

  let lat = 0;
  let lon = 0;
  for (const p of recent) {
    lat += p.lat;
    lon += p.lon;
  }
  lat /= recent.length;
  lon /= recent.length;

  const match = nearestCorridor(lat, lon, 2);
  const road = match?.name ?? null;
  const near = match?.nearestPlace ?? nearestPlaceName(lat, lon);
  const airport = airportFor(entry, session);
  const mission = normalizeMission(entry.role);

  return {
    tail: entry.tail,
    name: entry.nickname?.trim() || entry.tail,
    airframe: plainAirframe(entry.model),
    operator: entry.operator,
    mission,
    missionLabel: missionLabel(mission),
    missionBadge: roleBadgeText(mission),
    missionNote: roleTooltip(mission),
    smokey: countsAsSmokey({ role: mission, scope: entry.scope ?? null, lat, lon }),
    lat,
    lon,
    altFt: typeof last.alt === "number" && Number.isFinite(last.alt) ? last.alt : null,
    road,
    roadId: match?.id ?? null,
    near: near ?? null,
    patternMin,
    sinceTs: sinceS * 1000,
    lastTs: last.ts * 1000,
    airport,
    sentence: describePattern({ road, near: near ?? null, patternMin, airport }),
  };
}

/** Longest-running pattern first, then name. */
export function sortByPattern(items: ReadonlyArray<CirclingItem>): CirclingItem[] {
  return [...items].sort((a, b) => b.patternMin - a.patternMin || a.name.localeCompare(b.name));
}
