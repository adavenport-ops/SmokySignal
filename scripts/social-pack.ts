// Weekly social pack. Reads a generated blog post and its media manifest and
// writes docs/marketing/weekly/<slug>.md: a Reddit-ready summary with the
// best image, a Bluesky post (300 characters at most), two Shorts captions
// that reference the week's clips, and a one-line Nextdoor blurb.
//
//   npm run marketing:social -- --post <slug> [--dry-run] [--force]
//
// Drafts only. Nothing here posts anywhere. The formatting and the voice
// checks live in lib/social-pack.ts (tested); a pack that fails them is not
// written.

import fs from "node:fs";
import path from "node:path";
import { parsePost } from "../lib/blog-core";
import type { MediaManifest } from "../lib/blog-media-core";
import { todayPt } from "../lib/pt-range";
import { buildSocialPack, packViolations, renderPackMarkdown } from "../lib/social-pack";

const ROOT = process.cwd();

function usage(msg?: string): never {
  if (msg) console.error(`social-pack: ${msg}`);
  console.error("usage: npm run marketing:social -- --post <slug> [--dry-run] [--force]");
  process.exit(2);
}

function main() {
  let slug = "";
  let dryRun = false;
  let force = false;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (k === "--post") slug = argv[++i] ?? "";
    else if (k.startsWith("--post=")) slug = k.slice("--post=".length);
    else if (k === "--dry-run") dryRun = true;
    else if (k === "--force") force = true;
    else if (k === "--help" || k === "-h") usage();
    else usage(`unknown option ${k}`);
  }
  if (!slug) usage("--post is required");

  const file = path.join(ROOT, "content", "blog", `${slug}.md`);
  if (!fs.existsSync(file)) usage(`no post at ${path.relative(ROOT, file)}`);
  const parsed = parsePost(`${slug}.md`, fs.readFileSync(file, "utf8"));
  if (!parsed.ok) usage(parsed.error);

  let manifest: MediaManifest | null = null;
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public", "blog", "media", slug, "manifest.json"), "utf8"),
    ) as MediaManifest;
  } catch {
    console.error(`social-pack: no media manifest for ${slug}; the pack will have no image or clips`);
  }

  const pack = buildSocialPack(parsed.post, manifest);
  const bad = packViolations(pack);
  if (bad.length > 0) {
    for (const b of bad) console.error(`social-pack: ${b}`);
    console.error("social-pack: not written. Fix the post's summary or captions, then re-run.");
    process.exit(1);
  }

  const md = renderPackMarkdown(pack, todayPt(Date.now()));
  const out = path.join(ROOT, "docs", "marketing", "weekly", `${slug}.md`);
  if (dryRun) {
    process.stdout.write(md);
    console.error(`social-pack: dry run, would write ${path.relative(ROOT, out)}`);
    return;
  }
  if (fs.existsSync(out) && !force) {
    console.error(`social-pack: ${path.relative(ROOT, out)} exists; pass --force to overwrite`);
    process.exit(3);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  console.error(`social-pack: wrote ${path.relative(ROOT, out)}`);
}

main();
