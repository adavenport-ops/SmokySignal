// Pure upstream-feed selection and merge. Every regional feed (adsb.fi,
// adsb.lol, airplanes.live) is asked in parallel and the answers are
// unioned by ICAO hex (lib/feed-merge.ts). OpenSky stays a fallback: it is
// asked only when no regional feed produced a trustworthy answer. If that
// fails too, the tick is degraded. Fetchers are injected so the decision
// table is unit-testable without network or KV (lib/feed-select.test.ts);
// lib/adsb.ts wires the real fetchers in.

import { mergeByHex } from "./feed-merge";
import { summarizeSources } from "./feed-sources";
import { feedErrorCode, type FeedErrorCode } from "./feeds/http";
import type { FeedSrc, NormalizedAc, Snapshot, SnapshotSource } from "./types";

export type FeedStatusCode =
  /** Answered with rows (or a legitimately empty narrow-region answer). */
  | "ok"
  /** Answered with zero rows where zero means broken. */
  | "empty"
  /** Threw: HTTP error, timeout, bad payload. See error_code. */
  | "error"
  /** Inside its rate-budget interval this tick; not asked. */
  | "skipped"
  /** Turned off by config (e.g. airplanes.live without SS_FEED_APL=1). */
  | "disabled"
  /** Fallback that was not needed this tick. */
  | "standby";

export type SourceStatus = {
  src: FeedSrc;
  status: FeedStatusCode;
  error_code?: FeedErrorCode;
  latency_ms?: number;
  /** Rows the feed returned (before fleet filtering). */
  count?: number;
  /** Skipped tick that reused the feed's last answer (count = rows reused). */
  carried?: boolean;
};

export type FeedResult = {
  raw: NormalizedAc[];
  /** "fi+lol" style summary of the feeds that answered, or "none". */
  source: SnapshotSource;
  /** True when no feed produced a trustworthy observation this tick. */
  degraded: boolean;
  /** One entry per configured feed (regional feeds, then the fallback). */
  feeds: SourceStatus[];
};

export type FeedSpec = {
  src: FeedSrc;
  fetch: () => Promise<NormalizedAc[]>;
  /**
   * Whether an empty response should count as a failure. True only when the
   * query covers an area that is never empty (a wide regional circle). A
   * narrow SS_REGION_NM could legitimately see zero aircraft, so
   * lib/adsb.ts derives this from the configured radius.
   */
  zeroIsFailure: boolean;
  /** False reports the feed as "disabled" without calling it. */
  enabled?: boolean;
  /**
   * Rate-budget gate. Resolves false when the feed was asked too recently;
   * the feed is then "skipped" this tick. A throwing gate also skips:
   * spending a metered quota on a guess is the wrong default.
   */
  claim?: () => Promise<boolean>;
  /** Called after a failed fetch, e.g. to honor a 429 Retry-After. */
  onError?: (e: unknown) => Promise<void> | void;
  /**
   * Keeps a fresh answer for recall() on the ticks this feed sits out.
   * Without it a tail only this feed hears would vanish between its
   * rate-budgeted requests and read as a landing (lib/activity-diff.ts
   * debounces landings for 3 min; adsb.lol's interval is longer).
   */
  remember?: (rows: NormalizedAc[]) => Promise<void>;
  /**
   * The feed's last answer on a skipped tick (possibly [] when it kept no
   * rows worth carrying), or null once it is too old.
   * Recalled rows keep their original pos_ts, so a fresher feed still wins
   * the merge. They are merged only alongside at least one fresh answer:
   * a recalled answer alone never counts as an observation.
   */
  recall?: () => Promise<NormalizedAc[] | null>;
};

export type FeedSelectOpts = {
  /** Regional feeds, asked in parallel and merged. */
  sources: FeedSpec[];
  /** Asked only when no regional feed answered. */
  fallback?: FeedSpec;
  /** Injected for tests; defaults to Date.now. */
  clock?: () => number;
};

type Outcome = {
  status: SourceStatus;
  rows: NormalizedAc[];
  /** Fresh, trustworthy answer this tick. */
  answered: boolean;
  /** Rows recalled from an earlier answer (skipped tick). */
  carried: boolean;
};

/** null = nothing recent to reuse; [] = a recent answer with no rows kept. */
async function recallRows(spec: FeedSpec): Promise<NormalizedAc[] | null> {
  if (!spec.recall) return null;
  try {
    const rows = await spec.recall();
    return rows ? rows.map((r) => (r.src ? r : { ...r, src: spec.src })) : null;
  } catch (e) {
    console.warn(`[adsb] ${spec.src} recall failed:`, e);
    return null;
  }
}

async function runFeed(spec: FeedSpec, clock: () => number): Promise<Outcome> {
  const src = spec.src;
  if (spec.enabled === false) {
    return { status: { src, status: "disabled" }, rows: [], answered: false, carried: false };
  }
  if (spec.claim) {
    let allowed = false;
    try {
      allowed = await spec.claim();
    } catch (e) {
      console.warn(`[adsb] ${src} gate failed, skipping:`, e);
    }
    if (!allowed) {
      // A recent answer still counts toward the source summary even when
      // it kept no rows, so the source line does not flicker between this
      // feed's rate-budgeted requests.
      const rows = await recallRows(spec);
      return rows
        ? {
            status: { src, status: "skipped", carried: true, count: rows.length },
            rows,
            answered: false,
            carried: true,
          }
        : { status: { src, status: "skipped" }, rows: [], answered: false, carried: false };
    }
  }
  const t0 = clock();
  try {
    const fetched = await spec.fetch();
    const latency_ms = Math.max(0, Math.round(clock() - t0));
    const rows = fetched.map((r) => (r.src ? r : { ...r, src }));
    if (rows.length === 0 && spec.zeroIsFailure) {
      console.warn(`[adsb] ${src} returned zero rows`);
      return {
        status: { src, status: "empty", latency_ms, count: 0 },
        rows: [],
        answered: false,
        carried: false,
      };
    }
    if (spec.remember) {
      try {
        await spec.remember(rows);
      } catch (e) {
        console.warn(`[adsb] ${src} remember failed:`, e);
      }
    }
    return {
      status: { src, status: "ok", latency_ms, count: rows.length },
      rows,
      answered: true,
      carried: false,
    };
  } catch (e) {
    const latency_ms = Math.max(0, Math.round(clock() - t0));
    console.warn(`[adsb] ${src} failed:`, e);
    try {
      await spec.onError?.(e);
    } catch (hookErr) {
      console.warn(`[adsb] ${src} onError hook failed:`, hookErr);
    }
    return {
      status: { src, status: "error", error_code: feedErrorCode(e), latency_ms },
      rows: [],
      answered: false,
      carried: false,
    };
  }
}

export async function selectFeed(opts: FeedSelectOpts): Promise<FeedResult> {
  const clock = opts.clock ?? Date.now;
  // runFeed never throws, so one feed failing cannot reject the others.
  const outcomes = await Promise.all(opts.sources.map((s) => runFeed(s, clock)));
  const answered = outcomes.filter((o) => o.answered);

  if (answered.length > 0) {
    const feeds = outcomes.map((o) => o.status);
    if (opts.fallback) feeds.push({ src: opts.fallback.src, status: "standby" });
    // Spec order, so first-appearance order in the merge follows the
    // primary feed.
    const used = outcomes.filter((o) => o.answered || o.carried);
    return {
      raw: mergeByHex(used.map((o) => o.rows)),
      source: summarizeSources(used.map((o) => o.status.src)),
      degraded: false,
      feeds,
    };
  }

  const feeds = outcomes.map((o) => o.status);
  if (!opts.fallback) {
    console.error("[adsb] every regional feed failed and no fallback; tick degraded");
    return { raw: [], source: "none", degraded: true, feeds };
  }

  console.warn("[adsb] no regional feed answered, falling back to", opts.fallback.src);
  // The fallback is queried by fleet hex, so zero rows could mean "none of
  // ours are transmitting". But we only get here when every regional feed
  // is already broken, and an empty fallback cannot be told apart from one
  // more broken feed. Be conservative: no rows from any feed is a degraded
  // tick, not a fleet-wide landing.
  const fb = await runFeed({ ...opts.fallback, zeroIsFailure: true }, clock);
  feeds.push(fb.status);
  if (!fb.answered) {
    console.error("[adsb] every feed failed or came back empty; tick degraded");
    return { raw: [], source: "none", degraded: true, feeds };
  }
  return {
    raw: mergeByHex([fb.rows]),
    source: summarizeSources([fb.status.src]),
    degraded: false,
    feeds,
  };
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
