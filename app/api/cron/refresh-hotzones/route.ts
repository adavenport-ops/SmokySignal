// Vercel cron — recomputes the 30-day hot-zone aggregate from
// tracks:* keys and writes hotzones:current. Schedule: 04:00 UTC daily
// (= 9 PM Pacific). Auth: Bearer CRON_SECRET.

import { NextResponse } from "next/server";
import { refreshHotZones } from "@/lib/hotzones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Aggregating ~30 days × 16 tails of points takes meaningfully more than
// the default short-route limit; bump to allow a clean run.
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return unauthorized();

  try {
    const { zoneCount, ts } = await refreshHotZones();
    return NextResponse.json({ ok: true, zone_count: zoneCount, ts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
