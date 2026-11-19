// /aircraft: per-tail "last flew" and 30-day flight counts. Pure (no KV),
// but server-only in practice: rollup-core pulls lib/flights.ts. The page
// reads rollup docs and today's tracks, folds them here, and hands rows to
// components/AircraftList.tsx (filter / sort in lib/aircraft-list.ts).
//
// Flights are the same stitched sessions /stats, /data and the logbook
// count (lib/rollup-core.ts stitchSessions over rollup sessions, plus
// today's track sessions that are not rolled up yet).

import { dedupeSessions } from "./rollup-sessions";
import { stitchSessions, type DailyRollup, type RollupSession } from "./rollup-core";

export const AIRCRAFT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export type TailActivity = {
  /** End of the most recent flight on file, ms. Null = none on file. */
  last_flew_ts: number | null;
  /** Flights that took off in the last 30 days. */
  flights_30d: number;
};

/**
 * Per-tail activity from rollup docs plus extra sessions (today's track
 * sessions, not rolled up yet). Tails with nothing on file are absent.
 */
export function aircraftActivity(
  docs: ReadonlyArray<DailyRollup>,
  extra: ReadonlyArray<{ tail: string; session: RollupSession }>,
  nowMs: number,
): Map<string, TailActivity> {
  const byTail = new Map<string, RollupSession[]>();
  for (const doc of docs) {
    for (const t of doc.tails) {
      const list = byTail.get(t.tail) ?? [];
      list.push(...t.sessions);
      byTail.set(t.tail, list);
    }
  }
  for (const { tail, session } of extra) {
    const list = byTail.get(tail) ?? [];
    list.push(session);
    byTail.set(tail, list);
  }
  const since = nowMs - AIRCRAFT_WINDOW_DAYS * DAY_MS;
  const out = new Map<string, TailActivity>();
  for (const [tail, raw] of byTail) {
    const flights = stitchSessions(tail, null, dedupeSessions(raw));
    if (flights.length === 0) continue;
    let last = 0;
    let n = 0;
    for (const f of flights) {
      if (f.end_ts > last) last = f.end_ts;
      if (f.start_ts >= since && f.start_ts <= nowMs) n++;
    }
    out.set(tail, { last_flew_ts: last || null, flights_30d: n });
  }
  return out;
}
