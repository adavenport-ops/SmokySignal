// Pure rate-budget math for the upstream feeds. Tested in
// lib/feed-budget.test.ts; lib/adsb.ts turns the result into a per-feed
// minimum interval that lib/feed-runtime.ts enforces across instances.
//
// The snapshot regenerates whenever the 10 s hot-path cache is cold and
// someone asks, so the tick cadence is set by traffic, not by us. Each
// provider therefore gets a minimum interval derived from its published
// limit, and a tick that lands inside that interval skips the provider
// instead of spending quota.

import type { FeedSrc } from "./types";

export const DAY_S = 86_400;

/** Cadence the brief plans for: one snapshot tick every 30 s. */
export const PLANNED_CADENCE_S = 30;

/** Headroom kept under every daily quota (manual curls, health probes, clock skew). */
export const DAILY_SAFETY = 0.9;

export type ProviderLimit = {
  src: FeedSrc;
  /** Hard requests-per-second ceiling, when the provider publishes one. */
  perSecond?: number;
  /** Requests per rolling or fixed 24 h window, when metered. */
  perDay?: number;
};

/** Requests a feed costs per day at a fixed interval. */
export function requestsPerDay(intervalS: number, requestsPerTick = 1): number {
  if (!(intervalS > 0)) return Infinity;
  return Math.ceil(DAY_S / intervalS) * requestsPerTick;
}

/**
 * Smallest whole-second interval between ticks that keeps a provider inside
 * every limit it publishes, with DAILY_SAFETY headroom on daily quotas.
 * 0 means "no limit we need to enforce beyond the snapshot cache".
 */
export function minIntervalS(
  limit: ProviderLimit,
  requestsPerTick = 1,
  safety = DAILY_SAFETY,
): number {
  let s = 0;
  if (limit.perSecond && limit.perSecond > 0) {
    s = Math.max(s, Math.ceil(requestsPerTick / limit.perSecond));
  }
  if (limit.perDay && limit.perDay > 0) {
    s = Math.max(s, Math.ceil((DAY_S * requestsPerTick) / (limit.perDay * safety)));
  }
  return s;
}

/** Interval a feed actually runs at, given the tick cadence. */
export function effectiveIntervalS(
  cadenceS: number,
  limit: ProviderLimit,
  requestsPerTick = 1,
): number {
  return Math.max(cadenceS, minIntervalS(limit, requestsPerTick));
}

/** True when polling at `intervalS` stays within every published limit. */
export function fitsBudget(
  limit: ProviderLimit,
  intervalS: number,
  requestsPerTick = 1,
): boolean {
  if (limit.perSecond && requestsPerTick / intervalS > limit.perSecond) return false;
  if (limit.perDay && requestsPerDay(intervalS, requestsPerTick) > limit.perDay) {
    return false;
  }
  return true;
}

function envInt(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Published limits as of 2026-11-18.
 */
export function providerLimits(
  env: Record<string, string | undefined> = process.env,
): Record<"fi" | "lol" | "apl", ProviderLimit> {
  return {
    // github.com/adsbfi/opendata: public endpoints 1 req/s, no daily cap.
    fi: { src: "fi", perSecond: 1 },
    // api.adsb.lol/docs: 500/day per IP without a key. Set
    // ADSBLOL_DAILY_QUOTA to the tier's figure when ADSBLOL_API_KEY is set
    // (adhoc 1000, feeder 7200).
    lol: { src: "lol", perDay: envInt(env.ADSBLOL_DAILY_QUOTA, 500) },
    // airplanes.live api guide: 1 req/s.
    apl: { src: "apl", perSecond: 1 },
  };
}
