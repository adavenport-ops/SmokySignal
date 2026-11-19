// Atom 1.0 feed of the last 100 takeoffs and landings. Alert-class
// birds by default; ?all=1 for every tracked airframe. See docs/relay.md.

import { feedResponse } from "@/lib/feed-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return feedResponse(req, "atom");
}
