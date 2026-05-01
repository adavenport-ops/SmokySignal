import { NextResponse } from "next/server";
import {
  getHotZonesCached,
  getLastHotZoneRefresh,
  type HotZone,
} from "@/lib/hotzones";
import { getRegistry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rider-facing default region — Puget Sound bbox. Wider than the
// hot-zone aggregate's defensive Pacific-NW envelope so we still see
// Eastern WA enforcement when the user opts into the statewide view.
const PUGET_SOUND = {
  latMin: 46.5,
  latMax: 48.5,
  lonMin: -123.5,
  lonMax: -121.5,
} as const;

function inBbox(z: HotZone, b: typeof PUGET_SOUND): boolean {
  return (
    z.lat >= b.latMin &&
    z.lat <= b.latMax &&
    z.lon >= b.lonMin &&
    z.lon <= b.lonMax
  );
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const region = url.searchParams.get("region") === "all" ? "all" : "puget_sound";
  const tails = parseList(url.searchParams.get("tails"));
  const operator = url.searchParams.get("operator")?.trim() ?? null;

  const [allZones, lastRefresh] = await Promise.all([
    getHotZonesCached(),
    getLastHotZoneRefresh(),
  ]);

  // Build effective tail set from operator if specified.
  let allowedTails: Set<string> | null = null;
  if (tails.length > 0 || operator) {
    allowedTails = new Set(tails);
    if (operator) {
      const registry = await getRegistry();
      for (const f of registry) {
        if (f.operator === operator) allowedTails.add(f.tail);
      }
    }
  }

  const zones = allZones.filter((z) => {
    if (region === "puget_sound" && !inBbox(z, PUGET_SOUND)) return false;
    if (allowedTails && !z.tails.some((t) => allowedTails!.has(t))) return false;
    return true;
  });

  return NextResponse.json(
    {
      zones,
      last_refresh_ts: lastRefresh,
      region,
      filter_tails: tails,
      filter_operator: operator,
      total_unfiltered: allZones.length,
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
        ...(lastRefresh != null
          ? { "x-hotzones-refreshed-at": String(lastRefresh) }
          : {}),
      },
    },
  );
}
