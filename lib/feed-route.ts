// Shared GET handler for /feed.xml (Atom) and /rss.xml (RSS 2.0).
// Server-only: reads the activity list and registry, then hands off to
// the pure builders in lib/feed-xml.ts.

import { getRecentActivity } from "./activity";
import { BASE_URL } from "./config";
import { buildAtom, buildRss, feedItemsFromActivity } from "./feed-xml";
import { getRegistry } from "./registry";

// The activity list holds up to 500 rows; read it all so 100 takeoffs and
// landings survive the filter even on a squawk-heavy day.
const READ_LIMIT = 500;

export async function feedResponse(req: Request, variant: "atom" | "rss"): Promise<Response> {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const [entries, registry] = await Promise.all([
    getRecentActivity(READ_LIMIT).catch(() => []),
    getRegistry().catch(() => []),
  ]);
  const nick = new Map(registry.map((f) => [f.tail, f.nickname]));
  const scope = new Map(registry.map((f) => [f.tail, f.scope]));
  const items = feedItemsFromActivity(entries, {
    siteUrl: BASE_URL,
    all,
    nicknameOf: (t) => nick.get(t) ?? null,
    scopeOf: (t) => scope.get(t),
  });
  const path = variant === "atom" ? "/feed.xml" : "/rss.xml";
  const meta = {
    siteUrl: BASE_URL,
    selfUrl: `${BASE_URL}${path}${all ? "?all=1" : ""}`,
    title: all ? "SmokySignal · Every bird" : "SmokySignal · Smokey up and down",
    subtitle: all
      ? "Takeoffs and landings for every tracked airframe: Smokey, federal, rescue, fire, medevac, survey, transport."
      : "Takeoffs and landings for Smokey over Washington: WSP, county sheriffs, and neighbors on mutual aid.",
    nowMs: Date.now(),
  };
  const body = variant === "atom" ? buildAtom(items, meta) : buildRss(items, meta);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        variant === "atom"
          ? "application/atom+xml; charset=utf-8"
          : "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
