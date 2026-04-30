import { NextResponse } from "next/server";
import { saveSpot, type SpotAirborneTail, type SpotPayload } from "@/lib/spots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOW_TOLERANCE_MS = 10 * 60 * 1000; // accept ts within 10 min of now

function isFiniteNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function inLatRange(n: number): boolean {
  return n >= -90 && n <= 90;
}
function inLonRange(n: number): boolean {
  return n >= -180 && n <= 180;
}

function parseAirborneTail(raw: unknown): SpotAirborneTail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const tail = typeof r.tail === "string" ? r.tail.toUpperCase() : null;
  if (!tail) return null;
  const lat = isFiniteNum(r.lat) && inLatRange(r.lat) ? r.lat : null;
  const lon = isFiniteNum(r.lon) && inLonRange(r.lon) ? r.lon : null;
  const distance_nm = isFiniteNum(r.distance_nm) ? r.distance_nm : null;
  return { tail, lat, lon, distance_nm };
}

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
  const b = body as Record<string, unknown>;

  if (!isFiniteNum(b.lat) || !inLatRange(b.lat)) {
    return NextResponse.json({ error: "invalid_lat" }, { status: 400 });
  }
  if (!isFiniteNum(b.lon) || !inLonRange(b.lon)) {
    return NextResponse.json({ error: "invalid_lon" }, { status: 400 });
  }
  if (!isFiniteNum(b.ts)) {
    return NextResponse.json({ error: "invalid_ts" }, { status: 400 });
  }
  const tsDelta = Math.abs(Date.now() - b.ts);
  if (tsDelta > NOW_TOLERANCE_MS) {
    return NextResponse.json({ error: "stale_ts" }, { status: 400 });
  }

  const airborneRaw = Array.isArray(b.airborne_tails) ? b.airborne_tails : [];
  const airborne_tails = airborneRaw
    .map(parseAirborneTail)
    .filter((t): t is SpotAirborneTail => t !== null);

  const payload: SpotPayload = {
    lat: b.lat,
    lon: b.lon,
    ts: b.ts,
    airborne_tails,
  };

  try {
    const stored = await saveSpot(payload);
    return NextResponse.json({ ok: true, id: stored.id });
  } catch (e) {
    console.warn("[spot] save failed:", e);
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
