// adsb.lol adapter.
//
// Endpoint: GET https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}
// (radius is an integer, 0-250 nm). Docs: https://api.adsb.lol/docs,
// OpenAPI at /api/openapi.json, checked 2026-11-18.
//
// Terms: data and API are licensed ODbL 1.0, so every surface that shows
// the data credits adsb.lol and names the license (footer, /legal).
// /v2/* is metered: without a key, 500 requests per day per IP (fixed
// 24 h window, confirmed by the `x-ratelimit-limit: 500, 500;w=86400`
// response header). A free key (x-api-key) raises it: adhoc 1,000/day,
// feeder 7,200/day. Over quota returns 429 with Retry-After.
//
// That quota, not the tick cadence, sets how often we ask: see
// lib/feed-budget.ts. Per-hex queries cost one metered request per hex,
// so the single regional circle is the cheapest shape.
//
// Envelope field is `ac`; `now` is epoch milliseconds.

import type { NormalizedAc } from "../types";
import { feedSignal, fetchFeedJson } from "./http";
import { normalizeReadsb } from "./readsb";
import { radiusSegment, type Region } from "./region";

export const ADSBLOL_TIMEOUT_MS = 5000;

export function adsbLolUrl(region: Region): string {
  return `https://api.adsb.lol/v2/point/${region.lat}/${region.lon}/${radiusSegment(region)}`;
}

export function normalizeAdsbLol(body: unknown, fetchedAtMs: number): NormalizedAc[] {
  return normalizeReadsb(body, "ac", "lol", fetchedAtMs);
}

export async function fetchAdsbLol(
  region: Region,
  budget?: AbortSignal,
): Promise<NormalizedAc[]> {
  const key = process.env.ADSBLOL_API_KEY;
  const t = Date.now();
  const body = await fetchFeedJson(
    "lol",
    adsbLolUrl(region),
    feedSignal(ADSBLOL_TIMEOUT_MS, budget),
    key ? { "x-api-key": key } : {},
  );
  return normalizeAdsbLol(body, t);
}
