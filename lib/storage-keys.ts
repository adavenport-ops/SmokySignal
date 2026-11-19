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

// One-off admin announcement. `push:announce:{id}` holds the send record
// (SET NX, no TTL, so an id can never be sent twice); the `:sent` set holds
// the subscription ids already delivered so a resumed send skips them.
export function pushAnnounceKey(announcementId: string, region?: Region): string {
  return `${regionPrefix(region)}push:announce:${announcementId}`;
}
export function pushAnnounceSentKey(announcementId: string, region?: Region): string {
  return `${pushAnnounceKey(announcementId, region)}:sent`;
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

/**
 * Permanent per-day activity archive: every event written to the capped,
 * expiring activity:feed is also appended here, with NO TTL. Keyed by the
 * UTC day of the event (same convention as tracks:{tail}:{YYYYMMDD}).
 */
export function activityDayKey(date: string, region?: Region): string {
  return `${regionPrefix(region)}activity:day:${date}`;
}

// ─── dryrun-warnings:{YYYYMMDD} ──────────────────────────────────────
// N1a dry-run log (app/api/dryrun-warnings). Not region-scoped: the
// shape is byte-for-byte the literal the route used before this helper.
export const DRYRUN_WARNINGS_PREFIX = "dryrun-warnings:";
export function dryrunWarningsKey(date: string): string {
  return `${DRYRUN_WARNINGS_PREFIX}${date}`;
}

// ─── rollup:* ────────────────────────────────────────────────────────
// Permanent daily flight rollup. Written by /api/cron/rollup with NO TTL.
// (tracks:* has also been permanent since 2026-11-18.)
// rollup:daily:{YYYYMMDD} → JSON DailyRollup (lib/rollup-core.ts)
// rollup:index            → sorted set of YYYYMMDD members, score = Number(YYYYMMDD)
export function rollupDailyKey(date: string, region?: Region): string {
  return `${regionPrefix(region)}rollup:daily:${date}`;
}
export function rollupIndexKey(region?: Region): string {
  return `${regionPrefix(region)}rollup:index`;
}

// ─── relay:* ─────────────────────────────────────────────────────────
// Club relays (Discord / generic webhooks). Not region-scoped: a relay
// carries its own region filter. See lib/relay/store.ts.
// relay:{id}                       → JSON StoredRelay (no TTL)
// relay:index                      → SET of relay ids (capped, MAX_RELAYS)
// relay:cooldown:{id}:{TAIL}:{evt} → SET NX EX claim, one send per window
// relay:fail:{id}                  → 404/401 strike counter
// relay:status:{id}                → JSON { at, status } of the last delivery
export const RELAY_PREFIX = "relay:";
export function relayKey(id: string): string {
  return `${RELAY_PREFIX}${id}`;
}
export function relayIndexKey(): string {
  return `${RELAY_PREFIX}index`;
}
export function relayCooldownKey(id: string, tail: string, event: string): string {
  return `${RELAY_PREFIX}cooldown:${id}:${tail.toUpperCase()}:${event}`;
}
export function relayFailCountKey(id: string): string {
  return `${RELAY_PREFIX}fail:${id}`;
}
export function relayStatusKey(id: string): string {
  return `${RELAY_PREFIX}status:${id}`;
}

// ─── bots:* ──────────────────────────────────────────────────────────
// Telegram / Bluesky bot state (lib/bots/*). Not region-scoped: one bot
// per deployment. Telegram chat ids are PII-equivalent, so every key
// carries a hash of the chat id, never the raw id; the raw id lives only
// inside the subscriber record.
//
// bots:tg:sub:{chatHash}          → JSON { chat_id, prefs, savedAt }
// bots:tg:subs                    → SET of chatHash
// bots:tg:cd:{chatHash}:{TAIL}    → per-(chat, tail) alert cooldown (NX EX)
// bots:tg:me                      → cached getMe username for /relay
// bots:bsky:session               → cached AT Protocol session (JWTs)
// bots:bsky:cd:{TAIL}             → global per-tail post cooldown (NX EX)
// bots:bsky:day:{YYYY-MM-DD}      → posts made that PT day (INCR)
export function tgSubKey(chatHash: string): string {
  return `bots:tg:sub:${chatHash}`;
}
export const TG_SUBS_INDEX_KEY = "bots:tg:subs";
export function tgCooldownKey(chatHash: string, tail: string): string {
  return `bots:tg:cd:${chatHash}:${tail.toUpperCase()}`;
}
export const TG_ME_CACHE_KEY = "bots:tg:me";
export const BSKY_SESSION_KEY = "bots:bsky:session";
export function bskyCooldownKey(tail: string): string {
  return `bots:bsky:cd:${tail.toUpperCase()}`;
}
export function bskyDailyKey(ptDate: string): string {
  return `bots:bsky:day:${ptDate}`;
}
