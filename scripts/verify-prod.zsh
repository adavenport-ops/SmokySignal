#!/usr/bin/env zsh
# verify-prod.zsh — live-prod truth audit for SmokySignal.
#
# Runs the canonical Playwright audit against https://www.smokysignal.app
# and writes findings to /tmp/p14-audit/findings.json. This is the gate
# referenced by AGENTS.md "Verification habits" — "shipped" means a
# feature is observable on prod, not merely that the build is green.
#
# Usage:
#   npm run verify-prod              # default — chromium-mobile project
#   npm run verify-prod -- desktop   # add the chromium-desktop project too
#   npm run verify-prod -- all       # every chromium project (mobile, tablet, desktop)
#   npm run verify-prod -- webkit    # chromium-mobile + webkit-mobile (options combine: -- all webkit)
#   ./scripts/verify-prod.zsh        # invoke directly
#
# Env:
#   SS_VISUAL_BASE_URL            target (default https://www.smokysignal.app)
#   SS_CHROMIUM_EXECUTABLE_PATH   use an installed Chromium instead of the
#                                 revision @playwright/test expects
#
# Installs tests/visual dependencies on first run (npm ci). It never
# downloads browsers; run `cd tests/visual && npx playwright install chromium`
# yourself if Playwright reports a missing executable.
#
# Exit codes:
#   0 — all assertions pass (or only "indeterminate" ones)
#   1 — at least one finding has pass === false (excluding indeterminate)
#   2 — Playwright run itself failed (env, install, network) or emitted
#       no findings

set -uo pipefail

ROOT="${0:A:h:h}"
SPEC="specs/p14-live-prod-audit.spec.ts"
OUT="/tmp/p14-audit"

cd "$ROOT"

if [[ ! -f "tests/visual/$SPEC" ]]; then
  print -u2 "verify-prod: spec missing at tests/visual/$SPEC"
  exit 2
fi

mkdir -p "$OUT"
# Start clean so a stale findings file from an earlier run is never read.
rm -f "$OUT/findings.json" "$OUT/findings.jsonl" "$OUT"/*.png

PROJECTS=(--project=chromium-mobile)
for opt in "$@"; do
  case "$opt" in
    desktop) PROJECTS+=(--project=chromium-desktop) ;;
    all) PROJECTS+=(--project=chromium-tablet --project=chromium-desktop) ;;
    webkit) PROJECTS+=(--project=webkit-mobile) ;;
    *) print -u2 "verify-prod: unknown option '$opt' (desktop | all | webkit)"; exit 2 ;;
  esac
done
PROJECTS=(${(u)PROJECTS})

cd tests/visual

if [[ ! -d node_modules/@playwright/test ]]; then
  print "→ Installing tests/visual dependencies (npm ci, no browser download)"
  if ! PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund; then
    print -u2 "verify-prod: npm ci failed in tests/visual"
    exit 2
  fi
fi

BASE="${SS_VISUAL_BASE_URL:-https://www.smokysignal.app}"
print "→ Live-prod audit against $BASE (${PROJECTS[*]})"

# Playwright exits non-zero when any test's expect() fails; that is an
# audit failure, reported from the findings below, not a broken run.
npx playwright test "$SPEC" "${PROJECTS[@]}" --reporter=list 2>&1 | tee "$OUT/run.log"
PW_STATUS=${pipestatus[1]}

if [[ ! -s "$OUT/findings.jsonl" ]]; then
  print -u2 "verify-prod: Playwright exited $PW_STATUS and emitted no findings — see $OUT/run.log"
  exit 2
fi

# Rebuild findings.json from every line of this run (workers append to the
# JSONL as they go) and print the table. Node is always present here.
node - "$OUT" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const out = process.argv[2];
const rows = fs
  .readFileSync(path.join(out, "findings.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
fs.writeFileSync(path.join(out, "findings.json"), JSON.stringify(rows, null, 2));
const verdict = (f) => (f.category === "indeterminate" ? "indeterminate" : f.pass ? "pass" : "fail");
const tally = { pass: 0, fail: 0, indeterminate: 0 };
const lines = [];
for (const f of rows) {
  const v = verdict(f);
  tally[v]++;
  lines.push(`${v.padEnd(13)} ${String(f.project).padEnd(17)} ${f.claim.slice(0, 110)}`);
}
lines.sort();
console.log("");
console.log(lines.join("\n"));
fs.writeFileSync(path.join(out, "tally.json"), JSON.stringify(tally));
EOF

PASS_COUNT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pass)' "$OUT/tally.json")
FAIL_COUNT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).fail)' "$OUT/tally.json")
INDETERMINATE_COUNT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).indeterminate)' "$OUT/tally.json")

print ""
print "═══════════════════════════════════════════════"
print "  Live-prod audit complete (playwright exit $PW_STATUS)"
print "═══════════════════════════════════════════════"
print "  pass:          $PASS_COUNT"
print "  fail:          $FAIL_COUNT"
print "  indeterminate: $INDETERMINATE_COUNT (manual review or mock disabled in prod)"
print ""
print "  Full findings:    $OUT/findings.json"
print "  Screenshots:      $OUT/*.png"
print "  Run log:          $OUT/run.log"
print "═══════════════════════════════════════════════"

if (( FAIL_COUNT > 0 )); then
  print ""
  print "At least one assertion failed. Review screenshots before"
  print "declaring any related PR shipped."
  exit 1
fi

print "All non-indeterminate assertions pass."
exit 0
