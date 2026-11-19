// GET /llms.txt — the llms.txt brief for answer engines (llmstxt.org).
// Body built in lib/seo/llms.ts from the live registry; cached an hour.

import { getRegistry } from "@/lib/registry";
import { getAllPosts } from "@/lib/blog";
import { buildLlmsTxt } from "@/lib/seo/llms";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const fleet = await getRegistry();
  return new Response(buildLlmsTxt(fleet, getAllPosts()), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
