// Blog content model: frontmatter, validation, ordering, neighbours,
// Article JSON-LD and the Atom feed. Also checks every committed post in
// content/blog parses and passes the voice rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  articleJsonLd,
  blogAtomEntries,
  DEFAULT_RELATED,
  filterByKind,
  formatPostDate,
  jsonLdScript,
  neighbours,
  parseFrontmatter,
  parsePost,
  postTimestamp,
  readingMinutes,
  routeLabel,
  sortPosts,
  type BlogPost,
} from "./blog-core";
import { voiceViolations } from "./blog-weekly";
import { buildAtom } from "./feed-xml";

const SRC = `---
title: "SmokySignal, rebuilt: what's new"
date: 2026-11-19
summary: 'One line, with a comma, and an apostrophe''s worth.'
tags: [launch, "radar, history", data]
kind: launch # comment
hero_value: "66"
hero_label: Smokey flights, last 7 days
related: [/radar, /stats, https://example.com]
---

# Heading

Body text here.
`;

test("parseFrontmatter: quoted strings, lists with quoted commas, comments", () => {
  const fm = parseFrontmatter(SRC);
  assert.ok(fm);
  assert.equal(fm.data.title, "SmokySignal, rebuilt: what's new");
  assert.equal(fm.data.summary, "One line, with a comma, and an apostrophe's worth.");
  assert.deepEqual(fm.data.tags, ["launch", "radar, history", "data"]);
  assert.equal(fm.data.kind, "launch");
  assert.equal(fm.data.hero_label, "Smokey flights, last 7 days");
  assert.equal(fm.body, "# Heading\n\nBody text here.\n");
  assert.equal(parseFrontmatter("no frontmatter"), null);
  assert.equal(parseFrontmatter("---\ntitle: x\n"), null);
});

test("parsePost: valid post, related keeps in-app routes only", () => {
  const r = parsePost("2026-11-19-the-big-update.md", SRC);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.post.slug, "2026-11-19-the-big-update");
  assert.equal(r.post.kind, "launch");
  assert.deepEqual(r.post.hero, { value: "66", label: "Smokey flights, last 7 days" });
  assert.deepEqual(r.post.related, ["/radar", "/stats"]);
  assert.equal(r.post.readingMinutes, 1);
});

test("parsePost: rejects bad names, dates, kinds", () => {
  assert.equal(parsePost("big-update.md", SRC).ok, false);
  assert.equal(parsePost("2026-11-20-the-big-update.md", SRC).ok, false); // date mismatch
  assert.equal(parsePost("2026-11-19-x.md", SRC.replace("kind: launch", "kind: rant")).ok, false);
  assert.equal(parsePost("2026-11-19-x.md", SRC.replace(/^title:.*$/m, "")).ok, false);
  const noRelated = parsePost("2026-11-19-x.md", SRC.replace(/^related:.*$/m, "").replace("kind: launch", "kind: weekly"));
  assert.ok(noRelated.ok && noRelated.post.related === DEFAULT_RELATED.weekly);
});

test("readingMinutes: about 220 words a minute, floor of one", () => {
  assert.equal(readingMinutes("short"), 1);
  assert.equal(readingMinutes(Array(1100).fill("word").join(" ")), 5);
  // Link targets and code fences do not count.
  assert.equal(readingMinutes(`[a](/x/y/z) ${"```\n" + Array(2000).fill("x").join(" ") + "\n```"}`), 1);
});

function post(slug: string, kind: BlogPost["kind"] = "weekly"): BlogPost {
  return {
    slug,
    title: slug,
    date: slug.slice(0, 10),
    summary: `summary ${slug}`,
    tags: [],
    kind,
    hero: null,
    related: [],
    body: "",
    readingMinutes: 1,
  };
}

test("sortPosts / neighbours / filterByKind", () => {
  const sorted = sortPosts([
    post("2026-11-18-week-47"),
    post("2026-11-25-week-48"),
    post("2026-11-19-the-big-update", "launch"),
  ]);
  assert.deepEqual(
    sorted.map((p) => p.slug),
    ["2026-11-25-week-48", "2026-11-19-the-big-update", "2026-11-18-week-47"],
  );
  const n = neighbours(sorted, "2026-11-19-the-big-update");
  assert.equal(n.newer?.slug, "2026-11-25-week-48");
  assert.equal(n.older?.slug, "2026-11-18-week-47");
  assert.deepEqual(neighbours(sorted, "nope"), { newer: null, older: null });
  assert.equal(filterByKind(sorted, "launch").length, 1);
  assert.equal(filterByKind(sorted, "bogus").length, 3);
  assert.equal(filterByKind(sorted, null).length, 3);
});

test("dates: calendar formatting and a timestamp that stays on the PT day", () => {
  assert.equal(formatPostDate("2026-11-19"), "19 Nov 2026");
  const ts = postTimestamp("2026-07-04");
  const pt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(ts);
  assert.equal(pt, "2026-07-04");
});

test("postTimestamp: 00:00 Pacific on the post date, both sides of DST", () => {
  const far = Date.UTC(2030, 0, 1);
  // PST (-8): midnight is 08:00 UTC.
  assert.equal(new Date(postTimestamp("2026-11-19", far)).toISOString(), "2026-11-19T08:00:00.000Z");
  // PDT (-7): midnight is 07:00 UTC.
  assert.equal(new Date(postTimestamp("2026-07-04", far)).toISOString(), "2026-07-04T07:00:00.000Z");
  // DST change days: midnight comes before the 02:00 flip, so it keeps the old offset.
  assert.equal(new Date(postTimestamp("2026-03-08", far)).toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(new Date(postTimestamp("2026-11-01", far)).toISOString(), "2026-11-01T07:00:00.000Z");
});

test("postTimestamp: a post shipped on its own date is never in the future", () => {
  // The launch post shipped the morning of 19 Nov PT (09:30 PST). The old
  // noon-PT stamp (20:00Z) sat hours ahead of that deploy.
  const deploy = Date.UTC(2026, 10, 19, 17, 30);
  assert.ok(postTimestamp("2026-11-19", deploy) <= deploy);
  assert.ok(postTimestamp("2026-11-19", deploy) < Date.parse("2026-11-19T20:00:00Z"));
  const justAfterMidnight = Date.UTC(2026, 10, 19, 8, 1);
  assert.ok(postTimestamp("2026-11-19", justAfterMidnight) <= justAfterMidnight);
  // A future-dated post clamps to now instead of pointing ahead.
  const now = Date.UTC(2026, 10, 19, 12);
  assert.equal(postTimestamp("2026-12-25", now), now);
});

test("postTimestamp: JSON-LD and Atom agree on the same instant", () => {
  const r = parsePost("2026-11-19-the-big-update.md", SRC);
  assert.ok(r.ok);
  if (!r.ok) return;
  const iso = new Date(postTimestamp(r.post.date)).toISOString();
  assert.equal(iso, "2026-11-19T08:00:00.000Z");
  const ld = articleJsonLd(r.post, "https://www.smokysignal.app");
  assert.equal(ld.datePublished, iso);
  assert.equal(ld.dateModified, iso);
  const [entry] = blogAtomEntries([r.post], "https://www.smokysignal.app");
  assert.equal(new Date(entry!.ts).toISOString(), iso);
});

test("routeLabel", () => {
  assert.equal(routeLabel("/stats"), "Stats");
  assert.equal(routeLabel("/wrap/2026"), "Season wrap 2026");
  assert.equal(routeLabel("/road/sr-512"), "Road: SR-512");
  assert.equal(routeLabel("/plane/N305DK"), "Logbook: N305DK");
});

test("articleJsonLd: Article with publisher, image and canonical url; script-safe", () => {
  const p = { ...post("2026-11-19-the-big-update", "launch"), title: "A </script> title" };
  const ld = articleJsonLd(p, "https://www.smokysignal.app");
  assert.equal(ld["@type"], "Article");
  assert.equal(ld.url, "https://www.smokysignal.app/blog/2026-11-19-the-big-update");
  assert.deepEqual(ld.image, ["https://www.smokysignal.app/blog/2026-11-19-the-big-update/og"]);
  assert.equal(ld.datePublished, "2026-11-19T08:00:00.000Z");
  const s = jsonLdScript(ld);
  assert.ok(!s.includes("</script>"));
  assert.equal(JSON.parse(s).headline, "A </script> title");
});

test("blog Atom feed: entries, alternate link, escaped category", () => {
  const sorted = sortPosts([post("2026-11-18-week-47"), post("2026-11-19-the-big-update", "launch")]);
  const xml = buildAtom(blogAtomEntries(sorted, "https://www.smokysignal.app"), {
    siteUrl: "https://www.smokysignal.app",
    selfUrl: "https://www.smokysignal.app/blog/feed.xml",
    alternateUrl: "https://www.smokysignal.app/blog",
    title: "SmokySignal · Blog",
    subtitle: "s",
    nowMs: 0,
  });
  assert.match(xml, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  assert.match(xml, /<link rel="alternate" type="text\/html" href="https:\/\/www.smokysignal.app\/blog"\/>/);
  assert.match(xml, /<updated>2026-11-19T08:00:00.000Z<\/updated>/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2);
  assert.match(xml, /<id>tag:www.smokysignal.app,2026-11-19:blog\/2026-11-19-the-big-update<\/id>/);
  assert.match(xml, /<category term="launch"\/>/);
});

test("content/blog: every committed post parses and passes the voice rules", () => {
  const dir = path.join(process.cwd(), "content", "blog");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".md")) : [];
  assert.ok(names.length >= 1, "at least one post");
  for (const name of names) {
    const src = fs.readFileSync(path.join(dir, name), "utf8");
    const r = parsePost(name, src);
    assert.ok(r.ok, r.ok ? name : r.error);
    src.split("\n").forEach((line, i) => {
      if (line === "---" || line.startsWith("```")) return;
      assert.deepEqual(voiceViolations(line), [], `${name}:${i + 1}: ${line}`);
    });
  }
});
