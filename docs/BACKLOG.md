# SmokySignal backlog

A ranked, living list. The weekly job on helm reads it, and so do people.
Seeded 2026-11-18 from `docs/AUDIT-2026-11.md` plus the items the audit
named that are not built yet. Rank is rider value over cost; re-rank freely.

## How the weekly job uses this file

1. On its run, the job picks the highest-ranked item marked
   **One weekly run: yes** that is not blocked (no **Blocked:** line), and moves it under
   `## This week` (keep the whole item, fields and all).
2. It builds that item on a branch and opens a PR.
3. `npm run blog:weekly -- --week-ending YYYY-MM-DD` prints the first item
   under `## This week` as the post's "Feature of the week", using its
   **Blog line**. Leave `## This week` empty (only the placeholder line)
   when nothing was picked.
4. Once the PR merges, the job moves the item to `## Shipped` as one line:
   `- YYYY-MM-DD · B0x · Title · #PR`, newest at the top.

Item fields: id, title, **Route** (optional: the in-app path that shows
it, e.g. `/road/i-5`; the weekly post's screenshots are taken there),
**Why** (rider value), **Size** (S = one sitting,
M = a few days, L = a project), **One weekly run** (yes when it fits one
automated run end to end), **Files** (likely touched), **Acceptance**, and
**Blog line** (one sentence for the weekly post, brand voice: no emoji, no
exclamation marks, none of the voice-gate words).

## This week

_Nothing picked yet._

## Roadmap

The plan and its reasoning are in `docs/PLAN-2027.md` (personas, the national
database, activity rule, drones, rollout and marketing to June 2027). The
ranked order below follows it: feedback fixes and the activity rule first,
then tail-based national tracking and the registry pipeline, then dossiers,
agency and state pages, then the May 2027 national launch.

## Ranked

### B20 · Speed warning range setting
- **Why:** Rider feedback (2026-11-19): the warning fired with the plane "still miles away". Let riders pick how close counts.
- **Route:** `/settings`
- **Size:** S
- **One weekly run:** yes
- **Files:** `lib/speed-warning.ts`, `lib/speed-warning-prefs.ts`, `components/SpeedWarning.tsx`, `components/SpeedWarningSettings.tsx`
- **Acceptance:** Settings › Speed warning offers 2, 3 or 5 nm (default 5, shown in miles too); evaluateWarning uses the pick; node:test covers each radius and the stored-value guard.
- **Blog line:** The speed warning now lets you choose how close the bird has to be before it speaks up.

### B21 · Alerts-reset nudge
- **Why:** The 2026-11-19 store overwrite dropped every push subscription. /api/push/resync brings back browsers that still hold one; riders whose browser dropped it too see nothing and never know alerts stopped.
- **Route:** `/`
- **Size:** S
- **One weekly run:** yes
- **Files:** `components/SwRegistrar.tsx`, `components/AlertsStateChip.tsx`, a new `components/AlertsResetBanner.tsx`
- **Acceptance:** when Notification.permission is "granted" but the browser has no push subscription, home shows one dismissible line, "Alerts were switched off by an update. Turn them back on", and one tap re-subscribes; never shown when permission is default or denied; dismissal remembered 30 days.
- **Blog line:** If an update switched your alerts off, the app now says so and puts them back in one tap.

### B22 · iPhone setup page
- **Why:** Rider feedback: location failed in Safari until they added the app to the home screen. iPhone needs three settings right (home screen, location, notifications) and nothing explains them in one place.
- **Route:** `/help/iphone`
- **Size:** S
- **One weekly run:** yes
- **Files:** a new `app/(tabs)/help/iphone/page.tsx`, `lib/nav.ts`, `components/IOSInstallPrompt.tsx`, `lib/seo/*`
- **Acceptance:** one page with the steps (Add to Home Screen, Location Services › Safari Websites › While Using, allow notifications, Voice readback); linked from the iOS install prompt, the location-blocked toast and /about; in the sitemap; screenshots optional.
- **Blog line:** A one-page iPhone setup guide: home screen, location and alerts, in that order.

### B23 · Alert earcon before voice
- **Why:** Helmet coms (Cardo, Sena) duck or clip the first half second of phone audio, so spoken alerts lose their first word. A short tone wakes the channel, and different tones tell up, near and clear apart without words.
- **Route:** `/settings/alerts`
- **Size:** S
- **One weekly run:** yes
- **Files:** `lib/voice-mode.ts`, `lib/proximity-alert.ts`, `components/AlertsSettings.tsx`, `public/sounds/*`
- **Acceptance:** with voice readback on, each spoken alert is preceded by a short tone (Web Audio, generated, no assets over 20 KB); three distinct tones for bird up, bird near, all clear; a toggle to turn tones off; works after the first user gesture on iOS.
- **Blog line:** Spoken alerts now start with a short tone, so your coms are awake before the words arrive.

### B24 · Lock-screen alert copy
- **Why:** Push is what reaches a locked phone and, on some setups, the helmet. The text should read well on a lock screen and when Siri announces it: who, how far, which road.
- **Size:** S
- **One weekly run:** yes
- **Files:** `lib/push/dispatcher.ts`, `lib/push/types.ts`, `public/sw.js`, `lib/push/*.test.ts`
- **Acceptance:** titles lead with the nickname and distance band ("Smokey 4 up · 6 mi from your zone"); bodies name the nearest corridor when known; updates for the same flight replace the previous notification (same tag, renotify) instead of stacking; tests pin the copy and the tag rules; voice gate passes.
- **Blog line:** Alerts on a locked phone now say who, how far and which road, and update in place instead of piling up.

### B39 · Activity status: show only active aircraft
- **Why:** As the registry grows nationally, most tails will be idle on any given day. Lists, alerts and the speed warning should only carry aircraft that are actually flying this season.
- **Route:** `/aircraft`
- **Size:** S
- **One weekly run:** yes
- **Files:** a new `lib/activity-status.ts`, `lib/registry.ts`, `app/(tabs)/aircraft/page.tsx`, `lib/push/dispatcher.ts`, `lib/speed-warning.ts`, `lib/history-digest.ts`
- **Acceptance:** rule, pure and tested: on first discovery an aircraft is active only if it flew in the last 30 days; any flight makes it active at once; 60 days without a flight hides it from lists, alerts and the warning; its page stays, marked "last flew YYYY-MM-DD"; last-flight time comes from stored tracks (cached daily by the rollup cron); /aircraft has a "show inactive" toggle.
- **Blog line:** The aircraft list now shows who is actually flying; tails idle for two months step back until they fly again.

### B31 · State registry pipeline
- **Why:** The Washington list (`data/wa-gov-aircraft.json`) was built by hand from the FAA registry. New states need the same, repeatably: every aircraft registered to a state patrol, sheriff or city police, with sources.
- **Size:** M
- **One weekly run:** yes
- **Files:** a new `scripts/registry-state.ts`, `data/gov-aircraft/<st>.json`, `lib/seed.ts` (load per state), `lib/icao.ts`
- **Acceptance:** `npm run registry:state -- --state OR` pulls FAA registry rows by owner name patterns, maps N-number to hex, classifies mission (police vs other) with a source per row, and writes the JSON; WA output matches today's list; docs on reviewing a new state.
- **Blog line:** A repeatable way to list every patrol aircraft in a state, with a source on every row.

### B25 · Ride mode
- **Why:** Rider question: "Does it have an audible notification you can hear in your coms?" Voice readback only speaks while the page is open. Ride mode makes that the default state for a ride: screen awake, voice on, glance view.
- **Route:** `/glance`
- **Size:** M
- **One weekly run:** yes
- **Files:** `app/glance/*`, `components/ScreenAwake.tsx`, `lib/voice-mode.ts`, `lib/nav.ts`, `components/Sidebar.tsx`
- **Acceptance:** a Ride mode button on home and /glance turns on wake lock, voice readback and the glance layout in one tap (one user gesture primes audio on iOS); a visible "Riding" state with an exit; it says plainly that the phone must stay unlocked; p14 claim added.
- **Blog line:** Ride mode: one tap keeps the screen on and reads alerts into your helmet.

### B26 · Spoken updates while riding
- **Why:** In ride mode the rider wants the plane's movement without looking: "Smokey 4, 3 miles north, closing".
- **Size:** M
- **One weekly run:** yes
- **Files:** `lib/voice-mode.ts`, a new `lib/ride-callouts.ts`, `app/glance/*`
- **Acceptance:** in ride mode, a nearby police-mission aircraft gets a spoken callout on entry, every N minutes (rider picks 2, 5 or off) and on leaving ("Smokey 4 clear"); bearing in clock or compass words; pure callout planner tested; never speaks more than once a minute.
- **Blog line:** In ride mode the app calls the bird out by distance and direction, and tells you when it is clear.

### B27 · Telegram go-live and locked-phone audio guide
- **Why:** The only path that speaks with the phone locked is a messaging app the phone reads aloud (iPhone Announce Notifications, CarPlay, Android Auto). The Telegram bot is built and waits for a token.
- **Size:** S
- **One weekly run:** yes
- **Blocked:** needs `TELEGRAM_BOT_TOKEN` in Vercel (Alex, via @BotFather)
- **Files:** `lib/bots/telegram*`, `docs/bots.md`, a new section on `/help/iphone`
- **Acceptance:** webhook registered, /start and /stop work on prod, a test alert arrives; help text explains turning on Announce Notifications for Telegram on iPhone and Android Auto; p14 claim for the bot status endpoint.
- **Blog line:** Want alerts read into your helmet with the phone locked: the Telegram bot does that now.

### B30 · Multi-state spike: track by tail, not by circle
- **Why:** Feeds are queried as one circle around Washington. Adding states by adding circles multiplies requests. Most feeds can be asked for a list of transponder codes instead, which scales with the registry, not the map.
- **Size:** S
- **One weekly run:** yes
- **Files:** a new `docs/adr/ADR-multi-state-tracking.md`, `scripts/feeds-check.ts`
- **Acceptance:** for adsb.fi, adsb.lol and airplanes.live, record whether a multi-hex query exists, its batch size and rate limits (tested live, read-only); measure a tick for 60 and 300 hexes; ADR picks hex lists, circles or a mix (circle for discovery near the home region, hex list nationally) with the request budget per tick.
- **Blog line:** Behind the scenes: the groundwork for tracking state patrol aircraft beyond Washington.

### B28 · Nightly archive reconcile
- **Why:** Live feeds drop points (receiver gaps, timeouts), which split flights and leave holes. adsb.lol publishes a complete daily archive; merging it nightly makes history complete. It also rebuilt the record after the 2026-11-19 wipe.
- **Size:** M
- **One weekly run:** yes
- **Files:** `scripts/backfill-adsblol.ts`, a new `lib/archive-reconcile.ts`, `scripts/helm-pinger/*` or a helm launchd job, `docs/`
- **Acceptance:** a helm job runs daily after the archive appears, fills gaps inside existing days (not only empty keys) without duplicating points, then triggers the rollup; logs per-day counts; a dry-run flag; tests cover the merge (dedupe within 15 s, ordering).
- **Blog line:** Every night the log now cross-checks against a full public archive, so flights no longer have holes where a receiver blinked.

### B29 · Flight split audit
- **Why:** After the backfill, one tail showed 6 flights for a week where the live log had 30. Gaps were splitting flights. Measure and tune the session rules on complete data.
- **Size:** S
- **One weekly run:** yes
- **Files:** `lib/flights.ts`, `lib/history-core.ts`, `lib/rollup-core.ts`, tests
- **Acceptance:** a script compares session counts from archive-complete days against the live-only period; gap and ground thresholds tuned so a fuel stop is two flights and a receiver gap is one; before and after counts in the PR.
- **Blog line:** Flight counts are more honest now: a receiver gap no longer turns one flight into three.

### B40 · Aircraft dossiers
- **Why:** Every aircraft page should answer what people search: whose plane, based where, what type, how often it flies, with sources. It is the core of SEO and AI answers, and nobody else publishes it.
- **Route:** `/plane/[tail]`
- **Size:** M (pipeline), then S per batch
- **One weekly run:** yes
- **Blocked:** needs B31
- **Files:** a new `data/dossiers/<tail>.json`, a new `scripts/dossier.ts`, `app/(tabs)/plane/[tail]/page.tsx`, `lib/seo/*`
- **Acceptance:** per active aircraft: agency and unit, base airport derived from its own takeoffs, type and year, FAA registration date, flights and hours per month, usual roads and hours, two to five public facts each with a source URL; agency and aircraft facts only, never individual crew; JSON-LD on the page; a review checklist in `docs/`.
- **Blog line:** Every aircraft page now tells its story: who flies it, from where, how often, with sources.

### B42 · Agency pages
- **Why:** "Does [county] sheriff have a plane" and "does [state] patrol use aircraft for speeding" are real searches. One page per agency answers both.
- **Route:** `/agency/[slug]`
- **Size:** M
- **One weekly run:** yes
- **Blocked:** needs B31
- **Files:** a new `app/(tabs)/agency/[slug]/page.tsx`, `lib/agencies.ts`, `lib/seo/*`, `app/sitemap.ts`
- **Acceptance:** fleet (active first), activity per month, where it flies (from tracks), aerial speed enforcement status with source, drone program (B41); JSON-LD GovernmentOrganization; in the sitemap; linked from aircraft and state pages.
- **Blog line:** Every agency we track has its own page: fleet, activity and sources.

### B41 · Police drone programs by agency
- **Why:** Agencies are adding drones fast, and riders and locals ask about them. Police drones rarely broadcast ADS-B and Remote ID is local radio, so there is no live feed, but which agencies run drone programs is public.
- **Size:** M
- **One weekly run:** yes
- **Blocked:** needs B42 (where it shows)
- **Files:** a new `data/drone-programs.json`, a new `scripts/drone-programs.ts`, agency pages (B42)
- **Acceptance:** import EFF's Atlas of Surveillance drone entries (CC BY, attributed), add FAA waiver or authorization records and council or news sources where found; per agency: program yes/no, since when, drone-as-first-responder yes/no, source; shown on agency and state pages; no live drone positions claimed.
- **Blog line:** Agency pages now say which departments fly drones, since when, and where that comes from.

### B34a · Home state picker
- **Size:** S
- **One weekly run:** yes
- **Acceptance:** a home-state choice (cookie, like the time-format pref) with Washington as default and the only populated option; region config table (code, name, centre, bounds, feeds) in one file; no behaviour change for existing riders; tests.
- **Blog line:** You can tell the app your home state now. Washington is the only one lit, for now.

### B34b · Feeds per region
- **Size:** M
- **One weekly run:** yes
- **Acceptance:** each snapshot tick covers every enabled region within the B30 budget; the snapshot carries a region per aircraft; KV keys for non-WA regions go through regionPrefix; WA keys unchanged byte for byte; health reports per-region freshness.
- **Blog line:** Behind the scenes: the feeds can now watch more than one state at a time.

### B34c · Region-scoped history, hot zones, forecast and alerts
- **Size:** M
- **One weekly run:** yes
- **Acceptance:** /, /radar, /forecast, /stats and push alerts read the rider's home state; a state switcher; WA unchanged; p14 claims for one non-WA region on a preview deploy.
- **Blog line:** Each state gets its own sky: hot zones, history, forecast and alerts.

### B43 · National map and every-state pages
- **Why:** The goal is every state. Once tracking is by tail (B30) and registries are pulled (B31), each state can show its active aircraft without a hand-built region.
- **Route:** `/states`
- **Size:** M
- **One weekly run:** yes
- **Blocked:** needs B30, B31, B39
- **Files:** a new `app/(tabs)/states/page.tsx`, `app/(tabs)/state/[st]/page.tsx`, `lib/seo/*`
- **Acceptance:** a national map of active police aircraft; one page per state (active fleet, agencies, aerial enforcement status with sources, drone programs); a state with none says so plainly; sitemap and llms.txt updated.
- **Blog line:** All 50 states are on the map now, each with its own page.

### B32 · Research check: confirm the next states
- **Why:** The 2026-11 research (`docs/research/us-police-aircraft-2026-11.md`) is mostly secondary sources. Confirm before building: who flies, how often, and whether they broadcast.
- **Size:** S
- **One weekly run:** yes
- **Files:** `docs/research/`
- **Acceptance:** run the B31 pipeline for OR, ID, CO, OH, MO, MN, FL; sample the live feeds by hex for 7 days; a table of tails found, hours airborne and share hidden (LADD or PIA); a recommended launch order.
- **Blog line:** We checked which states' patrol aircraft actually fly and broadcast, before promising any.

### B33 · Infra check before more states
- **Why:** More states means more KV, more requests per tick and more push fan-out on a Vercel Hobby plan and one helm pinger.
- **Size:** S
- **One weekly run:** yes
- **Files:** `docs/ops/`, `lib/feed-budget.ts`
- **Acceptance:** projected KV size, requests per day per feed, function invocations and push volume for 1, 3 and 8 states; the point at which Vercel Pro or a second pinger is needed; Upstash daily backup confirmed on.
- **Blog line:** Behind the scenes: sizing the plumbing before the map gets bigger.

### B34 · Region model: states as first-class
- **Why:** Everything assumes one region. States need their own home view, hot zones, history, forecast and alerts, without breaking Washington URLs.
- **Size:** L (split into B34a to B34c)
- **One weekly run:** no
- **Files:** `lib/storage-keys.ts` (regionPrefix exists), `lib/feeds/region.ts`, `lib/hotzones.ts`, `lib/history*.ts`, `lib/forecast*.ts`, `lib/push/*`
- **Acceptance:** see B34a to B34c.
- **Blog line:** SmokySignal can hold more than one state now.

### B35 · Oregon and Idaho launch
- **Why:** Riders cross the Columbia and the Idaho line all season, and those fleets already show up as mutual aid.
- **Route:** `/state/or`
- **Size:** M
- **One weekly run:** yes
- **Blocked:** needs B31, B34a to B34c and the B32 check
- **Acceptance:** OR and ID registries reviewed and loaded; both selectable; state landing pages with sourced facts; SEO and llms.txt updated; blog post.
- **Blog line:** Oregon and Idaho are on the map now, with their own skies and alerts.

### B37 · State landing pages and SEO
- **Why:** Riders search "aircraft speed enforcement [state]". Each state should have a page that answers it with sourced facts.
- **Route:** `/state/<st>`
- **Size:** S each
- **One weekly run:** yes
- **Blocked:** needs B34a
- **Files:** a new `app/(tabs)/state/[st]/page.tsx`, `lib/seo/*`, `app/sitemap.ts`
- **Acceptance:** per state: status of aerial enforcement with sources, fleet table, where signs are posted when known, link to the live view; JSON-LD; in the sitemap; SEO audit with 0 P0.
- **Blog line:** Every state we cover gets a plain page on how its patrol uses aircraft, with sources.

### B44 · Monthly data report
- **Why:** Journalists and aviation fans want numbers; a monthly post with sourced counts earns links and repeat visits.
- **Route:** `/blog`
- **Size:** S
- **One weekly run:** yes
- **Blocked:** needs B39
- **Files:** a new `scripts/blog-monthly.ts`, `lib/blog-monthly.ts`
- **Acceptance:** `npm run blog:monthly -- --month YYYY-MM` drafts a post: active aircraft by state, busiest aircraft and agencies, hours flown, new and newly idle tails, method note; draft only, a person edits before publishing.
- **Blog line:** A monthly report: who flew, how much, and where, across every state we track.

### B36 · Next state launches (one per run)
- **Why:** Ranked by the 2026-11 research: Colorado, Ohio, Missouri, Minnesota, Florida, then Pennsylvania, South Dakota and Nebraska. All run active aerial speed programs; the order is set by B32's numbers.
- **Route:** `/state/<st>`
- **Size:** M each
- **One weekly run:** yes (one state per run)
- **Blocked:** needs B35 shipped
- **Acceptance:** per state: registry reviewed, region config, landing page, sitemap, llms.txt facts, IndexNow, blog paragraph; nothing launches with fewer than 3 confirmed police aircraft broadcasting.
- **Blog line:** [State] is live: its patrol aircraft, hot roads and alerts.

### B38 · Proximity tiers
- **Why:** One threshold is either too chatty or too late. Two tiers (heads-up farther out, close nearer in) match how riders react.
- **Size:** M
- **One weekly run:** yes
- **Files:** `lib/proximity-alert.ts`, `lib/push/dispatcher.ts`, `components/AlertsSettings.tsx`
- **Acceptance:** riders set a heads-up and a close distance; different push copy, voice phrasing and earcon per tier; each tier fires once per pass; tests.
- **Blog line:** Alerts come in two steps now: a heads-up when the bird is in the area, and a closer call when it is near.

### B01 · Corridor push alerts
- **Why:** Riders care about their road, not the whole state. "Smokey up over SR-512" beats "Smokey up somewhere in WA".
- **Size:** M
- **One weekly run:** no (push prefs schema, dispatcher matching and the alerts UI)
- **Files:** `lib/push/types.ts`, `lib/push/validate.ts`, `lib/push/dispatcher.ts`, `lib/corridor.ts`, `app/(tabs)/settings/alerts/page.tsx`, `components/AlertsSettings.tsx`
- **Acceptance:** a rider can pick one or more corridors in /settings/alerts; a takeoff or a pass within 2 nm of a picked corridor pushes, others do not; legacy prefs without corridors behave as before; node:test covers matching and validation.
- **Blog line:** Alerts can follow your road now: pick I-5 or SR-167 and you only hear about the bird over it.

### B02 · Radar coverage layer and legend (#75, #76)
- **Why:** The map has no legend, and a quiet patch can mean unheard, not empty. Riders should know what each colour means and where the receivers go deaf.
- **Size:** M
- **One weekly run:** no (radar components are shared with other work; needs a design pass)
- **Files:** `components/RadarMap.tsx`, `components/RadarShell.tsx`, `lib/coverage.ts`, `app/api/coverage/route.ts`, a new `components/RadarLegend.tsx`
- **Acceptance:** a LEGEND control explains heat, routes, trails, rings and live glyphs; an optional COVERAGE layer shades cells with frequent lost contact; the geofence button explains itself when disabled (#76); closes #75 and #76.
- **Blog line:** The radar has a legend now, and a coverage layer that shows where low flights tend to drop off the receivers.

### B03 · Weather line
- **Why:** A low ceiling or high wind explains a quiet morning before a rider wonders whether the app is broken.
- **Size:** S
- **One weekly run:** yes
- **Files:** a new `lib/weather.ts` (pure parse plus fetch of a public METAR source for KOLM, KBFI, KTIW, KPAE), `components/Glanceable.tsx` (one line under the hero), `app/api/weather/route.ts` (cached 10 min)
- **Acceptance:** home shows one mono line such as `KBFI 1,200 OVC · WIND 18G26`; it hides itself when the source fails; history framing only, never a prediction of whether the bird will fly; node:test for the parser.
- **Blog line:** A one-line ceiling and wind read under the hero, so a gray, gusty morning explains a quiet sky.

### B04 · Signature moment: bird-up takeover
- **Why:** The moment Smokey goes up should read across a parking lot: full-bleed orange edge, a 96 px readout, a needle toward the bird.
- **Size:** S
- **One weekly run:** yes
- **Files:** `components/Glanceable.tsx`, `components/StatusPill.tsx`, a new `components/BirdUpTakeover.tsx`, `lib/tokens.ts` (read only)
- **Acceptance:** shows for 8 s on an up transition while the page is visible, then settles to the normal hero; respects reduced motion; orange only on up; verified with `?mock=up` in dev.
- **Blog line:** When the bird goes up, the home screen says so edge to edge, then gets out of the way.

### B05 · Signature moment: radar sweep
- **Why:** An idle map looks frozen. A slow CB-radio sweep says the receiver is live without adding noise.
- **Size:** S
- **One weekly run:** yes, once B02 has landed (radar files)
- **Files:** `components/RadarMap.tsx` (one overlay layer), `lib/radar-zoom.ts`
- **Acceptance:** a faint sweep every 8 s when nothing is up and the tab is visible; off under reduced motion; never orange; no extra network requests.
- **Blog line:** The radar sweeps now when the sky is quiet, so you can tell it is listening.

### B06 · Accessibility v2
- **Why:** A live status sentence for screen readers, reduced motion everywhere, and large-text layouts that hold together for riders who need them.
- **Size:** M
- **One weekly run:** no
- **Files:** `components/Glanceable.tsx`, `components/StatusPill.tsx`, `app/globals.css`, `tests/visual/specs/a11y.spec.ts`
- **Acceptance:** an `aria-live="polite"` status sentence on home and /glance; all motion honours prefers-reduced-motion; 200 % text zoom has no clipped controls on the five tabs; axe clean.
- **Blog line:** The status now reads itself to screen readers, and the app holds together at double text size.

### B07 · Route loading and error states
- **Why:** A blank screen on a bad connection reads as "all clear". Riders need "no signal, last update 14:02" instead.
- **Size:** S
- **One weekly run:** yes
- **Files:** new `app/(tabs)/loading.tsx`, `app/(tabs)/error.tsx`, `app/(tabs)/radar/loading.tsx`, `components/FreshnessLabel.tsx`
- **Acceptance:** each tab shows a skeleton while loading and a calm error with retry; the error never shows an up or clear state; verified by throttling in dev.
- **Blog line:** Lose signal mid-ride and the app says so plainly, with the time of the last good read.

### B08 · Ride check
- **Why:** "What flew over my route last Sunday?" without the route ever leaving the phone.
- **Size:** M
- **One weekly run:** no
- **Files:** a new `app/(tabs)/ride/page.tsx`, `lib/ride-check.ts` (pure, on device), `GET /api/history` (read only)
- **Acceptance:** a rider draws or picks a route from corridors; matching happens in the browser against /api/history; nothing about the route is sent or stored; history framing only.
- **Blog line:** Ride check lays your route over what flew, and the route never leaves your phone.

### B10 · Desktop ops console
- **Why:** At 1280 px and up the app is still a stretched phone. A roster, a central map and a radio-log ticker use the room.
- **Size:** L
- **One weekly run:** no
- **Files:** `app/(tabs)/page.tsx`, a new `components/OpsConsole.tsx`, `components/ActivityFeed.tsx`
- **Acceptance:** at ≥ 1280 px home shows a fleet roster with uptime sparklines, the live map, a mono event ticker and a 24 h timeline strip; phones unchanged.
- **Blog line:** On a big screen, home is an ops console now: roster, map and a running radio log.

### B11 · Shared aircraft poller and CDN caching
- **Why:** Every open tab polls on its own. One shared poller and proper `s-maxage` cut load and keep a busy Saturday fast.
- **Size:** M
- **One weekly run:** no
- **Files:** a new `lib/hooks/useAircraft.ts`, `components/DashShell.tsx`, `components/RadarShell.tsx`, `app/api/aircraft/route.ts`, `app/api/activity/route.ts`
- **Acceptance:** one poll per tab, paused when hidden; healthy aircraft and activity responses carry `s-maxage`; degraded stays `no-store`; p14 #22 still passes.
- **Blog line:** The app asks the server for aircraft once per tab now, and pauses when you look away.

### B12 · Remove the remaining SCANs in tracks, spots and registry
- **Why:** `SCAN` gets slower as permanent history grows. Deterministic keys and pipelines keep reads flat.
- **Size:** M
- **One weekly run:** no
- **Files:** `lib/tracks.ts`, `lib/spots.ts`, `lib/registry.ts`, `lib/storage-keys.ts`
- **Acceptance:** no `scan` calls left in those files; reads go through key lists or index sets; a migration builds the indexes; node:test covers key construction.
- **Blog line:** Behind the scenes: history reads stay fast as the log grows, with no change on screen.

### B13 · Rotorcraft debounce tuning
- **Why:** Rotor tails working low over hills drop in and out more than fixed-wing. A per-class debounce stops the odd split flight.
- **Size:** S
- **One weekly run:** yes
- **Files:** `lib/activity-diff.ts`, `lib/flights.ts`, `lib/mission.ts` (`isRotorcraftModel`), `lib/activity-diff.test.ts`
- **Acceptance:** rotor tails get a longer landing debounce (start at 5 min) and session gap; fixed-wing unchanged; a replay of a week of rotor tracks shows fewer split sessions.
- **Blog line:** Rotor flights that duck behind a ridge stay one flight now instead of two.

### B14 · Telegram send queue
- **Why:** The bot sends inside the snapshot request today. A queue survives a burst of takeoffs and Telegram's rate limits.
- **Size:** M
- **One weekly run:** no (needs the bot switched on to test end to end)
- **Files:** `lib/bots/telegram.ts`, `lib/bots/dispatch.ts`, `lib/storage-keys.ts`, a new cron or the helm pinger
- **Acceptance:** sends go to a KV list and drain at 25 msg/s with retry on 429; a burst of 500 subscribers delivers within a minute; no duplicate per (chat, tail) cooldown.
- **Blog line:** Telegram alerts queue up now, so a busy morning reaches everyone, in order.

### B15 · Medevac tails research
- **Why:** Air ambulances are tracked but thinly labelled. Riders should see Medevac, not Unconfirmed, on a patient run.
- **Size:** S
- **One weekly run:** yes
- **Files:** `data/wa-gov-aircraft.json`, `lib/seed.ts`, `docs/registry-research-2026-11.md`
- **Acceptance:** Airlift Northwest, Life Flight and MultiCare tails sourced from the FAA registry plus an operator page, mission `medevac`, confidence marked; registry migration dry run clean.
- **Blog line:** Air ambulances now carry their own Medevac label, sourced, so nobody mistakes a patient run for the bird.

### B16 · Idaho State Police recheck
- **Why:** The ISP record near the border is tentative. A mutual-aid tail flips the pill inside WA, so it has to be right.
- **Size:** S
- **One weekly run:** yes
- **Files:** `data/wa-gov-aircraft.json`, `lib/seed.ts`, `docs/registry-research-2026-11.md`
- **Acceptance:** each ISP tail is confirmed or dropped with a source; scope stays `mutual_aid`; registry migration dry run clean.
- **Blog line:** We rechecked the Idaho side of the border fleet, tail by tail, with sources.

### B17 · Next.js 15 upgrade
- **Why:** Closes the remaining RSC and Server Action advisories and keeps the stack supported.
- **Size:** L
- **One weekly run:** no
- **Files:** `package.json`, `lib/user-prefs.ts`, `lib/admin-auth.ts`, every page taking `params` or calling `cookies()`
- **Acceptance:** Next 15.5 plus React 19; async `cookies()` and Promise params everywhere; `npx next build`, `npm test` and the p14 audit pass. Then maplibre 6 and web-push 4 as separate PRs.
- **Blog line:** Under the hood: a framework upgrade, faster pages and fewer security advisories, nothing to relearn.

### B18 · Softer first-visit alerts card (#71)
- **Why:** The opt-in card asks before a new visitor knows the app is for them.
- **Size:** S
- **One weekly run:** yes
- **Files:** `components/ArmAlertsCallout.tsx`, `components/AlertsOptInCard.tsx`, `app/(tabs)/page.tsx`
- **Acceptance:** first visit shows a one-line "Get a ping when Smokey goes up" link instead of the card; the card appears from the second visit or after a tap; closes #71.
- **Blog line:** First-time visitors see the sky first and the alerts pitch second.

## Shipped

<!-- The weekly job prepends one line per shipped item: - YYYY-MM-DD · B0x · Title · #PR -->
- 2026-11-19 · B19 · Desktop layout for plane and flight pages · #186
- 2026-11-19 · B09 · Neighbourhood pages · #183
