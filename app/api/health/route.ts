import { NextResponse } from "next/server";
import { FLEET } from "@/lib/seed";
import {
  getLastSource,
  peekHealthSnapshot,
  getLastAirborneTs,
} from "@/lib/snapshot";
import { cacheGet, cacheSet, hasKv } from "@/lib/cache";
import {
  getOpenskyToken,
  getOpenskyCreditsRemaining,
  peekOpenskyToken,
} from "@/lib/opensky";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 8s — Vercel→Keycloak (auth.opensky-network.org) round-trip on cold token
// refresh has been observed to take 5-7s. From a residential IP the same call
// is ~500ms; the latency is paid by Vercel's datacenter egress to the OpenSky
// auth endpoint, so we accept a longer health-check ceiling here.
const PING_TIMEOUT_MS = 8000;

async function pingUrl(url: string): Promise<"ok" | "err"> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PING_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    return r.ok ? "ok" : "err";
  } catch {
    return "err";
  } finally {
    clearTimeout(t);
  }
}

async function pingKv(): Promise<"ok" | "err" | "memory"> {
  if (!hasKv()) return "memory";
  const probe = `ss:health:${Date.now()}`;
  try {
    await Promise.race([
      (async () => {
        await cacheSet(probe, 1, 5);
        const v = await cacheGet<number>(probe);
        if (v !== 1) throw new Error("kv read mismatch");
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("kv timeout")), PING_TIMEOUT_MS),
      ),
    ]);
    return "ok";
  } catch {
    return "err";
  }
}

type OpenskyPing =
  | { status: "ok" | "anonymous"; error?: undefined }
  | { status: "err"; error: string };

async function pingOpensky(): Promise<OpenskyPing> {
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    return { status: "anonymous" };
  }
  // Cheap path: a cached token (fresh OR stale) is evidence that auth has
  // worked recently. Skip the multi-second roundtrip on the common case.
  const cached = await peekOpenskyToken();
  if (cached?.access_token) return { status: "ok" };

  // Cold cache: try once. If this fails the next deploy or a successful
  // /api/aircraft fallback will re-seed the cache.
  try {
    const token = await Promise.race([
      getOpenskyToken(),
      new Promise<null>((_, rej) =>
        setTimeout(() => rej(new Error("opensky auth timeout")), PING_TIMEOUT_MS),
      ),
    ]);
    return token ? { status: "ok" } : { status: "err", error: "no token returned" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "err", error: msg.slice(0, 240) };
  }
}

export async function GET() {
  const adsbfiUrl =
    "https://opendata.adsb.fi/api/v2/lat/47.6/lon/-122.3/dist/1";

  const [
    kv,
    adsbfi,
    openskyResult,
    opensky_credits_remaining,
    snap,
    last_airborne_ts,
    last_heartbeat_ts,
  ] = await Promise.all([
    pingKv(),
    pingUrl(adsbfiUrl),
    pingOpensky(),
    getOpenskyCreditsRemaining(),
    peekHealthSnapshot(),
    getLastAirborneTs(),
    cacheGet<number>("meta:last_heartbeat"),
  ]);

  // Counts derived from the cached snapshot. live_seen_count = total
  // aircraft adsb.fi returned in the bbox before fleet filtering;
  // airborne_count = how many of OUR fleet are airborne. Together they
  // discriminate failure modes (parser broken vs. fleet just not flying).
  const airborne_count = snap
    ? snap.aircraft.filter((a) => a.airborne).length
    : null;
  const live_seen_count = snap?.live_seen_count ?? null;
  // Lets us discriminate "cron isn't running" (stale snapshot, age >> 60s)
  // from "no airborne fleet" (fresh snapshot, airborne_count = 0).
  const snapshot_age_s = snap
    ? Math.max(0, Math.round((Date.now() - snap.fetched_at) / 1000))
    : null;

  // adsb.fi is the only path that must work for the app to be useful;
  // OpenSky is a fallback. KV is optional (in-memory fallback exists).
  const ok = adsbfi === "ok";
  // CI heartbeat — written by .github/workflows/heartbeat.yml hourly.
  // Surfaced here so the nightly persona-walk workflow can detect Mac
  // Mini outages and verify-prod can assert freshness.
  const last_heartbeat_age_s =
    typeof last_heartbeat_ts === "number" && Number.isFinite(last_heartbeat_ts)
      ? Math.max(0, Math.floor(Date.now() / 1000 - last_heartbeat_ts))
      : null;
  const last_heartbeat_iso =
    typeof last_heartbeat_ts === "number" && Number.isFinite(last_heartbeat_ts)
      ? new Date(last_heartbeat_ts * 1000).toISOString()
      : null;

  return NextResponse.json({
    ok,
    kv,
    adsbfi,
    airborne_count,
    live_seen_count,
    snapshot_age_s,
    last_airborne_ts: last_airborne_ts
      ? new Date(last_airborne_ts).toISOString()
      : null,
    last_heartbeat_iso,
    last_heartbeat_age_s,
    opensky: openskyResult.status,
    ...(openskyResult.error ? { opensky_error: openskyResult.error } : {}),
    opensky_credits_remaining,
    tails: FLEET.length,
    source_last: getLastSource(),
    ts: new Date().toISOString(),
  });
}
