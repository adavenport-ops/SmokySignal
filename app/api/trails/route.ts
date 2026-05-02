// /api/trails — recent track-history slice for currently-airborne tails.
// Powers the polyline trail layer on /radar (components/AircraftTrailLayer).
//
// Query: GET /api/trails?tails=N305DK,N2446X&minutes=30
// Response: { trails: { [tail]: [{ lat, lon, ts }] } }
//   - Coordinates only (no alt/speed) — the trail layer doesn't need them
//     and dropping fields keeps the payload small.
//   - Sorted ascending by ts so a polyline reads from oldest → newest.

import { NextResponse } from "next/server";
import { getTracksForDay, listTrackKeys, type TrackPoint } from "@/lib/tracks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MINUTES = 30;
const MAX_MINUTES = 240;
const MAX_TAILS = 32;

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseTails(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^N[0-9A-Z]{1,5}$/.test(s))
    .slice(0, MAX_TAILS);
}

type TrailPoint = { lat: number; lon: number; ts: number };

async function trailFor(
  tail: string,
  cutoffSec: number,
): Promise<TrailPoint[]> {
  // Most trails fit inside today's UTC list; pull yesterday too only if
  // the cutoff crosses midnight (rare with default 30 min window).
  const now = new Date();
  const todayKey = utcDateKey(now);
  const yesterdayKey = utcDateKey(new Date(now.getTime() - 86_400_000));
  const haveDates = await listTrackKeys(tail);
  const interestingDates = haveDates.filter(
    (d) => d === todayKey || d === yesterdayKey,
  );
  const allPoints: TrackPoint[] = [];
  for (const date of interestingDates) {
    const points = await getTracksForDay(tail, date);
    for (const p of points) {
      if (p.ts >= cutoffSec) allPoints.push(p);
    }
  }
  allPoints.sort((a, b) => a.ts - b.ts);
  return allPoints.map((p) => ({ lat: p.lat, lon: p.lon, ts: p.ts }));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tails = parseTails(url.searchParams.get("tails"));
  const minutes = Math.min(
    MAX_MINUTES,
    Math.max(1, Number(url.searchParams.get("minutes") ?? DEFAULT_MINUTES)),
  );
  if (tails.length === 0) {
    return NextResponse.json({ trails: {} });
  }
  const cutoffSec = Math.floor(Date.now() / 1000) - minutes * 60;
  const entries = await Promise.all(
    tails.map(async (t) => [t, await trailFor(t, cutoffSec)] as const),
  );
  const trails: Record<string, TrailPoint[]> = {};
  for (const [tail, points] of entries) {
    if (points.length > 0) trails[tail] = points;
  }
  return NextResponse.json(
    { trails, minutes },
    {
      headers: {
        // Trails update every ~10s on the client; cache for half that
        // at the edge so two simultaneous radar viewers share a fetch
        // but never see stale-by-more-than-a-poll data.
        "Cache-Control":
          "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}
