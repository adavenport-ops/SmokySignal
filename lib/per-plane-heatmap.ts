// Per-plane hot zones — same grid bucketing as lib/hotzones.ts but
// scoped to a single tail. Powers the "where this plane patrols"
// section on the plane detail page. Cached in KV at hotzones:plane:{tail}
// with a 6h TTL so repeated visits to a popular tail page don't
// re-aggregate from scratch.
//
// Unlike the fleet-wide aggregator we deliberately do NOT apply the
// Puget Sound region filter — a smokey deployed to Tri-Cities should
// still show its Tri-Cities patrol pattern on its own page.

import { getRedis } from "./cache";
import { listTrackKeys, getTracksForDay } from "./tracks";
import { GRID_CELL_DEG, HOTZONE_DAYS_BACK, type HotZone } from "./hotzones";

const TTL_SECONDS = 6 * 60 * 60;

function cacheKey(tail: string): string {
  return `hotzones:plane:${tail.toUpperCase()}`;
}

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export async function aggregateTailHotZones(tail: string): Promise<HotZone[]> {
  const upper = tail.toUpperCase();
  const dates = await listTrackKeys(upper);
  const cutoff = utcDateKey(
    new Date(Date.now() - HOTZONE_DAYS_BACK * 86_400_000),
  );
  const keep = dates.filter((d) => d >= cutoff);

  const cells = new Map<
    string,
    { count: number; cellLat: number; cellLon: number }
  >();
  for (const date of keep) {
    const points = await getTracksForDay(upper, date);
    for (const p of points) {
      const cellLat = Math.floor(p.lat / GRID_CELL_DEG) * GRID_CELL_DEG;
      const cellLon = Math.floor(p.lon / GRID_CELL_DEG) * GRID_CELL_DEG;
      const key = `${cellLat.toFixed(4)},${cellLon.toFixed(4)}`;
      const cell = cells.get(key);
      if (cell) cell.count += 1;
      else cells.set(key, { count: 1, cellLat, cellLon });
    }
  }

  const out: HotZone[] = [];
  for (const v of cells.values()) {
    out.push({
      lat: v.cellLat + GRID_CELL_DEG / 2,
      lon: v.cellLon + GRID_CELL_DEG / 2,
      count: v.count,
      tails: [upper],
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export async function getTailHotZonesCached(tail: string): Promise<HotZone[]> {
  const redis = await getRedis();
  if (!redis) return aggregateTailHotZones(tail);
  const key = cacheKey(tail);
  try {
    const raw = await redis.get(key);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) return parsed as HotZone[];
    }
  } catch {
    // fallthrough — recompute on parse error
  }
  const fresh = await aggregateTailHotZones(tail);
  try {
    await redis.set(key, JSON.stringify(fresh), { ex: TTL_SECONDS });
  } catch {
    // best-effort cache write
  }
  return fresh;
}
