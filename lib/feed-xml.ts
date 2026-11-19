// Pure builders for the takeoff feeds: /feed.xml (Atom 1.0) and /rss.xml
// (RSS 2.0). No I/O; the route handlers read the activity list and the
// registry and hand them here (lib/feed-xml.test.ts).
//
// Entries are the last FEED_LIMIT takeoffs and landings, newest first.
// Police only by default (the Smokey class that lights the home pill);
// `all` includes every mission.

import type { ActivityEntry } from "./activity-diff";
import { inWashingtonAirspace, normalizeMission } from "./mission";
import type { MissionScope } from "./types";
import { feedTitle, planeUrl } from "./relay/payload";
import { ALERT_MISSIONS, type RelayEventInput } from "./relay/types";

export const FEED_LIMIT = 100;

export type FeedItem = {
  id: string;
  title: string;
  link: string;
  ts: number;
  type: "takeoff" | "landing";
  tail: string;
  summary: string;
};

/** XML 1.0 text/attribute escape. Drops characters XML cannot carry. */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hostOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return "smokysignal.app";
  }
}

export function feedItemsFromActivity(
  entries: readonly ActivityEntry[],
  opts: {
    siteUrl: string;
    all?: boolean;
    limit?: number;
    nicknameOf?: (tail: string) => string | null;
    scopeOf?: (tail: string) => MissionScope | null | undefined;
  },
): FeedItem[] {
  const limit = opts.limit ?? FEED_LIMIT;
  const host = hostOf(opts.siteUrl);
  const out: FeedItem[] = [];
  const sorted = [...entries].sort((a, b) => b.ts - a.ts);
  for (const e of sorted) {
    if (out.length >= limit) break;
    // first_seen is "already airborne on first look", which reads as up.
    const type =
      e.kind === "takeoff" || e.kind === "first_seen"
        ? "takeoff"
        : e.kind === "landing"
          ? "landing"
          : null;
    if (!type) continue;
    // Legacy role names in old feed rows map through the back-compat mapper.
    const role = normalizeMission(e.role);
    if (!opts.all) {
      if (!ALERT_MISSIONS.has(role)) continue;
      // Mutual-aid police only count inside Washington airspace.
      if (opts.scopeOf?.(e.tail) === "mutual_aid" && !inWashingtonAirspace(e.lat, e.lon)) continue;
    }
    const evt: RelayEventInput = {
      type,
      tail: e.tail,
      nickname: opts.nicknameOf?.(e.tail) ?? null,
      role,
      lat: e.lat ?? null,
      lon: e.lon ?? null,
      alt_ft: e.alt_ft ?? null,
      ts: e.ts,
    };
    const iso = new Date(e.ts).toISOString();
    out.push({
      id: `tag:${host},${iso.slice(0, 10)}:activity/${e.tail}/${type}/${e.ts}`,
      title: feedTitle(evt),
      link: planeUrl(opts.siteUrl, e.tail),
      ts: e.ts,
      type,
      tail: e.tail,
      summary: e.description || feedTitle(evt),
    });
  }
  return out;
}

export type FeedMeta = {
  siteUrl: string;
  /** Absolute URL of this feed document. */
  selfUrl: string;
  title: string;
  subtitle: string;
  /** Used for <updated> when there are no items. */
  nowMs: number;
};

export function buildAtom(items: readonly FeedItem[], meta: FeedMeta): string {
  const updated = new Date(items[0]?.ts ?? meta.nowMs).toISOString();
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom">`,
    `  <title>${escapeXml(meta.title)}</title>`,
    `  <subtitle>${escapeXml(meta.subtitle)}</subtitle>`,
    `  <id>${escapeXml(meta.selfUrl)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(meta.selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(meta.siteUrl)}/flights?tab=recent"/>`,
    `  <updated>${updated}</updated>`,
    `  <author><name>SmokySignal</name></author>`,
    `  <icon>${escapeXml(meta.siteUrl)}/icons/favicon-96.png</icon>`,
  ];
  for (const it of items) {
    const iso = new Date(it.ts).toISOString();
    lines.push(
      `  <entry>`,
      `    <id>${escapeXml(it.id)}</id>`,
      `    <title>${escapeXml(it.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(it.link)}"/>`,
      `    <updated>${iso}</updated>`,
      `    <published>${iso}</published>`,
      `    <category term="${it.type}"/>`,
      `    <summary>${escapeXml(it.summary)}</summary>`,
      `  </entry>`,
    );
  }
  lines.push(`</feed>`);
  return lines.join("\n") + "\n";
}

export function buildRss(items: readonly FeedItem[], meta: FeedMeta): string {
  const last = new Date(items[0]?.ts ?? meta.nowMs).toUTCString();
  const lines = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `  <channel>`,
    `    <title>${escapeXml(meta.title)}</title>`,
    `    <link>${escapeXml(meta.siteUrl)}/activity</link>`,
    `    <description>${escapeXml(meta.subtitle)}</description>`,
    `    <language>en-us</language>`,
    `    <lastBuildDate>${last}</lastBuildDate>`,
    `    <ttl>1</ttl>`,
    `    <atom:link href="${escapeXml(meta.selfUrl)}" rel="self" type="application/rss+xml"/>`,
  ];
  for (const it of items) {
    lines.push(
      `    <item>`,
      `      <title>${escapeXml(it.title)}</title>`,
      `      <link>${escapeXml(it.link)}</link>`,
      `      <guid isPermaLink="false">${escapeXml(it.id)}</guid>`,
      `      <pubDate>${new Date(it.ts).toUTCString()}</pubDate>`,
      `      <category>${it.type}</category>`,
      `      <description>${escapeXml(it.summary)}</description>`,
      `    </item>`,
    );
  }
  lines.push(`  </channel>`, `</rss>`);
  return lines.join("\n") + "\n";
}
