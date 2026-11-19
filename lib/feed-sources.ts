// Feed tags, canonical order and rider-readable labels. Client-safe: no
// server imports, so components/Glanceable.tsx can render the source line.

import type { FeedSrc, SnapshotSource } from "./types";

/** Canonical order: summary strings and `sources` arrays follow it. */
export const FEED_ORDER: readonly FeedSrc[] = ["fi", "lol", "apl"];

export const FEED_NAMES: Record<FeedSrc, string> = {
  fi: "adsb.fi",
  lol: "adsb.lol",
  apl: "airplanes.live",
};

export function isFeedSrc(v: string): v is FeedSrc {
  return (FEED_ORDER as readonly string[]).includes(v);
}

export function sortFeeds(srcs: Iterable<FeedSrc>): FeedSrc[] {
  const set = new Set(srcs);
  return FEED_ORDER.filter((s) => set.has(s));
}

/** "fi+lol" style summary; "none" when nothing answered. */
export function summarizeSources(srcs: Iterable<FeedSrc>): SnapshotSource {
  const sorted = sortFeeds(srcs);
  return sorted.length > 0 ? sorted.join("+") : "none";
}

/** Splits a summary back into tags. Pre-merge values map to their tag. */
export function parseSources(source: SnapshotSource): FeedSrc[] {
  if (source === "adsbfi") return ["fi"];
  return sortFeeds(source.split("+").filter(isFeedSrc));
}

/**
 * Source-line label and tooltip text for a snapshot source.
 * "fi+lol" reads as "FI+LOL", with a tooltip that spells each tag out.
 */
export function describeSource(source: SnapshotSource): {
  label: string;
  detail: string;
} {
  if (source === "mock") return { label: "MOCK", detail: "MOCK = synthetic data." };
  if (source === "none") return { label: "NONE", detail: "No feed answered." };
  const tags = parseSources(source);
  if (tags.length === 0) {
    return { label: source.toUpperCase(), detail: `${source.toUpperCase()} feed.` };
  }
  const label =
    source === "adsbfi"
      ? source.toUpperCase()
      : tags.map((t) => t.toUpperCase()).join("+");
  const legend = tags
    .map((t) => `${t.toUpperCase()} = ${FEED_NAMES[t]}.`)
    .join(" ");
  const detail =
    tags.length > 1
      ? `${legend} Positions merged across feeds; the freshest fix wins.`
      : legend;
  return { label, detail };
}
