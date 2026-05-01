import { NextResponse } from "next/server";
import { saveSubscription, type AlertPrefs } from "@/lib/push/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isPushSubscriptionJSON(v: unknown): v is PushSubscriptionJSON {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.endpoint !== "string" || !o.endpoint.startsWith("https://"))
    return false;
  if (!o.keys || typeof o.keys !== "object") return false;
  const k = o.keys as Record<string, unknown>;
  return typeof k.p256dh === "string" && typeof k.auth === "string";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const b = body as { sub?: unknown; prefs?: Partial<AlertPrefs> };
  if (!isPushSubscriptionJSON(b.sub)) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }
  try {
    const id = await saveSubscription(b.sub, b.prefs);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    console.warn("[push/subscribe] save failed:", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
