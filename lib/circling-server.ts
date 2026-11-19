// IO half of /circling and /api/circling: the live snapshot plus today's
// track points for each airborne tail, folded through lib/circling.ts.
//
// Reads are deterministic (airborne tails × today, plus yesterday when a
// session may have started before 00:00 UTC). No SCAN, no writes.

import { getSnapshot } from "./snapshot";
import { readTrackDays, utcDay } from "./track-reader";
import {
  CIRCLING_SESSION_GAP_S,
  circlingFromTrack,
  sortByPattern,
  type CirclingItem,
} from "./circling";
import { missionLabel } from "./role-display";
import { normalizeMission } from "./mission";

export type AlsoUp = { tail: string; name: string; missionLabel: string };

export type CirclingResponse = {
  /** When the snapshot behind this list was true, ms. */
  fetched_at: number;
  /** Every upstream feed failed; the list is not a live read. */
  degraded: boolean;
  patterns: CirclingItem[];
  /** Airborne tails that are not working a pattern right now. */
  also_up: AlsoUp[];
};

const DAY_MS = 86_400_000;

export async function getCirclingNow(nowMs = Date.now()): Promise<CirclingResponse> {
  const snap = await getSnapshot();
  const airborne = snap.aircraft.filter(
    (a) => a.airborne && typeof a.lat === "number" && typeof a.lon === "number",
  );
  if (snap.degraded || airborne.length === 0) {
    return {
      fetched_at: snap.fetched_at,
      degraded: Boolean(snap.degraded),
      patterns: [],
      also_up: snap.degraded
        ? []
        : airborne.map((a) => ({
            tail: a.tail,
            name: a.nickname?.trim() || a.tail,
            missionLabel: missionLabel(normalizeMission(a.role)),
          })),
    };
  }

  const today = utcDay(nowMs);
  const yesterday = utcDay(nowMs - DAY_MS);
  const tails = airborne.map((a) => a.tail);
  const todays = await readTrackDays(tails, [today]);

  // A session that began before 00:00 UTC (16:00 or 17:00 PT, prime
  // flying time) needs yesterday's tail end for its start and duration.
  const midnightS = Math.floor(Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  ) / 1000);
  const needYesterday = tails.filter((t) => {
    const pts = todays.get(t);
    return !pts || pts.length === 0 || pts[0]!.ts - midnightS <= CIRCLING_SESSION_GAP_S;
  });
  const prior = needYesterday.length > 0 ? await readTrackDays(needYesterday, [yesterday]) : new Map();

  const nowS = Math.floor(nowMs / 1000);
  const patterns: CirclingItem[] = [];
  const also: AlsoUp[] = [];
  for (const a of airborne) {
    const pts = [...(prior.get(a.tail) ?? []), ...(todays.get(a.tail) ?? [])];
    const item = circlingFromTrack(a, pts, nowS);
    if (item) patterns.push(item);
    else
      also.push({
        tail: a.tail,
        name: a.nickname?.trim() || a.tail,
        missionLabel: missionLabel(normalizeMission(a.role)),
      });
  }
  return {
    fetched_at: snap.fetched_at,
    degraded: false,
    patterns: sortByPattern(patterns),
    also_up: also,
  };
}
