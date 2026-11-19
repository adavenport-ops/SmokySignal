// Blog share card: 1200x630 PNG for /blog/[slug] (app/(tabs)/blog/[slug]/
// opengraph-image.tsx). Kind eyebrow, the post title, and the publish date
// in mono.
//
// Neutral colours only: orange means "Smokey is up", and a post is never
// live status. Same font loader and cache shape as lib/og/road-card.tsx.

import { ImageResponse } from "next/og";
import { formatPostDate, KIND_LABEL, type BlogPost } from "@/lib/blog-core";
import { SS_TOKENS } from "@/lib/tokens";
import { loadGoogleFont } from "./status-card";

export const BLOG_CARD_SIZE = { width: 1200, height: 630 };
export const BLOG_CARD_ALT = "SmokySignal blog post: title, kind and publish date.";
// Posts change only on a deploy; a day of CDN cache is plenty.
const CACHE_SECONDS = 86_400;

type OgFont = { name: string; data: ArrayBuffer; weight: 600 | 800; style: "normal" };

/** Title size steps down for long titles so it never runs past three lines. */
function titleSize(title: string): number {
  if (title.length <= 28) return 84;
  if (title.length <= 48) return 72;
  if (title.length <= 72) return 60;
  return 50;
}

export async function renderBlogCard(post: BlogPost | null): Promise<Response> {
  const brand = "SMOKYSIGNAL";
  const kind = post ? `${KIND_LABEL[post.kind].toUpperCase()} · BLOG` : "BLOG";
  const title = post?.title ?? "SmokySignal blog";
  const date = post ? formatPostDate(post.date) : "";
  const meta = post ? `${date} · ${post.readingMinutes} min read` : "";
  const hero = post?.hero ?? null;
  const url = "smokysignal.app/blog";

  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 800, `${title}${brand}${kind}${hero?.label ?? ""}`),
    loadGoogleFont("JetBrains Mono", 600, `${meta}${url}${hero?.value ?? ""}`),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 800, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
  // Satori throws on `fontFamily: undefined`; only set a family that loaded.
  const sansStyle = inter ? { fontFamily: "Inter" } : {};
  const monoStyle = mono ? { fontFamily: "JetBrains Mono" } : {};

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: SS_TOKENS.bg0,
          color: SS_TOKENS.fg0,
          padding: 72,
          borderLeft: `16px solid ${SS_TOKENS.fg2}`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...sansStyle, fontSize: 26, fontWeight: 800, letterSpacing: 3, color: SS_TOKENS.fg1 }}>
            {brand}
          </span>
          <span style={{ ...sansStyle, fontSize: 24, fontWeight: 800, letterSpacing: 3, color: SS_TOKENS.fg1 }}>
            {kind}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span
            style={{
              ...sansStyle,
              fontSize: titleSize(title),
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1.05,
              maxWidth: 1000,
            }}
          >
            {title}
          </span>
          {hero ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
              <span style={{ ...monoStyle, fontSize: 64, fontWeight: 600, lineHeight: 1 }}>{hero.value}</span>
              <span style={{ ...sansStyle, fontSize: 28, fontWeight: 800, color: SS_TOKENS.fg1 }}>{hero.label}</span>
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: `1px solid ${SS_TOKENS.hairline2}`,
            paddingTop: 28,
            gap: 24,
          }}
        >
          <span style={{ ...monoStyle, fontSize: 26, fontWeight: 600, color: SS_TOKENS.fg0 }}>{meta}</span>
          <span style={{ ...monoStyle, fontSize: 22, fontWeight: 600, color: SS_TOKENS.fg1, flexShrink: 0 }}>{url}</span>
        </div>
      </div>
    ),
    { ...BLOG_CARD_SIZE, fonts: fonts.length ? fonts : undefined },
  );
  // See lib/og/status-card.tsx: replace ImageResponse's year-long cache.
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
    },
  });
}
