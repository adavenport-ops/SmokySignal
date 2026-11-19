// Blog media: the step DSL, capture-manifest validation, the size budget,
// markdown → figure / clip mapping, the weekly stub, and the committed
// launch-post media (every reference resolves, every file exists, the
// folder fits the budget).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  allowRequest,
  CLIP_MAX_BYTES,
  clipOverBudget,
  CRF_MAX,
  CRF_START,
  manifestFiles,
  mediaRefs,
  mergeMediaItems,
  nextCrf,
  parseMediaSrc,
  parseStep,
  POST_MAX_BYTES,
  postOverBudget,
  resolveBlogMedia,
  StepError,
  stepsRunTimeAfterStart,
  validateCaptureManifest,
  vp9Crf,
  weeklyMediaMarkdown,
  weeklyMediaStub,
  type MediaItem,
  type MediaManifest,
} from "./blog-media-core";
import { parsePost } from "./blog-core";

const SLUG = "2026-11-19-the-big-update";

// ─── step DSL ────────────────────────────────────────────────────────

test("parseStep: every op", () => {
  assert.deepEqual(parseStep("goto /radar?h=1"), { op: "goto", path: "/radar?h=1" });
  assert.deepEqual(parseStep("wait 1500"), { op: "wait", ms: 1500 });
  assert.deepEqual(parseStep('waitfor [data-testid="x"] button'), { op: "waitfor", selector: '[data-testid="x"] button' });
  assert.deepEqual(parseStep('click button:has-text("Last 30 days")'), { op: "click", selector: 'button:has-text("Last 30 days")' });
  assert.deepEqual(parseStep("hover .a"), { op: "hover", selector: ".a" });
  assert.deepEqual(parseStep("press Meta+K"), { op: "press", key: "Meta+K" });
  assert.deepEqual(parseStep("type N305DK"), { op: "type", text: "N305DK" });
  assert.deepEqual(parseStep("type two words"), { op: "type", text: "two words" });
  assert.deepEqual(parseStep('select puget_sound [aria-label="Region"]'), {
    op: "select",
    value: "puget_sound",
    selector: '[aria-label="Region"]',
  });
  assert.deepEqual(parseStep("scroll -400"), { op: "scroll", px: -400 });
  assert.deepEqual(parseStep("scrollto #logbook"), { op: "scrollto", selector: "#logbook" });
  assert.deepEqual(parseStep("hide .toast"), { op: "hide", selector: ".toast" });
  assert.deepEqual(parseStep("action orbit3d 6000"), { op: "action", name: "orbit3d", ms: 6000 });
  assert.deepEqual(parseStep("action dismissHint"), { op: "action", name: "dismissHint", ms: 0 });
  assert.deepEqual(parseStep("  start  "), { op: "start" });
  assert.deepEqual(parseStep("WAIT 10"), { op: "wait", ms: 10 });
});

test("parseStep: rejects what it cannot run", () => {
  const bad: Array<[string, RegExp]> = [
    ["", /empty/],
    ["jump 3", /unknown step/],
    ["wait", /missing argument/],
    ["wait soon", /whole number/],
    ["wait 99999", /outside/],
    ["scroll 1.5", /whole number/],
    ["goto radar", /same-origin path/],
    ["goto //evil.example/x", /same-origin path/],
    ["goto /api/cron/rollup", /admin or cron/],
    ["goto /admin", /admin or cron/],
    ["goto /api/admin/migrate-taxonomy", /admin or cron/],
    ["press Meta K", /one key or chord/],
    ["action spin", /unknown "spin"/],
    ["action orbit3d 10 20", /too many/],
    ["start now", /no argument/],
    ["select onlyvalue", /<value> <selector>/],
  ];
  for (const [line, re] of bad) assert.throws(() => parseStep(line), (e: unknown) => e instanceof StepError && re.test((e as Error).message), line);
});

test("stepsRunTimeAfterStart: only the fixed waits after the marker", () => {
  const steps = ["wait 4000", "start", "wait 500", "click .a", "action orbit3d 6000"].map(parseStep);
  assert.equal(stepsRunTimeAfterStart(steps), 6500);
  assert.equal(stepsRunTimeAfterStart(["wait 100", "wait 200"].map(parseStep)), 300);
});

// ─── read-only guard ─────────────────────────────────────────────────

test("allowRequest: GET and HEAD only on the capture origin, never admin or cron", () => {
  const o = ["https://www.smokysignal.app"];
  assert.equal(allowRequest("GET", "https://www.smokysignal.app/api/history?from=a", o), true);
  assert.equal(allowRequest("HEAD", "https://www.smokysignal.app/", o), true);
  assert.equal(allowRequest("POST", "https://www.smokysignal.app/_vercel/insights/event", o), false);
  assert.equal(allowRequest("POST", "https://www.smokysignal.app/api/push/subscribe", o), false);
  assert.equal(allowRequest("GET", "https://www.smokysignal.app/api/cron/refresh-snapshot", o), false);
  assert.equal(allowRequest("GET", "https://www.smokysignal.app/admin", o), false);
  assert.equal(allowRequest("GET", "https://www.smokysignal.app/administer-not", o), true);
  // Third parties: reads only (map tiles), never a write.
  assert.equal(allowRequest("GET", "https://api.maptiler.com/tiles/x.pbf", o), true);
  assert.equal(allowRequest("POST", "https://vitals.vercel-insights.com/v1", o), false);
  assert.equal(allowRequest("GET", "data:image/png;base64,AA", o), true);
});

// ─── manifest validation ─────────────────────────────────────────────

const shot = (over: Record<string, unknown> = {}) => ({
  id: "home-phone",
  kind: "screenshot",
  url: "/",
  viewport: "phone",
  steps: ["wait 1000"],
  caption: "The Now tab.",
  alt: "Home on a phone.",
  ...over,
});

const clip = (over: Record<string, unknown> = {}) =>
  shot({ id: "a-clip", kind: "clip", steps: ["wait 500", "start", "wait 3000"], duration: 4, ...over });

function errorsOf(raw: unknown, slug = SLUG): string[] {
  const r = validateCaptureManifest(raw, slug);
  return r.ok ? [] : r.errors;
}

test("validateCaptureManifest: a good manifest parses, defaults filled", () => {
  const r = validateCaptureManifest({ post: SLUG, shots: [shot(), clip({ posterAt: 2 })] }, SLUG);
  assert.ok(r.ok);
  if (!r.ok) return;
  const [s, c] = r.manifest.shots;
  assert.equal(s!.target, "prod");
  assert.equal(s!.capture, "page");
  assert.equal(s!.duration, null);
  assert.deepEqual(s!.steps, [{ op: "wait", ms: 1000 }]);
  assert.equal(c!.duration, 4);
  assert.equal(c!.posterAt, 2);
});

test("validateCaptureManifest: collects every problem", () => {
  assert.deepEqual(errorsOf(null), ["manifest must be a JSON object"]);
  assert.match(errorsOf({ post: "other", shots: [shot()] }).join("\n"), /"post" must be/);
  assert.match(errorsOf({ post: SLUG, shots: [] }).join("\n"), /non-empty/);
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [shot({ id: "Bad Id" }), /kebab-case/],
    [shot({ kind: "gif" }), /screenshot or clip/],
    [shot({ url: "https://evil.example/" }), /same-origin path/],
    [shot({ url: "/api/cron/rollup" }), /admin or cron/],
    [shot({ viewport: "tablet" }), /phone or desktop/],
    [shot({ steps: ["fly 3"] }), /unknown step/],
    [shot({ steps: "wait 1" }), /array of strings/],
    [shot({ caption: "" }), /"caption" is required/],
    [shot({ alt: " " }), /"alt" is required/],
    [shot({ caption: "Smokey's up!" }), /voice gate: exclamation/],
    [shot({ alt: "A police plane." }), /voice gate: police/],
    [shot({ duration: 3 }), /only applies to clips/],
    [shot({ wat: 1 }), /unknown field "wat"/],
    [clip({ duration: undefined }), /need "duration"/],
    [clip({ duration: 9 }), /over the 8s clip limit/],
    [clip({ posterAt: 7 }), /inside the clip/],
    [clip({ steps: ["start", "wait 6000"], duration: 4 }), /longer than the 4s clip/],
    [clip({ steps: ["start", "start"] }), /only one "start"/],
    [shot({ routes: [{ path: "/api/hotzones", fixture: "f.json" }], illustrative: true, caption: "Illustrative." }), /only runs against a local build/],
    [shot({ target: "local", routes: [{ path: "/api/x", fixture: "../secret.json" }], illustrative: true, caption: "Illustrative." }), /relative path inside/],
    [shot({ target: "local", routes: [{ path: "/api/x", fixture: "f.json" }] }), /mark the shot "illustrative"/],
    [shot({ illustrative: true }), /must say "illustrative"/],
    [shot({ caption: "An illustrative look." }), /not marked illustrative/],
    [shot({ init: ["hackTheGibson"] }), /unknown init script/],
    [shot({ capture: "image", steps: ["wait 1"] }), /takes no steps/],
    [clip({ capture: "image" }), /only applies to screenshots/],
    [clip({ fullPage: true }), /only applies to screenshots/],
    [shot({ cookies: { "bad name": "x" } }), /simple name/],
    [shot({ target: "staging" }), /prod or local/],
  ];
  for (const [s, re] of cases) assert.match(errorsOf({ post: SLUG, shots: [s] }).join("\n"), re, JSON.stringify(s));
  assert.match(errorsOf({ post: SLUG, shots: [shot(), shot()] }).join("\n"), /duplicate id/);
});

test("validateCaptureManifest: the launch post's capture manifest is valid", () => {
  const raw = JSON.parse(fs.readFileSync(path.join("content", "blog", "media", `${SLUG}.json`), "utf8"));
  const r = validateCaptureManifest(raw, SLUG);
  assert.ok(r.ok, r.ok ? "" : r.errors.join("\n"));
  if (!r.ok) return;
  const clips = r.manifest.shots.filter((s) => s.kind === "clip");
  assert.ok(clips.length >= 4);
  // Fixture data only on illustrative, local shots.
  for (const s of r.manifest.shots) if (s.routes.length) assert.ok(s.illustrative && s.target === "local", s.id);
});

// ─── budget ──────────────────────────────────────────────────────────

test("nextCrf walks up to the floor, then gives up", () => {
  const ladder: number[] = [CRF_START];
  for (let c = nextCrf(CRF_START); c != null; c = nextCrf(c)) ladder.push(c);
  assert.deepEqual(ladder, [28, 31, 34, 37, 40]);
  assert.equal(nextCrf(CRF_MAX), null);
  assert.equal(vp9Crf(28), 36);
  assert.equal(vp9Crf(60), 63);
});

test("clipOverBudget and postOverBudget", () => {
  assert.equal(clipOverBudget({ path: "a.mp4", bytes: CLIP_MAX_BYTES }), null);
  assert.match(clipOverBudget({ path: "a.mp4", bytes: CLIP_MAX_BYTES + 1 })!, /a\.mp4 is 1\.50 MB, over the 1\.50 MB clip budget/);
  const files = [
    { path: "a.mp4", bytes: 6_000_000 },
    { path: "b.webm", bytes: 6_000_000 },
  ];
  assert.equal(postOverBudget(files), null);
  const over = postOverBudget([...files, { path: "c.png", bytes: 1 }]);
  assert.match(over!, /12\.00 MB, over the 12\.00 MB budget/);
  assert.match(over!, /Biggest: a\.mp4 6\.00 MB, b\.webm 6\.00 MB, c\.png 0 KB/);
});

// ─── markdown mapping ────────────────────────────────────────────────

const item = (over: Partial<MediaItem>): MediaItem => ({
  id: "home-phone",
  kind: "screenshot",
  viewport: "phone",
  width: 780,
  height: 1688,
  displayWidth: 390,
  caption: "Manifest caption.",
  alt: "Manifest alt.",
  illustrative: false,
  files: {
    webp: { path: `/blog/media/${SLUG}/home-phone.webp`, bytes: 10 },
    png: { path: `/blog/media/${SLUG}/home-phone.png`, bytes: 20 },
  },
  source: "x",
  capturedAt: "2026-11-18T00:00:00Z",
  ...over,
});

const MANIFEST: MediaManifest = {
  post: SLUG,
  generatedAt: "2026-11-18T00:00:00Z",
  totalBytes: 0,
  items: [
    item({}),
    item({
      id: "hero-3d",
      kind: "clip",
      viewport: "desktop",
      width: 1152,
      height: 998,
      displayWidth: 720,
      duration: 6,
      files: {
        mp4: { path: `/blog/media/${SLUG}/hero-3d.mp4`, bytes: 1 },
        webm: { path: `/blog/media/${SLUG}/hero-3d.webm`, bytes: 1 },
        jpg: { path: `/blog/media/${SLUG}/hero-3d.jpg`, bytes: 1 },
      },
    }),
  ],
};

test("parseMediaSrc", () => {
  assert.deepEqual(parseMediaSrc(`/blog/media/${SLUG}/hero-3d.mp4`), { slug: SLUG, id: "hero-3d", ext: "mp4" });
  assert.equal(parseMediaSrc("/blog/media/x/hero.mp4"), null);
  assert.equal(parseMediaSrc(`/blog/media/${SLUG}/hero.gif`), null);
  assert.equal(parseMediaSrc(`https://evil.example/blog/media/${SLUG}/a.webp`), null);
  assert.equal(parseMediaSrc(null), null);
});

test("resolveBlogMedia: .webp → picture with both sources, sized from the manifest", () => {
  const m = resolveBlogMedia({ src: `/blog/media/${SLUG}/home-phone.webp`, alt: "Home.", title: "The caption." }, MANIFEST);
  assert.deepEqual(m, {
    kind: "image",
    id: "home-phone",
    webp: `/blog/media/${SLUG}/home-phone.webp`,
    png: `/blog/media/${SLUG}/home-phone.png`,
    width: 780,
    height: 1688,
    displayWidth: 390,
    alt: "Home.",
    caption: "The caption.",
  });
  // .png refers to the same picture; missing alt / title fall back.
  const p = resolveBlogMedia({ src: `/blog/media/${SLUG}/home-phone.png` }, MANIFEST);
  assert.equal(p?.kind, "image");
  assert.equal(p?.alt, "Manifest alt.");
  assert.equal(p?.caption, "Manifest caption.");
});

test("resolveBlogMedia: .mp4 → clip with webm, mp4 and poster", () => {
  const m = resolveBlogMedia({ src: `/blog/media/${SLUG}/hero-3d.mp4`, alt: "3D.", title: "Orbit." }, MANIFEST);
  assert.deepEqual(m, {
    kind: "video",
    id: "hero-3d",
    mp4: `/blog/media/${SLUG}/hero-3d.mp4`,
    webm: `/blog/media/${SLUG}/hero-3d.webm`,
    poster: `/blog/media/${SLUG}/hero-3d.jpg`,
    width: 1152,
    height: 998,
    displayWidth: 720,
    alt: "3D.",
    caption: "Orbit.",
  });
  assert.equal(resolveBlogMedia({ src: `/blog/media/${SLUG}/hero-3d.webm` }, MANIFEST)?.kind, "video");
});

test("resolveBlogMedia: anything not in this post's manifest renders nothing", () => {
  assert.equal(resolveBlogMedia({ src: `/blog/media/${SLUG}/nope.webp` }, MANIFEST), null);
  assert.equal(resolveBlogMedia({ src: `/blog/media/${SLUG}/home-phone.mp4` }, MANIFEST), null, "kind mismatch");
  assert.equal(resolveBlogMedia({ src: `/blog/media/${SLUG}/hero-3d.webp` }, MANIFEST), null, "kind mismatch");
  assert.equal(resolveBlogMedia({ src: `/blog/media/2026-11-18-week-47/home-phone.webp` }, MANIFEST), null, "other post");
  assert.equal(resolveBlogMedia({ src: "/icons/og-image.png" }, MANIFEST), null);
  assert.equal(resolveBlogMedia({ src: `/blog/media/${SLUG}/home-phone.webp` }, null), null);
  const noPng = { ...MANIFEST, items: [item({ files: { webp: MANIFEST.items[0]!.files.webp } })] };
  assert.equal(resolveBlogMedia({ src: `/blog/media/${SLUG}/home-phone.webp` }, noPng), null);
});

test("mediaRefs: every /blog/media reference in a body, captions or not", () => {
  const md = `Intro.\n\n![a](/blog/media/${SLUG}/a.webp "Cap")\n\n![b](/blog/media/${SLUG}/b.mp4)\n\n![x](/other.png)\n`;
  assert.deepEqual(mediaRefs(md), [`/blog/media/${SLUG}/a.webp`, `/blog/media/${SLUG}/b.mp4`]);
});

test("mergeMediaItems: a --only run replaces its shots, keeps the rest, drops removed ids", () => {
  const a = item({ id: "a", caption: "old a" });
  const b = item({ id: "b" });
  const gone = item({ id: "gone" });
  const merged = mergeMediaItems([a, b, gone], [item({ id: "a", caption: "new a" })], ["b", "a"]);
  assert.deepEqual(
    merged.map((i) => [i.id, i.caption]),
    [
      ["b", "Manifest caption."],
      ["a", "new a"],
    ],
  );
  assert.equal(manifestFiles(merged).length, 4);
});

// ─── weekly stub ─────────────────────────────────────────────────────

test("weeklyMediaStub: a valid capture manifest at the feature's route", () => {
  const slug = "2026-11-25-week-48";
  const stub = weeklyMediaStub(slug, { title: "B07 · Corridor alerts", route: "/settings/alerts" });
  const r = validateCaptureManifest(stub, slug);
  assert.ok(r.ok, r.ok ? "" : r.errors.join("\n"));
  if (!r.ok) return;
  assert.ok(r.manifest.shots.length >= 2 && r.manifest.shots.length <= 3);
  assert.ok(r.manifest.shots.every((s) => s.url === "/settings/alerts"));
  assert.ok(r.manifest.shots.some((s) => s.kind === "clip"));
  assert.ok(r.manifest.shots.some((s) => s.kind === "screenshot" && s.viewport === "phone"));
  assert.match(r.manifest.shots[0]!.caption, /^Corridor alerts/, "backlog id stripped");
  // No route, or a route the capture tool must not open: home page.
  assert.equal(weeklyMediaStub(slug, null).shots[0]!.url, "/");
  assert.equal(weeklyMediaStub(slug, { title: "X", route: "/api/cron/rollup" }).shots[0]!.url, "/");
  const lines = weeklyMediaMarkdown(slug, stub);
  assert.equal(lines.length, stub.shots.length);
  assert.match(lines[0]!, new RegExp(`^!\\[.+\\]\\(/blog/media/${slug}/feature-phone\\.webp ".+"\\)$`));
  assert.ok(lines.some((l) => l.includes("feature-clip.mp4")));
});

// ─── the committed launch post ───────────────────────────────────────

test("launch post: every media reference resolves, every file exists, the folder fits the budget", () => {
  const md = fs.readFileSync(path.join("content", "blog", `${SLUG}.md`), "utf8");
  const parsed = parsePost(`${SLUG}.md`, md);
  assert.ok(parsed.ok);
  const manifest = JSON.parse(fs.readFileSync(path.join("public", "blog", "media", SLUG, "manifest.json"), "utf8")) as MediaManifest;
  const refs = mediaRefs(md);
  assert.ok(refs.filter((r) => r.endsWith(".mp4")).length >= 1, "at least one clip");
  assert.ok(refs.filter((r) => r.endsWith(".webp")).length >= 6, "at least six images");
  for (const src of refs) {
    const m = resolveBlogMedia({ src }, manifest);
    assert.ok(m, `${src} resolves`);
    const files = m!.kind === "image" ? [m!.webp, m!.png] : [m!.mp4, m!.webm, m!.poster];
    for (const f of files) assert.ok(fs.existsSync(path.join("public", f)), `${f} exists`);
  }
  const files = manifestFiles(manifest.items);
  for (const f of files) {
    assert.equal(fs.statSync(path.join("public", f.path)).size, f.bytes, `${f.path} size matches the manifest`);
    if (/\.(mp4|webm)$/.test(f.path)) assert.ok(f.bytes <= CLIP_MAX_BYTES, `${f.path} under the clip budget`);
  }
  assert.ok(files.reduce((n, f) => n + f.bytes, 0) <= POST_MAX_BYTES);
  for (const i of manifest.items) {
    if (i.illustrative) assert.match(i.caption, /illustrative/i, `${i.id} says illustrative`);
  }
});
