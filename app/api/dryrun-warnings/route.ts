// N1a: collect speed-warning DRY-RUN candidates from real rider sessions.
// No UI yet — this just logs evaluateWarning() positives so we can tune
// the threshold before showing anything to riders.
//
// Storage: dryrun-warnings:{YYYYMMDD} as a Redis list, 7-day TTL.
// Each entry is a privacy-reduced v2 record (lib/dryrun-payload.ts):
// bucketed over-limit, hot-zone cell id, tail, 0.5 nm distance bucket,
// fixed reason code. No rider speed, no rider lat/lon. Any extra field a
// client sends is dropped by parseDryRunBody().

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/cache";
import { parseDryRunBody } from "@/lib/dryrun-payload";
import { readJsonBody } from "@/lib/input-validation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { dryrunWarningsKey } from "@/lib/storage-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_SECONDS = 7 * 24 * 60 * 60;

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "dryrun-warnings");
  if (limited) return limited;

  const body = await readJsonBody(req);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, error: body.error },
      { status: body.status },
    );
  }
  const rec = parseDryRunBody(body.body);
  if (!rec) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const redis = await getRedis();
  if (!redis) {
    // KV not configured (dev) — accept and drop.
    return NextResponse.json({ ok: true, dropped: true });
  }
  const key = dryrunWarningsKey(utcDateKey(new Date(rec.ts)));
  try {
    await redis.rpush(key, JSON.stringify(rec));
    await redis.expire(key, TTL_SECONDS);
  } catch {
    return NextResponse.json(
      { ok: false, error: "store failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  // Health probe used by verify-prod.
  return NextResponse.json({ ok: true, endpoint: "dryrun-warnings" });
}
