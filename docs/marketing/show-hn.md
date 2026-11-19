# Show HN

## Rules that matter

- Title starts with "Show HN:". The thing must be something people can try
  now, without signup. It is.
- Do not ask for upvotes, and do not ask friends to vote. Post it yourself
  from your own account, weekday morning Pacific, and be around for a few
  hours to answer.
- Use the plain project URL, no tracking parameters.
- The first comment from you carries the story. Keep it technical.

## Title

Show HN: SmokySignal, a live tracker for WA patrol aircraft built on public ADS-B (3D replays, open data)

## URL

https://www.smokysignal.app/

## First comment

> Author here. I ride a motorcycle around Puget Sound and wanted to know, in
> one glance, whether a Washington State Patrol or county sheriff aircraft was
> up. It grew into a permanent flight log and an open dataset.
>
> The technical story:
>
> - Stack: Next.js 14 (App Router) on Vercel, Upstash Redis for state, no
>   accounts, no database server. The 3D replay is deck.gl on MapLibre with
>   terrain; the 2D radar is MapLibre.
> - Two ADS-B feeds, merged. It polls adsb.fi and adsb.lol in parallel every
>   30 seconds and merges by ICAO hex. Different volunteer receivers hear
>   different sky, so the union covers more low-level airspace than either
>   feed. Each point keeps geometric altitude, vertical rate, squawk, MLAT
>   flag, emitter category, signal quality and the feed it came from.
> - A permanent track store. Tracks used to expire after 35 days; now every
>   flight stays, keyed through one formatter so a regional namespace is a
>   one-line change later. Flights are runs of reports with no gap over 5
>   minutes, and a tail has to be silent for 3 minutes before it counts as
>   landed. That fixed phantom landings from dropped signals.
> - Data you can use: a monthly flight-hours CSV by tail and by mission,
>   ODbL 1.0, from 16 Oct 2026. Aircraft only, never crew, no positions in the
>   file. smokysignal.app/data has the method and its limits.
> - A sourced registry. Each tail lists where its facts came from (FAA
>   registry, agency pages, local reporting) and whether it is confirmed or
>   tentative. A federal border flight shows as "Federal, not Smokey" and does
>   not flip the status.
> - Privacy: no accounts. Location and speed stay on the device; the optional
>   speed warning runs entirely in the browser. The only server-side
>   identifier is a push subscription, and only if you opt in.
> - Honest limits: receivers are volunteers, a transponder that is off never
>   shows, and the weekly post is history, not a forecast.
>
> Source is on GitHub. I would like feedback on the merge and on the 3
> minute landing rule. Not affiliated with any agency.

## Likely questions, short answers

- Is this legal? It reads public broadcasts that anyone with a receiver can
  hear. It does not encourage speeding; the warning says ease off.
- Why not ADS-B Exchange? Terms and cost; adsb.fi and adsb.lol are open and
  ask for attribution, which every page gives.
- Can I take the data? Yes, ODbL. Credit SmokySignal, adsb.fi and adsb.lol,
  and keep derived databases open.
