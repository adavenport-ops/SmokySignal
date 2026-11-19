// IO half of GET /api/seen. Reads tracks:{tail}:{YYYYMMDD} for every
// registry tail across only the UTC day(s) the window touches, LLEN first
// to size the read, then pipelined LRANGE batches (lib/tracks.ts
// getTrackLengths + getTracksForPairs). No SCAN, never writes.
//
// The rider's point never leaves this function: it is not logged, cached
// or stored. Folding lives in lib/seen-core.ts.

import { getRegistry } from "./registry";
import { getTrackLengths, getTracksForPairs } from "./tracks";
import {
  SESSION_GAP_S,
  buildSeenItem,
  previousUtcDay,
  seenBody,
  utcDaysForWindow,
  type DayTrack,
  type SeenQuery,
} from "./seen-core";
import type { SeenBody, SeenItem } from "./seen-view";
import type { FleetEntry } from "./types";

/** Refuse a read past this many points (a window is at most ~3 h of track). */
export const SEEN_MAX_POINTS_READ = 120_000;

export type SeenResult =
  | { ok: true; body: SeenBody }
  | { ok: false; error: "range_too_large"; points: number };

async function readDays(tails: string[], dates: string[]): Promise<{ byTail: Map<string, DayTrack[]>; points: number } | null> {
  const pairs = tails.flatMap((tail) => dates.map((date) => ({ tail, date })));
  const lengths = await getTrackLengths(pairs);
  const points = lengths.reduce((n, l) => n + l, 0);
  if (points > SEEN_MAX_POINTS_READ) return null;
  const perPair = await getTracksForPairs(pairs, lengths);
  const byTail = new Map<string, DayTrack[]>();
  pairs.forEach(({ tail, date }, i) => {
    const pts = perPair[i] ?? [];
    if (pts.length === 0) return;
    const list = byTail.get(tail) ?? [];
    list.push({ date, points: pts });
    byTail.set(tail, list);
  });
  return { byTail, points };
}

export async function loadSeen(q: SeenQuery): Promise<SeenResult> {
  if (q.status !== "ok") return { ok: true, body: seenBody(q, []) };

  const fleet = await getRegistry();
  const byTail = new Map<string, FleetEntry>(fleet.map((f) => [f.tail, f]));
  const dates = utcDaysForWindow(q.fromMs, q.toMs);
  const first = await readDays(
    fleet.map((f) => f.tail),
    dates,
  );
  if (!first) return { ok: false, error: "range_too_large", points: SEEN_MAX_POINTS_READ + 1 };

  const items = new Map<string, SeenItem>();
  // Tails whose session runs back past the first day read: read the day
  // before so the departure field is the real takeoff.
  const earliestReadS = Date.UTC(
    Number(dates[0]!.slice(0, 4)),
    Number(dates[0]!.slice(4, 6)) - 1,
    Number(dates[0]!.slice(6, 8)),
  ) / 1000;
  const needEarlier: string[] = [];
  for (const [tail, days] of first.byTail) {
    const entry = byTail.get(tail)!;
    const built = buildSeenItem(entry, days, q);
    if (!built) continue;
    items.set(tail, built.item);
    if (built.sessionStartS - earliestReadS <= SESSION_GAP_S) needEarlier.push(tail);
  }

  if (needEarlier.length > 0) {
    const prev = await readDays(needEarlier, [previousUtcDay(dates[0]!)]);
    if (prev) {
      for (const tail of needEarlier) {
        const extra = prev.byTail.get(tail);
        if (!extra) continue;
        const rebuilt = buildSeenItem(byTail.get(tail)!, [...extra, ...first.byTail.get(tail)!], q);
        if (rebuilt) items.set(tail, rebuilt.item);
      }
    }
  }

  return { ok: true, body: seenBody(q, [...items.values()]) };
}
