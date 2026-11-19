// /sitemap.xml: static pages, one page per tail and per corridor, the
// season wraps, blog posts when content/blog exists, and up to 500 flight
// share pages from the last 30 days. Regenerated hourly.
//
// Flights come from the same history pipeline as GET /api/history
// (lib/history.ts loadHistory), called in-process so the sitemap neither
// spends the route's per-IP rate limit nor depends on its own origin
// being reachable. A range too large for one read falls back to a
// shorter window; no KV means no flight URLs, never an error.

import fs from "node:fs/promises";
import path from "node:path";
import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { getRegistry } from "@/lib/registry";
import { CORRIDORS } from "@/lib/corridor";
import { hasKv } from "@/lib/cache";
import { loadHistory } from "@/lib/history";
import { parseHistoryQuery } from "@/lib/history-core";
import { formatTs } from "@/lib/time";
import { FIRST_WRAP_YEAR, currentWrapYear } from "@/lib/wrap";
import {
  blogSlug,
  buildSitemap,
  frontMatterDate,
  type BlogPost,
  type SitemapSession,
} from "@/lib/seo/sitemap-core";

export const revalidate = 3600;

const BUILT_AT = new Date();
const DAY_MS = 86_400_000;

async function recentSessions(): Promise<SitemapSession[]> {
  if (!hasKv()) return [];
  const now = Date.now();
  const to = formatTs(now, "date");
  for (const days of [30, 14, 7]) {
    const from = formatTs(now - (days - 1) * DAY_MS, "date");
    const parsed = parseHistoryQuery(new URLSearchParams({ from, to }), now);
    if (!parsed.ok) return [];
    try {
      const r = await loadHistory(parsed.query);
      if (!r.ok) continue;
      return r.body.sessions.map((s) => ({ tail: s.tail, id: s.id, start_ts: s.start_ts, end_ts: s.end_ts }));
    } catch (e) {
      console.warn("[sitemap] history read failed:", e);
      return [];
    }
  }
  return [];
}

const cachedSessions = unstable_cache(recentSessions, ["sitemap-sessions-v1"], { revalidate: 3600 });

async function blogPosts(): Promise<BlogPost[] | null> {
  const dir = path.join(process.cwd(), "content", "blog");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null; // no blog on this deployment yet
  }
  const posts: BlogPost[] = [];
  for (const name of names.sort()) {
    const slug = blogSlug(name);
    if (!slug) continue;
    try {
      const md = await fs.readFile(path.join(dir, name), "utf8");
      if (/^---\n[\s\S]*?^draft:\s*true\s*$[\s\S]*?\n---/m.test(md)) continue;
      posts.push({ slug, lastModified: frontMatterDate(md) });
    } catch {
      /* unreadable post: skip */
    }
  }
  return posts;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [fleet, sessions, blog] = await Promise.all([
    getRegistry(),
    cachedSessions().catch(() => [] as SitemapSession[]),
    blogPosts(),
  ]);
  const wrapYears: number[] = [];
  for (let y = FIRST_WRAP_YEAR; y <= currentWrapYear(now.getTime()); y++) wrapYears.push(y);
  return buildSitemap({
    now,
    builtAt: BUILT_AT,
    tails: fleet.map((f) => f.tail),
    corridorIds: CORRIDORS.map((c) => c.id),
    wrapYears,
    blog,
    sessions,
  });
}
