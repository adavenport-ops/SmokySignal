// IO half of the blog: reads content/blog/*.md once per process and hands
// the text to lib/blog-core.ts. Posts are committed files (the launch post
// by hand, weekly posts by scripts/blog-weekly.ts), so there is nothing to
// revalidate between deploys.

import fs from "node:fs";
import path from "node:path";
import { parsePost, sortPosts, type BlogPost } from "./blog-core";

export const BLOG_DIR = path.join(process.cwd(), "content", "blog");

let cache: BlogPost[] | null = null;

/** Every valid post, newest first. Bad files are skipped with a warning. */
export function getAllPosts(): BlogPost[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  let names: string[] = [];
  try {
    names = fs.readdirSync(BLOG_DIR).filter((n) => n.endsWith(".md"));
  } catch (e) {
    console.warn("[blog] content/blog unreadable:", e);
    names = [];
  }
  const posts: BlogPost[] = [];
  for (const name of names) {
    const src = fs.readFileSync(path.join(BLOG_DIR, name), "utf8");
    const r = parsePost(name, src);
    if (r.ok) posts.push(r.post);
    else console.warn(`[blog] skipped: ${r.error}`);
  }
  cache = sortPosts(posts);
  return cache;
}

export function getPost(slug: string): BlogPost | null {
  return getAllPosts().find((p) => p.slug === slug) ?? null;
}
