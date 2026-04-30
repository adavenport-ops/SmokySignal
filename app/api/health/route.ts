import { NextResponse } from "next/server";
import { FLEET } from "@/lib/seed";
import { getLastSource } from "@/lib/snapshot";
import { cacheGet, cacheSet, hasKv } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_TIMEOUT_MS = 2000;

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

export async function GET() {
  // Use ICAO range bbox at 0nm so the call is tiny but exercises the endpoint.
  const adsbfiUrl =
    "https://opendata.adsb.fi/api/v2/lat/47.6/lon/-122.3/dist/1";
  // Smoky's hex — small, valid, anonymous.
  const openskyUrl =
    "https://opensky-network.org/api/states/all?icao24=a3323a";

  const [kv, adsbfi, opensky] = await Promise.all([
    pingKv(),
    pingUrl(adsbfiUrl),
    pingUrl(openskyUrl),
  ]);

  const ok = adsbfi === "ok" || opensky === "ok"; // KV is optional
  const body = {
    ok,
    kv,
    adsbfi,
    opensky,
    tails: FLEET.length,
    source_last: getLastSource(),
    ts: new Date().toISOString(),
  };
  return NextResponse.json(body);
}
