// Snapshot builder. Asks every regional ADS-B feed in parallel (adsb.fi,
// adsb.lol, airplanes.live when enabled), unions their rows by ICAO hex,
// and falls back to OpenSky only when none of them answered. Adapters live
// in lib/feeds/*; the decision table is lib/feed-select.ts; the rate
// budget is lib/feed-budget.ts.

import { fleetHex } from "./seed";
import { getRegistry } from "./registry";
import { fetchOpenSky } from "./opensky";
import { selectFeed, type FeedSpec } from "./feed-select";
import { minIntervalS, providerLimits } from "./feed-budget";
import {
  backoffFeed,
  claimFeedSlot,
  feedBackedOff,
  recallFeedRows,
  rememberFeedRows,
  writeFeedStatus,
} from "./feed-runtime";
import { fetchAdsbFi } from "./feeds/adsbfi";
import { fetchAdsbLol } from "./feeds/adsblol";
import { airplanesLiveEnabled, fetchAirplanesLive } from "./feeds/airplaneslive";
import { FeedHttpError } from "./feeds/http";
import { REGION, regionZeroIsFailure } from "./feeds/region";
import { captureFields } from "./track-point";
import type {
  Aircraft,
  AircraftLive,
  FeedSrc,
  FleetEntry,
  NormalizedAc,
  Snapshot,
} from "./types";

// In-memory state across requests — tracks first-seen timestamps so we can
// derive "minutes aloft" without a track-history table yet.
type SeenState = { firstSeenAt: number; lastSeenAt: number };
const seenByIcao = new Map<string, SeenState>();

// One overall budget across every upstream request this tick (all regional
// feeds in parallel, then OpenSky auth, states and the 401 retry if they
// all fail). Per-request timeouts still apply inside it.
const UPSTREAM_BUDGET_MS = 10_000;

// The hot-path snapshot cache (lib/snapshot.ts) already holds each tick
// for 10 s, so a feed whose budget allows a request at least that often
// needs no extra gate. Only slower budgets pay a KV round trip.
const SNAPSHOT_TTL_S = 10;

const ZERO_IS_FAILURE = regionZeroIsFailure(REGION);

// A gated feed's last fleet rows are reused on the ticks it sits out, for
// one interval plus this slack. Past that the rows are dropped, so a feed
// that stops answering stops vouching for its tails.
const CARRY_SLACK_S = 60;

function gated(
  src: FeedSrc,
  intervalS: number,
  fleet: Set<string>,
): Pick<FeedSpec, "claim" | "onError" | "remember" | "recall"> {
  return {
    ...(intervalS > SNAPSHOT_TTL_S
      ? {
          claim: () => claimFeedSlot(src, intervalS),
          remember: (rows: NormalizedAc[]) =>
            rememberFeedRows(
              src,
              rows.filter((r) => fleet.has(r.hex)),
              intervalS + CARRY_SLACK_S,
            ),
          recall: () => recallFeedRows(src, intervalS + CARRY_SLACK_S),
        }
      : { claim: async () => !feedBackedOff(src) }),
    onError: async (e) => {
      if (e instanceof FeedHttpError && e.status === 429) {
        await backoffFeed(src, e.retryAfterS ?? Math.max(intervalS, 60));
      }
    },
  };
}

function regionalFeeds(budget: AbortSignal, fleet: Set<string>): FeedSpec[] {
  const limits = providerLimits();
  return [
    {
      src: "fi",
      fetch: () => fetchAdsbFi(REGION, budget),
      zeroIsFailure: ZERO_IS_FAILURE,
      ...gated("fi", minIntervalS(limits.fi), fleet),
    },
    {
      src: "lol",
      fetch: () => fetchAdsbLol(REGION, budget),
      zeroIsFailure: ZERO_IS_FAILURE,
      ...gated("lol", minIntervalS(limits.lol), fleet),
    },
    {
      src: "apl",
      enabled: airplanesLiveEnabled(),
      fetch: () => fetchAirplanesLive(REGION, budget),
      zeroIsFailure: ZERO_IS_FAILURE,
      ...gated("apl", minIntervalS(limits.apl), fleet),
    },
  ];
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

  // Caps the sum so slow regional feeds plus a slow fallback cannot stall
  // the regen past ~10s.
  const budget = AbortSignal.timeout(UPSTREAM_BUDGET_MS);

  // Degraded = no trustworthy observation this tick. The aircraft list
  // below still gets built (every tail airborne:false) so consumers keep a
  // valid shape, but the flag tells the activity diff, track log, freshness
  // pointer and snapshot cache to treat it as a placeholder.
  const { raw, source, degraded, feeds } = await selectFeed({
    sources: regionalFeeds(budget, new Set(fleetHexes)),
    fallback: {
      src: "os",
      fetch: () => fetchOpenSky(fleetHexes, budget),
      zeroIsFailure: true,
    },
  });
  // Per-feed status for /api/health. Best-effort: never fail the regen.
  try {
    await writeFeedStatus(feeds);
  } catch (e) {
    console.warn("[adsb] feed status write failed:", e);
  }

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
      ...(ac.src ? { src: ac.src } : {}),
      ...(ac.sources ? { feed_sources: ac.sources } : {}),
      obs: captureFields(ac),
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
