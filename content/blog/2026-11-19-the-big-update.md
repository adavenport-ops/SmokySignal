---
title: "SmokySignal, rebuilt: what's new"
date: 2026-11-19
summary: "Truer data, a stricter Smokey, a radar with a memory, a dozen new pages, and ways to take the signal with you."
tags: [launch, data, radar, history, privacy, design]
kind: launch
hero_value: "258"
hero_label: "Smokey flights in the last 30 days"
related: [/radar, /flights, /aircraft, /stats, /seen, /help]
---

Breaker breaker. SmokySignal went into the shop for a full rebuild. Everything below is live on smokysignal.app today. Each section links to the page it talks about.

![A 3D view of a real Smokey flight path draped over terrain, the camera orbiting slowly while the rotate, tilt, compass and Orbit buttons sit at the top right.](/blog/media/2026-11-19-the-big-update/hero-3d.mp4 "N305DK's 17 Nov run from Gray AAF down I-5 to Olympia, in 3D at true altitude, with the Orbit control turning the camera.")

## The last 30 days, by the numbers

| Smokey | Last 30 days |
|---|---:|
| Flights | 258 |
| Hours aloft | 45.6 |
| Tails that flew | 12 |
| Busiest day | Wed 11 Nov |
| That day | 10.0 h, 21 flights |
| Busiest hour | Tue 13:00 to 14:00 |

The window is 20 Oct to 18 Nov 2026. Every tracked tail, all missions: 353 flights and 55.5 hours. Generated 18 Nov 2026 at 21:57 PT from the public history endpoint the [radar](/radar) and [stats](/stats) read. History, not a forecast.

## Truth and data

The rule now: say what we heard, and say so when we heard nothing.

- **Phantom landings, fixed.** A dropped ADS-B signal used to log a landing, then a takeoff a minute later. Now a tail has to be gone for 3 minutes before it counts as down, and a failed feed writes no events at all. The [Recent](/flights?tab=recent) list stopped stuttering.
- **Feed's quiet.** When every feed fails, the hero says so in grey with the last good read time. It never says Smokey's down on a dead feed.
- **Two feeds, merged.** Positions come from adsb.fi and adsb.lol, asked in parallel and merged aircraft by aircraft. Different receivers hear different sky, so the union covers more low-level airspace around the Sound, the Cascades and the east side.
- **30-second refresh.** The snapshot refreshes every 30 seconds around the clock, not only when someone happens to open the app.
- **History kept for good.** Tracks no longer expire after 35 days. Every flight we log stays on the books.
- **Richer points.** Each position now keeps geometric altitude, vertical rate, squawk, an MLAT flag, emitter category, signal quality and the feed it came from.

![SmokySignal's home screen on a phone, showing the live status of the Smokey fleet.](/blog/media/2026-11-19-the-big-update/home-phone.webp "The Now tab on a phone. One glance: up, down, or the feed's quiet.")

## Smokey means Smokey

Smokey now means a WSP or county sheriff aircraft, plus a neighbour on mutual aid while it is inside Washington airspace. Nothing else flips the pill.

- Every tail carries a mission: Smokey, Federal, Search & Rescue, Wildfire, Medevac, Survey, Transport, or Unconfirmed. A federal border flight shows up as "Federal, not Smokey" and the sky stays all clear.
- The registry was rebuilt from public records: the FAA registry, agency pages and local reporting. Each entry says where its facts came from and how sure we are: confirmed or tentative.
- [All aircraft](/aircraft) lists every tail we watch, grouped by mission, with sources.

![The All aircraft page on desktop, tails grouped by mission with their sources.](/blog/media/2026-11-19-the-big-update/aircraft.webp "All aircraft: every tail we watch, grouped by mission, with where the facts came from.")

## Radar

- **Zoom to region.** The [region picker](/radar) moves the camera now. It frames Puget Sound, all of Washington, the east side and more, and never hides data outside the box.
- **Statewide plus the borders.** Heat and routes cover Washington and the Oregon and Idaho border country.
- **History mode.** Tap HISTORY on the radar for the last 7 days, the last 30, any month on record, or a custom range. Pick one tail or a whole mission and the old routes draw on the map.
- **Palettes.** The basemap is neutral charcoal now, and heat and routes come in five colour sets: Ember, Magma, Ice, High contrast and Mono. Pick one from the radar layers menu or in [Settings](/settings). Whatever the palette, a live Smokey wears the orange ring and pulse.
- **3D flights.** Any shared flight page has a 2D | 3D switch. The path flies at true altitude over terrain, with a replay scrubber and its patterns marked. [Try one](/flight/N305DK/20261117T2248?view=3d).

![On a phone, the radar's History sheet opens, Last 30 days is picked, and thirty days of Smokey flight paths fill in across the Puget Sound map.](/blog/media/2026-11-19-the-big-update/radar-history.mp4 "History mode on a phone: open HISTORY, pick Last 30 days, and a month of Smokey routes draws in. Then zoom to the Sound.")

![The desktop radar with its layers panel open, switching the map palette from Ember to Magma to Ice, the heat and the tinted motorways changing colour each time.](/blog/media/2026-11-19-the-big-update/radar-palettes.mp4 "Ember, Magma, Ice. Each palette recolours the heat, the routes and the roads under them.")

## New pages

- [/circling](/circling): what is working a pattern right now, in plain language.
- [/seen](/seen): pick a time and a place and see what flew by.
- [/road](/road): passes over the roads you ride, with time overhead, busiest stretch and hour of day. Start with [I-5](/road/i-5).
- [/forecast](/forecast): now with a month view, hour by weekday, for any month on record.
- [/stats](/stats): a permanent daily log of hours aloft, week by week.
- [/wrap/2026](/wrap/2026): the season in one card.
- [/data](/data): monthly flight hours per airframe as an open CSV under ODbL.
- **Logbooks.** Every [plane page](/plane/N305DK) keeps sorties and hours per month, longest sortie, departure fields, typical hours and time on station.
- **Flight cards.** Each flight renders a share card with the track, altitude profile and the corridor it worked.

![The What's circling page on a phone.](/blog/media/2026-11-19-the-big-update/circling.webp "What's circling: anything working a pattern right now, in plain words.")

![The /seen answer for Fife on 17 November at 15:30: N305DK, Smokey 4, passed 0.1 mi away at 15:22 at 1,600 ft, with a small map of its pattern over I-5.](/blog/media/2026-11-19-the-big-update/seen-fife.webp "What flew over Fife on 17 Nov around 15:30: N305DK, right overhead at 15:22, 1,600 ft, working I-5.")

![The I-5 road history page on a phone with time overhead and the busiest stretch.](/blog/media/2026-11-19-the-big-update/road-i5.webp "I-5's pass history: time overhead, the busiest stretch and the hour of day.")

![The forecast month view on desktop, an hour-by-weekday grid of Smokey activity for November 2026.](/blog/media/2026-11-19-the-big-update/forecast-month.webp "The forecast's month view: hour by weekday for November so far. History, not a promise.")

![The stats page on desktop with hours aloft by week.](/blog/media/2026-11-19-the-big-update/stats.webp "Stats keeps a permanent daily log of hours aloft, week by week.")

![N305DK's page on a phone, scrolled to its logbook.](/blog/media/2026-11-19-the-big-update/plane-logbook.webp "N305DK's logbook: sorties and hours per month, departure fields, time on station.")

![The share card for N305DK's 18 November flight, with the track, an altitude profile and the corridor it worked.](/blog/media/2026-11-19-the-big-update/flight-card.webp "Every flight renders a share card: the track, the altitude profile and the corridor it worked.")

## Take it with you

- **Discord and webhooks.** [/relay](/relay) sends Smokey takeoffs to a club Discord channel or any HTTPS endpoint. No account; you get a private manage link.
- **Feeds.** Takeoffs and landings as [RSS](/rss.xml) and [Atom](/feed.xml). This blog has [its own feed](/blog/feed.xml).
- **Bots.** Telegram alerts that read aloud in the car, a Discord `/smokey` command, and a Bluesky autopost are built. They go live as soon as the bots are switched on.
- **Embed.** A status pill or card for club sites and forums. Setup on [/embed/help](/embed/help).
- **Calendar.** The [calendar feed](/calendar.ics) puts the usual busy windows for the next two weeks in your calendar app.
- **Handlebar mode.** [/glance](/glance) is huge-type status for a phone mount: high contrast, screen kept awake, no prompts.
- **Shop board.** [/board](/board) is a departures board for the shop TV.
- **Offline.** Lose signal and the app shows a clean offline page instead of a dead screen.
- **Speed warning.** Opt in on [Settings](/settings) and the Now tab and /glance show a full-screen EASE OFF when you are over your limit, inside a hot zone, with Smokey up within 5 nm. Foreground only. Your speed never leaves the phone.

![The /glance handlebar view on a phone, status in very large type.](/blog/media/2026-11-19-the-big-update/glance.webp "Handlebar mode: huge type, high contrast, screen kept awake.")

![The /board departures-board view on a desktop screen.](/blog/media/2026-11-19-the-big-update/board.webp "The shop board, a departures board for the TV over the bench.")

![The full-screen EASE OFF speed warning on a phone, with the distance to the bird and how far over the limit the rider is.](/blog/media/2026-11-19-the-big-update/speed-warning.webp "The speed warning, illustrative: a staged rider and a staged bird. Opt in, foreground only, and your speed never leaves the phone.")

## Privacy

We listen, we don't talk.

- **On your phone only:** your location, your speed, your display settings, the speed warning and its limit.
- **On our side, only if you ask for it:** a push subscription endpoint plus the alert filters you set (missions, quiet hours, and any zones you filter alerts by). A Spotted report keeps its spot rounded to about a kilometre. A relay keeps the webhook URL you paste and a hash of its manage key. Once the Telegram bot is on, it keeps your chat id and filters, deleted on `/stop`.
- **Never:** rider accounts, location history, your speed, or anything sent to any agency. The old speed dry-run beacon is gone, and /seen rounds your spot before it leaves the phone.
- The full data flow is on [Legal](/legal).

## Design

- **One orange for up.** The status orange means Smokey is up. Buttons, links and selected toggles went neutral, and the all-clear stays green.
- **Bigger type.** Nothing rider-facing renders under 12 px, numbers are mono and tabular, and controls are at least 44 px for gloved hands.
- **New navigation.** Five tabs: Home, Radar, Flights, Alerts, More. Flights folds the live list and the recent log into one place. On desktop a rail runs down the left, radar included.

![SmokySignal's home screen on desktop with the navigation sidebar down the left.](/blog/media/2026-11-19-the-big-update/home-desktop.webp "Desktop gets the sidebar: every page, six sections, one rail.")

![On desktop with the sidebar showing, the search palette opens, N305DK is typed, and Enter lands on that plane's page.](/blog/media/2026-11-19-the-big-update/search-cmdk.mp4 "Command-K from anywhere. Type a tail, hit Enter, land on its logbook.")

That's the rebuild. Ears on, see you out there.
