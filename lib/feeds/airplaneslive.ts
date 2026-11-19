// airplanes.live adapter. OFF unless SS_FEED_APL=1.
//
// Endpoint: GET https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}
// (radius up to 250 nm), same readsb v2 rows as adsb.lol, envelope `ac`.
// Published terms (airplanes.live/api-guide, which sits behind a browser
// challenge; read via search excerpts): rate limited to 1 request per
// second, no SLA, non-commercial use only.
//
// Why it is off: as of 2026-11-18 every unapproved request (point and hex,
// any User-Agent) answers HTTP 403 with "Please contact us at
// contact@airplanes.live" and a request for a project description. Access
// now needs their approval. Polling a 403 every tick would be rude and
// pointless, so the adapter ships dark. Once they approve, set
// SS_FEED_APL=1 and the merge picks it up; add an airplanes.live credit
// to the footer (components/Glanceable.tsx) and /legal at the same time.

import type { NormalizedAc } from "../types";
import { feedSignal, fetchFeedJson } from "./http";
import { normalizeReadsb } from "./readsb";
import { radiusSegment, type Region } from "./region";

export const AIRPLANESLIVE_TIMEOUT_MS = 5000;

export function airplanesLiveEnabled(): boolean {
  return process.env.SS_FEED_APL === "1";
}

export function airplanesLiveUrl(region: Region): string {
  return `https://api.airplanes.live/v2/point/${region.lat}/${region.lon}/${radiusSegment(region)}`;
}

export function normalizeAirplanesLive(
  body: unknown,
  fetchedAtMs: number,
): NormalizedAc[] {
  return normalizeReadsb(body, "ac", "apl", fetchedAtMs);
}

export async function fetchAirplanesLive(
  region: Region,
  budget?: AbortSignal,
): Promise<NormalizedAc[]> {
  const t = Date.now();
  const body = await fetchFeedJson(
    "apl",
    airplanesLiveUrl(region),
    feedSignal(AIRPLANESLIVE_TIMEOUT_MS, budget),
  );
  return normalizeAirplanesLive(body, t);
}
