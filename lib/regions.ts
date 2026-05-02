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

export type Region = {
  id: RegionId;
  label: string;
  centerLat: number;
  centerLon: number;
  zoomLevel: number;
};

export const REGIONS: Record<RegionId, Region> = {
  puget_sound: {
    id: "puget_sound",
    label: "Puget Sound",
    centerLat: 47.6,
    centerLon: -122.3,
    zoomLevel: 9,
  },
  pierce: {
    id: "pierce",
    label: "Pierce County",
    centerLat: 47.05,
    centerLon: -122.3,
    zoomLevel: 10,
  },
  snohomish: {
    id: "snohomish",
    label: "Snohomish County",
    centerLat: 48.0,
    centerLon: -121.9,
    zoomLevel: 10,
  },
  spokane: {
    id: "spokane",
    label: "Spokane",
    centerLat: 47.66,
    centerLon: -117.43,
    zoomLevel: 10,
  },
  all_wa: {
    id: "all_wa",
    label: "All Washington",
    centerLat: 47.4,
    centerLon: -120.5,
    zoomLevel: 7,
  },
};

export const DEFAULT_REGION: RegionId = "puget_sound";
