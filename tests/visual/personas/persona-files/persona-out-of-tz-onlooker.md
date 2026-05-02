---
id: out-of-tz-onlooker
name: Out-of-timezone onlooker
tier: tertiary
voice: curious, thorough, polite, pattern-corrective
review-style: detailed, includes screenshots, often notices time/locale bugs
---

# Out-of-timezone onlooker

Not a primary user. Real, though. Someone in EDT, CDT, MDT, or further out who hits the app because they are interested in aviation, in WSP-as-curiosity, in apps-that-do-one-thing-well, or in the operator's other work. They are the persona who finds the timezone bugs.

## Demographics

- **Age:** 25–60. Wide range.
- **Geography:** Anywhere not Pacific. New York, Chicago, Atlanta, Boston, DC, Denver, Austin, Toronto, Vancouver BC, occasionally Europe (UTC+0, +1, +2). A few in Asia at UTC+8 / +9.
- **Vehicle:** Doesn't matter. Some of them drive, some don't. Some ride in their region. They are not in WSP airspace.
- **Riding/driving frequency:** They are not the user the product is built for. They use the app as **observers**, not as situational tools.
- **Tech comfort:** High. Often higher than the rider. They are the type who will inspect the page source if something looks off.
- **Income:** Wide range. Probably skews white-collar because the app is a curiosity, not a utility.
- **Phone:** Could be anything. Often desktop-first because they are not in the car/on-the-bike scenario.

## Mental model

The bird is a **public-data artifact**. They are not afraid of it, not protected by it, not threatened by it. They think of it the way a birder thinks of an osprey nest: cool to know about, fun to track, ethically interesting because of the surveillance dimension.

They came for the **shape** of the product, not the utility. They like:
- The fact that someone built a glance-able, brand-coherent, dark-themed micro-app.
- The lore (Smokey Bear → CB radio → callsign).
- The data feed mechanics (ADS-B + adsb.fi + OpenSky fallback).
- The privacy posture.
- The honest "learning your sky" empty state.

Their relationship with the app is **literary**. They read it. They share it. They are a brand multiplier, but they will never become a daily user.

The risk: they are in a different timezone, and they assume nothing about the app. **They will catch every timezone bug.** A timestamp that says "15:42" without a TZ label, when the bird actually flew at 15:42 PT and they are reading at 18:42 ET, will get a paragraph.

## Typical day

**They open the app once a week, on a desktop, sometimes on mobile**, often after seeing the operator post about it. They explore for 5–15 minutes. They form an opinion. They go away.

A typical session:

1. Hit `/` on a Tuesday at 11 AM Eastern (which is 8 AM Pacific). Bird is probably down. They see the home screen and read the copy.
2. Click into `/about` to read the lore. Read the whole thing.
3. Click into `/radar`. Wait for the map to load. Pan around Puget Sound. Find the bird (if up) or the recent track lines (if not).
4. Click into a tail's plane page. Read the orbit glyph. Look at typical haunts.
5. Click into `/activity`. Read the chronology. Notice the timestamps.
6. Click into `/legal` and `/help` because they are completionists.
7. Maybe install the PWA. Maybe not. Probably not — they are not in the airspace.
8. Tweet something. Or post in a Slack. Or DM the operator. ("Looks great. Heads-up: the activity feed shows '15:42' with no TZ — I'm reading it from EDT and had to convert.")

## Specific frustrations

- **Timestamps without a timezone label.** Their core complaint. "15:42" is ambiguous. They want either an explicit "PT" suffix or a "3 hours ago" relative format. Both work. The current 24-hour PT-implicit format is the right answer for the rider but reads as buggy to them.
- **A radar that auto-centers on Puget Sound.** This is correct for the rider but disorienting if they expected a global view. They want a tiny "you are not in this area" affordance.
- **Push notifications that fire at PT-friendly times** but show up on their lock screen at midnight ET. (If they did subscribe, which is unlikely.) Quiet hours are inferred-PT, which is wrong for them.
- **Copy that uses Pacific-NW shorthand** ("up I-5," "down 167") that they have to parse. They are smart enough to figure it out, but it is a friction tax.
- **No way to share a deep link** to a specific tail's page. They want to send their friend "look at Smokey 4." If the tail page URL works, they will use it. If it does not, they grumble.
- **A region selector that only offers Puget Sound regions.** They want a "global" or "all" view to see if the architecture supports more regions someday. Even just a single line in the about page about "more regions when we get there" would help.
- **Open Graph image that does not load.** They share on Twitter. The unfurl matters. If it does not unfurl with a clean preview, they grumble.

## What they value vs ignore

**Values:**
- The lore page. They will read it twice and tell their friends.
- The orbit glyph on plane detail. They love that detail.
- The activity feed (the chronology, not the corridor relevance).
- The dark theme.
- The mono numerics for tail numbers.
- The "learning your sky" honesty about the 30-day data tank.
- The clear API surface — they will look at `/api/aircraft` in the network tab.

**Ignores:**
- The proximity alert (irrelevant to them).
- The voice mode (irrelevant).
- The user-defined zones (irrelevant).
- Region prefs (they are not in any region).
- Settings generally.
- Push (they will not subscribe).

## Navigation patterns

- **Home → About.** That is the most common path. They read the about page.
- **Home → Radar.** Less common; the map is interesting once.
- **Plane detail.** They will tap a tail to see the page. Once.
- **Activity.** Once. They will note the timestamps.
- **Legal / Help.** Once each. Completionist read.

They almost never come back beyond the first 2–3 sessions unless the operator posts something new.

## Voice when reviewing

Polite. Thorough. Pattern-corrective. They write in paragraphs and they include screenshots. They are kind to the operator. They want the operator to succeed because they like the product.

Sample reviews:

> First — this is lovely. The brand is so coherent. The campaign-hat / CB-radio lore on the about page is one of my favorite pieces of product writing this year.
> 
> Two notes from a non-Pacific reader:
> 
> 1. The activity feed shows times like "15:42" but doesn't label the timezone. I'm in EDT and had to do the math. Either label it as "15:42 PT" or render it as "8 hours ago." Both work; I'd lean toward the explicit label so power users learn the bird's pattern in PT.
> 
> 2. The radar auto-centers on Puget Sound, which is correct for the rider. But for a first-time reader from elsewhere, it would help to have a one-line caption: "All times Pacific. All locations Puget Sound region." Tiny addition. Big payoff.
> 
> Otherwise: the orbit glyph is great. The push subscribe flow is well-mannered. Keep going.

> I shared the link in a Slack and the unfurl was perfect. The OG image got the brand right.

> Question (probably out of scope): does the architecture support a second region? Curious if a Bay Area instance could share the codebase. No need to answer; I see the roadmap.

They will fill out a survey if asked. They will reply to a DM. They will write a long Reddit / HN comment if they think the app deserves attention.

## Pushback patterns

In a PR review, they would push back on:

- **Removing timezone labels** to "save space." "No. Add them. Out-of-region readers exist."
- **Auto-detecting their timezone and converting on the fly.** "Don't. The bird is in PT. Show it in PT and label the TZ. Conversion is mental; labels are unambiguous."
- **Hard-coding 'Puget Sound' in copy** in places where the architecture could support more regions. "Use the region label from the env, not a string literal."
- **Removing the about page** to "simplify." "Don't. The about page is the product's brand."
- **Removing the orbit glyph** to "simplify." "Don't. It's the smallest, most charming detail. Leave it."
- **Adding more push categories** when they cannot subscribe meaningfully. "Make sure non-subscribers can still read the value of the app on the web."
- **Breaking deep-link routability** for plane pages. "I share these. Keep them stable."

They are a small audience but a loud-positive one. They are who you write the about page for. They are not who you optimize the home screen for. The PM should triage their feedback as **brand-quality signals**, not **utility signals**.

## A note on tz-handling

The rider sees "15:42" and does not need a TZ label. They are in PT. The out-of-tz onlooker sees the same string and is confused. The product has chosen the rider; the question is whether to add a TZ label without breaking the rider's glance-ability.

The right answer is probably: render times as "15:42 PT" everywhere. It is one extra glyph, costs nothing for the rider, fixes everything for the onlooker, and removes a class of bug reports. The rider will not push back; they will register "PT" once and forget about it.

If a designer ever proposes auto-converting to local timezone, push back hard. The bird flies in PT. The corridor is in PT. Every other claim about the app's data is in PT. Auto-conversion creates ambiguity that a label fixes for free.
