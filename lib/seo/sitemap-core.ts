// Pure sitemap assembly. app/sitemap.ts gathers the inputs (registry,
// corridors, blog files, recent flight sessions) and hands them here, so
// the URL set and its lastModified rules are unit-tested without KV.

import type { MetadataRoute } from "next";
import { STATIC_ROUTES, absUrl } from "./site";

export const MAX_FLIGHT_URLS = 500;

export type SitemapSession = { tail: string; id: string; start_ts: number; end_ts: number };
export type BlogPost = { slug: string; lastModified: Date | null };

export type SitemapInput = {
  now: Date;
  /** When this deployment was built: lastModified for docs-style pages. */
  builtAt: Date;
  tails: readonly string[];
  corridorIds: readonly string[];
  wrapYears: readonly number[];
  /** null when content/blog does not exist on this deployment. */
  blog: readonly BlogPost[] | null;
  /** Flight sessions from the last 30 days, any order. */
  sessions: readonly SitemapSession[];
};

/** Live pages: their content is as fresh as the last flight we logged. */
const LIVE = new Set(["/", "/radar", "/flights", "/circling", "/board", "/road", "/stats", "/forecast", "/data"]);

export function buildSitemap(input: SitemapInput): MetadataRoute.Sitemap {
  const newestFlight = input.sessions.reduce((m, s) => Math.max(m, s.end_ts), 0);
  const liveStamp = newestFlight > 0 ? new Date(newestFlight) : input.now;
  const lastByTail = new Map<string, number>();
  for (const s of input.sessions) {
    lastByTail.set(s.tail, Math.max(lastByTail.get(s.tail) ?? 0, s.end_ts));
  }

  const out: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: absUrl(r.path),
    lastModified: LIVE.has(r.path) ? liveStamp : input.builtAt,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  for (const tail of input.tails) {
    const last = lastByTail.get(tail);
    out.push({
      url: absUrl(`/plane/${tail}`),
      lastModified: last ? new Date(last) : input.builtAt,
      changeFrequency: "daily",
      priority: 0.7,
    });
  }

  for (const id of input.corridorIds) {
    out.push({ url: absUrl(`/road/${id}`), lastModified: liveStamp, changeFrequency: "daily", priority: 0.7 });
  }

  const currentYear = Math.max(0, ...input.wrapYears);
  for (const y of input.wrapYears) {
    out.push({
      url: absUrl(`/wrap/${y}`),
      lastModified: y === currentYear ? liveStamp : new Date(Date.UTC(y + 1, 0, 1)),
      changeFrequency: y === currentYear ? "daily" : "yearly",
      priority: 0.5,
    });
  }

  if (input.blog && input.blog.length > 0) {
    const newest = input.blog.reduce<Date | null>(
      (m, p) => (p.lastModified && (!m || p.lastModified > m) ? p.lastModified : m),
      null,
    );
    out.push({ url: absUrl("/blog"), lastModified: newest ?? input.builtAt, changeFrequency: "weekly", priority: 0.6 });
    for (const p of input.blog) {
      out.push({
        url: absUrl(`/blog/${p.slug}`),
        lastModified: p.lastModified ?? input.builtAt,
        changeFrequency: "monthly",
        priority: 0.6,
      });
    }
  }

  const flights = [...input.sessions]
    .sort((a, b) => b.start_ts - a.start_ts)
    .slice(0, MAX_FLIGHT_URLS);
  const seen = new Set<string>();
  for (const s of flights) {
    const url = absUrl(`/flight/${s.tail}/${s.id}`);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, lastModified: new Date(s.end_ts), changeFrequency: "yearly", priority: 0.3 });
  }

  return out;
}

/** "my-post.md" → "my-post"; null for anything that is not a post file. */
export function blogSlug(filename: string): string | null {
  const m = /^([a-z0-9][a-z0-9-]*)\.mdx?$/i.exec(filename);
  if (!m || filename.startsWith("_")) return null;
  return m[1]!.toLowerCase();
}

/** The `date:` / `updated:` front-matter value of a Markdown post, if any. */
export function frontMatterDate(md: string): Date | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!fm) return null;
  const pick = (key: string) => new RegExp(`^${key}:\\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2}[^"'\\n]*)`, "m").exec(fm[1]!)?.[1];
  const raw = pick("updated") ?? pick("date");
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
