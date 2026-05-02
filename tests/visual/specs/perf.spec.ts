import { test } from "@playwright/test";
import { ROUTES } from "./routes";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

for (const route of ROUTES) {
  test(`perf: ${route.name}`, async ({ page }, testInfo) => {
    if (testInfo.project.name !== "chromium-mobile") test.skip();
    try {
      await page.goto(route.path, { waitUntil: "load" });
    } catch {
      return;
    }
    const metrics = await page.evaluate(() => {
      const navEntry = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      const paintEntries = performance.getEntriesByType("paint");
      const fcp =
        paintEntries.find((e) => e.name === "first-contentful-paint")
          ?.startTime ?? null;
      return {
        domContentLoaded: navEntry?.domContentLoadedEventEnd ?? null,
        load: navEntry?.loadEventEnd ?? null,
        responseEnd: navEntry?.responseEnd ?? null,
        transferSize: (navEntry as any)?.transferSize ?? null,
        firstContentfulPaint: fcp,
      };
    });

    const dir = path.join(ROOT, "out/perf");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${route.name}.json`),
      JSON.stringify(metrics, null, 2),
    );
  });
}
