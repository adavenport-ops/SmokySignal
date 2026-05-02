import { test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ROUTES } from "./routes";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

for (const route of ROUTES.filter((r) => r.a11y)) {
  test(`a11y: ${route.name}`, async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    if (project !== "chromium-desktop") test.skip();
    try {
      await page.goto(route.path, { waitUntil: "networkidle" });
    } catch {
      // log nothing — covered by screenshot spec
      return;
    }
    if (route.settleMs) await page.waitForTimeout(route.settleMs);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const dir = path.join(ROOT, "out/a11y", project);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${route.name}.json`),
      JSON.stringify(
        { violations: results.violations, incomplete: results.incomplete },
        null,
        2,
      ),
    );
  });
}
