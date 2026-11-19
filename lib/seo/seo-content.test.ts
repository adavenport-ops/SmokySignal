// Run: npx tsx --test lib/seo/seo-content.test.ts
//
// Key facts, FAQ sources, llms.txt and the sitemap: counts come from the
// registry, FAQ answers are the page's own words, and the copy stays
// inside the voice rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FLEET } from "../seed";
import { CORRIDORS } from "../corridor";
import type { FleetEntry } from "../types";
import { fleetStats, joinAnd, keyFacts } from "./facts";
import { PROGRAM_FAQ, helpFaq, stripInlineMarkdown } from "./faq";
import { buildLlmsFullTxt, buildLlmsTxt } from "./llms";
import { MAX_FLIGHT_URLS, blogSlug, buildSitemap, frontMatterDate } from "./sitemap-core";
import { ROBOTS_DISALLOW, STATIC_ROUTES, pageMeta } from "./site";

const BANNED_VISIBLE = ["police", "cop", "law enforcement", "drone", "surveilling", "snitch", "evade"];

test("fleetStats counts the seed registry", () => {
  const s = fleetStats(FLEET);
  assert.equal(s.total, FLEET.length);
  assert.equal(s.smokey, FLEET.filter((f) => f.role === "police").length);
  assert.equal(s.wsp + s.waSheriffTails + s.mutualAid, s.smokey);
  assert.deepEqual(s.waSheriffOffices.length, new Set(FLEET.filter((f) => f.policeUnit === "sheriff" && f.scope !== "mutual_aid").map((f) => f.operator)).size);
  assert.equal(s.fixedWing + s.rotorcraft, s.total);
});

test("key facts: 5 to 8 sentences, numbers from the registry, voice-clean", () => {
  const facts = keyFacts(FLEET);
  assert.ok(facts.length >= 5 && facts.length <= 8, `${facts.length} facts`);
  const s = fleetStats(FLEET);
  assert.ok(facts[0]!.includes(`tracks ${s.total} aircraft`), facts[0]);
  assert.ok(facts[1]!.startsWith(`${s.smokey} of them`), facts[1]);
  for (const f of facts) {
    assert.ok(f.endsWith("."), f);
    assert.ok(!f.includes("!"), f);
    for (const w of BANNED_VISIBLE) assert.ok(!f.toLowerCase().includes(w), `"${w}" in ${f}`);
  }
});

test("key facts follow the registry, not literals", () => {
  const smaller: FleetEntry[] = FLEET.filter((f) => f.operator !== "KCSO");
  const s = fleetStats(smaller);
  assert.ok(keyFacts(smaller)[0]!.includes(`tracks ${s.total} aircraft`));
  assert.ok(!keyFacts(smaller)[1]!.includes("King"));
});

test("joinAnd", () => {
  assert.equal(joinAnd([]), "");
  assert.equal(joinAnd(["a"]), "a");
  assert.equal(joinAnd(["a", "b", "c"]), "a, b and c");
});

test("program FAQ answers appear verbatim on /program", () => {
  const src = fs
    .readFileSync(path.join(process.cwd(), "app", "(tabs)", "program", "page.tsx"), "utf8")
    .replace(/&rsquo;/g, "'")
    .replace(/\{" "\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  for (const e of PROGRAM_FAQ) {
    for (const sentence of e.answer.split(/(?<=\.)\s+/)) {
      assert.ok(src.includes(sentence), `not on /program: "${sentence}"`);
    }
  }
});

test("help FAQ parser: question headings, renamed headings, trouble bullets", () => {
  const md = [
    "# Title",
    "",
    "## What this is",
    "",
    "SmokySignal is a [tool](/x) for **riders**.",
    "Second line.",
    "",
    "More text.",
    "",
    "## Why is it still learning?",
    "",
    "Because `30` days.",
    "",
    "## Settings",
    "",
    "Not a question.",
    "",
    "## When something looks wrong",
    "",
    "- **The feed is empty.** Wait a bit.",
    "- **\"No fix\" on Spotted.** Allow location.",
    "- **Map key missing.** Set the environment variable.",
  ].join("\n");
  const faq = helpFaq(md);
  assert.deepEqual(
    faq.map((e) => e.question),
    ["What is SmokySignal?", "Why is it still learning?", "What if the feed is empty?", 'What does "No fix" on Spotted mean?'],
  );
  assert.equal(faq[0]!.answer, "SmokySignal is a tool for riders. Second line.");
  assert.equal(faq[1]!.answer, "Because 30 days.");
});

test("stripInlineMarkdown", () => {
  assert.equal(stripInlineMarkdown("**a** [b](/c) `d` _e_"), "a b d e");
});

test("llms.txt: H1, summary blockquote, counts, sections, endpoints", () => {
  const txt = buildLlmsTxt(FLEET);
  const s = fleetStats(FLEET);
  assert.ok(txt.startsWith("# SmokySignal\n"));
  assert.match(txt, /^> .+/m);
  assert.ok(txt.includes(`It tracks ${s.total} aircraft`));
  for (const h of [
    "## Key facts",
    "## Who flies over Washington",
    "## How aerial speed enforcement works in Washington",
    "## Data sources and licences",
    "## What we don't store",
    "## Key pages",
    "## Machine-readable endpoints",
    "## Optional",
  ]) {
    assert.ok(txt.includes(h), h);
  }
  assert.ok(txt.includes("https://www.smokysignal.app/data/flight-hours.csv"));
  assert.ok(txt.includes("https://www.smokysignal.app/api/status.json"));
  assert.ok(txt.includes("ODbL"));
  assert.ok(!/[A-Za-z]!(\s|$)/.test(txt), "no exclamation marks");
});

test("llms-full.txt: every tail and every corridor", () => {
  const txt = buildLlmsFullTxt(FLEET, CORRIDORS, PROGRAM_FAQ);
  for (const f of FLEET) assert.ok(txt.includes(`| ${f.tail} |`), f.tail);
  for (const c of CORRIDORS) assert.ok(txt.includes(`/road/${c.id})`), c.id);
  assert.ok(txt.includes("## Aircraft registry"));
  assert.ok(txt.includes("## Corridors"));
  assert.ok(txt.includes(`### ${PROGRAM_FAQ[0]!.question}`));
});

test("sitemap: static, tails, roads, wraps, blog, capped flights, lastModified everywhere", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const sessions = Array.from({ length: 600 }, (_, i) => ({
    tail: i % 2 ? "N305DK" : "N422CT",
    id: `202611${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}${String(i % 60).padStart(2, "0")}`,
    start_ts: now.getTime() - i * 3_600_000,
    end_ts: now.getTime() - i * 3_600_000 + 1_800_000,
  }));
  const map = buildSitemap({
    now,
    builtAt: now,
    tails: FLEET.map((f) => f.tail),
    corridorIds: CORRIDORS.map((c) => c.id),
    wrapYears: [2026],
    blog: [{ slug: "first-post", lastModified: new Date("2026-11-01") }],
    sessions,
  });
  const urls = map.map((e) => e.url);
  assert.equal(new Set(urls).size, urls.length, "no duplicate URLs");
  for (const r of STATIC_ROUTES) assert.ok(urls.includes(`https://www.smokysignal.app${r.path}`), r.path);
  assert.ok(urls.includes("https://www.smokysignal.app/plane/N305DK"));
  assert.ok(urls.includes("https://www.smokysignal.app/road/i-5"));
  assert.ok(urls.includes("https://www.smokysignal.app/wrap/2026"));
  assert.ok(urls.includes("https://www.smokysignal.app/blog"));
  assert.ok(urls.includes("https://www.smokysignal.app/blog/first-post"));
  assert.ok(urls.filter((u) => u.includes("/flight/")).length <= MAX_FLIGHT_URLS);
  assert.ok(map.every((e) => e.lastModified instanceof Date), "every entry has lastModified");
  for (const d of ROBOTS_DISALLOW) assert.ok(!urls.some((u) => new URL(u).pathname === d), `${d} must not be listed`);
});

test("sitemap without a blog or KV still lists the core URLs", () => {
  const now = new Date();
  const map = buildSitemap({ now, builtAt: now, tails: ["N305DK"], corridorIds: ["i-5"], wrapYears: [2026], blog: null, sessions: [] });
  const urls = map.map((e) => e.url);
  assert.ok(!urls.some((u) => u.includes("/blog")));
  assert.ok(urls.includes("https://www.smokysignal.app/plane/N305DK"));
});

test("blog slug and front matter", () => {
  assert.equal(blogSlug("Hello-World.md"), "hello-world");
  assert.equal(blogSlug("_draft.md"), null);
  assert.equal(blogSlug("notes.txt"), null);
  assert.equal(frontMatterDate("---\ntitle: x\ndate: 2026-11-02\n---\nbody")?.toISOString().slice(0, 10), "2026-11-02");
  assert.equal(frontMatterDate("---\ndate: 2026-11-02\nupdated: 2026-11-09\n---")?.toISOString().slice(0, 10), "2026-11-09");
  assert.equal(frontMatterDate("no front matter"), null);
});

test("pageMeta: canonical, og, twitter agree; noindex flag; default image", () => {
  const m = pageMeta({ title: "Radar", description: "d", path: "/radar", noindex: true });
  assert.equal(m.title, "Radar");
  assert.equal((m.alternates as { canonical: string }).canonical, "/radar");
  assert.equal((m.openGraph as { title: string }).title, "Radar · SmokySignal");
  assert.equal((m.twitter as { title: string }).title, "Radar · SmokySignal");
  assert.deepEqual(m.robots, { index: false, follow: true });
  assert.equal((m.openGraph as { images: Array<{ url: string }> }).images[0]!.url, "/icons/og-image.png");
  const inherit = pageMeta({ title: "t", description: "d", path: "/", inheritImage: true, absoluteTitle: true });
  assert.equal((inherit.openGraph as { images?: unknown }).images, undefined);
  assert.deepEqual(inherit.title, { absolute: "t" });
});
