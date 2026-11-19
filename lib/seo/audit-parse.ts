// Pure HTML / XML parsers and the per-page checks behind
// scripts/seo-audit.ts. Regex-based on purpose: the audit reads our own
// server-rendered markup (React's output is regular), runs without a DOM
// dependency, and the tests pin each parser down.

import { parseAndValidateJsonLd } from "./jsonld";

export type PageFacts = {
  title: string | null;
  titleCount: number;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number;
  h1Texts: string[];
  ogImage: string | null;
  ogTitle: string | null;
  twitterCard: string | null;
  jsonLd: Array<{ types: string[]; errors: string[] }>;
  wordCount: number;
  links: string[];
  imagesMissingAlt: number;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  middot: "·",
  rarr: "→",
  larr: "←",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Attribute value from one tag's source, e.g. attr('<a href="/x">', "href"). */
export function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

function tags(html: string, name: string): string[] {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
}

function metaContent(head: string, key: "name" | "property", value: string): string | null {
  for (const t of tags(head, "meta")) {
    if ((attr(t, key) ?? "").toLowerCase() === value.toLowerCase()) return attr(t, "content");
  }
  return null;
}

/** Visible text: scripts, styles, templates and tags removed, entities decoded. */
export function visibleText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return decodeEntities(
    body
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’.,:-]*/g) ?? []).length;
}

export function parsePage(html: string): PageFacts {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html;
  const titles = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => decodeEntities(m[1]!.trim()));
  let canonical: string | null = null;
  for (const t of tags(head, "link")) {
    if ((attr(t, "rel") ?? "").toLowerCase() === "canonical") canonical = attr(t, "href");
  }
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => visibleText(m[1]!));
  const jsonLd = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => parseAndValidateJsonLd(m[1]!),
  );
  const links = tags(html, "a")
    .map((t) => attr(t, "href"))
    .filter((h): h is string => !!h);
  const imgs = tags(html, "img");
  const imagesMissingAlt = imgs.filter((t) => attr(t, "alt") === null).length;
  return {
    title: titles[0] ?? null,
    titleCount: titles.length,
    description: metaContent(head, "name", "description"),
    canonical,
    robots: metaContent(head, "name", "robots"),
    h1Count: h1s.length,
    h1Texts: h1s,
    ogImage: metaContent(head, "property", "og:image"),
    ogTitle: metaContent(head, "property", "og:title"),
    twitterCard: metaContent(head, "name", "twitter:card"),
    jsonLd,
    wordCount: wordCount(visibleText(html)),
    links,
    imagesMissingAlt,
  };
}

/** <loc> values from a sitemap or sitemap index. */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]!));
}

export type RobotsGroup = { agents: string[]; allow: string[]; disallow: string[] };
export type RobotsTxt = { groups: RobotsGroup[]; sitemaps: string[] };

export function parseRobots(txt: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val);
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(val);
    else if (cur && key === "allow") cur.allow.push(val);
    else if (cur && key === "disallow") cur.disallow.push(val);
  }
  return { groups, sitemaps };
}

/** Google-style longest-match: is `path` crawlable for `agent`? */
export function robotsAllows(r: RobotsTxt, agent: string, path: string): boolean {
  const a = agent.toLowerCase();
  const group =
    r.groups.find((g) => g.agents.some((x) => x.toLowerCase() === a)) ??
    r.groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  const match = (rule: string) => {
    if (!rule) return -1;
    const anchored = rule.endsWith("$");
    const body = anchored ? rule.slice(0, -1) : rule;
    const re = new RegExp(`^${body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
    return re.test(path) ? rule.length : -1;
  };
  const allow = Math.max(-1, ...group.allow.map(match));
  const disallow = Math.max(-1, ...group.disallow.map(match));
  return allow >= disallow;
}

// ─── per-page checks ────────────────────────────────────────────────

export type Severity = "P0" | "P1" | "P2";
export type Issue = { severity: Severity; code: string; detail: string };

export const TITLE_MIN = 15;
export const TITLE_MAX = 65;
export const DESC_MIN = 70;
export const DESC_MAX = 165;
export const THIN_WORDS = 120;

export function isNoindex(robots: string | null): boolean {
  return /\bnoindex\b/i.test(robots ?? "");
}

/**
 * Issues for one crawled page. `path` is the URL path the sitemap listed;
 * `expectIndexable` is true for sitemap URLs (they should all be indexable).
 */
export function pageIssues(path: string, status: number, f: PageFacts | null, expectIndexable = true): Issue[] {
  const out: Issue[] = [];
  if (status !== 200) {
    out.push({ severity: "P0", code: "status", detail: `HTTP ${status}` });
    return out;
  }
  if (!f) return out;
  const noindex = isNoindex(f.robots);
  if (expectIndexable && noindex) out.push({ severity: "P0", code: "noindex-in-sitemap", detail: f.robots ?? "" });
  if (!f.title) out.push({ severity: "P0", code: "title-missing", detail: "" });
  else {
    if (f.title.length > TITLE_MAX) out.push({ severity: "P1", code: "title-long", detail: `${f.title.length} chars` });
    if (f.title.length < TITLE_MIN) out.push({ severity: "P1", code: "title-short", detail: `${f.title.length} chars` });
    // Brand both as the page's own prefix and as the template suffix
    // (a post titled "SmokySignal, rebuilt…" is fine).
    if (/^SmokySignal\s*·.*·\s*SmokySignal$|·\s*SmokySignal\s*·\s*SmokySignal$/.test(f.title)) out.push({ severity: "P1", code: "title-double-brand", detail: f.title });
  }
  if (f.titleCount > 1) out.push({ severity: "P1", code: "title-multiple", detail: `${f.titleCount} <title> tags` });
  if (!f.description) out.push({ severity: "P0", code: "description-missing", detail: "" });
  else {
    if (f.description.length > DESC_MAX) out.push({ severity: "P2", code: "description-long", detail: `${f.description.length} chars` });
    if (f.description.length < DESC_MIN) out.push({ severity: "P2", code: "description-short", detail: `${f.description.length} chars` });
  }
  if (!f.canonical) out.push({ severity: "P0", code: "canonical-missing", detail: "" });
  else {
    let canonPath = f.canonical;
    try {
      canonPath = new URL(f.canonical).pathname;
    } catch {
      /* relative */
    }
    if (expectIndexable && canonPath.replace(/\/$/, "") !== path.replace(/\/$/, "")) {
      out.push({ severity: "P1", code: "canonical-mismatch", detail: `${f.canonical} for ${path}` });
    }
  }
  if (f.h1Count === 0) out.push({ severity: "P1", code: "h1-missing", detail: "" });
  if (f.h1Count > 1) out.push({ severity: "P1", code: "h1-multiple", detail: f.h1Texts.join(" | ").slice(0, 120) });
  if (!f.ogImage) out.push({ severity: "P1", code: "og-image-missing", detail: "" });
  if (!f.twitterCard) out.push({ severity: "P2", code: "twitter-card-missing", detail: "" });
  for (const [i, b] of f.jsonLd.entries()) {
    for (const e of b.errors) out.push({ severity: "P0", code: "jsonld-invalid", detail: `block ${i}: ${e}` });
  }
  if (f.wordCount < THIN_WORDS) out.push({ severity: "P2", code: "thin", detail: `${f.wordCount} words` });
  if (f.imagesMissingAlt > 0) out.push({ severity: "P1", code: "img-alt-missing", detail: `${f.imagesMissingAlt} images` });
  return out;
}

/** Internal links of a page, resolved to path (+query) on `origin`. */
export function internalLinks(links: readonly string[], pageUrl: string, origins: readonly string[]): string[] {
  const out = new Set<string>();
  for (const href of links) {
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!origins.includes(u.origin)) continue;
    out.add(u.pathname + u.search);
  }
  return [...out];
}

/** Titles (or descriptions) shared by more than one URL. */
export function duplicates(byUrl: ReadonlyMap<string, string | null>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [url, v] of byUrl) {
    if (!v) continue;
    groups.set(v, [...(groups.get(v) ?? []), url]);
  }
  return new Map([...groups].filter(([, urls]) => urls.length > 1));
}
