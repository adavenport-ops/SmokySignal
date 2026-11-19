// Weekly social pack: turns one generated blog post and its media manifest
// into drafts the owner posts by hand. Pure (no fs, no clock): the CLI in
// scripts/social-pack.ts reads the files and writes the markdown.
//
//   Reddit      a title, a body with the week's numbers, the best image
//   Bluesky     one post, 300 characters at most, link included
//   Shorts      two captions that reference the week's clips
//   Nextdoor    one line
//
// Voice (design/BRAND.md §3): no emoji, no exclamation marks, "Smokey"
// with the E, none of the voice-gate words, and never a word that frames
// the app as a way to dodge enforcement. Every output string is checked
// by socialViolations(); the CLI refuses to write a pack that fails.

import type { BlogPost } from "./blog-core";
import type { MediaItem, MediaManifest } from "./blog-media-core";
import { VOICE_P0 } from "./blog-weekly";

export const BLUESKY_LIMIT = 300;
export const SHORT_CAPTION_LIMIT = 150;
export const NEXTDOOR_LIMIT = 220;
export const REDDIT_TITLE_LIMIT = 300;

export const SITE = "https://www.smokysignal.app";

/** Beyond the voice-gate words: framing the pack must never use. */
export const EXTRA_BANNED = ["dodge", "speed trap", "avoid getting caught", "beat the", "outsmart", "radar detector"] as const;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

/** Problems with one string. Empty means it is clean. */
export function socialViolations(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const w of VOICE_P0) {
    if (w === "cop" ? /\b(?:cops?|coppers?)\b/.test(lower) : lower.includes(w)) out.push(w);
  }
  for (const w of EXTRA_BANNED) if (lower.includes(w)) out.push(w);
  if (EMOJI_RE.test(text)) out.push("emoji");
  if (text.includes("!")) out.push("exclamation");
  // "Smoky" alone is the old spelling; "SmokySignal" is the product name.
  if (/\bsmoky\b/i.test(text)) out.push("Smoky");
  return out;
}

/** Characters as a reader counts them (code points, close to graphemes for plain text). */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** Cut to `max` characters: at a sentence end if one fits, else on a word, ending in a period. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (charCount(t) <= max) return t;
  const cut = Array.from(t).slice(0, max).join("");
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.3) return cut.slice(0, sentence + 1);
  const room = Array.from(t).slice(0, max - 1).join("");
  const at = room.lastIndexOf(" ");
  return `${(at > max * 0.5 ? room.slice(0, at) : room).replace(/[\s,;:]+$/, "")}.`;
}

/** Markdown inline syntax out: links keep their text, emphasis and code lose their marks. */
export function plain(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function postUrl(slug: string): string {
  return `${SITE}/blog/${slug}`;
}

/** Numbers worth quoting: the first table's rows, then up to three "- **Label:** text" bullets. */
export function keyLines(body: string): string[] {
  const out: string[] = [];
  const lines = body.split("\n");
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => plain(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) {
        inTable = true;
        continue;
      }
      if (!inTable) continue; // header row
      if (cells.length >= 4) out.push(`${cells[0]}: ${cells[1]} (last week ${cells[2]})`);
      else if (cells.length >= 2) out.push(`${cells[0]}: ${cells[1]}`);
    } else if (inTable && out.length > 0 && !line.startsWith("|")) {
      break;
    }
  }
  const bullets = lines
    .filter((l) => /^- \*\*[^*]+:?\*\*/.test(l.trim()))
    .map((l) => plain(l.trim().replace(/^- /, "")))
    .filter((l) => charCount(l) <= 110);
  return [...out.slice(0, 6), ...bullets.slice(0, 3)];
}

/** Media ids in the order the post body shows them. */
export function mediaOrder(body: string, slug: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(`/blog/media/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([a-z0-9-]+)\\.(?:webp|png|jpg|mp4|webm)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) if (!ids.includes(m[1]!)) ids.push(m[1]!);
  return ids;
}

export type BestImage = { id: string; path: string; alt: string; caption: string; illustrative: boolean };

/** Best image for Reddit: the first real (not illustrative) screenshot in the post, else a clip poster. */
export function bestImage(post: BlogPost, manifest: MediaManifest | null): BestImage | null {
  if (!manifest || manifest.items.length === 0) return null;
  const order = mediaOrder(post.body, post.slug);
  const rank = (i: MediaItem) => {
    const at = order.indexOf(i.id);
    return at < 0 ? order.length : at;
  };
  const items = [...manifest.items].sort((a, b) => rank(a) - rank(b));
  const shot = items.find((i) => i.kind === "screenshot" && !i.illustrative && i.files.png);
  const pick = shot ?? items.find((i) => i.files.jpg) ?? items[0]!;
  const file = pick.files.png ?? pick.files.jpg ?? pick.files.webp;
  if (!file) return null;
  return { id: pick.id, path: `public${file.path}`, alt: pick.alt, caption: pick.caption, illustrative: pick.illustrative };
}

/** The week's clips, in post order. */
export function clipsOf(post: BlogPost, manifest: MediaManifest | null): MediaItem[] {
  if (!manifest) return [];
  const order = mediaOrder(post.body, post.slug);
  const rank = (i: MediaItem) => {
    const at = order.indexOf(i.id);
    return at < 0 ? order.length : at;
  };
  return manifest.items.filter((i) => i.kind === "clip").sort((a, b) => rank(a) - rank(b));
}

export type SocialPack = {
  slug: string;
  url: string;
  reddit: { title: string; body: string; image: BestImage | null };
  bluesky: string;
  shorts: Array<{ clip: string | null; caption: string }>;
  nextdoor: string;
};

const TAGS = "#Seattle #PNW #ADSB";

function lead(post: BlogPost): string {
  return plain(post.summary).replace(/\.$/, "");
}

export function buildSocialPack(post: BlogPost, manifest: MediaManifest | null): SocialPack {
  const url = postUrl(post.slug);
  const image = bestImage(post, manifest);
  const clips = clipsOf(post, manifest);
  const facts = keyLines(post.body);
  const hero = post.hero ? `${post.hero.value} ${post.hero.label}` : null;

  // Reddit: transparency and "when the bird flew", then the numbers.
  const redditBody = [
    `${lead(post)}.`,
    "",
    ...(facts.length > 0 ? facts.map((f) => `- ${f}`) : hero ? [`- ${hero}`] : []),
    "",
    "History, not a forecast. Aircraft only, never crew. Positions are public ADS-B from adsb.fi and adsb.lol.",
    "",
    `Full post, with the day-by-day: ${url}`,
    "",
    "Source: SmokySignal (smokysignal.app), built on public ADS-B from adsb.fi and adsb.lol (ODbL)",
  ].join("\n");

  // Bluesky: the link always survives; the lead gives way.
  const blueskyTail = ` ${url}`;
  const blueskyBudget = BLUESKY_LIMIT - charCount(blueskyTail);
  const bluesky = `${clip(`${lead(post)}.`, blueskyBudget)}${blueskyTail}`;

  // Shorts: one caption per clip, up to two. No clip means the owner records one.
  const shortSources: Array<MediaItem | null> = [clips[0] ?? null, clips[1] ?? clips[0] ?? null];
  const shorts = shortSources.map((c, i) => {
    const what = c ? plain(c.caption) : lead(post);
    const body = i === 0 ? `${what}` : `${hero ?? lead(post)}. ${what}`;
    const caption = `${clip(body, SHORT_CAPTION_LIMIT - charCount(` ${TAGS} smokysignal.app`))} ${TAGS} smokysignal.app`;
    return { clip: c ? c.id : null, caption };
  });

  // Nextdoor: one friendly line.
  const nextdoorTail = ` Day by day: ${url}`;
  const nextdoorHead = hero ? `Anyone curious when the bird flew? ${hero}.` : `${lead(post)}.`;
  const nextdoor = `${clip(nextdoorHead, NEXTDOOR_LIMIT - charCount(nextdoorTail))}${nextdoorTail}`;

  return {
    slug: post.slug,
    url,
    reddit: { title: clip(post.title, REDDIT_TITLE_LIMIT), body: redditBody, image },
    bluesky,
    shorts,
    nextdoor,
  };
}

/** Every string in the pack, for the voice check. */
export function packStrings(p: SocialPack): string[] {
  return [p.reddit.title, p.reddit.body, p.bluesky, p.nextdoor, ...p.shorts.map((s) => s.caption)];
}

/** Violations across the pack, as `where: word` pairs. */
export function packViolations(p: SocialPack): string[] {
  const named: Array<[string, string]> = [
    ["reddit title", p.reddit.title],
    ["reddit body", p.reddit.body],
    ["bluesky", p.bluesky],
    ["nextdoor", p.nextdoor],
    ...p.shorts.map((s, i): [string, string] => [`short ${i + 1}`, s.caption]),
  ];
  const out: string[] = [];
  for (const [where, text] of named) for (const v of socialViolations(text)) out.push(`${where}: ${v}`);
  if (charCount(p.bluesky) > BLUESKY_LIMIT) out.push(`bluesky: ${charCount(p.bluesky)} characters, limit ${BLUESKY_LIMIT}`);
  for (const [i, s] of p.shorts.entries()) {
    if (charCount(s.caption) > SHORT_CAPTION_LIMIT) out.push(`short ${i + 1}: over ${SHORT_CAPTION_LIMIT} characters`);
  }
  if (charCount(p.nextdoor) > NEXTDOOR_LIMIT) out.push(`nextdoor: over ${NEXTDOOR_LIMIT} characters`);
  return out;
}

export function renderPackMarkdown(p: SocialPack, generatedOn: string): string {
  const out: string[] = [
    `# Social pack: ${p.slug}`,
    "",
    `Drafts for the owner to post by hand from existing accounts. Nothing here posts anywhere. Generated ${generatedOn} from \`content/blog/${p.slug}.md\` and its media manifest. Post: ${p.url}`,
    "",
    "## Reddit",
    "",
    "Pick the subreddit from `docs/marketing/` and read its self-promo rules first. Frame it as transparency and when the bird flew.",
    "",
    `**Title:** ${p.reddit.title}`,
    "",
  ];
  if (p.reddit.image) {
    out.push(
      `**Image to attach:** \`${p.reddit.image.path}\``,
      "",
      `Alt text: ${p.reddit.image.alt}`,
      "",
      ...(p.reddit.image.illustrative ? ["This image is illustrative. Say so in the post.", ""] : []),
    );
  } else {
    out.push("**Image to attach:** none in this post's media. Capture one with `npm run blog:media`.", "");
  }
  out.push("**Body:**", "", ...p.reddit.body.split("\n").map((l) => (l ? `> ${l}` : ">")), "");
  out.push(`## Bluesky (${charCount(p.bluesky)}/${BLUESKY_LIMIT})`, "", "```", p.bluesky, "```", "");
  out.push("## Shorts", "", "For YouTube Shorts, Reels or TikTok. Captions only; the clips are under `public/blog/media/`.", "");
  p.shorts.forEach((s, i) => {
    out.push(
      `### Caption ${i + 1}${s.clip ? ` (clip \`${s.clip}\`)` : " (no clip in this post: record one first)"}`,
      "",
      "```",
      s.caption,
      "```",
      "",
    );
  });
  out.push("## Nextdoor", "", "```", p.nextdoor, "```", "");
  return out.join("\n");
}
