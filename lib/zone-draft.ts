// The radar's add-zone sheet (components/AddZoneSheet.tsx) and the zones
// list (/settings/zones): naming a zone from the nearest place, radius
// chips in statute miles, the draft state, and the undo window after a
// save. Pure and client-safe; storage stays in lib/user-zones.ts.
//
// Zones are stored in nautical miles (radiusNm) because the push
// dispatcher matches takeoffs in nm. Riders pick and read statute miles.

import { haversineNm } from "./geo";
import { PLACES, areaName } from "./places";
import { TOWNS } from "./towns";

/** Radius chips on the sheet, statute miles. */
export const ZONE_RADII_MI = [2, 5, 10] as const;
export type ZoneRadiusMi = (typeof ZONE_RADII_MI)[number];
export const DEFAULT_ZONE_RADIUS_MI: ZoneRadiusMi = 5;

/** A place further than this from the centre doesn't name the zone, nm. */
export const ZONE_PLACE_MAX_NM = 12;
/** How long the "Zone added … Undo" toast stays up, ms. */
export const ZONE_UNDO_MS = 6000;
/** Fallback name when no place or region is near. */
export const ZONE_FALLBACK_NAME = "My zone";

const NM_PER_MI = 0.868976;

export function miToNm(mi: number): number {
  return mi * NM_PER_MI;
}

export function nmToMi(nm: number): number {
  return nm / NM_PER_MI;
}

/** Whole statute miles for a stored zone; never below 1. */
export function zoneRadiusMi(z: { radiusNm: number; radiusMi?: number }): number {
  if (typeof z.radiusMi === "number" && Number.isFinite(z.radiusMi)) return z.radiusMi;
  return Math.max(1, Math.round(nmToMi(z.radiusNm)));
}

export function formatZoneRadius(z: { radiusNm: number; radiusMi?: number }): string {
  return `${zoneRadiusMi(z)} mi`;
}

type NamedPoint = { name: string; lat: number; lon: number };

/** Corridor places plus the town list, de-duplicated by name. */
function gazetteer(): NamedPoint[] {
  const seen = new Map<string, NamedPoint>();
  for (const p of PLACES) seen.set(p.name, { name: p.name, lat: p.lat, lon: p.lon });
  for (const t of TOWNS) if (!seen.has(t.name)) seen.set(t.name, { name: t.name, lat: t.lat, lon: t.lon });
  return [...seen.values()];
}

let cached: NamedPoint[] | null = null;

/**
 * The place a zone centre sits nearest: the closest corridor place or
 * town within ZONE_PLACE_MAX_NM, else the region label, else null.
 */
export function zonePlaceName(
  lat: number,
  lon: number,
  places: ReadonlyArray<NamedPoint> = (cached ??= gazetteer()),
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: NamedPoint | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = haversineNm(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best && bestD <= ZONE_PLACE_MAX_NM) return best.name;
  return areaName(lat, lon);
}

/**
 * A default name for a new zone: the place name, with a number when the
 * rider already has a zone by that name ("Fife", "Fife 2").
 */
export function defaultZoneName(
  lat: number,
  lon: number,
  existingLabels: ReadonlyArray<string> = [],
  places?: ReadonlyArray<NamedPoint>,
): string {
  const base = zonePlaceName(lat, lon, places) ?? ZONE_FALLBACK_NAME;
  const taken = new Set(existingLabels.map((l) => l.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return base;
}

/** "47.238, -122.354": the small secondary line under a zone name. */
export function formatZoneCoords(lat: number, lon: number): string {
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

export function zoneAddedText(name: string, radiusMi: number): string {
  return `Zone added: ${name}, ${radiusMi} mi`;
}

// ---------------------------------------------------------------------
// Draft state for the sheet.

export type ZonePoint = { lat: number; lon: number };

export type ZoneDraft = {
  /** Where the centre came from; null until one is chosen. */
  source: "gps" | "pin" | null;
  point: ZonePoint | null;
  /** True while the sheet waits for a tap on the map. */
  placing: boolean;
  name: string;
  /** The rider typed a name; a new point no longer renames the zone. */
  nameEdited: boolean;
  radiusMi: ZoneRadiusMi;
};

export type ZoneDraftAction =
  | { type: "use-location"; point: ZonePoint; existing?: ReadonlyArray<string> }
  | { type: "start-pin" }
  | { type: "cancel-pin" }
  | { type: "drop-pin"; point: ZonePoint; existing?: ReadonlyArray<string> }
  | { type: "rename"; name: string }
  | { type: "radius"; radiusMi: ZoneRadiusMi };

export function initialZoneDraft(
  rider: ZonePoint | null,
  existing: ReadonlyArray<string> = [],
): ZoneDraft {
  return {
    source: rider ? "gps" : null,
    point: rider,
    placing: false,
    name: rider ? defaultZoneName(rider.lat, rider.lon, existing) : "",
    nameEdited: false,
    radiusMi: DEFAULT_ZONE_RADIUS_MI,
  };
}

export function zoneDraftReducer(d: ZoneDraft, a: ZoneDraftAction): ZoneDraft {
  switch (a.type) {
    case "use-location":
    case "drop-pin":
      return {
        ...d,
        source: a.type === "use-location" ? "gps" : "pin",
        point: a.point,
        placing: false,
        name: d.nameEdited ? d.name : defaultZoneName(a.point.lat, a.point.lon, a.existing ?? []),
      };
    case "start-pin":
      return { ...d, placing: true };
    case "cancel-pin":
      return { ...d, placing: false };
    case "rename":
      return { ...d, name: a.name, nameEdited: a.name.trim().length > 0 };
    case "radius":
      return ZONE_RADII_MI.includes(a.radiusMi) ? { ...d, radiusMi: a.radiusMi } : d;
  }
}

export function canSaveZone(d: ZoneDraft): boolean {
  return !!d.point && !d.placing;
}

/** The addUserZone() input for a draft, or null when it can't save yet. */
export function zoneInputFromDraft(d: ZoneDraft): {
  lat: number;
  lon: number;
  radiusNm: number;
  radiusMi: number;
  label: string;
  place: string | undefined;
} | null {
  if (!canSaveZone(d) || !d.point) return null;
  const place = zonePlaceName(d.point.lat, d.point.lon) ?? undefined;
  return {
    lat: d.point.lat,
    lon: d.point.lon,
    radiusNm: Number(miToNm(d.radiusMi).toFixed(3)),
    radiusMi: d.radiusMi,
    label: d.name.trim() || place || ZONE_FALLBACK_NAME,
    place,
  };
}

// ---------------------------------------------------------------------
// Undo window after a save.

export type ZoneUndo =
  | { kind: "idle" }
  | { kind: "added"; zoneId: string; text: string; until: number }
  | { kind: "undone"; text: string; until: number };

export type ZoneUndoAction =
  | { type: "added"; zoneId: string; name: string; radiusMi: number; now: number }
  | { type: "undo"; now: number }
  | { type: "tick"; now: number };

export function zoneUndoReducer(s: ZoneUndo, a: ZoneUndoAction): ZoneUndo {
  switch (a.type) {
    case "added":
      return {
        kind: "added",
        zoneId: a.zoneId,
        text: zoneAddedText(a.name, a.radiusMi),
        until: a.now + ZONE_UNDO_MS,
      };
    case "undo":
      if (s.kind !== "added" || a.now > s.until) return s;
      return { kind: "undone", text: "Zone removed", until: a.now + 2500 };
    case "tick":
      if (s.kind !== "idle" && a.now >= s.until) return { kind: "idle" };
      return s;
  }
}

/** The zone id an undo should remove, or null when the window closed. */
export function zoneToRemoveOnUndo(s: ZoneUndo, now: number): string | null {
  return s.kind === "added" && now <= s.until ? s.zoneId : null;
}
