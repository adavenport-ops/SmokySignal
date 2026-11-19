// The Beacon, plain text. First line: up | down | stale. Then
// count=N, fetched_at=ISO, age_s=N. See docs/beacon.md.

import { beaconResponse } from "@/lib/beacon-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return beaconResponse(req, "txt");
}
