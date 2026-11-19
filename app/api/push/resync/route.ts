// POST /api/push/resync — a browser that already granted notifications and
// still holds a push subscription re-registers it silently. Creates the row
// only when missing (default prefs); an existing row keeps its prefs and
// gets its TTL refreshed. Same validation and rate limit as /subscribe.
import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { SubscriberCapError, resyncSubscription } from "@/lib/push/store";
import { parsePushSubscription } from "@/lib/push/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "push-subscribe");
  if (limited) return limited;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sub = parsePushSubscription((body as { sub?: unknown } | null)?.sub);
  if (!sub) return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  try {
    const { id, created } = await resyncSubscription(sub);
    return NextResponse.json({ ok: true, id, created });
  } catch (e) {
    if (e instanceof SubscriberCapError) {
      return NextResponse.json({ error: "at_capacity" }, { status: 503 });
    }
    console.warn("[push/resync] failed:", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
