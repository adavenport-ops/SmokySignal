// GET /api/history — permanent flight history for a Pacific date range.
//
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   required, Pacific dates, ≤ 366 days, to ≤ today
//   &tail=N305DK&tail=N2446X         optional, repeatable (or comma list), ≤ 32
//   &mission=speed                   optional; registry role / alias, ignored when unknown
//
// Returns flight sessions, Douglas–Peucker-simplified polylines (≤ 20k
// vertices total), a heat grid on the hot-zone cell scheme, and summary
// stats. Contract: lib/history-core.ts (HistoryBody).
//
// Cache: s-maxage 300 for ranges that end before today, 30 when the range
// includes today. Rate-limited per IP on cache misses.

import { NextResponse } from "next/server";
import { hasKv } from "@/lib/cache";
import { enforceRateLimit } from "@/lib/rate-limit";
import { historyCacheControl, parseHistoryQuery } from "@/lib/history-core";
import { loadHistory } from "@/lib/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseHistoryQuery(url.searchParams, Date.now());
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, ...(parsed.detail ? { detail: parsed.detail } : {}) },
      { status: 400, headers: NO_STORE },
    );
  }

  const limited = await enforceRateLimit(req, "history");
  if (limited) return limited;

  if (!hasKv()) {
    return NextResponse.json({ error: "kv_not_configured" }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await loadHistory(parsed.query);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          points: result.points,
          budget: result.budget,
          detail: "Narrow the range or name fewer tails.",
        },
        { status: 413, headers: NO_STORE },
      );
    }
    return NextResponse.json(result.body, {
      headers: { "Cache-Control": historyCacheControl(parsed.query.includesToday) },
    });
  } catch (e) {
    console.error("[api/history] failed:", e);
    return NextResponse.json({ error: "history_failed" }, { status: 500, headers: NO_STORE });
  }
}
