// The Beacon — a machine-readable status line for home-automation rigs,
// ESP32 lights, and anything else that wants "is the bird up?" without
// parsing the full /api/aircraft snapshot. Served at /api/status.txt
// (plain text) and /api/status.json. See docs/beacon.md.
//
// Pure module: no KV, no fetch. The route handlers read the snapshot and
// hand it here, so the formatter can be unit-tested (lib/beacon.test.ts)
// and the /board kiosk can share the same staleness rule.
//
// States:
//   up    — computeStatus() says alert (any smokey / patrol / unknown up)
//   down  — computeStatus() says clear (nothing up, or only SAR/transport)
//   stale — no snapshot, the snapshot is degraded (every upstream feed
//           failed), or the last read is older than FEED_STALE_MS. A
//           beacon that reads "down" while the feed is dead is a lie, so
//           stale wins over both.

import { computeStatus } from "./status";
import type { FleetEntry, Snapshot } from "./types";

export type BeaconState = "up" | "down" | "stale";

export type BeaconStatus = {
  state: BeaconState;
  /**
   * Alert-class aircraft airborne in the last read (same number as the
   * "X up" on /api/badge.svg). When state is "stale" this is the last
   * known count, not a live one; 0 when there is no read at all.
   */
  count: number;
  /** ms since epoch of the last read, or null when there is none. */
  fetched_at: number | null;
  /** Whole seconds since the last read, or null when there is none. */
  age_s: number | null;
};

/** A read older than this is reported as stale. */
export const FEED_STALE_MS = 2 * 60 * 1000;

/**
 * `degraded` lands on Snapshot with fix/data-integrity. Read it
 * structurally so this compiles before and after that change.
 */
type MaybeDegraded = Snapshot & { degraded?: boolean };

export function isFeedStale(
  snap: Pick<MaybeDegraded, "fetched_at" | "degraded"> | null | undefined,
  now: number,
): boolean {
  if (!snap) return true;
  if (snap.degraded === true) return true;
  if (!Number.isFinite(snap.fetched_at)) return true;
  return now - snap.fetched_at > FEED_STALE_MS;
}

export function beaconFromSnapshot(
  snap: Snapshot | null | undefined,
  fleet: Map<string, FleetEntry>,
  now: number,
): BeaconStatus {
  if (!snap) {
    return { state: "stale", count: 0, fetched_at: null, age_s: null };
  }
  const status = computeStatus(snap, fleet);
  const fetched_at = Number.isFinite(snap.fetched_at) ? snap.fetched_at : null;
  const age_s =
    fetched_at == null ? null : Math.max(0, Math.floor((now - fetched_at) / 1000));
  const state: BeaconState = isFeedStale(snap as MaybeDegraded, now)
    ? "stale"
    : status.kind === "alert"
      ? "up"
      : "down";
  return { state, count: status.alertCount, fetched_at, age_s };
}

/**
 * Plain-text body. First line is the state on its own so the dumbest
 * possible client (an ESP32 reading one line) can act on it. key=value
 * lines follow; an unknown value is left empty rather than invented.
 */
export function formatBeaconText(b: BeaconStatus): string {
  const lines = [
    b.state,
    `count=${b.count}`,
    `fetched_at=${b.fetched_at == null ? "" : new Date(b.fetched_at).toISOString()}`,
    `age_s=${b.age_s == null ? "" : b.age_s}`,
  ];
  return lines.join("\n") + "\n";
}

export type BeaconJson = {
  state: BeaconState;
  count: number;
  fetched_at: string | null;
  age_s: number | null;
};

export function formatBeaconJson(b: BeaconStatus): BeaconJson {
  return {
    state: b.state,
    count: b.count,
    fetched_at: b.fetched_at == null ? null : new Date(b.fetched_at).toISOString(),
    age_s: b.age_s,
  };
}

/**
 * Weak ETag over the parts that change meaning (state, count, read time).
 * age_s ticks every second, so it stays out of the tag: a client holding
 * the same read gets a 304 until the next snapshot lands.
 */
export function beaconEtag(b: BeaconStatus, variant: "txt" | "json"): string {
  const raw = `${variant}|${b.state}|${b.count}|${b.fetched_at ?? "none"}`;
  // FNV-1a 32-bit. Not cryptographic; it only has to differ between reads.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `W/"${variant}-${(h >>> 0).toString(16).padStart(8, "0")}"`;
}

/** Cache policy: short edge cache when healthy, nothing when stale. */
export function beaconCacheControl(b: BeaconStatus): string {
  return b.state === "stale"
    ? "no-store"
    : "public, s-maxage=15, stale-while-revalidate=15";
}

/** True when an If-None-Match header matches the tag (weak comparison). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, "");
  const want = strip(etag);
  return ifNoneMatch
    .split(",")
    .some((t) => t.trim() === "*" || strip(t) === want);
}
