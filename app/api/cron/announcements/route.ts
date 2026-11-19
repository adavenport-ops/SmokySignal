// Sends due entries from content/announcements.json. Auth: Bearer
// CRON_SECRET (helm calls this once at the scheduled time and repeats
// while `remaining` > 0). Idempotent per announcement_id: the first call
// claims the id, later calls only resume an unfinished send, and a
// completed announcement is skipped.

import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getAnnounceState, runAnnouncement } from "@/lib/push/announce";
import { dueAnnouncements, loadScheduled, toSendRequest } from "@/lib/scheduled-announcements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (auth === "not_configured") {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  if (auth !== "ok") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const due = dueAnnouncements(loadScheduled(), Date.now());
  const results: Record<string, unknown>[] = [];
  for (const a of due) {
    const state = await getAnnounceState(a.announcement_id);
    if (state.record?.complete) {
      results.push({ id: a.announcement_id, skipped: "complete", sent_at: state.record.started_at });
      continue;
    }
    const r = await runAnnouncement(toSendRequest(a));
    results.push({ id: a.announcement_id, status: r.status, ...r.body });
    // One announcement per invocation keeps us inside maxDuration.
    break;
  }
  const remaining = results.reduce(
    (n, r) => n + (typeof r.remaining === "number" ? (r.remaining as number) : 0),
    0,
  );
  return NextResponse.json({ ok: true, due: due.length, remaining, results });
}
