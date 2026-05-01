import { NextResponse } from "next/server";
import { updatePrefs, type AlertPrefs } from "@/lib/push/store";

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
  const b = body as { id?: unknown; prefs?: Partial<AlertPrefs> };
  if (typeof b.id !== "string" || !b.id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  if (!b.prefs || typeof b.prefs !== "object") {
    return NextResponse.json({ error: "missing_prefs" }, { status: 400 });
  }
  try {
    const next = await updatePrefs(b.id, b.prefs);
    if (!next) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, prefs: next.prefs });
  } catch (e) {
    console.warn("[push/prefs] failed:", e);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
