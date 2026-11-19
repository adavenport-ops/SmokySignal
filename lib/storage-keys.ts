// Centralized KV key formatter. NX7 federation foundation.
//
// Today every region-scoped namespace (tracks / spots / hotzones / flights)
// uses an unprefixed key: e.g. tracks:N305DK:20260502. The default region
// stays unprefixed to preserve byte-for-byte back-compat with all existing
// data — no migration needed for Puget Sound. Non-default regions get a
// region prefix slot: bay-area:tracks:N305DK:20260502.
//
// This module is the *only* place that should construct these keys going
// forward. Direct string literals scattered across lib/* are how key drift
// happens.
//
// Out of scope for the foundation:
// - Per-region runtime selection (still hardcoded to default everywhere)
// - Migrations (nothing to migrate; default == current shape)
// - Per-region environment variables (single SS_REGION_* set today)
//
// Future Bay Area / etc. expansion is a config change (pick a Region, wire
// it through the cron + handlers), not a data refactor.

export type Region = string;
export const DEFAULT_REGION: Region = "puget-sound";

/** Empty for default region, "{region}:" otherwise. */
function regionPrefix(region: Region | undefined): string {
  if (!region || region === DEFAULT_REGION) return "";
  return `${region}:`;
}

// ─── tracks:{tail}:{YYYYMMDD} ────────────────────────────────────────
export function trackKey(tail: string, date: string, region?: Region): string {
  return `${regionPrefix(region)}tracks:${tail}:${date}`;
}
export function trackScanPattern(tail: string, region?: Region): string {
  return `${regionPrefix(region)}tracks:${tail}:*`;
}
export function trackScanAllPattern(region?: Region): string {
  return `${regionPrefix(region)}tracks:*`;
}

// ─── spots:{YYYYMMDD}:{uuid} ─────────────────────────────────────────
export const SPOTS_PREFIX = "spots:";
export function spotKey(date: string, id: string, region?: Region): string {
  return `${regionPrefix(region)}${SPOTS_PREFIX}${date}:${id}`;
}
export function spotScanPattern(region?: Region): string {
  return `${regionPrefix(region)}${SPOTS_PREFIX}*`;
}
export function spotsRecentCacheKey(region?: Region): string {
  return `${regionPrefix(region)}spots:recent_cache_v1`;
}

// ─── hotzones:* ──────────────────────────────────────────────────────
export function hotzonesCurrentKey(region?: Region): string {
  return `${regionPrefix(region)}hotzones:current`;
}
export function hotzonesLastRefreshKey(region?: Region): string {
  return `${regionPrefix(region)}hotzones:last_refresh_ts`;
}
export function hotzonesPlaneKey(tail: string, region?: Region): string {
  return `${regionPrefix(region)}hotzones:plane:${tail.toUpperCase()}`;
}

// ─── flights:* ───────────────────────────────────────────────────────
export function flightsRecentCacheKey(region?: Region): string {
  return `${regionPrefix(region)}flights:recent_cache_v1`;
}

// ─── push:cooldown:{TAIL} ────────────────────────────────────────────
// Per-tail takeoff-alert cooldown. Claimed atomically with SET NX EX by
// lib/push/dispatcher.ts so concurrent snapshot regens can't double-send.
export function pushCooldownKey(tail: string, region?: Region): string {
  return `${regionPrefix(region)}push:cooldown:${tail.toUpperCase()}`;
}

// ─── push:fail:{subscriptionId} ──────────────────────────────────────
// Rolling count of 400/401/403 responses for one subscription. The
// dispatcher prunes the subscription once it crosses the threshold.
export function pushFailCountKey(subscriptionId: string, region?: Region): string {
  return `${regionPrefix(region)}push:fail:${subscriptionId}`;
}

// ─── activity:* ──────────────────────────────────────────────────────
/**
 * Write-time dedupe marker for one activity event kind on one tail. Set
 * with NX + a short TTL before appending to the feed, so two instances
 * diffing the same snapshot pair cannot both write the event.
 */
export function activityDedupeKey(
  tail: string,
  kind: string,
  region?: Region,
): string {
  return `${regionPrefix(region)}activity:dedupe:${tail.toUpperCase()}:${kind}`;
}

// ─── dryrun-warnings:{YYYYMMDD} ──────────────────────────────────────
// N1a dry-run log (app/api/dryrun-warnings). Not region-scoped: the
// shape is byte-for-byte the literal the route used before this helper.
export const DRYRUN_WARNINGS_PREFIX = "dryrun-warnings:";
export function dryrunWarningsKey(date: string): string {
  return `${DRYRUN_WARNINGS_PREFIX}${date}`;
}
