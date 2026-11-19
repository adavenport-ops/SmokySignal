import { NextResponse } from "next/server";
import { saveSpot } from "@/lib/spots";
import { parseSpotBody } from "@/lib/spot-payload";
import { readJsonBody } from "@/lib/input-validation";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "spot");
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.status });
  }
  // Validates, caps airborne_tails, and rounds rider lat/lon to 2
  // decimals before anything is stored (lib/spot-payload.ts).
  const parsed = parseSpotBody(body.body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const stored = await saveSpot(parsed.payload);
    return NextResponse.json({ ok: true, id: stored.id });
  } catch (e) {
    console.warn("[spot] save failed:", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
