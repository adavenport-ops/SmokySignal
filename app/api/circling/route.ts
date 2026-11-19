import { NextResponse } from "next/server";
import { getCirclingNow } from "@/lib/circling-server";

// Every airborne tail working a pattern right now (lib/circling.ts).
// Takes no location: "Near me" sorting happens in the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await getCirclingNow();
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
      },
    });
  } catch (e) {
    console.warn("[api/circling] failed:", e);
    return NextResponse.json(
      { fetched_at: null, degraded: true, patterns: [], also_up: [] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
