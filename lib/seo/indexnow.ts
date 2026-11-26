// IndexNow: tell Bing, Yandex, Seznam and Naver (and DuckDuckGo, which
// reads Bing) that a URL is new or changed, with no account anywhere.
//
// The key is public by design. The protocol proves we own the host by
// serving the same key at https://www.smokysignal.app/<key>.txt
// (public/<key>.txt); a test keeps the file and this constant in step.
// Rotating it means a new file and a new constant in one commit.
//
// Pure: payload building, URL filtering and the changed-file → URL map.
// The CLI (scripts/indexnow.ts) and the daily ping
// (lib/seo/indexnow-server.ts) do the I/O.

import { SITE_URL } from "./site";

export const INDEXNOW_KEY = "74864c72b65ddcc4a5f5631c3d17b7fd";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_HOST = new URL(SITE_URL).host;
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_KEY_LOCATION = `${SITE_URL}${INDEXNOW_KEY_PATH}`;
/** The protocol's cap on urlList per request. */
export const INDEXNOW_MAX_URLS = 10_000;

export type IndexNowPayload = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

/**
 * Path or URL → canonical absolute URL on our host, or null when it is
 * not ours. The apex (smokysignal.app) maps to www, query strings and
 * fragments are dropped (canonicals never carry them).
 */
export function canonicalUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.startsWith("/") ? `${SITE_URL}${raw}` : raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.host.toLowerCase();
  if (host !== INDEXNOW_HOST && host !== INDEXNOW_HOST.replace(/^www\./, "")) return null;
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${SITE_URL}${path === "/" ? "/" : path}`;
}

/** Canonical, de-duplicated, order kept. */
export function normalizeUrls(inputs: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of inputs) {
    const u = canonicalUrl(i);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** One payload per ≤ 10,000 URLs. Empty input → no payloads. */
export function buildIndexNowPayloads(urls: ReadonlyArray<string>, max = INDEXNOW_MAX_URLS): IndexNowPayload[] {
  const list = normalizeUrls(urls);
  const out: IndexNowPayload[] = [];
  for (let i = 0; i < list.length; i += max) {
    out.push({
      host: INDEXNOW_HOST,
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList: list.slice(i, i + max),
    });
  }
  return out;
}

/** <loc> values from a sitemap.xml body. */
export function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
}

/** 200 and 202 are the protocol's "received"; the rest are failures. */
export function indexNowAccepted(status: number): boolean {
  return status === 200 || status === 202;
}

// ─── changed files → URLs (`--since <ref>`) ──────────────────────────

/** Values that fill a dynamic segment, keyed by the route pattern. */
export type DynamicValues = {
  /** "/road/[id]" → corridor ids, "/near/[town]" → town slugs, "/plane/[tail]" → tails. */
  [routePattern: string]: ReadonlyArray<string>;
};

const BLOG_POST_RE = /^content\/blog\/(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.md$/;
const PAGE_RE = /^app\/(.+\/)?page\.(tsx|ts|jsx|js|mdx)$/;

/** "app/(tabs)/road/[id]/page.tsx" → "/road/[id]". Route groups drop out. */
export function routeForPageFile(file: string): string | null {
  const m = PAGE_RE.exec(file);
  if (!m) return null;
  const segs = (m[1] ?? "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^\(.*\)$/.test(s));
  // Private folders and parallel / intercepting routes are not pages.
  if (segs.some((s) => s.startsWith("_") || s.startsWith("@") || s.startsWith("("))) return null;
  return `/${segs.join("/")}`;
}

/** Paths that are never submitted: admin, settings, embed, internal tools. */
const EXCLUDED = [/^\/admin\b/, /^\/api\b/, /^\/settings\b/, /^\/relay\/manage\b/, /^\/embed(?!\/help)\b/, /^\/qa-dashboard\b/, /^\/offline\b/, /^\/glance\b/];

function excluded(path: string): boolean {
  return EXCLUDED.some((re) => re.test(path));
}

/**
 * Changed repo files → page paths worth resubmitting. Blog posts map to
 * their post and the index; a page file maps to its route, with dynamic
 * segments expanded from `dynamic` (a pattern with no values is
 * skipped); content/help.md maps to /help and content/help-iphone.md to
 * /help/iphone. Everything else (libraries,
 * components, styles) is ignored: it changes too many pages to say
 * which, and the weekly `--all` run covers it.
 */
export function urlsForChangedFiles(files: ReadonlyArray<string>, dynamic: DynamicValues = {}): string[] {
  const paths: string[] = [];
  for (const raw of files) {
    const f = raw.trim().replace(/\\/g, "/");
    if (!f) continue;
    const blog = BLOG_POST_RE.exec(f);
    if (blog) {
      // The slug is the whole file stem, date included (lib/blog-core.ts).
      paths.push(`/blog/${blog[1]}-${blog[2]}`, "/blog");
      continue;
    }
    if (f === "content/help.md") {
      paths.push("/help");
      continue;
    }
    if (f === "content/help-iphone.md") {
      paths.push("/help/iphone");
      continue;
    }
    const route = routeForPageFile(f);
    if (!route || excluded(route)) continue;
    if (!route.includes("[")) {
      paths.push(route);
      continue;
    }
    const values = dynamic[route];
    // Only single-segment dynamic routes expand; flights are pinged by the cron.
    if (!values || (route.match(/\[/g) ?? []).length !== 1) continue;
    for (const v of values) paths.push(route.replace(/\[[^\]]+\]/, encodeURIComponent(v)));
  }
  return normalizeUrls(paths);
}
