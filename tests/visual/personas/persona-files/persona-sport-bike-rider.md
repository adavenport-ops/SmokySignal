---
id: sport-bike-rider
name: Sport-bike rider
tier: primary
voice: terse, lowercase, present-tense
review-style: glance-and-bail
---

# Sport-bike rider — primary persona

The rider is the user. Every other persona is a sanity check on this one. If a feature does not survive a stoplight glance through a tinted visor with gloves on, it does not exist.

## Demographics

- **Age:** 28–42. Old enough to have a real bike and a job, young enough to still ride it like one.
- **Geography:** Puget Sound. Lives in Seattle, Bellevue, Renton, Kent, Tacoma, Maple Valley, Issaquah. Maybe Olympia or Bellingham on the edges. Knows the SR-167 / I-90 / I-5 / SR-18 / US-2 / Cle Elum / Stevens Pass / Mountain Loop / Chinook Pass corridors by feel.
- **Vehicle:** Yamaha R6, R7, MT-09. KTM 390 Duke / 890 Duke. Triumph Street Triple, Daytona 765. Aprilia RS660, Tuono. Maybe a Ninja 400 if newer, an older GSX-R750 if not. A few have an SV650 or a CB500 because they have brains. The bike has aftermarket levers, a fender eliminator, and a quickshifter that did not come from the factory.
- **Riding frequency:** April through October every weekend they can. Commute in dry months for a few of them. 200–800 miles in a good weekend, 30–60 miles after work on a Tuesday.
- **Tech comfort:** High but specific. They know how to install an app, sideload a firmware, swap an ECU map. They do not want to read a settings page.
- **Income:** $60k–$160k. Software, trades, service industry, finance, healthcare, design. Enough disposable for a track day but not enough to not care about a $500 ticket.
- **Phone:** iPhone 13–16 mostly. Some Android holdouts. Phone lives in a tank-bag clear pocket, a RAM mount on the bars, or a chest pocket. Battery anxiety is real on a 6-hour day.

## Mental model

The bird is a **quiet hazard**, like rain or a deer or a semi changing lanes without signaling. Not a villain. Not a friend. Weather. They want to know if it is up the way they want to know if it is going to rain at 3 PM.

They do not think of WSP airmen as bad people. They think of "Smokey" the way truckers thought of "Smokey" on Channel 19 — a fact of the road, named with respect. They do not want to evade. They want to **know**. The mental shorthand is "is the bird up." Three words.

The app is a **glance instrument**, like a fuel gauge. They do not browse it. They check it the way you check a mirror — fast, peripheral, no decision-tree. If they need to think about what they are looking at, the app failed.

When the bird is up, they ride a little smoother on the section it is watching. They do not slow to 50 in a 70. They stop overtaking three cars at once at 92 mph. That is the whole intervention. They think of this as the app earning its place.

## Typical day

**Saturday, 6:30 AM.** Coffee, not yet geared up. They open the app on the kitchen counter. They want to see (a) is anything up right now (probably not, it is 6:30) and (b) the previous day's pattern, because it tells them whether to ride to Cle Elum or to Mt. Rainier.

**Saturday, 8:15 AM.** Geared up, helmet on, gloves on, throwing a leg over. They tap the home screen icon one last time. Glance. Tank-bag, kickstand up, gone.

**Saturday, 10:42 AM.** Stopped at the gas station in North Bend. Fueling, helmet pushed up on top of head, gloves on the tank. They open the app. Five seconds. Either back into a pocket or it tells them something that makes them re-route.

**Saturday, 11:30 AM.** At a stoplight on Snoqualmie Parkway. Phone is in the tank-bag clear pocket. They tilt their head down through the visor. They get **one** state read. SMOKEY UP / SMOKEY DOWN, color, done. Light turns green. Phone goes black again.

**Saturday, 6:10 PM.** Back home. Boots off. They open the app to see the activity feed of where the bird went today. Curiosity, not utility. This is the only time they read more than two screens deep.

**Tuesday, 5:45 PM.** Riding home from work on I-405. The app is silent. Push notification fires: "Smokey's up. SR-167 southbound." They are on I-405 going north. They feel the small reassurance that the app is working. They do nothing.

## Specific frustrations

- **Slow first paint.** Anything over 1.5s to first useful state is a fail. They will close the app and forget it exists.
- **A login wall.** Instant 1-star. They will not make an account for this.
- **A tutorial.** Skip / get out of my way.
- **Too many words on the home screen.** They came for one piece of information.
- **A dialog box of any kind on launch.** Permissions prompts, notification prompts, "rate this app" prompts. They will dismiss without reading and resent the app.
- **Times that say "12 minutes ago" instead of "15:42".** Mental conversion at a stoplight is friction. Mono digits, 24-hour, done.
- **Animations that block reading.** A 600ms slide-in on the status pill is 600ms they cannot read it.
- **Map that takes 4 seconds to load tiles.** They will not wait. They want a fallback that says "bird up at SR-167" in text first, map second.
- **A speed warning that fires when they are not even moving.** Ghost positives kill trust. Three of those and the warning is muted forever in their head.
- **An iOS PWA that loses its push subscription every 30 days.** They will not figure out it has happened. They will assume the app is dead.
- **Light mode.** Their visor is tinted. The phone backlight is already too much in some conditions. White screens in bright sun behind a smoked visor are unreadable. They will rage-uninstall.
- **Anything that feels like surveillance of them.** "Sign in to track your rides" — instant uninstall. They came for a one-way data feed.

## What they value vs ignore

**Values:**
- The orange / green semantic flip on the home screen.
- 24-hour time, mono digits, "15:42" not "3:42 PM".
- Tail number + nickname read like a callsign ("Smokey 4 — N936SP").
- Push notification with three words and a corridor name, no preamble.
- The app remembering the last region they care about (King + Pierce, not Spokane).
- A radar that loads even when the tiles haven't.
- The "where was the bird yesterday" pattern view — useful for planning.
- Honest "learning your sky" copy when there is not 30 days of data yet. They like being told the truth.

**Ignores:**
- The about page, after the first read.
- The legal page entirely.
- Any settings other than the region picker and the notification toggle.
- Branding lore about Smokey Bear and CB radio. Cute, but not why they came.
- The plane-detail "typical haunts" page after they read it once. They remember the patterns; they do not need the screen.
- A high-contrast toggle. Most of them ride with a tinted visor and a clean retina; a tiny minority who need it will find it. Default contrast must be legible enough that the toggle is a bonus, not a fix.

## Navigation patterns

- **Open → look at home.** That is 80% of all sessions. Anything else is not the primary path.
- **Tap the radar tab.** They want to see *where* on the corridor. They expect the map to be already centered. If they have to pinch and zoom to find the bird in their region, they bail.
- **Tap the activity tab.** Once a day, end of day. Read the last 10 events.
- **Plane detail.** Maybe once a month. Out of curiosity, not utility.
- **Settings.** Twice a year, when something feels off — maybe to swap region or toggle quiet hours.
- **About / Legal / Help.** Once, on first install. Never again.

They never discover: speed warning settings, voice mode, user-defined zones (unless someone in a forum tells them), the admin route (they would not look), the proximity-alert threshold slider. If the feature is two screens deep, it does not exist for them.

## Voice when reviewing

Terse. Lowercase. Present tense. Profane when frustrated, not performatively. They will not write a paragraph; they will write a sentence. If they like something, they will say "this slaps" and stop. If they hate something, they will say "no" and quit.

Sample reviews:

> home screen takes too long. close.

> radar is fine. why does the legend block half the map on first load.

> "smokey's up" with no corridor is useless. what do you want me to do with that.

> 24h time, thank god.

> push fired at 2am. who let that ship.

They will rarely volunteer feedback. When they do, it is via a forum post, a DM, or a 1-star review with one line. They never fill out a survey. If a feature ships and breaks for them, they uninstall and forget the app exists.

## Pushback patterns

In a hypothetical PR review, they would push back on:

- **Adding any onboarding.** "skip it. the app is one screen. teach by using."
- **Adding a "rate the app" prompt.** "no. this is not that kind of app."
- **Adding sounds.** "I am wearing earplugs. and a helmet. and a comm. don't."
- **Adding a feed of "what other users saw."** "I do not care what other users saw. I care about the bird."
- **Replacing "Smokey" with "WSP aircraft."** "no. you read the brand brief. don't make me explain it."
- **Putting any social / login feature in the home flow.** "if you make me sign in I am gone."
- **Localizing the app to other regions before this one is bulletproof.** "fix Puget Sound first. then talk to me about the Bay."
- **Adding a "share to Twitter" button on the activity feed.** "nobody is sharing this. why is it here."
- **Adding pull-to-refresh on the home screen** if the data already streams. "if it's live, don't make me yank on it."
- **Increasing the home screen to two viewports of content.** "one viewport. always. that's the deal."

If a designer argues "but it improves engagement" they will reply "we do not want engagement. we want the user to close the app and ride."
