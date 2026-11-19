// Run: npx tsx --test lib/feed-xml.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEED_LIMIT,
  buildAtom,
  buildRss,
  escapeXml,
  feedItemsFromActivity,
} from "./feed-xml";
import type { ActivityEntry } from "./activity-diff";

const SITE = "https://smokysignal.app";
const T0 = Date.UTC(2026, 10, 18, 22, 22, 0); // 14:22 PT

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    ts: T0,
    tail: "N305DK",
    role: "police",
    kind: "takeoff",
    lat: 47.2393,
    lon: -122.3571,
    alt_ft: 1800,
    description: "Smokey off the deck",
    ...over,
  };
}

const meta = {
  siteUrl: SITE,
  selfUrl: `${SITE}/feed.xml`,
  title: "SmokySignal · Smokey up and down",
  subtitle: "Takeoffs & landings <test>",
  nowMs: T0,
};

/** Every & starts an entity, and every tag is one the builders emit. */
function assertEscaped(xml: string) {
  assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(xml), "bare ampersand");
  const allowed = new Set([
    "?xml", "feed", "title", "subtitle", "id", "link", "updated", "author", "name",
    "icon", "entry", "published", "category", "summary", "rss", "channel",
    "description", "language", "lastBuildDate", "ttl", "atom:link", "item", "guid", "pubDate",
  ]);
  for (const m of xml.matchAll(/<\/?([?a-zA-Z:]+)/g)) {
    assert.ok(allowed.has(m[1]!), `unexpected tag <${m[1]}>`);
  }
}

test("escapeXml: the five entities, and control characters dropped", () => {
  assert.equal(escapeXml(`a & b < c > d "e" 'f'`), "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
  assert.equal(escapeXml("x\u0000y\u0007z\u000bw"), "xyzw");
  assert.equal(escapeXml("tab\tnl\n"), "tab\tnl\n");
  assert.equal(escapeXml("&amp;"), "&amp;amp;");
});

test("items: takeoffs + landings only, police by default, ?all=1 widens", () => {
  const entries = [
    entry({ ts: T0, kind: "takeoff" }),
    entry({ ts: T0 - 1, kind: "squawk_emergency" }),
    entry({ ts: T0 - 2, kind: "landing", tail: "N2446X", role: "police" }),
    entry({ ts: T0 - 3, kind: "takeoff", tail: "N95SR", role: "sar" }),
    entry({ ts: T0 - 4, kind: "first_seen", tail: "N1UK", role: undefined }),
    entry({ ts: T0 - 5, kind: "altitude_change" }),
    // Pre-2026-11 feed row: legacy "patrol" maps to police.
    entry({ ts: T0 - 6, kind: "takeoff", tail: "N9OLD", role: "patrol" as never }),
  ];
  const nick = (t: string) => (t === "N305DK" ? "Smokey 4" : null);
  const def = feedItemsFromActivity(entries, { siteUrl: SITE, nicknameOf: nick });
  assert.deepEqual(
    def.map((i) => [i.tail, i.type]),
    [
      ["N305DK", "takeoff"],
      ["N2446X", "landing"],
      ["N9OLD", "takeoff"],
    ],
  );
  assert.equal(def[0]!.title, "Smokey 4 up · I-5 · Fife · 14:22 PT");
  assert.equal(def[0]!.link, `${SITE}/plane/N305DK`);
  const all = feedItemsFromActivity(entries, { siteUrl: SITE, all: true });
  assert.equal(all.length, 5);
  assert.ok(all.some((i) => i.tail === "N95SR"));
  assert.ok(all.some((i) => i.tail === "N1UK"), "unknown no longer alerts, but ?all=1 keeps it");
});

test("items: mutual-aid police outside Washington stay out of the default feed", () => {
  const entries = [
    entry({ ts: T0, tail: "N1OSP", lat: 44.9, lon: -123.0 }), // Salem, OR
    entry({ ts: T0 - 1, tail: "N1OSP", lat: 45.7, lon: -122.6 }), // Vancouver, WA
  ];
  const items = feedItemsFromActivity(entries, {
    siteUrl: SITE,
    scopeOf: (t) => (t === "N1OSP" ? "mutual_aid" : "wa"),
  });
  assert.deepEqual(items.map((i) => i.ts), [T0 - 1]);
});

test("items: newest first, capped at 100, stable unique ids", () => {
  const entries = Array.from({ length: 150 }, (_, i) => entry({ ts: T0 - i * 60_000 }));
  const items = feedItemsFromActivity(entries.reverse(), { siteUrl: SITE });
  assert.equal(items.length, FEED_LIMIT);
  assert.equal(items[0]!.ts, T0);
  assert.ok(items[0]!.ts > items[1]!.ts);
  assert.equal(new Set(items.map((i) => i.id)).size, FEED_LIMIT);
  assert.match(items[0]!.id, /^tag:smokysignal\.app,2026-11-18:activity\/N305DK\/takeoff\/\d+$/);
});

test("atom: well-formed shape, self link, entries, hostile text escaped", () => {
  const items = feedItemsFromActivity(
    [entry({ description: `<script>alert("x")</script> & co` })],
    { siteUrl: SITE, nicknameOf: () => `Bird "<1>" & friends` },
  );
  const xml = buildAtom(items, meta);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'));
  assert.ok(xml.trimEnd().endsWith("</feed>"));
  assert.ok(xml.includes(`<link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>`));
  assert.equal(xml.match(/<entry>/g)?.length, 1);
  assert.equal(xml.match(/<\/entry>/g)?.length, 1);
  assert.ok(xml.includes("<title>Bird &quot;&lt;1&gt;&quot; &amp; friends up · I-5 · Fife · 14:22 PT</title>"));
  assert.ok(xml.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co"));
  assert.ok(!xml.includes("<script>"));
  assert.ok(xml.includes("<subtitle>Takeoffs &amp; landings &lt;test&gt;</subtitle>"));
  assert.ok(xml.includes("<updated>2026-11-18T22:22:00.000Z</updated>"));
  assertEscaped(xml);
});

test("atom: empty feed still valid, updated from now", () => {
  const xml = buildAtom([], meta);
  assert.ok(!xml.includes("<entry>"));
  assert.ok(xml.includes("<updated>2026-11-18T22:22:00.000Z</updated>"));
});

test("rss: channel, items, RFC 822 dates, escaped", () => {
  const items = feedItemsFromActivity([entry({}), entry({ ts: T0 - 60_000, kind: "landing" })], {
    siteUrl: SITE,
  });
  const xml = buildRss(items, { ...meta, selfUrl: `${SITE}/rss.xml` });
  assert.ok(xml.includes('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">'));
  assert.equal(xml.match(/<item>/g)?.length, 2);
  assert.ok(xml.includes("<pubDate>Wed, 18 Nov 2026 22:22:00 GMT</pubDate>"));
  assert.ok(xml.includes('<guid isPermaLink="false">tag:smokysignal.app,'));
  assertEscaped(xml);
});
