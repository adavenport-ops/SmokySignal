// GET /api/seen — "Was that the plane I saw?"
//
//   ?lat=47.19&lon=-122.29      required; rounded to 2 decimals (≈1 km) server-side too
//   &t=2026-11-17T22:30:00Z     required; ISO 8601 with a zone, rounded down to the minute
//   &window_min=30              optional; 15, 30 or 60 (default 30), the window is t ± this
//   &radius_nm=4.34             optional; 0.5..10 nm (default 4.34 = 5 mi)
//
// Returns every registry aircraft whose track inside the window came
// within the radius, closest approach first. Contract: lib/seen-view.ts
// (SeenBody). A non-canonical query (more decimals, seconds, defaults
// left out) gets a 308 to the rounded URL, so the CDN caches by rounded
// inputs only.
//
// Privacy: the point is used for this one read. It is not logged (errors
// log the error only), not cached in KV and not stored. Cache headers:
// private, no-store when the window reaches now; s-maxage 300 otherwise.

import { NextResponse } from "next/server";
import { hasKv } from "@/lib/cache";
import { enforceRateLimit } from "@/lib/rate-limit";
import { canonicalSeenSearch, parseSeenQuery, seenCacheControl } from "@/lib/seen-core";
import { loadSeen } from "@/lib/seen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseSeenQuery(url.searchParams, Date.now());
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, ...(parsed.detail ? { detail: parsed.detail } : {}) },
      { status: 400, headers: NO_STORE },
    );
  }
  const q = parsed.query;

  if (!parsed.canonical) {
    const target = new URL(url.pathname, url.origin);
    target.search = canonicalSeenSearch(q);
    return NextResponse.redirect(target, {
      status: 308,
      headers: { "Cache-Control": seenCacheControl(q.includesNow) },
    });
  }

  const limited = await enforceRateLimit(req, "seen");
  if (limited) return limited;

  if (q.status === "ok" && !hasKv()) {
    return NextResponse.json({ error: "kv_not_configured" }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await loadSeen(q);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 413, headers: NO_STORE });
    }
    return NextResponse.json(result.body, {
      headers: { "Cache-Control": seenCacheControl(q.includesNow) },
    });
  } catch (e) {
    // Never log the query: it carries the rider's (rounded) point.
    console.error("[api/seen] failed:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "seen_failed" }, { status: 500, headers: NO_STORE });
  }
}
