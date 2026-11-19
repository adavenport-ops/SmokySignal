// The one regional circle every point-query feed is asked for.
//
// State-centroid query covers all four corners of Washington plus the
// northern Oregon and Idaho panhandle borders within ~190 nm of center.
// adsb.fi, adsb.lol and airplanes.live all cap the radius at 250 nm
// (larger values return HTTP 400/422), so this is the largest single
// circle each allows: one request per feed per tick. Registry-tail
// filtering downstream drops any non-fleet leakage from BC / OR / ID.

export type Region = { lat: number; lon: number; nm: number };

export const MAX_POINT_RADIUS_NM = 250;

export const REGION: Region = {
  lat: Number(process.env.SS_REGION_LAT ?? 47.4),
  lon: Number(process.env.SS_REGION_LON ?? -120.8),
  nm: Math.min(MAX_POINT_RADIUS_NM, Number(process.env.SS_REGION_NM ?? 250)),
};

// "A feed returned zero rows" is read as a broken feed (the 2026-04-30
// ac→aircraft rename looked exactly like this) only because the default
// 250 nm circle over Washington always contains traffic. If SS_REGION_NM
// is set to a small radius, an empty sky is plausible, so zero rows is
// accepted as a real answer below this threshold.
export const ZERO_ROWS_MIN_RADIUS_NM = 100;

export function regionZeroIsFailure(region: Region = REGION): boolean {
  return region.nm >= ZERO_ROWS_MIN_RADIUS_NM;
}

/** Radius as the integer path segment the point endpoints accept. */
export function radiusSegment(region: Region): number {
  return Math.max(1, Math.min(MAX_POINT_RADIUS_NM, Math.round(region.nm)));
}
