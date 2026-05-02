#!/usr/bin/env node
// Walk every result file under out/ and emit bugs.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");

const bugs = [];
let nextId = 1;

function add({
  severity,
  type,
  title,
  description,
  surface,
  rawData,
  autoFixable = false,
  suggestedFix = null,
}) {
  bugs.push({
    id: `BUG-${String(nextId++).padStart(3, "0")}`,
    severity,
    type,
    title,
    description,
    surface,
    rawData,
    autoFixable,
    suggestedFix,
  });
}

// Console errors / requestfailed / hydration → bug
for (const f of glob.sync(path.join(OUT, "console-logs/**/*.json"))) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const surface =
    path.basename(path.dirname(f)) + "/" + path.basename(f, ".json");
  for (const e of j.errors ?? []) {
    const isHydration = /hydrat|did not match|server.*client/i.test(e.text);
    const isAssetMiss = /404|net::ERR/i.test(e.text) && !surface.includes("404");
    add({
      severity: isHydration ? "P1" : isAssetMiss ? "P2" : "P2",
      type: isHydration
        ? "hydration"
        : isAssetMiss
          ? "functional"
          : "functional",
      title: e.text.slice(0, 100),
      description: e.text,
      surface,
      rawData: e,
      autoFixable: false,
    });
  }
  if (j.status && j.status >= 400 && !surface.includes("404")) {
    add({
      severity: "P0",
      type: "functional",
      title: `${surface} returned ${j.status}`,
      description: `Page did not return 200; got ${j.status} on ${j.url ?? surface}`,
      surface,
      rawData: { status: j.status, url: j.url },
      autoFixable: false,
    });
  }
}

// A11y violations
for (const f of glob.sync(path.join(OUT, "a11y/**/*.json"))) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const surface =
    path.basename(path.dirname(f)) + "/" + path.basename(f, ".json");
  for (const v of j.violations ?? []) {
    const sev =
      v.impact === "critical" ? "P0" : v.impact === "serious" ? "P1" : "P2";
    const fixable = ["html-has-lang"].includes(v.id);
    add({
      severity: sev,
      type: "a11y",
      title: `${v.id}: ${v.help}`,
      description: v.description,
      surface,
      rawData: {
        id: v.id,
        nodes: (v.nodes || []).slice(0, 3).map((n) => ({
          html: n.html,
          target: n.target,
        })),
      },
      autoFixable: fixable && (v.nodes || []).length <= 3,
      suggestedFix: fixable
        ? { rule: v.id, nodes: (v.nodes || []).map((n) => n.target) }
        : null,
    });
  }
}

// Brand voice
for (const f of glob.sync(path.join(OUT, "brand-voice/*.json"))) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const surface = path.basename(f, ".json");
  for (const v of j.violations ?? []) {
    add({
      severity: "P2",
      type: "brandVoice",
      title: `Voice violation: ${v.reason}`,
      description: `Matched "${v.matched}" in context: "${v.context}"`,
      surface,
      rawData: v,
      autoFixable: false,
      suggestedFix: { reason: v.reason, matched: v.matched, context: v.context },
    });
  }
}

// PWA
for (const f of glob.sync(path.join(OUT, "pwa/*.json"))) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const surface = `pwa/${path.basename(f, ".json")}`;
  if (j.checks) {
    for (const [k, v] of Object.entries(j.checks)) {
      if (!v) {
        add({
          severity: "P1",
          type: "pwa",
          title: `PWA manifest missing: ${k}`,
          description: `manifest.json check failed: ${k} === false`,
          surface,
          rawData: { check: k },
          autoFixable: false,
        });
      }
    }
  }
  if (Array.isArray(j) && f.endsWith("icons.json")) {
    for (const icon of j) {
      if (icon.status !== 200) {
        add({
          severity: "P0",
          type: "pwa",
          title: `PWA icon 404: ${icon.src}`,
          description: `${icon.src} returned ${icon.status}`,
          surface,
          rawData: icon,
          autoFixable: false,
        });
      }
    }
  }
  if (f.endsWith("og.json") && (!j || j.status !== 200 || j.bytes < 100_000)) {
    add({
      severity: "P2",
      type: "pwa",
      title: `OG image missing or too small`,
      description: `Best candidate had status=${j?.status}, bytes=${j?.bytes}`,
      surface,
      rawData: j,
      autoFixable: false,
    });
  }
}

// Perf — FCP > 2500ms on mobile chromium
for (const f of glob.sync(path.join(OUT, "perf/*.json"))) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  const surface = path.basename(f, ".json");
  if (j.firstContentfulPaint && j.firstContentfulPaint > 2500) {
    add({
      severity: "P2",
      type: "perf",
      title: `Slow FCP on ${surface}: ${Math.round(j.firstContentfulPaint)}ms`,
      description: `FCP exceeded 2500ms threshold (mobile chromium)`,
      surface,
      rawData: j,
      autoFixable: false,
    });
  }
}

// Summary
const byType = bugs.reduce((acc, b) => {
  (acc[b.type] ??= []).push(b);
  return acc;
}, {});
const summary = {
  total: bugs.length,
  p0: bugs.filter((b) => b.severity === "P0").length,
  p1: bugs.filter((b) => b.severity === "P1").length,
  p2: bugs.filter((b) => b.severity === "P2").length,
  p3: bugs.filter((b) => b.severity === "P3").length,
  autoFixable: bugs.filter((b) => b.autoFixable).length,
  blocking: bugs.filter((b) => b.severity === "P0").length,
  byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
};

fs.writeFileSync(
  path.join(OUT, "bugs.json"),
  JSON.stringify({ summary, byType, bugs }, null, 2),
);
console.log("Bug categorization complete:", JSON.stringify(summary, null, 2));
