// One read of the last 30 days of tracks, folded into everything the road
// pages and the coverage caveat need. Cached for 5 minutes in the Next
// data cache, so a burst of visitors costs one pass over KV.
//
// Reads are deterministic: registry tails × the last 31 UTC day keys
// (tracks:{tail}:{YYYYMMDD}) in LRANGE pipelines, plus the activity feed
// list. No SCAN, no writes.

import { unstable_cache } from "next/cache";
import { getRegistry } from "./registry";
import { getActivityRange, getRecentActivity, type ActivityEntry } from "./activity";
import { formatTs } from "./time";
import { lastUtcDays, readTrackDays } from "./track-reader";
import { CORRIDORS } from "./corridor";
import {
  ROAD_WINDOW_DAYS,
  emptyRoadSummary,
  eventsNearRoad,
  isOverRoad,
  passesForTrack,
  summarizeRoad,
  type RoadPass,
  type RoadSummary,
} from "./road";
import {
  COVERAGE_WINDOW_DAYS,
  detectDropouts,
  dropoutsByArea,
  sampleTimesOf,
  summarizeCoverage,
  type CoverageSummary,
  type Dropout,
} from "./coverage";

const DAY_MS = 86_400_000;
export const HISTORY_CACHE_SECONDS = 300;
/** Drop-out cells within this distance of a corridor name its caveat, nm. */
const ROAD_COVERAGE_NM = 5;

export type HistoryDigest = {
  builtAt: number;
  windowDays: number;
  /** Tails that had at least one point in the window. */
  tailsHeard: number;
  roads: Record<string, RoadSummary>;
  coverage: CoverageSummary;
  /** Weakest coverage area near each corridor, else null. */
  roadCoverage: Record<string, string | null>;
};

export function emptyDigest(nowMs: number): HistoryDigest {
  const roads: Record<string, RoadSummary> = {};
  const roadCoverage: Record<string, string | null> = {};
  for (const c of CORRIDORS) {
    roads[c.id] = emptyRoadSummary(c);
    roadCoverage[c.id] = null;
  }
  return {
    builtAt: nowMs,
    windowDays: ROAD_WINDOW_DAYS,
    tailsHeard: 0,
    roads,
    coverage: summarizeCoverage([], COVERAGE_WINDOW_DAYS),
    roadCoverage,
  };
}

/**
 * Takeoffs and landings in the window: the permanent per-day archive,
 * topped up with the rolling feed (covers days before the archive began).
 */
async function readActivity(sinceMs: number, nowMs: number): Promise<ActivityEntry[]> {
  const [archived, recent] = await Promise.all([
    getActivityRange(formatTs(sinceMs, "date"), formatTs(nowMs, "date")).catch(() => []),
    getRecentActivity(500).catch(() => []),
  ]);
  const seen = new Set<string>();
  const out: ActivityEntry[] = [];
  for (const e of [...archived, ...recent]) {
    const k = `${e.tail}|${e.kind}|${e.ts}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export async function buildHistoryDigest(nowMs: number): Promise<HistoryDigest> {
  const registry = await getRegistry();
  const sinceMs = nowMs - ROAD_WINDOW_DAYS * DAY_MS;
  const sinceS = Math.floor(sinceMs / 1000);
  const nowS = Math.floor(nowMs / 1000);
  // 31 day keys: the window's oldest UTC day is partial.
  const dates = lastUtcDays(nowMs, ROAD_WINDOW_DAYS + 1);
  const [tracks, activity] = await Promise.all([
    readTrackDays(
      registry.map((r) => r.tail),
      dates,
    ),
    readActivity(sinceMs, nowMs),
  ]);

  const passes = new Map<string, RoadPass[]>(CORRIDORS.map((c) => [c.id, []]));
  const sampleTimes = sampleTimesOf(tracks.values());
  const dropouts: Dropout[] = [];
  let tailsHeard = 0;

  for (const entry of registry) {
    const all = tracks.get(entry.tail);
    if (!all || all.length === 0) continue;
    const pts = all.filter((p) => p.ts >= sinceS);
    if (pts.length === 0) continue;
    tailsHeard++;
    for (const c of CORRIDORS) {
      passes.get(c.id)!.push(...passesForTrack(entry, pts, c));
    }
    dropouts.push(...detectDropouts(entry.tail, pts, nowS, { sampleTimes }));
  }

  const coverage = summarizeCoverage(dropouts, COVERAGE_WINDOW_DAYS);
  const roads: Record<string, RoadSummary> = {};
  const roadCoverage: Record<string, string | null> = {};
  for (const c of CORRIDORS) {
    const events = eventsNearRoad(activity, c, sinceMs);
    roads[c.id] = summarizeRoad(c, passes.get(c.id)!, events, nowMs);
    const near = coverage.cells.filter((cell) => isOverRoad(cell.lat, cell.lon, c, ROAD_COVERAGE_NM));
    roadCoverage[c.id] = dropoutsByArea(near)[0]?.name ?? null;
  }

  return {
    builtAt: nowMs,
    windowDays: ROAD_WINDOW_DAYS,
    tailsHeard,
    roads,
    coverage,
    roadCoverage,
  };
}

const cachedDigest = unstable_cache(
  async () => buildHistoryDigest(Date.now()),
  ["history-digest-v1"],
  { revalidate: HISTORY_CACHE_SECONDS },
);

/** Cached digest; an empty one (never a throw) when KV is down. */
export async function getHistoryDigest(): Promise<HistoryDigest> {
  try {
    return await cachedDigest();
  } catch (e) {
    console.warn("[history-digest] build failed:", e);
    return emptyDigest(Date.now());
  }
}
