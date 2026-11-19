#!/usr/bin/env node
// `npm test` entry point. Collects every lib/**/*.test.ts file plus the CI
// script tests (.github/scripts/**/*.test.mjs) and hands the explicit list
// to `tsx --test`.
//
// Why not `tsx --test lib/**/*.test.ts` in package.json: npm runs scripts
// through /bin/sh, which has no `**`, so the unquoted glob silently skips
// lib/*.test.ts. Quoting it defers expansion to node:test, which only
// understands globs from Node 21 on, and CI runs Node 20.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function collect(dir, suffix) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...collect(p, suffix));
    else if (name.endsWith(suffix)) out.push(p);
  }
  return out;
}

const files = [
  ...collect("lib", ".test.ts"),
  ...collect(join(".github", "scripts"), ".test.mjs"),
].sort();
if (files.length === 0) {
  console.error("run-tests: no lib/**/*.test.ts files found");
  process.exit(1);
}

const r = spawnSync("npx", ["tsx", "--test", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);
