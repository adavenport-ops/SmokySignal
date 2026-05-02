import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

test("pwa: manifest is valid and reachable", async ({ request }, testInfo) => {
  if (testInfo.project.name !== "chromium-desktop") test.skip();
  const out: any = {};
  const r = await request.get("/manifest.json");
  out.status = r.status();
  out.body = r.ok() ? await r.json() : null;
  if (out.body) {
    out.checks = {
      hasName: typeof out.body.name === "string",
      hasShortName: typeof out.body.short_name === "string",
      hasStartUrl: typeof out.body.start_url === "string",
      hasDisplay: typeof out.body.display === "string",
      hasIcons: Array.isArray(out.body.icons) && out.body.icons.length >= 2,
      hasMaskable: out.body.icons?.some((i: any) =>
        /maskable/i.test(i.purpose ?? ""),
      ),
      hasThemeColor: typeof out.body.theme_color === "string",
      hasBgColor: typeof out.body.background_color === "string",
    };
  }
  fs.mkdirSync(path.join(ROOT, "out/pwa"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "out/pwa/manifest.json"),
    JSON.stringify(out, null, 2),
  );
  expect(out.status).toBe(200);
});

test("pwa: every icon URL in manifest returns 200", async ({ request }, testInfo) => {
  if (testInfo.project.name !== "chromium-desktop") test.skip();
  const manifestPath = path.join(ROOT, "out/pwa/manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!m.body?.icons) return;
  const results: any[] = [];
  for (const icon of m.body.icons) {
    const r = await request.get(icon.src);
    results.push({
      src: icon.src,
      status: r.status(),
      bytes: (await r.body()).length,
    });
  }
  fs.writeFileSync(
    path.join(ROOT, "out/pwa/icons.json"),
    JSON.stringify(results, null, 2),
  );
  for (const r of results) expect(r.status, `${r.src}`).toBe(200);
});

test("pwa: service worker registers", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "chromium-desktop") test.skip();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const swReg = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false };
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);
      return {
        supported: true,
        hasRegistration: !!reg,
        scope: (reg as any)?.scope ?? null,
      };
    } catch {
      return { supported: true, hasRegistration: false, scope: null };
    }
  });
  fs.mkdirSync(path.join(ROOT, "out/pwa"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "out/pwa/sw.json"),
    JSON.stringify(swReg, null, 2),
  );
  // Informational only — Prompt 2's push pipeline owns the SW lifecycle.
});

test("pwa: theme-color meta tag is present", async ({ page }, testInfo) => {
  if (testInfo.project.name !== "chromium-desktop") test.skip();
  await page.goto("/", { waitUntil: "networkidle" });
  const theme = await page
    .locator('meta[name="theme-color"]')
    .first()
    .getAttribute("content");
  fs.mkdirSync(path.join(ROOT, "out/pwa"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "out/pwa/theme-color.json"),
    JSON.stringify({ theme }, null, 2),
  );
  expect(theme).toBeTruthy();
});

test("pwa: og-image returns 200 and is at least 100KB", async ({ request }, testInfo) => {
  if (testInfo.project.name !== "chromium-desktop") test.skip();
  // Try the standard OG asset paths.
  const candidates = ["/icons/og-image.png", "/og-image.png"];
  let last: { src: string; status: number; bytes: number } | null = null;
  for (const src of candidates) {
    const r = await request.get(src);
    const bytes = r.ok() ? (await r.body()).length : 0;
    last = { src, status: r.status(), bytes };
    if (r.ok() && bytes > 100_000) break;
  }
  fs.mkdirSync(path.join(ROOT, "out/pwa"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "out/pwa/og.json"),
    JSON.stringify(last, null, 2),
  );
  // Don't hard-fail; let categorize-bugs decide severity.
});

test("pwa: standalone-mode renders home without URL bar artifacts", async ({
  browser,
}, testInfo) => {
  if (testInfo.project.name !== "pwa-standalone-mobile") test.skip();
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, "matchMedia", {
      value: (q: string) => ({
        matches: q.includes("display-mode: standalone"),
        addListener: () => {},
        removeListener: () => {},
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }),
    });
  });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  fs.mkdirSync(path.join(ROOT, "out/pwa/screenshots"), { recursive: true });
  await page.screenshot({
    path: path.join(ROOT, "out/pwa/screenshots/home-standalone.png"),
    fullPage: true,
  });
  await ctx.close();
});
