// IO half of GET /api/history. Reads tracks:{tail}:{YYYYMMDD} with
// deterministic keys (tails × UTC days in range), LLEN first to size the
// read, then pipelined LRANGE batches. No SCAN. The pure folding lives in
// lib/history-core.ts.

import { getRegistry } from "./registry";
import { getTrackLengths, getTracksForPairs } from "./tracks";
import {
  MAX_POINTS_READ,
  buildHistory,
  filterByMission,
  utcKeysForQuery,
  type HistoryBody,
  type HistoryQuery,
  type TailInput,
} from "./history-core";
import type { FleetEntry } from "./types";

export type HistoryResult =
  | { ok: true; body: HistoryBody }
  | { ok: false; error: "range_too_large"; points: number; budget: number };

function placeholderEntry(tail: string): FleetEntry {
  return {
    tail,
    nickname: null,
    operator: "",
    model: "",
    roleDescription: "",
    base: "",
    role: "unknown",
    roleConfidence: "unknown",
    sources: [],
  };
}

export async function loadHistory(query: HistoryQuery): Promise<HistoryResult> {
  const fleet = await getRegistry();
  const byTail = new Map(fleet.map((f) => [f.tail, f]));

  const mission = filterByMission(fleet, query.mission);
  let entries: FleetEntry[];
  if (query.tails) {
    // Tails dropped from the registry still have history: give them a
    // minimal entry instead of refusing them.
    const allowed = mission.applied ? new Set(mission.entries.map((e) => e.tail)) : null;
    entries = query.tails
      .filter((t) => !allowed || allowed.has(t))
      .map((t) => byTail.get(t) ?? placeholderEntry(t));
  } else {
    entries = mission.entries;
  }
  const entryByTail = new Map(entries.map((e) => [e.tail, e]));

  const days = utcKeysForQuery(query);
  const pairs = entries.flatMap((e) => days.map((date) => ({ tail: e.tail, date })));
  const lengths = await getTrackLengths(pairs);
  const total = lengths.reduce((n, l) => n + l, 0);
  if (total > MAX_POINTS_READ) {
    return { ok: false, error: "range_too_large", points: total, budget: MAX_POINTS_READ };
  }

  const perPair = await getTracksForPairs(pairs, lengths);
  const inputs = new Map<string, TailInput>();
  pairs.forEach((pair, i) => {
    const pts = perPair[i]!;
    if (pts.length === 0) return;
    let cur = inputs.get(pair.tail);
    if (!cur) {
      cur = { entry: entryByTail.get(pair.tail)!, points: [] };
      inputs.set(pair.tail, cur);
    }
    for (const p of pts) cur.points.push(p);
  });

  return {
    ok: true,
    body: buildHistory(query, [...inputs.values()], { mission_applied: mission.applied }),
  };
}
