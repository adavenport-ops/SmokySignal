#!/usr/bin/env node
// Feed-health evaluator for .github/workflows/feed-health.yml.
//
// Reads an /api/health JSON body (file path argument, or stdin) and prints
// {"healthy": bool, "reasons": [...]} to stdout. Always exits 0 on a
// readable input; the workflow decides what to do with the verdict.
// An unparseable body is itself a reason (the endpoint is down or broken).
//
// Rules (any one makes the run unhealthy):
//   - ok is false
//   - snapshot_age_s > 600 (10 min), or missing
//   - feeds.fi.status is not "ok"
//   - kv is not "ok"

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SNAPSHOT_MAX_AGE_S = 600;

/** @param {unknown} body parsed /api/health JSON (or null when unparseable) */
export function evaluateHealth(body) {
  const reasons = [];
  if (body == null || typeof body !== "object") {
    return { healthy: false, reasons: ["/api/health did not return JSON"] };
  }
  const h = /** @type {Record<string, any>} */ (body);
  if (h.ok !== true) reasons.push(`ok is ${JSON.stringify(h.ok)}`);
  const age = h.snapshot_age_s;
  if (typeof age !== "number" || !Number.isFinite(age)) {
    reasons.push("snapshot_age_s missing (no cached snapshot)");
  } else if (age > SNAPSHOT_MAX_AGE_S) {
    reasons.push(`snapshot age ${age}s > ${SNAPSHOT_MAX_AGE_S}s`);
  }
  const fi = h.feeds?.fi?.status;
  if (fi !== "ok") {
    const code = h.feeds?.fi?.error_code ? ` (${h.feeds.fi.error_code})` : "";
    reasons.push(`feeds.fi status is ${JSON.stringify(fi ?? null)}${code}`);
  }
  if (h.kv !== "ok") reasons.push(`kv is ${JSON.stringify(h.kv ?? null)}`);
  return { healthy: reasons.length === 0, reasons };
}

function main() {
  const src = process.argv[2];
  const raw = src ? readFileSync(src, "utf8") : readFileSync(0, "utf8");
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  process.stdout.write(JSON.stringify(evaluateHealth(body)) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
