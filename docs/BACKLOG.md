# SmokySignal backlog

A ranked, living list. The weekly job on helm reads it, and so do people.
Seeded 2026-11-18 from `docs/AUDIT-2026-11.md` plus the items the audit
named that are not built yet. Rank is rider value over cost; re-rank freely.

## How the weekly job uses this file

1. On its run, the job picks the highest-ranked item marked
   **One weekly run: yes** that is not blocked, and moves it under
   `## This week` (keep the whole item, fields and all).
2. It builds that item on a branch and opens a PR.
3. `npm run blog:weekly -- --week-ending YYYY-MM-DD` prints the first item
   under `## This week` as the post's "Feature of the week", using its
   **Blog line**. Leave `## This week` empty (only the placeholder line)
   when nothing was picked.
4. Once the PR merges, the job moves the item to `## Shipped` as one line:
   `- YYYY-MM-DD · B0x · Title · #PR`, newest at the top.

Item fields: id, title, **Why** (rider value), **Size** (S = one sitting,
M = a few days, L = a project), **One weekly run** (yes when it fits one
automated run end to end), **Files** (likely touched), **Acceptance**, and
**Blog line** (one sentence for the weekly post, brand voice: no emoji, no
exclamation marks, none of the voice-gate words).

## This week

_Nothing picked yet._

## Ranked

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

### B09 · Neighbourhood pages
- **Why:** The curious local wants "what flies over Puyallup", not a road.
- **Size:** M
- **One weekly run:** no
- **Files:** a new `app/(tabs)/near/[place]/page.tsx`, `lib/places.ts`, `lib/history-digest.ts`, an OG card in `lib/og/`
- **Acceptance:** one page per gazetteer town with 30-day flights within 3 mi, hour-of-day strip and mission mix; share card; linked from /seen results.
- **Blog line:** Every town on the map gets its own page: what flew over it this month, and when.

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

### B19 · Desktop layout for plane and flight pages
- **Why:** On a 1440 px screen /plane/[tail] and /flight/... sit in a narrow single column with the map, logbook and history stacked; the aviation crowd mostly reads these on desktop.
- **Size:** S
- **One weekly run:** yes
- **Files:** `app/(tabs)/plane/[tail]/page.tsx`, `app/flight/[tail]/[flightId]/page.tsx`, `components/PlaneHistory.tsx` (layout only)
- **Acceptance:** at ≥1024 px a two-column layout (map/3D left and wide, stats + logbook + related right), no horizontal scroll at 390 px, 12 px floor, the 3D controls still clear of content; screenshots at 1440x900 and iPhone 14.
- **Blog line:** Plane and flight pages now use the whole screen on desktop: map on the left, the logbook beside it.

## Shipped` as one line:
   `- YYYY-MM-DD · B0x · Title · #PR`, newest at the top.

Item fields: id, title, **Why** (rider value), **Size** (S = one sitting,
M = a few days, L = a project), **One weekly run** (yes when it fits one
automated run end to end), **Files** (likely touched), **Acceptance**, and
**Blog line** (one sentence for the weekly post, brand voice: no emoji, no
exclamation marks, none of the voice-gate words).

## This week

_Nothing picked yet._

## Ranked

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

### B09 · Neighbourhood pages
- **Why:** The curious local wants "what flies over Puyallup", not a road.
- **Size:** M
- **One weekly run:** no
- **Files:** a new `app/(tabs)/near/[place]/page.tsx`, `lib/places.ts`, `lib/history-digest.ts`, an OG card in `lib/og/`
- **Acceptance:** one page per gazetteer town with 30-day flights within 3 mi, hour-of-day strip and mission mix; share card; linked from /seen results.
- **Blog line:** Every town on the map gets its own page: what flew over it this month, and when.

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

### B19 · Raise an Antenna guide
- **Why:** More receivers mean fewer blind spots. Riders with a spare Pi can help the whole region.
- **Size:** S
- **One weekly run:** yes
- **Files:** a new `content/antenna.md`, `app/(tabs)/program/page.tsx` (link from the coverage section)
- **Acceptance:** a plain how-to for feeding adsb.fi and adsb.lol (parts, placement, sign-up), linked from /program#coverage and the /seen empty state.
- **Blog line:** Want fewer blind spots on your road: here is how to put up a receiver and feed the network.

## Shipped

<!-- The weekly job prepends one line per shipped item: - YYYY-MM-DD · B0x · Title · #PR -->
