import Link from "next/link";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { BLOG_KINDS, filterByKind, formatPostDate, KIND_LABEL, type BlogKind } from "@/lib/blog-core";
import { getAllPosts } from "@/lib/blog";
import { BackLink } from "@/components/BackLink";
import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo/site";
import { JsonLd } from "@/components/JsonLd";
import { simplePageJsonLd } from "@/lib/seo/jsonld";

const BLOG_DESCRIPTION =
  "Release notes for SmokySignal and a weekly log of when Washington patrol aircraft flew: flights, hours aloft, roads worked and what changed on the site.";

const BASE_META = pageMeta({
  title: "Blog: release notes and the weekly Smokey log",
  description: BLOG_DESCRIPTION,
  path: "/blog",
});

export const metadata: Metadata = {
  ...BASE_META,
  alternates: {
    canonical: "/blog",
    types: { "application/atom+xml": [{ url: "/blog/feed.xml", title: "SmokySignal blog (Atom)" }] },
  },
};

const CHIPS: { kind: BlogKind | null; label: string }[] = [
  { kind: null, label: "All" },
  ...BLOG_KINDS.map((k) => ({ kind: k, label: k === "note" ? "Notes" : KIND_LABEL[k] })),
];

export default function BlogIndex({ searchParams }: { searchParams: { kind?: string } }) {
  const all = getAllPosts();
  const active = BLOG_KINDS.includes(searchParams.kind as BlogKind) ? (searchParams.kind as BlogKind) : null;
  const posts = filterByKind(all, active);

  return (
    <main className="ss-page" style={{ gap: 22 }}>
      <JsonLd
        data={simplePageJsonLd({
          path: "/blog",
          name: "Blog: release notes and the weekly Smokey log",
          description: BLOG_DESCRIPTION,
          crumb: "Blog",
        })}
      />
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · Blog</span>

      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1
          style={{
            fontSize: TYPE.title,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          Signal log.
        </h1>
        <p style={{ fontSize: 14, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>
          What shipped, and a weekly log of when the bird flew. History, not a forecast.
        </p>
      </header>

      <nav aria-label="Filter posts by kind" className="ss-blog-chips" data-testid="blog-kind-chips">
        {CHIPS.map((c) => {
          const on = c.kind === active;
          return (
            <Link
              key={c.label}
              href={c.kind ? `/blog?kind=${c.kind}` : "/blog"}
              aria-current={on ? "page" : undefined}
              className="ss-blog-chip"
              data-kind={c.kind ?? "all"}
            >
              {c.label}
            </Link>
          );
        })}
      </nav>

      {posts.length === 0 ? (
        <p data-testid="blog-empty" style={{ fontSize: 14, color: SS_TOKENS.fg1, margin: 0 }}>
          Nothing on this channel yet.
        </p>
      ) : (
        <ol data-testid="blog-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {posts.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="ss-blog-card" data-testid="blog-post-link">
                <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".08em", textTransform: "uppercase" }}>
                  {KIND_LABEL[p.kind]} · {formatPostDate(p.date)} · {p.readingMinutes} min
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: SS_TOKENS.fg0, lineHeight: 1.3, letterSpacing: "-.01em" }}>
                  {p.title}
                </span>
                {p.summary ? (
                  <span style={{ fontSize: 14, color: SS_TOKENS.fg1, lineHeight: 1.5 }}>{p.summary}</span>
                ) : null}
                {p.hero ? (
                  <span style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 2 }}>
                    <span className="ss-mono" style={{ fontSize: 18, fontWeight: 600, color: SS_TOKENS.fg0 }}>
                      {p.hero.value}
                    </span>
                    <span style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>{p.hero.label}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      )}

      <p className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".04em", margin: 0 }}>
        Follow along:{" "}
        <a href="/blog/feed.xml" style={{ color: SS_TOKENS.fg0, textDecoration: "underline", display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          Atom feed
        </a>
      </p>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .ss-blog-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .ss-blog-chip {
          display: inline-flex; align-items: center; justify-content: center;
          min-height: 44px; min-width: 44px; padding: 0 16px; border-radius: 999px;
          background: ${SS_TOKENS.bg1}; border: .5px solid ${SS_TOKENS.hairline2};
          color: ${SS_TOKENS.fg1}; font-size: 14px; font-weight: 600; text-decoration: none;
          touch-action: manipulation; -webkit-tap-highlight-color: transparent;
        }
        .ss-blog-chip[aria-current="page"] { background: ${SS_TOKENS.bg2}; color: ${SS_TOKENS.fg0}; border-color: ${SS_TOKENS.fg2}; }
        .ss-blog-card {
          display: flex; flex-direction: column; gap: 6px; min-height: 44px;
          padding: 14px 16px; border-radius: 14px; background: ${SS_TOKENS.bg1};
          border: .5px solid ${SS_TOKENS.hairline}; text-decoration: none;
          touch-action: manipulation; -webkit-tap-highlight-color: transparent;
        }
        .ss-blog-card:hover { border-color: ${SS_TOKENS.hairline2}; }
      `,
        }}
      />
    </main>
  );
}
