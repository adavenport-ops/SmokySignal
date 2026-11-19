// Validator for rider-posted "I see this aircraft" spots (/api/spot).
// Pure so node:test can exercise it (lib/spot-payload.test.ts).
//
// Privacy posture (CLAUDE.md): rider geolocation is never persisted
// precisely. Rider lat/lon are rounded to 2 decimals (~0.6 nm N-S at
// 47°N) and rider→aircraft distance to 0.5 nm before the record is
// stored, so the stored spot can't be trilaterated back to an exact fix.

import {
  MAX_TAILS_PER_PAYLOAD,
  isFiniteNum,
  normalizeTail,
  roundDecimals,
  roundTo,
} from "./input-validation";
import type { SpotAirborneTail, SpotPayload } from "./spots";

const NOW_TOLERANCE_MS = 5 * 60 * 1000; // accept ts within 5 min of now
export const SPOT_COORD_DECIMALS = 2;
export const SPOT_DISTANCE_STEP_NM = 0.5;

export type SpotParseError =
  | "invalid_payload"
  | "invalid_lat"
  | "invalid_lon"
  | "invalid_ts"
  | "stale_ts"
  | "too_many_tails";

export type SpotParseResult =
  | { ok: true; payload: SpotPayload }
  | { ok: false; error: SpotParseError };

function inLatRange(n: number): boolean {
  return n >= -90 && n <= 90;
}
function inLonRange(n: number): boolean {
  return n >= -180 && n <= 180;
}

function parseAirborneTail(raw: unknown): SpotAirborneTail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tail = normalizeTail(r.tail);
  if (!tail) return null;
  // Aircraft positions are public ADS-B data, not rider PII.
  const lat = isFiniteNum(r.lat) && inLatRange(r.lat) ? r.lat : null;
  const lon = isFiniteNum(r.lon) && inLonRange(r.lon) ? r.lon : null;
  const distance_nm =
    isFiniteNum(r.distance_nm) && r.distance_nm >= 0
      ? roundTo(r.distance_nm, SPOT_DISTANCE_STEP_NM)
      : null;
  return { tail, lat, lon, distance_nm };
}

export function parseSpotBody(
  body: unknown,
  now: number = Date.now(),
): SpotParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_payload" };
  }
  const b = body as Record<string, unknown>;

  if (!isFiniteNum(b.lat) || !inLatRange(b.lat)) {
    return { ok: false, error: "invalid_lat" };
  }
  if (!isFiniteNum(b.lon) || !inLonRange(b.lon)) {
    return { ok: false, error: "invalid_lon" };
  }
  if (!isFiniteNum(b.ts)) return { ok: false, error: "invalid_ts" };
  if (Math.abs(now - b.ts) > NOW_TOLERANCE_MS) {
    return { ok: false, error: "stale_ts" };
  }

  const airborneRaw = Array.isArray(b.airborne_tails) ? b.airborne_tails : [];
  if (airborneRaw.length > MAX_TAILS_PER_PAYLOAD) {
    return { ok: false, error: "too_many_tails" };
  }
  const seen = new Set<string>();
  const airborne_tails: SpotAirborneTail[] = [];
  for (const raw of airborneRaw) {
    const t = parseAirborneTail(raw);
    if (!t || seen.has(t.tail)) continue;
    seen.add(t.tail);
    airborne_tails.push(t);
  }

  return {
    ok: true,
    payload: {
      lat: roundDecimals(b.lat, SPOT_COORD_DECIMALS),
      lon: roundDecimals(b.lon, SPOT_COORD_DECIMALS),
      ts: b.ts,
      airborne_tails,
    },
  };
}
