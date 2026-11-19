// Coverage honesty: where the public ADS-B network loses our tails.
//
// A "lost contact" drop-out is a track that ends mid-air: the last sample
// of a session sits above ~800 ft, away from any listed airport, with no
// descent into a landing. Low-level coverage is the usual cause (terrain,
// few receivers), so the map of drop-outs is a map of where "quiet" can
// mean "unseen".
//
// Pure: no I/O, no clock reads. lib/history-digest.ts supplies 30 days of
// tracks. Cells reuse the hot-zone grid (lib/zone-id.ts), so a drop-out
// cell lines up with a heat cell on /radar.

import { nearestAirport } from "./airports";
import { GRID_CELL_DEG, zoneIdForPoint } from "./zone-id";
import { areaName } from "./places";
import { cleanPoints, splitSessions } from "./circling";
import type { TrackPoint } from "./tracks";

/** A session ending at or below this altitude reads as a landing, ft. */
export const DROPOUT_MIN_ALT_FT = 800;
/** A session ending within this distance of a listed field is a landing, nm. */
export const DROPOUT_AIRPORT_NM = 3;
/** Gap that ends a session, seconds. Same rule as the flight list. */
export const DROPOUT_GAP_S = 5 * 60;
/**
 * The feed must have heard some other tail within this long after the
 * loss. Without that, the gap is our poller being idle, not the tail
 * going dark, and the end of the session tells us nothing.
 */
export const DROPOUT_CONFIRM_S = 3 * 60;
export const COVERAGE_WINDOW_DAYS = 30;

export type Dropout = {
  tail: string;
  /** Last sample before contact was lost, ms. */
  ts: number;
  lat: number;
  lon: number;
  altFt: number;
};

export type DropoutOptions = {
  minAltFt?: number;
  airportNm?: number;
  gapS?: number;
  confirmS?: number;
  /**
   * Sorted unix-second timestamps at which the feed was sampled (any
   * tail). When given, a session end only counts if a sample landed
   * within `confirmS` after it.
   */
  sampleTimes?: ReadonlyArray<number>;
};

/** First index in sorted `arr` with value > x. */
function upperBound(arr: ReadonlyArray<number>, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Drop-outs in one tail's track. `nowS` keeps the live session (still
 * being heard) out: a track that simply has not ended yet is not lost.
 */
export function detectDropouts(
  tail: string,
  points: ReadonlyArray<TrackPoint>,
  nowS: number,
  opts: DropoutOptions = {},
): Dropout[] {
  const minAlt = opts.minAltFt ?? DROPOUT_MIN_ALT_FT;
  const airportNm = opts.airportNm ?? DROPOUT_AIRPORT_NM;
  const gapS = opts.gapS ?? DROPOUT_GAP_S;
  const confirmS = opts.confirmS ?? DROPOUT_CONFIRM_S;
  const samples = opts.sampleTimes;
  const out: Dropout[] = [];
  for (const session of splitSessions(cleanPoints(points), gapS)) {
    if (session.length < 3) continue;
    const last = session[session.length - 1]!;
    if (nowS - last.ts <= gapS) continue; // still live
    if (typeof last.alt !== "number" || !Number.isFinite(last.alt)) continue;
    if (last.alt <= minAlt) continue;
    if (nearestAirport(last.lat, last.lon, airportNm)) continue;
    if (samples) {
      const i = upperBound(samples, last.ts);
      const heard = i < samples.length && samples[i]! - last.ts <= confirmS;
      if (!heard) continue;
    }
    out.push({ tail, ts: last.ts * 1000, lat: last.lat, lon: last.lon, altFt: last.alt });
  }
  return out;
}

/** Sorted, de-duplicated sample timestamps across every tail's points. */
export function sampleTimesOf(tracks: Iterable<ReadonlyArray<TrackPoint>>): number[] {
  const set = new Set<number>();
  for (const pts of tracks) for (const p of pts) if (Number.isFinite(p.ts)) set.add(p.ts);
  return [...set].sort((a, b) => a - b);
}

export type CoverageCell = {
  /** Hot-zone cell id (lib/zone-id.ts). */
  id: string;
  /** Cell centre. */
  lat: number;
  lon: number;
  count: number;
  tails: string[];
  /** Newest drop-out in the cell, ms. */
  lastTs: number;
};

/** Bucket drop-outs into hot-zone grid cells, most drop-outs first. */
export function aggregateDropouts(dropouts: ReadonlyArray<Dropout>): CoverageCell[] {
  const cells = new Map<string, { cellLat: number; cellLon: number; count: number; tails: Set<string>; lastTs: number }>();
  for (const d of dropouts) {
    const id = zoneIdForPoint(d.lat, d.lon);
    const cellLat = Math.floor(d.lat / GRID_CELL_DEG) * GRID_CELL_DEG;
    const cellLon = Math.floor(d.lon / GRID_CELL_DEG) * GRID_CELL_DEG;
    const c = cells.get(id);
    if (c) {
      c.count++;
      c.tails.add(d.tail);
      if (d.ts > c.lastTs) c.lastTs = d.ts;
    } else {
      cells.set(id, { cellLat, cellLon, count: 1, tails: new Set([d.tail]), lastTs: d.ts });
    }
  }
  const out: CoverageCell[] = [];
  for (const [id, c] of cells) {
    out.push({
      id,
      lat: round4(c.cellLat + GRID_CELL_DEG / 2),
      lon: round4(c.cellLon + GRID_CELL_DEG / 2),
      count: c.count,
      tails: [...c.tails].sort(),
      lastTs: c.lastTs,
    });
  }
  out.sort((a, b) => b.count - a.count || b.lastTs - a.lastTs || a.id.localeCompare(b.id));
  return out;
}

export type CoverageArea = { name: string; count: number };

/**
 * Drop-outs tallied by area name (nearest named place, else region),
 * most first. Ties break alphabetically so the pick is stable.
 */
export function dropoutsByArea(
  items: ReadonlyArray<{ lat: number; lon: number; count?: number }>,
  nameFor: (lat: number, lon: number) => string | null = areaName,
): CoverageArea[] {
  const tally = new Map<string, number>();
  for (const it of items) {
    const name = nameFor(it.lat, it.lon);
    if (!name) continue;
    tally.set(name, (tally.get(name) ?? 0) + (it.count ?? 1));
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type CoverageSummary = {
  windowDays: number;
  dropouts: number;
  cells: CoverageCell[];
  /** Area with the most drop-outs, or null with no data. */
  weakest: CoverageArea | null;
  /** Top areas, weakest first. */
  areas: CoverageArea[];
};

export function summarizeCoverage(
  dropouts: ReadonlyArray<Dropout>,
  windowDays = COVERAGE_WINDOW_DAYS,
): CoverageSummary {
  const cells = aggregateDropouts(dropouts);
  const areas = dropoutsByArea(cells);
  return {
    windowDays,
    dropouts: dropouts.length,
    cells,
    weakest: areas[0] ?? null,
    areas: areas.slice(0, 8),
  };
}

/** The one-line caveat. Names the weakest area when the data has one. */
export function coverageNoteText(area: string | null | undefined): string {
  return area
    ? `Quiet here can mean unseen. Low-level coverage is thin in ${area}.`
    : "Quiet here can mean unseen. Low-level coverage has gaps we have not mapped yet.";
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
