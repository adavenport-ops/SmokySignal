// IO half of blog media: reads public/blog/media/<slug>/manifest.json
// (written by scripts/blog-media.ts). Posts are SSG, so this runs at build
// time; a post with no media folder gets null and renders text only.

import fs from "node:fs";
import path from "node:path";
import type { MediaManifest } from "./blog-media-core";

export const MEDIA_ROOT = path.join(process.cwd(), "public", "blog", "media");

export function getPostMedia(slug: string): MediaManifest | null {
  const file = path.join(MEDIA_ROOT, slug, "manifest.json");
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8")) as MediaManifest;
    return m && m.post === slug && Array.isArray(m.items) ? m : null;
  } catch {
    return null;
  }
}
