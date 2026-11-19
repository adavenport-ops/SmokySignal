# ADS-B and aviation subreddits

Audience cares about the feed, the merge and the data licence. Lead with the
technical story and credit the receiver networks.

Rules are from memory of the sidebars. Read the live ones first.

## r/ADSB

**Rules that matter:** on topic for ADS-B hardware, software and data; own
projects are welcome when disclosed and useful to the community; no
spam, no repeated self-posts. Credit the networks you use.

**Title:** I built a tracker on adsb.fi and adsb.lol that merges both feeds and keeps every track (open flight-hours dataset, ODbL)

**Body:**

> Thanks first to everyone who feeds adsb.fi and adsb.lol. This runs on your
> receivers.
>
> SmokySignal polls both networks in parallel every 30 seconds and merges by
> ICAO hex. Different receivers hear different sky, so the union picks up more
> low-level traffic around the Sound and the Cascades than either alone. It
> keeps geometric altitude, vertical rate, squawk, the MLAT flag, emitter
> category, signal quality and which feed supplied the point. Tracks are
> stored permanently, so you can replay a flight in 3D at true altitude.
>
> Two things I would like input on:
> 1. A dropped signal used to log a landing and a takeoff a minute later. I
>    now require 3 minutes of silence before a tail counts as down. Is that
>    the right trade for low-level aircraft?
> 2. Coverage notes: the data page says plainly that receivers are
>    volunteers and a transponder that is off never shows up.
>
> The monthly flight-hours CSV is ODbL 1.0 and credits adsb.fi and adsb.lol.
> Source is on GitHub. smokysignal.app

## r/aviation

**Rules that matter:** posts should be about aviation and be good content;
promotion and "check out my site" posts are often removed; link posts need
context. Lead with an image or clip, keep the link in a comment, and disclose.

**Title:** 17 Nov, N305DK flew a state patrol Cessna 206 from Gray AAF down I-5 to Olympia. Rendered in 3D at true altitude from public ADS-B

**Attach:** `public/blog/media/2026-11-19-the-big-update/hero-3d.mp4`

**First comment:**

> Source: public ADS-B from adsb.fi and adsb.lol, rendered with deck.gl over
> terrain. I built the viewer (SmokySignal, smokysignal.app) as a hobby. Every
> flight gets a replay like this. Aircraft only, no crew data, not affiliated
> with any agency.
