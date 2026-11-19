# SEO and GEO playbook

How SmokySignal stays findable in search and citable by answer engines
(ChatGPT, Claude, Perplexity, Google AI Overviews), what the weekly job
checks, and how to add metadata when you ship a page.

## The moving parts

| Surface | Source | Notes |
|---|---|---|
| Titles, descriptions, canonicals, Open Graph, Twitter cards | `pageMeta()` in `lib/seo/site.ts`, called from each page's `metadata` / `generateMetadata` | Root template adds ` · SmokySignal`; never put the brand in the page title too. |
| Sitemap | `app/sitemap.ts` + `lib/seo/sitemap-core.ts` | Static routes (`STATIC_ROUTES`), every `/plane/[tail]`, every `/road/[id]`, `/wrap/[year]`, `/blog/*` when `content/blog` exists, up to 500 `/flight/*` pages from the last 30 days. Hourly. |
| robots.txt | `app/robots.ts` | Disallows `/admin`, `/api/admin`, `/relay/manage`, `/embed` (but allows `/embed/help`), `/qa-dashboard`. Names the AI crawlers explicitly as allowed. |
| Structured data | `lib/seo/jsonld.ts` builders, rendered by `components/JsonLd.tsx` | `type="application/ld+json"`, never executed, so the CSP is untouched. Validated by `validateJsonLd()` in tests and in the audit. |
| llms.txt / llms-full.txt | `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, `lib/seo/llms.ts` | Counts come from the registry. llms-full adds the registry table, corridors and the FAQ. |
| Key facts | `lib/seo/facts.ts`, `components/KeyFacts.tsx` | On `/program` and `/about`; the first two facts also sit under the status on `/`. Computed from the registry, never hardcoded. |
| FAQ content | `lib/seo/faq.ts` | `/program` answers are lifted verbatim from the page (a test fails if one drifts); `/help` is parsed from `content/help.md`. |

Structured data by route:

| Route | JSON-LD |
|---|---|
| `/` | WebSite, Organization |
| `/about` | Organization |
| `/program` | FAQPage, BreadcrumbList |
| `/help` | FAQPage, BreadcrumbList |
| `/data` | Dataset (ODbL 1.0, CSV distribution, temporal coverage from 2026-10-16), BreadcrumbList |
| `/plane/[tail]` | WebPage about the airframe (Thing typed as aircraft) and the operating GovernmentOrganization, BreadcrumbList |
| `/road/[id]` | WebPage about a Place with a GeoShape line, BreadcrumbList |
| `/flight/[tail]/[id]` | WebPage with dateCreated, about the airframe, BreadcrumbList |
| `/wrap/[year]` | BreadcrumbList |

No SearchAction: there is no search results route. Add one to
`websiteJsonLd()` only when a URL like `/search?q=` exists.

## Weekly job

```sh
npm run seo:audit                         # production, read-only
npm run seo:audit -- --base http://localhost:3000 --label local
```

It writes `docs/seo/report-YYYY-MM-DD[-label].md` and a `.json` twin and
exits 1 on any P0. Severity:

- **P0** (fix now): page not 200, missing title / description /
  canonical, a sitemap URL marked noindex, invalid JSON-LD, duplicate
  titles, robots.txt / sitemap.xml / llms.txt missing, sitemap missing
  `/plane/N305DK` or `/road/i-5`, unknown URLs not returning 404.
- **P1** (fix this week): title over 65 or under 15 characters, brand
  twice in a title, canonical pointing at another path, no or several
  h1s, missing or broken og:image, broken internal links, images without
  alt, duplicate descriptions, AI crawlers blocked.
- **P2** (watch): descriptions outside 70 to 165 characters, thin pages
  (under 120 words), no twitter card.

Each week:

1. Run the audit against production. Open an issue for every P0 and P1;
   P0 blocks the next release.
2. Compare with last week's report: new pages in the sitemap, pages
   that dropped out, word counts that fell.
3. Check one target query by hand (list below) in a private window and
   in one answer engine. Note whether SmokySignal is cited and which page.
4. Pick one improvement and ship it: a clearer description on a page
   that shows up but does not get clicked, a key fact that answers a
   query better, a missing internal link, a thin page that needs a
   paragraph of server-rendered text.
5. If the registry changed (new tails, new agencies), confirm `/llms.txt`
   and the Key facts read right. They recompute on their own; the check
   is that the sentences still make sense.

Thin pages that are expected: `/radar`, `/flights` and `/board` are live
app screens. Their text is the status itself; keep them indexable, do
not stuff them.

## Target queries

Riders and locals:

- is the state patrol plane flying today
- WSP aircraft speed enforcement
- plane circling over Tacoma / Puyallup / Lakewood
- what is that plane circling
- Washington State Patrol airplane tracker
- Smokey plane
- King County sheriff Guardian One
- police plane I-5
- aerial speed enforcement Washington

Aviation fans:

- specific tails, e.g. N305DK, N2446X, N422CT
- WSP Cessna 206 FLIR
- King County Sheriff Bell 407

Pages that should win them: `/` (is it up), `/circling` (what is that
plane circling), `/seen` (was that the plane I saw), `/program` (how
aerial speed enforcement works), `/aircraft` and `/plane/[tail]` (tails
and airframes), `/road/[id]` (I-5, SR-512 and the towns along them).

## Adding a page

1. Export metadata through `pageMeta()`:

   ```ts
   import { pageMeta } from "@/lib/seo/site";

   export const metadata = pageMeta({
     title: "Thing: what it answers",      // ≤ 51 chars; the suffix adds 14
     description: "One or two plain sentences, 70 to 160 characters.",
     path: "/thing",                       // canonical, no query string
   });
   ```

   Dynamic routes use `generateMetadata` and put the tail, road or town
   name in the title and description. Query-string states (`?tab=`,
   `?h=`, `?mock=`) pass `noindex: true` and keep the bare path as
   canonical. Segments with their own `opengraph-image` file pass
   `inheritImage: true`; everything else gets the brand card.
2. Exactly one `<h1>`. Use `components/VisuallyHidden.tsx` when the
   design has no room for a visible one.
3. If the page answers a question in prose, server-render that prose.
   Client-only text is invisible to most answer engines.
4. Add JSON-LD with a builder in `lib/seo/jsonld.ts`, render it with
   `<JsonLd data={...} />`, and add a case to `lib/seo/jsonld.test.ts`.
   Add a BreadcrumbList on anything two levels deep.
5. Add the path to `STATIC_ROUTES` in `lib/seo/site.ts` (or to the
   dynamic part of `app/sitemap.ts`). Admin, settings and embed routes
   stay out.
6. Link to it from at least one related page with descriptive anchor
   text (what the reader gets, never "click here").
7. Run `npm run seo:audit -- --base http://localhost:3000` against
   `next start` and fix any P0 or P1 before opening the PR.

## Copy rules

SEO copy is page copy: `design/BRAND.md` applies. Laconic, no emoji, no
exclamation marks, "Smokey" with the e. Never encourage speeding or
evasion; say what flies and how the program works. Visible copy and
JSON-LD avoid the voice-gate words, so "patrol aircraft" and "sheriff"
stand in. The meta keywords list (`SITE_KEYWORDS`) and the llms.txt
files may use "police aircraft", since those are the words people
search with.
