import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/snapshot";
import { applyMockState, getMockStateFromRequest } from "@/lib/mock-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const snap = await getSnapshot();
  const out = applyMockState(snap, getMockStateFromRequest(req));
  return NextResponse.json(out, {
    headers: {
      // Browser won't cache; CDN can hold the same 10s the server does.
      "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
    },
  });
}
