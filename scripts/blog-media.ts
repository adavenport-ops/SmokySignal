// Blog media capture: screenshots and short clips of the app for a post.
//
//   npm run blog:media -- --post <slug> [--only <shotId>[,<shotId>]] [--base https://www.smokysignal.app]
//
// Reads content/blog/media/<slug>.json (format and step DSL in
// lib/blog-media-core.ts), drives Chromium through each shot and writes
// public/blog/media/<slug>/<id>.{webp,png} (screenshots) or
// <id>.{mp4,webm,jpg} (clips), plus public/blog/media/<slug>/manifest.json
// with sizes, dimensions and captions. A --only run re-captures those
// shots and keeps the rest of the manifest.
//
// Read-only: every request the page makes to the capture origin must be a
// GET or HEAD, and admin / cron paths are refused, in the browser and in
// the manifest. Prod ignores ?mock=, so a shot that needs data that is not
// live sets "target": "local": the script then runs `next start` on this
// checkout's .next build (KV env blanked, so it never reads or writes the
// production store) and serves the shot's fixture JSON by interception.
//
// Options:
//   --post <slug>          the post (required)
//   --only <id,...>        capture only these shots
//   --base <origin>        capture origin for prod shots (default https://www.smokysignal.app)
//   --local-base <origin>  use an already-running local server for local shots
//   --keep-raw             keep the raw recordings in the temp dir
//
// Needs: playwright (resolved from NODE_PATH or node_modules; it never
// downloads browsers), Chromium at SS_CHROMIUM_EXECUTABLE_PATH or the
// newest ~/Library/Caches/ms-playwright/chromium_headless_shell-*, sharp
// and ffmpeg-static (devDependencies).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  allowRequest,
  clipOverBudget,
  CRF_START,
  fmtBytes,
  manifestFiles,
  mediaDir,
  mergeMediaItems,
  nextCrf,
  postOverBudget,
  validateCaptureManifest,
  VIEWPORTS,
  vp9Crf,
  MAX_IMAGE_WIDTH,
  type InitScript,
  type MediaItem,
  type MediaManifest,
  type Shot,
  type Step,
} from "../lib/blog-media-core";

type PW = any;

const ROOT = process.cwd();
const DEFAULT_BASE = "https://www.smokysignal.app";
const DEFAULT_CHROMIUM =
  "/Users/adavenport/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell";
// WebGL for the 3D views and the radar, in software.
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const PHONE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36";
const KV_ENV = [
  "KV_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "REDIS_URL",
];

type Args = { post: string; only: string[]; base: string; localBase: string | null; keepRaw: boolean };

function fail(msg: string, code = 1): never {
  console.error(`blog-media: ${msg}`);
  process.exit(code);
}

function usage(msg?: string): never {
  if (msg) console.error(`blog-media: ${msg}`);
  console.error(
    "usage: npm run blog:media -- --post <slug> [--only <id>[,<id>]] [--base https://www.smokysignal.app] [--local-base http://localhost:3000] [--keep-raw]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const a: Args = { post: "", only: [], base: DEFAULT_BASE, localBase: null, keepRaw: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const val = () => argv[++i] ?? usage(`${k} needs a value`);
    if (k === "--post") a.post = val();
    else if (k === "--only") a.only.push(...val().split(",").map((s) => s.trim()).filter(Boolean));
    else if (k === "--base") a.base = val().replace(/\/+$/, "");
    else if (k === "--local-base") a.localBase = val().replace(/\/+$/, "");
    else if (k === "--keep-raw") a.keepRaw = true;
    else if (k === "--help" || k === "-h") usage();
    else usage(`unknown option ${k}`);
  }
  if (!a.post) usage("--post is required");
  if (!/^https?:\/\/[^/]+$/.test(a.base)) usage("--base must be an origin like https://www.smokysignal.app");
  if (a.localBase && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(a.localBase)) {
    usage("--local-base must be a local origin like http://localhost:3000");
  }
  return a;
}

// ─── tools ───────────────────────────────────────────────────────────

function loadPlaywright(): PW {
  const req = createRequire(path.join(ROOT, "package.json"));
  try {
    return req("playwright");
  } catch {
    fail(
      "playwright is not resolvable. Point NODE_PATH at a node_modules that has it, e.g.\n" +
        "  npm i --prefix ~/pw playwright@1.57.0   (browsers are never downloaded)\n" +
        "  NODE_PATH=~/pw/node_modules npm run blog:media -- --post <slug>",
    );
  }
}

function chromiumPath(): string {
  const env = process.env.SS_CHROMIUM_EXECUTABLE_PATH;
  if (env) {
    if (!fs.existsSync(env)) fail(`SS_CHROMIUM_EXECUTABLE_PATH ${env} does not exist`);
    return env;
  }
  if (fs.existsSync(DEFAULT_CHROMIUM)) return DEFAULT_CHROMIUM;
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const found = (fs.existsSync(cache) ? fs.readdirSync(cache) : [])
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((x, y) => Number(y.split("-")[1]) - Number(x.split("-")[1]))
    .map((d) => path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"))
    .find((p) => fs.existsSync(p));
  if (!found) fail("no Chromium found: set SS_CHROMIUM_EXECUTABLE_PATH");
  return found;
}

function loadSharp(): any {
  const req = createRequire(path.join(ROOT, "package.json"));
  try {
    return req("sharp");
  } catch {
    fail("sharp is not installed: run npm ci (it is a devDependency)");
  }
}

function ffmpegPath(): string {
  const req = createRequire(path.join(ROOT, "package.json"));
  let p: string | null = null;
  try {
    p = req("ffmpeg-static") as string | null;
  } catch {
    p = null;
  }
  if (!p || !fs.existsSync(p)) fail("ffmpeg-static has no binary: run npm ci (its install step fetches it)");
  return p;
}

function ffmpeg(bin: string, args: string[]): void {
  const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed: ${r.stderr || r.error}`);
}

/** Decoded length of a recording, seconds (Playwright's webm has no duration header). */
function videoSeconds(bin: string, file: string): number | null {
  const r = spawnSync(bin, ["-hide_banner", "-i", file, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"], { encoding: "utf8" });
  const all = [...(r.stderr ?? "").matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const m = all.at(-1);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function bytes(p: string): number {
  return fs.statSync(p).size;
}

// ─── local server for "target": "local" shots ────────────────────────

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function startLocal(): Promise<{ origin: string; proc: ChildProcess }> {
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    fail('a shot has "target": "local" but there is no .next build here: run `npx next build` first, or pass --local-base');
  }
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: "production" };
  // Blank the store credentials so .env.local cannot point the local
  // server at production KV; Next never overrides a variable already set.
  for (const k of KV_ENV) env[k] = "";
  delete env.VERCEL_ENV;
  const bin = path.join(ROOT, "node_modules", ".bin", "next");
  const proc = spawn(bin, ["start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr?.on("data", (d) => process.env.BLOG_MEDIA_DEBUG && process.stderr.write(d));
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${origin}/offline`, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return { origin, proc };
    } catch {
      /* not up yet */
    }
  }
  proc.kill();
  fail("local next start did not come up within 30s");
}

// ─── init scripts ────────────────────────────────────────────────────

// Plain JS source, not functions: tsx (esbuild) wraps named functions in
// a __name() helper that does not exist inside the page.
const INIT: Record<InitScript, string> = {
  // Dismiss the one-time cards so a shot shows the page, not a prompt.
  quietPrompts: `(() => {
    try {
      const now = String(Date.now());
      localStorage.setItem("ss_alerts_promo_dismissed_at", now);
      localStorage.setItem("ss_arm_alerts_dismissed_at", now);
      localStorage.setItem("ss_install_dismissed", now);
      localStorage.setItem("ss_3d_gesture_hint_seen", "1");
    } catch (e) {}
  })();`,
  // A rider at 70 mph (limit 60) on I-405 by Renton, location granted.
  // Only ever used on local, illustrative shots: nothing real moves.
  speedWarningRider: `(() => {
    try {
      localStorage.setItem("ss_speed_warning", "1");
      localStorage.setItem("ss_speed_limit_mph", "60");
      localStorage.setItem("ss_speed_limit_corridor", "0");
    } catch (e) {}
    const fix = () => ({
      coords: { latitude: 47.4829, longitude: -122.2171, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: 340, speed: 31.29 },
      timestamp: Date.now(),
    });
    const geo = {
      getCurrentPosition: (ok) => setTimeout(() => ok(fix()), 50),
      watchPosition: (ok) => setInterval(() => ok(fix()), 1000),
      clearWatch: (id) => clearInterval(id),
    };
    Object.defineProperty(navigator, "geolocation", { configurable: true, get: () => geo });
    const status = { state: "granted", onchange: null, addEventListener() {}, removeEventListener() {} };
    const perms = navigator.permissions;
    if (perms) {
      const orig = perms.query.bind(perms);
      perms.query = (d) => (d && d.name === "geolocation" ? Promise.resolve(status) : orig(d));
    }
  })();`,
};

// ─── steps ───────────────────────────────────────────────────────────

/**
 * domClicks: a device-size recording scales the view (see
 * deviceSizeRecording), which also scales pointer input, so clips click
 * through the DOM (element.click()) instead of the mouse.
 */
async function runSteps(
  page: any,
  steps: readonly Step[],
  origin: string,
  onStart: () => void,
  domClicks = false,
): Promise<void> {
  for (const s of steps) {
    switch (s.op) {
      case "start":
        onStart();
        break;
      case "goto":
        await page.goto(origin + s.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
        break;
      case "wait":
        await page.waitForTimeout(s.ms);
        break;
      case "waitfor":
        await page.locator(s.selector).first().waitFor({ state: "visible", timeout: 60_000 });
        break;
      case "click":
        if (domClicks) await domClick(page, s.selector);
        else await page.locator(s.selector).first().click({ timeout: 20_000 });
        break;
      case "hover":
        if (domClicks) {
          await page.locator(s.selector).first().dispatchEvent("pointerover");
          await page.locator(s.selector).first().dispatchEvent("mouseover");
        } else await page.locator(s.selector).first().hover({ timeout: 20_000 });
        break;
      case "press":
        await page.keyboard.press(s.key);
        break;
      case "type":
        await page.keyboard.type(s.text, { delay: 90 });
        break;
      case "select":
        await page.locator(s.selector).first().selectOption(s.value, { timeout: 20_000 });
        break;
      case "scroll":
        await page.evaluate((px: number) => window.scrollBy({ top: px, behavior: "smooth" }), s.px);
        break;
      case "scrollto": {
        const el = page.locator(s.selector).first();
        await el.waitFor({ state: "attached", timeout: 20_000 });
        await el.evaluate((n: HTMLElement) => n.scrollIntoView({ block: "start", behavior: "instant" }));
        break;
      }
      case "hide":
        await page.addStyleTag({ content: `${s.selector} { visibility: hidden !important; }` });
        break;
      case "action":
        await runAction(page, s.name, s.ms);
        break;
    }
  }
}

async function domClick(page: any, selector: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 20_000 });
  await el.scrollIntoViewIfNeeded({ timeout: 20_000 });
  await el.evaluate((n: HTMLElement) => n.click());
}

async function runAction(page: any, name: string, ms: number): Promise<void> {
  if (name === "dismissHint") {
    const b = page.locator('[aria-label="Dismiss gesture hint"]');
    if (await b.count()) await domClick(page, '[aria-label="Dismiss gesture hint"]').catch(() => {});
    if (ms) await page.waitForTimeout(ms);
    return;
  }
  if (name === "orbit3d") {
    await domClick(page, '[data-testid="map3d-orbit"]');
    await page.waitForTimeout(ms);
    return;
  }
  if (name === "replay3d") {
    // The slider's onChange pauses and seeks; Play then runs from there.
    const range = page.locator('input[aria-label="Replay position"]').first();
    await range.waitFor({ state: "attached", timeout: 20_000 });
    await range.evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, "0");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(150);
    if (await page.locator('[aria-label="Play replay"]').count()) await domClick(page, '[aria-label="Play replay"]');
    if (ms) await page.waitForTimeout(ms);
    return;
  }
  if (name === "rotate3d") {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await domClick(page, '[data-testid="map3d-rotate-right"]');
      await page.waitForTimeout(Math.min(1200, Math.max(0, end - Date.now())));
    }
    return;
  }
  throw new Error(`unknown action ${name}`);
}

// ─── capture ─────────────────────────────────────────────────────────

type Ctx = {
  args: Args;
  pw: PW;
  browser: any;
  sharp: any;
  ff: string;
  outDir: string;
  tmp: string;
  localOrigin: () => Promise<string>;
};

/**
 * Device scale for a recording. Phones record at device size (dpr 2). A
 * full desktop page records at dpr 1 (1440x900, encoded down to 720p); a
 * clip cropped to one element records at dpr 2 so the crop stays sharp.
 */
function recordDpr(shot: Shot): number {
  const vp = VIEWPORTS[shot.viewport];
  return vp.mobile || shot.element ? vp.dpr : 1;
}

/**
 * Headless Chromium's screencast hands Playwright frames at CSS size, so
 * a dpr 2 recording would be a 390x844 picture padded out to 780x1688.
 * Scaling the emulated view by the dpr and widening the visible surface
 * to match makes the frames device-size. Layout is unchanged (innerWidth
 * stays 390); pointer input is scaled too, hence domClicks in runSteps.
 */
async function deviceSizeRecording(ctx: any, page: any, shot: Shot, dpr: number): Promise<void> {
  const vp = VIEWPORTS[shot.viewport];
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: dpr,
    mobile: vp.mobile,
    scale: dpr,
  });
  await cdp.send("Emulation.setVisibleSize", { width: vp.width * dpr, height: vp.height * dpr });
}

async function newContext(c: Ctx, shot: Shot, origin: string, record: boolean): Promise<any> {
  const vp = VIEWPORTS[shot.viewport];
  const dpr = record ? recordDpr(shot) : vp.dpr;
  const opts: Record<string, unknown> = {
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    // en-GB: native date and time inputs draw a 24-hour clock, like the app.
    locale: "en-GB",
    timezoneId: "America/Los_Angeles",
  };
  if (vp.mobile) opts.userAgent = PHONE_UA;
  if (record) opts.recordVideo = { dir: c.tmp, size: { width: vp.width * dpr, height: vp.height * dpr } };
  const ctx = await c.browser.newContext(opts);
  const host = new URL(origin).hostname;
  const cookies = Object.entries(shot.cookies).map(([name, value]) => ({ name, value, domain: host, path: "/" }));
  if (cookies.length) await ctx.addCookies(cookies);
  await ctx.addInitScript({ content: INIT.quietPrompts });
  for (const n of shot.init) await ctx.addInitScript({ content: INIT[n] });

  const fixtures = new Map<string, string>();
  for (const r of shot.routes) {
    const file = path.join(ROOT, "content", "blog", "media", r.fixture);
    if (!fs.existsSync(file)) throw new Error(`fixture ${r.fixture} not found`);
    fixtures.set(r.path, fs.readFileSync(file, "utf8"));
  }
  await ctx.route("**/*", async (route: any) => {
    const req = route.request();
    const url = req.url();
    if (!allowRequest(req.method(), url, [origin])) {
      return route.abort("blockedbyclient");
    }
    try {
      const u = new URL(url);
      if (u.origin === origin && fixtures.has(u.pathname)) {
        return route.fulfill({ status: 200, contentType: "application/json", body: fixtures.get(u.pathname) });
      }
    } catch {
      /* not a URL we serve */
    }
    return route.continue();
  });
  return ctx;
}

async function captureScreenshot(c: Ctx, shot: Shot, origin: string): Promise<MediaItem> {
  const vp = VIEWPORTS[shot.viewport];
  const ctx = await newContext(c, shot, origin, false);
  let png: Buffer;
  try {
    if (shot.capture === "image") {
      const r = await ctx.request.get(origin + shot.url, { timeout: 60_000 });
      if (!r.ok()) throw new Error(`GET ${shot.url} returned ${r.status()}`);
      png = Buffer.from(await r.body());
    } else {
      const page = await ctx.newPage();
      await page.goto(origin + shot.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await runSteps(page, shot.steps, origin, () => {});
      png = shot.element
        ? await page.locator(shot.element).first().screenshot({ animations: "disabled" })
        : await page.screenshot({ fullPage: shot.fullPage, animations: "disabled" });
    }
  } finally {
    await ctx.close();
  }
  const base = path.join(c.outDir, shot.id);
  let img = c.sharp(png);
  const meta = await img.metadata();
  if ((meta.width ?? 0) > MAX_IMAGE_WIDTH) img = img.resize({ width: MAX_IMAGE_WIDTH });
  const webpBuf = await img.clone().webp({ quality: 80, effort: 6 }).toBuffer({ resolveWithObject: true });
  fs.writeFileSync(`${base}.webp`, webpBuf.data);
  const pngBuf = await img.clone().png({ palette: true, quality: 85, compressionLevel: 9, effort: 10 }).toBuffer();
  fs.writeFileSync(`${base}.png`, pngBuf);
  const rel = (ext: string) => ({ path: `${mediaDir(c.args.post)}/${shot.id}.${ext}`, bytes: bytes(`${base}.${ext}`) });
  const width = webpBuf.info.width as number;
  const height = webpBuf.info.height as number;
  return {
    id: shot.id,
    kind: "screenshot",
    viewport: shot.viewport,
    width,
    height,
    // A page-sized capture draws at most its CSS width; an element or
    // image capture at its own CSS size.
    displayWidth: Math.min(Math.round(width / vp.dpr), vp.displayWidth),
    caption: shot.caption,
    alt: shot.alt,
    illustrative: shot.illustrative,
    files: { webp: rel("webp"), png: rel("png") },
    source: shot.target === "local" ? `local build (fixtures) ${shot.url}` : `${origin}${shot.url}`,
    capturedAt: new Date().toISOString(),
  };
}

async function captureClip(c: Ctx, shot: Shot, origin: string): Promise<MediaItem> {
  const vp = VIEWPORTS[shot.viewport];
  const duration = shot.duration!;
  const ctx = await newContext(c, shot, origin, true);
  const page = await ctx.newPage();
  const dpr = recordDpr(shot);
  if (dpr > 1) await deviceSizeRecording(ctx, page, shot, dpr);
  const t0 = Date.now();
  let tStart: number | null = null;
  let tClose = Date.now();
  let raw: string;
  let box: { x: number; y: number; width: number; height: number } | null = null;
  try {
    await page.goto(origin + shot.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await runSteps(
      page,
      shot.steps,
      origin,
      () => {
        tStart = Date.now();
      },
      dpr > 1,
    );
    if (shot.element) {
      box = await page.locator(shot.element).first().boundingBox();
      if (!box) throw new Error(`shot ${shot.id}: element ${shot.element} is not on screen`);
    }
    const startAt = tStart ?? Date.now();
    const left = duration * 1000 - (Date.now() - startAt);
    if (left > 0) await page.waitForTimeout(left + 300);
    else await page.waitForTimeout(300);
  } finally {
    const video = page.video();
    tClose = Date.now();
    await ctx.close();
    raw = video ? await video.path() : "";
  }
  if (!raw || !fs.existsSync(raw)) throw new Error(`shot ${shot.id}: no recording`);
  // The recording starts at its first frame, a beat after newPage, and
  // runs to the close. Anchor on the close so the trim lands on "start".
  const recorded = videoSeconds(c.ff, raw);
  const videoStart = recorded != null ? Math.max(t0, tClose - recorded * 1000) : t0;
  const offset = Math.max(0, ((tStart ?? videoStart) - videoStart) / 1000);
  const base = path.join(c.outDir, shot.id);
  // Crop to the element (device pixels, inside the viewport), then scale
  // to the clip width, never up.
  let crop = "";
  let cropWidth = vp.width * dpr;
  if (box) {
    const x = Math.max(0, Math.round(box.x * dpr));
    const y = Math.max(0, Math.round(box.y * dpr));
    const w = Math.min(vp.width * dpr - x, Math.round(box.width * dpr)) & ~1;
    const h = Math.min(vp.height * dpr - y, Math.round(box.height * dpr)) & ~1;
    crop = `crop=${w}:${h}:${x}:${y},`;
    cropWidth = w;
  }
  const outWidth = Math.min(vp.clipWidth, cropWidth) & ~1;
  const scale = `${crop}scale=${outWidth}:-2:flags=lanczos`;
  const trim = ["-ss", offset.toFixed(2), "-i", raw, "-t", duration.toFixed(2), "-an"];

  let crf = CRF_START;
  for (;;) {
    ffmpeg(c.ff, [
      ...trim,
      "-vf",
      `${scale},fps=fps=25`,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(crf),
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-movflags",
      "+faststart",
      `${base}.mp4`,
    ]);
    ffmpeg(c.ff, [
      ...trim,
      "-vf",
      `${scale},fps=fps=25`,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      String(vp9Crf(crf)),
      "-b:v",
      "0",
      "-row-mt",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      `${base}.webm`,
    ]);
    const over = [
      clipOverBudget({ path: `${shot.id}.mp4`, bytes: bytes(`${base}.mp4`) }),
      clipOverBudget({ path: `${shot.id}.webm`, bytes: bytes(`${base}.webm`) }),
    ].filter(Boolean);
    if (over.length === 0) break;
    const n = nextCrf(crf);
    if (n == null) {
      throw new Error(`shot ${shot.id}: still over budget at crf ${crf}: ${over.join("; ")}. Shorten the clip or calm the motion.`);
    }
    console.error(`blog-media: ${shot.id} over budget at crf ${crf} (${over.join("; ")}), trying crf ${n}`);
    crf = n;
  }

  const posterAt = Math.min(duration - 0.1, shot.posterAt ?? duration / 2);
  const posterRaw = path.join(c.tmp, `${shot.id}-poster.png`);
  ffmpeg(c.ff, ["-ss", (offset + posterAt).toFixed(2), "-i", raw, "-frames:v", "1", "-vf", scale, posterRaw]);
  const poster = await c.sharp(posterRaw).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  fs.writeFileSync(`${base}.jpg`, poster.data);
  if (!c.args.keepRaw) fs.rmSync(raw, { force: true });

  const rel = (ext: string) => ({ path: `${mediaDir(c.args.post)}/${shot.id}.${ext}`, bytes: bytes(`${base}.${ext}`) });
  const width = poster.info.width as number;
  const height = poster.info.height as number;
  console.error(`blog-media: ${shot.id} encoded at crf ${crf}`);
  return {
    id: shot.id,
    kind: "clip",
    viewport: shot.viewport,
    width,
    height,
    // A cropped clip may fill the post column; a full page draws at its
    // CSS width at most.
    displayWidth: box ? Math.min(VIEWPORTS.desktop.displayWidth, width) : vp.displayWidth,
    caption: shot.caption,
    alt: shot.alt,
    illustrative: shot.illustrative,
    duration,
    files: { mp4: rel("mp4"), webm: rel("webm"), jpg: rel("jpg") },
    source: shot.target === "local" ? `local build (fixtures) ${shot.url}` : `${origin}${shot.url}`,
    capturedAt: new Date().toISOString(),
  };
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = path.join(ROOT, "content", "blog", "media", `${args.post}.json`);
  if (!fs.existsSync(path.join(ROOT, "content", "blog", `${args.post}.md`))) fail(`no post content/blog/${args.post}.md`);
  if (!fs.existsSync(src)) fail(`no capture manifest ${path.relative(ROOT, src)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(src, "utf8"));
  } catch (e) {
    fail(`${path.relative(ROOT, src)} is not valid JSON: ${(e as Error).message}`);
  }
  const v = validateCaptureManifest(raw, args.post);
  if (!v.ok) fail(`${path.relative(ROOT, src)} is invalid:\n  - ${v.errors.join("\n  - ")}`);
  const all = v.manifest.shots;
  const unknown = args.only.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) fail(`--only names unknown shots: ${unknown.join(", ")}`);
  const shots = args.only.length ? all.filter((s) => args.only.includes(s.id)) : all;

  const pw = loadPlaywright();
  const sharp = loadSharp();
  const ff = ffmpegPath();
  const executablePath = chromiumPath();
  const outDir = path.join(ROOT, "public", mediaDir(args.post));
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blog-media-"));

  let local: { origin: string; proc: ChildProcess } | null = null;
  const localOrigin = async () => {
    if (args.localBase) return args.localBase;
    if (!local) {
      console.error("blog-media: starting a local next start for local shots");
      local = await startLocal();
    }
    return local.origin;
  };

  const browser = await pw.chromium.launch({ executablePath, args: GL_ARGS, headless: true });
  const c: Ctx = { args, pw, browser, sharp, ff, outDir, tmp, localOrigin };
  const fresh: MediaItem[] = [];
  const failures: string[] = [];
  try {
    for (const shot of shots) {
      const origin = shot.target === "local" ? await localOrigin() : args.base;
      const started = Date.now();
      try {
        const item = shot.kind === "clip" ? await captureClip(c, shot, origin) : await captureScreenshot(c, shot, origin);
        fresh.push(item);
        const sizes = Object.entries(item.files)
          .map(([ext, f]) => `${ext} ${fmtBytes(f!.bytes)}`)
          .join(", ");
        console.error(`blog-media: ${shot.id} ${item.width}x${item.height} ${sizes} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      } catch (e) {
        failures.push(`${shot.id}: ${(e as Error).message.split("\n")[0]}`);
        console.error(`blog-media: ${shot.id} FAILED: ${(e as Error).message}`);
      }
    }
  } finally {
    await browser.close();
    if (local) (local as { proc: ChildProcess }).proc.kill();
    if (!args.keepRaw) fs.rmSync(tmp, { recursive: true, force: true });
    else console.error(`blog-media: raw recordings kept in ${tmp}`);
  }

  const manifestPath = path.join(outDir, "manifest.json");
  let prev: MediaItem[] = [];
  if (fs.existsSync(manifestPath)) {
    try {
      prev = (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as MediaManifest).items ?? [];
    } catch {
      prev = [];
    }
  }
  const items = mergeMediaItems(
    prev,
    fresh,
    all.map((s) => s.id),
  );
  // Files from shots that left the manifest go too.
  const keep = new Set(manifestFiles(items).map((f) => path.basename(f.path)));
  keep.add("manifest.json");
  for (const name of fs.readdirSync(outDir)) if (!keep.has(name)) fs.rmSync(path.join(outDir, name), { force: true });

  const files = manifestFiles(items);
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  const out: MediaManifest = { post: args.post, generatedAt: new Date().toISOString(), totalBytes, items };
  fs.writeFileSync(manifestPath, JSON.stringify(out, null, 2) + "\n");

  console.error(`blog-media: ${items.length} items, ${fmtBytes(totalBytes)} total, manifest ${path.relative(ROOT, manifestPath)}`);
  const over = postOverBudget(files);
  if (over) fail(over);
  if (failures.length) fail(`${failures.length} shot(s) failed:\n  - ${failures.join("\n  - ")}`);
}

main().catch((e) => {
  console.error(`blog-media: ${e instanceof Error ? e.stack || e.message : String(e)}`);
  process.exit(1);
});
