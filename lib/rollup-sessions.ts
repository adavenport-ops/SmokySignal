// Shared read-side fold over daily rollup docs: every tail's sessions,
// stitched across the 00:00 UTC cut, with the tail's latest metadata.
// Pure. Used by the logbook, the open ledger and the season wrap.

import { normalizeMission } from "./mission";
import { DATA_SINCE_FALLBACK } from "./data-since-core";
import { ptParts, stitchSessions, type DailyRollup, type RollupSession, type StitchedSession } from "./rollup-core";
import type { Mission } from "./types";

/**
 * Day the permanent log begins, Pacific: the static data-since value
 * (lib/data-since-core.ts). Pages that can await prefer getDataSince().
 */
export const LOG_START_DATE = DATA_SINCE_FALLBACK;

export type TailMeta = {
  nickname: string | null;
  operator: string;
  mission: Mission;
};

export type TailSessions = TailMeta & {
  tail: string;
  /** Stitched sessions, oldest first. */
  sessions: StitchedSession[];
};

/**
 * Fold docs into per-tail stitched sessions. Metadata comes from the
 * newest doc that mentions the tail, overridden by `registry` when the
 * caller passes the live registry (nicknames and missions get corrected
 * after the fact; the registry is the record).
 */
export function collectTailSessions(
  docs: ReadonlyArray<DailyRollup>,
  registry?: ReadonlyMap<string, Partial<TailMeta>>,
): TailSessions[] {
  const meta = new Map<string, TailMeta>();
  const raw = new Map<string, RollupSession[]>();
  const sorted = [...docs].sort((a, b) => a.date.localeCompare(b.date));
  for (const doc of sorted) {
    for (const t of doc.tails) {
      meta.set(t.tail, {
        nickname: t.nickname,
        operator: t.operator,
        mission: normalizeMission(t.role),
      });
      const list = raw.get(t.tail) ?? [];
      list.push(...t.sessions);
      raw.set(t.tail, list);
    }
  }
  const out: TailSessions[] = [];
  for (const [tail, sessions] of raw) {
    const m = { ...meta.get(tail)! };
    const r = registry?.get(tail);
    if (r) {
      if (r.nickname !== undefined) m.nickname = r.nickname;
      if (r.operator !== undefined) m.operator = r.operator;
      if (r.mission !== undefined) m.mission = normalizeMission(r.mission);
    }
    out.push({ tail, ...m, sessions: stitchSessions(tail, m.nickname, dedupeSessions(sessions)) });
  }
  return out.sort((a, b) => a.tail.localeCompare(b.tail));
}

/** Drop exact repeats (same start), keeping the last one seen. */
export function dedupeSessions<T extends { start_ts: number }>(list: ReadonlyArray<T>): T[] {
  const by = new Map<number, T>();
  for (const s of list) by.set(s.start_ts, s);
  return [...by.values()].sort((a, b) => a.start_ts - b.start_ts);
}

/** Pacific calendar month of an instant, YYYY-MM. */
export function ptMonth(tsMs: number): string {
  return ptParts(tsMs).date.slice(0, 7);
}

/** Inclusive list of YYYY-MM months from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** `n` months ending at (and including) `last`, oldest first. */
export function lastMonths(last: string, n: number): string[] {
  let [y, m] = last.split("-").map(Number) as [number, number];
  m -= n - 1;
  while (m < 1) {
    m += 12;
    y--;
  }
  return monthRange(`${y}-${String(m).padStart(2, "0")}`, last);
}
