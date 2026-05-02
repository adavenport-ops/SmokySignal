// Localstorage-backed rider region preference. No accounts, no
// server state. Other client components react to changes via the
// "ss-region-change" CustomEvent.

"use client";

import { DEFAULT_REGION, REGIONS, type RegionId } from "./regions";

const KEY = "ss_region_pref";
export const REGION_CHANGE_EVENT = "ss-region-change";

export function getRegion(): RegionId {
  if (typeof window === "undefined") return DEFAULT_REGION;
  try {
    const v = window.localStorage.getItem(KEY) as RegionId | null;
    return v && v in REGIONS ? v : DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

export function setRegion(id: RegionId): void {
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
