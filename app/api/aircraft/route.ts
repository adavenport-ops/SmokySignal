import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/snapshot";
import { applyMockState, getMockStateFromRequest } from "@/lib/mock-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Snapshot regen can hand push fan-out to waitUntil; it is capped at 25s
// (OVERALL_DEADLINE_MS in lib/push/send.ts), so give the function room.
export const maxDuration = 30;

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
