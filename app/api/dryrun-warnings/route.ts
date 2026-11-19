// N1a: collected speed-warning DRY-RUN candidates from real rider
// sessions. Retired by N1b: the rider-facing warning is computed entirely
// on the device (lib/speed-warning.ts, components/SpeedWarning.tsx) and
// the client no longer sends anything about speed or position, not even
// the coarse buckets the v2 record carried (lib/dryrun-payload.ts).
//
// POST answers 410 and stores nothing, so an old client still running the
// N1a bundle fails cleanly. GET stays as the health probe verify-prod
// uses. Rows already stored age out on their 7-day TTL; the admin viewer
// (app/admin/dryrun-warnings) still reads them until then.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "retired", detail: "speed warning runs on the device" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

export async function GET() {
  // Health probe used by verify-prod.
  return NextResponse.json({ ok: true, endpoint: "dryrun-warnings" });
}
