// Pure, client-side presentation grouping for the /activity feed (#74, #73).
// No Redis, no clock reads. The feed stays the raw event log; this folds
// repeats into one row so a busy shift does not read as a duplicate-render
// bug.
//
// Rules, per tail, in chronological order:
//   1. Flap collapse: a landing followed by a takeoff inside FLAP_WINDOW_MS
//      is one continuous flight. Both rows are dropped and counted on the
//      neighbouring row as `flaps`. A takeoff followed by a landing inside
//      the window is a blip, folded the same way.
//   2. Same tail + same kind within GROUP_GAP_MS of the previous one (the
//      opposite kind may sit between them) collapse to one row carrying a
//      count and a first-last time span.
//   3. squawk_emergency never collapses.
// Rows are then bucketed by Pacific-time day, newest first.

import type { ActivityEntry, ActivityKind } from "./activity-diff";
import { nearestAirport } from "./airports";
import { corridorLabel } from "./corridor";
import { PT_TZ } from "./time";

export const FLAP_WINDOW_MS = 5 * 60 * 1000;
export const GROUP_GAP_MS = 2 * 60 * 60 * 1000;

export type ActivityRow = {
  key: string;
  tail: string;
  kind: ActivityKind;
  /** Number of raw events folded into this row (>= 1). */
  count: number;
  /** Oldest and newest event ts in the row, ms. */
  firstTs: number;
  lastTs: number;
  /** Up/down flaps absorbed into this row. */
  flaps: number;
  /** Newest underlying event. */
  entry: ActivityEntry;
};

export type ActivityDay = {
  /** PT calendar day, YYYY-MM-DD. */
  day: string;
  /** Newest-first. */
  rows: ActivityRow[];
};

const dayFmt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: PT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function ptDayKey(ts: number): string {
  return dayFmt.format(new Date(ts));
}

/** Drop up/down flapping inside FLAP_WINDOW_MS. Input chronological, one tail. */
function collapseFlaps(events: ActivityEntry[]): {
  kept: ActivityEntry[];
  flapsBefore: Map<ActivityEntry, number>;
} {
  const kept: ActivityEntry[] = [];
  const flapsBefore = new Map<ActivityEntry, number>();
  let pendingFlaps = 0;
  for (let i = 0; i < events.length; i++) {
    const a = events[i]!;
    const b = events[i + 1];
    const flap =
      b &&
      b.ts - a.ts <= FLAP_WINDOW_MS &&
      ((a.kind === "landing" && b.kind === "takeoff") ||
        (a.kind === "takeoff" && b.kind === "landing"));
    if (flap) {
      pendingFlaps++;
      i++; // skip b too
      continue;
    }
    if (pendingFlaps) {
      flapsBefore.set(a, pendingFlaps);
      pendingFlaps = 0;
    }
    kept.push(a);
  }
  return { kept, flapsBefore };
}

/** Fold raw events (any order) into display rows, newest first. */
export function groupActivity(entries: ActivityEntry[]): ActivityRow[] {
  const byTail = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const list = byTail.get(e.tail);
    if (list) list.push(e);
    else byTail.set(e.tail, [e]);
  }

  const rows: ActivityRow[] = [];
  for (const [tail, list] of byTail) {
    const chrono = [...list].sort((a, b) => a.ts - b.ts);
    const { kept, flapsBefore } = collapseFlaps(chrono);

    const open = new Map<ActivityKind, ActivityRow>();
    for (const e of kept) {
      const flaps = flapsBefore.get(e) ?? 0;
      const prev = e.kind === "squawk_emergency" ? undefined : open.get(e.kind);
      if (prev && e.ts - prev.lastTs <= GROUP_GAP_MS) {
        prev.count++;
        prev.lastTs = e.ts;
        prev.flaps += flaps;
        prev.entry = e;
        continue;
      }
      const row: ActivityRow = {
        key: `${tail}-${e.kind}-${e.ts}`,
        tail,
        kind: e.kind,
        count: 1,
        firstTs: e.ts,
        lastTs: e.ts,
        flaps,
        entry: e,
      };
      rows.push(row);
      if (e.kind !== "squawk_emergency") open.set(e.kind, row);
    }
  }

  rows.sort((a, b) => b.lastTs - a.lastTs || a.key.localeCompare(b.key));
  return rows;
}

/** Bucket rows by PT day, by each row's newest event. Newest day first. */
export function groupByDay(rows: ActivityRow[]): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const r of rows) {
    const day = ptDayKey(r.lastTs);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else days.push({ day, rows: [r] });
  }
  return days;
}

const NAME_SUFFIX =
  / (off the deck|back on the ground|on watch|squawking .+|up|down)$/;

/** Aircraft display name recovered from a stored description. */
export function nameFromDescription(description: string, tail: string): string {
  const stripped = description.replace(NAME_SUFFIX, "").trim();
  return stripped || tail;
}

const COUNT_WORD: Partial<Record<ActivityKind, string>> = {
  takeoff: "takeoffs",
  landing: "landings",
  first_seen: "sightings",
};

/** "Pierce One · 3 takeoffs", or the stored description when count is 1. */
export function rowTitle(row: ActivityRow): string {
  if (row.count < 2) return row.entry.description;
  const word = COUNT_WORD[row.kind] ?? "events";
  const name = nameFromDescription(row.entry.description, row.tail);
  return `${name} · ${row.count} ${word}`;
}

/**
 * Where it happened: nearest airport for takeoff/landing, otherwise (or when
 * no airport is close) the corridor label. null when neither resolves.
 */
export function placeLabel(entry: ActivityEntry): string | null {
  const { lat, lon, kind } = entry;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (kind === "takeoff" || kind === "landing") {
    const ap = nearestAirport(lat, lon);
    if (ap) return ap.id;
  }
  return corridorLabel(lat, lon);
}
