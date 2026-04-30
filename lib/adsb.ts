// ADS-B feed adapters: adsb.fi (primary) + OpenSky (fallback).
// Polite usage: bbox query once per refresh, KV-cached upstream.

import { FLEET, fleetHex } from "./seed";
import { fetchOpenSky } from "./opensky";
import type {
  Aircraft,
  AircraftLive,
  NormalizedAc,
  Snapshot,
} from "./types";

// Precompute icao24 → fleet entry index at module load.
const FLEET_BY_ICAO = new Map<string, (typeof FLEET)[number]>();
for (const f of FLEET) {
  const hex = fleetHex(f);
  if (hex) FLEET_BY_ICAO.set(hex, f);
}

const FLEET_HEXES = [...FLEET_BY_ICAO.keys()];

const REGION = {
  lat: Number(process.env.SS_REGION_LAT ?? 47.6),
  lon: Number(process.env.SS_REGION_LON ?? -122.3),
  nm: Number(process.env.SS_REGION_NM ?? 80),
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

type AdsbFiResp = { ac?: NormalizedAc[]; now?: number };

async function fetchAdsbFi(): Promise<NormalizedAc[]> {
  const url = `https://opendata.adsb.fi/api/v2/lat/${REGION.lat}/lon/${REGION.lon}/dist/${REGION.nm}`;
  const r = await fetch(url, FETCH_OPTS);
  if (!r.ok) throw new Error(`adsb.fi ${r.status}`);
  const j = (await r.json()) as AdsbFiResp;
  return j.ac ?? [];
}

// ─── Normalize + merge ─────────────────────────────────────────────────────

export async function buildSnapshot(): Promise<Snapshot> {
  let raw: NormalizedAc[] = [];
  let source: Snapshot["source"] = "adsbfi";
  try {
    raw = await fetchAdsbFi();
  } catch (e) {
    console.warn("[adsb] primary failed, falling back to OpenSky:", e);
    try {
      raw = await fetchOpenSky(FLEET_HEXES);
      source = "opensky";
    } catch (e2) {
      console.error("[adsb] both feeds failed:", e2);
      raw = [];
      // Both feeds failed; mark as last-attempted so source stays in the type.
      source = "opensky";
    }
  }

  const now = Date.now();
  const liveByIcao = new Map<string, NormalizedAc>();
  for (const ac of raw) {
    const hex = ac.hex.toLowerCase();
    if (FLEET_BY_ICAO.has(hex)) liveByIcao.set(hex, ac);
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

  const aircraft: Aircraft[] = FLEET.map((entry) => {
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

  return { fetched_at: now, source, aircraft };
}

export function anyAirborne(snap: Snapshot): boolean {
  return snap.aircraft.some((a) => a.airborne);
}
