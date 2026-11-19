// Mission taxonomy helpers. Pure (no node:*, no KV) so client bundles,
// server routes and node:test can all import it.
//
// The back-compat mapper lives here: every read of a stored role value
// (KV registry rows, activity events, rollups, push prefs, radar filter
// localStorage, ?roles= query params) goes through normalizeMission() so
// pre-2026-11 values keep parsing.

import type { Mission, MissionScope, PoliceUnit } from "./types";

/** Canonical order. Also the order the radar filter and /about use. */
export const MISSIONS: readonly Mission[] = [
  "police",
  "federal_le",
  "sar",
  "wildfire",
  "medevac",
  "survey",
  "transport",
  "unknown",
] as const;

export const POLICE_UNITS: readonly PoliceUnit[] = [
  "wsp",
  "sheriff",
  "city",
  "tribal",
  "state",
] as const;

export const MISSION_SCOPES: readonly MissionScope[] = ["wa", "mutual_aid"] as const;

/** Rider default for push alerts and the radar filter. */
export const DEFAULT_MISSIONS: readonly Mission[] = ["police"] as const;

/** Pre-2026-11 FleetRole values. */
export type LegacyRole = "smokey" | "patrol" | "sar" | "transport" | "unknown";

/**
 * Old role → mission. `smokey` (WSP fixed-wing) and `patrol` (sheriff
 * rotorcraft) both become police. The value-level map cannot know that the
 * old CBP rows were `patrol`; the registry read path and the
 * migrate-taxonomy route fix those per tail from the seed.
 */
export const LEGACY_ROLE_TO_MISSION: Readonly<Record<LegacyRole, Mission>> = {
  smokey: "police",
  patrol: "police",
  sar: "sar",
  transport: "transport",
  unknown: "unknown",
};

export function isMission(v: unknown): v is Mission {
  return typeof v === "string" && (MISSIONS as readonly string[]).includes(v);
}

export function isLegacyRole(v: unknown): v is LegacyRole {
  return (
    typeof v === "string" &&
    Object.prototype.hasOwnProperty.call(LEGACY_ROLE_TO_MISSION, v)
  );
}

/**
 * Any stored role or mission value → Mission. New values pass through,
 * legacy values map, anything else is `unknown`. Case-insensitive.
 * `sar`, `transport` and `unknown` are spelled the same in both sets.
 */
export function normalizeMission(v: unknown): Mission {
  if (typeof v !== "string") return "unknown";
  const s = v.trim().toLowerCase();
  if (isMission(s)) return s;
  if (isLegacyRole(s)) return LEGACY_ROLE_TO_MISSION[s];
  return "unknown";
}

/** Normalize, de-dupe and order a list of stored role / mission values. */
export function normalizeMissionList(v: unknown): Mission[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<Mission>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim().toLowerCase();
    if (isMission(s) || isLegacyRole(s)) set.add(normalizeMission(s));
  }
  return MISSIONS.filter((m) => set.has(m));
}

export function isPoliceUnit(v: unknown): v is PoliceUnit {
  return typeof v === "string" && (POLICE_UNITS as readonly string[]).includes(v);
}

export function isMissionScope(v: unknown): v is MissionScope {
  return typeof v === "string" && (MISSION_SCOPES as readonly string[]).includes(v);
}

/** True only for the police mission (the Smokey class). */
export function isPoliceMission(role: unknown): boolean {
  return normalizeMission(role) === "police";
}

// Washington-airspace heuristic for mutual-aid aircraft. The owner's call:
// latitude ≥ 45.5 is good enough for the Columbia. The longitude bound
// keeps a Coeur d'Alene (Idaho) unit out until it crosses the state line.
export const WA_MIN_LAT = 45.5;
export const WA_MAX_LON = -117.0;

export function inWashingtonAirspace(
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  if (typeof lat !== "number" || !Number.isFinite(lat)) return false;
  if (lat < WA_MIN_LAT) return false;
  if (typeof lon === "number" && Number.isFinite(lon) && lon > WA_MAX_LON) {
    return false;
  }
  return true;
}

/**
 * Does this airframe count toward "Smokey's up" right now? Police only.
 * WA-based police always count; mutual-aid police count only inside
 * Washington airspace (no position = not counted).
 */
export function countsAsSmokey(a: {
  role?: unknown;
  scope?: MissionScope | null;
  lat?: number | null;
  lon?: number | null;
}): boolean {
  if (!isPoliceMission(a.role)) return false;
  if (a.scope !== "mutual_aid") return true;
  return inWashingtonAirspace(a.lat, a.lon);
}

// Rotorcraft vs fixed-wing from the model string. Drives the map glyph and
// some body copy. Anchored on manufacturer / type names so "Cessna 206H"
// never reads as a Bell 206.
const ROTOR_RE =
  /\b(bell|hughes|eurocopter|airbus helicopters|robinson|sikorsky|md helicopters)\b|mcdonnell douglas helicopter|\b(uh-1[a-z]?|oh-58[a-z]?|as350[a-z0-9]*|h125|h135|mh-65[a-z]?|369[a-z]?|th-67[a-z]?)\b/i;

export function isRotorcraftModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return ROTOR_RE.test(model);
}

/**
 * Tail allow-list for the heatmap / flight-path / forecast filters. Every
 * non-empty constraint must match (same AND semantics as the radar marker
 * filter, lib/radar-filter.ts passesAircraftFilter). `roles` accepts
 * legacy role names (smokey, patrol) via normalizeMissionList. Returns
 * null when nothing constrains the set.
 */
export function resolveAllowedTails(
  registry: ReadonlyArray<{ tail: string; operator: string; role: unknown }>,
  filter: { tails?: readonly string[]; operators?: readonly string[]; roles?: readonly string[] },
): Set<string> | null {
  const tails = (filter.tails ?? []).map((t) => t.toUpperCase());
  const operators = filter.operators ?? [];
  const missions = normalizeMissionList(filter.roles ?? []);
  const everyMission = missions.length === MISSIONS.length;
  if (tails.length === 0 && operators.length === 0 && (missions.length === 0 || everyMission)) {
    return null;
  }
  const out = new Set<string>();
  for (const f of registry) {
    if (tails.length > 0 && !tails.includes(f.tail.toUpperCase())) continue;
    if (operators.length > 0 && !operators.includes(f.operator)) continue;
    if (missions.length > 0 && !everyMission && !missions.includes(normalizeMission(f.role))) continue;
    out.add(f.tail);
  }
  // Explicit tails outside the registry still pass the tail constraint
  // when no other constraint applies (historical tracks of a removed tail).
  if (operators.length === 0 && missions.length === 0) {
    for (const t of tails) out.add(t);
  }
  return out;
}

/**
 * `?missions=` query value → mission list. Missing or empty → the police
 * default. "all" → every mission. Unknown values are dropped.
 */
export function parseMissionsParam(v: string | null | undefined): Mission[] {
  if (!v) return [...DEFAULT_MISSIONS];
  if (v.trim().toLowerCase() === "all") return [...MISSIONS];
  const list = normalizeMissionList(v.split(","));
  return list.length > 0 ? list : [...DEFAULT_MISSIONS];
}

/** Mission list → `?missions=` value ("all" when every mission is on). */
export function formatMissionsParam(missions: readonly Mission[]): string {
  if (MISSIONS.every((m) => missions.includes(m))) return "all";
  return MISSIONS.filter((m) => missions.includes(m)).join(",");
}
