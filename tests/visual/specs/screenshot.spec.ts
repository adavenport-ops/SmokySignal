import { test } from "@playwright/test";
import { ROUTES } from "./routes";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

for (const route of ROUTES) {
  test(`screenshot: ${route.name}`, async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const errors: any[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning")
        errors.push({ type: m.type(), text: m.text(), location: m.location() });
    });
    page.on("pageerror", (e) =>
      errors.push({ type: "pageerror", text: e.message, stack: e.stack }),
    );
    page.on("requestfailed", (r) =>
      errors.push({
        type: "requestfailed",
        text: `${r.url()} :: ${r.failure()?.errorText}`,
      }),
    );

    let response;
    try {
      response = await page.goto(route.path, { waitUntil: "networkidle" });
    } catch (e: any) {
      errors.push({ type: "navigation", text: e.message });
    }
    if (route.settleMs) await page.waitForTimeout(route.settleMs);

    const screenshotDir = path.join(ROOT, "out/screenshots", project);
    fs.mkdirSync(screenshotDir, { recursive: true });
    try {
      await page.screenshot({
        path: path.join(screenshotDir, `${route.name}.png`),
        fullPage: true,
      });
    } catch (e: any) {
      errors.push({ type: "screenshot", text: e.message });
    }

    const logDir = path.join(ROOT, "out/console-logs", project);
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, `${route.name}.json`),
      JSON.stringify(
        {
          status: response?.status(),
          url: response?.url(),
          errors,
          finalUrl: page.url(),
        },
        null,
        2,
      ),
    );
  });
}
