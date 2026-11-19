// Distance rings around the rider on /radar (components/RadarMap.tsx).
//
// Statute miles, because riders read miles off a road sign, not nautical
// miles off a chart. Three rings, each labelled at its north edge
// ("5 mi"), so a glance says how far out a marker is. Pure: the map
// layer just takes the FeatureCollection.

/** Ring radii, statute miles. */
export const RING_MILES = [5, 10, 15] as const;

/** 1 statute mile in nautical miles; 1 nm is 1/60 degree of latitude. */
const NM_PER_MILE = 0.868976;
const SEGMENTS = 64;

export function milesToDegLat(mi: number): number {
  return (mi * NM_PER_MILE) / 60;
}

export function ringLabel(mi: number): string {
  return `${mi} mi`;
}

/** Closed ring of [lon, lat] points, `mi` statute miles from the centre. */
export function ringCoords(lat: number, lon: number, mi: number, segments = SEGMENTS): Array<[number, number]> {
  const dLat = milesToDegLat(mi);
  const dLon = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    out.push([lon + dLon * Math.sin(theta), lat + dLat * Math.cos(theta)]);
  }
  return out;
}

/** One LineString per ring plus one labelled Point at its north edge. */
export function ringFeatures(pos: { lat: number; lon: number } | null): GeoJSON.FeatureCollection {
  if (!pos) return { type: "FeatureCollection", features: [] };
  const features: GeoJSON.Feature[] = [];
  for (const mi of RING_MILES) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: ringCoords(pos.lat, pos.lon, mi) },
      properties: { mi },
    });
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pos.lon, pos.lat + milesToDegLat(mi)] },
      properties: { mi, label: ringLabel(mi) },
    });
  }
  return { type: "FeatureCollection", features };
}
