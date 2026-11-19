// Run: npx tsx --test lib/seo/audit-parse.test.ts
//
// Parsers behind scripts/seo-audit.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attr,
  decodeEntities,
  duplicates,
  internalLinks,
  pageIssues,
  parsePage,
  parseRobots,
  parseSitemap,
  robotsAllows,
  visibleText,
  wordCount,
} from "./audit-parse";

const PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charSet="utf-8"/>
<title>Planes over I-5, Tumwater to Everett · SmokySignal</title>
<meta name="description" content="What flew over I-5 between Tumwater and Everett in the last 30 days: passes, hours, the busiest stretch, and who flew it."/>
<link rel="canonical" href="https://www.smokysignal.app/road/i-5"/>
<meta property="og:title" content="Planes over I-5 · SmokySignal"/>
<meta property="og:image" content="https://www.smokysignal.app/road/i-5/opengraph-image?abc"/>
<meta name="twitter:card" content="summary_large_image"/>
</head><body>
<script>self.__next_f.push([1,"hidden words that are not visible"])</script>
<main><h1 class="x">I-5</h1><p>What&rsquo;s circling &amp; where.</p>
<a href="/road">Road history</a> <a href="https://www.smokysignal.app/plane/N305DK">N305DK</a>
<a href="https://adsb.fi">adsb.fi</a> <a href="mailto:x@y.z">mail</a> <a href="#top">top</a>
<img src="/a.png" alt="A"/><img src="/b.png"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"I-5","url":"https://www.smokysignal.app/road/i-5"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dataset","name":"x"}</script>
</main></body></html>`;

test("parsePage pulls head metadata, h1s, JSON-LD, links and alt gaps", () => {
  const f = parsePage(PAGE);
  assert.equal(f.title, "Planes over I-5, Tumwater to Everett · SmokySignal");
  assert.equal(f.titleCount, 1);
  assert.match(f.description!, /^What flew over I-5/);
  assert.equal(f.canonical, "https://www.smokysignal.app/road/i-5");
  assert.equal(f.h1Count, 1);
  assert.deepEqual(f.h1Texts, ["I-5"]);
  assert.match(f.ogImage!, /opengraph-image/);
  assert.equal(f.twitterCard, "summary_large_image");
  assert.equal(f.jsonLd.length, 2);
  assert.deepEqual(f.jsonLd[0]!.errors, []);
  assert.deepEqual(f.jsonLd[0]!.types, ["WebPage"]);
  assert.ok(f.jsonLd[1]!.errors.length > 0, "incomplete Dataset flagged");
  assert.equal(f.imagesMissingAlt, 1);
  assert.equal(f.robots, null);
  assert.ok(f.links.includes("/road"));
});

test("visibleText drops scripts and decodes entities; wordCount counts words", () => {
  const t = visibleText(PAGE);
  assert.ok(!t.includes("hidden words"));
  assert.ok(t.includes("What’s circling & where."));
  assert.equal(wordCount("Smokey's up. I-5 at 1,800 ft."), 6);
});

test("decodeEntities and attr", () => {
  assert.equal(decodeEntities("a &amp; b &#39;c&#x27; &middot;"), "a & b 'c' ·");
  assert.equal(attr('<a href="/x?a=1&amp;b=2" rel=nofollow>', "href"), "/x?a=1&b=2");
  assert.equal(attr('<a href="/x" rel=nofollow>', "rel"), "nofollow");
  assert.equal(attr("<a>", "href"), null);
});

test("parseSitemap", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://www.smokysignal.app/</loc><lastmod>2026-11-18</lastmod></url><url><loc>
  https://www.smokysignal.app/plane/N305DK</loc></url></urlset>`;
  assert.deepEqual(parseSitemap(xml), ["https://www.smokysignal.app/", "https://www.smokysignal.app/plane/N305DK"]);
});

test("parseRobots + robotsAllows: groups, longest match, Allow beats shorter Disallow", () => {
  const txt = [
    "User-Agent: *",
    "Allow: /",
    "Allow: /embed/help",
    "Disallow: /admin",
    "Disallow: /embed",
    "",
    "User-Agent: GPTBot",
    "User-Agent: ClaudeBot",
    "Allow: /",
    "Disallow: /admin",
    "",
    "Sitemap: https://www.smokysignal.app/sitemap.xml",
  ].join("\n");
  const r = parseRobots(txt);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[1]!.agents, ["GPTBot", "ClaudeBot"]);
  assert.deepEqual(r.sitemaps, ["https://www.smokysignal.app/sitemap.xml"]);
  assert.equal(robotsAllows(r, "Googlebot", "/"), true);
  assert.equal(robotsAllows(r, "Googlebot", "/admin/tracks"), false);
  assert.equal(robotsAllows(r, "Googlebot", "/embed"), false);
  assert.equal(robotsAllows(r, "Googlebot", "/embed/help"), true);
  assert.equal(robotsAllows(r, "ClaudeBot", "/program"), true);
  assert.equal(robotsAllows(r, "claudebot", "/admin"), false);
});

test("pageIssues: P0 for missing canonical / description, noindex in sitemap, bad JSON-LD", () => {
  const ok = pageIssues("/road/i-5", 200, parsePage(PAGE));
  assert.ok(ok.some((i) => i.code === "jsonld-invalid" && i.severity === "P0"));
  assert.ok(ok.some((i) => i.code === "img-alt-missing"));
  assert.ok(!ok.some((i) => i.code === "canonical-missing"));

  const bare = parsePage("<html><head><title>x</title><meta name=\"robots\" content=\"noindex, follow\"/></head><body></body></html>");
  const codes = pageIssues("/x", 200, bare).map((i) => `${i.severity}:${i.code}`);
  for (const c of ["P0:canonical-missing", "P0:description-missing", "P0:noindex-in-sitemap", "P1:h1-missing", "P1:title-short"]) {
    assert.ok(codes.includes(c), `${c} in ${codes.join(",")}`);
  }
  assert.deepEqual(pageIssues("/gone", 404, null).map((i) => i.code), ["status"]);
  const mismatch = pageIssues("/road/i-405", 200, parsePage(PAGE));
  assert.ok(mismatch.some((i) => i.code === "canonical-mismatch"));
});

test("pageIssues flags a doubled brand suffix", () => {
  const f = parsePage("<html><head><title>SmokySignal · Stats · SmokySignal</title></head><body><h1>x</h1></body></html>");
  assert.ok(pageIssues("/stats", 200, f).some((i) => i.code === "title-double-brand"));
  const post = parsePage("<html><head><title>SmokySignal, rebuilt: what's new · SmokySignal</title></head><body><h1>x</h1></body></html>");
  assert.ok(!pageIssues("/blog/x", 200, post).some((i) => i.code === "title-double-brand"));
});

test("internalLinks keeps same-site paths only", () => {
  const f = parsePage(PAGE);
  const got = internalLinks(f.links, "http://localhost:3000/road/i-5", ["http://localhost:3000", "https://www.smokysignal.app"]);
  assert.deepEqual(got.sort(), ["/plane/N305DK", "/road"]);
});

test("duplicates groups shared values", () => {
  const d = duplicates(
    new Map([
      ["/a", "T"],
      ["/b", "T"],
      ["/c", "U"],
      ["/d", null],
    ]),
  );
  assert.deepEqual([...d.entries()], [["T", ["/a", "/b"]]]);
});
