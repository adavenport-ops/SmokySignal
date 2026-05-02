import { NextResponse } from "next/server";
import { getRegistry } from "@/lib/registry";
import { getTailHotZonesCached } from "@/lib/per-plane-heatmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { tail: string } },
) {
  const tail = params.tail.toUpperCase();
  const registry = await getRegistry();
  if (!registry.find((e) => e.tail === tail)) {
    return NextResponse.json({ error: "unknown tail" }, { status: 404 });
  }
  const zones = await getTailHotZonesCached(tail);
  return NextResponse.json(
    { zones },
    {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    },
  );
}
