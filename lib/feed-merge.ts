// Pure merge of several feeds' aircraft lists into one, keyed by ICAO hex.
// Tested in lib/feed-merge.test.ts.
//
// Different feeder networks hear different receivers, so the union covers
// more low-altitude sky (Puget Sound, the Cascades, eastern WA) than any
// one feed alone. For each hex:
//   - the position (lat, lon, seen_pos, pos_ts, src) comes as one unit
//     from the freshest fix: largest pos_ts, then smallest seen_pos, then
//     feed order (fi, lol, apl, os) as the tie-break;
//   - every other field missing on that row is filled from the other
//     rows, freshest first;
//   - `sources` lists every feed that reported the hex.

import { FEED_ORDER, sortFeeds } from "./feed-sources";
import type { FeedSrc, NormalizedAc } from "./types";

const FILL_FIELDS = ["r", "alt_baro", "gs", "track", "squawk"] as const;

function hasPos(a: NormalizedAc): boolean {
  return typeof a.lat === "number" && typeof a.lon === "number";
}

function rank(src: FeedSrc | undefined): number {
  const i = src ? FEED_ORDER.indexOf(src) : -1;
  return i === -1 ? FEED_ORDER.length : i;
}

/** Negative when `a` is the better position source. */
export function compareFix(a: NormalizedAc, b: NormalizedAc): number {
  const pa = hasPos(a);
  const pb = hasPos(b);
  if (pa !== pb) return pa ? -1 : 1;
  const ta = a.pos_ts ?? -Infinity;
  const tb = b.pos_ts ?? -Infinity;
  if (ta !== tb) return tb - ta;
  const sa = a.seen_pos ?? Infinity;
  const sb = b.seen_pos ?? Infinity;
  if (sa !== sb) return sa - sb;
  return rank(a.src) - rank(b.src);
}

function mergeOne(rows: NormalizedAc[]): NormalizedAc {
  const ordered = [...rows].sort(compareFix);
  const best = ordered[0]!;
  const out: NormalizedAc = { ...best };
  for (const field of FILL_FIELDS) {
    if (out[field] !== undefined && out[field] !== null) continue;
    for (const other of ordered) {
      const v = other[field];
      if (v !== undefined && v !== null) {
        (out as Record<string, unknown>)[field] = v;
        break;
      }
    }
  }
  const srcs = rows.map((r) => r.src).filter((s): s is FeedSrc => !!s);
  out.sources = sortFeeds(srcs);
  return out;
}

/**
 * Union of every list by lowercase hex. Output order follows first
 * appearance across the lists (so the primary feed's order is kept).
 */
export function mergeByHex(lists: NormalizedAc[][]): NormalizedAc[] {
  const byHex = new Map<string, NormalizedAc[]>();
  for (const list of lists) {
    for (const row of list) {
      const hex = row.hex.toLowerCase();
      if (!hex) continue;
      const norm = row.hex === hex ? row : { ...row, hex };
      const bucket = byHex.get(hex);
      if (bucket) bucket.push(norm);
      else byHex.set(hex, [norm]);
    }
  }
  return [...byHex.values()].map(mergeOne);
}
