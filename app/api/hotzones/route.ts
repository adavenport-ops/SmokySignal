import { NextResponse } from "next/server";
import { resolveAllowedTails } from "@/lib/mission";
import { getHotZonesCached, getLastHotZoneRefresh } from "@/lib/hotzones";
import { getRegistry } from "@/lib/registry";
import { REGIONS, type RegionId } from "@/lib/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The grid is statewide-plus (lib/hotzones.ts TRACKING_ENVELOPE) and is
// returned unclipped. The /radar region picker is a camera control, so
// `region_id` no longer narrows the cells. It is still accepted (old
// clients and bookmarks send it) and echoed back, but ignored for
// filtering. The legacy "?region=all" alias is accepted the same way.
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const regionId = echoRegionId(url);
  const tails = parseList(url.searchParams.get("tails"));
  // Operator now accepts a comma-separated list. A single-operator query
  // (?operator=WSP) still works — parses as a one-element list.
  const operators = parseListCaseSensitive(url.searchParams.get("operator"));
  // Mission filter resolves through here as ?roles=police,sar (legacy
  // ?roles=smokey,patrol still maps to police). The registry lookup
  // expands the mission set to the current matching tails so the rider's
  // filter follows fleet membership changes automatically.
  const roles = parseList(url.searchParams.get("roles")).map((r) =>
    r.toLowerCase(),
  );

  const [allZones, lastRefresh] = await Promise.all([
    getHotZonesCached(),
    getLastHotZoneRefresh(),
  ]);

  // Effective tail set: every non-empty constraint must match (AND),
  // mirroring the radar marker filter.
  const allowedTails =
    tails.length > 0 || operators.length > 0 || roles.length > 0
      ? resolveAllowedTails(await getRegistry(), { tails, operators, roles })
      : null;

  const zones = allZones.filter((z) => {
    if (allowedTails && !z.tails.some((t) => allowedTails!.has(t))) return false;
    return true;
  });

  return NextResponse.json(
    {
      zones,
      last_refresh_ts: lastRefresh,
      region_id: regionId,
      region_clipped: false,
      filter_tails: tails,
      filter_operator: operators.length > 0 ? operators.join(",") : null,
      filter_operators: operators,
      filter_roles: roles,
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
