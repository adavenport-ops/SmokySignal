import { NextResponse } from "next/server";
import {
  getHotZonesCached,
  getLastHotZoneRefresh,
  type HotZone,
} from "@/lib/hotzones";
import { getRegistry } from "@/lib/registry";
import { REGIONS, type RegionBbox, type RegionId } from "@/lib/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve the rider-facing region selector → bbox. Accepts either the
// new `region_id` query param (any RegionId from lib/regions.ts) or the
// legacy `region` value ("puget_sound" | "all") for backward compat
// with the chevron filter UI.
function resolveBbox(url: URL): { regionId: RegionId; bbox: RegionBbox } {
  const idParam = url.searchParams.get("region_id");
  if (idParam && idParam in REGIONS) {
    const id = idParam as RegionId;
    return { regionId: id, bbox: REGIONS[id].bbox };
  }
  const legacy = url.searchParams.get("region");
  if (legacy === "all") {
    return { regionId: "all_wa", bbox: REGIONS.all_wa.bbox };
  }
  return { regionId: "puget_sound", bbox: REGIONS.puget_sound.bbox };
}

function inBbox(z: HotZone, b: NonNullable<RegionBbox>): boolean {
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
  const { regionId, bbox } = resolveBbox(url);
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
    if (bbox && !inBbox(z, bbox)) return false;
    if (allowedTails && !z.tails.some((t) => allowedTails!.has(t))) return false;
    return true;
  });

  return NextResponse.json(
    {
      zones,
      last_refresh_ts: lastRefresh,
      region_id: regionId,
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
