// N1a: collect speed-warning DRY-RUN candidates from real rider sessions.
// No UI yet — this just logs evaluateWarning() positives so we can tune
// the threshold before showing anything to riders.
//
// Storage: dryrun-warnings:{YYYYMMDD} as a Redis list, 7-day TTL.
// Each entry is a compact JSON record. Keep payloads small — riders log
// continuously while the dash is open.

import { NextResponse } from "next/server";
import { getRedis } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_SECONDS = 7 * 24 * 60 * 60;
const NOW_TOLERANCE_MS = 5 * 60 * 1000;

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

type DryRunRecord = {
  ts: number;
  riderLat: number;
  riderLon: number;
  riderSpeedMph: number;
  postedLimitMph: number;
  riderOverLimitBy: number;
  nearestZoneMi: number | null;
  nearestBirdMi: number | null;
  nearestTail: string | null;
  reason: string;
};

function parseBody(raw: unknown): DryRunRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    !isFiniteNum(r.ts) ||
    !isFiniteNum(r.riderLat) ||
    !isFiniteNum(r.riderLon) ||
    !isFiniteNum(r.riderSpeedMph) ||
    !isFiniteNum(r.postedLimitMph) ||
    !isFiniteNum(r.riderOverLimitBy)
  ) {
    return null;
  }
  if (Math.abs(Date.now() - r.ts) > NOW_TOLERANCE_MS) return null;
  if (r.riderLat < -90 || r.riderLat > 90) return null;
  if (r.riderLon < -180 || r.riderLon > 180) return null;
  return {
    ts: r.ts,
    riderLat: r.riderLat,
    riderLon: r.riderLon,
    riderSpeedMph: r.riderSpeedMph,
    postedLimitMph: r.postedLimitMph,
    riderOverLimitBy: r.riderOverLimitBy,
    nearestZoneMi:
      r.nearestZoneMi == null
        ? null
        : isFiniteNum(r.nearestZoneMi)
          ? r.nearestZoneMi
          : null,
    nearestBirdMi:
      r.nearestBirdMi == null
        ? null
        : isFiniteNum(r.nearestBirdMi)
          ? r.nearestBirdMi
          : null,
    nearestTail:
      typeof r.nearestTail === "string" ? r.nearestTail.toUpperCase() : null,
    reason: typeof r.reason === "string" ? r.reason.slice(0, 200) : "",
  };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const rec = parseBody(raw);
  if (!rec) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const redis = await getRedis();
  if (!redis) {
    // KV not configured (dev) — accept and drop.
    return NextResponse.json({ ok: true, dropped: true });
  }
  const key = `dryrun-warnings:${utcDateKey(new Date(rec.ts))}`;
  try {
    await redis.rpush(key, JSON.stringify(rec));
    await redis.expire(key, TTL_SECONDS);
  } catch (e) {
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
