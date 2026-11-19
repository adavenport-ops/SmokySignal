import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { BASE_URL } from "@/lib/config";
import {
  articleJsonLd,
  formatPostDate,
  jsonLdScript,
  KIND_LABEL,
  neighbours,
  postTimestamp,
  routeLabel,
} from "@/lib/blog-core";
import { getAllPosts, getPost } from "@/lib/blog";
import { BackLink } from "@/components/BackLink";
import { BlogMarkdown } from "@/components/BlogMarkdown";
import { BLOG_CARD_ALT } from "@/lib/og/blog-card";

// One page per committed post; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const post = getPost(params.slug);
  if (!post) return { title: "Blog" };
  const published = new Date(postTimestamp(post.date)).toISOString();
  const image = { url: `/blog/${post.slug}/og`, width: 1200, height: 630, alt: BLOG_CARD_ALT };
  return {
    title: post.title,
    description: post.summary,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.summary,
      url: `/blog/${post.slug}`,
      siteName: "SmokySignal",
      publishedTime: published,
      tags: post.tags,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.summary, images: [image.url] },
  };
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();
  const { newer, older } = neighbours(getAllPosts(), post.slug);

  return (
    <main className="ss-page" style={{ gap: 18 }}>
      <BackLink href="/blog" label="Blog" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(articleJsonLd(post, BASE_URL)) }}
      />

      <article data-testid="blog-post" data-kind={post.kind} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="ss-eyebrow">
            {KIND_LABEL[post.kind]} ·{" "}
            <time dateTime={post.date} className="ss-mono">
              {formatPostDate(post.date)}
            </time>{" "}
            · <span className="ss-mono">{post.readingMinutes} min read</span>
          </span>
          <h1
            style={{
              fontSize: TYPE.title + 4,
              fontWeight: 800,
              letterSpacing: "-.03em",
              lineHeight: 1.1,
              color: SS_TOKENS.fg0,
              margin: 0,
            }}
          >
            {post.title}
          </h1>
          {post.summary ? (
            <p style={{ fontSize: 17, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>{post.summary}</p>
          ) : null}
          {post.hero ? (
            <div
              data-testid="blog-hero"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                padding: "14px 16px",
                background: SS_TOKENS.bg1,
                border: `.5px solid ${SS_TOKENS.hairline}`,
                borderRadius: 14,
              }}
            >
              <span className="ss-mono" style={{ fontSize: 34, fontWeight: 600, color: SS_TOKENS.fg0, lineHeight: 1 }}>
                {post.hero.value}
              </span>
              <span style={{ fontSize: 14, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>{post.hero.label}</span>
            </div>
          ) : null}
        </header>

        <BlogMarkdown source={post.body} />
      </article>

      <section aria-labelledby="blog-related" data-testid="blog-related" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 id="blog-related" className="ss-eyebrow" style={{ margin: 0 }}>
          Related in the app
        </h2>
        <div className="ss-hub-grid">
          {post.related.map((href) => (
            <Link key={href} href={href} className="ss-hub-link">
              <span style={{ fontSize: 15, fontWeight: 600 }}>{routeLabel(href)}</span>
              <span aria-hidden style={{ color: SS_TOKENS.fg1 }}>
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <nav aria-label="More posts" data-testid="blog-prev-next" className="ss-blog-pager">
        {older ? (
          <Link href={`/blog/${older.slug}`} className="ss-blog-pager-link" rel="prev">
            <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".08em" }}>
              ← OLDER
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: SS_TOKENS.fg0 }}>{older.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {newer ? (
          <Link href={`/blog/${newer.slug}`} className="ss-blog-pager-link" rel="next" style={{ textAlign: "right" }}>
            <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".08em" }}>
              NEWER →
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: SS_TOKENS.fg0 }}>{newer.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <p className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".04em", margin: 0 }}>
        <Link href="/blog" style={{ color: SS_TOKENS.fg0, textDecoration: "underline", display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          All posts
        </Link>{" "}
        ·{" "}
        <a href="/blog/feed.xml" style={{ color: SS_TOKENS.fg0, textDecoration: "underline", display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          Atom feed
        </a>
      </p>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .ss-blog-pager { display: grid; grid-template-columns: 1fr; gap: 8px; }
        @media (min-width: 768px) { .ss-blog-pager { grid-template-columns: 1fr 1fr; } }
        .ss-blog-pager-link {
          display: flex; flex-direction: column; gap: 4px; min-height: 44px;
          padding: 12px 14px; border-radius: 12px; background: ${SS_TOKENS.bg1};
          border: .5px solid ${SS_TOKENS.hairline}; text-decoration: none;
          touch-action: manipulation; -webkit-tap-highlight-color: transparent;
        }
        .ss-blog-pager-link:hover { border-color: ${SS_TOKENS.hairline2}; }
      `,
        }}
      />
    </main>
  );
}
