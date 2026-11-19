// N1a dry-run speed-warning payload: the privacy-reduced shape shared by
// the client (components/DashShell.tsx), the API (app/api/dryrun-warnings)
// and the admin viewer (app/admin/dryrun-warnings).
//
// Privacy posture (CLAUDE.md): we do not store rider speed, and rider
// geolocation is never persisted server-side. So the record carries only
// coarse buckets:
//   - overLimitBy: "2-5" | "5-10" | "10+"  (never the raw speed or delta)
//   - nearestZoneId: the ~0.5 nm hot-zone grid cell, or null
//   - nearestTail: a registry-format tail, or null
//   - nearestBirdNm: rider→aircraft distance rounded to 0.5 nm, or null
//   - reason: a fixed code, never free text
//   - ts: rounded down to the minute
// parseDryRunBody() rebuilds the record from these fields only, so any
// extra field a client sends (riderLat, riderSpeedMph, ...) is dropped.

import { isFiniteNum, normalizeTail, roundTo } from "./input-validation";

export const OVER_LIMIT_BUCKETS = ["2-5", "5-10", "10+"] as const;
export type OverLimitBucket = (typeof OVER_LIMIT_BUCKETS)[number];

export const DRYRUN_REASONS = ["speeding_in_zone_bird_nearby"] as const;
export type DryRunReason = (typeof DRYRUN_REASONS)[number];

/** Distance bucket step for rider→aircraft distance. */
export const DISTANCE_STEP_NM = 0.5;
/** Anything farther than this is not a "nearby" bird; reject as junk. */
const MAX_BIRD_NM = 50;

const NOW_TOLERANCE_MS = 5 * 60 * 1000;
const MINUTE_MS = 60_000;

// Matches lib/zone-id.ts zoneIdForPoint(): "47.6087,-122.3344".
const ZONE_ID_RE = /^(-?\d{1,2}\.\d{4}),(-?\d{1,3}\.\d{4})$/;

export type DryRunPayload = {
  v: 2;
  ts: number;
  overLimitBy: OverLimitBucket;
  nearestZoneId: string | null;
  nearestTail: string | null;
  nearestBirdNm: number | null;
  reason: DryRunReason;
};

/** Coarse bucket for how far over the posted limit a rider is. */
export function bucketOverLimit(mph: number): OverLimitBucket {
  if (mph >= 10) return "10+";
  if (mph >= 5) return "5-10";
  return "2-5";
}

export function bucketDistanceNm(nm: number): number {
  return roundTo(nm, DISTANCE_STEP_NM);
}

function isZoneId(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ZONE_ID_RE.exec(v);
  if (!m) return false;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Validate + strip a rider-posted dry-run record. Returns null when any
 * field is missing or out of shape. Only allow-listed fields survive.
 */
export function parseDryRunBody(
  raw: unknown,
  now: number = Date.now(),
): DryRunPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (!isFiniteNum(r.ts)) return null;
  if (Math.abs(now - r.ts) > NOW_TOLERANCE_MS) return null;

  if (
    typeof r.overLimitBy !== "string" ||
    !(OVER_LIMIT_BUCKETS as readonly string[]).includes(r.overLimitBy)
  ) {
    return null;
  }
  if (
    typeof r.reason !== "string" ||
    !(DRYRUN_REASONS as readonly string[]).includes(r.reason)
  ) {
    return null;
  }

  let nearestZoneId: string | null = null;
  if (r.nearestZoneId != null) {
    if (!isZoneId(r.nearestZoneId)) return null;
    nearestZoneId = r.nearestZoneId;
  }

  let nearestTail: string | null = null;
  if (r.nearestTail != null) {
    nearestTail = normalizeTail(r.nearestTail);
    if (!nearestTail) return null;
  }

  let nearestBirdNm: number | null = null;
  if (r.nearestBirdNm != null) {
    if (!isFiniteNum(r.nearestBirdNm)) return null;
    if (r.nearestBirdNm < 0 || r.nearestBirdNm > MAX_BIRD_NM) return null;
    // Re-bucket server-side; never trust the client to have rounded.
    nearestBirdNm = bucketDistanceNm(r.nearestBirdNm);
  }

  return {
    v: 2,
    ts: Math.floor(r.ts / MINUTE_MS) * MINUTE_MS,
    overLimitBy: r.overLimitBy as OverLimitBucket,
    nearestZoneId,
    nearestTail,
    nearestBirdNm,
    reason: r.reason as DryRunReason,
  };
}

/**
 * Row shape the admin viewer renders. Tolerates legacy (pre-v2) rows
 * that still hold precise fields: those are mapped to buckets at render
 * time and the precise values are never displayed.
 */
export type DryRunViewRow = {
  ts: number;
  overLimitBy: OverLimitBucket | null;
  nearestZoneId: string | null;
  nearestTail: string | null;
  nearestBirdNm: number | null;
  legacy: boolean;
};

export function toViewRow(raw: unknown): DryRunViewRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNum(r.ts)) return null;
  if (r.v === 2) {
    return {
      ts: r.ts,
      overLimitBy:
        typeof r.overLimitBy === "string" &&
        (OVER_LIMIT_BUCKETS as readonly string[]).includes(r.overLimitBy)
          ? (r.overLimitBy as OverLimitBucket)
          : null,
      nearestZoneId: isZoneId(r.nearestZoneId) ? r.nearestZoneId : null,
      nearestTail: normalizeTail(r.nearestTail),
      nearestBirdNm: isFiniteNum(r.nearestBirdNm) ? r.nearestBirdNm : null,
      legacy: false,
    };
  }
  // Legacy row (riderLat/riderLon/riderSpeedMph/riderOverLimitBy/...).
  return {
    ts: r.ts,
    overLimitBy: isFiniteNum(r.riderOverLimitBy)
      ? bucketOverLimit(r.riderOverLimitBy)
      : null,
    nearestZoneId: null,
    nearestTail: normalizeTail(r.nearestTail),
    // Legacy field is misnamed "Mi" but holds nautical miles.
    nearestBirdNm: isFiniteNum(r.nearestBirdMi)
      ? bucketDistanceNm(r.nearestBirdMi)
      : null,
    legacy: true,
  };
}
