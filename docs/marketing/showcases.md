# Showcases and directories

How to get listed, with exact steps and drafted text. All free. Each step is
something the owner does from his own existing accounts; no new account is
assumed unless noted as optional. Checked 2026-11-19 against each site or
repo; policies change, so re-read the target page first.

Canonical facts for every form:

- Name: SmokySignal
- URL: https://www.smokysignal.app
- Repo: https://github.com/adavenport-ops/SmokySignal
- One line: Live tracker for Washington State Patrol and sheriff aircraft,
  built on public ADS-B, with 3D replays and an open flight-hours dataset.
- Licence of data: ODbL 1.0. Feeds: adsb.fi and adsb.lol.
- Press kit with logos and screenshots: https://www.smokysignal.app/press

## 1. adsb.lol

What I found: the repos (github.com/adsblol/feed, github.com/adsblol/api)
and the docs site (https://www.adsb.lol/docs/) show no showcase or project
list and no listing process. The docs header lists the contact channels:

- Email: info@adsb.lol
- Zulip: https://adsblol.zulipchat.com
- IRC: #adsblol on Libera (https://web.libera.chat/#adsblol)
- Mastodon: https://mastodon.social/@adsblol
- GitHub issues: https://github.com/adsblol/feed/issues

Steps:

1. Check https://www.adsb.lol/docs/acknowledgements/open-source and the
   docs for a "projects" page. None was found on 2026-11-19.
2. Say thanks and ask about a listing in Zulip (preferred) or by email.
   Do not open a GitHub issue unless they ask; the issue tracker is for the
   feeder software.

Draft message (Zulip or email):

> Hi, I run SmokySignal (smokysignal.app), a free tracker for Washington
> State Patrol and sheriff aircraft built on the adsb.lol and adsb.fi open
> data, merged aircraft by aircraft. It credits adsb.lol on every data page
> and its flight-hours CSV is ODbL 1.0 with the required attribution. Thank
> you for running the network. If you keep a list of projects built on
> adsb.lol, I would be glad to be on it. Anything you want changed in how I
> credit or poll, tell me and I will fix it. Source: github.com/adavenport-ops/SmokySignal

## 2. adsb.fi

What I found: adsb.fi blocks automated fetches (HTTP 403), so I could not
read its pages. The org is https://github.com/adsbfi (repos include
adsb-fi-scripts, tar1090, readsb, docker-multifeeder). I found no public
showcase list.

Steps:

1. Open https://adsb.fi in a browser and look for a Discord, contact or
   "community" link in the footer or menu. Use that channel.
2. If none, open an issue or discussion in the most relevant repo only if the
   repo has Discussions enabled; otherwise use the contact address on the
   site.

Draft message:

> Hi, I build SmokySignal (smokysignal.app), a tracker for Washington State
> Patrol and sheriff aircraft that uses the adsb.fi open data, merged with
> adsb.lol. I poll about every 30 seconds, cache for 10, and credit adsb.fi
> on the site and in the data licence notice. Thank you for the free API. Is
> there a list of projects built on adsb.fi where this would fit? If my
> polling should change, tell me.

## 3. awesome-adsb (GitHub)

Repo: https://github.com/rickstaa/awesome-adsb (default branch `main`,
about 400 stars). Its contributing.md says:

- Always create a new branch.
- Fit the item into an existing section; open an issue to discuss a new one.
- Add the item to the bottom of the list in its section.
- Format: `- [item name](https link) - Description beginning with a capital, ending in a period.`
- Check spelling and grammar; no duplicates.

Steps:

1. `gh repo fork rickstaa/awesome-adsb --clone` from your own account.
2. `git checkout -b add-smokysignal`
3. In `readme.md`, find the section for web apps or data (read the headings
   first), add the line below at the bottom of it, commit, push.
4. `gh pr create --repo rickstaa/awesome-adsb`

Line to add:

```
- [SmokySignal](https://www.smokysignal.app) - Live tracker and open flight-hours dataset (ODbL) for Washington State Patrol and sheriff aircraft, built on adsb.fi and adsb.lol.
```

PR title: Add SmokySignal

PR body:

> Adds SmokySignal: a tracker for Washington State Patrol and county sheriff
> aircraft built on public ADS-B (adsb.fi and adsb.lol merged). It keeps every
> track, renders 3D replays, and publishes a monthly flight-hours CSV under
> ODbL 1.0. Source: https://github.com/adavenport-ops/SmokySignal. Added at
> the bottom of the section, in the required format.

Other similar lists to search before posting: `gh search repos "awesome adsb"`
and `gh search repos "awesome aviation"`; apply the same pattern.

## 4. Product Hunt

Needs a Product Hunt login (existing account, or sign in with an account you
already have). Free.

1. Go to https://www.producthunt.com/posts/new and submit the URL.
2. Fill in: name, tagline, description, topics (Open Source, Maps,
   Motorcycles, Data Visualization), the gallery, a maker comment.
3. Gallery: six screenshots and the 3D clip from https://www.smokysignal.app/press.
4. Schedule for a weekday at 00:01 Pacific. Do not ask for upvotes.

Tagline (60 characters max): Is Smokey up? Live WA patrol aircraft on ADS-B

Description (260 characters max): A live tracker for Washington State Patrol and sheriff aircraft, built on public ADS-B. 3D flight replays, a permanent flight log, an open flight-hours dataset and no accounts.

First comment:

> I ride around Puget Sound and built this to answer one question in one
> glance. It grew into a permanent flight log, 3D replays and an open
> dataset (ODbL). It is free, has no accounts and never stores your location.
> History, not a forecast. I would like to hear which roads and hours you want
> broken out.

## 5. AlternativeTo

Needs an AlternativeTo login (existing account). Free.

1. https://alternativeto.net/software/new/ ("Suggest new application").
2. Name: SmokySignal. Platforms: Web, plus "Progressive Web App" if offered.
   Price: Free. Licence: the repo has no LICENSE file today, so do not tick
   "Open Source" until the owner picks and commits a licence; until then
   choose "Free" and link the source.
3. Add the website, the GitHub repo, the description, screenshots.
4. Mark it as an alternative to flight trackers such as Flightradar24 and
   ADS-B Exchange only if the form asks for comparisons; it covers a narrow
   slice (one region, one fleet), so say so.

Description: Free web app that shows whether a Washington State Patrol or sheriff aircraft is airborne, with a permanent flight log, 3D replays and an open flight-hours dataset. Built on public ADS-B from adsb.fi and adsb.lol. No accounts.

## 6. PWA directories

SmokySignal is installable, has a manifest and a service worker.

- https://pwa-directory.appspot.com/ was the long-running community list;
  check that it still accepts submissions before spending time.
- https://progressivewebapps.com/ and similar lists change often. Search
  "submit PWA directory" and read each site's submission page.
- App stores for PWAs (Microsoft Store via PWABuilder, Google Play via a
  trusted web activity) need developer accounts; skip them. They are not free
  of new accounts.

Steps for any directory: submit the URL, the one-line description, a 512 px
icon (https://www.smokysignal.app/icons/icon-512.png) and two screenshots
from the press kit. Mention: installable, works offline for the shell, push
alerts opt-in, no accounts.

Draft text:

> SmokySignal: a live tracker for Washington State Patrol and sheriff
> aircraft over Washington state. Installable PWA, offline shell, opt-in push
> alerts, a handlebar-friendly glance view and a shop-TV board. Built on
> public ADS-B. No accounts.

## 7. Open data and civic lists (optional, same pattern)

- https://github.com/awesomedata/awesome-public-datasets: the dataset is
  small and regional; probably not a fit. Skip unless a maintainer asks.
- A Data.gov style listing would need an agency; skip.

## Tracking

Record each submission and its date here when done, so nothing is posted
twice. Do not post anywhere from this repo or from automation.
