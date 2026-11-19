// Server-rendered markdown for blog posts. Same look as /help's prose
// (app/help/HelpView.tsx) but rendered on the server, so a post ships no
// markdown parser to the phone. Links are neutral: orange means "up".
//
// Media: `![alt](/blog/media/<slug>/<id>.webp "caption")` becomes a
// <figure> with a <picture> (webp, png fallback); `.mp4` becomes a clip
// (<BlogVideo>, the one client component). Sizes come from the post's
// manifest.json, so nothing shifts as it loads. See lib/blog-media-core.ts.

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import { SS_TOKENS } from "@/lib/tokens";
import { resolveBlogMedia, type MediaManifest, type MediaRender } from "@/lib/blog-media-core";
import { BlogVideo } from "./BlogVideo";
import { BlogZoomImage } from "./BlogLightbox";

const BODY = { fontSize: 16, color: SS_TOKENS.fg1, lineHeight: 1.7 } as const;
const LINK = {
  color: SS_TOKENS.fg0,
  textDecoration: "underline",
  textDecorationColor: SS_TOKENS.fg2,
  textUnderlineOffset: 3,
} as const;

function BlogFigure({ m }: { m: MediaRender }) {
  return (
    <figure
      className="ss-blog-figure"
      data-testid="blog-figure"
      data-media={m.kind}
      data-media-id={m.id}
      style={{ margin: "8px auto 24px", maxWidth: m.displayWidth, width: "100%" }}
    >
      {m.kind === "image" ? (
        <>
          <div
            style={{
              borderRadius: 12,
              overflow: "hidden",
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              background: SS_TOKENS.bg1,
            }}
          >
            <BlogZoomImage
              media={{
                kind: "image",
                webp: m.webp,
                png: m.png,
                alt: m.alt,
                width: m.width,
                height: m.height,
                caption: m.caption,
              }}
            >
            <picture>
              <source srcSet={m.webp} type="image/webp" />
              {/* eslint-disable-next-line @next/next/no-img-element -- static, pre-sized, already optimised */}
              <img
                src={m.png}
                alt={m.alt}
                width={m.width}
                height={m.height}
                loading="lazy"
                decoding="async"
                style={{ display: "block", width: "100%", height: "auto" }}
              />
            </picture>
            </BlogZoomImage>
          </div>
          {m.caption ? (
            <figcaption style={{ fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1, marginTop: 8 }}>{m.caption}</figcaption>
          ) : null}
        </>
      ) : (
        <BlogVideo
          mp4={m.mp4}
          webm={m.webm}
          poster={m.poster}
          width={m.width}
          height={m.height}
          label={m.alt}
          caption={m.caption}
        />
      )}
    </figure>
  );
}

/** A paragraph holding only one image: the figure replaces the <p>. */
function soleImage(node: unknown): { src?: string; alt?: string; title?: string } | null {
  const n = node as { children?: Array<{ type: string; tagName?: string; value?: string; properties?: Record<string, unknown> }> } | undefined;
  const kids = (n?.children ?? []).filter((c) => !(c.type === "text" && !(c.value ?? "").trim()));
  if (kids.length !== 1 || kids[0]!.type !== "element" || kids[0]!.tagName !== "img") return null;
  const p = kids[0]!.properties ?? {};
  return { src: p.src as string | undefined, alt: p.alt as string | undefined, title: p.title as string | undefined };
}

export function BlogMarkdown({ source, media = null }: { source: string; media?: MediaManifest | null }) {
  return (
    <div className="ss-blog-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          h1: ({ node: _n, ...props }) => (
            <h2
              style={{ fontSize: 24, fontWeight: 700, color: SS_TOKENS.fg0, margin: "36px 0 12px", lineHeight: 1.3 }}
              {...props}
            />
          ),
          h2: ({ node: _n, ...props }) => (
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: SS_TOKENS.fg0,
                margin: "40px 0 12px",
                paddingBottom: 8,
                borderBottom: `.5px solid ${SS_TOKENS.hairline2}`,
                lineHeight: 1.3,
                letterSpacing: "-.01em",
              }}
              {...props}
            />
          ),
          h3: ({ node: _n, ...props }) => (
            <h3 style={{ fontSize: 18, fontWeight: 600, color: SS_TOKENS.fg0, margin: "28px 0 10px", lineHeight: 1.4 }} {...props} />
          ),
          p: ({ node, ...props }) => {
            const img = soleImage(node);
            if (img) {
              const m = resolveBlogMedia(img, media);
              return m ? <BlogFigure m={m} /> : null;
            }
            return <p style={{ ...BODY, margin: "0 0 16px" }} {...props} />;
          },
          ul: ({ node: _n, ...props }) => (
            <ul
              style={{ ...BODY, listStyleType: "disc", paddingLeft: 20, margin: "0 0 18px", display: "flex", flexDirection: "column", gap: 8 }}
              {...props}
            />
          ),
          ol: ({ node: _n, ...props }) => (
            <ol
              style={{ ...BODY, listStyleType: "decimal", paddingLeft: 22, margin: "0 0 18px", display: "flex", flexDirection: "column", gap: 8 }}
              {...props}
            />
          ),
          a: ({ node: _n, href, children, ...rest }) => {
            if (href && href.startsWith("/") && !href.startsWith("//")) {
              return (
                <Link href={href} style={LINK}>
                  {children}
                </Link>
              );
            }
            const external = !!href && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                style={LINK}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                {...rest}
              >
                {children}
              </a>
            );
          },
          code: ({ node: _n, children, ...rest }) => (
            <code
              style={{
                fontFamily: "var(--font-mono)",
                background: SS_TOKENS.bg1,
                color: SS_TOKENS.fg0,
                fontSize: ".92em",
                padding: "2px 5px",
                borderRadius: 3,
              }}
              {...rest}
            >
              {children}
            </code>
          ),
          pre: ({ node: _n, children, ...rest }) => (
            <pre
              style={{
                fontFamily: "var(--font-mono)",
                background: SS_TOKENS.bg1,
                color: SS_TOKENS.fg0,
                padding: 16,
                borderRadius: 8,
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.55,
                margin: "0 0 18px",
                border: `.5px solid ${SS_TOKENS.hairline}`,
              }}
              {...rest}
            >
              {children}
            </pre>
          ),
          blockquote: ({ node: _n, ...props }) => (
            <blockquote
              style={{
                ...BODY,
                margin: "0 0 18px",
                padding: "12px 14px",
                borderLeft: `3px solid ${SS_TOKENS.fg2}`,
                background: SS_TOKENS.bg1,
                borderRadius: "0 10px 10px 0",
              }}
              {...props}
            />
          ),
          table: ({ node: _n, ...props }) => (
            <div style={{ overflowX: "auto", margin: "0 0 18px", WebkitOverflowScrolling: "touch" }}>
              <table
                className="ss-mono"
                style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, color: SS_TOKENS.fg0 }}
                {...props}
              />
            </div>
          ),
          // GFM column alignment arrives as a style prop; merge, don't replace.
          th: ({ node: _n, style, ...props }) => (
            <th
              {...props}
              style={{
                ...style,
                textAlign: "left",
                fontSize: 12,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: SS_TOKENS.fg1,
                fontWeight: 600,
                padding: "8px 12px 8px 0",
                borderBottom: `.5px solid ${SS_TOKENS.hairline2}`,
              }}
            />
          ),
          td: ({ node: _n, style, ...props }) => (
            <td
              {...props}
              style={{
                ...style,
                padding: "10px 12px 10px 0",
                borderBottom: `.5px solid ${SS_TOKENS.hairline}`,
                verticalAlign: "top",
              }}
            />
          ),
          hr: () => <hr style={{ border: 0, borderTop: `.5px solid ${SS_TOKENS.hairline2}`, margin: "32px 0" }} />,
          strong: ({ node: _n, ...props }) => <strong style={{ color: SS_TOKENS.fg0, fontWeight: 700 }} {...props} />,
          em: ({ node: _n, ...props }) => <em style={{ color: SS_TOKENS.fg1 }} {...props} />,
          // Inline images (inside a sentence) are not supported: a figure
          // needs its own paragraph. Anything else stays out.
          img: () => null,
        }}
      >
        {source}
      </ReactMarkdown>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .ss-blog-prose h2, .ss-blog-prose h3 { scroll-margin-top: 24px; }
        .ss-blog-prose li > p { margin: 0; }
        .ss-blog-prose li::marker { color: ${SS_TOKENS.fg2}; }
        .ss-blog-prose td:last-child, .ss-blog-prose th:last-child { padding-right: 0 !important; }
        .ss-blog-prose a { display: inline; padding: 6px 0; }
      `,
        }}
      />
    </div>
  );
}
