# SmokySignal QA dashboard

Operator-facing snapshot of the continuous testing pipeline. Lives at
`/qa-dashboard` (admin-passcode-gated). The pipeline itself runs across
several GitHub Actions workflows; this file is the canonical surface for
"is the operator's eye on the right things?"

## Pipeline surfaces

| Surface | Trigger | Output |
|---|---|---|
| `voice-gate.yml` | every PR | PR comment, fails on P0 violations |
| `persona-walk-pr.yml` | every PR with rider-facing changes | PR comment with consensus + visual diff |
| `persona-walk-nightly.yml` | cron 04:00 PT | 90d artifact, auto-issues for new high-signal findings |
| `triage-finding.yml` | issue opened/labeled | applies `auto-fixable` / `needs-human` / `personalization-gap` |
| `autofix-issue.yml` | issue labeled `auto-fixable` | opens PR with Sonnet-generated diff |
| `close-issue-on-merge.yml` | PR merged | comments back-pointer on linked issues |
| `heartbeat.yml` | cron hourly | KV write — Mac Mini liveness |
| `build.yml` | every PR + push to main | tsc + Next.js build |
| `verify-prod` | manual / pre-push | `tests/visual/specs/p14-live-prod-audit.spec.ts` |

## What lives where

- **Persona files:** `tests/visual/personas/persona-files/persona-*.md` — 9 personas including `low-vision-rider` (P21).
- **Mock state machine:** `lib/mock-state.ts` — `?mock=up|down|eyes-up|multiple|stale|learning|full-data`.
- **Voice rules:** `.github/scripts/voice-gate.mjs` (banned vocab, emoji, exclamation marks). Source of truth: `design/BRAND.md` §3 + §8.
- **Verify-prod spec:** `tests/visual/specs/p14-live-prod-audit.spec.ts` — 19 assertions as of P22.
- **Visual diff:** `.github/scripts/visual-diff.sh` — ImageMagick-based, 5% pixel-ratio threshold.

## Manual checks the dashboard doesn't replace

- Reading the consensus.md from the latest nightly sweep
- Triaging `needs-human` issues
- Skimming a sample of voice-gate comments to recalibrate the rule list
- Periodic spot-check of the auto-fix worker's diffs to confirm they're sane

## Phase-4 v1 scope

This page renders the Mac Mini heartbeat live, plus this static body. Auto-
regeneration of the body from issue counts + workflow run statistics is a
follow-up — the data sources are all reachable (`gh` API, GitHub Actions
runs API, `/api/health`), but wiring them into a live page renderer adds
PR-budget that wasn't load-bearing for v1. Track in
`p22-deferred-dashboard-live-data` if you want the upgrade.
