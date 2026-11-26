// Run: npx tsx --test lib/seo/indexnow.test.ts
//
// IndexNow: the key file matches the key, payloads carry the host, key,
// keyLocation and ≤ 10,000 canonical URLs, changed files map to the
// right pages, and the daily ping only records what IndexNow accepted.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_KEY_PATH,
  buildIndexNowPayloads,
  canonicalUrl,
  normalizeUrls,
  parseSitemapLocs,
  routeForPageFile,
  urlsForChangedFiles,
} from "./indexnow";
import { submitNew, unsubmitted, type SubmittedSet } from "./indexnow-server";
import { indexnowSubmittedKey } from "../storage-keys";

const S = "https://www.smokysignal.app";

test("the key is 32 hex characters and public/<key>.txt serves exactly it", () => {
  assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
  assert.equal(INDEXNOW_KEY_PATH, `/${INDEXNOW_KEY}.txt`);
  assert.equal(INDEXNOW_KEY_LOCATION, `${S}/${INDEXNOW_KEY}.txt`);
  const file = fs.readFileSync(path.join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`), "utf8");
  assert.equal(file.trim(), INDEXNOW_KEY);
  assert.equal(INDEXNOW_HOST, "www.smokysignal.app");
  assert.equal(INDEXNOW_ENDPOINT, "https://api.indexnow.org/indexnow");
});

test("canonical URLs: paths, apex to www, no query or trailing slash, other hosts dropped", () => {
  assert.equal(canonicalUrl("/near/fife"), `${S}/near/fife`);
  assert.equal(canonicalUrl("https://smokysignal.app/road/i-5/"), `${S}/road/i-5`);
  assert.equal(canonicalUrl(`${S}/seen?place=Fife#x`), `${S}/seen`);
  assert.equal(canonicalUrl("/"), `${S}/`);
  assert.equal(canonicalUrl("https://example.com/near/fife"), null);
  assert.equal(canonicalUrl("javascript:alert(1)"), null);
  assert.equal(canonicalUrl("  "), null);
  assert.deepEqual(normalizeUrls(["/a", `${S}/a`, "/a/", "https://evil.test/a", "/b"]), [`${S}/a`, `${S}/b`]);
});

test("payload: host, key, keyLocation, urlList; split at 10,000", () => {
  const [p] = buildIndexNowPayloads(["/near/fife", "/blog/x"]);
  assert.deepEqual(p, {
    host: "www.smokysignal.app",
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: [`${S}/near/fife`, `${S}/blog/x`],
  });
  assert.deepEqual(buildIndexNowPayloads([]), []);
  const many = Array.from({ length: 10_001 }, (_, i) => `/flight/N1/${i}`);
  const split = buildIndexNowPayloads(many);
  assert.deepEqual(split.map((x) => x.urlList.length), [10_000, 1]);
  assert.ok(split.every((x) => x.urlList.every((u) => u.startsWith(`${S}/`))));
});

test("sitemap <loc> parsing", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>${S}/</loc></url><url><loc>\n ${S}/near/fife \n</loc></url><url><loc>${S}/seen?a=1&amp;b=2</loc></url></urlset>`;
  assert.deepEqual(parseSitemapLocs(xml), [`${S}/`, `${S}/near/fife`, `${S}/seen?a=1&b=2`]);
});

test("page files map to routes; groups drop out; private folders do not", () => {
  assert.equal(routeForPageFile("app/(tabs)/page.tsx"), "/");
  assert.equal(routeForPageFile("app/(tabs)/road/[id]/page.tsx"), "/road/[id]");
  assert.equal(routeForPageFile("app/flight/[tail]/[flightId]/page.tsx"), "/flight/[tail]/[flightId]");
  assert.equal(routeForPageFile("app/(tabs)/near/page.tsx"), "/near");
  assert.equal(routeForPageFile("app/_lib/page.tsx"), null);
  assert.equal(routeForPageFile("app/(tabs)/road/[id]/opengraph-image.tsx"), null);
  assert.equal(routeForPageFile("lib/road.ts"), null);
});

test("changed files → URLs: posts, pages, dynamic expansion, exclusions", () => {
  const urls = urlsForChangedFiles(
    [
      "content/blog/2026-11-19-towns.md",
      "content/blog/media/2026-11-19-towns.json",
      "content/help.md",
      "app/(tabs)/near/page.tsx",
      "app/(tabs)/near/[town]/page.tsx",
      "app/(tabs)/road/[id]/page.tsx",
      "app/flight/[tail]/[flightId]/page.tsx",
      "app/(tabs)/settings/page.tsx",
      "app/admin/page.tsx",
      "app/api/seen/route.ts",
      "lib/towns.ts",
      "components/TownLive.tsx",
      "",
    ],
    { "/near/[town]": ["fife", "puyallup"], "/road/[id]": ["i-5"] },
  );
  assert.deepEqual(urls, [
    `${S}/blog/2026-11-19-towns`,
    `${S}/blog`,
    `${S}/help`,
    `${S}/near`,
    `${S}/near/fife`,
    `${S}/near/puyallup`,
    `${S}/road/i-5`,
  ]);
  // A dynamic route with no values is skipped rather than guessed.
  assert.deepEqual(urlsForChangedFiles(["app/(tabs)/plane/[tail]/page.tsx"]), []);
  // /embed/help is public; the widget itself is not.
  assert.deepEqual(urlsForChangedFiles(["app/embed/help/page.tsx", "app/embed/page.tsx"]), [`${S}/embed/help`]);
});

function memorySet(initial: string[] = []): SubmittedSet & { members: Set<string>; calls: string[][] } {
  const members = new Set(initial);
  const calls: string[][] = [];
  return {
    members,
    calls,
    async smismember(key, list) {
      assert.equal(key, indexnowSubmittedKey());
      return list.map((m) => (members.has(m) ? 1 : 0));
    },
    async sadd(key, ...list) {
      assert.equal(key, indexnowSubmittedKey());
      calls.push(list);
      for (const m of list) members.add(m);
      return list.length;
    },
  };
}

test("daily ping: skips what was sent, records only what IndexNow accepted", async () => {
  const set = memorySet([`${S}/blog/old`]);
  assert.deepEqual(await unsubmitted(set, ["/blog/old", "/blog/new", "/flight/N1/20261118T2200"]), [
    `${S}/blog/new`,
    `${S}/flight/N1/20261118T2200`,
  ]);

  const bodies: unknown[] = [];
  const ok = await submitNew(set, ["/blog/old", "/blog/new"], async (url, init) => {
    assert.equal(url, INDEXNOW_ENDPOINT);
    bodies.push(JSON.parse(String(init.body)));
    return { status: 202 };
  });
  assert.deepEqual(ok, { candidates: 2, submitted: 1, status: 202 });
  assert.deepEqual((bodies[0] as { urlList: string[] }).urlList, [`${S}/blog/new`]);
  assert.ok(set.members.has(`${S}/blog/new`));

  // Nothing new: no POST at all.
  let posted = false;
  await submitNew(set, ["/blog/new"], async () => {
    posted = true;
    return { status: 200 };
  });
  assert.equal(posted, false);

  // Rejected (e.g. key file not live yet): nothing recorded, so tomorrow retries.
  const before = set.members.size;
  const bad = await submitNew(set, ["/near/fife"], async () => ({ status: 403 }));
  assert.deepEqual(bad, { candidates: 1, submitted: 0, status: 403 });
  assert.equal(set.members.size, before);
});
