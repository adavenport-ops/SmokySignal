#!/usr/bin/env node
// Map a list of changed file paths (stdin, one per line) to the route
// subset that should be walked for this PR. Emits a comma-separated
// route name list to stdout.
//
// Mapping:
//   app/(tabs)/<X>/page.tsx → /X (or / for the root)
//   components/*.tsx        → all routes (broad change)
//   lib/*                   → all routes (broad)
//   app/api/*               → all routes (API surfaces affect what pages render)
// Anything outside those globs is ignored — the workflow returns the
// empty string and the caller skips the walk.

import { readFileSync } from "node:fs";

const ALL_ROUTES = ["home", "radar", "forecast", "activity", "about", "legal", "help", "plane-N305DK"];

// Tab-to-route-name lookup. The "name" field is what run-walk.ts expects
// in --routes (matches tests/visual/personas/run-walk.ts ROUTES).
const TAB_TO_NAME = new Map([
  ["radar", "radar"],
  ["forecast", "forecast"],
  ["activity", "activity"],
  ["about", "about"],
  ["legal", "legal"],
  ["help", "help"],
  // /plane/[tail] is dynamic — represent any change as the canonical
  // example tail used by the verify-prod spec.
  ["plane", "plane-N305DK"],
]);

const paths = readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const routes = new Set();
let broad = false;

for (const p of paths) {
  if (p.startsWith("components/") && p.endsWith(".tsx")) broad = true;
  else if (p.startsWith("lib/") && (p.endsWith(".ts") || p.endsWith(".tsx"))) broad = true;
  else if (p.startsWith("app/api/")) broad = true;
  else if (p === "app/(tabs)/page.tsx") routes.add("home");
  else if (p === "app/layout.tsx") broad = true;
  else {
    const m = /^app\/\(tabs\)\/([^/]+)\//.exec(p);
    if (m) {
      const name = TAB_TO_NAME.get(m[1]);
      if (name) routes.add(name);
    }
  }
}

const final = broad ? ALL_ROUTES : Array.from(routes);
process.stdout.write(final.join(",") + "\n");
