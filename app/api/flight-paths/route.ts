// Flight-path overlay endpoint. Returns one GeoJSON LineString per
// tail-day with > 5 points across the whole tracking envelope (WA plus
// the OR / ID border areas), filtered only by the optional operator /
// role / tail allow-list. `region_id` is accepted for back-compat and
// echoed, but no longer clips: the /radar region picker is camera-only.
// Powers the polyline layer that sits beneath the hot-zone heatmap on
// /radar; corridors render as thin amber threads under the density blob.
//
// The endpoint walks lib/tracks.ts:listTrackKeys() + getTracksForDay()
// across the registry. Same data source as the daily hot-zone
// aggregation cron, but composed per-request. Edge
// cached for 5 min to keep the round-trip cost contained when riders
// flip filters in quick succession. Each line is cleaned by
// lib/route-decimate.ts (envelope filter, ~1 m rounding, ~110 m radial
// decimation) to keep the statewide payload small.

import { NextResponse } from "next/server";
import { getRegistry } from "@/lib/registry";
import { listTrackKeys, getTracksForDay } from "@/lib/tracks";
import { REGIONS, type RegionId } from "@/lib/regions";
import { decimateRoute } from "@/lib/route-decimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_POINTS_PER_LINE = 5;
const MAX_DAYS = 30;

type LineFeature = GeoJSON.Feature<
  GeoJSON.LineString,
  { tail: string; date: string; count: number }
>;

function echoRegionId(url: URL): RegionId | null {
  const idParam = url.searchParams.get("region_id");
  if (idParam && Object.hasOwn(REGIONS, idParam)) return idParam as RegionId;
  return null;
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Like parseList but preserves case — operator names like "Pierce SO"
 *  are case-sensitive in the registry. */
function parseListCaseSensitive(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const regionId = echoRegionId(url);
  // Operator + tails accept comma-separated lists. Either or both can
  // be empty; intersection with `roles` (via registry lookup) builds the
  // effective tail allow-list.
  const operators = parseListCaseSensitive(url.searchParams.get("operator"));
  const tails = parseList(url.searchParams.get("tails"));
  const roles = parseList(url.searchParams.get("roles")).map((r) =>
    r.toLowerCase(),
  );
  const daysRaw = Number(url.searchParams.get("days") ?? MAX_DAYS);
  const days = Number.isFinite(daysRaw)
    ? Math.max(1, Math.min(MAX_DAYS, Math.floor(daysRaw)))
    : MAX_DAYS;

  const registry = await getRegistry();

  // Resolve operator + role + tails filters to a tail allow-list. Empty
  // filter = every tail in the registry.
  let allowedTails: Set<string> | null = null;
  if (operators.length > 0 || roles.length > 0 || tails.length > 0) {
    allowedTails = new Set(tails);
    if (operators.length > 0 || roles.length > 0) {
      for (const f of registry) {
        if (operators.length > 0 && operators.includes(f.operator)) {
          allowedTails.add(f.tail);
        }
        if (roles.length > 0 && roles.includes(String(f.role).toLowerCase())) {
          allowedTails.add(f.tail);
        }
      }
    }
  }

  const cutoff = utcDateKey(new Date(Date.now() - days * 86_400_000));
  const features: LineFeature[] = [];

  for (const f of registry) {
    if (allowedTails && !allowedTails.has(f.tail)) continue;
    const dates = await listTrackKeys(f.tail);
    const keep = dates.filter((d) => d >= cutoff);
    for (const date of keep) {
      const points = await getTracksForDay(f.tail, date);
      if (points.length < MIN_POINTS_PER_LINE) continue;
      // Tracks are appended in chronological order but defensively sort
      // by ts in case a slow Redis write reorders pings on the same
      // millisecond.
      points.sort((a, b) => a.ts - b.ts);
      const coords = decimateRoute(points.map((p) => [p.lon, p.lat]));
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { tail: f.tail, date, count: coords.length },
      });
    }
  }

  return NextResponse.json(
    {
      type: "FeatureCollection",
      features,
      region_id: regionId,
      region_clipped: false,
      filter_operators: operators,
      filter_tails: tails,
      filter_roles: roles,
      window_days: days,
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
