// Hot zones — grid-cell aggregation of where fleet aircraft have spent
// time over the last HOTZONE_DAYS_BACK days. Powers the heatmap layer
// on /radar. Refreshed daily by a Vercel cron job calling
// /api/cron/refresh-hotzones, which invokes refreshHotZones() below.
//
// Storage:
//   hotzones:current          → JSON array of HotZone, 25h TTL
//   hotzones:last_refresh_ts  → number (ms), 25h TTL
//
// Reads are served from hotzones:current; if missing the API returns []
// and the next cron tick repopulates.

import { getRedis } from "./cache";
import { getRegistry } from "./registry";
import { listTrackKeys, getTracksForDay } from "./tracks";

// ~0.5 nm per cell at 47°N — roughly the granularity at which patrol
// orbit patterns become visible without disappearing into the noise of
// individual position pings.
export const GRID_CELL_DEG = 0.0083;
export const HOTZONE_DAYS_BACK = 30;
// Defensive Pacific-NW envelope. Anything outside is data-quality
// noise — old ADS-B records under a recycled N-number, hex collision
// from a different aircraft using the same Mode-S code, etc. Live
// snapshots from /api/aircraft already region-filter so this only
// matters for the historical backfill path.
const REGION_LAT_MIN = 45.0;
const REGION_LAT_MAX = 49.5;
const REGION_LON_MIN = -125.0;
const REGION_LON_MAX = -116.0;

function inRegion(lat: number, lon: number): boolean {
  return (
    lat >= REGION_LAT_MIN &&
    lat <= REGION_LAT_MAX &&
    lon >= REGION_LON_MIN &&
    lon <= REGION_LON_MAX
  );
}

const CURRENT_KEY = "hotzones:current";
const LAST_REFRESH_KEY = "hotzones:last_refresh_ts";
const TTL_SECONDS = 25 * 60 * 60;

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

export type HotZone = {
  /** Cell centroid latitude. */
  lat: number;
  /** Cell centroid longitude. */
  lon: number;
  /** Total ping count across all contributing tails. */
  count: number;
  /** Distinct tails that contributed at least one point to this cell. */
  tails: string[];
};

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Walk every tail's daily track keys for the last HOTZONE_DAYS_BACK
 * days, bucket each point into a GRID_CELL_DEG² cell, and emit one
 * HotZone per cell with count and contributing-tail set.
 *
 * Sorted by count DESC.
 */
export async function aggregateHotZones(): Promise<HotZone[]> {
  const registry = await getRegistry();
  const now = Date.now();
  const cutoff = utcDateKey(new Date(now - HOTZONE_DAYS_BACK * 86_400_000));

  const cells = new Map<
    string,
    { count: number; tails: Set<string>; cellLat: number; cellLon: number }
  >();

  for (const t of registry) {
    const dates = await listTrackKeys(t.tail);
    const keep = dates.filter((d) => d >= cutoff);
    for (const date of keep) {
      const points = await getTracksForDay(t.tail, date);
      for (const p of points) {
        if (!inRegion(p.lat, p.lon)) continue;
        const cellLat = Math.floor(p.lat / GRID_CELL_DEG) * GRID_CELL_DEG;
        const cellLon = Math.floor(p.lon / GRID_CELL_DEG) * GRID_CELL_DEG;
        const key = `${cellLat.toFixed(4)},${cellLon.toFixed(4)}`;
        const cell = cells.get(key);
        if (cell) {
          cell.count += 1;
          cell.tails.add(t.tail);
        } else {
          cells.set(key, {
            count: 1,
            tails: new Set([t.tail]),
            cellLat,
            cellLon,
          });
        }
      }
    }
  }

  const out: HotZone[] = [];
  for (const v of cells.values()) {
    out.push({
      lat: v.cellLat + GRID_CELL_DEG / 2,
      lon: v.cellLon + GRID_CELL_DEG / 2,
      count: v.count,
      tails: [...v.tails],
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export async function getHotZonesCached(): Promise<HotZone[]> {
  const redis = await getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get(CURRENT_KEY);
    if (!raw) return [];
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as HotZone[]) : [];
    }
    if (Array.isArray(raw)) return raw as HotZone[];
    return [];
  } catch {
    return [];
  }
}

export async function getLastHotZoneRefresh(): Promise<number | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(LAST_REFRESH_KEY);
    if (raw == null) return null;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function refreshHotZones(): Promise<{
  zoneCount: number;
  ts: number;
}> {
  const redis = await getRedis();
  if (!redis) throw new Error("KV not configured");
  const zones = await aggregateHotZones();
  const ts = Date.now();
  await redis.set(CURRENT_KEY, JSON.stringify(zones), { ex: TTL_SECONDS });
  await redis.set(LAST_REFRESH_KEY, ts, { ex: TTL_SECONDS });
  return { zoneCount: zones.length, ts };
}
