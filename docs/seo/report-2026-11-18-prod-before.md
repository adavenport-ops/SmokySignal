# SEO audit 2026-11-18

Base: https://www.smokysignal.app · 21 pages crawled (0 in sitemap) · 13 s

| P0 | P1 | P2 | JSON-LD pages | Canonical pages | Duplicate titles | Broken links | Links checked |
|---|---|---|---|---|---|---|---|
| 23 | 19 | 4 | 0 | 1 | 0 | 1 | 118 |

## Site checks

| Check | Result | Detail |
|---|---|---|
| robots.txt | FAIL (P0) | HTTP 404 |
| sitemap.xml | FAIL (P0) | HTTP 404, 0 URLs |
| llms.txt | FAIL (P0) | HTTP 404, 21890 bytes |
| llms-full.txt | FAIL (P1) | HTTP 404, 21895 bytes |
| unknown URL returns 404 | pass | HTTP 404 |
| unknown tail returns 404 | pass | HTTP 404 |

## Pages

| Path | Status | Title (len) | Desc len | Canonical | H1 | JSON-LD | OG image | Words | Noindex | Issues |
|---|---|---|---|---|---|---|---|---|---|---|
| / | 200 | SmokySignal — Is the bird up? (29) | 95 | no | 1 | - | 200 | 62 |  | P0 canonical-missing; P2 thin; P1 description-duplicate |
| /radar | 200 | Radar · SmokySignal (19) | 95 | no | 0 | - | 200 | 48 |  | P0 canonical-missing; P1 h1-missing; P2 thin; P1 description-duplicate |
| /flights | 200 | Flights · SmokySignal (21) | 74 | no | 1 | - | 200 | 50 |  | P0 canonical-missing; P2 thin |
| /circling | 200 | What's that plane circling over Tacoma? · SmokySignal (53) | 150 | no | 1 | - | - | 256 |  | P0 canonical-missing; P1 og-image-missing |
| /seen | 200 | Was that the plane I saw? · SmokySignal · SmokySignal (53) | 134 | yes | 1 | - | 200 | 143 |  | P1 title-double-brand |
| /program | 200 | The program · SmokySignal (25) | 111 | no | 1 | - | 200 | 1398 |  | P0 canonical-missing |
| /aircraft | 200 | All aircraft · SmokySignal (26) | 73 | no | 1 | - | 200 | 1067 |  | P0 canonical-missing |
| /road | 200 | Road history · SmokySignal (26) | 99 | no | 1 | - | 200 | 179 |  | P0 canonical-missing |
| /forecast | 200 | SmokySignal · Forecast · SmokySignal (36) | 80 | no | 1 | - | 200 | 126 |  | P1 title-double-brand; P0 canonical-missing |
| /stats | 200 | SmokySignal · Stats · SmokySignal (33) | 80 | no | 1 | - | 200 | 308 |  | P1 title-double-brand; P0 canonical-missing; P1 broken-link |
| /data | 200 | SmokySignal · Data and CSV · SmokySignal (40) | 99 | no | 1 | - | 200 | 540 |  | P1 title-double-brand; P0 canonical-missing; P1 broken-link |
| /about | 200 | More · SmokySignal (18) | 90 | no | 1 | - | 200 | 414 |  | P0 canonical-missing |
| /help | 200 | Help · SmokySignal (18) | 83 | no | 1 | - | 200 | 3322 |  | P0 canonical-missing |
| /relay | 200 | Discord and webhooks · SmokySignal (34) | 109 | no | 1 | - | 200 | 479 |  | P0 canonical-missing |
| /embed/help | 200 | Embed the status widget · SmokySignal (37) | 103 | no | 1 | - | 200 | 286 |  | P0 canonical-missing |
| /board | 200 | Board · SmokySignal (19) | 98 | no | 0 | - | 200 | 181 |  | P0 canonical-missing; P1 h1-missing |
| /legal | 200 | Legal · SmokySignal (19) | 33 | no | 0 | - | 200 | 443 |  | P2 description-short; P0 canonical-missing; P1 h1-missing |
| /plane/N305DK | 200 | SmokySignal · N305DK · SmokySignal (34) | 95 | no | 0 | - | 200 | 302 |  | P1 title-double-brand; P0 canonical-missing; P1 h1-missing; P1 description-duplicate |
| /plane/N422CT | 200 | SmokySignal · N422CT · SmokySignal (34) | 95 | no | 0 | - | 200 | 290 |  | P1 title-double-brand; P0 canonical-missing; P1 h1-missing; P1 description-duplicate |
| /road/i-5 | 200 | Planes over I-5 · SmokySignal (29) | 121 | no | 1 | - | 200 | 399 |  | P0 canonical-missing |
| /road/sr-512 | 200 | Planes over SR-512 · SmokySignal (32) | 125 | no | 1 | - | 200 | 314 |  | P0 canonical-missing |

## Issues

- P0 `/` canonical-missing
- P0 `/about` canonical-missing
- P0 `/aircraft` canonical-missing
- P0 `/board` canonical-missing
- P0 `/circling` canonical-missing
- P0 `/data` canonical-missing
- P0 `/embed/help` canonical-missing
- P0 `/flights` canonical-missing
- P0 `/forecast` canonical-missing
- P0 `/help` canonical-missing
- P0 `/legal` canonical-missing
- P0 `/plane/N305DK` canonical-missing
- P0 `/plane/N422CT` canonical-missing
- P0 `/program` canonical-missing
- P0 `/radar` canonical-missing
- P0 `/relay` canonical-missing
- P0 `/road` canonical-missing
- P0 `/road/i-5` canonical-missing
- P0 `/road/sr-512` canonical-missing
- P0 `/stats` canonical-missing
- P1 `/` description-duplicate: shared with /radar, /plane/N305DK, /plane/N422CT
- P1 `/board` h1-missing
- P1 `/circling` og-image-missing
- P1 `/data` title-double-brand: SmokySignal · Data and CSV · SmokySignal
- P1 `/data` broken-link: /plane/N3532K → HTTP 404
- P1 `/forecast` title-double-brand: SmokySignal · Forecast · SmokySignal
- P1 `/legal` h1-missing
- P1 `/plane/N305DK` title-double-brand: SmokySignal · N305DK · SmokySignal
- P1 `/plane/N305DK` h1-missing
- P1 `/plane/N305DK` description-duplicate: shared with /, /radar, /plane/N422CT
- P1 `/plane/N422CT` title-double-brand: SmokySignal · N422CT · SmokySignal
- P1 `/plane/N422CT` h1-missing
- P1 `/plane/N422CT` description-duplicate: shared with /, /radar, /plane/N305DK
- P1 `/radar` h1-missing
- P1 `/radar` description-duplicate: shared with /, /plane/N305DK, /plane/N422CT
- P1 `/seen` title-double-brand: Was that the plane I saw? · SmokySignal · SmokySignal
- P1 `/stats` title-double-brand: SmokySignal · Stats · SmokySignal
- P1 `/stats` broken-link: /plane/N3532K → HTTP 404
- P2 `/` thin: 62 words
- P2 `/flights` thin: 50 words
- P2 `/legal` description-short: 33 chars
- P2 `/radar` thin: 48 words

## Broken internal links

- `/plane/N3532K` HTTP 404, linked from `/stats`, `/data`
