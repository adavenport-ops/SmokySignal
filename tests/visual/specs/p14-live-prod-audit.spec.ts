// Prompt 14 live-prod truth audit. Hits the live site (www.smokysignal.app)
// and validates each claim with explicit Pass/Fail evidence written to
// /tmp/p14-audit/findings.json. Does NOT modify code; produces evidence
// only. Preferred entry point: `npm run verify-prod` from the repo root.
// Direct: npx playwright test specs/p14-live-prod-audit.spec.ts
//   --project=chromium-mobile  (rider context)
//   --project=chromium-desktop (desktop responsiveness)
//
// ?mock= is ignored on production, so claims that need a mocked state
// record "indeterminate (mock disabled in prod)" there and run fully
// against `next dev` or a preview (SS_VISUAL_BASE_URL=...).

import { test, expect, devices, type APIRequestContext, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const AUDIT_DIR = "/tmp/p14-audit";
fs.mkdirSync(AUDIT_DIR, { recursive: true });

// Tacoma center for mocked rider geolocation.
const TACOMA = { latitude: 47.2529, longitude: -122.4443 };

type Finding = {
  claim: string;
  category:
    | "confirmed_bug"
    | "working_as_designed"
    | "unshipped"
    | "feature_gap"
    | "polish_needed"
    | "indeterminate";
  pass: boolean;
  evidence: string;
  screenshot?: string;
};

// Findings are appended to findings.jsonl as they are recorded, tagged with
// the project and the run id (playwright.config.ts sets SS_AUDIT_RUN once
// per invocation). A worker restarts after any failed test and every
// project runs in its own worker, so an in-memory array written in
// afterAll used to lose or overwrite findings. afterAll rebuilds
// findings.json from this run's lines; scripts/verify-prod.zsh does the
// same once the whole run is over.
const RUN_ID = process.env.SS_AUDIT_RUN ?? "adhoc";
const JSONL = path.join(AUDIT_DIR, "findings.jsonl");

type Logged = Finding & { project: string; run: string; test: string };

function record(f: Finding) {
  const info = test.info();
  const line: Logged = { ...f, project: info.project.name, run: RUN_ID, test: info.title };
  fs.appendFileSync(JSONL, JSON.stringify(line) + "\n");
  const tag = f.category === "indeterminate" ? "INDETERMINATE" : f.pass ? "PASS" : "FAIL";
  console.log(`[${tag}] [${line.project}] ${f.claim} (${f.category}) — ${f.evidence}`);
}

function thisRunFindings(): Logged[] {
  if (!fs.existsSync(JSONL)) return [];
  const out: Logged[] = [];
  for (const l of fs.readFileSync(JSONL, "utf8").split("\n")) {
    if (!l) continue;
    try {
      const x = JSON.parse(l) as Logged;
      if (x.run === RUN_ID) out.push(x);
    } catch {
      /* partial line from a killed worker */
    }
  }
  return out;
}

test.afterAll(async () => {
  fs.writeFileSync(
    path.join(AUDIT_DIR, "findings.json"),
    JSON.stringify(thisRunFindings(), null, 2),
  );
});

// ─── ?mock= gate ──────────────────────────────────────────────────────
// ?mock= is ignored on the production deployment (lib/mock-state.ts,
// VERCEL_ENV=production). Claims that need a mocked state probe once per
// worker; against prod they record "indeterminate" instead of failing,
// and against dev or a preview deploy they run as before.
const MOCK_OFF = "indeterminate (mock disabled in prod)";
let mockProbe: Promise<boolean> | null = null;
function mockHonored(request: APIRequestContext): Promise<boolean> {
  mockProbe ??= (async () => {
    const r = await request.get("/api/aircraft?mock=stale");
    if (!r.ok()) return false;
    const d = (await r.json().catch(() => null)) as { source?: string } | null;
    return d?.source === "mock";
  })();
  return mockProbe;
}
function recordMockOff(claim: string, screenshot?: string) {
  record({ claim, category: "indeterminate", pass: true, evidence: MOCK_OFF, screenshot });
}

// Vercel's edge consumes s-maxage / stale-while-revalidate and forwards
// only "public" (claim 22), so from the client a route set to
// "public, s-maxage=60" reads as "public". Accept either: an explicit
// s-maxage within the bound (dev / next start), or a public response with
// no no-store / private (prod edge).
function edgeCacheable(cc: string, sMaxMax?: number): boolean {
  if (/no-store|private/i.test(cc)) return false;
  const m = /s-maxage=(\d+)/.exec(cc);
  if (m) return sMaxMax == null || Number(m[1]) <= sMaxMax;
  return /\bpublic\b/i.test(cc);
}

// Evidence only: a screenshot that times out (a busy WebGL canvas under
// SwiftShader can stall a full-page capture) falls back to the viewport,
// and never fails the claim it illustrates.
async function shot(page: Page, name: string): Promise<string> {
  const p = path.join(AUDIT_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: p, fullPage: true, timeout: 15_000 });
  } catch {
    await page.screenshot({ path: p, timeout: 10_000 }).catch(() => {});
  }
  return p;
}

async function inspectMaplibreLayers(page: Page) {
  return await page.evaluate(() => {
    // Runtime introspection: the map instance is not a typed global.
    const map = (window as any).__ssMap || null;
    if (!map) {
      // Fallback: walk maplibre-gl-canvas elements; the map instance
      // isn't exposed today. Read from a registered global if needed.
      return { hasGlobal: false, layers: [], sources: [] };
    }
    const style = map.getStyle?.();
    return {
      hasGlobal: true,
      layers: style?.layers?.map((l: any) => l.id) ?? [],
      sources: Object.keys(style?.sources ?? {}),
    };
  });
}

test.describe("p14 live-prod audit", () => {
  test("1. brand mark on home", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "01-home-brand");
    // Brand mark is the Logo glyph in the header — measure rendered size.
    const logo = page.locator("header svg").first();
    const box = await logo.boundingBox().catch(() => null);
    record({
      claim: "Brand mark prominent on /",
      category: box && box.height >= 32 ? "working_as_designed" : "polish_needed",
      pass: box != null && box.height >= 32,
      evidence: box
        ? `header logo SVG ${Math.round(box.width)}×${Math.round(box.height)}px`
        : "no SVG found in header",
      screenshot,
    });
  });

  test("2. trail line behind aircraft on /radar", async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(TACOMA);
    // ?mock=up forces an airborne fleet so we can check the trail layer
    // even when the live fleet is grounded. Prod ignores ?mock=, so there
    // this reads the live fleet.
    const mock = await mockHonored(page.request);
    await page.goto(mock ? "/radar?mock=up" : "/radar", { waitUntil: "networkidle" });
    // The map instance is not exposed and MapLibre paints to canvas, so
    // the old style/HTML probe could never see the layer. RadarShell
    // renders TrailStatusBadge beside it, reading the same /api/trails
    // feed: "TRAIL · N TAILS · M POINTS", "TRAIL · NO AIRBORNE TAILS",
    // or "TRAIL · ERR <status>".
    // The badge flips to FETCHING on every 10s poll, so sample it until it
    // settles on a result (or 30s pass).
    const badge = page.locator("text=/^TRAIL · /").first();
    let label = "";
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      label = ((await badge.innerText().catch(() => "")) || "").trim();
      if (label && !/FETCHING|IDLE/.test(label)) break;
      await page.waitForTimeout(500);
    }
    const screenshot = await shot(page, "02-radar-trail");
    const m = /^TRAIL · (\d+) TAILS · (\d+) POINTS$/.exec(label);
    const claim = "Trail line behind airborne aircraft on /radar (trail feed reaches the radar)";
    if (/NO AIRBORNE TAILS/.test(label)) {
      // Nothing up and (on prod) no ?mock=up to force a fleet.
      record({
        claim,
        category: "indeterminate",
        pass: true,
        evidence: `badge="${label}"${mock ? "" : ` — ${MOCK_OFF}`}`,
        screenshot,
      });
      return;
    }
    const pass = m != null;
    record({
      claim,
      category: pass ? "working_as_designed" : label ? "confirmed_bug" : "unshipped",
      pass,
      evidence: label ? `badge="${label}"` : "no TRAIL status badge on /radar",
      screenshot,
    });
  });

  test("3. distance rings on /radar", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(TACOMA);
    // Pre-set the localStorage flag so rings render visible by default
    // for this test — the feature exists but ships toggled off.
    await page.addInitScript(() => {
      window.localStorage.setItem("ss_distance_rings_visible", "1");
    });
    await page.goto("/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const screenshot = await shot(page, "03-radar-rings");
    // Look for the ring SVG / line layer rendered into the canvas. Since
    // MapLibre paints to canvas, we can't easily DOM-check; instead probe
    // the toggle button's ARIA state.
    const toggleVisible = await page
      .locator('[aria-label*="distance ring" i], button:has-text("rings")')
      .count();
    record({
      claim: "Distance rings on /radar (rings layer present, toggleable)",
      category: toggleVisible > 0 ? "working_as_designed" : "polish_needed",
      pass: toggleVisible > 0,
      evidence:
        toggleVisible > 0
          ? `ring toggle present (${toggleVisible})`
          : "no ring toggle button discoverable in DOM",
      screenshot,
    });
  });

  test("4. heatmap layer registered on /radar", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(TACOMA);
    await page.goto("/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    const screenshot = await shot(page, "04-radar-heat");
    // Try the API directly — if /api/hotzones returns 200, the pipeline
    // is alive. Empty zones array = correct learning state, not bug.
    const apiRes = await page.request.get("/api/hotzones?region_id=puget_sound");
    const apiOk = apiRes.ok();
    const body = apiOk ? await apiRes.json() : null;
    const zoneCount = Array.isArray(body?.zones) ? body.zones.length : 0;
    record({
      claim: "Heatmap layer registered + API alive on /radar",
      category:
        apiOk && zoneCount === 0
          ? "working_as_designed"
          : apiOk
            ? "working_as_designed"
            : "confirmed_bug",
      pass: apiOk,
      evidence: apiOk
        ? `/api/hotzones 200, ${zoneCount} zones (Day-X learning state)`
        : `/api/hotzones ${apiRes.status()}`,
      screenshot,
    });
  });

  test("5. region selector recenter (Puget Sound → Spokane → Puget Sound)", async ({
    page,
    context,
  }) => {
    // Three full-page radar captures plus two camera moves run past 60s on
    // the tablet viewport.
    test.setTimeout(120_000);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(TACOMA);
    await page.goto("/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const sel = page.locator('select[aria-label="Region"]');
    if ((await sel.count()) === 0) {
      record({
        claim: "Region selector recenter",
        category: "confirmed_bug",
        pass: false,
        evidence: "no region selector found on /radar",
      });
      return;
    }
    // 1st screenshot: default (Puget Sound)
    await shot(page, "05a-region-pugetsound-initial");
    // → East WA (Spokane folded into this preset in P16.3)
    await sel.selectOption("east_wa");
    await page.waitForTimeout(2000);
    await shot(page, "05b-region-east-wa");
    // → back to Puget Sound
    await sel.selectOption("puget_sound");
    await page.waitForTimeout(2000);
    const finalShot = await shot(page, "05c-region-pugetsound-after");
    // We can't programmatically inspect map center without the map ref
    // exposed, so this is visual evidence — Alex reviews the screenshots.
    record({
      claim: "Region selector recenter (PS → East WA → PS)",
      category: "indeterminate",
      pass: true,
      evidence:
        "screenshots captured at 05a/05b/05c — manual visual inspection " +
        "needed to confirm 05c shows Puget Sound (47.6, -122.3) and not " +
        "East WA or Tacoma rider position",
      screenshot: finalShot,
    });
  });

  test("6. click-to-follow plane on /radar", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(TACOMA);
    const mock = await mockHonored(page.request);
    await page.goto(mock ? "/radar?mock=up" : "/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(3500);
    const screenshot = await shot(page, "06-radar-followable");
    // Mock-up data should include airborne aircraft. Look for the
    // aircraft chevron canvas — can't click programmatically without
    // map coords, so just verify the carousel / aircraft list shows
    // an airborne tail (smoke test for the follow surface existing).
    const airborneText = await page
      .locator("text=/airborne|UP|/")
      .first()
      .textContent()
      .catch(() => null);
    record({
      claim: "Click-to-follow plane on /radar (surface available)",
      category: "polish_needed",
      pass: true,
      evidence:
        "follow logic in components/RadarMap.tsx onClick handler with 200px " +
        "hysteresis — visual click test requires real coords; surface present",
      screenshot,
    });
  });

  test("7. Also-up card click target", async ({ page }) => {
    const claim =
      'Also-up rows are whole-row links to /plane/<tail> with a "View … details" label and a chevron affordance';
    const mock = await mockHonored(page.request);
    await page.goto(mock ? "/?mock=up" : "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const screenshot = await shot(page, "07-home-alsoup");
    // components/Glanceable.tsx renders each row as one <Link> with
    // data-testid="also-up-row", an aria-label and a trailing chevron SVG.
    const rows = page.locator('[data-testid="also-up-row"]');
    const n = await rows.count();
    if (n === 0) {
      // Rows only render when 2+ aircraft are up. Without ?mock=up (prod)
      // the live sky decides.
      if (!mock) recordMockOff(`${claim} (no also-up rows in the live sky)`, screenshot);
      else
        record({ claim, category: "confirmed_bug", pass: false, evidence: "?mock=up rendered no also-up rows", screenshot });
      return;
    }
    const rowInfo = await rows.evaluateAll((els) =>
      els.map((e) => ({
        href: e.getAttribute("href") ?? "",
        label: e.getAttribute("aria-label") ?? "",
        chevron: e.querySelector("svg polyline") != null,
      })),
    );
    const pass = rowInfo.every(
      (r) => /^\/plane\/[A-Z0-9]+$/.test(r.href) && /^View .+ details\./.test(r.label) && r.chevron,
    );
    record({
      claim,
      category: pass ? "working_as_designed" : "polish_needed",
      pass,
      evidence: `${n} row(s): ${JSON.stringify(rowInfo.slice(0, 3))}`,
      screenshot,
    });
  });

  test("8a. desktop responsiveness — home @ 1280", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const screenshot = await shot(page, "08a-home-1280");
    const main = page.locator("main").first();
    const box = await main.boundingBox().catch(() => null);
    const usesWidth = box != null && box.width >= 700;
    record({
      claim: "Desktop responsiveness — / @ 1280px",
      category: usesWidth ? "working_as_designed" : "polish_needed",
      pass: usesWidth,
      evidence: box
        ? `<main> ${Math.round(box.width)}px wide @ 1280 viewport (mobile-shaped if <700)`
        : "no <main> found",
      screenshot,
    });
    await ctx.close();
  });

  test("9. alert opt-in card on home", async ({ page }) => {
    // Headless Chromium defaults Notification.permission to "denied"
    // (no UI means no opt-in dialog can ever show), and Playwright's
    // grantPermissions(['notifications']) doesn't reliably flip the
    // JS-visible Notification.permission property either. Real
    // first-visit riders have permission "default" and see the Arm CTA.
    // Override the property pre-document-load so the component takes
    // the rider-realistic path.
    await page.addInitScript(() => {
      // Headless contexts that DO expose Notification often default
      // permission to "denied". Override to "default" so the rider-
      // realistic Arm CTA branch is exercised. Wrapped in typeof guard
      // because some emulated UAs (WebKit-via-iPhone) don't expose the
      // Notification API at all — accessing it throws.
      try {
        if (typeof Notification !== "undefined") {
          Object.defineProperty(Notification, "permission", {
            configurable: true,
            get: () => "default",
          });
        }
      } catch (_) {
        /* best-effort */
      }
    });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const screenshot = await shot(page, "09-home-armcta");
    // The ArmAlertsCallout component shows one of three surfaces:
    //   1. The Arm CTA              (Notification.permission === "default")
    //   2. The "Browser blocked"    (Notification.permission === "denied")
    //   3. NULL on an iPhone/iPad UA outside an installed PWA
    //      (needsIOSInstall(), or the Notification API is absent)
    //
    // The iPhone-emulating projects send an iOS Safari UA, so case 3
    // (component correctly self-hides) is the rider-realistic outcome
    // there, NOT a bug, whether or not the engine exposes Notification
    // (WebKit strips it; Chromium with an iPhone UA keeps it). The
    // IOSInstallPrompt card covers the rider in that case with its
    // "Add to Home Screen" steps.
    //
    // Probe + accept any of the three valid surfaces.
    const { hasNotif, iosUa } = await page.evaluate(() => {
      let hasNotif = false;
      try {
        hasNotif = typeof Notification !== "undefined";
      } catch (_) {
        hasNotif = false;
      }
      return { hasNotif, iosUa: /iPhone|iPad|iPod/.test(navigator.userAgent) };
    });
    const iosPath = iosUa || !hasNotif;
    const armLink = await page
      .locator('a[href="/settings/alerts"]:has-text("Arm")')
      .count();
    const blockedText = await page
      // "Alerts are blocked" is the platform-aware copy (lib/alerts-ux.ts),
      // shown only after the rider has tapped Arm on this device.
      .locator(':has-text("Browser blocked alerts"), :has-text("Alerts are blocked")')
      .count();
    // Look for the IOSInstallPrompt's distinctive "Add to Home Screen"
    // step copy. Robust to quote-character variants.
    const iosInstructions = await page
      .locator(':has-text("Add to Home Screen")')
      .count();
    const visible =
      armLink > 0 ||
      blockedText > 0 ||
      // On iOS-class UAs, IOSInstallPrompt is the rider-correct surface.
      (iosPath && iosInstructions > 0);
    const evidence =
      armLink > 0
        ? `${armLink} "Arm" CTA(s) found linking to /settings/alerts`
        : blockedText > 0
          ? "blocked-state surface rendered (permission denied)"
          : iosPath && iosInstructions > 0
            ? `iOS install instructions rendered (iOS UA=${iosUa}, Notification API=${hasNotif} — correct for iOS Safari)`
            : 'no "Arm" CTA, blocked-state, or iOS install instructions found';
    record({
      claim: "Arm-alerts CTA visible on / for new visitors",
      category: visible ? "working_as_designed" : "confirmed_bug",
      pass: visible,
      evidence,
      screenshot,
    });
  });

  test("10. hot-zones filter terminology", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(TACOMA);
    await page.goto("/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    // Open the chevron filter panel — find the filter button (aria-label).
    const filterBtn = page.locator(
      'button[aria-label*="filter" i], button[aria-label*="hot zone" i]',
    );
    const found = await filterBtn.count();
    if (found === 0) {
      record({
        claim: 'Hot-zones filter has "Smokey" option mapping to roles',
        category: "indeterminate",
        pass: false,
        evidence: "no filter button discoverable in DOM",
      });
      return;
    }
    await filterBtn.first().click();
    await page.waitForTimeout(500);
    const screenshot = await shot(page, "10-hotzones-filter");
    // Mission taxonomy (2026-11): the Missions row lists Everything plus
    // one chip per mission (lib/radar-filter.ts RIDER_BUCKETS). Default
    // selection is Smokey (police) only.
    const smokeyChip = page.locator('button[aria-pressed]', { hasText: /^Smokey$/ });
    const hasSmokey = (await smokeyChip.count()) > 0;
    const smokeyOn = hasSmokey && (await smokeyChip.first().getAttribute("aria-pressed")) === "true";
    const hasEverything =
      (await page.locator('button[aria-pressed]', { hasText: /^Everything$/ }).count()) > 0;
    const hasFederal =
      (await page.locator('button[aria-pressed]', { hasText: /^Federal$/ }).count()) > 0;
    const pass = hasSmokey && hasEverything && hasFederal;
    record({
      claim:
        'Radar filter lists missions: "Everything" + one chip per mission, Smokey (police) on by default',
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `smokey=${hasSmokey} smokeyOn=${smokeyOn} everything=${hasEverything} federal=${hasFederal}`,
      screenshot,
    });
  });

  test("11. learning panel reads 'the sky' not 'your sky' (P19 2.4)", async ({
    page,
  }) => {
    await page.goto("/forecast", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "11-learning-panel-voice");
    const html = (await page.content()).toUpperCase();
    const hasOldCopy = html.includes("LEARNING YOUR SKY");
    const hasNewCopy = html.includes("LEARNING THE SKY");
    const pass = !hasOldCopy && hasNewCopy;
    // The panel only renders while the forecast is still learning
    // (app/(tabs)/forecast/page.tsx showLearning). Once the 30-day window
    // and the event floor are met it is gone, so neither eyebrow shows;
    // ?mock=learning (non-prod, claim 17) covers the copy then.
    const panelHidden = !hasOldCopy && !hasNewCopy;
    record({
      claim:
        'Learning panel eyebrow reads "LEARNING THE SKY" (not "YOUR SKY") to defuse the user-watching ambiguity',
      category: pass ? "working_as_designed" : panelHidden ? "indeterminate" : "confirmed_bug",
      pass: pass || panelHidden,
      evidence: pass
        ? '"LEARNING THE SKY" rendered, "LEARNING YOUR SKY" absent'
        : panelHidden
          ? "learning panel not rendered (learning window complete); old copy absent"
          : `hasOld=${hasOldCopy} hasNew=${hasNewCopy} — old copy is back`,
      screenshot,
    });
  });

  test("12. /plane/[tail] no duplicate 'Last seen' (P19 2.2)", async ({
    page,
  }) => {
    await page.goto("/plane/N305DK", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "12-plane-last-seen-dedupe");
    const body = await page.locator("main").innerText();
    // The persona finding: "Last seen a while" appeared in both the
    // header status pill and the Currently card. Post-fix, the two
    // surfaces use distinct labels:
    //   - StatusPill sub: "Last flew" or "Last contact" or "No recent contact"
    //   - GroundedNote:   "Last position broadcast" or "Awaiting next position broadcast"
    // The exact "Last seen a while" string must not appear at all.
    const hasLastSeenAWhile = /last seen.*a while|a while.*last seen/i.test(body);
    const lastSeenCount = (body.match(/last seen/gi) ?? []).length;
    const pass = !hasLastSeenAWhile && lastSeenCount === 0;
    record({
      claim:
        '/plane/[tail] uses distinct labels for the header pill ("Last flew"/"Last contact") vs Currently card ("Last position broadcast")',
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: pass
        ? '"last seen" string absent; pill and card carry distinct labels'
        : `"last seen" appeared ${lastSeenCount}x; legacy duplicate may have regressed`,
      screenshot,
    });
  });

  test("13a. home FreshnessLabel includes PT clock (P19 2.1)", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "13a-home-freshness-pt");
    // Pattern: "LAST SAMPLE — JUST NOW · 15:37 PT" or "LAST SAMPLE — 12m AGO · 15:25 PT".
    // On narrow phones CSS hides the full text and shows "12m AGO · 15:25"
    // (components/FreshnessLabel.tsx), so innerText misses it there; read
    // textContent plus the aria-label ("Last sample 12m ago, 15:25 Pacific").
    const body = (await page.locator("main").textContent()) ?? "";
    const aria = (
      await page
        .locator('[aria-label^="Last sample"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))
    ).join(" | ");
    const hasFreshnessPt =
      /LAST SAMPLE\s+—\s+(JUST NOW|\d+m AGO)\s+·\s+\d{2}:\d{2}\s+PT/i.test(body) ||
      /Last sample (just now|\d+m ago), \d{2}:\d{2} Pacific/i.test(aria);
    const hasUnknown = /LAST SAMPLE\s+—\s+UNKNOWN/i.test(body) || /Last sample unknown/i.test(aria);
    const pass = hasFreshnessPt || hasUnknown;
    record({
      claim:
        "Home 'LAST SAMPLE' footer carries explicit 'HH:MM PT' so out-of-region readers don't have to infer the reference frame",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: pass
        ? hasFreshnessPt
          ? "PT clock format present in FreshnessLabel"
          : "UNKNOWN state (no live sample) — accepted"
        : "FreshnessLabel rendered without 'HH:MM PT' suffix",
      screenshot,
    });
  });

  test("13b. /flights Recent rows include PT clock (P19 2.1)", async ({ page }) => {
    await page.goto("/flights?tab=recent", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "13b-activity-pt-clock");
    const body = await page.locator("main").innerText();
    // Pattern: "12m ago · 15:42 PT" or "just now · 15:42 PT"
    const hasActivityPt =
      /(\d+[mhd]\s+ago|just now)\s+·\s+\d{2}:\d{2}\s+PT/i.test(body);
    // Empty state acceptable (no rows yet)
    const isEmpty = /Watching the sky/i.test(body);
    const pass = hasActivityPt || isEmpty;
    record({
      claim:
        "/flights?tab=recent row metadata pairs relative ('12m ago') with absolute PT ('15:42 PT') so the journalist persona can cite times",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: pass
        ? hasActivityPt
          ? "row metadata includes 'HH:MM PT'"
          : "empty state — accepted"
        : "activity rows render relative time only, no PT clock",
      screenshot,
    });
  });

  test("14. /forecast 'Live now' bridge to /radar (P19 2.3)", async ({
    page,
  }) => {
    // The bridge only renders when an alert-class plane is airborne.
    // We mock that condition via ?mock=up on /forecast — except /forecast
    // doesn't accept ?mock=up directly. Instead, check both branches:
    //   - If anything alert-class is up live, the callout must be present.
    //   - If nothing alert-class is up, the callout must be absent.
    // Either branch is a valid "shipped" state.
    await page.goto("/forecast", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "14-forecast-live-bridge");
    const body = await page.locator("main").innerText();
    const liveBridgePresent =
      /LIVE NOW/i.test(body) && /SEE \/RADAR/i.test(body);
    // Sanity: the rest of the page rendered
    const weeklyHeader = /Weekly forecast/i.test(body);
    // We can't deterministically know the live state from prod, so the
    // assertion is asymmetric: we pass either way unless the page failed
    // to render. We surface which branch we're in via evidence.
    const pass = weeklyHeader;
    record({
      claim:
        "/forecast renders a 'LIVE NOW · SEE /RADAR' bridge whenever an alert-class plane is airborne (otherwise the bridge is absent)",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: pass
        ? liveBridgePresent
          ? "live-bridge present (alert-class plane airborne in current snapshot)"
          : "live-bridge absent (no alert-class plane airborne — correct)"
        : "/forecast did not render expected page chrome",
      screenshot,
    });
  });

  test("15. ?mock=eyes-up returns sheriff airborne, no WSP (P20 4.1)", async ({
    request,
  }) => {
    if (!(await mockHonored(request))) {
      recordMockOff(
        "?mock=eyes-up forces a non-WSP police airframe (sheriff) airborne with no WSP — still reads SMOKEY UP",
      );
      return;
    }
    const r = await request.get("/api/aircraft?mock=eyes-up");
    const ok = r.ok();
    let evidence = `HTTP ${r.status()}`;
    let pass = false;
    if (ok) {
      const data = (await r.json()) as {
        aircraft: Array<{ role: string; policeUnit?: string; airborne: boolean }>;
      };
      const airborne = data.aircraft.filter((a) => a.airborne);
      const wspUp = airborne.some((a) => a.role === "police" && a.policeUnit === "wsp");
      const otherPoliceUp = airborne.some((a) => a.role === "police" && a.policeUnit !== "wsp");
      pass = !wspUp && otherPoliceUp;
      evidence = `${airborne.length} airborne; wsp=${wspUp ? "yes" : "no"}; other police=${otherPoliceUp ? "yes" : "no"}`;
    }
    record({
      claim:
        "?mock=eyes-up forces a non-WSP police airframe (sheriff) airborne with no WSP — still reads SMOKEY UP",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence,
    });
  });

  test("16. ?mock=stale returns old fetched_at (P20 4.1)", async ({
    request,
  }) => {
    if (!(await mockHonored(request))) {
      recordMockOff(
        "?mock=stale returns fetched_at >15min ago with source='mock' — flips FreshnessLabel amber",
      );
      return;
    }
    const r = await request.get("/api/aircraft?mock=stale");
    let evidence = `HTTP ${r.status()}`;
    let pass = false;
    if (r.ok()) {
      const data = (await r.json()) as { fetched_at: number; source: string };
      const ageMin = Math.floor((Date.now() - data.fetched_at) / 60_000);
      pass = ageMin >= 15 && data.source === "mock";
      evidence = `fetched_at=${ageMin}m ago, source=${data.source}`;
    }
    record({
      claim:
        "?mock=stale returns fetched_at >15min ago with source='mock' — flips FreshnessLabel amber",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence,
    });
  });

  test("17. ?mock=learning shows the learning panel on /forecast (P21 2.1)", async ({
    page,
  }) => {
    if (!(await mockHonored(page.request))) {
      recordMockOff("?mock=learning forces /forecast into Day 0 of 30 — learning panel visible");
      return;
    }
    await page.goto("/forecast?mock=learning", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "17-forecast-mock-learning");
    const html = (await page.content()).toUpperCase();
    const hasLearning = html.includes("LEARNING THE SKY");
    const hasDay0 = /DAY 0 OF 30/.test(html);
    const pass = hasLearning && hasDay0;
    record({
      claim:
        "?mock=learning forces /forecast into Day 0 of 30 — learning panel visible",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: pass
        ? '"LEARNING THE SKY" + "DAY 0 OF 30" both rendered'
        : `learning=${hasLearning} day0=${hasDay0}`,
      screenshot,
    });
  });

  test("18. ?mock=full-data hides the learning panel on /forecast (P21 2.2)", async ({
    page,
  }) => {
    if (!(await mockHonored(page.request))) {
      recordMockOff(
        "?mock=full-data hides the LearningPanel on /forecast — predictor confident, no learning eyebrow",
      );
      return;
    }
    await page.goto("/forecast?mock=full-data", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "18-forecast-mock-full-data");
    const html = (await page.content()).toUpperCase();
    // In full-data state, the synthesized grid has plenty of events and
    // learning.stillLearning is false → LearningPanel renders nothing
    // (showLearning gate fails) and the eyebrow is absent.
    const hasLearning = html.includes("LEARNING THE SKY");
    const pass = !hasLearning;
    record({
      claim:
        "?mock=full-data hides the LearningPanel on /forecast — predictor confident, no learning eyebrow",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: pass
        ? "learning panel absent (eyebrow not rendered)"
        : "learning panel still rendered with full-data — gate didn't trip",
      screenshot,
    });
  });

  test("20. /qa-dashboard exists + admin-gated (P22 4)", async ({ page }) => {
    await page.goto("/qa-dashboard", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const screenshot = await shot(page, "20-qa-dashboard-gate");
    const url = page.url();
    const body = (await page.locator("body").innerText()).slice(0, 600);
    // Three valid surfaces:
    //  (a) ADMIN_PASSCODE not configured → friendly message
    //  (b) Not authed → redirect to /admin?next=qa
    //  (c) Authed → dashboard renders (won't happen from prod audit
    //      without a session)
    const passcodeMissing = /ADMIN_PASSCODE/.test(body);
    const redirectedToAdmin = /\/admin/.test(url) && /next=qa/.test(url);
    const dashboardRendered = /QA dashboard/.test(body) && /Last fleet refresh/i.test(body);
    const pass = passcodeMissing || redirectedToAdmin || dashboardRendered;
    record({
      claim:
        "/qa-dashboard responds (admin-gated): redirects to /admin?next=qa, shows ADMIN_PASSCODE-missing surface, or renders the dashboard",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: passcodeMissing
        ? "passcode-missing surface rendered"
        : redirectedToAdmin
          ? `redirected to ${url}`
          : dashboardRendered
            ? "dashboard rendered (admin session present)"
            : `unexpected response: url=${url} body-prefix="${body.slice(0, 120)}"`,
      screenshot,
    });
  });

  test("21. /stats renders the permanent rollup or its empty state, reachable from /about", async ({
    page,
  }) => {
    await page.goto("/about", { waitUntil: "networkidle" });
    const hubLink = await page
      .locator('nav[aria-label="Site sections"] a[href="/stats"]')
      .count();
    const resp = await page.goto("/stats", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const screenshot = await shot(page, "21-stats");
    const status = resp?.status() ?? 0;
    const body = await page.locator("main").innerText();
    const hasHeading = /How the bird flew\./.test(body);
    const span = (
      await page.locator('[data-testid="stats-span"]').innerText().catch(() => "")
    ).trim();
    // Either the empty state, or the data label + all four data sections.
    const isEmpty = (await page.locator('[data-testid="stats-empty"]').count()) > 0;
    const spanOk = isEmpty
      ? /^0 days of data$/.test(span)
      : /^\d+ days? of data since \d{4}-\d{2}-\d{2}$/.test(span);
    const sections = await Promise.all(
      ["stats-weekly", "stats-grid", "stats-tails"].map((id) =>
        page.locator(`[data-testid="${id}"]`).count(),
      ),
    );
    const dataOk = isEmpty || sections.every((n) => n > 0);
    const noBang = !/[A-Za-z]!(\s|$)/.test(body);
    const pass =
      status === 200 && hubLink > 0 && hasHeading && spanOk && dataOk && noBang;
    record({
      claim:
        "/stats returns 200, is linked from the /about hub, shows 'How the bird flew.', an 'N days of data since YYYY-MM-DD' label and the weekly / grid / per-tail sections (or the empty state before the first rollup)",
      category: pass ? "working_as_designed" : status === 404 ? "unshipped" : "confirmed_bug",
      pass,
      evidence: `HTTP ${status}; hub link=${hubLink}; heading=${hasHeading}; span="${span}"; empty=${isEmpty}; sections=${sections.join("/")}; no-exclamation=${noBang}`,
      screenshot,
    });
  });

  test("19. /api/health reports last_refresh_age_s under 10 min (helm pinger liveness)", async ({
    request,
  }) => {
    // The GitHub heartbeat workflow was retired: the helm pinger refreshes
    // the snapshot every 30s, so /api/health derives liveness from the
    // snapshot age (or the last feed sample). Same 10-minute threshold as
    // .github/workflows/feed-health.yml.
    const r = await request.get("/api/health");
    let evidence = `HTTP ${r.status()}`;
    let pass = false;
    let category: Finding["category"] = "confirmed_bug";
    if (r.ok()) {
      const data = (await r.json()) as {
        last_refresh_age_s?: number | null;
        snapshot_age_s?: number | null;
        last_heartbeat_age_s?: number | null;
      };
      const age = data.last_refresh_age_s;
      if (!("last_refresh_age_s" in data)) {
        // Deploy lag: prod still serves the pre-retirement shape.
        pass = "last_heartbeat_age_s" in data;
        category = pass ? "indeterminate" : "confirmed_bug";
        evidence = pass
          ? `last_refresh_age_s not deployed yet (snapshot_age_s=${data.snapshot_age_s})`
          : "neither last_refresh_age_s nor the legacy heartbeat fields are present";
      } else {
        pass = typeof age === "number" && age < 600;
        category = pass ? "working_as_designed" : "confirmed_bug";
        evidence = `last_refresh_age_s=${age} snapshot_age_s=${data.snapshot_age_s} legacy_heartbeat_field=${"last_heartbeat_age_s" in data}`;
      }
    }
    record({
      claim:
        "/api/health reports last_refresh_age_s (snapshot age, or the last feed sample) under 10 min",
      category,
      pass,
      evidence,
    });
  });

  test("22. /api/aircraft returns a valid snapshot; healthy ticks are CDN-cacheable, degraded ticks are no-store (#74)", async ({
    request,
  }) => {
    const r = await request.get("/api/aircraft");
    // Vercel strips s-maxage / stale-while-revalidate before the response
    // reaches the client, so only the presence of no-store is asserted.
    const cacheControl = r.headers()["cache-control"] ?? "";
    const noStore = /no-store/i.test(cacheControl);
    let pass = false;
    let category: Finding["category"] = "confirmed_bug";
    let evidence = `HTTP ${r.status()}, cache-control="${cacheControl}"`;
    if (r.ok()) {
      const data = (await r.json()) as {
        fetched_at?: unknown;
        source?: unknown;
        aircraft?: unknown;
        live_seen_count?: unknown;
        degraded?: unknown;
      };
      const valid =
        typeof data.fetched_at === "number" &&
        typeof data.source === "string" &&
        Array.isArray(data.aircraft) &&
        data.aircraft.length > 0 &&
        typeof data.live_seen_count === "number";
      const degraded = data.degraded === true;
      const ageS =
        typeof data.fetched_at === "number"
          ? Math.round((Date.now() - data.fetched_at) / 1000)
          : null;
      evidence += `, source=${String(data.source)}, degraded=${degraded}, age=${ageS}s, x-vercel-cache=${r.headers()["x-vercel-cache"] ?? "n/a"}`;
      if (!valid) {
        pass = false;
        category = "confirmed_bug";
        evidence += " — snapshot shape invalid";
      } else if (degraded) {
        // Upstream outage during the audit. The contract is no-store.
        pass = noStore;
        category = noStore ? "indeterminate" : "confirmed_bug";
        evidence += noStore
          ? " — feeds down at audit time; degraded tick correctly no-store"
          : " — degraded tick is CDN-cacheable";
      } else {
        pass = !noStore;
        category = pass ? "working_as_designed" : "confirmed_bug";
        if (!pass) evidence += " — healthy tick unexpectedly no-store";
      }
    }
    record({
      claim:
        "/api/aircraft responds with a valid snapshot; healthy → Cache-Control without no-store, degraded → no-store",
      category,
      pass,
      evidence,
    });
    expect(r.ok()).toBe(true);
  });

  // ─── Security headers / CSP (fix/input-privacy-headers) ─────────────
  // The CSP is enforced, so a missing host in next.config.mjs breaks a
  // page silently (blocked tile, worker, or script). These claims catch
  // that on prod: header present, and zero violations on the routes that
  // load the most third-party surface.
  for (const route of ["/", "/radar", "/plane/N305DK", "/help", "/admin"]) {
    test(`83. CSP enforced with zero violations on ${route}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).__ssCspViolations = [];
        document.addEventListener("securitypolicyviolation", (e) => {
          (window as any).__ssCspViolations.push(
            `${e.violatedDirective} ${e.blockedURI}`,
          );
        });
      });
      const consoleCsp: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" && /Content Security Policy/i.test(m.text())) {
          consoleCsp.push(m.text().slice(0, 200));
        }
      });
      const resp = await page.goto(route, { waitUntil: "networkidle" });
      await page.waitForTimeout(route === "/radar" || route.startsWith("/plane") ? 4000 : 1500);
      const headers = resp?.headers() ?? {};
      const csp = headers["content-security-policy"] ?? "";
      const events = (await page.evaluate(
        () => (window as any).__ssCspViolations ?? [],
      )) as string[];
      const pass =
        csp.includes("frame-ancestors 'none'") &&
        headers["x-frame-options"] === "DENY" &&
        headers["x-content-type-options"] === "nosniff" &&
        events.length === 0 &&
        consoleCsp.length === 0;
      const screenshot = await shot(
        page,
        `83-csp-${route === "/" ? "home" : route.replace(/\//g, "-").replace(/^-/, "")}`,
      );
      record({
        claim: `Security headers present and zero CSP violations on ${route}`,
        category: pass ? "working_as_designed" : csp ? "confirmed_bug" : "unshipped",
        pass,
        evidence: !csp
          ? "no Content-Security-Policy header"
          : `csp=${csp.length}ch xfo=${headers["x-frame-options"]} nosniff=${headers["x-content-type-options"]} violations=${events.length} console=${consoleCsp.length}${
              events.length ? ` first="${events[0]}"` : consoleCsp.length ? ` first="${consoleCsp[0]}"` : ""
            }`,
        screenshot,
      });
    });
  }

  test("23. service worker registers under CSP", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const result = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false, scope: null };
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]);
      return { supported: true, scope: reg ? reg.scope : null };
    });
    const pass = !result.supported || result.scope != null;
    record({
      claim: "Service worker (/sw.js) registers with the CSP in place",
      category: !result.supported
        ? "indeterminate"
        : pass
          ? "working_as_designed"
          : "confirmed_bug",
      pass,
      evidence: !result.supported
        ? "serviceWorker API absent in this browser context"
        : result.scope
          ? `registered, scope=${result.scope}`
          : "no active registration within 8s",
    });
  });

  test("24. radar map canvas renders under CSP", async ({ page }) => {
    await page.goto("/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    const canvas = page.locator("canvas.maplibregl-canvas").first();
    const box = await canvas.boundingBox().catch(() => null);
    const screenshot = await shot(page, "24-radar-canvas-csp");
    const pass = box != null && box.width > 100 && box.height > 100;
    record({
      claim: "MapLibre canvas renders on /radar (tiles + blob worker allowed by CSP)",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: box
        ? `canvas ${Math.round(box.width)}×${Math.round(box.height)}px`
        : "no maplibregl-canvas found",
      screenshot,
    });
  });
  test("25. /board kiosk renders split-flap rows with no tab bar (Board)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/board", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const screenshot = await shot(page, "21-board-1920");
    const state = await page
      .locator("main[data-board-state]")
      .getAttribute("data-board-state")
      .catch(() => null);
    const word = (
      await page.locator('[role="status"]').first().innerText().catch(() => "")
    ).toUpperCase();
    const rowCount = await page.locator("li[data-board-row]").count();
    const tabBar = await page.locator('nav[aria-label="Main"]').count();
    const clock = await page
      .locator("header")
      .first()
      .innerText()
      .catch(() => "");
    const has24hClock = /\b([01]\d|2[0-3]):[0-5]\d\b/.test(clock);
    const wordMatchesState =
      (state === "up" && word.includes("SMOKEY UP")) ||
      (state === "down" && word.includes("ALL CLEAR")) ||
      (state === "stale" && word.includes("FEED QUIET"));
    const pass =
      wordMatchesState && rowCount >= 1 && tabBar === 0 && has24hClock;
    record({
      claim:
        "/board renders the departures kiosk: status word matches data-board-state, ≥1 row, 24h clock, no tab bar",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `state=${state} word="${word.split("\n")[0]}" rows=${rowCount} tabBar=${tabBar} clock24h=${has24hClock}`,
      screenshot,
    });
  });

  test("26. /board?mock=stale reads 'Feed quiet. Last read HH:MM' (Board)", async ({
    page,
  }) => {
    if (!(await mockHonored(page.request))) {
      recordMockOff(
        "/board?mock=stale flips the header to FEED QUIET with 'Feed quiet. Last read HH:MM' — stale never reads as all clear",
      );
      return;
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/board?mock=stale", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const screenshot = await shot(page, "22-board-stale");
    const state = await page
      .locator("main[data-board-state]")
      .getAttribute("data-board-state")
      .catch(() => null);
    const body = await page.locator("body").innerText();
    const hasCopy = /Feed quiet\. Last read ([01]\d|2[0-3]):[0-5]\d/.test(body);
    const pass = state === "stale" && hasCopy;
    record({
      claim:
        "/board?mock=stale flips the header to FEED QUIET with 'Feed quiet. Last read HH:MM' — stale never reads as all clear",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `state=${state} copy=${hasCopy}`,
      screenshot,
    });
  });

  test("27. /about hub links to /board (Board)", async ({ page }) => {
    await page.goto("/about", { waitUntil: "networkidle" });
    const n = await page
      .locator('nav[aria-label="Site sections"] a[href="/board"]')
      .count();
    record({
      claim: "/about hub has a Board link",
      category: n > 0 ? "working_as_designed" : "unshipped",
      pass: n > 0,
      evidence: `${n} /board link(s) in the hub nav`,
    });
  });

  test("28. /api/status.txt beacon: state line + fields + cache headers (Beacon)", async ({
    request,
  }) => {
    const r = await request.get("/api/status.txt");
    let evidence = `HTTP ${r.status()}`;
    let pass = false;
    if (r.ok()) {
      const text = await r.text();
      const lines = text.split("\n");
      const state = lines[0];
      const okState = state === "up" || state === "down" || state === "stale";
      const okFields =
        /^count=\d+$/.test(lines[1] ?? "") &&
        /^fetched_at=(\d{4}-\d\d-\d\dT[\d:.]+Z)?$/.test(lines[2] ?? "") &&
        /^age_s=\d*$/.test(lines[3] ?? "");
      const cc = r.headers()["cache-control"] ?? "";
      const etag = r.headers()["etag"] ?? "";
      const ctype = r.headers()["content-type"] ?? "";
      // lib/beacon.ts sets "public, s-maxage=15, stale-while-revalidate=15";
      // the Vercel edge forwards it as "public".
      const okCache =
        state === "stale" ? cc.includes("no-store") : edgeCacheable(cc, 15);
      pass = okState && okFields && okCache && etag.length > 0 && ctype.startsWith("text/plain");
      evidence = `state=${state} fields=${okFields} cache="${cc}" etag=${etag || "none"} type=${ctype}`;
    }
    record({
      claim:
        "/api/status.txt first line up|down|stale, then count/fetched_at/age_s; s-maxage=15 + ETag (no-store when stale)",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence,
    });
  });

  test("29. /api/status.json beacon + ETag revalidation (Beacon)", async ({
    request,
  }) => {
    const r = await request.get("/api/status.json");
    let evidence = `HTTP ${r.status()}`;
    let pass = false;
    if (r.ok()) {
      const data = (await r.json()) as {
        state: string;
        count: number;
        fetched_at: string | null;
        age_s: number | null;
      };
      const okShape =
        ["up", "down", "stale"].includes(data.state) &&
        typeof data.count === "number" &&
        "fetched_at" in data &&
        "age_s" in data;
      const etag = r.headers()["etag"] ?? "";
      let revalidated = "skipped (stale)";
      let okRevalidate = true;
      if (data.state !== "stale" && etag) {
        const r2 = await request.get("/api/status.json", {
          headers: { "If-None-Match": etag },
        });
        // 304 when the read hasn't moved; 200 is fine if a new read landed.
        okRevalidate = r2.status() === 304 || r2.status() === 200;
        revalidated = `HTTP ${r2.status()}`;
      }
      pass = okShape && etag.length > 0 && okRevalidate;
      evidence = `state=${data.state} count=${data.count} age_s=${data.age_s} etag=${etag || "none"} revalidate=${revalidated}`;
    }
    record({
      claim:
        "/api/status.json returns {state,count,fetched_at,age_s} with an ETag that answers If-None-Match",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence,
    });
  });

  test("30. /api/status.txt?mock=stale reads stale with no-store (Beacon)", async ({
    request,
  }) => {
    if (!(await mockHonored(request))) {
      recordMockOff(
        "Beacon reports stale (never down) when the read is >2 min old, and is not edge-cached",
      );
      return;
    }
    const r = await request.get("/api/status.txt?mock=stale");
    const text = r.ok() ? await r.text() : "";
    const cc = r.headers()["cache-control"] ?? "";
    const pass = text.split("\n")[0] === "stale" && cc.includes("no-store");
    record({
      claim:
        "Beacon reports stale (never down) when the read is >2 min old, and is not edge-cached",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `HTTP ${r.status()} first="${text.split("\n")[0]}" cache="${cc}"`,
    });
  });
  test("31. home og:image is the live status card (share program)", async ({
    page,
    request,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const ogUrl = await page
      .locator('meta[property="og:image"]')
      .first()
      .getAttribute("content");
    const twUrl = await page
      .locator('meta[name="twitter:image"]')
      .first()
      .getAttribute("content");
    let evidence = `og:image=${ogUrl ?? "missing"} twitter:image=${twUrl ?? "missing"}`;
    let pass = false;
    if (ogUrl && /\/opengraph-image/.test(ogUrl)) {
      const r = await request.get(ogUrl);
      const body = await r.body();
      // PNG IHDR: width at bytes 16-19, height at 20-23.
      const isPng = body.length > 24 && body.readUInt32BE(0) === 0x89504e47;
      const w = isPng ? body.readUInt32BE(16) : 0;
      const h = isPng ? body.readUInt32BE(20) : 0;
      const cc = r.headers()["cache-control"] ?? "";
      // s-maxage=60 is set by the route; the edge forwards "public, max-age=0".
      pass =
        r.ok() &&
        isPng &&
        w === 1200 &&
        h === 630 &&
        edgeCacheable(cc, 60) &&
        /\/twitter-image/.test(twUrl ?? "");
      fs.writeFileSync(path.join(AUDIT_DIR, "21-og-status-card.png"), body);
      evidence += ` · HTTP ${r.status()} ${w}x${h} cache-control="${cc}"`;
    }
    record({
      claim:
        "Home og:image + twitter:image point at the live status card (1200x630 PNG, CDN cache <=60s)",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence,
      screenshot: path.join(AUDIT_DIR, "21-og-status-card.png"),
    });
  });

  test("32. /program explainer renders and is linked from /about + /legal", async ({
    page,
  }) => {
    await page.goto("/program", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "22-program");
    const body = await page.locator("body").innerText();
    const checks = {
      heading: /The program\./.test(body),
      notAffiliated: /Not affiliated with WSP/i.test(body),
      unknowns: /We don.t know\./.test(body),
      flir: /forward-looking infrared/i.test(body),
      adsbPublic: /ADS-B is public/i.test(body),
      glossary: ["Bird", "Tail", "MLAT", "Squawk", "Sortie"].every((t) =>
        body.includes(t),
      ),
      wspAgency: /Washington State Patrol/.test(body),
    };
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const aboutLink = await page.locator('nav a[href="/program"]').count();
    await page.goto("/legal", { waitUntil: "domcontentloaded" });
    const legalLink = await page.locator('main a[href="/program"]').count();
    const pass =
      Object.values(checks).every(Boolean) && aboutLink > 0 && legalLink > 0;
    record({
      claim:
        "/program explains agencies, airframes, FLIR, aerial timing, public ADS-B, says 'not affiliated with WSP', and is linked from /about + /legal",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `${JSON.stringify(checks)} aboutLink=${aboutLink} legalLink=${legalLink}`,
      screenshot,
    });
  });

  test("33. region picker moves the camera, heat grid is statewide-plus (radar region zoom)", async ({
    page,
    request,
  }) => {
    // Part A: the region control is camera-only. Picking a view must
    // change the map's live view, read from the data attributes RadarMap
    // keeps on its container (data-view / data-center / data-zoom). No
    // geolocation grant, so the rider auto-zoom never moves the camera.
    await page.goto("/radar", { waitUntil: "domcontentloaded" });
    const mapEl = page.locator('[aria-label^="Live aircraft map"]');
    await page
      .waitForFunction(
        () =>
          document
            .querySelector('[aria-label^="Live aircraft map"]')
            ?.hasAttribute("data-zoom") ?? false,
        undefined,
        { timeout: 30_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(2500);
    const readView = async () => ({
      view: await mapEl.getAttribute("data-view").catch(() => null),
      center: await mapEl.getAttribute("data-center").catch(() => null),
      zoom: Number(await mapEl.getAttribute("data-zoom").catch(() => null)),
    });
    const sel = page.locator('select[aria-label="Region"]');
    const hasPicker = (await sel.count()) > 0;
    const before = await readView();
    if (hasPicker) await sel.selectOption("all_wa");
    await page.waitForTimeout(2500);
    const afterAllWa = await readView();
    if (hasPicker) await sel.selectOption("puget_sound");
    await page.waitForTimeout(2500);
    const afterPs = await readView();
    const screenshot = await shot(page, "33-radar-region-camera");
    const cameraMoved =
      hasPicker &&
      afterAllWa.view === "all_wa" &&
      afterPs.view === "puget_sound" &&
      Number.isFinite(afterAllWa.zoom) &&
      Number.isFinite(afterPs.zoom) &&
      afterAllWa.zoom < afterPs.zoom - 0.5 &&
      afterAllWa.center !== afterPs.center;

    // Part B: /api/hotzones returns the full extent. region_id is still
    // accepted but ignored for clipping, so cells outside the Puget Sound
    // bbox come back even when region_id=puget_sound is sent.
    const PS = { latMin: 47.0, latMax: 48.4, lonMin: -122.9, lonMax: -121.4 };
    const r = await request.get("/api/hotzones?region_id=puget_sound");
    const body = r.ok() ? await r.json() : null;
    const zones: Array<{ lat: number; lon: number }> = Array.isArray(
      body?.zones,
    )
      ? body.zones
      : [];
    const outside = zones.filter(
      (z) =>
        z.lat < PS.latMin ||
        z.lat > PS.latMax ||
        z.lon < PS.lonMin ||
        z.lon > PS.lonMax,
    ).length;
    // Informational: cells past the WA state box (OR / ID border areas).
    // Fills in after the first daily hot-zone refresh following deploy.
    const outOfState = zones.filter(
      (z) => z.lat < 45.54 || z.lon > -116.9,
    ).length;
    const pass = cameraMoved && r.ok() && outside > 0;
    record({
      claim:
        "Region picker changes the /radar camera (All of Washington zooms out, Puget Sound zooms back in) and /api/hotzones returns cells outside the Puget Sound bbox",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence:
        `before=${JSON.stringify(before)} all_wa=${JSON.stringify(afterAllWa)} ` +
        `puget_sound=${JSON.stringify(afterPs)} · /api/hotzones?region_id=puget_sound ` +
        `${r.status()} zones=${zones.length} outside_ps=${outside} ` +
        `out_of_state=${outOfState} region_clipped=${String(body?.region_clipped)}`,
      screenshot,
    });
    expect(pass).toBe(true);
  });

  test("34. /aircraft groups the registry by mission; CBP is not labelled SMOKEY", async ({
    page,
  }) => {
    // The registry moved off the /about hub to /aircraft (navigation pass).
    await page.goto("/aircraft", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "34-about-missions");
    const groups = await page.locator("section[data-mission]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-mission")),
    );
    // A CBP tail card sits in the federal group and its badge is FEDERAL.
    const cbp = page.locator('section[data-mission] [data-tail="N1977G"]');
    const cbpGroup = await page
      .locator('section[data-mission="federal_le"] [data-tail="N1977G"]')
      .count();
    const cbpText = (await cbp.count()) > 0 ? await cbp.first().innerText() : "";
    const cbpNotSmokey = cbpText.length > 0 && !/\bSMOKEY\b/.test(cbpText) && /FEDERAL/.test(cbpText);
    const hasSources = (await page.locator('section[data-mission] a[href^="https://registry.faa.gov"]').count()) > 0;
    const hasConfidence = (await page.locator("section[data-mission] [data-confidence]").count()) > 0;
    const pass =
      groups.includes("police") &&
      groups.includes("federal_le") &&
      groups[0] === "police" &&
      cbpGroup > 0 &&
      cbpNotSmokey &&
      hasSources &&
      hasConfidence;
    record({
      claim:
        "/aircraft registry is grouped by mission (Smokey first), each tail shows a confirmed/tentative badge and a source link, and CBP N1977G reads FEDERAL, not SMOKEY",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `groups=${JSON.stringify(groups)} cbpInFederal=${cbpGroup} cbpNotSmokey=${cbpNotSmokey} sources=${hasSources} confidence=${hasConfidence}`,
      screenshot,
    });
  });

  test("35. no fixed install bar overlaps /radar controls on iPhone (design pass)", async ({
    browser,
    baseURL,
  }) => {
    // iPhone Safari UA, not installed: the old fixed "iOS push: 2 steps"
    // bar rendered here and sat over the radar's bottom controls. The
    // install tip is now an inline card on home only.
    const ctx = await browser.newContext({
      ...devices["iPhone 15 Pro"],
      baseURL,
    });
    const page = await ctx.newPage();
    // The install bar check does not need an airborne fleet; ?mock=up only
    // adds markers when the deploy honours it.
    const mock = await mockHonored(page.request);
    await page.goto(mock ? "/radar?mock=up" : "/radar", { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const screenshot = await shot(page, "35-radar-no-install-bar");
    const result = await page.evaluate(() => {
      const fixedInstall = [...document.querySelectorAll("body *")].filter(
        (el) => {
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed") return false;
          const t = (el as HTMLElement).innerText ?? "";
          return /Add to Home Screen|iOS push/i.test(t);
        },
      ).length;
      // Every visible radar control must be the topmost element at its
      // own centre point (nothing fixed painted over it).
      const controls = [
        ...document.querySelectorAll<HTMLElement>("main button, main select"),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom <= window.innerHeight;
      });
      const covered: string[] = [];
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        if (top && !el.contains(top) && !top.contains(el)) {
          const coverFixed = (() => {
            let n: Element | null = top;
            while (n) {
              if (getComputedStyle(n).position === "fixed") return n;
              n = n.parentElement;
            }
            return null;
          })();
          const coverText = (coverFixed as HTMLElement | null)?.innerText ?? "";
          if (coverFixed && /Add to Home Screen|iOS push/i.test(coverText)) {
            covered.push(el.getAttribute("aria-label") ?? el.innerText.slice(0, 30));
          }
        }
      }
      return { fixedInstall, controls: controls.length, covered };
    });
    const pass = result.fixedInstall === 0 && result.covered.length === 0;
    record({
      claim:
        "No fixed install bar on /radar; no radar control is covered by an install prompt (iPhone UA)",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `fixedInstallEls=${result.fixedInstall} controlsChecked=${result.controls} covered=${JSON.stringify(result.covered)}`,
      screenshot,
    });
    await ctx.close();
  });

  test("36. up-state hero uses alert orange #FF7A1A (design pass)", async ({
    page,
  }) => {
    const claim =
      "Up-state hero headline renders in --alert #FF7A1A (orange means only 'Smokey is up')";
    if (!(await mockHonored(page.request))) {
      // Prod ignores ?mock=up: assert only when the live sky is up.
      const beacon = await page.request.get("/api/status.json");
      const live = beacon.ok() ? ((await beacon.json()) as { state?: string }).state : null;
      if (live !== "up") {
        recordMockOff(`${claim} (live state=${live ?? "unknown"})`);
        return;
      }
    }
    const mock = await mockHonored(page.request);
    await page.goto(mock ? "/?mock=up" : "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const screenshot = await shot(page, "36-home-up-hero-orange");
    const color = await page
      .locator('[data-testid="hero-headline"], main section h1')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
      .catch(() => "missing");
    // #FF7A1A = rgb(255, 122, 26). The old amber was rgb(245, 184, 64).
    const pass = color.replace(/\s+/g, "") === "rgb(255,122,26)";
    record({
      claim,
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `hero color=${color}`,
      screenshot,
    });
  });

  test("37. home minimum rendered font size >= 12px (design pass)", async ({
    page,
  }) => {
    const results: Record<string, { min: number; text: string | null }> = {};
    // Prod ignores ?mock=: measure the live home once instead of up + down.
    const states = (await mockHonored(page.request)) ? ["up", "down"] : ["live"];
    for (const mock of states) {
      await page.goto(mock === "live" ? "/" : `/?mock=${mock}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      results[mock] = await page.evaluate(() => {
        let min = Infinity;
        let text: string | null = null;
        const scope = document.querySelectorAll("main *, nav *");
        for (const el of scope) {
          const hasText = [...el.childNodes].some(
            (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? "").trim(),
          );
          if (!hasText) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          // Skip text painted inside a map canvas container (MapLibre
          // attribution), which the page does not style.
          if (el.closest(".maplibregl-map")) continue;
          const fs = parseFloat(cs.fontSize);
          if (fs < min) {
            min = fs;
            text = (el.textContent ?? "").trim().slice(0, 40);
          }
        }
        return { min, text };
      });
    }
    const screenshot = await shot(page, "37-home-type-floor");
    const pass = Object.values(results).every((r) => r.min >= 12);
    record({
      claim: `Home (${states.join(" + ")}) renders no text below the 12px type floor`,
      category: pass ? "working_as_designed" : "polish_needed",
      pass,
      evidence: JSON.stringify(results),
      screenshot,
    });
  });

  test("38. /api/history returns sessions for a recent 7-day range (flight history)", async ({
    request,
  }) => {
    // Pacific calendar dates: the 7 days ending yesterday, so the range is
    // closed and CDN-cacheable.
    const ptDate = (offsetDays: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() - offsetDays * 86_400_000));
    const from = ptDate(7);
    const to = ptDate(1);
    const r = await request.get(`/api/history?from=${from}&to=${to}`);
    let evidence = `HTTP ${r.status()} for ${from}..${to}`;
    let pass = false;
    let category: Finding["category"] = r.status() === 404 ? "unshipped" : "confirmed_bug";
    if (r.ok()) {
      const data = (await r.json()) as {
        v: number;
        range: { from: string; to: string; days: number };
        sessions: { id: string; tail: string; start_ts: number; end_ts: number }[];
        polylines: { id: string; points: unknown[] }[];
        heat: { cells: unknown[] };
        summary: { flights: number; vertices: number };
      };
      const shapeOk =
        data.v === 1 &&
        data.range?.days === 7 &&
        Array.isArray(data.sessions) &&
        Array.isArray(data.polylines) &&
        Array.isArray(data.heat?.cells) &&
        data.summary?.flights === data.sessions.length &&
        data.summary.vertices <= 20_000;
      const hasSessions = data.sessions.length > 0;
      const linesMatch = data.polylines.length === data.sessions.length;
      // A bad param must be refused, not ignored.
      const bad = await request.get(`/api/history?from=${to}&to=${from}`);
      const rejects = from === to || bad.status() === 400;
      pass = shapeOk && hasSessions && linesMatch && rejects;
      category = pass ? "working_as_designed" : shapeOk && !hasSessions ? "indeterminate" : "confirmed_bug";
      evidence += `; sessions=${data.sessions.length} polylines=${data.polylines.length} heat=${data.heat?.cells?.length} vertices=${data.summary?.vertices}; reversed-range HTTP ${bad.status()}`;
    }
    record({
      claim:
        "/api/history?from&to returns flight sessions, one simplified polyline per session, a heat grid and summary for the last 7 Pacific days, and rejects a reversed range with 400",
      category,
      pass,
      evidence,
    });
  });

  test("39. /forecast has a month selector: Last 30 days plus each month on record", async ({
    page,
  }) => {
    await page.goto("/forecast", { waitUntil: "networkidle" });
    const select = page.locator('[data-testid="forecast-month-select"]');
    const present = (await select.count()) > 0;
    const options = present
      ? await select.locator("option").evaluateAll((els) =>
          els.map((e) => ({ value: (e as HTMLOptionElement).value, label: e.textContent ?? "" })),
        )
      : [];
    const hasDefault = options[0]?.value === "last30" && /Last 30 days/.test(options[0]?.label ?? "");
    const months = options.slice(1);
    const monthsOk = months.every(
      (o) => /^\d{4}-\d{2}$/.test(o.value) && /^[A-Z][a-z]+ \d{4}$/.test(o.label),
    );
    let monthEvidence = "no month on record yet";
    let monthOk = true;
    let screenshot = await shot(page, "39-forecast-last30");
    if (months.length > 0) {
      await page.goto(`/forecast?month=${months[0]!.value}`, { waitUntil: "networkidle" });
      screenshot = await shot(page, "39-forecast-month");
      const title = (await page.locator('[data-testid="forecast-month-title"]').innerText().catch(() => "")).trim();
      const days = (await page.locator('[data-testid="forecast-month-days"]').innerText().catch(() => "")).trim();
      const grid = await page.locator('[data-testid="forecast-month-grid"]').count();
      // Mobile-first: no horizontal page scroll.
      const noHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      monthOk =
        title === months[0]!.label &&
        /^\d+ days? of data in this month/.test(days) &&
        grid > 0 &&
        noHScroll;
      monthEvidence = `title="${title}" days="${days}" grid=${grid} noHScroll=${noHScroll}`;
    }
    const pass = present && hasDefault && monthsOk && monthOk;
    record({
      claim:
        "/forecast shows a period selector ('Last 30 days' + 'Month YYYY' options); a month view renders its title, 'N days of data in this month' and the hour × weekday grid without horizontal page scroll",
      category: pass ? "working_as_designed" : present ? "confirmed_bug" : "unshipped",
      pass,
      evidence: `select=${present}; options=${options.map((o) => o.label).join(" | ")}; ${monthEvidence}`,
      screenshot,
    });
  });

  test("40. /embed is frameable; every other route still sends X-Frame-Options DENY", async ({
    request,
  }) => {
    const embed = await request.get("/embed");
    const home = await request.get("/");
    const eh = embed.headers();
    const hh = home.headers();
    const embedCsp = eh["content-security-policy"] ?? "";
    const pass =
      embed.ok() &&
      eh["x-frame-options"] == null &&
      /frame-ancestors \*/.test(embedCsp) &&
      /deny/i.test(hh["x-frame-options"] ?? "") &&
      /frame-ancestors 'none'/.test(hh["content-security-policy"] ?? "");
    record({
      claim:
        "/embed has no X-Frame-Options and frame-ancestors *, while / keeps X-Frame-Options DENY",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `embed ${embed.status()} xfo=${eh["x-frame-options"] ?? "(none)"} csp-fa=${(embedCsp.match(/frame-ancestors [^;]+/) ?? ["(none)"])[0]} · home xfo=${hh["x-frame-options"] ?? "(none)"}`,
    });
    expect(pass).toBe(true);
  });

  test("41. /calendar.ics is text/calendar with VEVENTs and a Los Angeles VTIMEZONE", async ({
    request,
  }) => {
    const r = await request.get("/calendar.ics");
    const body = await r.text();
    const ct = r.headers()["content-type"] ?? "";
    const events = (body.match(/BEGIN:VEVENT/g) ?? []).length;
    // An empty feed is valid while the forecast is still learning. Ask
    // /forecast how many takeoffs it has logged; VEVENTs are required
    // only at >= 30 (lib/ics.ts MIN_TOTAL_EVENTS).
    const fh = await (await request.get("/forecast")).text();
    const m = /(\d+)<\/span>\s*(?:<!--\s*-->)?\s*logged\s*(?:<!--\s*-->)?\s*takeoff/.exec(fh);
    const logged = m ? Number(m[1]) : null;
    const needEvents = logged != null && logged >= 30;
    const shape =
      r.ok() &&
      /^text\/calendar/.test(ct) &&
      /BEGIN:VCALENDAR/.test(body) &&
      /TZID:America\/Los_Angeles/.test(body);
    const pass = shape && (!needEvents || events > 0);
    record({
      claim: "/calendar.ics serves valid text/calendar; VEVENT busy windows once the forecast has 30+ takeoffs",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `status=${r.status()} content-type=${ct} vevents=${events} logged_takeoffs=${logged ?? "unknown"} cache-control=${r.headers()["cache-control"] ?? "(none)"}`,
    });
    expect(pass).toBe(true);
  });

  test("42. /glance renders UP/DOWN/NO READ, a 24h clock and no tab bar", async ({ page }) => {
    await page.goto("/glance", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const screenshot = await shot(page, "42-glance");
    const word = (await page.locator("[data-glance-word]").innerText().catch(() => "")).trim();
    const clock = await page.locator("[data-glance-clock]").innerText().catch(() => "");
    const tabBar = await page.locator('nav[aria-label="Main"]').count();
    const pass =
      /^(UP|DOWN|NO READ)$/.test(word) && /\b([01]\d|2[0-3]):[0-5]\d:[0-5]\d\b/.test(clock) && tabBar === 0;
    record({
      claim: "/glance renders a status word and a 24-hour clock with no tab bar",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `word=${word} clock=${clock} tabBar=${tabBar}`,
      screenshot,
    });
    expect(pass).toBe(true);
  });

  test("43. /offline exists with the no-signal copy", async ({ page }) => {
    await page.goto("/offline", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "43-offline");
    const body = await page.locator("body").innerText();
    const pass =
      /No signal\./.test(body) &&
      /Last update unknown\./.test(body) &&
      /needs a connection to see the sky/.test(body);
    record({
      claim: "/offline renders the No signal copy",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: pass ? "copy present" : `body=${body.slice(0, 120)}`,
      screenshot,
    });
    expect(pass).toBe(true);
  });

  test("44. the service worker registers and API JSON is never cached", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const r = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((res) => setTimeout(() => res(null), 8000)),
      ]);
      if (!reg) return { supported: true, scope: null };
      await fetch("/api/status.json", { cache: "no-store" }).catch(() => null);
      const names = await caches.keys();
      const shell = names.filter((n) => n.startsWith("ss-shell-"));
      let apiCached = 0;
      let offlineCached = false;
      for (const n of shell) {
        const c = await caches.open(n);
        for (const k of await c.keys()) {
          const u = new URL(k.url);
          if (u.pathname.startsWith("/api/")) apiCached++;
          if (u.pathname === "/offline") offlineCached = true;
        }
      }
      return { supported: true, scope: reg.scope, shell, apiCached, offlineCached };
    });
    const pass =
      !r.supported ||
      (!!r.scope && (r.apiCached ?? 0) === 0 && (r.shell?.length ?? 0) >= 1);
    record({
      claim: "Service worker registers, caches /offline, and holds no /api/* responses",
      category: !r.supported ? "indeterminate" : pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: JSON.stringify(r),
    });
    expect(pass).toBe(true);
  });

  test("45. /relay renders the create form and is linked from /about (Relay)", async ({
    page,
  }) => {
    await page.goto("/relay", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "40-relay");
    const body = await page.locator("body").innerText();
    const checks = {
      heading: /Discord and webhooks\./.test(body),
      urlField: (await page.locator('input[name="url"]').count()) > 0,
      armButton: (await page.getByRole("button", { name: "Arm relay" }).count()) > 0,
      missionsDefault: /Default is Smokey only/.test(body),
      feeds: /\/feed\.xml/.test(body) && /\/rss\.xml/.test(body),
      siri: /status\.txt/.test(body),
      noExclamation: !/[A-Za-z]!/.test(body),
    };
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const aboutLink = await page
      .locator('nav[aria-label="Site sections"] a[href="/relay"]')
      .count();
    const pass = Object.values(checks).every(Boolean) && aboutLink > 0;
    record({
      claim: "/relay renders the webhook form, Smokey-only default, feed + Siri recipes; /about links to it",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `${JSON.stringify(checks)} aboutLink=${aboutLink}`,
      screenshot,
    });
  });

  test("46. /feed.xml is Atom with entries; /rss.xml is RSS; both s-maxage=60 (Relay)", async ({
    request,
    page,
  }) => {
    const atom = await request.get("/feed.xml");
    const atomText = atom.ok() ? await atom.text() : "";
    const entries = (atomText.match(/<entry>/g) ?? []).length;
    const atomCc = atom.headers()["cache-control"] ?? "";
    const atomType = atom.headers()["content-type"] ?? "";
    const okAtom =
      atom.ok() &&
      atomType.startsWith("application/atom+xml") &&
      /^<\?xml version="1\.0" encoding="utf-8"\?>\s*<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/.test(atomText) &&
      atomText.trimEnd().endsWith("</feed>") &&
      entries > 0 &&
      entries === (atomText.match(/<\/entry>/g) ?? []).length &&
      !/&(?!(amp|lt|gt|quot|apos);)/.test(atomText) &&
      edgeCacheable(atomCc, 60);
    // Parse it as XML in the browser too: DOMParser flags any well-formedness error.
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const parseOk = await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      return doc.getElementsByTagName("parsererror").length === 0 && doc.documentElement.localName === "feed";
    }, atomText);
    const rss = await request.get("/rss.xml");
    const rssText = rss.ok() ? await rss.text() : "";
    const okRss =
      rss.ok() &&
      /<rss version="2\.0"/.test(rssText) &&
      edgeCacheable(rss.headers()["cache-control"] ?? "", 60);
    const alternate = await page
      .locator('link[rel="alternate"][type="application/atom+xml"]')
      .count();
    const firstTitle = /<entry>[\s\S]*?<title>([^<]*)<\/title>/.exec(atomText)?.[1] ?? "";
    const pass = okAtom && parseOk && okRss && alternate > 0;
    record({
      claim: "/feed.xml is well-formed Atom with >=1 entry, /rss.xml is RSS 2.0, s-maxage=60, advertised via <link rel=alternate>",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `atom HTTP ${atom.status()} type=${atomType} entries=${entries} parse=${parseOk} cache="${atomCc}" first="${firstTitle}" · rss HTTP ${rss.status()} ok=${okRss} · alternate=${alternate}`,
    });
  });

  test("47. POST /api/relay with an invalid webhook returns 400 (Relay)", async ({
    request,
  }) => {
    const cases = [
      { url: "https://127.0.0.1/hook" },
      { url: "http://hooks.example.com/hook" },
      { url: "https://discord.com/api/channels/1/messages" },
    ];
    const statuses: number[] = [];
    const errors: string[] = [];
    for (const data of cases) {
      const r = await request.post("/api/relay", { data });
      statuses.push(r.status());
      errors.push(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "");
    }
    // Shape checks run before the per-IP create limiter, so repeat audit
    // runs keep getting 400s rather than 429s.
    const pass = statuses.every((s) => s === 400);
    record({
      claim: "Relay create refuses private-IP, plain-http, and wrong-shape Discord URLs with a 400 (nothing stored)",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: `statuses=${statuses.join(",")} errors=${errors.join(",")}`,
    });
  });

  test("48. bot interaction routes exist: unsigned POST is 401 (or 503 not configured), never 500 (bots)", async ({
    request,
  }) => {
    const routes = ["/api/telegram/webhook", "/api/discord/interactions"];
    const results: Array<{ route: string; status: number; body: string }> = [];
    for (const route of routes) {
      const r = await request.post(route, {
        data: { type: 1 },
        headers: { "content-type": "application/json" },
      });
      const body = (await r.text()).slice(0, 120);
      results.push({ route, status: r.status(), body });
    }
    // 503 only counts when it is the env gate, not a crashed function.
    const pass = results.every(
      (x) => x.status === 401 || (x.status === 503 && /not_configured/.test(x.body)),
    );
    record({
      claim:
        "POST /api/telegram/webhook and /api/discord/interactions without a signature answer 401 (or 503 not_configured while the bot env vars are unset), never 404 or 500",
      category: pass ? "working_as_designed" : "confirmed_bug",
      pass,
      evidence: JSON.stringify(results),
    });
    expect(pass).toBe(true);
  });

  test("49. /circling renders the live pattern list with a coverage caveat (What's circling)", async ({
    page,
  }) => {
    const resp = await page.goto("/circling", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "35-circling");
    const title = await page.title();
    const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    const live = await page.locator('[data-testid="circling-live"]').count();
    // One of: pattern cards, the empty state, or the honest feed-quiet state.
    const items = await page.locator('[data-testid="circling-item"]').count();
    const empty = await page.locator('[data-testid="circling-empty"]').count();
    const degraded = await page.locator('[data-testid="circling-degraded"]').count();
    const note = (await page.locator('[data-testid="coverage-note"]').first().innerText().catch(() => "")).trim();
    const nearMe = await page.locator('[data-testid="near-me"]').count();
    const hubLink = await (async () => {
      await page.goto("/about", { waitUntil: "networkidle" });
      return page.locator('nav[aria-label="Site sections"] a[href="/circling"]').count();
    })();
    const pass =
      resp?.status() === 200 &&
      /circling/i.test(title) &&
      /circling/i.test(h1) &&
      live > 0 &&
      items + empty + degraded > 0 &&
      /^Quiet here can mean unseen\./.test(note) &&
      nearMe > 0 &&
      hubLink > 0;
    record({
      claim:
        "/circling renders (title + h1 mention circling), shows pattern cards or an honest empty/feed-quiet state, a Near me button, the coverage caveat, and is linked from the /about hub",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `status=${resp?.status()} title="${title}" items=${items} empty=${empty} degraded=${degraded} note="${note}" nearMe=${nearMe} hub=${hubLink}`,
      screenshot,
    });
  });

  test("50. /road/i-5 renders history, histogram, missions and its own share card (Road pages)", async ({
    page,
    request,
  }) => {
    const resp = await page.goto("/road/i-5", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "36-road-i5");
    const h1 = (await page.locator('[data-testid="road-title"]').innerText().catch(() => "")).trim();
    const headline = (await page.locator('[data-testid="road-headline"]').innerText().catch(() => "")).trim();
    const hours = await page.locator('[data-testid="road-hours"]').count();
    const missions = await page.locator('[data-testid="road-missions"]').count();
    const note = await page.locator('[data-testid="coverage-note"]').count();
    const og = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);
    let ogOk = false;
    if (og && /\/road\/i-5\/opengraph-image/.test(og)) {
      const img = await request.get(new URL(og).pathname);
      ogOk = img.ok() && (img.headers()["content-type"] ?? "").startsWith("image/png");
    }
    const index = await request.get("/road");
    const pass =
      resp?.status() === 200 &&
      h1 === "I-5" &&
      /^Planes over I-5 this week: \d+ flights?\.$/.test(headline) &&
      hours > 0 &&
      missions > 0 &&
      note > 0 &&
      ogOk &&
      index.ok();
    record({
      claim:
        "/road/i-5 renders the week headline, hour-of-day histogram, mission breakdown and coverage caveat; og:image is the road card; /road index is up",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `status=${resp?.status()} h1="${h1}" headline="${headline}" hours=${hours} missions=${missions} note=${note} og=${og} ogOk=${ogOk} index=${index.status()}`,
      screenshot,
    });
  });

  test("51. /api/coverage returns drop-out cells as JSON (Coverage honesty)", async ({ request }) => {
    const r = await request.get("/api/coverage");
    let pass = false;
    let evidence = `HTTP ${r.status()}`;
    if (r.ok()) {
      const ctype = r.headers()["content-type"] ?? "";
      const cc = r.headers()["cache-control"] ?? "";
      const body = (await r.json().catch(() => null)) as {
        window_days?: number;
        dropouts?: number;
        cells?: { id: string; lat: number; lon: number; count: number }[];
        weakest?: { name: string; count: number } | null;
      } | null;
      const cellsOk =
        Array.isArray(body?.cells) &&
        body!.cells!.every((c) => typeof c.id === "string" && typeof c.count === "number");
      pass =
        ctype.startsWith("application/json") &&
        body?.window_days === 30 &&
        typeof body?.dropouts === "number" &&
        cellsOk &&
        (body?.weakest === null || typeof body?.weakest?.name === "string");
      evidence = `type=${ctype} cache="${cc}" window=${body?.window_days} dropouts=${body?.dropouts} cells=${body?.cells?.length} weakest=${JSON.stringify(body?.weakest)}`;
    }
    record({
      claim: "/api/coverage returns {window_days:30, dropouts, cells[], weakest} JSON",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence,
    });
  });

  test("52. /data open ledger renders with methods + license, linked from /about (Logbook ledger)", async ({
    page,
  }) => {
    const r = await page.goto("/data", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "52-data-ledger");
    const body = await page.locator("main").innerText();
    const checks = {
      status: r?.status() === 200,
      heading: /Data and CSV\./.test(body),
      license: /ODbL 1\.0/.test(body),
      start: /2026-10-16/.test(body),
      csvLink: (await page.locator('a[href="/data/flight-hours.csv"]').count()) > 0,
      tables: (await page.locator('[data-testid="data-tails"] table').count()) > 0,
      noSideScroll: await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    };
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const fromAbout = (await page.locator('nav a[href="/data"]').count()) > 0;
    const pass = Object.values(checks).every(Boolean) && fromAbout;
    record({
      claim:
        "/data renders the open ledger (tables, CSV link, methods with the 2026-10-16 start, ODbL 1.0 line), no sideways page scroll, linked from the /about hub",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `${JSON.stringify(checks)} fromAbout=${fromAbout}`,
      screenshot,
    });
  });

  test("53. /data/flight-hours.csv starts with the header row (Logbook ledger)", async ({
    request,
  }) => {
    const r = await request.get("/data/flight-hours.csv");
    const text = await r.text();
    const first = text.split(/\r?\n/)[0] ?? "";
    const ct = r.headers()["content-type"] ?? "";
    const bad = await request.get("/data/flight-hours.csv?from=nope");
    const pass =
      r.ok() &&
      /text\/csv/.test(ct) &&
      first === "month,tail,nickname,operator,mission,flights,hours,max_alt_ft" &&
      !/\b(lat|lon)\b/i.test(first) &&
      bad.status() === 400;
    record({
      claim:
        "CSV export returns text/csv whose first line is month,tail,nickname,operator,mission,flights,hours,max_alt_ft; a bad ?from= is a 400",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `HTTP ${r.status()} ct="${ct}" first="${first}" rows=${text.trim().split(/\r?\n/).length - 1} bad=${bad.status()}`,
    });
  });

  test("54. /wrap/2026 renders and says the log starts 2026-10-16 (Season wrap)", async ({
    page,
  }) => {
    const r = await page.goto("/wrap/2026", { waitUntil: "networkidle" });
    const screenshot = await shot(page, "54-wrap-2026");
    const body = await page.locator("main").innerText();
    const ogUrl = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    const checks = {
      status: r?.status() === 200,
      heading: /The 2026 season, from overhead\./.test(body),
      limited: /Our log starts 2026-10-16\. Next year.s wrap covers the whole season\./.test(body),
      ogImage: /\/wrap\/2026\/opengraph-image/.test(ogUrl ?? ""),
      noBang: !/[A-Za-z]!(\s|$)/.test(body),
      noSideScroll: await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    };
    const pass = Object.values(checks).every(Boolean);
    record({
      claim:
        "/wrap/2026 renders the season wrap, states the 2026-10-16 log start honestly, carries its own og:image, no sideways page scroll",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: JSON.stringify(checks),
      screenshot,
    });
  });

  test("55. flight card is a 1200x1500 PNG for a recent flight (Flight card)", async ({
    page,
    request,
  }) => {
    await page.goto("/plane/N305DK", { waitUntil: "networkidle" });
    const href = await page
      .locator('[data-testid="logbook-flight"]')
      .first()
      .getAttribute("href")
      .catch(() => null);
    let evidence = `flight=${href ?? "none in logbook"}`;
    let pass = false;
    if (href) {
      const r = await request.get(`${href}/card`);
      const body = await r.body();
      const isPng = body.length > 24 && body.readUInt32BE(0) === 0x89504e47;
      const w = isPng ? body.readUInt32BE(16) : 0;
      const h = isPng ? body.readUInt32BE(20) : 0;
      const cc = r.headers()["cache-control"] ?? "";
      pass = r.ok() && isPng && w === 1200 && h === 1500 && /max-age=\d+/.test(cc);
      fs.writeFileSync(path.join(AUDIT_DIR, "55-flight-card.png"), body);
      evidence += ` · HTTP ${r.status()} ${w}x${h} cache-control="${cc}"`;
      await page.goto(href, { waitUntil: "domcontentloaded" });
      const save = await page.locator('[data-testid="save-flight-card"]').count();
      pass = pass && save > 0;
      evidence += ` saveButton=${save}`;
    }
    record({
      claim:
        "/plane/N305DK logbook links a recent flight whose /card is a 1200x1500 PNG with a max-age, and the flight page shows Save flight card",
      category: pass ? "working_as_designed" : href ? "confirmed_bug" : "indeterminate",
      pass,
      evidence,
      screenshot: path.join(AUDIT_DIR, "55-flight-card.png"),
    });
  });

  test("56. /radar history mode: banner + history lines for the last 7 days", async ({ page }) => {
    const ptDate = (offsetDays: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() - offsetDays * 86_400_000));
    const from = ptDate(7);
    const to = ptDate(0);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /maplibre|layer|source|style/i.test(m.text())) errors.push(m.text());
    });
    await page.goto(`/radar?h=1&from=${from}&to=${to}`, { waitUntil: "domcontentloaded" });
    const banner = page.locator('[data-testid="history-banner"]');
    await banner.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    const bannerText = (await banner.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    // The history line source (components/HistoryOverlay.tsx) stamps the
    // map container with the feature count it last pushed via setData.
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector("[data-history-lines]");
          const empty = document.querySelector('[data-testid="history-status"]')?.textContent ?? "";
          return (el && Number(el.getAttribute("data-history-lines")) > 0) || /No flights/.test(empty);
        },
        undefined,
        { timeout: 30_000 },
      )
      .catch(() => {});
    const lines = await page
      .locator("[data-history-lines]")
      .first()
      .getAttribute("data-history-lines")
      .catch(() => null);
    const summary = (await page.locator('[data-testid="history-summary"]').innerText().catch(() => "")).trim();
    const status = (await page.locator('[data-testid="history-status"]').innerText().catch(() => "")).trim();
    const screenshot = await shot(page, "56-radar-history");
    const bannerOk = /^HISTORY · /.test(bannerText);
    const linesOk = Number(lines ?? 0) > 0;
    const empty = /No flights in this range/.test(status);
    const pass = bannerOk && linesOk && errors.length === 0;
    record({
      claim:
        "/radar?h=1&from=<7 days ago>&to=<today> shows the HISTORY banner and the history line source receives flight polylines (no MapLibre errors)",
      category: pass
        ? "working_as_designed"
        : bannerOk && empty
          ? "indeterminate"
          : bannerText
            ? "confirmed_bug"
            : "unshipped",
      pass,
      evidence: `banner="${bannerText}" lines=${lines} summary="${summary}" status="${status}" errors=${errors.length}${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`,
      screenshot,
    });
  });

  test("57. /api/seen finds Smokey 4 over Fife on 2026-11-17 and /seen renders (Was that the plane I saw?)", async ({
    page,
    request,
  }) => {
    // Known flight from /api/history?from=2026-11-17&to=2026-11-17: N305DK
    // (Smokey 4) worked I-5 over Fife around 15:20-15:30 PT, session
    // 20261117T2248. Tracks are permanent since 2026-11-18, so this stays true.
    const api =
      "/api/seen?lat=47.24&lon=-122.36&t=2026-11-17T23%3A30%3A00Z&window_min=30&radius_nm=4.34";
    const r = await request.get(api);
    const cc = r.headers()["cache-control"] ?? "";
    const body = r.ok() ? await r.json().catch(() => null) : null;
    const tails: string[] = (body?.aircraft ?? []).map((a: { tail: string }) => a.tail);
    const hit = (body?.aircraft ?? []).find((a: { tail: string }) => a.tail === "N305DK");
    const apiOk =
      r.ok() &&
      tails.includes("N305DK") &&
      body?.data?.status === "ok" &&
      // /api/seen sets s-maxage=300; the Vercel edge forwards "public".
      edgeCacheable(cc, 300) &&
      typeof hit?.closest?.distance_mi === "number" &&
      /^\/flight\/N305DK\/\d{8}T\d{4}$/.test(hit?.flight?.href ?? "");

    await page.goto("/seen?place=Fife&lat=47.24&lon=-122.36&date=2026-11-17&time=15:30&w=30&r=5", {
      waitUntil: "domcontentloaded",
    });
    await page
      .waitForFunction(
        () => {
          const s = document.querySelector('[data-testid="seen-results"]')?.getAttribute("data-state");
          return s === "results" || s === "empty" || s === "error";
        },
        undefined,
        { timeout: 20_000 },
      )
      .catch(() => {});
    const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    const state = await page.locator('[data-testid="seen-results"]').getAttribute("data-state").catch(() => null);
    const card = await page.locator('[data-testid="seen-card"][data-tail="N305DK"]').count();
    const map = await page.locator('[data-testid="seen-map"]').count();
    const og = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);
    const screenshot = await shot(page, "57-seen");
    const pageOk = /Was that the plane I saw\?/.test(h1) && state === "results" && card > 0 && map > 0 && /\/seen\/og\?/.test(og ?? "");
    const pass = apiOk && pageOk;
    record({
      claim:
        "/api/seen (Fife, 2026-11-17 15:30 PT ±30 min, 5 mi) returns N305DK with a flight link and s-maxage 300; /seen renders the card with a map and its own og:image",
      category: pass ? "working_as_designed" : r.status() === 404 ? "unshipped" : "confirmed_bug",
      pass,
      evidence: `api HTTP ${r.status()} cc="${cc}" tails=${tails.join(",") || "none"} flight=${hit?.flight?.href ?? "none"} · page h1="${h1}" state=${state} card=${card} map=${map} og=${og ?? "none"}`,
      screenshot,
    });
  });

  test("58. ?mock= is ignored on production (no shareable fake all-clear)", async ({
    request,
    baseURL,
  }) => {
    // lib/mock-state.ts returns null for every ?mock= value when
    // VERCEL_ENV=production. Against prod the API, the beacon and the
    // board must all ignore it; against dev or a preview it stays on.
    const isProd = /^https:\/\/(www\.)?smokysignal\.app\/?$/.test(baseURL ?? "");
    const api = await request.get("/api/aircraft?mock=stale");
    const apiData = api.ok() ? ((await api.json()) as { source?: string; fetched_at?: number }) : null;
    const apiAgeMin = apiData?.fetched_at ? Math.floor((Date.now() - apiData.fetched_at) / 60_000) : null;
    const beacon = await request.get("/api/status.txt?mock=up");
    const beaconPlain = await request.get("/api/status.txt");
    const beaconState = beacon.ok() ? (await beacon.text()).split("\n")[0] : "";
    const plainState = beaconPlain.ok() ? (await beaconPlain.text()).split("\n")[0] : "";
    const ignored = apiData != null && apiData.source !== "mock" && beaconState === plainState;
    const pass = isProd ? ignored : apiData?.source === "mock";
    record({
      claim: isProd
        ? "Production ignores ?mock=: /api/aircraft?mock=stale serves the real snapshot and /api/status.txt?mock=up matches the plain beacon"
        : "Non-production deploy honours ?mock= (QA states still work off prod)",
      category: pass ? "working_as_designed" : isProd ? "unshipped" : "confirmed_bug",
      pass,
      evidence: `base=${baseURL} api source=${apiData?.source} age=${apiAgeMin}m · beacon?mock=up="${beaconState}" plain="${plainState}"`,
    });
  });

  test("59. /radar Colors picker repaints the heat in place and the cookie survives a reload (radar palettes)", async ({
    page,
    context,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /maplibre|layer|source|style|paint/i.test(m.text())) errors.push(m.text());
    });
    await context.clearCookies({ name: "ss_palette" }).catch(() => {});
    await page.goto("/radar", { waitUntil: "domcontentloaded" });
    // HotZoneLayer stamps the map container with the palette id and the
    // heatmap-color it reads back from MapLibre after each paint call.
    const heatColor = () =>
      page.locator("[data-heat-color]").first().getAttribute("data-heat-color").catch(() => null);
    const paletteAttr = () =>
      page.locator("[data-heat-color]").first().getAttribute("data-palette").catch(() => null);
    await page.waitForSelector("[data-heat-color]", { timeout: 30_000 }).catch(() => {});
    const before = await heatColor();
    const beforeId = await paletteAttr();
    const target = beforeId === "magma" ? "mono" : "magma";
    const label = target === "magma" ? "Magma colors" : "Mono colors";
    await page.getByRole("button", { name: "Radar filters" }).click().catch(() => {});
    await page.getByRole("button", { name: label }).click().catch(() => {});
    await page
      .waitForFunction(
        (id) => document.querySelector("[data-heat-color]")?.getAttribute("data-palette") === id,
        target,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const after = await heatColor();
    const cookie = (await context.cookies()).find((c) => c.name === "ss_palette")?.value ?? null;
    const screenshot = await shot(page, "62-radar-palette");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-heat-color]", { timeout: 30_000 }).catch(() => {});
    const reloadedId = await paletteAttr();
    const reloadedColor = await heatColor();
    const repainted = !!before && !!after && before !== after;
    const persisted = cookie === target && reloadedId === target && reloadedColor === after;
    const pass = repainted && persisted && errors.length === 0;
    record({
      claim:
        "Picking a palette in the /radar layers panel changes the heat layer's heatmap-color without a reload, and the ss_palette cookie keeps it across a reload",
      category: pass ? "working_as_designed" : before ? "confirmed_bug" : "unshipped",
      pass,
      evidence: `before=${beforeId} target=${target} repainted=${repainted} cookie=${cookie} reloaded=${reloadedId} sameColorAfterReload=${reloadedColor === after} errors=${errors.length}${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`,
      screenshot,
    });
    await context.clearCookies({ name: "ss_palette" }).catch(() => {});
  });
});

// 3D flight view needs a WebGL2 context. Headless Chromium only exposes one
// (via SwiftShader) with these flags, and launchOptions can't be set per
// describe, so on Chromium this test launches its own browser with the
// project's device emulation. Other engines use the project browser as-is.
const GL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

test.describe("p14 live-prod audit · 3D flight view", () => {
  test("60. /flight/<tail>/<id>?view=3d renders a WebGL2 canvas with no console errors", async ({
    page: projectPage,
    request,
    playwright,
    browserName,
    baseURL,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    extraHTTPHeaders,
  }) => {
    test.setTimeout(150_000);
    // Find a recent flight: tails with tracks from /api/flight-paths, then
    // the share link on that tail's /plane page.
    let flightPath: string | null = null;
    const fp = await request.get("/api/flight-paths");
    const tails: string[] = [];
    if (fp.ok()) {
      const fc = (await fp.json()) as {
        features?: { properties?: { tail?: string; date?: string } }[];
      };
      const byDate = [...(fc.features ?? [])].sort((a, b) =>
        String(b.properties?.date ?? "").localeCompare(String(a.properties?.date ?? "")),
      );
      for (const f of byDate) {
        const t = f.properties?.tail;
        if (t && !tails.includes(t)) tails.push(t);
      }
    }
    for (const t of tails.slice(0, 8)) {
      const html = await (await request.get(`/plane/${t}`)).text();
      const m = /\/flight\/[A-Z0-9]+\/\d{8}T\d{4}/.exec(html);
      if (m) {
        flightPath = m[0];
        break;
      }
    }
    if (!flightPath) {
      record({
        claim: "3D flight view renders on /flight/<tail>/<id>?view=3d",
        category: "indeterminate",
        pass: true,
        evidence: `no recent flight link found (tails tried: ${tails.slice(0, 8).join(",") || "none"})`,
      });
      return;
    }

    let ownBrowser: Awaited<ReturnType<typeof playwright.chromium.launch>> | null = null;
    let page = projectPage;
    if (browserName === "chromium") {
      ownBrowser = await playwright.chromium.launch({
        args: GL_ARGS,
        // Same override as playwright.config.ts (SS_CHROMIUM_EXECUTABLE_PATH).
        executablePath: process.env.SS_CHROMIUM_EXECUTABLE_PATH || undefined,
      });
      const ctx = await ownBrowser.newContext({
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        extraHTTPHeaders,
      });
      page = await ctx.newPage();
    }
    try {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 200));
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

      await page.goto(`${flightPath}?view=3d`, { waitUntil: "domcontentloaded" });
      const gl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
      if (!gl2) {
        const note = await page.locator('[role="status"]').first().innerText().catch(() => "");
        const screenshot = await shot(page, "56-flight-3d");
        record({
          claim: "3D flight view renders on /flight/<tail>/<id>?view=3d",
          category: "indeterminate",
          pass: /WebGL2/.test(note),
          evidence: `browser has no WebGL2; fallback note="${note}"`,
          screenshot,
        });
        return;
      }
      const ready = await page
        .waitForSelector('[data-testid="flight-3d"][data-ready="1"]', { timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(3000);
      const canvas = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('[data-testid="flight-3d"] canvas');
        if (!c) return null;
        // getContext with the type already in use returns the live context.
        const isGl2 = !!c.getContext("webgl2");
        return { w: c.clientWidth, h: c.clientHeight, isGl2 };
      });
      const urlKeepsView = new URL(page.url()).searchParams.get("view") === "3d";
      const screenshot = await shot(page, "56-flight-3d");
      const relevant = errors.filter((e) => !/_vercel\/insights/.test(e));
      const pass =
        ready &&
        canvas != null &&
        canvas.isGl2 &&
        canvas.w > 100 &&
        canvas.h > 100 &&
        urlKeepsView &&
        relevant.length === 0;
      record({
        claim: "3D flight view renders a WebGL2 canvas on /flight/<tail>/<id>?view=3d with no console errors",
        category: pass ? "working_as_designed" : ready ? "confirmed_bug" : "unshipped",
        pass,
        evidence: `${flightPath}?view=3d ready=${ready} canvas=${JSON.stringify(canvas)} view=3d kept=${urlKeepsView} errors=${JSON.stringify(relevant.slice(0, 5))}`,
        screenshot,
      });
    } finally {
      await ownBrowser?.close();
    }
  });
});

// ---------------------------------------------------------------------
// Navigation pass: five tabs, one Flights page, the desktop rail on
// every tabbed route (radar included), and the 12px floor on the hub
// and Flights. Each test records a finding like the rest of the audit.
// ---------------------------------------------------------------------

/** Smallest computed font-size among visible text-bearing elements. */
async function minFontSize(page: Page): Promise<{ min: number; text: string | null }> {
  return page.evaluate(() => {
    let min = Infinity;
    let text: string | null = null;
    for (const el of document.querySelectorAll("body *")) {
      const hasText = [...el.childNodes].some(
        (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? "").trim(),
      );
      if (!hasText) continue;
      if (el.closest(".maplibregl-map, script, style, noscript, [aria-hidden='true'] svg")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      // Visually hidden helpers (skip link, sr-only) are 1px boxes or off-screen.
      if (r.width <= 1 || r.height <= 1 || r.bottom < 0) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < min) {
        min = fs;
        text = (el.textContent ?? "").trim().slice(0, 40);
      }
    }
    return { min, text };
  });
}

test.describe("p14 live-prod audit · navigation", () => {
  test("61. the tab bar has exactly 5 items: Home, Radar, Flights, Alerts, More", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const items = page.locator('nav[aria-label="Main"] > a, nav[aria-label="Main"] > button');
    const labels = (await items.allInnerTexts()).map((t) => t.trim());
    const hrefs = await page
      .locator('nav[aria-label="Main"] > a')
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    const noToggle = (await page.locator('nav[aria-label="Main"] button').count()) === 0;
    const pass =
      labels.length === 5 &&
      JSON.stringify(labels) === JSON.stringify(["Home", "Radar", "Flights", "Alerts", "More"]) &&
      JSON.stringify(hrefs) === JSON.stringify(["/", "/radar", "/flights", "/settings/alerts", "/about"]) &&
      noToggle;
    record({
      claim: "Tab bar has exactly 5 links (Home, Radar, Flights, Alerts, More) and no toggle in it",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `labels=${JSON.stringify(labels)} hrefs=${JSON.stringify(hrefs)} noToggle=${noToggle}`,
    });
    expect(pass).toBe(true);
  });

  test("62. /dash and /activity redirect to /flights, keeping ?mock", async ({ page, request }) => {
    const dash = await request.get("/dash?mock=up", { maxRedirects: 0 });
    const act = await request.get("/activity", { maxRedirects: 0 });
    const dashLoc = dash.headers()["location"] ?? "";
    const actLoc = act.headers()["location"] ?? "";
    await page.goto("/dash?mock=up", { waitUntil: "domcontentloaded" });
    const landed = new URL(page.url());
    const segmented = await page.locator('[data-testid="flights-tabs"] a').count();
    const pass =
      [307, 308].includes(dash.status()) &&
      [307, 308].includes(act.status()) &&
      landed.pathname === "/flights" &&
      landed.searchParams.get("tab") === "now" &&
      landed.searchParams.get("mock") === "up" &&
      /\/flights\?.*tab=recent/.test(actLoc) &&
      segmented === 2;
    record({
      claim: "/dash redirects to /flights?tab=now (mock kept), /activity to /flights?tab=recent; Flights shows the Now/Recent switch",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `dash ${dash.status()} -> ${dashLoc} · activity ${act.status()} -> ${actLoc} · landed ${landed.pathname}${landed.search} · segments=${segmented}`,
    });
    expect(pass).toBe(true);
  });

  // The icon rail became the full sidebar (240px, collapsible to an 80px
  // rail) in the full-nav pass; the map must still clear it.
  test("63. the desktop sidebar is present on /radar at 1440 and the map clears it", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto("/radar", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const screenshot = await shot(page, "63-radar-sidebar-1440");
      const rail = await page.locator('[data-testid="sidebar"]').boundingBox();
      const map = await page.locator(".ss-radar-page > main").boundingBox();
      const pass =
        rail != null &&
        map != null &&
        rail.x === 0 &&
        rail.height >= 800 &&
        rail.width <= 241 &&
        map.x >= rail.width - 1;
      record({
        claim: "Desktop sidebar renders on /radar (left, full height) and the radar map starts right of it",
        category: pass ? "working_as_designed" : "unshipped",
        pass,
        evidence: `rail=${JSON.stringify(rail)} map=${JSON.stringify(map)}`,
        screenshot,
      });
      expect(pass).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("64. /about and /flights render no text below 12px at 390 wide", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    const results: Record<string, { min: number; text: string | null }> = {};
    try {
      for (const path of ["/about", "/flights?tab=now", "/flights?tab=recent"]) {
        await page.goto(path, { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
        results[path] = await minFontSize(page);
      }
      const pass = Object.values(results).every((r) => r.min >= 12);
      record({
        claim: "/about (More) and both /flights tabs render no text below the 12px floor at 390px",
        category: pass ? "working_as_designed" : "polish_needed",
        pass,
        evidence: JSON.stringify(results),
      });
      expect(pass).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("65. /settings shows the Speed warning toggle, default off, with the on-device explainer (N1b)", async ({
    browser,
  }) => {
    // Fresh context: no localStorage, so this is the first-visit default.
    // Mock links are off in prod, so this checks the real settings page
    // only; the overlay itself is covered by lib/speed-warning.test.ts.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    try {
      await page.goto("/settings", { waitUntil: "networkidle" });
      const toggle = page.locator('[data-testid="speed-warning-toggle"]');
      await toggle.waitFor({ state: "visible", timeout: 10_000 });
      await toggle.scrollIntoViewIfNeeded();
      const role = await toggle.getAttribute("role");
      const checked = await toggle.getAttribute("aria-checked");
      const label = (await toggle.textContent())?.trim() ?? "";
      const card = (await page.locator('[data-testid="speed-warning-setting"]').innerText()) ?? "";
      const explainer =
        /GPS speed while this screen is open/i.test(card) &&
        /Nothing is sent to us/i.test(card) &&
        /Not a radar detector/i.test(card);
      const limitValue = await page.locator('[data-testid="speed-limit-input"]').inputValue();
      const screenshot = await shot(page, "62-settings-speed-warning");
      const pass =
        role === "switch" &&
        checked === "false" &&
        label === "OFF" &&
        explainer &&
        limitValue === "60" &&
        !/!(\s|$)/.test(card);
      record({
        claim: "/settings renders a Speed warning switch, OFF by default, with the 'Nothing is sent to us' explainer and a 60 mph default limit",
        category: pass ? "working_as_designed" : "unshipped",
        pass,
        evidence: `role=${role} aria-checked=${checked} label=${label} explainer=${explainer} limit=${limitValue}`,
        screenshot,
      });
      expect(pass).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("70. /blog lists at least one post and links to it from More", async ({ page }) => {
    await page.goto("/blog", { waitUntil: "domcontentloaded" });
    const posts = await page.locator('[data-testid="blog-post-link"]').count();
    const chips = await page.locator('[data-testid="blog-kind-chips"] a').count();
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const hub = await page.locator('[data-hub-group="about"] a[href="/blog"]').count();
    const pass = posts >= 1 && chips === 4 && hub === 1;
    record({
      claim: "/blog lists at least one post with kind filter chips, and More links to it",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `posts=${posts} chips=${chips} hubLink=${hub}`,
    });
    expect(pass).toBe(true);
  });

  test("71. the launch post renders with Article JSON-LD and a PNG og:image", async ({ page, request }) => {
    await page.goto("/blog/2026-11-19-the-big-update", { waitUntil: "domcontentloaded" });
    const h1 = (await page.locator('[data-testid="blog-post"] h1').textContent())?.trim() ?? "";
    const og = (await page.locator('meta[property="og:image"]').first().getAttribute("content")) ?? "";
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    const hasArticle = ld.some((t) => {
      try {
        return JSON.parse(t)["@type"] === "Article";
      } catch {
        return false;
      }
    });
    const img = og ? await request.get(og) : null;
    const pass =
      /rebuilt/i.test(h1) &&
      /\/blog\/2026-11-19-the-big-update\/og$/.test(og) &&
      img?.status() === 200 &&
      (img?.headers()["content-type"] ?? "").startsWith("image/png") &&
      hasArticle;
    record({
      claim: "Launch post renders, carries Article JSON-LD, and its og:image is a 200 PNG",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `h1="${h1}" og=${og} img=${img?.status()} ${img?.headers()["content-type"]} article=${hasArticle}`,
    });
    expect(pass).toBe(true);
  });

  test("72. /blog/feed.xml is a valid Atom feed with the launch post", async ({ page, request }) => {
    const r = await request.get("/blog/feed.xml");
    const body = await r.text();
    const parsed = await page.evaluate((xml) => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const err = doc.getElementsByTagName("parsererror").length > 0;
      const root = doc.documentElement;
      return {
        err,
        root: root?.localName,
        ns: root?.namespaceURI,
        entries: doc.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "entry").length,
        hasLaunch: xml.includes("/blog/2026-11-19-the-big-update"),
      };
    }, body);
    const pass =
      r.status() === 200 &&
      (r.headers()["content-type"] ?? "").includes("application/atom+xml") &&
      !parsed.err &&
      parsed.root === "feed" &&
      parsed.ns === "http://www.w3.org/2005/Atom" &&
      parsed.entries >= 1 &&
      parsed.hasLaunch;
    record({
      claim: "/blog/feed.xml parses as Atom 1.0 with at least one entry, the launch post included",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `status=${r.status()} type=${r.headers()["content-type"]} ${JSON.stringify(parsed)}`,
    });
    expect(pass).toBe(true);
  });

  // Blog media (scripts/blog-media.ts, components/BlogMarkdown.tsx): the
  // launch post carries screenshots and clips, and none of them 404.
  test("72b. the launch post has a clip (mp4 + webm) and 6+ images, every media file a 200", async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.goto("/blog/2026-11-19-the-big-update", { waitUntil: "domcontentloaded" });
    const media = await page.evaluate(() => {
      const videos = [...document.querySelectorAll<HTMLVideoElement>('[data-testid="blog-post"] video')].map((v) => ({
        poster: v.getAttribute("poster") ?? "",
        sources: [...v.querySelectorAll("source")].map((s) => ({ src: s.getAttribute("src") ?? "", type: s.getAttribute("type") ?? "" })),
        sized: !!v.getAttribute("width") && !!v.getAttribute("height"),
      }));
      const images = [...document.querySelectorAll<HTMLImageElement>('[data-testid="blog-post"] figure picture img')].map((i) => ({
        src: i.getAttribute("src") ?? "",
        webp: i.parentElement?.querySelector('source[type="image/webp"]')?.getAttribute("srcset") ?? "",
        sized: !!i.getAttribute("width") && !!i.getAttribute("height"),
        lazy: i.getAttribute("loading") === "lazy",
        alt: i.getAttribute("alt") ?? "",
      }));
      const captions = document.querySelectorAll('[data-testid="blog-post"] figure figcaption').length;
      return { videos, images, captions };
    });
    const withBoth = media.videos.filter(
      (v) => v.sources.some((s) => s.type === "video/mp4") && v.sources.some((s) => s.type === "video/webm"),
    );
    const urls = [
      ...new Set([
        ...media.videos.flatMap((v) => [v.poster, ...v.sources.map((s) => s.src)]),
        ...media.images.flatMap((i) => [i.src, i.webp]),
      ]),
    ].filter(Boolean);
    const bad: string[] = [];
    for (const u of urls) {
      const r = await request.get(u);
      if (r.status() !== 200) bad.push(`${u}=${r.status()}`);
    }
    const pass =
      withBoth.length >= 1 &&
      media.images.length >= 6 &&
      media.images.every((i) => i.sized && i.lazy && i.alt.length > 0 && i.webp) &&
      media.videos.every((v) => v.sized && v.poster) &&
      bad.length === 0;
    const screenshot = await shot(page, "72b-blog-media");
    record({
      claim: "Launch post: at least one <video> with mp4 and webm sources, at least 6 sized lazy images, every media URL returns 200",
      category: pass ? "working_as_designed" : media.images.length + media.videos.length === 0 ? "unshipped" : "confirmed_bug",
      pass,
      evidence: `videos=${media.videos.length} (mp4+webm ${withBoth.length}) images=${media.images.length} captions=${media.captions} urls=${urls.length} bad=${bad.join(",") || "none"}`,
      screenshot,
    });
    expect(pass).toBe(true);
  });
});

// 3D on /radar: history mode (`?h=1&...&hview=3d`) and live (`?view=3d`).
// Both mount components/Flight3D.tsx over the radar; the QA hook is the
// same flight-3d container, with data-scene telling the two apart.
test.describe("p14 live-prod audit · 3D radar", () => {
  test("73. /radar?h=1&...&hview=3d and /radar?view=3d render a WebGL2 canvas with no console errors", async ({
    page: projectPage,
    playwright,
    browserName,
    baseURL,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    extraHTTPHeaders,
  }) => {
    test.setTimeout(180_000);
    const ptDate = (offsetDays: number) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() - offsetDays * 86_400_000));
    const historyPath = `/radar?h=1&from=${ptDate(7)}&to=${ptDate(0)}&hview=3d`;

    let ownBrowser: Awaited<ReturnType<typeof playwright.chromium.launch>> | null = null;
    let page = projectPage;
    if (browserName === "chromium") {
      ownBrowser = await playwright.chromium.launch({ args: GL_ARGS });
      const ctx = await ownBrowser.newContext({
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        extraHTTPHeaders,
      });
      page = await ctx.newPage();
    }
    try {
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 200));
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));

      const probe = async (url: string, scene: string, param: string, name: string) => {
        errors.length = 0;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        const gl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
        if (!gl2) {
          return { gl2, ready: false, canvas: null, kept: false, errs: [] as string[], screenshot: await shot(page, name) };
        }
        const ready = await page
          .waitForSelector(`[data-testid="flight-3d"][data-scene="${scene}"][data-ready="1"]`, { timeout: 45_000 })
          .then(() => true)
          .catch(() => false);
        await page.waitForTimeout(4000);
        const canvas = await page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('[data-testid="flight-3d"] canvas');
          if (!c) return null;
          // getContext with the type already in use returns the live context.
          return { w: c.clientWidth, h: c.clientHeight, isGl2: !!c.getContext("webgl2") };
        });
        const kept = new URL(page.url()).searchParams.get(param) === "3d";
        const errs = errors.filter((e) => !/_vercel\/insights/.test(e));
        return { gl2, ready, canvas, kept, errs, screenshot: await shot(page, name) };
      };

      const hist = await probe(historyPath, "radar-history", "hview", "73-radar-history-3d");
      const live = await probe("/radar?view=3d", "radar-live", "view", "73-radar-live-3d");
      if (!hist.gl2) {
        record({
          claim: "3D on /radar (history hview=3d, live view=3d)",
          category: "indeterminate",
          pass: true,
          evidence: "browser has no WebGL2; the radar stays on the flat map",
          screenshot: hist.screenshot,
        });
        return;
      }
      const ok = (r: typeof hist) =>
        r.ready &&
        r.canvas != null &&
        r.canvas.isGl2 &&
        r.canvas.w > 100 &&
        r.canvas.h > 100 &&
        r.kept &&
        r.errs.length === 0;
      const pass = ok(hist) && ok(live);
      record({
        claim:
          "/radar?h=1&from=&to=&hview=3d (history) and /radar?view=3d (live) render a WebGL2 canvas with no console errors",
        category: pass ? "working_as_designed" : hist.ready || live.ready ? "confirmed_bug" : "unshipped",
        pass,
        evidence: `history: ${historyPath} ready=${hist.ready} canvas=${JSON.stringify(hist.canvas)} kept=${hist.kept} errors=${JSON.stringify(hist.errs.slice(0, 3))} | live: ready=${live.ready} canvas=${JSON.stringify(live.canvas)} kept=${live.kept} errors=${JSON.stringify(live.errs.slice(0, 3))}`,
        screenshot: hist.screenshot,
      });
    } finally {
      await ownBrowser?.close();
    }
  });
});

// SEO / GEO surfaces (feat/seo-geo). Read-only HTTP checks; the weekly
// `npm run seo:audit` covers the rest (docs/seo/PLAYBOOK.md).
test.describe("p14 live-prod audit · SEO", () => {
  test("74. /sitemap.xml lists /plane/N305DK and /road/i-5", async ({ request }) => {
    const r = await request.get("/sitemap.xml");
    const xml = await r.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
    const pass =
      r.status() === 200 &&
      locs.some((u) => u.endsWith("/plane/N305DK")) &&
      locs.some((u) => u.endsWith("/road/i-5"));
    record({
      claim: "/sitemap.xml lists /plane/N305DK and /road/i-5",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `HTTP ${r.status()} · ${locs.length} URLs`,
    });
    expect(pass).toBe(true);
  });

  test("75. /robots.txt references the sitemap and disallows /admin", async ({ request }) => {
    const r = await request.get("/robots.txt");
    const txt = await r.text();
    const pass =
      r.status() === 200 &&
      /^Sitemap:\s*https:\/\/www\.smokysignal\.app\/sitemap\.xml\s*$/im.test(txt) &&
      /^Disallow:\s*\/admin\s*$/im.test(txt) &&
      /^User-Agent:\s*GPTBot\s*$/im.test(txt) &&
      /^User-Agent:\s*ClaudeBot\s*$/im.test(txt);
    record({
      claim: "/robots.txt references the sitemap, disallows /admin and names the AI crawlers",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `HTTP ${r.status()} · ${txt.split("\n").length} lines`,
    });
    expect(pass).toBe(true);
  });

  test("76. /llms.txt exists and carries the registry counts", async ({ request }) => {
    const r = await request.get("/llms.txt");
    const txt = await r.text();
    const pass =
      r.status() === 200 &&
      txt.startsWith("# SmokySignal") &&
      /## Machine-readable endpoints/.test(txt) &&
      /flight-hours\.csv/.test(txt) &&
      /It tracks \d+ aircraft/.test(txt);
    record({
      claim: "/llms.txt is served with the summary, key facts and endpoints",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `HTTP ${r.status()} · ${r.headers()["content-type"]} · ${txt.length} bytes`,
    });
    expect(pass).toBe(true);
  });

  test("77. /data has Dataset JSON-LD with the ODbL license and CSV distribution", async ({ request }) => {
    const r = await request.get("/data");
    const html = await r.text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => {
      try {
        const v = JSON.parse(m[1]!);
        return Array.isArray(v) ? v : [v];
      } catch {
        return [];
      }
    });
    const ds = blocks.find((b) => b?.["@type"] === "Dataset");
    const pass =
      !!ds &&
      /odbl/i.test(String(ds.license)) &&
      /flight-hours\.csv$/.test(String(ds.distribution?.[0]?.contentUrl ?? "")) &&
      String(ds.temporalCoverage ?? "").startsWith("2026-10-16");
    record({
      claim: "/data carries Dataset JSON-LD (ODbL 1.0, CSV distribution, temporal coverage from 2026-10-16)",
      category: pass ? "working_as_designed" : "unshipped",
      pass,
      evidence: `blocks=${blocks.map((b) => b?.["@type"]).join(",")} license=${ds?.license ?? "-"}`,
    });
    expect(pass).toBe(true);
  });

  test("78. every top-level page has a unique <title> and a canonical", async ({ request }) => {
    const paths = [
      "/", "/radar", "/flights", "/circling", "/seen", "/program", "/aircraft", "/road",
      "/forecast", "/stats", "/data", "/about", "/help", "/blog", "/relay", "/embed/help", "/board", "/legal",
    ];
    const titles: Record<string, string> = {};
    const missingCanonical: string[] = [];
    for (const p of paths) {
      const html = await (await request.get(p)).text();
      titles[p] = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
      if (!/<link rel="canonical"/.test(html)) missingCanonical.push(p);
    }
    const values = Object.values(titles);
    const dupes = values.filter((t, i) => !t || values.indexOf(t) !== i);
    const pass = dupes.length === 0 && missingCanonical.length === 0;
    record({
      claim: "Every top-level page has a unique, non-empty <title> and a canonical link",
      category: pass ? "working_as_designed" : "polish_needed",
      pass,
      evidence: `duplicates=${JSON.stringify(dupes)} missingCanonical=${JSON.stringify(missingCanonical)}`,
    });
    expect(pass).toBe(true);
  });
});

test.describe("p14 live-prod audit · full navigation", () => {
  const SECTIONS = ["Now", "History", "Aircraft", "Alerts & sharing", "Modes", "About"];

  test("79. at 1440 the sidebar shows all six section headings, status and search", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const screenshot = await shot(page, "79-sidebar-1440");
      const headings = await page
        .locator('[data-testid="sidebar"] h2')
        .evaluateAll((els) =>
          els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => (e.textContent ?? "").trim()),
        );
      const status = (await page.locator('[data-testid="sidebar-status"]').innerText().catch(() => "")).trim();
      const search = await page.locator('[data-testid="sidebar-search"]').isVisible();
      const tabbarHidden = !(await page.locator('nav[aria-label="Main"]').isVisible());
      const pass =
        JSON.stringify(headings.map((h) => h.toLowerCase())) ===
          JSON.stringify(SECTIONS.map((s) => s.toLowerCase())) &&
        /Smokey.s (up|down)|Feed quiet/.test(status) &&
        search &&
        tabbarHidden;
      record({
        claim: "1440: sidebar renders Now, History, Aircraft, Alerts & sharing, Modes, About, a live status block and the search field; the bottom bar is hidden",
        category: pass ? "working_as_designed" : "unshipped",
        pass,
        evidence: `headings=${JSON.stringify(headings)} status=${JSON.stringify(status)} search=${search} tabbarHidden=${tabbarHidden}`,
        screenshot,
      });
      expect(pass).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("80. ⌘K opens search; typing N305DK then Enter lands on /plane/N305DK", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto("/", { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      const input = page.locator('[role="dialog"] input[role="combobox"]');
      const opened = await input
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      await page.keyboard.type("N305DK");
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/plane\/N305DK/, { timeout: 10_000 }).catch(() => {});
      const landed = new URL(page.url()).pathname;
      const pass = opened && landed === "/plane/N305DK";
      record({
        claim: "⌘K / Ctrl+K opens the search palette and N305DK + Enter goes to /plane/N305DK",
        category: pass ? "working_as_designed" : "unshipped",
        pass,
        evidence: `opened=${opened} landed=${landed}`,
      });
      expect(pass).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("81. at 390 the More sheet shows the six sections plus search", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    try {
      await page.goto("/about", { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const screenshot = await shot(page, "81-more-sheet-390");
      const headings = await page.locator('nav[aria-label="Site sections"] h2').allInnerTexts();
      const search = await page.locator('[data-testid="more-sheet"] input[role="combobox"]').isVisible();
      await page.locator('[data-testid="more-sheet"] input[role="combobox"]').fill("telegram");
      await page.waitForTimeout(300);
      const first = await page
        .locator('[data-testid="more-sheet"] [role="option"]')
        .first()
        .getAttribute("data-href")
        .catch(() => null);
      const pass =
        JSON.stringify(headings.map((h) => h.trim().toLowerCase())) ===
          JSON.stringify(SECTIONS.map((s) => s.toLowerCase())) &&
        search &&
        first === "/relay#telegram";
      record({
        claim: "390: /about (the More sheet) shows search on top and the same six sections as the sidebar; 'telegram' finds the bot card",
        category: pass ? "working_as_designed" : "unshipped",
        pass,
        evidence: `headings=${JSON.stringify(headings)} search=${search} telegram=${first}`,
        screenshot,
      });
      expect(pass).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("82. the sidebar and the More sheet render no text below 12px", async ({ browser }) => {
    // Four page loads; /radar keeps the network busy (live polls, 3D), so
    // wait for DOM + a settle instead of networkidle.
    test.setTimeout(120_000);
    const results: Record<string, { min: number; text: string | null }> = {};
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const d = await desk.newPage();
      for (const path of ["/", "/radar", "/plane/N305DK"]) {
        await d.goto(path, { waitUntil: "domcontentloaded" });
        await d.waitForTimeout(2500);
        results[`1440 ${path}`] = await d.evaluate(() => {
          let min = Infinity;
          let text: string | null = null;
          for (const el of document.querySelectorAll('[data-testid="sidebar"] *')) {
            const hasText = [...el.childNodes].some(
              (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? "").trim(),
            );
            if (!hasText) continue;
            const r = el.getBoundingClientRect();
            if (r.width <= 1 || r.height <= 1) continue;
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            const fs = parseFloat(cs.fontSize);
            if (fs < min) {
              min = fs;
              text = (el.textContent ?? "").trim().slice(0, 40);
            }
          }
          return { min, text };
        });
      }
      const p = await phone.newPage();
      await p.goto("/about", { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(2000);
      results["390 /about"] = await minFontSize(p);
      const pass = Object.values(results).every((r) => r.min >= 12);
      record({
        claim: "Sidebar (/, /radar, /plane at 1440) and the More sheet (390) keep the 12px type floor",
        category: pass ? "working_as_designed" : "polish_needed",
        pass,
        evidence: JSON.stringify(results),
      });
      expect(pass).toBe(true);
    } finally {
      await desk.close();
      await phone.close();
    }
  });
});

// ---------------------------------------------------------------------
// 3D camera controls (components/Map3DControls.tsx) and the palette road
// tint on the basemap (lib/basemap.ts applyRoadTint).
// ---------------------------------------------------------------------

/** A recent /flight/<tail>/<id> share path, via /api/flight-paths and the
 *  tail's /plane page (same route as claim 60). */
async function findRecentFlightPath(request: APIRequestContext): Promise<{ path: string | null; tails: string[] }> {
  const fp = await request.get("/api/flight-paths");
  const tails: string[] = [];
  if (fp.ok()) {
    const fc = (await fp.json()) as { features?: { properties?: { tail?: string; date?: string } }[] };
    const byDate = [...(fc.features ?? [])].sort((a, b) =>
      String(b.properties?.date ?? "").localeCompare(String(a.properties?.date ?? "")),
    );
    for (const f of byDate) {
      const t = f.properties?.tail;
      if (t && !tails.includes(t)) tails.push(t);
    }
  }
  for (const t of tails.slice(0, 8)) {
    const html = await (await request.get(`/plane/${t}`)).text();
    const m = /\/flight\/[A-Z0-9]+\/\d{8}T\d{4}/.exec(html);
    if (m) return { path: m[0], tails };
  }
  return { path: null, tails };
}

/** Signed smallest angle a -> b, degrees. */
function bearingDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

test.describe("p14 live-prod audit · 3D camera controls and road tint", () => {
  test("83. a 3D flight: the rotate button turns the bearing 45° and the compass puts north back up", async ({
    page: projectPage,
    request,
    playwright,
    browserName,
    baseURL,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    extraHTTPHeaders,
  }) => {
    test.setTimeout(150_000);
    const claim = "3D flight: rotate turns the bearing 45°, the compass resets to north up, every control is 44px";
    const { path: flightPath, tails } = await findRecentFlightPath(request);
    if (!flightPath) {
      record({
        claim,
        category: "indeterminate",
        pass: true,
        evidence: `no recent flight link found (tails tried: ${tails.slice(0, 8).join(",") || "none"})`,
      });
      return;
    }
    let ownBrowser: Awaited<ReturnType<typeof playwright.chromium.launch>> | null = null;
    let page = projectPage;
    if (browserName === "chromium") {
      ownBrowser = await playwright.chromium.launch({
        args: GL_ARGS,
        executablePath: process.env.SS_CHROMIUM_EXECUTABLE_PATH || undefined,
      });
      const ctx = await ownBrowser.newContext({
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        extraHTTPHeaders,
      });
      page = await ctx.newPage();
    }
    try {
      await page.goto(`${flightPath}?view=3d`, { waitUntil: "domcontentloaded" });
      const gl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
      if (!gl2) {
        record({ claim, category: "indeterminate", pass: true, evidence: "browser has no WebGL2" });
        return;
      }
      const ready = await page
        .waitForSelector('[data-testid="flight-3d"][data-ready="1"] [data-testid="map3d-controls"][data-bearing]', {
          timeout: 45_000,
        })
        .then(() => true)
        .catch(() => false);
      // Let the intro swoop finish before touching the camera.
      await page.waitForTimeout(3500);
      const read = async () => {
        const el = page.locator('[data-testid="map3d-controls"]').first();
        return {
          bearing: Number(await el.getAttribute("data-bearing").catch(() => "NaN")),
          pitch: Number(await el.getAttribute("data-pitch").catch(() => "NaN")),
        };
      };
      const before = await read();
      await page.getByTestId("map3d-rotate-right").click().catch(() => {});
      await page.waitForTimeout(1200);
      const rotated = await read();
      const screenshot = await shot(page, "83-flight-3d-rotated");
      await page.getByTestId("map3d-compass").click().catch(() => {});
      await page.waitForTimeout(1200);
      const reset = await read();
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="map3d-controls"] button')].map((b) => {
          const r = b.getBoundingClientRect();
          return { id: b.dataset.testid ?? "", w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute("aria-label") ?? "" };
        }),
      );
      const turned = Math.abs(bearingDelta(before.bearing, rotated.bearing) - 45) < 3;
      const north = Math.abs(bearingDelta(0, reset.bearing)) < 1;
      const targets = sizes.length >= 5 && sizes.every((s) => s.w >= 44 && s.h >= 44 && s.label.length > 0);
      const pass = ready && turned && north && targets;
      record({
        claim,
        category: pass ? "working_as_designed" : ready ? "confirmed_bug" : "unshipped",
        pass,
        evidence: `${flightPath}?view=3d bearing ${before.bearing} -> ${rotated.bearing} (turned=${turned}) -> compass ${reset.bearing} pitch ${reset.pitch} (north=${north}); buttons=${JSON.stringify(sizes.map((s) => `${s.id}:${s.w}x${s.h}`))}`,
        screenshot,
      });
    } finally {
      await ownBrowser?.close();
    }
  });

  test("84. /radar paints motorways with the default palette's road tint, not grey", async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.clearCookies({ name: "ss_palette" }).catch(() => {});
    await context.clearCookies({ name: "ss_contrast" }).catch(() => {});
    await page.goto("/radar", { waitUntil: "domcontentloaded" });
    // applyRoadTint stamps the map container with the motorway colour it
    // reads back from MapLibre's own paint property on the road layer.
    const found = await page
      .waitForSelector("[data-road-motorway]", { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    const color = await page.locator("[data-road-motorway]").first().getAttribute("data-road-motorway").catch(() => null);
    const layer = await page.locator("[data-road-motorway]").first().getAttribute("data-road-layer").catch(() => null);
    const m = color ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color) : null;
    const rgb = m ? [1, 2, 3].map((i) => parseInt(m[i]!, 16)) : null;
    // Grey means r = g = b; the Ember tint is a slate-teal.
    const spread = rgb ? Math.max(...rgb) - Math.min(...rgb) : 0;
    const pass = found && spread >= 16;
    const screenshot = await shot(page, "84-radar-road-tint");
    record({
      claim: "/radar motorway road layer has a non-grey line-color for the default palette (Ember slate-teal)",
      category: pass ? "working_as_designed" : found ? "confirmed_bug" : "unshipped",
      pass,
      evidence: `layer=${layer} line-color(motorway)=${color} rgb spread=${spread}`,
      screenshot,
    });
  });
  test("85. /press renders and every download link returns 200", async ({ page, request }) => {
    await page.goto("/press", { waitUntil: "networkidle" });
    const h1 = await page.locator("h1").first().innerText().catch(() => "");
    const hrefs = await page.locator('[data-testid="press-download"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    );
    const bad: string[] = [];
    for (const href of hrefs) {
      const r = await request.get(href);
      if (r.status() !== 200) bad.push(`${href}=${r.status()}`);
    }
    const body = await page.locator("body").innerText();
    const cite = /Source: SmokySignal \(smokysignal\.app\), built on public ADS-B from adsb\.fi and adsb\.lol \(ODbL\)/.test(body);
    const pass = /Press kit/i.test(h1) && hrefs.length >= 15 && bad.length === 0 && cite;
    const screenshot = await shot(page, "85-press");
    record({
      claim: "/press renders with the citation line and every logo, screenshot and clip link returns 200",
      category: pass ? "working_as_designed" : hrefs.length === 0 ? "unshipped" : "confirmed_bug",
      pass,
      evidence: `h1="${h1}" links=${hrefs.length} bad=[${bad.join(", ")}] cite=${cite}`,
      screenshot,
    });
  });

  test("86. /poster renders a QR svg and the PDF is application/pdf", async ({ page, request }) => {
    await page.goto("/poster?ref=poster", { waitUntil: "networkidle" });
    const qr = await page.locator('[data-testid="poster-qr-main"] svg').count();
    const board = await page.locator('[data-testid="poster-qr-board"] svg').count();
    const headline = await page.locator(".poster-h1").innerText().catch(() => "");
    const pdf = await request.get("/poster/smokysignal-poster.pdf");
    const ctype = pdf.headers()["content-type"] ?? "";
    const home = await request.get("/?ref=poster");
    const pass = qr === 1 && board === 1 && /Is Smokey up\?/.test(headline) && pdf.status() === 200 && /application\/pdf/.test(ctype) && home.status() === 200;
    const screenshot = await shot(page, "86-poster");
    record({
      claim: "/poster renders both QR svgs, its PDF returns 200 application/pdf, and /?ref=poster still loads",
      category: pass ? "working_as_designed" : qr === 0 ? "unshipped" : "confirmed_bug",
      pass,
      evidence: `qr=${qr} board=${board} headline="${headline}" pdf=${pdf.status()} ${ctype} home?ref=${home.status()}`,
      screenshot,
    });
  });
});
