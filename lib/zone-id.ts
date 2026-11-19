// Hot-zone grid-cell IDs. Pure (no Redis / registry imports) so client
// components can derive a cell ID without pulling lib/hotzones.ts and
// its server-side dependencies into the browser bundle. lib/hotzones.ts
// re-exports these, so existing server imports keep working.

// ~0.5 nm per cell at 47°N — roughly the granularity at which patrol
// orbit patterns become visible without disappearing into the noise of
// individual position pings.
export const GRID_CELL_DEG = 0.0083;

/**
 * Stable string ID for the hot-zone cell containing (lat, lon). Same scheme
 * used by aggregateHotZones() to bucket pings, so a rider opting into zone
 * "${cellLat},${cellLon}" matches every airborne event whose coords fall
 * inside the same cell. Used by the push dispatcher to filter zone-scoped
 * subscriptions (lib/push/dispatcher.ts).
 */
export function zoneIdForPoint(lat: number, lon: number): string {
  const cellLat = Math.floor(lat / GRID_CELL_DEG) * GRID_CELL_DEG;
  const cellLon = Math.floor(lon / GRID_CELL_DEG) * GRID_CELL_DEG;
  return `${cellLat.toFixed(4)},${cellLon.toFixed(4)}`;
}

/** Inverse of zoneIdForPoint — returns the cell origin from an ID string. */
export function pointForZoneId(id: string): { lat: number; lon: number } | null {
  const m = /^(-?\d+\.\d+),(-?\d+\.\d+)$/.exec(id);
  if (!m) return null;
  return { lat: Number(m[1]), lon: Number(m[2]) };
}
