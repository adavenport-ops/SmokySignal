// GET /api/nav-index — the registry tails the search palette indexes
// (tail, nickname, operator, model, mission). Loaded lazily the first
// time a rider opens search; pages, roads, towns and settings are built
// client-side from lib/nav-index.ts. CDN-cached for 5 minutes: the
// registry changes a few times a month.

import { NextResponse } from "next/server";
import { getRegistry } from "@/lib/registry";
import type { NavIndexTail } from "@/lib/nav-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const registry = await getRegistry();
  const tails: NavIndexTail[] = registry.map((f) => ({
    tail: f.tail,
    nickname: f.nickname,
    operator: f.operator,
    model: f.model,
    role: f.role,
  }));
  return NextResponse.json(
    { tails, fetched_at: Date.now() },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
