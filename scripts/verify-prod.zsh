#!/usr/bin/env zsh
# verify-prod.zsh — live-prod truth audit for SmokySignal.
#
# Runs the canonical Playwright audit against https://smokysignal.app
# and writes findings to /tmp/p14-audit/findings.json. This is the gate
# referenced by CLAUDE.md "Verification habits" — "shipped" means a
# feature is observable on prod, not merely that the build is green.
#
# Usage:
#   npm run verify-prod              # default — chromium-mobile project
#   npm run verify-prod -- desktop   # add the chromium-desktop project too
#   ./scripts/verify-prod.zsh        # invoke directly
#
# Exit codes:
#   0 — all assertions pass (or only "indeterminate" ones)
#   1 — at least one finding has pass === false (excluding indeterminate)
#   2 — Playwright run itself failed (env, install, network)

set -euo pipefail

ROOT="${0:A:h:h}"
SPEC="tests/visual/specs/p14-live-prod-audit.spec.ts"
OUT="/tmp/p14-audit"

cd "$ROOT"

if [[ ! -f "$SPEC" ]]; then
  print -u2 "✗ verify-prod: spec missing at $SPEC"
  exit 2
fi

mkdir -p "$OUT"

PROJECTS="--project=chromium-mobile"
if [[ "${1:-}" == "desktop" ]]; then
  PROJECTS="$PROJECTS --project=chromium-desktop"
fi

print "→ Live-prod audit against https://smokysignal.app ($PROJECTS)"
cd tests/visual

# Capture stdout so the summary print survives even if Playwright is noisy.
if ! npx playwright test "specs/p14-live-prod-audit.spec.ts" $PROJECTS --reporter=list 2>&1 | tee /tmp/p14-audit/run.log; then
  print -u2 "✗ verify-prod: Playwright run failed — see /tmp/p14-audit/run.log"
  exit 2
fi

if [[ ! -f "$OUT/findings.json" ]]; then
  print -u2 "✗ verify-prod: spec ran but emitted no findings.json"
  exit 2
fi

# Tally findings. jq isn't always installed; fall back to grep-based count.
PASS_COUNT=0
FAIL_COUNT=0
INDETERMINATE_COUNT=0
if command -v jq >/dev/null 2>&1; then
  PASS_COUNT=$(jq '[.[] | select(.pass==true and .category != "indeterminate")] | length' "$OUT/findings.json")
  FAIL_COUNT=$(jq '[.[] | select(.pass==false)] | length' "$OUT/findings.json")
  INDETERMINATE_COUNT=$(jq '[.[] | select(.category=="indeterminate")] | length' "$OUT/findings.json")
else
  PASS_COUNT=$(grep -c '"pass": true' "$OUT/findings.json" || true)
  FAIL_COUNT=$(grep -c '"pass": false' "$OUT/findings.json" || true)
  INDETERMINATE_COUNT=$(grep -c '"category": "indeterminate"' "$OUT/findings.json" || true)
fi

print ""
print "═══════════════════════════════════════════════"
print "  Live-prod audit complete"
print "═══════════════════════════════════════════════"
print "  pass:          $PASS_COUNT"
print "  fail:          $FAIL_COUNT"
print "  indeterminate: $INDETERMINATE_COUNT (manual visual review needed)"
print ""
print "  Full findings:    $OUT/findings.json"
print "  Screenshots:      $OUT/*.png"
print "═══════════════════════════════════════════════"

if (( FAIL_COUNT > 0 )); then
  print ""
  print "✗ At least one assertion failed. Review screenshots before"
  print "  declaring any related PR shipped."
  exit 1
fi

print "✓ All non-indeterminate assertions pass."
exit 0
