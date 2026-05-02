// Canonical region definitions for the radar/heat-map view. Used by
// the rider-side region selector to pivot the map without rewiring the
// data pipeline. The aggregator's geo-fence (lib/hotzones.ts) still
// runs at server scope; per-region heat-map filtering is a follow-up
// once the API supports it.

export type RegionId =
  | "puget_sound"
  | "pierce"
  | "snohomish"
  | "spokane"
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
  /** BBox used by /api/hotzones to filter heat cells to this region.
   *  Generous-but-bounded boxes — a Spokane rider should still see the
   *  occasional Pullman or Cheney patrol, just not Puget Sound. */
  bbox: RegionBbox;
};

export const REGIONS: Record<RegionId, Region> = {
  puget_sound: {
    id: "puget_sound",
    label: "Puget Sound",
    centerLat: 47.6,
    centerLon: -122.3,
    zoomLevel: 9,
    bbox: { latMin: 46.5, latMax: 48.5, lonMin: -123.5, lonMax: -121.5 },
  },
  pierce: {
    id: "pierce",
    label: "Pierce County",
    centerLat: 47.05,
    centerLon: -122.3,
    zoomLevel: 10,
    bbox: { latMin: 46.7, latMax: 47.4, lonMin: -122.9, lonMax: -121.6 },
  },
  snohomish: {
    id: "snohomish",
    label: "Snohomish County",
    centerLat: 48.0,
    centerLon: -121.9,
    zoomLevel: 10,
    bbox: { latMin: 47.65, latMax: 48.4, lonMin: -122.55, lonMax: -121.0 },
  },
  spokane: {
    id: "spokane",
    label: "Spokane",
    centerLat: 47.66,
    centerLon: -117.43,
    zoomLevel: 10,
    bbox: { latMin: 47.2, latMax: 48.1, lonMin: -118.2, lonMax: -116.7 },
  },
  all_wa: {
    id: "all_wa",
    label: "All Washington",
    centerLat: 47.4,
    centerLon: -120.5,
    zoomLevel: 7,
    bbox: null,
  },
};

export const DEFAULT_REGION: RegionId = "puget_sound";
