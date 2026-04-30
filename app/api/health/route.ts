import { NextResponse } from "next/server";
import { FLEET } from "@/lib/seed";
import { getLastSource } from "@/lib/snapshot";
import { cacheGet, cacheSet, hasKv } from "@/lib/cache";
import {
  getOpenskyToken,
  getOpenskyCreditsRemaining,
} from "@/lib/opensky";

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

async function pingOpensky(): Promise<"ok" | "err" | "anonymous"> {
  if (!process.env.OPENSKY_CLIENT_ID || !process.env.OPENSKY_CLIENT_SECRET) {
    return "anonymous";
  }
  try {
    const token = await Promise.race([
      getOpenskyToken(),
      new Promise<null>((_, rej) =>
        setTimeout(() => rej(new Error("opensky auth timeout")), PING_TIMEOUT_MS),
      ),
    ]);
    return token ? "ok" : "err";
  } catch {
    return "err";
  }
}

export async function GET() {
  const adsbfiUrl =
    "https://opendata.adsb.fi/api/v2/lat/47.6/lon/-122.3/dist/1";

  const [kv, adsbfi, opensky, opensky_credits_remaining] = await Promise.all([
    pingKv(),
    pingUrl(adsbfiUrl),
    pingOpensky(),
    getOpenskyCreditsRemaining(),
  ]);

  // adsb.fi is the only path that must work for the app to be useful;
  // OpenSky is a fallback. KV is optional (in-memory fallback exists).
  const ok = adsbfi === "ok";
  return NextResponse.json({
    ok,
    kv,
    adsbfi,
    opensky,
    opensky_credits_remaining,
    tails: FLEET.length,
    source_last: getLastSource(),
    ts: new Date().toISOString(),
  });
}
