import { defineConfig, devices } from "@playwright/test";

// The apex 307s to www; start on www so every request skips the redirect.
const BASE = process.env.SS_VISUAL_BASE_URL ?? "https://www.smokysignal.app";

// One id per `playwright test` invocation. Set here in the runner process,
// inherited by every worker, so specs that log findings per worker (p14)
// can tell this run's lines from an earlier run's.
process.env.SS_AUDIT_RUN ??= new Date().toISOString();

// Optional: point Chromium projects at an already-installed binary instead
// of the revision this @playwright/test version expects, e.g.
//   SS_CHROMIUM_EXECUTABLE_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell
// Unset (the default), Playwright uses its own browser.
const CHROMIUM_EXECUTABLE = process.env.SS_CHROMIUM_EXECUTABLE_PATH || undefined;
const chromiumLaunch = CHROMIUM_EXECUTABLE
  ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } }
  : {};

export default defineConfig({
  testDir: ".",
  testMatch: ["specs/**/*.spec.ts", "personas/**/*.spec.ts"],
  outputDir: "./out/test-output",
  reporter: [
    ["html", { outputFolder: "./out/playwright-html", open: "never" }],
    ["json", { outputFile: "./out/playwright.json" }],
    ["list"],
  ],
  use: {
    baseURL: BASE,
    // Preview deploys are behind Vercel Authentication; CI passes the
    // automation bypass secret. No-op against prod.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
    screenshot: "on",
    trace: "retain-on-failure",
    video: "off",
    ignoreHTTPSErrors: false,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // iPhone/iPad descriptors default to WebKit; pin Chromium explicitly.
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 15 Pro"], browserName: "chromium", ...chromiumLaunch },
    },
    {
      name: "chromium-tablet",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium", ...chromiumLaunch },
    },
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], ...chromiumLaunch } },
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 15 Pro"], browserName: "webkit" },
    },
    {
      name: "webkit-tablet",
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
    },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
    {
      name: "pwa-standalone-mobile",
      use: {
        ...devices["iPhone 15 Pro"],
        browserName: "webkit",
        viewport: { width: 393, height: 852 },
      },
      testMatch: /pwa.*\.spec\.ts/,
    },
  ],
  retries: 0,
  workers: 4,
  timeout: 60_000,
});
