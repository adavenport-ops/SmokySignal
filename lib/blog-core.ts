// Pure half of the blog (/blog, /blog/[slug], /blog/feed.xml). No fs, no
// clock: lib/blog.ts reads content/blog/*.md and hands the text in, so
// lib/blog-core.test.ts can pin parsing, ordering and the feed.
//
// A post is content/blog/YYYY-MM-DD-slug.md with a small frontmatter
// block. The frontmatter is a strict subset of YAML (no dependency):
//
//   ---
//   title: "SmokySignal, rebuilt: what's new"
//   date: 2026-11-19
//   summary: "One line for the index and the unfurl."
//   tags: [launch, radar, history]
//   kind: launch            # launch | weekly | note
//   hero_value: "66"        # optional hero stat
//   hero_label: "Smokey flights, last 7 days"
//   related: [/radar, /stats]  # optional; defaults by kind
//   ---

import type { AtomEntry } from "./feed-xml";

export const BLOG_KINDS = ["launch", "weekly", "note"] as const;
export type BlogKind = (typeof BLOG_KINDS)[number];

export const KIND_LABEL: Record<BlogKind, string> = {
  launch: "Launch",
  weekly: "Weekly",
  note: "Note",
};

export type BlogHero = { value: string; label: string };

export type BlogPost = {
  /** File name without .md, e.g. "2026-11-19-the-big-update". */
  slug: string;
  title: string;
  /** YYYY-MM-DD (Pacific publish date). */
  date: string;
  summary: string;
  tags: string[];
  kind: BlogKind;
  hero: BlogHero | null;
  /** In-app routes for the Related block. */
  related: string[];
  /** Markdown body, frontmatter stripped. */
  body: string;
  readingMinutes: number;
};

export const SLUG_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── frontmatter ─────────────────────────────────────────────────────

export type Frontmatter = Record<string, string | string[]>;

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  return t;
}

/** Split `[a, "b, c", d]` on top-level commas. */
function parseList(v: string): string[] {
  const inner = v.trim().slice(1, -1);
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map(unquote).filter((s) => s.length > 0);
}

/**
 * Parse a leading `---` block. Returns null data when the file has no
 * frontmatter. Lines are `key: value`; a value in brackets is a list;
 * `#` starts a comment outside quotes.
 */
export function parseFrontmatter(src: string): { data: Frontmatter; body: string } | null {
  const text = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const block = text.slice(4, end);
  const after = text.slice(end + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  const data: Frontmatter = {};
  for (const raw of block.split("\n")) {
    const line = stripComment(raw).trimEnd();
    if (!line.trim()) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    data[key] = value.startsWith("[") && value.endsWith("]") ? parseList(value) : unquote(value);
  }
  return { data, body: body.replace(/^\n+/, "") };
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

// ─── posts ───────────────────────────────────────────────────────────

const WORDS_PER_MINUTE = 220;

/** Minutes to read, from the words in the markdown (syntax stripped). */
export function readingMinutes(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/[#>*_`|[\]-]/g, " ");
  const words = text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Related routes per kind when a post does not name its own. */
export const DEFAULT_RELATED: Record<BlogKind, string[]> = {
  launch: ["/radar", "/flights", "/aircraft", "/help"],
  weekly: ["/stats", "/forecast", "/road", "/flights"],
  note: ["/radar", "/help"],
};

/** Labels for the in-app routes a Related block can point at. */
export const ROUTE_LABELS: Record<string, string> = {
  "/": "Home",
  "/radar": "Radar",
  "/flights": "Flights",
  "/settings/alerts": "Alerts",
  "/about": "More",
  "/aircraft": "All aircraft",
  "/program": "The program",
  "/help": "Help",
  "/stats": "Stats",
  "/forecast": "Forecast",
  "/road": "Road history",
  "/circling": "What's circling",
  "/seen": "Was that the plane I saw?",
  "/data": "Data and CSV",
  "/relay": "Discord and webhooks",
  "/embed/help": "Embed on your site",
  "/glance": "Handlebar mode",
  "/board": "Shop board",
  "/legal": "Privacy and terms",
};

export function routeLabel(href: string): string {
  if (ROUTE_LABELS[href]) return ROUTE_LABELS[href]!;
  const wrap = /^\/wrap\/(\d{4})$/.exec(href);
  if (wrap) return `Season wrap ${wrap[1]}`;
  const road = /^\/road\/([a-z0-9-]+)$/.exec(href);
  if (road) return `Road: ${road[1]!.toUpperCase()}`;
  const plane = /^\/plane\/([A-Z0-9]+)$/.exec(href);
  if (plane) return `Logbook: ${plane[1]}`;
  return href;
}

function asString(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : "";
}

function asList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export type ParseResult = { ok: true; post: BlogPost } | { ok: false; error: string };

/** One file into a post. Strict: a bad file is skipped with a reason, never half-rendered. */
export function parsePost(fileName: string, src: string): ParseResult {
  const slug = fileName.replace(/\.md$/, "");
  const sm = SLUG_RE.exec(slug);
  if (!sm) return { ok: false, error: `bad file name: ${fileName}` };
  const fm = parseFrontmatter(src);
  if (!fm) return { ok: false, error: `no frontmatter: ${fileName}` };
  const d = fm.data;
  const title = asString(d.title);
  const date = asString(d.date);
  const summary = asString(d.summary);
  const kind = asString(d.kind) as BlogKind;
  if (!title) return { ok: false, error: `missing title: ${fileName}` };
  if (!DATE_RE.test(date)) return { ok: false, error: `bad date: ${fileName}` };
  if (date !== sm[1]) return { ok: false, error: `date ${date} does not match file name: ${fileName}` };
  if (!BLOG_KINDS.includes(kind)) return { ok: false, error: `bad kind "${kind}": ${fileName}` };
  const heroValue = asString(d.hero_value);
  const heroLabel = asString(d.hero_label);
  const related = asList(d.related).filter((r) => r.startsWith("/") && !r.startsWith("//"));
  return {
    ok: true,
    post: {
      slug,
      title,
      date,
      summary,
      tags: asList(d.tags),
      kind,
      hero: heroValue && heroLabel ? { value: heroValue, label: heroLabel } : null,
      related: related.length > 0 ? related : DEFAULT_RELATED[kind],
      body: fm.body,
      readingMinutes: readingMinutes(fm.body),
    },
  };
}

/** Newest first; same-day posts by slug, descending, so the order is stable. */
export function sortPosts(posts: readonly BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) => (a.date === b.date ? b.slug.localeCompare(a.slug) : b.date.localeCompare(a.date)));
}

export function filterByKind(posts: readonly BlogPost[], kind: string | null | undefined): BlogPost[] {
  if (!kind || !BLOG_KINDS.includes(kind as BlogKind)) return [...posts];
  return posts.filter((p) => p.kind === kind);
}

/** `newer` / `older` neighbours in the newest-first list. */
export function neighbours(
  sorted: readonly BlogPost[],
  slug: string,
): { newer: BlogPost | null; older: BlogPost | null } {
  const i = sorted.findIndex((p) => p.slug === slug);
  if (i < 0) return { newer: null, older: null };
  return { newer: sorted[i - 1] ?? null, older: sorted[i + 1] ?? null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "19 Nov 2026". Dates are calendar dates, no clock, no zone math. */
export function formatPostDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Noon Pacific on the publish date, as ms. Stable regardless of server zone. */
export function postTimestamp(date: string): number {
  // 20:00 UTC is 12:00 PST / 13:00 PDT: always the same calendar day in PT.
  return Date.parse(`${date}T20:00:00Z`);
}

export function postUrl(siteUrl: string, slug: string): string {
  return `${siteUrl}/blog/${slug}`;
}

// ─── structured data and feed ────────────────────────────────────────

/** schema.org Article for one post. Site-wide schema lives elsewhere. */
export function articleJsonLd(post: BlogPost, siteUrl: string): Record<string, unknown> {
  const url = postUrl(siteUrl, post.slug);
  const published = new Date(postTimestamp(post.date)).toISOString();
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.summary,
    datePublished: published,
    dateModified: published,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: [`${url}/og`],
    keywords: post.tags.join(", "),
    articleSection: KIND_LABEL[post.kind],
    wordCount: post.body.split(/\s+/).filter(Boolean).length,
    author: { "@type": "Organization", name: "SmokySignal", url: siteUrl },
    publisher: {
      "@type": "Organization",
      name: "SmokySignal",
      url: siteUrl,
      logo: { "@type": "ImageObject", url: `${siteUrl}/icons/icon-512.png` },
    },
  };
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export function jsonLdScript(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function hostOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return "smokysignal.app";
  }
}

export const BLOG_FEED_LIMIT = 50;

export function blogAtomEntries(sorted: readonly BlogPost[], siteUrl: string): AtomEntry[] {
  const host = hostOf(siteUrl);
  return sorted.slice(0, BLOG_FEED_LIMIT).map((p) => ({
    id: `tag:${host},${p.date}:blog/${p.slug}`,
    title: p.title,
    link: postUrl(siteUrl, p.slug),
    ts: postTimestamp(p.date),
    type: p.kind,
    summary: p.summary || p.title,
  }));
}

