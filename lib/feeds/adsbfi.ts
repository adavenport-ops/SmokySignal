// adsb.fi open data adapter.
//
// Endpoint: GET https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}
// Terms (github.com/adsbfi/opendata, checked 2026-11-18): personal,
// non-commercial use; public endpoints limited to 1 request per second;
// cite adsb.fi with a link to its home page. Repeated 4xx/429 responses
// count toward a temporary IP block, so failures are not retried here.
//
// Envelope field is `aircraft`, NOT `ac` (adsbexchange and adsb.lol use
// `ac`; don't conflate them).

import type { NormalizedAc } from "../types";
import { feedSignal, fetchFeedJson } from "./http";
import { normalizeReadsb } from "./readsb";
import type { Region } from "./region";

export const ADSBFI_TIMEOUT_MS = 4000;

export function adsbFiUrl(region: Region): string {
  return `https://opendata.adsb.fi/api/v2/lat/${region.lat}/lon/${region.lon}/dist/${region.nm}`;
}

export function normalizeAdsbFi(body: unknown, fetchedAtMs: number): NormalizedAc[] {
  return normalizeReadsb(body, "aircraft", "fi", fetchedAtMs);
}

export async function fetchAdsbFi(
  region: Region,
  budget?: AbortSignal,
): Promise<NormalizedAc[]> {
  const t = Date.now();
  const body = await fetchFeedJson(
    "fi",
    adsbFiUrl(region),
    feedSignal(ADSBFI_TIMEOUT_MS, budget),
  );
  return normalizeAdsbFi(body, t);
}
