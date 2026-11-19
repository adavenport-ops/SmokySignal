import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parsePost } from "./blog-core";
import type { MediaManifest } from "./blog-media-core";
import {
  BLUESKY_LIMIT,
  NEXTDOOR_LIMIT,
  SHORT_CAPTION_LIMIT,
  buildSocialPack,
  charCount,
  clip,
  keyLines,
  packStrings,
  packViolations,
  renderPackMarkdown,
  socialViolations,
} from "./social-pack";

const ROOT = process.cwd();
const LAUNCH = "2026-11-19-the-big-update";

function launch() {
  const src = fs.readFileSync(path.join(ROOT, "content", "blog", `${LAUNCH}.md`), "utf8");
  const r = parsePost(`${LAUNCH}.md`, src);
  assert.ok(r.ok);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "public", "blog", "media", LAUNCH, "manifest.json"), "utf8"),
  ) as MediaManifest;
  return { post: r.post, manifest };
}

const WEEKLY = `---
title: "Week 46: 66 Smokey flights, 12.4 hours aloft"
date: 2026-11-18
summary: "When the bird flew, 12 Nov to 18 Nov: 66 Smokey flights, 12.4 hours aloft, busiest on Wednesday."
tags: [weekly, stats]
kind: weekly
hero_value: "12.4 h"
hero_label: "Smokey aloft, 12 Nov to 18 Nov"
---

Week ending Wednesday.

## When the bird flew

| | This week | Last week | Change |
|---|---:|---:|---:|
| Smokey flights | 66 | 58 | +8 |
| Smokey hours aloft | 12.4 | 10.1 | +2.3 |

- **Busiest day:** Wed 11 Nov, 4.0 h aloft across 9 flights.
`;

function weekly() {
  const r = parsePost("2026-11-18-week-46.md", WEEKLY);
  assert.ok(r.ok);
  return r.post;
}

test("the launch pack respects every limit and the voice rules", () => {
  const { post, manifest } = launch();
  const pack = buildSocialPack(post, manifest);
  assert.deepEqual(packViolations(pack), []);
  assert.ok(charCount(pack.bluesky) <= BLUESKY_LIMIT, `bluesky ${charCount(pack.bluesky)}`);
  assert.ok(pack.bluesky.endsWith(pack.url), "the link survives");
  for (const s of pack.shorts) assert.ok(charCount(s.caption) <= SHORT_CAPTION_LIMIT);
  assert.ok(charCount(pack.nextdoor) <= NEXTDOOR_LIMIT);
  assert.equal(pack.shorts.length, 2);
});

test("a weekly pack quotes the week's numbers and has an image", () => {
  const post = weekly();
  const pack = buildSocialPack(post, null);
  assert.match(pack.reddit.body, /Smokey flights: 66 \(last week 58\)/);
  assert.match(pack.reddit.body, /Busiest day: Wed 11 Nov/);
  assert.match(pack.reddit.body, /Source: SmokySignal \(smokysignal\.app\)/);
  assert.equal(pack.reddit.image, null);
  assert.deepEqual(packViolations(pack), []);
  assert.deepEqual(pack.shorts.map((s) => s.clip), [null, null]);
});

test("the best image is a real screenshot as a png under public/", () => {
  const { post, manifest } = launch();
  const img = buildSocialPack(post, manifest).reddit.image;
  assert.ok(img);
  assert.match(img.path, /^public\/blog\/media\/2026-11-19-the-big-update\/[a-z0-9-]+\.(png|jpg)$/);
  assert.equal(img.illustrative, false);
  assert.ok(fs.existsSync(path.join(ROOT, img.path)));
});

test("shorts reference the clips in the manifest", () => {
  const { post, manifest } = launch();
  const clips = new Set(manifest.items.filter((i) => i.kind === "clip").map((i) => i.id));
  const pack = buildSocialPack(post, manifest);
  for (const s of pack.shorts) assert.ok(s.clip && clips.has(s.clip), `clip ${s.clip}`);
});

test("a long summary still fits Bluesky with the link intact", () => {
  const post = weekly();
  post.summary = `When the bird flew: ${"a very long run of words about aircraft over the Sound ".repeat(12)}`;
  const pack = buildSocialPack(post, null);
  assert.ok(charCount(pack.bluesky) <= BLUESKY_LIMIT);
  assert.ok(pack.bluesky.endsWith(pack.url));
  assert.deepEqual(packViolations(pack), []);
});

test("socialViolations catches banned words, exclamation marks and emoji", () => {
  assert.deepEqual(socialViolations("Smokey was up from 14:00 to 15:10. Ease off."), []);
  assert.ok(socialViolations("Check the police plane").includes("police"));
  assert.ok(socialViolations("Cops about").includes("cop"));
  assert.ok(socialViolations("Evade the bird").includes("evade"));
  assert.ok(socialViolations("Dodge the ticket").includes("dodge"));
  assert.ok(socialViolations("Smokey is up!").includes("exclamation"));
  assert.ok(socialViolations("Smokey is up \u{1F6A8}").includes("emoji"));
  assert.ok(socialViolations("Smoky is up").includes("Smoky"));
});

test("whole words only: helicopter, copy and SmokySignal pass", () => {
  assert.deepEqual(socialViolations("A helicopter, a copy, a scope. SmokySignal."), []);
});

test("a pack with a bad word in the post is flagged with where it is", () => {
  const post = weekly();
  post.summary = "Police aircraft flew 66 flights!";
  const bad = packViolations(buildSocialPack(post, null));
  assert.ok(bad.some((b) => b.startsWith("bluesky: police")));
  assert.ok(bad.some((b) => b.startsWith("reddit body: exclamation")));
});

test("clip() cuts on a word and keeps the limit", () => {
  const out = clip("one two three four five six seven eight nine ten", 24);
  assert.ok(charCount(out) <= 24);
  assert.ok(out.endsWith("."));
  assert.equal(clip("short", 24), "short");
});

test("keyLines reads the first table and the bold bullets", () => {
  const lines = keyLines(weekly().body);
  assert.equal(lines[0], "Smokey flights: 66 (last week 58)");
  assert.ok(lines.some((l) => l.startsWith("Busiest day:")));
});

test("the rendered markdown has every section and passes the voice check", () => {
  const { post, manifest } = launch();
  const pack = buildSocialPack(post, manifest);
  const md = renderPackMarkdown(pack, "2026-11-19");
  for (const h of ["## Reddit", "## Bluesky (", "## Shorts", "## Nextdoor"]) assert.ok(md.includes(h), h);
  assert.deepEqual(socialViolations(md), []);
  assert.ok(packStrings(pack).length >= 5);
});
