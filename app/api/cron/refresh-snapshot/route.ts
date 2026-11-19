// Vercel cron — invalidates the snapshot cache and re-fetches so the ADS-B
// feeds are queried even when no human traffic is hitting /api/aircraft. This
// keeps the activity feed firing continuously (recordActivity runs as a
// side-channel inside getSnapshot's regen path).
//
// Schedule: vercel.json. Vercel Hobby plan limits crons to once per day,
// so the default is "0 14 * * *" (daily, 2 PM UTC = 7 AM Pacific). On
// Pro, change vercel.json to "* * * * *" for per-minute refresh — that
// gives the activity feed near-real-time event capture independent of
// user traffic.
//
// Auth: Bearer CRON_SECRET.

import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getSnapshot, invalidateSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Snapshot regen can hand push fan-out to waitUntil; it is capped at 25s
// (OVERALL_DEADLINE_MS in lib/push/send.ts), so give the function room.
export const maxDuration = 30;

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (auth === "not_configured") {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  if (auth !== "ok") return unauthorized();

  await invalidateSnapshot();
  const snap = await getSnapshot();
  const airborne = snap.aircraft.filter((a) => a.airborne).length;

  // Degraded = every upstream feed failed this tick; fetched_at is then the
  // last good read (or the placeholder's), not this run. `source` is the
  // "fi+lol" style summary of the feeds that answered.
  const degraded = snap.degraded === true;
  return NextResponse.json({
    ok: !degraded,
    degraded,
    fetched_at: snap.fetched_at,
    source: snap.source,
    airborne,
  });
}
