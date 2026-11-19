import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/snapshot";
import { aircraftCacheControl } from "@/lib/feed-select";
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
      // Healthy: browser won't cache, CDN holds the same 10s the server
      // does. Degraded (both feeds down): no-store, so the CDN cannot keep
      // serving a dead-feed tick after the upstream recovers.
      "Cache-Control": aircraftCacheControl(out),
    },
  });
}
