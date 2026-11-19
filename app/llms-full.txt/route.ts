// GET /llms-full.txt — /llms.txt plus every blog post, the full registry,
// the corridor list and the FAQ (program + help). Built in lib/seo/llms.ts; cached an hour.

import fs from "node:fs/promises";
import path from "node:path";
import { getRegistry } from "@/lib/registry";
import { CORRIDORS } from "@/lib/corridor";
import { PROGRAM_FAQ, helpFaq } from "@/lib/seo/faq";
import { fillHelpPlaceholders } from "@/lib/seo/facts";
import { getAllPosts } from "@/lib/blog";
import { buildLlmsFullTxt } from "@/lib/seo/llms";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const fleet = await getRegistry();
  let help: ReturnType<typeof helpFaq> = [];
  try {
    const md = await fs.readFile(path.join(process.cwd(), "content", "help.md"), "utf8");
    help = helpFaq(fillHelpPlaceholders(md, fleet));
  } catch (e) {
    console.warn("[llms-full] help.md unreadable:", e);
  }
  return new Response(buildLlmsFullTxt(fleet, CORRIDORS, [...PROGRAM_FAQ, ...help], getAllPosts()), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
