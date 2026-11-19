// Vercel cron — writes the permanent daily rollup (lib/rollup.ts).
// Builds yesterday (UTC) and backfills any day still inside the 35-day
// tracks window that is missing from rollup:index. Idempotent: a re-run
// overwrites the same keys with the same content.
// Schedule: 09:15 UTC daily (01:15 PST / 02:15 PDT), well after the
// UTC day it summarizes has closed. Auth: Bearer CRON_SECRET.

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { hasKv } from "@/lib/cache";
import { runRollup } from "@/lib/rollup";
import { persistTrackHistory } from "@/lib/tracks";
import { backfillActivityArchive } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Leave headroom under maxDuration for the in-flight days to finish.
const BUDGET_MS = 45_000;

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/**
 * Constant-time Bearer check. Both sides are hashed to fixed-length
 * digests so neither the compare nor a length mismatch leaks timing.
 * Fails closed when CRON_SECRET is unset or empty.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (typeof header !== "string") return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasKv()) {
    return NextResponse.json({ error: "kv_not_configured" }, { status: 500 });
  }

  const started = Date.now();
  try {
    const { built, remaining } = await runRollup({
      nowMs: started,
      deadlineMs: started + BUDGET_MS,
    });
    // Strip the legacy 35-day TTL from older track days. Best-effort.
    let persisted = 0;
    try {
      persisted = await persistTrackHistory();
    } catch (e) {
      console.warn("[cron/rollup] persistTrackHistory failed:", e);
    }
    // Copy anything still in the capped activity:feed into the permanent
    // per-day archive. Idempotent and best-effort.
    let activity: { copied: number; days: number } | null = null;
    try {
      activity = await backfillActivityArchive();
    } catch (e) {
      console.warn("[cron/rollup] backfillActivityArchive failed:", e);
    }
    return NextResponse.json({
      ok: true,
      persisted,
      activity_archived: activity,
      built,
      remaining,
      elapsed_ms: Date.now() - started,
    });
  } catch (e) {
    console.error("[cron/rollup] failed:", e);
    return NextResponse.json({ error: "rollup_failed" }, { status: 500 });
  }
}
