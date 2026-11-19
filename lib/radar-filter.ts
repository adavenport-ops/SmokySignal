// Shared radar filter state — missions / operators / tails. Lives in
// localStorage under "ss_hotzones_filter" (legacy key kept so existing
// user state survives) and broadcasts changes via a CustomEvent so the
// heatmap chevron panel and the aircraft marker layer stay in sync
// without a context provider.
//
// Region selection is owned by lib/region-pref.ts — the rider's region
// pref drives /api/hotzones via the region_id param. This filter only
// concerns mission / operator / tail filtering inside the chosen region.
//
// Missions (2026-11): the filter's `buckets` field now holds Mission
// values (lib/types.ts). The field keeps its name so the map layers that
// read it (HotZoneLayer, FlightPathLayer) need no change. Default is
// police only (Smokey); "Everything" is every mission selected. Persisted
// state from prior eras (bucket ids smokey / sar / transport, raw
// FleetRole arrays, the pre-P19 showMode shortcut) migrates forward in
// readRadarFilter().

import type { Mission } from "./types";
import { DEFAULT_MISSIONS, MISSIONS, normalizeMission, normalizeMissionList } from "./mission";
import { missionLabel } from "./role-display";
import { FLEET } from "./seed";

/** @deprecated Mission values. Kept for import compatibility. */
export const FILTERABLE_ROLES = MISSIONS;
export type FilterableRole = Mission;

/** Rider-facing mission chips, in display order. One chip per mission. */
export const RIDER_BUCKETS: ReadonlyArray<{
  id: Mission;
  label: string;
  roles: readonly Mission[];
}> = MISSIONS.map((m) => ({ id: m, label: missionLabel(m), roles: [m] }));
export type RiderBucketId = Mission;

/** True when every mission is selected (the "Everything" chip). */
export function isEverything(buckets: readonly Mission[]): boolean {
  return MISSIONS.every((m) => buckets.includes(m));
}

/**
 * Bucket set → the `roles` list the heatmap / flight-path APIs take.
 * Empty input, or every mission selected, returns [] (no constraint).
 */
export function bucketsToRoles(buckets: readonly Mission[]): Mission[] {
  if (buckets.length === 0 || isEverything(buckets)) return [];
  return MISSIONS.filter((m) => buckets.includes(m));
}

/** Chip tap. From "Everything", a mission chip narrows to that one
 *  mission. Removing the last selected mission falls back to police. */
export function toggleMission(buckets: readonly Mission[], m: Mission): Mission[] {
  if (isEverything(buckets)) return [m];
  const set = new Set(buckets);
  if (set.has(m)) set.delete(m);
  else set.add(m);
  const next = MISSIONS.filter((x) => set.has(x));
  return next.length > 0 ? next : [...DEFAULT_MISSIONS];
}

/** "Everything" chip tap: select all, or back to the police default. */
export function toggleEverything(buckets: readonly Mission[]): Mission[] {
  return isEverything(buckets) ? [...DEFAULT_MISSIONS] : [...MISSIONS];
}

export type RadarFilter = {
  /** Selected missions. Default ['police']; all missions = Everything. */
  buckets: RiderBucketId[];
  /** Multi-select operator allow-list. Empty = no operator constraint. */
  operatorSet: string[];
  /** Multi-select tail allow-list driven by the typeahead picker.
   *  Empty = no tail constraint. */
  tailSet: string[];
};

export const RADAR_FILTER_KEY = "ss_hotzones_filter";
export const RADAR_FILTER_CHANGE_EVENT = "ss-radar-filter-change";

/**
 * @deprecated Retained as an empty array so any prior import compiles.
 * Mission classification (lib/types.ts) is the source of truth.
 */
export const SMOKY_TAILS: readonly string[] = [];

/** Operator chips: every operator code in the seed registry. */
export const OPERATORS: readonly string[] = Array.from(
  new Set(FLEET.map((f) => f.operator)),
);

/** Written with every save so a stored empty `buckets` from before the
 *  taxonomy (which meant "all") can be told apart. */
const FILTER_VERSION = 2;

export const DEFAULT_RADAR_FILTER: RadarFilter = {
  buckets: [...DEFAULT_MISSIONS],
  operatorSet: [],
  tailSet: [],
};

/**
 * Pure migration of a stored filter blob. Exported for tests.
 * - v2 `buckets`: mission list (empty → police default).
 * - Older `buckets` (smokey / sar / transport ids) map through the legacy
 *   role mapper. An old empty list was the old default, so it becomes the
 *   new default (police only), per the owner's call.
 * - Older raw `roles` arrays map the same way.
 * - Pre-P19 showMode === "smoky" adds police; showMode === "operator"
 *   seeds the operator chip.
 */
export function migrateRadarFilter(parsed: unknown): RadarFilter {
  if (!parsed || typeof parsed !== "object") return DEFAULT_RADAR_FILTER;
  const p = parsed as Record<string, unknown>;
  let buckets: Mission[];
  if (Array.isArray(p.buckets)) {
    buckets = normalizeMissionList(p.buckets);
  } else if (Array.isArray(p.roles)) {
    buckets = normalizeMissionList(p.roles);
  } else {
    buckets = [];
  }
  if (p.showMode === "smoky" && !buckets.includes("police")) {
    buckets = MISSIONS.filter((m) => m === "police" || buckets.includes(m));
  }
  if (buckets.length === 0) buckets = [...DEFAULT_MISSIONS];

  let operatorSet = Array.isArray(p.operatorSet)
    ? p.operatorSet.filter(
        (o): o is string => typeof o === "string" && OPERATORS.includes(o),
      )
    : [];
  if (
    p.showMode === "operator" &&
    typeof p.operator === "string" &&
    OPERATORS.includes(p.operator) &&
    !operatorSet.includes(p.operator)
  ) {
    operatorSet = [...operatorSet, p.operator];
  }
  const tailSet = Array.isArray(p.tailSet)
    ? p.tailSet.filter((t): t is string => typeof t === "string")
    : Array.isArray(p.tails)
      ? p.tails.filter((t): t is string => typeof t === "string")
      : [];
  return { buckets, operatorSet, tailSet };
}

export function readRadarFilter(): RadarFilter {
  if (typeof window === "undefined") return DEFAULT_RADAR_FILTER;
  try {
    const raw = window.localStorage.getItem(RADAR_FILTER_KEY);
    if (!raw) return DEFAULT_RADAR_FILTER;
    return migrateRadarFilter(JSON.parse(raw));
  } catch {
    return DEFAULT_RADAR_FILTER;
  }
}

export function writeRadarFilter(f: RadarFilter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RADAR_FILTER_KEY,
      JSON.stringify({ ...f, v: FILTER_VERSION }),
    );
    window.dispatchEvent(
      new CustomEvent(RADAR_FILTER_CHANGE_EVENT, { detail: f }),
    );
  } catch {
    // best-effort
  }
}

export function passesAircraftFilter(
  aircraft: { tail: string; operator: string; role?: string },
  f: RadarFilter,
): boolean {
  // Tail allow-list (most specific) runs first — short-circuit.
  if (f.tailSet.length > 0 && !f.tailSet.includes(aircraft.tail)) return false;
  // Operator allow-list.
  if (f.operatorSet.length > 0 && !f.operatorSet.includes(aircraft.operator)) {
    return false;
  }
  // Mission filter. Empty or Everything = no mission constraint.
  const allowed = bucketsToRoles(f.buckets);
  if (allowed.length > 0 && !allowed.includes(normalizeMission(aircraft.role))) {
    return false;
  }
  return true;
}

// ─── Registry tail cache (client-only) ──────────────────────────────────────
//
// The tail-picker typeahead in FilterPanel needs the list of every
// registry tail + nickname so it can suggest matches. Fetched once from
// /api/aircraft on first call, cached in module scope. /api/aircraft
// already runs to populate the home page so this is usually a cache hit.

export type RegistryTail = {
  tail: string;
  nickname: string | null;
  operator: string;
  role: string;
};

let registryTailsCache: RegistryTail[] | null = null;
let registryTailsPromise: Promise<RegistryTail[]> | null = null;

export async function getRegistryTails(): Promise<RegistryTail[]> {
  if (registryTailsCache) return registryTailsCache;
  if (registryTailsPromise) return registryTailsPromise;
  registryTailsPromise = (async () => {
    try {
      const r = await fetch("/api/aircraft", { cache: "no-store" });
      if (!r.ok) return [];
      const data = (await r.json()) as {
        aircraft: Array<{
          tail: string;
          nickname?: string | null;
          operator: string;
          role: string;
        }>;
      };
      const list: RegistryTail[] = (data.aircraft ?? []).map((a) => ({
        tail: a.tail,
        nickname: a.nickname ?? null,
        operator: a.operator,
        role: a.role,
      }));
      registryTailsCache = list;
      return list;
    } catch {
      return [];
    } finally {
      registryTailsPromise = null;
    }
  })();
  return registryTailsPromise;
}

/** Case-insensitive prefix match across tail + nickname. Returns up to
 *  `cap` suggestions, alpha-sorted by tail. */
export function searchRegistryTails(
  registry: readonly RegistryTail[],
  query: string,
  cap = 8,
): RegistryTail[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = registry.filter((r) => {
    if (r.tail.toLowerCase().includes(q)) return true;
    if (r.nickname && r.nickname.toLowerCase().includes(q)) return true;
    return false;
  });
  matches.sort((a, b) => a.tail.localeCompare(b.tail));
  return matches.slice(0, cap);
}
