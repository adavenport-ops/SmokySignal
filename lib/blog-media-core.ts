// Pure half of blog media (screenshots and short clips in posts). No fs,
// no browser, no ffmpeg: scripts/blog-media.ts does the IO and hands
// data in, components/BlogMarkdown.tsx calls resolveBlogMedia() to turn a
// markdown image into a <figure>. lib/blog-media-core.test.ts pins all of
// it.
//
// Two JSON files per post:
//
//   content/blog/media/<slug>.json          what to capture (hand-written)
//   public/blog/media/<slug>/manifest.json  what was captured (generated)
//
// Capture manifest:
//
//   {
//     "post": "2026-11-19-the-big-update",
//     "shots": [
//       {
//         "id": "hero-3d",                     // file stem, kebab-case
//         "kind": "clip",                      // "screenshot" | "clip"
//         "url": "/flight/N305DK/20261118T0032?view=3d",
//         "viewport": "desktop",               // "phone" (iPhone 14) | "desktop" (1440x900)
//         "steps": ["waitfor [data-testid=map3d-controls]", "start", "action orbit3d 6000"],
//         "duration": 6,                       // clips only, seconds, <= 8
//         "caption": "N305DK in 3D over Tacoma.",
//         "alt": "A 3D flight path turning slowly over terrain."
//       }
//     ]
//   }
//
// Optional per shot: "target": "local" (capture from a local `next start`
// of this checkout instead of prod), "routes" (local only: serve fixture
// JSON for a path), "init" (named init scripts), "illustrative" (the
// data is not real; the caption must then say "illustrative"), "capture":
// "image" (the url is an image; fetch it instead of rendering a page),
// "fullPage", "element" (screenshot one element), "posterAt" (seconds
// into the clip for the poster frame), "cookies" ({name: value}).

import { voiceViolations } from "./blog-weekly";

// ─── shapes ──────────────────────────────────────────────────────────

export const SHOT_KINDS = ["screenshot", "clip"] as const;
export type ShotKind = (typeof SHOT_KINDS)[number];

export const VIEWPORT_IDS = ["phone", "desktop"] as const;
export type ViewportId = (typeof VIEWPORT_IDS)[number];

export type ViewportSpec = {
  width: number;
  height: number;
  /** Screenshots render at this device scale factor. */
  dpr: number;
  mobile: boolean;
  /** Clips: the encoded width (never scaled up past the source). */
  clipWidth: number;
  /** Widest the figure draws in the post, CSS px. */
  displayWidth: number;
};

// iPhone 14 is 390x844 CSS. Phone clips record at device size (dpr 2,
// 780x1688) and encode at 720 wide; full-page desktop clips record
// 1440x900 at dpr 1 and encode at 720 tall (1152x720); a clip cropped to
// one element records at dpr 2. Screenshots are dpr 2 for both.
export const VIEWPORTS: Record<ViewportId, ViewportSpec> = {
  phone: {
    width: 390,
    height: 844,
    dpr: 2,
    mobile: true,
    clipWidth: 720,
    displayWidth: 390,
  },
  desktop: {
    width: 1440,
    height: 900,
    dpr: 2,
    mobile: false,
    clipWidth: 1152,
    displayWidth: 720,
  },
};

/** Screenshots wider than this are scaled down (2x the widest figure). */
export const MAX_IMAGE_WIDTH = 1440;

export const CLIP_MAX_SECONDS = 8;
/** Per rendition: the mp4 and the webm each stay under this. */
export const CLIP_MAX_BYTES = 1_500_000;
/** Every file a post's media folder holds, together. */
export const POST_MAX_BYTES = 12_000_000;

export const CRF_START = 28;
export const CRF_STEP = 3;
export const CRF_MAX = 40;
/** VP9's crf scale sits higher than x264's for a similar look. */
export const VP9_CRF_OFFSET = 8;

/**
 * orbit3d: press the 3D view's Orbit button, then run for ms.
 * rotate3d: press rotate-right every 1.2 s for ms.
 * replay3d: wind the 3D replay back to the takeoff and play it.
 * dismissHint: close the one-time gesture hint if it shows.
 */
export const NAMED_ACTIONS = ["orbit3d", "rotate3d", "replay3d", "dismissHint"] as const;
export type NamedAction = (typeof NAMED_ACTIONS)[number];

export const INIT_SCRIPTS = ["speedWarningRider", "quietPrompts"] as const;
export type InitScript = (typeof INIT_SCRIPTS)[number];

export type Step =
  | { op: "goto"; path: string }
  | { op: "wait"; ms: number }
  | { op: "waitfor"; selector: string }
  | { op: "click"; selector: string }
  | { op: "hover"; selector: string }
  | { op: "press"; key: string }
  | { op: "type"; text: string }
  | { op: "select"; value: string; selector: string }
  | { op: "scroll"; px: number }
  | { op: "scrollto"; selector: string }
  | { op: "hide"; selector: string }
  | { op: "action"; name: NamedAction; ms: number }
  | { op: "start" };

export type RouteFixture = { path: string; fixture: string };

export type Shot = {
  id: string;
  kind: ShotKind;
  url: string;
  viewport: ViewportId;
  steps: Step[];
  /** Source strings, kept for error messages. */
  stepSource: string[];
  duration: number | null;
  caption: string;
  alt: string;
  target: "prod" | "local";
  routes: RouteFixture[];
  init: InitScript[];
  illustrative: boolean;
  capture: "page" | "image";
  fullPage: boolean;
  element: string | null;
  posterAt: number | null;
  cookies: Record<string, string>;
};

export type CaptureManifest = { post: string; shots: Shot[] };

// ─── step DSL ────────────────────────────────────────────────────────

export class StepError extends Error {}

const MAX_WAIT_MS = 30_000;

function intArg(op: string, raw: string, min: number, max: number): number {
  if (!/^-?\d+$/.test(raw)) throw new StepError(`${op}: expected a whole number, got "${raw}"`);
  const n = Number(raw);
  if (n < min || n > max) throw new StepError(`${op}: ${n} is outside ${min}..${max}`);
  return n;
}

/**
 * One step line into a Step. The grammar is `<op> <argument>`:
 *
 *   goto /radar               navigate (same origin, path only)
 *   wait 1500                 sleep, ms (<= 30000)
 *   waitfor <selector>        wait until visible
 *   click <selector>          click
 *   hover <selector>          hover
 *   press Meta+K              keyboard chord
 *   type N305DK               type text into the focused field
 *   select puget_sound <sel>  pick an <option> by value in a <select>
 *   scroll 600                window.scrollBy, px (negative goes up)
 *   scrollto <selector>       scroll an element to the top of the view
 *   hide <selector>           visibility:hidden on every match
 *   action orbit3d 6000       named action, with its run time in ms
 *   start                     the clip starts here (trim point)
 */
export function parseStep(line: string): Step {
  const src = line.trim();
  if (!src) throw new StepError("empty step");
  const sp = src.indexOf(" ");
  const op = (sp < 0 ? src : src.slice(0, sp)).toLowerCase();
  const arg = sp < 0 ? "" : src.slice(sp + 1).trim();
  const need = () => {
    if (!arg) throw new StepError(`${op}: missing argument`);
    return arg;
  };
  switch (op) {
    case "start":
      if (arg) throw new StepError("start takes no argument");
      return { op: "start" };
    case "goto": {
      const p = need();
      if (!p.startsWith("/") || p.startsWith("//")) throw new StepError(`goto: "${p}" must be a same-origin path`);
      assertReadOnlyPath(p);
      return { op: "goto", path: p };
    }
    case "wait":
      return { op: "wait", ms: intArg(op, need(), 0, MAX_WAIT_MS) };
    case "waitfor":
    case "click":
    case "hover":
    case "scrollto":
    case "hide":
      return { op, selector: need() };
    case "press": {
      const k = need();
      if (/\s/.test(k)) throw new StepError(`press: "${k}" is one key or chord, e.g. Meta+K`);
      return { op: "press", key: k };
    }
    case "type":
      return { op: "type", text: need() };
    case "select": {
      const m = /^(\S+)\s+(.+)$/.exec(need());
      if (!m) throw new StepError(`select: expected "<value> <selector>"`);
      return { op: "select", value: m[1]!, selector: m[2]! };
    }
    case "scroll":
      return { op: "scroll", px: intArg(op, need(), -20_000, 20_000) };
    case "action": {
      const [name, ms, ...rest] = need().split(/\s+/);
      if (rest.length) throw new StepError(`action: too many arguments in "${src}"`);
      if (!(NAMED_ACTIONS as readonly string[]).includes(name!)) {
        throw new StepError(`action: unknown "${name}" (known: ${NAMED_ACTIONS.join(", ")})`);
      }
      return { op: "action", name: name as NamedAction, ms: ms == null ? 0 : intArg(op, ms, 0, MAX_WAIT_MS) };
    }
    default:
      throw new StepError(`unknown step "${op}"`);
  }
}

/** Sum of the fixed waits after the `start` marker, ms. */
export function stepsRunTimeAfterStart(steps: readonly Step[]): number {
  const i = steps.findIndex((s) => s.op === "start");
  let ms = 0;
  for (const s of steps.slice(i + 1)) {
    if (s.op === "wait") ms += s.ms;
    if (s.op === "action") ms += s.ms;
  }
  return ms;
}

// ─── read-only guard ─────────────────────────────────────────────────

/** Paths the capture tool never opens: they write, or need a passcode. */
export const FORBIDDEN_PATH_RE = /^\/(?:admin(?:\/|$|\?)|api\/admin(?:\/|$|\?)|api\/cron(?:\/|$|\?)|qa-dashboard)/;

function assertReadOnlyPath(p: string): void {
  if (FORBIDDEN_PATH_RE.test(p)) throw new StepError(`"${p}" is an admin or cron route; capture is read-only`);
}

/** The browser-side guard: may this request leave the page? */
export function allowRequest(method: string, url: string, origins: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true; // data:, blob: and friends
  }
  if (!origins.includes(u.origin)) return method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (FORBIDDEN_PATH_RE.test(u.pathname)) return false;
  return method === "GET" || method === "HEAD";
}

// ─── manifest validation ─────────────────────────────────────────────

export const SHOT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ValidateResult = { ok: true; manifest: CaptureManifest } | { ok: false; errors: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const SHOT_KEYS = new Set([
  "id",
  "kind",
  "url",
  "viewport",
  "steps",
  "duration",
  "caption",
  "alt",
  "target",
  "routes",
  "init",
  "illustrative",
  "capture",
  "fullPage",
  "element",
  "posterAt",
  "cookies",
]);

/**
 * Check a parsed content/blog/media/<slug>.json. Collects every problem
 * instead of stopping at the first, so one run shows the whole list.
 */
export function validateCaptureManifest(raw: unknown, slug: string): ValidateResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["manifest must be a JSON object"] };
  if (raw.post !== slug) errors.push(`"post" must be "${slug}", got ${JSON.stringify(raw.post)}`);
  if (!Array.isArray(raw.shots) || raw.shots.length === 0) {
    errors.push(`"shots" must be a non-empty array`);
    return { ok: false, errors };
  }
  const seen = new Set<string>();
  const shots: Shot[] = [];
  raw.shots.forEach((s: unknown, i: number) => {
    const where = `shots[${i}]`;
    if (!isObj(s)) {
      errors.push(`${where}: must be an object`);
      return;
    }
    const at = typeof s.id === "string" && s.id ? `shot "${s.id}"` : where;
    const err = (m: string) => errors.push(`${at}: ${m}`);
    for (const k of Object.keys(s)) if (!SHOT_KEYS.has(k)) err(`unknown field "${k}"`);

    const id = typeof s.id === "string" ? s.id : "";
    if (!SHOT_ID_RE.test(id)) err(`"id" must be kebab-case (a-z, 0-9, -)`);
    else if (seen.has(id)) err(`duplicate id`);
    seen.add(id);

    const kind = s.kind as ShotKind;
    if (!(SHOT_KINDS as readonly string[]).includes(kind)) err(`"kind" must be screenshot or clip`);

    const url = typeof s.url === "string" ? s.url : "";
    if (!url.startsWith("/") || url.startsWith("//")) err(`"url" must be a same-origin path starting with /`);
    else if (FORBIDDEN_PATH_RE.test(url)) err(`"url" ${url} is an admin or cron route; capture is read-only`);

    const viewport = s.viewport as ViewportId;
    if (!(VIEWPORT_IDS as readonly string[]).includes(viewport)) err(`"viewport" must be phone or desktop`);

    const stepSource: string[] = [];
    const steps: Step[] = [];
    if (s.steps !== undefined && !Array.isArray(s.steps)) err(`"steps" must be an array of strings`);
    for (const [j, line] of (Array.isArray(s.steps) ? s.steps : []).entries()) {
      if (typeof line !== "string") {
        err(`steps[${j}] must be a string`);
        continue;
      }
      try {
        steps.push(parseStep(line));
        stepSource.push(line);
      } catch (e) {
        err(`steps[${j}] "${line}": ${(e as Error).message}`);
      }
    }
    if (steps.filter((x) => x.op === "start").length > 1) err(`only one "start" step`);

    let duration: number | null = null;
    if (kind === "clip") {
      if (typeof s.duration !== "number" || !Number.isFinite(s.duration) || s.duration <= 0) {
        err(`clips need "duration" in seconds`);
      } else if (s.duration > CLIP_MAX_SECONDS) {
        err(`"duration" ${s.duration}s is over the ${CLIP_MAX_SECONDS}s clip limit`);
      } else duration = s.duration;
    } else if (s.duration !== undefined) {
      err(`"duration" only applies to clips`);
    }

    let posterAt: number | null = null;
    if (s.posterAt !== undefined) {
      if (kind !== "clip") err(`"posterAt" only applies to clips`);
      else if (typeof s.posterAt !== "number" || s.posterAt < 0 || (duration != null && s.posterAt > duration)) {
        err(`"posterAt" must be a number of seconds inside the clip`);
      } else posterAt = s.posterAt;
    }

    const caption = typeof s.caption === "string" ? s.caption.trim() : "";
    const alt = typeof s.alt === "string" ? s.alt.trim() : "";
    if (!caption) err(`"caption" is required`);
    if (!alt) err(`"alt" is required`);
    for (const [name, text] of [
      ["caption", caption],
      ["alt", alt],
    ] as const) {
      const hits = voiceViolations(text);
      if (hits.length) err(`"${name}" fails the voice gate: ${hits.join(", ")}`);
    }

    const target = s.target === undefined ? "prod" : s.target;
    if (target !== "prod" && target !== "local") err(`"target" must be prod or local`);

    const routes: RouteFixture[] = [];
    if (s.routes !== undefined) {
      if (!Array.isArray(s.routes)) err(`"routes" must be an array`);
      else {
        if (target !== "local") err(`"routes" (fixture interception) only runs against a local build: set "target": "local"`);
        for (const [j, r] of s.routes.entries()) {
          if (!isObj(r) || typeof r.path !== "string" || !r.path.startsWith("/") || typeof r.fixture !== "string" || !r.fixture) {
            err(`routes[${j}] needs "path" (/...) and "fixture" (file under content/blog/media/)`);
          } else if (r.fixture.includes("..") || r.fixture.startsWith("/")) {
            err(`routes[${j}].fixture must be a relative path inside content/blog/media/`);
          } else routes.push({ path: r.path, fixture: r.fixture });
        }
      }
    }

    const init: InitScript[] = [];
    if (s.init !== undefined) {
      if (!Array.isArray(s.init)) err(`"init" must be an array`);
      else
        for (const n of s.init) {
          if ((INIT_SCRIPTS as readonly string[]).includes(n as string)) init.push(n as InitScript);
          else err(`unknown init script "${String(n)}" (known: ${INIT_SCRIPTS.join(", ")})`);
        }
    }

    const illustrative = s.illustrative === true;
    if (s.illustrative !== undefined && typeof s.illustrative !== "boolean") err(`"illustrative" must be true or false`);
    const saysIllustrative = /\billustrative\b/i.test(caption);
    if (illustrative && !saysIllustrative) err(`illustrative shots must say "illustrative" in the caption`);
    if (!illustrative && saysIllustrative) err(`caption says "illustrative" but the shot is not marked illustrative`);
    if (routes.length > 0 && !illustrative) err(`fixture data is not real: mark the shot "illustrative": true`);

    const capture = s.capture === undefined ? "page" : s.capture;
    if (capture !== "page" && capture !== "image") err(`"capture" must be page or image`);
    if (capture === "image" && kind !== "screenshot") err(`"capture": "image" only applies to screenshots`);
    if (capture === "image" && steps.length > 0) err(`"capture": "image" takes no steps`);

    if (s.fullPage !== undefined && typeof s.fullPage !== "boolean") err(`"fullPage" must be true or false`);
    if (s.element !== undefined && (typeof s.element !== "string" || !s.element)) err(`"element" must be a selector`);
    if (s.fullPage === true && kind === "clip") err(`"fullPage" only applies to screenshots`);

    const cookies: Record<string, string> = {};
    if (s.cookies !== undefined) {
      if (!isObj(s.cookies)) err(`"cookies" must be an object of name: value`);
      else
        for (const [k, v] of Object.entries(s.cookies)) {
          if (!/^[A-Za-z0-9_-]+$/.test(k) || typeof v !== "string") err(`cookie "${k}" must be a simple name with a string value`);
          else cookies[k] = v;
        }
    }

    if (kind === "clip" && duration != null) {
      const run = stepsRunTimeAfterStart(steps) / 1000;
      if (run > duration + 0.5) err(`steps after "start" run ${run}s, longer than the ${duration}s clip`);
    }

    shots.push({
      id,
      kind,
      url,
      viewport,
      steps,
      stepSource,
      duration,
      caption,
      alt,
      target: target === "local" ? "local" : "prod",
      routes,
      init,
      illustrative,
      capture: capture === "image" ? "image" : "page",
      fullPage: s.fullPage === true,
      element: typeof s.element === "string" ? s.element : null,
      posterAt,
      cookies,
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest: { post: slug, shots } };
}

// ─── budget ──────────────────────────────────────────────────────────

/** The next, smaller encode for an over-budget clip, or null at the floor. */
export function nextCrf(crf: number): number | null {
  const n = crf + CRF_STEP;
  return n <= CRF_MAX ? n : null;
}

export function vp9Crf(x264Crf: number): number {
  return Math.min(63, x264Crf + VP9_CRF_OFFSET);
}

export type BudgetFile = { path: string; bytes: number };

export function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  return `${Math.round(n / 1000)} KB`;
}

/** Null when one rendition of a clip fits, else the reason. */
export function clipOverBudget(file: BudgetFile, max = CLIP_MAX_BYTES): string | null {
  return file.bytes > max ? `${file.path} is ${fmtBytes(file.bytes)}, over the ${fmtBytes(max)} clip budget` : null;
}

/** Null when the post's media folder fits, else the reason with the biggest files. */
export function postOverBudget(files: readonly BudgetFile[], max = POST_MAX_BYTES): string | null {
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (total <= max) return null;
  const top = [...files]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((f) => `${f.path} ${fmtBytes(f.bytes)}`)
    .join(", ");
  return `post media is ${fmtBytes(total)}, over the ${fmtBytes(max)} budget. Biggest: ${top}`;
}

// ─── output manifest (public/blog/media/<slug>/manifest.json) ─────────

export type MediaFile = { path: string; bytes: number };

export type MediaItem = {
  id: string;
  kind: ShotKind;
  viewport: ViewportId;
  /** Intrinsic pixels of the main rendition (webp / mp4). */
  width: number;
  height: number;
  /** Widest the figure draws in the post, CSS px. */
  displayWidth: number;
  caption: string;
  alt: string;
  illustrative: boolean;
  /** Clips only, seconds. */
  duration?: number;
  files: Partial<Record<"webp" | "png" | "mp4" | "webm" | "jpg", MediaFile>>;
  source: string;
  capturedAt: string;
};

export type MediaManifest = {
  post: string;
  generatedAt: string;
  totalBytes: number;
  items: MediaItem[];
};

export function mediaDir(slug: string): string {
  return `/blog/media/${slug}`;
}

/** Fold fresh items into the previous manifest (a --only run keeps the rest). */
export function mergeMediaItems(
  prev: readonly MediaItem[],
  fresh: readonly MediaItem[],
  order: readonly string[],
): MediaItem[] {
  const byId = new Map(prev.map((i) => [i.id, i]));
  for (const f of fresh) byId.set(f.id, f);
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...byId.values()].filter((i) => order.includes(i.id)).sort((a, b) => rank(a.id) - rank(b.id));
}

export function manifestFiles(items: readonly MediaItem[]): MediaFile[] {
  return items.flatMap((i) => Object.values(i.files).filter((f): f is MediaFile => !!f));
}

// ─── markdown → figure ───────────────────────────────────────────────

export type MediaRender =
  | {
      kind: "image";
      id: string;
      webp: string;
      png: string;
      width: number;
      height: number;
      displayWidth: number;
      alt: string;
      caption: string;
    }
  | {
      kind: "video";
      id: string;
      mp4: string;
      webm: string;
      poster: string;
      width: number;
      height: number;
      displayWidth: number;
      alt: string;
      caption: string;
    };

const MEDIA_SRC_RE = /^\/blog\/media\/([0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(webp|png|mp4|webm|jpg)$/;

export function parseMediaSrc(src: string | null | undefined): { slug: string; id: string; ext: string } | null {
  const m = MEDIA_SRC_RE.exec(src ?? "");
  return m ? { slug: m[1]!, id: m[2]!, ext: m[3]! } : null;
}

/**
 * `![alt](/blog/media/<slug>/<id>.webp "caption")` → a picture, `.mp4` →
 * a clip. Alt and caption come from the markdown when given, else from
 * the manifest. Null for anything not in this post's manifest, so a stray
 * image never renders half-broken.
 */
export function resolveBlogMedia(
  img: { src?: string | null; alt?: string | null; title?: string | null },
  manifest: MediaManifest | null | undefined,
): MediaRender | null {
  const ref = parseMediaSrc(img.src);
  if (!ref || !manifest || manifest.post !== ref.slug) return null;
  const item = manifest.items.find((i) => i.id === ref.id);
  if (!item) return null;
  const alt = img.alt?.trim() || item.alt;
  const caption = img.title?.trim() || item.caption;
  const f = item.files;
  if (item.kind === "screenshot") {
    if (ref.ext !== "webp" && ref.ext !== "png") return null;
    if (!f.webp || !f.png) return null;
    return {
      kind: "image",
      id: item.id,
      webp: f.webp.path,
      png: f.png.path,
      width: item.width,
      height: item.height,
      displayWidth: item.displayWidth,
      alt,
      caption,
    };
  }
  if (ref.ext !== "mp4" && ref.ext !== "webm") return null;
  if (!f.mp4 || !f.webm || !f.jpg) return null;
  return {
    kind: "video",
    id: item.id,
    mp4: f.mp4.path,
    webm: f.webm.path,
    poster: f.jpg.path,
    width: item.width,
    height: item.height,
    displayWidth: item.displayWidth,
    alt,
    caption,
  };
}

/** Every media src a markdown body references, in order. */
export function mediaRefs(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\((\/blog\/media\/[^\s)]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) out.push(m[1]!);
  return out;
}

// ─── weekly stub ─────────────────────────────────────────────────────

export type WeeklyMediaFeature = { title: string; route: string | null };

/**
 * A starter capture manifest for a weekly post: the feature's page on a
 * phone, the same on desktop, and a short phone clip scrolling it. The
 * weekly job edits steps and captions before it runs the capture.
 */
export function weeklyMediaStub(slug: string, feature: WeeklyMediaFeature | null): { post: string; shots: Record<string, unknown>[] } {
  const route = feature?.route && feature.route.startsWith("/") && !FORBIDDEN_PATH_RE.test(feature.route) ? feature.route : "/";
  // "B05 · Weather line" -> "Weather line": the backlog id is for us.
  const what = feature?.title.replace(/^[A-Z]+\d+\s*·\s*/, "").trim() || "This week's feature";
  return {
    post: slug,
    shots: [
      {
        id: "feature-phone",
        kind: "screenshot",
        url: route,
        viewport: "phone",
        steps: ["wait 2500"],
        caption: `${what}, on a phone.`,
        alt: `${what} on SmokySignal at phone width.`,
      },
      {
        id: "feature-desktop",
        kind: "screenshot",
        url: route,
        viewport: "desktop",
        steps: ["wait 2500"],
        caption: `${what}, on desktop with the sidebar.`,
        alt: `${what} on SmokySignal at desktop width.`,
      },
      {
        id: "feature-clip",
        kind: "clip",
        url: route,
        viewport: "phone",
        steps: ["wait 2500", "start", "wait 1000", "scroll 500", "wait 2500", "scroll 500", "wait 2000"],
        duration: 6,
        caption: `${what} in motion.`,
        alt: `${what}: a short clip scrolling the page on a phone.`,
      },
    ],
  };
}

/** The markdown lines a weekly post carries for its stub shots. */
export function weeklyMediaMarkdown(slug: string, stub: { shots: Record<string, unknown>[] }): string[] {
  return stub.shots.map((s) => {
    const ext = s.kind === "clip" ? "mp4" : "webp";
    return `![${String(s.alt)}](${mediaDir(slug)}/${String(s.id)}.${ext} "${String(s.caption).replace(/"/g, "'")}")`;
  });
}
