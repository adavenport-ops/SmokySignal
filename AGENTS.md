# SmokySignal — AGENTS.md

> Canonical operating context for any agent working on SmokySignal. Brain surface at `~/Brain/01-Projects/smokysignal/AGENTS.md`. Voice rules at `~/Dev/SmokySignal/design/BRAND.md` §3 (trucker-CB nostalgia, laconic, no emoji, no exclamation marks, "Smokey" with the e for the bird/agency, "SmokySignal" without for the product).

Real-time tracker for Washington State Patrol speed-enforcement aircraft.
Audience: Puget Sound motorcyclists. Brand voice: dark theme, mono numerics,
24-hour clock, no exclamation marks, "Smokey" with E.

## Commands

- `npm run dev` — local dev server
- `npm run build` — production build (must pass before push)
- `npx tsc --noEmit` — type check
- `npm test` — node:test units (`lib/**/*.test.ts` + `.github/scripts/**/*.test.mjs`)
- `npm run lint` — ESLint flat config (`eslint.config.mjs`, next/core-web-vitals)
- `npm run verify-prod` — live-prod audit (see below)
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
  www.smokysignal.app and writes findings + screenshots to
  `/tmp/p14-audit/` (`findings.json`, `run.log`). `-- desktop` adds
  chromium-desktop, `-- all` runs every chromium project, `-- webkit`
  adds webkit-mobile. It runs `npm ci` in tests/visual on first use but
  never downloads browsers; set `SS_CHROMIUM_EXECUTABLE_PATH` to reuse an
  installed Chromium. Exit 0 = no failures (indeterminate allowed),
  1 = a claim failed, 2 = the run broke. Add new claims to that spec
  when you ship a user-visible feature, so the next audit catches
  regressions automatically.
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

### Continuous testing surfaces (P20 wired)

Four GitHub Actions / spec layers run in addition to `npm run verify-prod`:

- **Voice gate** (`.github/workflows/voice-gate.yml`) — every PR. Pure
  regex/wordlist (no LLM, no auth) checking rider-facing copy against
  `design/BRAND.md` §3+§8. Fails on banned vocab, emoji, exclamation
  marks. Posts P1 nudges as a comment. Source of truth: the rule lists
  in `.github/scripts/voice-gate.mjs` (tests + fixtures beside it;
  "cop" is a whole-word match for cop/cops/copper so "helicopter",
  "copy" and "scope" pass).
- **PR persona walks** (`.github/workflows/persona-walk-pr.yml`) —
  every PR with rider-facing changes. Walks 3 personas (sport-bike-rider,
  skeptic, lurker) × routes inferred from the diff against the Vercel
  preview URL. Posts a single PR comment with the consensus. Requires
  `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` secrets and one of
  `CLAUDE_CODE_OAUTH_TOKEN` (subscription, preferred) /
  `ANTHROPIC_API_KEY`. Auto-skips with a warning when secrets missing.
- **Nightly persona sweep** (`.github/workflows/persona-walk-nightly.yml`)
  — cron 04:00 PT. Full 8-personas × 8-routes sweep against prod,
  uploads 90-day artifact with `consensus.md` + `findings.json`.
- **Findings → issues** (`.github/scripts/findings-to-issues.mjs`,
  invoked at the end of the nightly workflow) — opens one GitHub issue
  per high-signal finding (≥3 personas, no matching open issue).
  Auto-labels by category.

Behavioral persona walks (`tests/visual/personas/behavioral-walks.spec.ts`)
exercise act-and-observe goals (tap, scroll, navigate) and emit a
JSON action log per (persona, route). Run alongside the static specs.

### Mock state machine

`?mock=<state>` query param drives reproducible UI states for QA.
States: `up`, `down`, `eyes-up`, `multiple`, `stale` (snapshot) and
`learning`, `full-data` (forecast). Source: `lib/mock-state.ts`.

**Off in production.** `parseMockState()` returns null whenever
`VERCEL_ENV === "production"` (`mockStatesEnabled()`), so every page and
API that reads it (home, radar, flights, forecast, plane, `/api/aircraft`,
the beacon `/api/status.{txt,json}`, `/board`, `/glance`, `/embed`)
ignores `?mock=` on smokysignal.app. Nobody can share a fake "all clear"
link. It still works under `npm run dev` and on preview deploys; point
specs at those with `SS_VISUAL_BASE_URL=...`. Against prod, p14 claims
that need a mocked state record "indeterminate (mock disabled in prod)",
and claim 62 asserts the gate itself.

## Architecture quick-reference

- `lib/snapshot.ts` — fleet snapshot; `lib/adsb.ts` merges adsb.fi + adsb.lol (+ airplanes.live when `SS_FEED_APL=1`) by ICAO hex via `lib/feed-select.ts` / `lib/feed-merge.ts` (all feeds failing or empty marks the tick degraded); adapters in `lib/feeds/`, rate budget in `lib/feed-budget.ts`, live check `npm run feeds:check`
- `lib/tracks.ts` — per-tail position history, KV-backed, permanent (no TTL since 2026-11-18)
- `lib/track-point.ts` — TrackPoint shape + per-point capture (alt_geom, vertical rate, squawk, MLAT flag, category, NIC/RC, seen_pos, RSSI, callsign, `src` feed tag) via `captureFields()`; rows are normalized once in `lib/feeds/readsb.ts` and merged in `lib/feed-merge.ts`
- `lib/history-core.ts` + `lib/history.ts` — `GET /api/history` (sessions, simplified polylines, heat grid, summary for a PT date range ≤ 366 days)
- `lib/forecast-month.ts` — monthly hour × weekday view on /forecast, folded from `rollup:daily:*`
- `activity:day:{YYYYMMDD}` — permanent per-day activity archive (`lib/activity.ts`), backfilled from `activity:feed` by the rollup cron
- `lib/hotzones.ts` — 30-day grid aggregate; geo-fenced via `SS_REGION_*` env vars
- `lib/push/*` — VAPID push pipeline (subscribe / dispatcher / dedupe / quiet hours)
- `lib/radar-filter.ts` — shared filter state (operator/tail/region) for /radar
- `lib/nav.ts` — the navigation model: six sections (Now, History, Aircraft, Alerts & sharing, Modes, About), active-route matching, NEW badges (`SHIPPED` dates, 14-day window), recently-up. Feeds `components/Sidebar.tsx` (desktop >= 1024px, 240px, collapses to an 80px rail; choice in localStorage `ss:nav-collapsed`, applied to `<html data-ss-nav>` before paint), `components/MoreSheet.tsx` (/about, the phone More tab) and search. `lib/nav-index.ts` — ⌘K palette index + in-house fuzzy scorer (pages with synonyms, settings anchors, corridors, towns, registry tails from `GET /api/nav-index`). Add a page: add it to `navSections()` and, if new, a `SHIPPED` row. `<Related>` / `<Breadcrumbs>` sit at the foot / top of key pages
- `lib/basemap.ts` — shared MapTiler dataviz-dark basemap: pinned greys plus the palette road tint (`RadarPalette.roadTint`), road layers found by `classifyRoadLayer()` (fixture: `lib/fixtures/maptiler-dataviz-dark-layers.json`), repainted in place on a palette pick. Contrast / salience / CVD numbers in `lib/basemap.test.ts`
- `components/Map3DControls.tsx` + `lib/map3d.ts` — rotate / tilt / compass / Orbit cluster in every 3D view (mounted by `components/Flight3D.tsx`); Q/E/W/S keys, Shift-drag tilt, one-time gesture hint. Stamps `data-bearing` / `data-pitch` for QA
- `lib/mission.ts` — mission taxonomy (police = Smokey, federal_le, sar, wildfire, medevac, survey, transport, unknown), legacy role mapper, `countsAsSmokey()` (mutual aid only in WA airspace). Labels in `lib/role-display.ts`
- `lib/circling.ts` (+ `circling-server.ts`) — /circling and /api/circling: airborne tails working a pattern now, plain-language line, mission label. `lib/road.ts` — /road/[id] pass filter (~2 nm of a corridor) and summaries. `lib/coverage.ts` — lost-contact drop-outs into hot-zone cells for /api/coverage and `<CoverageNote/>`. `lib/history-digest.ts` reads 30 days of tracks once (5 min cache) for roads + coverage
- `lib/towns.ts` (the town list, frozen from `selectTowns()`; `npm run towns:check` re-runs it on public `/api/history`) + `lib/town-stats.ts` (passes within ~8 nm, weekday/hour, missions, agencies, roads; folded in `lib/history-digest.ts`) + `lib/town-live.ts` — `/near` and `/near/[town]` ("Plane circling over Puyallup?"), share card `lib/og/town-card.tsx`. Local preview without KV: `SS_DEV_HISTORY_BASE=https://www.smokysignal.app` (non-production only, `lib/dev-history-source.ts`) fills the digest from the public history endpoint
- `lib/share-text.ts` — share lines for a /seen answer, a town page and a finished flight replay; never a coordinate
- `lib/seo/indexnow.ts` + `scripts/indexnow.ts` (`npm run seo:indexnow -- --all | --since <ref> | --urls a,b [--dry-run]`) + `lib/seo/indexnow-server.ts` (daily ping from `/api/cron/rollup`, production only, deduped in `seo:indexnow:submitted`); key served at `public/<key>.txt`
- `lib/seen-view.ts` (client-safe contract, PT time, URL state, copy) + `lib/seen-core.ts` (validation, UTC-day split, closest approach, fold) + `lib/seen.ts` (IO) — /seen "Was that the plane I saw?" and `GET /api/seen`. Rider point rounded to 2 decimals client-side, never logged or stored; non-canonical queries 308 to the rounded URL; share card at `/seen/og`
- `lib/registry-migrate.ts` + `/api/admin/migrate-taxonomy` — KV registry v3→v4 migration (GET = dry run, POST = apply, admin cookie)
- `lib/user-zones.ts` — rider-defined geofences (localStorage); managed at `/settings/zones`
- `lib/user-prefs.ts` — cookie-backed display prefs (12/24-hour, normal/high contrast)
- `lib/voice-mode.ts` — speechSynthesis readback toggle (foreground only)
- `lib/proximity-alert.ts` — foreground proximity ping when alert-tier tail nearby
- `lib/speed-warning.ts` — pure `evaluateWarning()` for N1a dryrun pipeline
- `lib/blog-core.ts` (pure: frontmatter, ordering, JSON-LD, Atom entries) + `lib/blog.ts` (reads `content/blog/YYYY-MM-DD-slug.md`) — `/blog`, `/blog/[slug]` (SSG), `/blog/[slug]/og`, `/blog/feed.xml`. Weekly posts: `npm run blog:weekly -- --week-ending YYYY-MM-DD [--dry-run] [--force]` (`scripts/blog-weekly.ts`, core in `lib/blog-weekly.ts`), reads public `/api/history`, merged PRs via `gh`, and the `## This week` pick in `docs/BACKLOG.md`. Screenshots and clips in posts: `npm run blog:media -- --post <slug> [--only <id>]` (`scripts/blog-media.ts`, pure core + step DSL in `lib/blog-media-core.ts`) reads `content/blog/media/<slug>.json`, writes `public/blog/media/<slug>/` (WebP + PNG, MP4 + WebM + poster, `manifest.json`), budget 1.5 MB per clip rendition and 12 MB per post; `![alt](/blog/media/<slug>/<id>.webp|.mp4 "caption")` renders a figure (clips via `components/BlogVideo.tsx`). Flow: `docs/BLOG.md`
- `lib/bots/*` — Telegram DM alerts (read aloud in-car), Discord `/smokey`, Bluesky autopost. Env-gated, 503 `not_configured` until set; `dispatchBots()` rides the push `waitUntil` in `lib/activity.ts`. Setup: `docs/bots.md`
- `lib/storage-keys.ts` — canonical KV key formatter (NX7 foundation; route all `tracks:*`/`spots:*`/`hotzones:*`/`flights:*` through this)
- `components/FilterPanel.tsx` — radar filter UI (extracted from HotZoneLayer P16); multi-select roles supported
- `app/(tabs)/` — main app routes (home, radar, flights, plane, settings, etc.; /dash and /activity redirect to /flights)
- `app/api/cron/` — scheduled refreshes (snapshot, hotzones, predictor)
- `public/sw.js` — service worker (push + minimal offline shell: `/offline`, hashed chunks, icons; never API JSON or HTML)
- `lib/seo/*` — SEO / GEO: `pageMeta()` (title, description, canonical, OG, Twitter in one call), JSON-LD builders + validator, registry-computed Key facts, llms.txt bodies, sitemap assembly, audit parsers. Routes: `app/sitemap.ts`, `app/robots.ts`, `app/llms.txt`, `app/llms-full.txt`. Weekly audit `npm run seo:audit`; how to add metadata for a new page: `docs/seo/PLAYBOOK.md`
- `app/embed` (framable status widget, only path with `frame-ancestors *`), `app/glance` (handlebar screen), `app/calendar.ics` (busy-window feed), `lib/ics.ts`, `lib/glance.ts`, `lib/embed.ts`

## Privacy posture

- No accounts. Rider-side state lives in localStorage (zones, dismissals,
  region pref, proximity threshold, voice mode) or cookies (time-format
  pref, contrast pref).
- The only server-side identifier is the push subscription endpoint —
  required by Web Push, treated as PII-equivalent in the schema.
- Telegram bot: chat id + filters only, keyed by a hash of the chat id
  (raw id inside the record). PII-equivalent, same footing as a push
  endpoint. `/stop` deletes it.
- Geolocation is browser-only, never persisted server-side.
- Speed data: device reports it, we do not display or store it.

## Operational notes

- OpenSky was removed 2026-11 (integration, backfill scripts and
  `OPENSKY_*` env vars). adsb.fi has no historical equivalent, so the
  track tank fills forward via the live feeds only. Stored points tagged
  `src: "os"` stay readable (`StoredFeedSrc` in `lib/types.ts`).
- Data sources: adsb.fi + adsb.lol merged by ICAO hex (#153),
  airplanes.live behind `SS_FEED_APL=1`. Track history is permanent:
  `tracks:*` daily keys have no TTL since 2026-11-18 (#149; the legacy
  35-day TTL was stripped).
- Snapshot cadence: the helm launchd pinger (`scripts/helm-pinger/`,
  #138) hits `/api/cron/refresh-snapshot` every 30s; the Vercel cron in
  `vercel.json` is daily only (Hobby). Liveness is the snapshot age:
  `/api/health` reports `snapshot_age_s` and `last_refresh_age_s`. The
  GitHub `heartbeat.yml` workflow (and `last_heartbeat_*` fields) was
  retired; it never had its KV secrets.
- Feed-down alerting: `.github/workflows/feed-health.yml` (hourly) reads
  `/api/health` and opens one `infra-alert` issue when `ok` is false,
  `snapshot_age_s` > 600, `feeds.fi` is not ok, or `kv` is not ok, then
  closes it on recovery. Rules: `.github/scripts/feed-health.mjs`.
  `deploy-watchdog.yml` covers failed prod deploys.
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
