import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { SubscriberCapError, saveSubscription } from "@/lib/push/store";
import { parsePushSubscription, validatePrefsInput } from "@/lib/push/validate";

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
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const b = body as { sub?: unknown; prefs?: unknown };
  // Endpoint must be a known browser push service (no arbitrary hosts) and
  // keys must be base64url of plausible length. Only { endpoint, keys } is
  // kept; any other fields on the incoming object are dropped.
  const sub = parsePushSubscription(b.sub);
  if (!sub) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }
  const prefs = validatePrefsInput(b.prefs);
  if (!prefs.ok) {
    return NextResponse.json({ error: prefs.error }, { status: 400 });
  }
  try {
    const id = await saveSubscription(sub, prefs.prefs);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof SubscriberCapError) {
      console.warn("[push/subscribe] subscriber cap reached");
      return NextResponse.json({ error: "at_capacity" }, { status: 503 });
    }
    console.warn("[push/subscribe] save failed:", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
