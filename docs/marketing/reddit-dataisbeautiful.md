# r/dataisbeautiful: OC post

## Rules that matter (verify on the live sidebar)

- Tag the title `[OC]`. The post must be an image or video of the
  visualization itself, not a link post to the site.
- Within about an hour, post a top-level comment on your own post with the
  data source and the tools used. That is the methodology comment below.
  Posts without it can be removed.
- You must have made the visualization. This is the radar's History mode,
  built for the project, so that holds.
- No promotion in the title. The link to the site goes in the comment, once,
  as the source.
- Say that you built it. Do not ask for upvotes.

## Title

[OC] 30 days of Washington State Patrol and sheriff aircraft over Puget Sound

## Image to attach

Best available: `public/blog/media/2026-11-19-the-big-update/radar-history.jpg`
(History mode, Last 30 days, a month of routes on the Puget Sound map; phone
frame). The clip is `radar-history.mp4` in the same folder, 8 seconds, if you
want video.

Better, if you have ten minutes: a desktop capture of the same view.
Open https://www.smokysignal.app/radar, open HISTORY, pick Last 30 days,
zoom to the Sound, and screenshot at 1440x900. Landscape reads better on this
subreddit than a phone frame.

## Methodology comment (post this as a top-level comment)

> Source: SmokySignal (smokysignal.app), built on public ADS-B from adsb.fi
> and adsb.lol (ODbL).
>
> What it shows: every logged flight of the 12 Washington State Patrol and
> county sheriff aircraft that flew in the 30 days to 18 Nov 2026, drawn as
> routes over the Puget Sound basemap. Brighter means more passes.
>
> Method: positions come from two volunteer ADS-B receiver networks, merged
> aircraft by aircraft, polled every 30 seconds. A flight is a run of
> position reports with no gap over 5 minutes, so a dropout can split one
> sortie in two. Hours run from first report to last. The 12 aircraft are the
> ones in a sourced registry (FAA records, agency pages, local reporting).
>
> Limits: receivers are volunteers, so low flying and terrain drop reports,
> and an aircraft flying with its transponder off never appears. This is
> coverage, not a count of everything that flew.
>
> Numbers for the window: 258 flights, 45.6 hours aloft, busiest day Wed
> 11 Nov (10.0 h, 21 flights).
>
> Tools: Next.js, MapLibre and deck.gl. Open data: monthly flight hours by
> tail as CSV, ODbL 1.0, at smokysignal.app/data. Aircraft only, never crew.
> I built it; happy to answer questions about the method.

## If asked "why"

Public ADS-B, public registry, public agencies. It answers a plain question:
when did these aircraft fly, and over where. It is history, not a forecast,
and it says so on every page.
