// Atom 1.0 feed of blog posts (/blog/feed.xml), newest first. Built from
// the committed markdown in content/blog with the shared builder in
// lib/feed-xml.ts. Static: posts change only on a deploy.

import { BASE_URL } from "@/lib/config";
import { blogAtomEntries } from "@/lib/blog-core";
import { getAllPosts } from "@/lib/blog";
import { buildAtom } from "@/lib/feed-xml";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  const body = buildAtom(blogAtomEntries(getAllPosts(), BASE_URL), {
    siteUrl: BASE_URL,
    selfUrl: `${BASE_URL}/blog/feed.xml`,
    alternateUrl: `${BASE_URL}/blog`,
    title: "SmokySignal · Blog",
    subtitle: "What shipped, and a weekly log of when the bird flew.",
    nowMs: Date.parse("2026-11-19T20:00:00Z"),
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
