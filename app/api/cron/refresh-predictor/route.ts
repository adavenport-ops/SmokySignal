// Vercel cron — recomputes the next-likely-sweep prediction from
// activity:feed and caches it at predictor:current. Schedule:
// Hobby plans cap cron at once/day, so the default schedule in
// vercel.json is daily. On Pro, change to "0 * * * *" for hourly
// refresh so the "currently learning" prediction stays close to
// real-time. Auth: Bearer CRON_SECRET.

import { NextResponse } from "next/server";
import { refreshPrediction } from "@/lib/predictor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 500 });
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return unauthorized();

  try {
    const out = await refreshPrediction();
    return NextResponse.json({
      ok: true,
      window_count: out.windows.length,
      total_events: out.total_events,
      ts: out.generated_at,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
