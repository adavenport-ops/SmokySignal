// ADS-B feed adapters: adsb.fi (primary) + OpenSky (fallback).
// Polite usage: bbox query once per refresh, KV-cached upstream.

import { fleetHex } from "./seed";
import { getRegistry } from "./registry";
import { fetchOpenSky } from "./opensky";
import { selectFeed } from "./feed-select";
import type {
  Aircraft,
  AircraftLive,
  FleetEntry,
  NormalizedAc,
  Snapshot,
} from "./types";

// State-centroid query covers all four corners of Washington within
// ~190 nm. adsb.fi v2 caps the radius at 250 nm (501+ returns HTTP 400),
// so this is the largest single-circle query the API allows. Registry-tail
// filtering downstream drops any non-fleet leakage from BC / OR / ID.
const REGION = {
  lat: Number(process.env.SS_REGION_LAT ?? 47.4),
  lon: Number(process.env.SS_REGION_LON ?? -120.8),
  nm: Number(process.env.SS_REGION_NM ?? 250),
};

// In-memory state across requests — tracks first-seen timestamps so we can
// derive "minutes aloft" without a track-history table yet.
type SeenState = { firstSeenAt: number; lastSeenAt: number };
const seenByIcao = new Map<string, SeenState>();

const FETCH_OPTS: RequestInit = {
  headers: { "User-Agent": "SmokySignal/0.1 (+https://github.com/)" },
  // Avoid Next.js's fetch caching layer — we cache ourselves.
  cache: "no-store",
};

// ─── adsb.fi ───────────────────────────────────────────────────────────────

// Top-level field is `aircraft`, NOT `ac` (adsbexchange uses `ac` —
// don't conflate them). Misreading this field caused every tail to
// classify as airborne:false from launch through 2026-04-30.
type AdsbFiResp = { aircraft?: NormalizedAc[]; now?: number };

const ADSBFI_TIMEOUT_MS = 4000;
const UPSTREAM_BUDGET_MS = 10_000;

// "adsb.fi returned zero rows" is read as a broken feed (the 2026-04-30
// ac→aircraft rename looked exactly like this) only because the default
// 250 nm circle over Washington always contains traffic. If SS_REGION_NM
// is set to a small radius, an empty sky is plausible, so zero rows is
// accepted as a real answer below this threshold.
const ZERO_ROWS_MIN_RADIUS_NM = 100;
const PRIMARY_ZERO_IS_FAILURE = REGION.nm >= ZERO_ROWS_MIN_RADIUS_NM;

async function fetchAdsbFi(budget?: AbortSignal): Promise<NormalizedAc[]> {
  const url = `https://opendata.adsb.fi/api/v2/lat/${REGION.lat}/lon/${REGION.lon}/dist/${REGION.nm}`;
  const timeout = AbortSignal.timeout(ADSBFI_TIMEOUT_MS);
  const r = await fetch(url, {
    ...FETCH_OPTS,
    signal: budget ? AbortSignal.any([budget, timeout]) : timeout,
  });
  if (!r.ok) throw new Error(`adsb.fi ${r.status}`);
  const j = (await r.json()) as AdsbFiResp;
  return j.aircraft ?? [];
}

// ─── Normalize + merge ─────────────────────────────────────────────────────

export async function buildSnapshot(): Promise<Snapshot> {
  // Resolve the registry once per snapshot regen — getRegistry caches in
  // memory for 5s so this isn't a hot path on KV.
  const fleet = await getRegistry();
  const fleetByIcao = new Map<string, FleetEntry>();
  for (const f of fleet) {
    const hex = fleetHex(f);
    if (hex) fleetByIcao.set(hex, f);
  }
  const fleetHexes = [...fleetByIcao.keys()];

  // One overall budget across every upstream request this tick (adsb.fi,
  // OpenSky auth, OpenSky states, the 401 retry). Per-request timeouts
  // still apply inside it; this caps the sum so a slow primary plus a slow
  // fallback cannot stall the regen past ~10s.
  const budget = AbortSignal.timeout(UPSTREAM_BUDGET_MS);

  // Degraded = no trustworthy observation this tick. The aircraft list
  // below still gets built (every tail airborne:false) so consumers keep a
  // valid shape, but the flag tells the activity diff, track log, freshness
  // pointer and snapshot cache to treat it as a placeholder.
  const { raw, source, degraded } = await selectFeed({
    primary: () => fetchAdsbFi(budget),
    fallback: () => fetchOpenSky(fleetHexes, budget),
    primaryZeroIsFailure: PRIMARY_ZERO_IS_FAILURE,
  });

  const now = Date.now();
  const liveByIcao = new Map<string, NormalizedAc>();
  for (const ac of raw) {
    const hex = ac.hex.toLowerCase();
    if (fleetByIcao.has(hex)) liveByIcao.set(hex, ac);
  }

  // Update first-seen state
  for (const [hex, _] of liveByIcao) {
    const prev = seenByIcao.get(hex);
    if (!prev || now - prev.lastSeenAt > 10 * 60 * 1000) {
      // new sighting (or > 10 min gap = treat as a new flight)
      seenByIcao.set(hex, { firstSeenAt: now, lastSeenAt: now });
    } else {
      seenByIcao.set(hex, { ...prev, lastSeenAt: now });
    }
  }

  const aircraft: Aircraft[] = fleet.map((entry) => {
    const hex = fleetHex(entry);
    const ac = liveByIcao.get(hex);
    const seen = seenByIcao.get(hex);

    if (!ac) {
      const last_seen_min = seen
        ? Math.floor((now - seen.lastSeenAt) / 60_000)
        : null;
      const live: AircraftLive = {
        tail: entry.tail,
        icao24: hex,
        airborne: false,
        last_seen_min,
      };
      return { ...entry, ...live };
    }

    const grounded = ac.alt_baro === "ground";
    const time_aloft_min = seen
      ? Math.max(0, Math.floor((now - seen.firstSeenAt) / 60_000))
      : 0;

    const live: AircraftLive = {
      tail: entry.tail,
      icao24: hex,
      airborne: !grounded,
      lat: ac.lat,
      lon: ac.lon,
      altitude_ft:
        typeof ac.alt_baro === "number" ? ac.alt_baro : undefined,
      ground_speed_kt: ac.gs,
      heading: ac.track,
      squawk: ac.squawk ?? null,
      time_aloft_min: grounded ? undefined : time_aloft_min,
      last_seen_min: 0,
    };
    return { ...entry, ...live };
  });

  return {
    fetched_at: now,
    source,
    aircraft,
    live_seen_count: raw.length,
    ...(degraded ? { degraded: true } : {}),
  };
}

export function anyAirborne(snap: Snapshot): boolean {
  return snap.aircraft.some((a) => a.airborne);
}
