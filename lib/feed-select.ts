// Pure upstream-feed selection: primary (adsb.fi) → fallback (OpenSky) →
// degraded. Fetchers are injected so the decision table is unit-testable
// without network or KV (lib/feed-select.test.ts). lib/adsb.ts wires the
// real fetchers in.

import type { NormalizedAc, Snapshot, SnapshotSource } from "./types";

export type FeedResult = {
  raw: NormalizedAc[];
  source: SnapshotSource;
  /** True when no feed produced a trustworthy observation this tick. */
  degraded: boolean;
};

export type FeedSelectOpts = {
  primary: () => Promise<NormalizedAc[]>;
  fallback: () => Promise<NormalizedAc[]>;
  /**
   * Whether an empty primary response should count as a failure. True only
   * when the primary query covers an area that is never empty (a wide
   * regional circle). A narrow SS_REGION_NM could legitimately see zero
   * aircraft, so lib/adsb.ts derives this from the configured radius.
   */
  primaryZeroIsFailure: boolean;
};

export async function selectFeed(opts: FeedSelectOpts): Promise<FeedResult> {
  try {
    const raw = await opts.primary();
    if (raw.length > 0 || !opts.primaryZeroIsFailure) {
      return { raw, source: "adsbfi", degraded: false };
    }
    console.warn("[adsb] primary returned zero rows, falling back to OpenSky");
  } catch (e) {
    console.warn("[adsb] primary failed, falling back to OpenSky:", e);
  }

  try {
    const raw = await opts.fallback();
    // OpenSky is queried by fleet hex, so zero rows could mean "none of
    // ours are transmitting". But we only get here when the primary is
    // already broken, and an empty fallback cannot be told apart from a
    // second broken feed. Be conservative: no rows from either feed is a
    // degraded tick, not a fleet-wide landing.
    if (raw.length === 0) {
      console.warn("[adsb] fallback returned zero fleet rows; tick degraded");
      return { raw: [], source: "none", degraded: true };
    }
    return { raw, source: "opensky", degraded: false };
  } catch (e) {
    console.error("[adsb] both feeds failed:", e);
    return { raw: [], source: "none", degraded: true };
  }
}

/**
 * What riders get on a degraded tick: the last good snapshot with its
 * ORIGINAL fetched_at (so every "updated Xs ago" label keeps aging) and
 * `degraded: true`. Falls back to the all-grounded placeholder only when
 * no good snapshot is on hand. Callers tell the two apart by `source`:
 * "none" means placeholder, anything else is the source of the last good
 * read.
 */
export function degradedView(
  placeholder: Snapshot,
  lastGood: Snapshot | null,
): Snapshot {
  if (lastGood && !lastGood.degraded) return { ...lastGood, degraded: true };
  return { ...placeholder, source: "none", degraded: true };
}

/** Cache-Control for /api/aircraft. Never let the CDN hold a dead-feed tick. */
export function aircraftCacheControl(snap: Snapshot): string {
  if (snap.degraded) return "no-store";
  // Browser won't cache; CDN can hold the same 10s the server does.
  return "public, max-age=0, s-maxage=10, stale-while-revalidate=30";
}
