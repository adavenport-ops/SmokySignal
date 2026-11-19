// POST /api/relay: create a club relay (Discord or generic webhook).
// Returns the one-time manage URL (and, for generic webhooks, the
// signing secret). The webhook URL is never echoed back.

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/input-validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createRelayService } from "@/lib/relay/service";
import { getRelayKv } from "@/lib/relay/store";
import { validateRelayInput } from "@/lib/relay/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status, headers: NO_STORE });
  }
  // Syntactic checks are pure and cheap, so a malformed body gets its 400
  // without spending the caller's create budget. The budget guards the
  // expensive part: the DNS lookup and the write.
  const shape = validateRelayInput(parsed.body, { partial: false });
  if (!shape.ok) {
    return NextResponse.json({ error: shape.error }, { status: 400, headers: NO_STORE });
  }
  const limited = await enforceRateLimit(req, "relay-create");
  if (limited) return limited;
  const r = await createRelayService(parsed.body, { kv: await getRelayKv() });
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
