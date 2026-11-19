// Admin-only one-off announcement to every rider with alerts on.
//
//   GET  ?id=...   -> { exists, sent_at, sent_total, complete }
//   POST {title, body, url, announcement_id, dry_run?, resume?,
//         ignore_quiet_hours?}
//
// dry_run sends nothing. A real send is idempotent per announcement_id
// (SET NX push:announce:{id}); a second send returns 409 already_sent.
// If one invocation cannot reach every rider inside its deadline the
// response says remaining > 0; call again with resume: true to finish.
// See lib/push/announce.ts.

import webpush from "web-push";
import { NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/admin-auth";
import {
  ANNOUNCE_ID_RE,
  getAnnounceState,
  runAnnouncement,
  validateRequest,
} from "@/lib/push/announce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function ensureVapidConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) return false;
  webpush.setVapidDetails(subj, pub, priv);
  return true;
}

export async function GET(req: Request) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ANNOUNCE_ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const { exists, record } = await getAnnounceState(id);
  return NextResponse.json({
    exists,
    sent_at: record?.started_at ?? null,
    sent_total: record?.sent_total ?? 0,
    complete: record?.complete ?? false,
  });
}

export async function POST(req: Request) {
  if (!isAdminAuthed()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const v = validateRequest(raw);
  if (!v.ok) {
    return NextResponse.json({ error: "invalid", errors: v.errors }, { status: 400 });
  }
  if (!v.value.dry_run && !ensureVapidConfigured()) {
    return NextResponse.json({ error: "vapid_not_configured" }, { status: 500 });
  }
  const r = await runAnnouncement(v.value);
  return NextResponse.json(r.body, { status: r.status });
}
