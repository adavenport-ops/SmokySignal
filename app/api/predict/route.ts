import { NextResponse } from "next/server";
import {
  getCachedPrediction,
  refreshPrediction,
} from "@/lib/predictor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Prefer cached; fall back to live recompute on cache miss so the home
  // card never shows the "still learning" placeholder just because the
  // hourly cron hasn't run yet.
  const cached = await getCachedPrediction();
  const out = cached ?? (await refreshPrediction());
  return NextResponse.json(out, {
    headers: {
      "Cache-Control":
        "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
