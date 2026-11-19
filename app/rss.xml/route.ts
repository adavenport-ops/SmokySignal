// RSS 2.0 twin of /feed.xml, for readers and bots that only speak RSS.

import { feedResponse } from "@/lib/feed-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return feedResponse(req, "rss");
}
