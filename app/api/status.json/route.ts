// The Beacon, JSON: {state, count, fetched_at, age_s}. See docs/beacon.md.

import { beaconResponse } from "@/lib/beacon-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return beaconResponse(req, "json");
}
