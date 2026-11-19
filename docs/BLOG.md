# Blog: posts, screenshots and clips

Posts live in `content/blog/YYYY-MM-DD-slug.md` (frontmatter in
`lib/blog-core.ts`). A post can carry screenshots and short clips of the app,
captured by a script from public prod and committed with the post.

## The flow

1. **Generate.** Weekly posts: `npm run blog:weekly -- --week-ending YYYY-MM-DD`.
   It writes the post and a media stub, `content/blog/media/<slug>.json`, with
   2-3 shots of the feature of the week. The shots open the `**Route:**` of the
   `## This week` item in `docs/BACKLOG.md` (home page when it has none). The
   post already carries matching image lines under "Feature of the week". A
   hand-written post: write `content/blog/media/<slug>.json` yourself.
2. **Capture.** `npm run blog:media -- --post <slug>`. Re-run one shot with
   `--only <id>`. Output goes to `public/blog/media/<slug>/` plus a
   `manifest.json` with dimensions, sizes and captions.
3. **Look.** Open every screenshot and every clip's poster, and pull a mid
   frame from each clip:
   `node_modules/ffmpeg-static/ffmpeg -ss 3 -i public/blog/media/<slug>/<id>.mp4 -frames:v 1 /tmp/mid.png`.
   A blank map, a loading state or a prompt card means fix the steps and
   re-run that shot.
4. **Edit.** Place each `![alt](/blog/media/<slug>/<id>.webp "caption")` (or
   `.mp4` for a clip) on its own line, in the section it shows. Captions follow
   the voice rules: no exclamation marks, no emoji, "Smokey" with the E, none
   of the voice-gate words.
5. **Commit** the post, the capture manifest and `public/blog/media/<slug>/`
   together. `npm test` checks that every reference resolves, every file
   exists and the folder fits the budget.
6. **Ping IndexNow** once the post is live on production:
   `npm run seo:indexnow -- --since <last week's ref>` (add `--dry-run`
   first to see the URL list). It submits the new post, `/blog` and any
   page whose file changed since that ref. The daily rollup cron also
   pings new posts, so a missed run catches up the next morning.
   Details: `docs/seo/PLAYBOOK.md`.

6. **Social pack.** `npm run marketing:social -- --post <slug>` reads the post
   and its `public/blog/media/<slug>/manifest.json` and writes
   `docs/marketing/weekly/<slug>.md`: a Reddit-ready summary with the best
   image, a Bluesky post (300 characters at most, link included), two Shorts
   captions that reference the week's clips, and a one-line Nextdoor blurb.
   `--dry-run` prints it, `--force` overwrites. It refuses to write a pack
   that fails the voice check (banned words, emoji, exclamation marks, the
   limits). Commit the pack with the post. Nothing is posted: the owner posts
   from his own accounts, using the subreddit notes in `docs/marketing/`.

## Requirements

- Playwright, resolvable from `NODE_PATH` or `node_modules`. It never
  downloads browsers. Chromium: `SS_CHROMIUM_EXECUTABLE_PATH`, else the newest
  `~/Library/Caches/ms-playwright/chromium_headless_shell-*`.
- `sharp` and `ffmpeg-static` are devDependencies (`npm ci`).
- 3D views render in software (SwiftShader). A 3D shot takes about 30 s.

## Capture manifest

```json
{
  "post": "2026-11-19-the-big-update",
  "shots": [
    {
      "id": "hero-3d",
      "kind": "clip",
      "url": "/flight/N305DK/20261118T0032?view=3d",
      "viewport": "desktop",
      "element": "[data-testid=\"flight-3d\"]",
      "steps": ["waitfor [data-testid=\"map3d-controls\"]", "wait 4000", "action orbit3d 1200", "start", "wait 6000"],
      "duration": 6,
      "posterAt": 3,
      "caption": "A real flight in 3D.",
      "alt": "What the clip shows, for a screen reader."
    }
  ]
}
```

| Field | |
|---|---|
| `id` | kebab-case file stem |
| `kind` | `screenshot` or `clip` |
| `url` | same-origin path. Admin and cron paths are refused |
| `viewport` | `phone` (iPhone 14, 390x844) or `desktop` (1440x900) |
| `steps` | the step list below |
| `duration` | clips only, seconds, 8 at most |
| `caption`, `alt` | required. Both pass the voice gate |
| `element` | crop to one element (screenshot or clip) |
| `fullPage` | screenshots: the whole page |
| `posterAt` | clips: seconds into the clip for the poster frame |
| `capture` | `"image"`: the url is an image (a flight card), fetched as is |
| `cookies` | `{ "ss_palette": "ember" }` |
| `init` | named init scripts: `quietPrompts` (always on), `speedWarningRider` |
| `target` | `"local"`: capture from a local `next start` of this checkout |
| `routes` | local only: `[{ "path": "/api/hotzones", "fixture": "fixtures/x.json" }]` |
| `illustrative` | the data is not real. The caption must say "illustrative" |

### Steps

| Step | |
|---|---|
| `goto /path` | navigate |
| `wait 1500` | ms, 30000 at most |
| `waitfor <selector>` | until visible |
| `click <selector>` | click |
| `hover <selector>` | hover |
| `press Meta+K` | key or chord |
| `type N305DK` | type into the focused field |
| `select <value> <selector>` | pick an option in a `<select>` |
| `scroll 600` | scroll by px (negative goes up) |
| `scrollto <selector>` | element to the top of the view |
| `hide <selector>` | hide matches |
| `action orbit3d 6000` | `orbit3d`, `rotate3d`, `dismissHint`, with a run time |
| `start` | clips: the clip starts here. Everything before is setup |

Clips record the whole run and are trimmed from `start` for `duration`
seconds. Phone clips record at device size (780x1688) and encode at 720 wide.
Desktop clips encode at 1152x720, or at the cropped element's size.

## Output and budget

- Screenshots: dpr 2, WebP plus a palette PNG fallback, 1440 px wide at most.
- Clips: H.264 MP4 (faststart, no audio, 25 fps, crf 28) plus VP9 WebM and a
  JPG poster.
- **Budget:** each MP4 and each WebM is 1.5 MB at most. The script re-encodes
  at a higher crf (28, 31, 34, 37, 40) until it fits, then fails. A post's
  media folder is 12 MB at most. Over budget, the script exits 1 and names the
  biggest files.

## Read-only, and data that is not live

The capture only reads. Every request a page makes to the capture origin must
be a GET or HEAD. Analytics beacons are dropped, and admin and cron paths are
refused, both in the browser and when the manifest is validated.

Prod ignores `?mock=`. When a shot needs a state that is not live (the speed
warning, Smokey up during a quiet hour), set `"target": "local"`. The script
runs `next start` on this checkout's `.next` build (run `npx next build`
first), with the KV variables blanked so it never touches the production
store. Pass `--local-base http://localhost:3000` to use a server that is
already running instead. Serve fixtures with `routes`, mark the shot
`"illustrative": true`, and say "illustrative" in the caption. Prefer real
history (a past flight, a past date on /seen) over fixtures.

## Rendering

`components/BlogMarkdown.tsx` turns a media line into a `<figure>`:

- `.webp` / `.png`: `<picture>` (WebP source, PNG `<img>`), lazy, with
  `width`/`height` from the manifest so nothing shifts as it loads.
- `.mp4` / `.webm`: `components/BlogVideo.tsx` (the only client code in a
  post). Muted, looped, inline. It plays only while on screen and pauses when
  scrolled away. It never autoplays under prefers-reduced-motion (poster plus
  play button). A 44 px play/pause button is always there.

A reference that is not in the post's `manifest.json` renders nothing. The CSP
allows `media-src 'self'`.
