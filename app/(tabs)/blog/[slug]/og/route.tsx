// GET /blog/{slug}/og: the post's share card (lib/og/blog-card.tsx).
// A plain route handler rather than an opengraph-image file, so the URL
// has no route-group hash and the Article JSON-LD can name it. Wired into
// og:image and twitter:image by generateMetadata in ../page.tsx.

import { getPost } from "@/lib/blog";
import { renderBlogCard } from "@/lib/og/blog-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return renderBlogCard(post);
}
