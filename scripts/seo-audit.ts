// Weekly SEO / GEO audit. Read-only: GET and HEAD requests only.
//
//   npm run seo:audit -- [--base https://www.smokysignal.app] [--label prod]
//                        [--max-flights 25] [--max-links 400] [--out docs/seo]
//
// Crawls the sitemap (falling back to the static route list when there is
// no sitemap yet), checks robots.txt / sitemap.xml / llms.txt, and reports
// per page: status, title and description length, duplicates, canonical,
// h1 count, JSON-LD validity, og:image status, word count, noindex flags
// and broken internal links. Writes docs/seo/report-YYYY-MM-DD[-label].md
// plus a .json twin. Exits 1 when any P0 issue is found.
//
// Parsers and checks: lib/seo/audit-parse.ts (unit-tested). What the
// weekly job should do with the report: docs/seo/PLAYBOOK.md.

import fs from "node:fs/promises";
import path from "node:path";
import {
  duplicates,
  internalLinks,
  isNoindex,
  pageIssues,
  parsePage,
  parseRobots,
  parseSitemap,
  robotsAllows,
  type Issue,
  type PageFacts,
} from "../lib/seo/audit-parse";
import { AI_CRAWLERS, SITE_URL, STATIC_ROUTES } from "../lib/seo/site";

type Args = { base: string; label: string | null; maxFlights: number; maxLinks: number; out: string; concurrency: number };

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = (get("base") ?? SITE_URL).replace(/\/$/, "");
  return {
    base,
    label: get("label") ?? null,
    maxFlights: Number(get("max-flights") ?? 25),
    maxLinks: Number(get("max-links") ?? 400),
    out: get("out") ?? "docs/seo",
    concurrency: Number(get("concurrency") ?? 4),
  };
}

const UA = "SmokySignal-SEO-Audit/1.0 (read-only)";

type Fetched = { status: number; type: string; body: string; finalUrl: string };

async function get(url: string, method: "GET" | "HEAD" = "GET"): Promise<Fetched> {
  try {
    const res = await fetch(url, { method, headers: { "User-Agent": UA }, redirect: "follow" });
    const body = method === "GET" ? await res.text() : "";
    return { status: res.status, type: res.headers.get("content-type") ?? "", body, finalUrl: res.url };
  } catch (e) {
    return { status: 0, type: "", body: String(e), finalUrl: url };
  }
}

async function pool<T, R>(items: readonly T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Sitemap URLs point at production; crawl them on --base instead. */
function onBase(url: string, base: string): string {
  try {
    const u = new URL(url);
    return `${base}${u.pathname}${u.search}`;
  } catch {
    return `${base}${url.startsWith("/") ? url : `/${url}`}`;
  }
}

type PageReport = {
  path: string;
  status: number;
  title: string | null;
  titleLength: number;
  description: string | null;
  descriptionLength: number;
  canonical: string | null;
  h1Count: number;
  jsonLdTypes: string[];
  jsonLdValid: boolean;
  ogImage: string | null;
  ogImageStatus: number | null;
  wordCount: number;
  noindex: boolean;
  issues: Issue[];
};

type SiteCheck = { name: string; ok: boolean; severity: "P0" | "P1"; detail: string };

function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Los_Angeles" });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base;
  const started = Date.now();
  console.error(`seo-audit: ${base}`);

  // ── site files ──
  const [robotsRes, sitemapRes, llmsRes, llmsFullRes] = await Promise.all([
    get(`${base}/robots.txt`),
    get(`${base}/sitemap.xml`),
    get(`${base}/llms.txt`),
    get(`${base}/llms-full.txt`),
  ]);
  const site: SiteCheck[] = [];
  const robots = robotsRes.status === 200 ? parseRobots(robotsRes.body) : null;
  site.push({ name: "robots.txt", ok: robotsRes.status === 200, severity: "P0", detail: `HTTP ${robotsRes.status}` });
  if (robots) {
    site.push({
      name: "robots.txt references the sitemap",
      ok: robots.sitemaps.some((s) => s.endsWith("/sitemap.xml")),
      severity: "P0",
      detail: robots.sitemaps.join(", ") || "no Sitemap line",
    });
    site.push({
      name: "robots.txt disallows /admin",
      ok: !robotsAllows(robots, "Googlebot", "/admin"),
      severity: "P0",
      detail: "",
    });
    const blockedAi = AI_CRAWLERS.filter((a) => !robotsAllows(robots, a, "/program"));
    site.push({
      name: "AI crawlers allowed",
      ok: blockedAi.length === 0,
      severity: "P1",
      detail: blockedAi.length ? `blocked: ${blockedAi.join(", ")}` : AI_CRAWLERS.join(", "),
    });
    site.push({ name: "/ crawlable", ok: robotsAllows(robots, "Googlebot", "/"), severity: "P0", detail: "" });
  }
  const sitemapUrls = sitemapRes.status === 200 ? parseSitemap(sitemapRes.body) : [];
  site.push({
    name: "sitemap.xml",
    ok: sitemapRes.status === 200 && sitemapUrls.length > 0,
    severity: "P0",
    detail: `HTTP ${sitemapRes.status}, ${sitemapUrls.length} URLs`,
  });
  site.push({
    name: "llms.txt",
    ok: llmsRes.status === 200 && /^# /m.test(llmsRes.body),
    severity: "P0",
    detail: `HTTP ${llmsRes.status}, ${llmsRes.body.length} bytes`,
  });
  site.push({
    name: "llms-full.txt",
    ok: llmsFullRes.status === 200 && llmsFullRes.body.includes("N305DK"),
    severity: "P1",
    detail: `HTTP ${llmsFullRes.status}, ${llmsFullRes.body.length} bytes`,
  });
  const notFound = await get(`${base}/this-page-does-not-exist-${Date.now()}`);
  site.push({ name: "unknown URL returns 404", ok: notFound.status === 404, severity: "P0", detail: `HTTP ${notFound.status}` });
  const badTail = await get(`${base}/plane/NOTATAIL`);
  site.push({ name: "unknown tail returns 404", ok: badTail.status === 404, severity: "P0", detail: `HTTP ${badTail.status}` });

  // ── page list ──
  let paths: string[];
  if (sitemapUrls.length > 0) {
    const all = sitemapUrls.map((u) => new URL(onBase(u, base)).pathname);
    const flights = all.filter((p) => p.startsWith("/flight/"));
    paths = [...all.filter((p) => !p.startsWith("/flight/")), ...flights.slice(0, args.maxFlights)];
    if (flights.length > args.maxFlights) console.error(`seo-audit: sampling ${args.maxFlights} of ${flights.length} flight pages`);
  } else {
    // Before a sitemap exists: the static routes plus a sample of dynamic ones.
    paths = [...STATIC_ROUTES.map((r) => r.path), "/plane/N305DK", "/plane/N422CT", "/road/i-5", "/road/sr-512"];
  }
  paths = [...new Set(paths)];
  for (const must of ["/plane/N305DK", "/road/i-5"]) {
    if (sitemapUrls.length > 0) {
      site.push({
        name: `sitemap lists ${must}`,
        ok: sitemapUrls.some((u) => u.endsWith(must)),
        severity: "P0",
        detail: "",
      });
    }
  }

  // ── crawl ──
  const ogCache = new Map<string, Promise<number>>();
  const ogStatus = (url: string) => {
    const local = onBase(url, base);
    if (!ogCache.has(local)) {
      ogCache.set(
        local,
        get(local, "GET").then((r) => (r.status === 200 && /^image\//.test(r.type) ? 200 : r.status || 0)),
      );
    }
    return ogCache.get(local)!;
  };
  const facts = new Map<string, PageFacts>();
  const pages = await pool(paths, args.concurrency, async (p): Promise<PageReport> => {
    const r = await get(`${base}${p}`);
    const f = r.status === 200 && /html/.test(r.type) ? parsePage(r.body) : null;
    if (f) facts.set(p, f);
    const issues = pageIssues(p, r.status, f, true);
    let og: number | null = null;
    if (f?.ogImage) {
      og = await ogStatus(f.ogImage);
      if (og !== 200) issues.push({ severity: "P1", code: "og-image-broken", detail: `HTTP ${og} ${f.ogImage}` });
    }
    return {
      path: p,
      status: r.status,
      title: f?.title ?? null,
      titleLength: f?.title?.length ?? 0,
      description: f?.description ?? null,
      descriptionLength: f?.description?.length ?? 0,
      canonical: f?.canonical ?? null,
      h1Count: f?.h1Count ?? 0,
      jsonLdTypes: f ? [...new Set(f.jsonLd.flatMap((b) => b.types))] : [],
      jsonLdValid: f ? f.jsonLd.every((b) => b.errors.length === 0) : false,
      ogImage: f?.ogImage ?? null,
      ogImageStatus: og,
      wordCount: f?.wordCount ?? 0,
      noindex: isNoindex(f?.robots ?? null),
      issues,
    };
  });

  // ── duplicates ──
  const indexable = pages.filter((p) => p.status === 200 && !p.noindex);
  const dupTitles = duplicates(new Map(indexable.map((p) => [p.path, p.title])));
  const dupDescs = duplicates(new Map(indexable.map((p) => [p.path, p.description])));
  for (const [t, urls] of dupTitles) {
    for (const u of urls) {
      pages.find((p) => p.path === u)!.issues.push({ severity: "P0", code: "title-duplicate", detail: `"${t}" also on ${urls.filter((x) => x !== u).join(", ")}` });
    }
  }
  for (const [, urls] of dupDescs) {
    for (const u of urls) {
      pages.find((p) => p.path === u)!.issues.push({ severity: "P1", code: "description-duplicate", detail: `shared with ${urls.filter((x) => x !== u).join(", ")}` });
    }
  }

  // ── internal links ──
  const origins = [new URL(base).origin, new URL(SITE_URL).origin, "https://smokysignal.app"];
  const linkSources = new Map<string, string[]>();
  for (const [p, f] of facts) {
    for (const l of internalLinks(f.links, `${base}${p}`, origins)) {
      if (l.startsWith("/admin") || l.startsWith("/api/admin")) continue;
      linkSources.set(l, [...(linkSources.get(l) ?? []), p]);
    }
  }
  const crawled = new Map(pages.map((p) => [p.path, p.status]));
  const toCheck = [...linkSources.keys()].filter((l) => !crawled.has(l)).slice(0, args.maxLinks);
  const linkStatus = new Map<string, number>(crawled);
  await pool(toCheck, args.concurrency, async (l) => {
    let r = await get(`${base}${l}`, "HEAD");
    if (r.status === 405 || r.status === 0) r = await get(`${base}${l}`, "GET");
    linkStatus.set(l, r.status);
  });
  const broken: Array<{ link: string; status: number; from: string[] }> = [];
  for (const [l, from] of linkSources) {
    const s = linkStatus.get(l);
    if (s != null && (s >= 400 || s === 0)) broken.push({ link: l, status: s, from: from.slice(0, 5) });
  }
  for (const b of broken) {
    for (const src of b.from) {
      pages.find((p) => p.path === src)?.issues.push({ severity: "P1", code: "broken-link", detail: `${b.link} → HTTP ${b.status}` });
    }
  }

  // ── summary ──
  const allIssues = [
    ...site.filter((s) => !s.ok).map((s) => ({ severity: s.severity, code: `site:${s.name}`, detail: s.detail, path: "(site)" })),
    ...pages.flatMap((p) => p.issues.map((i) => ({ ...i, path: p.path }))),
  ];
  const count = (sev: string) => allIssues.filter((i) => i.severity === sev).length;
  const summary = {
    base,
    date: today(),
    durationS: Math.round((Date.now() - started) / 1000),
    pages: pages.length,
    sitemapUrls: sitemapUrls.length,
    p0: count("P0"),
    p1: count("P1"),
    p2: count("P2"),
    pagesWithJsonLd: pages.filter((p) => p.jsonLdTypes.length > 0).length,
    pagesWithCanonical: pages.filter((p) => p.canonical).length,
    duplicateTitles: dupTitles.size,
    brokenLinks: broken.length,
    linksChecked: linkStatus.size,
  };

  const suffix = args.label ? `-${args.label.replace(/[^a-z0-9-]/gi, "")}` : "";
  const outDir = path.resolve(args.out);
  await fs.mkdir(outDir, { recursive: true });
  const stem = path.join(outDir, `report-${summary.date}${suffix}`);
  await fs.writeFile(`${stem}.json`, JSON.stringify({ summary, site, pages, broken }, null, 2) + "\n");
  await fs.writeFile(`${stem}.md`, renderMarkdown(summary, site, pages, broken));

  console.log(
    `seo-audit ${base}: ${summary.pages} pages, ${summary.p0} P0, ${summary.p1} P1, ${summary.p2} P2, ` +
      `${summary.pagesWithJsonLd} with JSON-LD, ${summary.brokenLinks} broken links → ${path.relative(process.cwd(), stem)}.md`,
  );
  process.exit(summary.p0 > 0 ? 1 : 0);
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderMarkdown(
  summary: Record<string, unknown>,
  site: SiteCheck[],
  pages: PageReport[],
  broken: Array<{ link: string; status: number; from: string[] }>,
): string {
  const s = summary as { base: string; date: string; pages: number; sitemapUrls: number; p0: number; p1: number; p2: number; pagesWithJsonLd: number; pagesWithCanonical: number; duplicateTitles: number; brokenLinks: number; linksChecked: number; durationS: number };
  const lines: string[] = [
    `# SEO audit ${s.date}`,
    "",
    `Base: ${s.base} · ${s.pages} pages crawled (${s.sitemapUrls} in sitemap) · ${s.durationS} s`,
    "",
    `| P0 | P1 | P2 | JSON-LD pages | Canonical pages | Duplicate titles | Broken links | Links checked |`,
    `|---|---|---|---|---|---|---|---|`,
    `| ${s.p0} | ${s.p1} | ${s.p2} | ${s.pagesWithJsonLd} | ${s.pagesWithCanonical} | ${s.duplicateTitles} | ${s.brokenLinks} | ${s.linksChecked} |`,
    "",
    "## Site checks",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...site.map((c) => `| ${esc(c.name)} | ${c.ok ? "pass" : `FAIL (${c.severity})`} | ${esc(c.detail)} |`),
    "",
    "## Pages",
    "",
    "| Path | Status | Title (len) | Desc len | Canonical | H1 | JSON-LD | OG image | Words | Noindex | Issues |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...pages.map(
      (p) =>
        `| ${esc(p.path)} | ${p.status} | ${esc((p.title ?? "-").slice(0, 70))} (${p.titleLength}) | ${p.descriptionLength} | ${p.canonical ? "yes" : "no"} | ${p.h1Count} | ${p.jsonLdTypes.length ? `${p.jsonLdTypes.join(", ")}${p.jsonLdValid ? "" : " (invalid)"}` : "-"} | ${p.ogImageStatus ?? "-"} | ${p.wordCount} | ${p.noindex ? "yes" : ""} | ${p.issues.length ? p.issues.map((i) => `${i.severity} ${i.code}`).join("; ") : ""} |`,
    ),
    "",
    "## Issues",
    "",
  ];
  const issues = pages.flatMap((p) => p.issues.map((i) => ({ ...i, path: p.path })));
  const order = { P0: 0, P1: 1, P2: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.path.localeCompare(b.path));
  if (issues.length === 0) lines.push("None.");
  for (const i of issues) lines.push(`- ${i.severity} \`${i.path}\` ${i.code}${i.detail ? `: ${esc(i.detail)}` : ""}`);
  lines.push("", "## Broken internal links", "");
  if (broken.length === 0) lines.push("None.");
  for (const b of broken) lines.push(`- \`${b.link}\` HTTP ${b.status}, linked from ${b.from.map((f) => `\`${f}\``).join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

main().catch((e) => {
  console.error("seo-audit failed:", e);
  process.exit(2);
});
