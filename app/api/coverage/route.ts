import { NextResponse } from "next/server";
import { getHistoryDigest } from "@/lib/history-digest";

// Lost-contact drop-outs over the last 30 days, bucketed into hot-zone
// grid cells (lib/coverage.ts). Built from the same cached 30-day digest
// as the road pages.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const digest = await getHistoryDigest();
  const { coverage } = digest;
  return NextResponse.json(
    {
      window_days: coverage.windowDays,
      built_at: digest.builtAt,
      dropouts: coverage.dropouts,
      weakest: coverage.weakest,
      areas: coverage.areas,
      cells: coverage.cells,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=300",
      },
    },
  );
}
