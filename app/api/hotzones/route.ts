import { NextResponse } from "next/server";
import { getHotZonesCached, getLastHotZoneRefresh } from "@/lib/hotzones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [zones, lastRefresh] = await Promise.all([
    getHotZonesCached(),
    getLastHotZoneRefresh(),
  ]);
  return NextResponse.json(
    { zones, last_refresh_ts: lastRefresh },
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
