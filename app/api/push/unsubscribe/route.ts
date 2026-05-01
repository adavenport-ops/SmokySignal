import { NextResponse } from "next/server";
import { removeSubscription, subscriptionId } from "@/lib/push/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const b = body as { sub?: PushSubscriptionJSON; id?: string };
  let id: string | null = null;
  if (typeof b.id === "string" && b.id) {
    id = b.id;
  } else if (b.sub && typeof b.sub === "object" && typeof b.sub.endpoint === "string") {
    try {
      id = subscriptionId(b.sub);
    } catch {
      /* fall through to error */
    }
  }
  if (!id) {
    return NextResponse.json({ error: "missing_id_or_sub" }, { status: 400 });
  }
  try {
    await removeSubscription(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn("[push/unsubscribe] failed:", e);
    return NextResponse.json({ error: "remove_failed" }, { status: 500 });
  }
}
