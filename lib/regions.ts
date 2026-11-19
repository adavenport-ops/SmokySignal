// Canonical region definitions. On /radar a region is a CAMERA preset
// only (lib/radar-view.ts fits the map to REGIONS[id].bbox); the heat
// grid and flight paths are statewide-plus and never clipped to it.
// The bboxes still act as data filters on /board (lib/board.ts) and as
// the label lookup for share cards (regionForPoint).
//
// Six geographic buckets + an All-WA overview. The prior county-level
// presets (pierce/snohomish/spokane) retired in favor of these — Pierce
// and Snohomish fold into Puget Sound, Spokane folds into East WA.
// lib/region-pref.ts maps legacy persisted IDs forward.

export type RegionId =
  | "puget_sound"
  | "north_sound"
  | "olympic"
  | "sw_wa"
  | "central_wa"
  | "east_wa"
  | "all_wa";

/** Bounding box for a region. `null` means unfiltered (whole-state view). */
export type RegionBbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
} | null;

export type Region = {
  id: RegionId;
  label: string;
  centerLat: number;
  centerLon: number;
  zoomLevel: number;
  bbox: RegionBbox;
};

export const REGIONS: Record<RegionId, Region> = {
  puget_sound: {
    id: "puget_sound",
    label: "Puget Sound",
    centerLat: 47.6,
    centerLon: -122.3,
    zoomLevel: 8,
    // King + Pierce + Snohomish + Kitsap.
    bbox: { latMin: 47.0, latMax: 48.4, lonMin: -122.9, lonMax: -121.4 },
  },
  north_sound: {
    id: "north_sound",
    label: "North Sound",
    centerLat: 48.5,
    centerLon: -122.4,
    zoomLevel: 8,
    // Whatcom + Skagit + Island + San Juan.
    bbox: { latMin: 48.0, latMax: 49.0, lonMin: -123.3, lonMax: -121.5 },
  },
  olympic: {
    id: "olympic",
    label: "Olympic Peninsula",
    centerLat: 47.6,
    centerLon: -123.6,
    zoomLevel: 8,
    // Clallam + Jefferson + Mason + Grays Harbor.
    bbox: { latMin: 46.9, latMax: 48.4, lonMin: -124.7, lonMax: -123.0 },
  },
  sw_wa: {
    id: "sw_wa",
    label: "Southwest WA",
    centerLat: 46.2,
    centerLon: -122.7,
    zoomLevel: 8,
    // Cowlitz + Lewis + Wahkiakum + Pacific + Clark + Skamania.
    bbox: { latMin: 45.5, latMax: 47.0, lonMin: -124.0, lonMax: -121.5 },
  },
  central_wa: {
    id: "central_wa",
    label: "Central WA",
    centerLat: 47.0,
    centerLon: -120.0,
    zoomLevel: 7,
    // Chelan + Kittitas + Yakima + Grant + Douglas + Okanogan.
    bbox: { latMin: 46.0, latMax: 48.9, lonMin: -121.0, lonMax: -118.5 },
  },
  east_wa: {
    id: "east_wa",
    label: "East WA",
    // Centered between Spokane and Tri-Cities so the default zoom-7 view
    // surfaces both — that's where most east-side aircraft appear.
    centerLat: 47.0,
    centerLon: -118.0,
    zoomLevel: 7,
    // Spokane + Lincoln + Adams + Whitman + Walla Walla + Benton + Franklin
    // + Columbia + Garfield + Asotin + Stevens + Ferry + Pend Oreille.
    bbox: { latMin: 46.0, latMax: 49.0, lonMin: -119.7, lonMax: -116.9 },
  },
  all_wa: {
    id: "all_wa",
    label: "All Washington",
    centerLat: 47.4,
    centerLon: -120.5,
    zoomLevel: 6,
    bbox: null,
  },
};

// Default camera for a first-time rider. Puget Sound is where most of
// the audience rides; the data behind it is statewide, so zooming out
// from here reveals the rest of the heat and routes without a re-pick.
export const DEFAULT_REGION: RegionId = "puget_sound";

/** Washington state outline as a camera box (the "All of Washington"
 *  preset). Distinct from all_wa's null bbox, which means "no data
 *  filter" to /board. */
export const WA_STATE_BBOX: NonNullable<RegionBbox> = {
  latMin: 45.54,
  latMax: 49.0,
  lonMin: -124.85,
  lonMax: -116.9,
};

/**
 * Outer envelope for which track points are kept in the heat grid and
 * flight paths. Washington plus the Oregon and Idaho border areas, so
 * mutual-aid sorties outside the state still show. Anything beyond it
 * is treated as data-quality noise (a recycled N-number, a Mode-S hex
 * collision far from the Northwest).
 */
export const TRACKING_ENVELOPE: NonNullable<RegionBbox> = {
  latMin: 41.5,
  latMax: 49.5,
  lonMin: -125.5,
  lonMax: -110.5,
};

export function inBbox(
  lat: number,
  lon: number,
  b: NonNullable<RegionBbox>,
): boolean {
  return (
    lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax
  );
}

export function inTrackingEnvelope(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    inBbox(lat, lon, TRACKING_ENVELOPE)
  );
}

/**
 * Pick the region whose bbox contains (lat, lon). When multiple bboxes
 * overlap, prefers the smaller (more specific) one. Falls back to nearest
 * centroid by haversine if no bbox contains the point. Returns null only
 * for inputs outside the WA state envelope by enough margin that no
 * region is a reasonable match — callers should use DEFAULT_REGION.
 *
 * Used by the share card to name where a plane is (lib/share-card.ts).
 */
export function regionForPoint(lat: number, lon: number): RegionId | null {
  let best: { id: RegionId; area: number } | null = null;
  for (const r of Object.values(REGIONS)) {
    if (!r.bbox) continue;
    const { latMin, latMax, lonMin, lonMax } = r.bbox;
    if (lat < latMin || lat > latMax) continue;
    if (lon < lonMin || lon > lonMax) continue;
    const area = (latMax - latMin) * (lonMax - lonMin);
    if (!best || area < best.area) best = { id: r.id, area };
  }
  if (best) return best.id;
  // No bbox match — fall back to nearest centroid. We skip all_wa
  // (null bbox, but its centroid is also a candidate) so the pick is
  // a real geographic region, not the overview.
  let nearest: { id: RegionId; d2: number } | null = null;
  for (const r of Object.values(REGIONS)) {
    if (r.id === "all_wa") continue;
    const dlat = lat - r.centerLat;
    const dlon = lon - r.centerLon;
    const d2 = dlat * dlat + dlon * dlon;
    if (!nearest || d2 < nearest.d2) nearest = { id: r.id, d2 };
  }
  return nearest?.id ?? null;
}
