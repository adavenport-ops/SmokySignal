// Shared radar filter state — operator / tail-set / region. Lives in
// localStorage under "ss_hotzones_filter" (legacy key kept so existing
// user state survives this refactor) and broadcasts changes via a
// CustomEvent so the heatmap chevron panel and the aircraft marker
// layer stay in sync without a context provider.
//
// Region filtering is applied server-side only (lib/hotzones.ts) — the
// passesAircraftFilter predicate intentionally ignores it because the
// rider's airborne marker view should not hide planes based on the
// fleet-aggregation envelope.

export type RadarFilterShowMode = "all" | "smoky" | "operator";
export type RadarFilterRegion = "puget_sound" | "all";

export type RadarFilter = {
  showMode: RadarFilterShowMode;
  operator: string | null;
  region: RadarFilterRegion;
};

export const RADAR_FILTER_KEY = "ss_hotzones_filter";
export const RADAR_FILTER_CHANGE_EVENT = "ss-radar-filter-change";

/**
 * Roles that count as "Smokey" — speed-enforcement birds. The filter
 * UI labels this "Smokey" because that's the rider mental model; the
 * implementation matches by classified role, NOT a hardcoded tail list,
 * so a new WSP smokey added to the registry is automatically included.
 */
export const SMOKY_FILTER_ROLES = ["smokey", "patrol"] as const;

/**
 * @deprecated Use SMOKY_FILTER_ROLES instead. Retained as an empty
 * array so any prior import compiles, but no longer drives filtering
 * — role-based classification (lib/types.ts FleetRole) is the source
 * of truth.
 */
export const SMOKY_TAILS: readonly string[] = [];
export const OPERATORS = [
  "WSP",
  "KCSO",
  "Pierce SO",
  "Snohomish SO",
  "Spokane SO",
  "State of WA",
] as const;

export const DEFAULT_RADAR_FILTER: RadarFilter = {
  showMode: "all",
  operator: "WSP",
  region: "puget_sound",
};

export function readRadarFilter(): RadarFilter {
  if (typeof window === "undefined") return DEFAULT_RADAR_FILTER;
  try {
    const raw = window.localStorage.getItem(RADAR_FILTER_KEY);
    if (!raw) return DEFAULT_RADAR_FILTER;
    const parsed = JSON.parse(raw) as Partial<RadarFilter>;
    return {
      showMode:
        parsed.showMode === "smoky" || parsed.showMode === "operator"
          ? parsed.showMode
          : "all",
      operator:
        typeof parsed.operator === "string" &&
        OPERATORS.includes(parsed.operator as (typeof OPERATORS)[number])
          ? parsed.operator
          : "WSP",
      region: parsed.region === "all" ? "all" : "puget_sound",
    };
  } catch {
    return DEFAULT_RADAR_FILTER;
  }
}

export function writeRadarFilter(f: RadarFilter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RADAR_FILTER_KEY, JSON.stringify(f));
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
  if (f.showMode === "all") return true;
  if (f.showMode === "smoky") {
    return (
      typeof aircraft.role === "string" &&
      (SMOKY_FILTER_ROLES as readonly string[]).includes(aircraft.role)
    );
  }
  if (f.showMode === "operator" && f.operator) {
    return aircraft.operator === f.operator;
  }
  return true;
}
