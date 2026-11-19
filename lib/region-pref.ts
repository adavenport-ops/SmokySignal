// Localstorage-backed rider region preference. No accounts, no
// server state. Other client components react to changes via the
// "ss-region-change" CustomEvent.
//
// The pref is the rider's default radar CAMERA (lib/radar-view.ts), not
// a data filter. It can hold any RadarViewId, including "everything".

"use client";

import {
  DEFAULT_RADAR_VIEW,
  isRadarViewId,
  type RadarViewId,
} from "./radar-view";
import type { RegionId } from "./regions";

const KEY = "ss_region_pref";
export const REGION_CHANGE_EVENT = "ss-region-change";

// Retired region IDs map forward to their current equivalents. Pierce +
// Snohomish were folded into Puget Sound in P16.3; Spokane was folded
// into East WA. Returning riders with persisted legacy values get
// transparently migrated on read.
const LEGACY_MAP: Record<string, RegionId> = {
  pierce: "puget_sound",
  snohomish: "puget_sound",
  spokane: "east_wa",
};

export function getRegion(): RadarViewId {
  if (typeof window === "undefined") return DEFAULT_RADAR_VIEW;
  try {
    const v = window.localStorage.getItem(KEY);
    if (!v) return DEFAULT_RADAR_VIEW;
    if (isRadarViewId(v)) return v;
    if (Object.prototype.hasOwnProperty.call(LEGACY_MAP, v)) return LEGACY_MAP[v]!;
    return DEFAULT_RADAR_VIEW;
  } catch {
    return DEFAULT_RADAR_VIEW;
  }
}

/**
 * Whether the rider has explicitly picked a region. Drives the radar's
 * geolocation auto-pick: if false on first /radar load, the auto-pick
 * runs against rider position; if true, we respect their choice even
 * if a different bbox would otherwise match.
 *
 * Returns false on SSR (no window) and on any localStorage error.
 */
export function hasExplicitRegion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}

export function setRegion(id: RadarViewId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, id);
    window.dispatchEvent(
      new CustomEvent(REGION_CHANGE_EVENT, { detail: { id } }),
    );
  } catch {
    /* localStorage may be disabled in some contexts (private mode) */
  }
}
