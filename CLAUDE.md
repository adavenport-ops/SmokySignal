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
- `lib/user-zones.ts` — rider-defined geofences (localStorage)
- `lib/user-prefs.ts` — cookie-backed display prefs (12/24-hour)
- `app/(tabs)/` — main app routes (home, radar, dash, plane, settings, etc.)
- `app/api/cron/` — scheduled refreshes (snapshot, hotzones, predictor)
- `public/sw.js` — service worker (push-only, no caching)

## Privacy posture

- No accounts. Rider-side state lives in localStorage (zones, dismissals,
  region pref) or cookies (time-format pref).
- The only server-side identifier is the push subscription endpoint —
  required by Web Push, treated as PII-equivalent in the schema.
- Geolocation is browser-only, never persisted server-side.
- Speed data: device reports it, we do not display or store it.

## Brand voice

See `lib/brand/` for tokens; see roadmap "Tradeoff conversations" section in
`docs/ROADMAP.md` for the dark-mode-only, no-light-mode, no-emoji decisions.
