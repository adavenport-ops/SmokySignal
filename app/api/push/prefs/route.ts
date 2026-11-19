import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { updatePrefs } from "@/lib/push/store";
import { validatePrefsInput } from "@/lib/push/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// subscriptionId() in lib/push/store.ts: first 24 hex chars of a sha256.
const SUB_ID_RE = /^[0-9a-f]{24}$/;

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "push-prefs");
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
  const b = body as { id?: unknown; prefs?: unknown };
  if (typeof b.id !== "string" || !SUB_ID_RE.test(b.id)) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  if (!b.prefs || typeof b.prefs !== "object") {
    return NextResponse.json({ error: "missing_prefs" }, { status: 400 });
  }
  const prefs = validatePrefsInput(b.prefs);
  if (!prefs.ok) {
    return NextResponse.json({ error: prefs.error }, { status: 400 });
  }
  try {
    const next = await updatePrefs(b.id, prefs.prefs);
    if (!next) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, prefs: next.prefs });
  } catch (e) {
    console.warn("[push/prefs] failed:", e);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
}
