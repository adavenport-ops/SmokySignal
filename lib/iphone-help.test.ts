// Run: npx tsx --test lib/iphone-help.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import {
  IPHONE_HELP_ANCHORS,
  IPHONE_HELP_DESCRIPTION,
  IPHONE_HELP_PATH,
  IPHONE_HELP_TITLE,
  IPHONE_LOCATION_HREF,
} from "./iphone-help";
import { geoHelpHref } from "./geo-error";
import { allNavItems } from "./nav";
import { STATIC_ROUTES } from "./seo/site";
import { KEY_PAGES } from "./seo/llms";
import { urlsForChangedFiles } from "./seo/indexnow";

const MD = fs.readFileSync(path.join(process.cwd(), "content", "help-iphone.md"), "utf8");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";

function headingSlugs(md: string): string[] {
  const slugger = new GithubSlugger();
  return md
    .split("\n")
    .filter((l) => /^#{1,6} /.test(l))
    .map((l) => slugger.slug(l.replace(/^#+\s+/, "").replace(/\*\*/g, "")));
}

test("every anchor the app links to is a heading on the page", () => {
  const slugs = headingSlugs(MD);
  for (const [key, id] of Object.entries(IPHONE_HELP_ANCHORS)) {
    assert.ok(slugs.includes(id), `${key}: #${id} not in ${slugs.join(", ")}`);
  }
  assert.equal(IPHONE_LOCATION_HREF, "/help/iphone#2-turn-on-location");
});

test("steps come in the order riders need them: home screen, location, notifications, voice", () => {
  const order = ["Add it to the home screen", "Turn on location", "Allow notifications", "Voice readback"].map((h) =>
    MD.indexOf(h),
  );
  assert.ok(order.every((i) => i > 0), "all four steps present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(MD, /Location Services/);
  assert.match(MD, /Safari Websites/);
  assert.match(MD, /While Using the App/);
  assert.match(MD, /Add to Home Screen/);
  assert.match(MD, /Arm alerts/);
});

test("copy follows the brand voice", () => {
  const text = [MD, IPHONE_HELP_TITLE, IPHONE_HELP_DESCRIPTION].join("\n");
  assert.ok(!/[A-Za-z]!(\s|$|")/.test(text), "no exclamation marks");
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), "no emoji");
  assert.ok(!/police|\bcops?\b|law enforcement|drone|\bevade\b|\bSmoky\b/i.test(text), "no voice-gate words");
});

test("a blocked iPhone gets the steps link; other blocks and slow fixes do not", () => {
  assert.equal(geoHelpHref(1, IPHONE), IPHONE_LOCATION_HREF);
  assert.equal(geoHelpHref(1, CHROME), null);
  assert.equal(geoHelpHref(3, IPHONE), null);
  assert.equal(geoHelpHref(undefined, IPHONE), null);
});

test("the page is in the nav, the sitemap, llms.txt and IndexNow", () => {
  assert.ok(allNavItems().some((i) => i.href === IPHONE_HELP_PATH));
  assert.ok(STATIC_ROUTES.some((r) => r.path === IPHONE_HELP_PATH));
  assert.ok(KEY_PAGES.some((p) => p.path === IPHONE_HELP_PATH));
  assert.ok(urlsForChangedFiles(["content/help-iphone.md"]).some((u) => u.endsWith(IPHONE_HELP_PATH)));
  assert.ok(urlsForChangedFiles(["app/help/iphone/page.tsx"]).some((u) => u.endsWith(IPHONE_HELP_PATH)));
});
