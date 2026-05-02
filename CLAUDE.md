# SmokySignal — Claude Code Guidance

Real-time tracker for Washington State Patrol speed-enforcement aircraft.
Audience: Puget Sound motorcyclists. Brand voice: dark theme, mono numerics,
24-hour clock, no exclamation marks, "Smokey" with E.

## Commands

- `npm run dev` — local dev server
- `npm run build` — production build (must pass before push)
- `npx tsc --noEmit` — type check
- `cd tests/visual && npx playwright test` — visual + coherence specs

## Verification habits

- **"Shipped" means observable on https://smokysignal.app, not green CI.**
  Build-pass + tests-pass is necessary but not sufficient. Conditional
  renders, async race conditions, and feature-flag gates have shipped
  green and stayed dead in prod (e.g. ArmAlertsCallout PR #39 returned
  null while waiting on a SW promise that never resolved on first
  visit). Before claiming a PR ships a feature, capture screenshot or
  DOM evidence from prod after the Vercel auto-deploy completes.
- `npm run verify-prod` runs the canonical live-prod audit
  (`tests/visual/specs/p14-live-prod-audit.spec.ts`) against
  smokysignal.app and writes findings + screenshots to
  `/tmp/p14-audit/`. Add new claims to that spec when you ship a
  user-visible feature, so the next audit catches regressions
  automatically.
- Run `npm run build` before pushing — CI mirrors it.
- Type-check via `npx tsc --noEmit` for fast feedback during edits.
- For UI changes, manually exercise the page in dev — type checks don't
  catch behavioral regressions.
- For radar / map changes, verify on `/radar` with the dev tools console
  open — MapLibre layer errors only show up at render time.
- When generating code that calls a third-party library (Next.js, React,
  MapLibre, web-push, @vercel/kv, @axe-core/playwright, etc.) or
  referencing API surfaces that change across versions, append
  `use context7` to the prompt. Context7 fetches current docs into the
  model's context — beats relying on training-cutoff knowledge.

## Architecture quick-reference

- `lib/snapshot.ts` — fleet snapshot from adsb.fi (primary) + OpenSky (fallback)
- `lib/tracks.ts` — per-tail position history, KV-backed, 35-day TTL
- `lib/hotzones.ts` — 30-day grid aggregate; geo-fenced via `SS_REGION_*` env vars
- `lib/push/*` — VAPID push pipeline (subscribe / dispatcher / dedupe / quiet hours)
- `lib/radar-filter.ts` — shared filter state (operator/tail/region) for /radar
- `lib/user-zones.ts` — rider-defined geofences (localStorage); managed at `/settings/zones`
- `lib/user-prefs.ts` — cookie-backed display prefs (12/24-hour, normal/high contrast)
- `lib/voice-mode.ts` — speechSynthesis readback toggle (foreground only)
- `lib/proximity-alert.ts` — foreground proximity ping when alert-tier tail nearby
- `lib/speed-warning.ts` — pure `evaluateWarning()` for N1a dryrun pipeline
- `lib/storage-keys.ts` — canonical KV key formatter (NX7 foundation; route all `tracks:*`/`spots:*`/`hotzones:*`/`flights:*` through this)
- `components/FilterPanel.tsx` — radar filter UI (extracted from HotZoneLayer P16); multi-select roles supported
- `app/(tabs)/` — main app routes (home, radar, dash, plane, settings, etc.)
- `app/api/cron/` — scheduled refreshes (snapshot, hotzones, predictor)
- `public/sw.js` — service worker (push-only, no caching)

## Privacy posture

- No accounts. Rider-side state lives in localStorage (zones, dismissals,
  region pref, proximity threshold, voice mode) or cookies (time-format
  pref, contrast pref).
- The only server-side identifier is the push subscription endpoint —
  required by Web Push, treated as PII-equivalent in the schema.
- Geolocation is browser-only, never persisted server-side.
- Speed data: device reports it, we do not display or store it.

## Operational notes

- OpenSky historical backfill (`scripts/backfill.ts`) is **deprecated**
  as of 2026-05-02 — the rate-limit window is exhausted on this cred
  and adsb.fi has no historical equivalent. The 30-day track tank fills
  forward via the live cron only. OpenSky is still used as a live
  states-snapshot fallback in `lib/snapshot.ts`.
- Vercel preview-scope env vars for VAPID + ADMIN_PASSCODE are
  intentionally empty — `vercel env pull` cannot decrypt sensitive
  vars from production. Generate fresh values manually if you need
  push to work in preview deploys.
- KV key construction: route through `lib/storage-keys.ts` (`trackKey()`,
  `spotKey()`, `hotzonesCurrentKey()`, etc.) instead of inlining
  string literals like `\`tracks:\${tail}:\${date}\``. The default-region
  shape is byte-for-byte identical to the prior literals; the
  formatter is the only knob for future regional namespacing.
- ArmAlertsCallout returns null on iOS Safari (Notification API
  absent) — that's correct behavior; the IOSInstallPrompt handles
  riders in that path. The verify-prod assertion #9 was updated in
  P16 to recognize either rendered surface as a pass.

## Brand voice

See `lib/brand/` for tokens; see roadmap "Tradeoff conversations" section in
`docs/ROADMAP.md` for the dark-mode-only, no-light-mode, no-emoji decisions.
