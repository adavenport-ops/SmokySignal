// POST /api/relay/manage/test: send one sample takeoff to the relay,
// bypassing filters and cooldown. Marked as a test in both formats.

import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { testRelayService } from "@/lib/relay/service";
import { getRelayKv } from "@/lib/relay/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "relay-test");
  if (limited) return limited;
  const r = await testRelayService(req.headers.get("authorization"), { kv: await getRelayKv() });
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
