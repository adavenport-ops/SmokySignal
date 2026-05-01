# SmokySignal — Brand Brief

A pocket reference for anyone (human or AI) building UI, marketing pages, or content for SmokySignal. Read this first before generating anything.

---

## 1. What it is

SmokySignal is a live-tracking app for Washington State Patrol (and partner agency) aircraft over the Puget Sound region. It tells motorcyclists, drivers, and curious locals — in one glance — whether the bird is up, where it is, and what it's watching.

**Coverage:** King County, Pierce County, and the I-5 / I-405 / SR-512 corridors.
**Sources tracked:** WSP "Smokey" fleet, King County Sheriff Air Support, Pierce County, FBI surveillance aircraft.
**Primary user:** sport-bike riders and weekend drivers who care about speed-trap awareness.

---

## 2. The name — origin story

The product name is a layered pun. Use this lore in marketing copy, the About page, and anywhere users ask "why 'Smoky'?"

### The campaign hat
WSP troopers (and most state highway patrols in the US) wear a flat-brimmed, high-crowned **campaign hat** — the same silhouette worn by the advertising icon **Smokey Bear**.

### CB radio slang
In the 1970s, peak CB-radio era, truckers coined a private vocabulary for warning each other about speed traps. Because of the campaign hat, troopers became **"Smokey" or "Smokey Bear"** on the airwaves. *Smokey and the Bandit* (1977) cemented it in pop culture.

### The aviation callsign
WSP Aviation embraced the nickname. Their fleet (mostly Cessnas with FLIR cameras for clocking speeders from the sky) operates under the official callsign **"Smokey,"** numbered Smokey 1, Smokey 4, etc.

### "SmokySignal"
Smokey (the bear / the trooper / the plane) + smoke signal (the original beacon-warning system) + signal (radio, transmission, alert). The product **is** the modern smoke signal — a quiet, glanceable warning that the bird is watching.

---

## 3. Voice & tone

**One-line summary:** Trucker-CB nostalgia meets modern aviation tracking. Confident, dry, occasionally playful. Never frantic or alarmist.

### Do
- Talk like a 1970s trucker who learned to fly: laconic, knowing, a little salty.
- Use radio-procedure cadence: short clauses, action verbs, no filler.
- Borrow CB slang **sparingly** as flavor — once or twice per screen, not every line.
- Keep status copy at a glance-able length (3–6 words for headlines, ≤140 chars for body).
- Default to "the bird," "Smokey," "eyes," "watching." Avoid "police," "cop," "law enforcement" — those flatten the voice.

### Don't
- Don't moralize about speeding. We don't tell users to slow down; we tell them what's overhead.
- Don't lean on emoji. The brand has zero emoji in product copy.
- Don't get cute on warnings. When Smokey is up *and* the user is speeding, copy is direct: "EASE OFF."
- Don't use exclamation marks. Ever.

### Vocabulary
| Use | Don't use |
|---|---|
| Smokey, the bird | the plane, aircraft, drone |
| up / down | active / inactive |
| watching | surveilling, monitoring |
| eye in the sky, nearest eye | nearest threat, nearest cop |
| all clear | safe, no danger |
| ease off | slow down, brake |
| send it | go fast, accelerate |
| corridor | road, area |

### CB-slang phrases (use as garnish, not mainline)
- "Breaker breaker."
- "10-4." / "Copy that."
- "Got your ears on?"
- "Smokey at your six." (behind you)
- "Back door's clear." (nothing behind)
- "Front door's clear." (nothing ahead)
- "Bear in the air."
- "Channel 19." (the trucker channel — use as easter egg)

### Voice examples

**Push notification — bird went up:**
> Smokey's up. I-5 northbound at Tukwila. 1,800′.

**Push notification — bird stood down:**
> Air's clean. Back door clear.

**Empty state — no aircraft:**
> Quiet skies. Send it.

**Speed warning (bird up + over limit):**
> EASE OFF — bird 4mi out, you're 7 over.

**About page hero:**
> Truckers called them Smokey. We just kept the name.

**404 page:**
> Lost your signal. Channel 19 still open.

---

## 4. Visual identity

### Logo
The wordmark is **"SmokySignal"** set in Inter, weight 800, tight tracking (-0.04em). The "S" of "Smoky" and the "S" of "Signal" are both capitalized — one word, two caps, no space.

The mark is the **trooper's campaign hat** — the same flat-brim, high-crown silhouette worn by WSP airmen and Smokey Bear, the headgear that earned the nickname on CB radios in the 70s. A small **signal blip and arc** sits just above the crown — equal parts circling aircraft and radio wave broadcasting outward.

The mark has two cuts:
- **Full mark** (default, ≥40px) — hat + signal arc + blip
- **Compact** (≤32px, favicons) — hat + blip only; the arc is dropped so the silhouette stays crisp at favicon scale

Always paired with the wordmark on first appearance; stands alone in tight contexts (favicon, app icon, app header). Generated from `brand/glyph.js` — never hand-redraw.

### Color
Built for dark, glanceable, on-a-handlebar use. Background is near-black; signal colors do all the work.

| Token | Hex | Use |
|---|---|---|
| `--bg-0` | `#0B0D10` | Page background |
| `--bg-1` | `#15181D` | Card surfaces |
| `--bg-2` | `#1E2229` | Raised surfaces, input fills |
| `--fg-0` | `#F2F4F7` | Primary text |
| `--fg-1` | `#A8AEB8` | Secondary text |
| `--fg-2` | `#6B7380` | Tertiary / metadata |
| `--hairline` | `#262B33` | Borders, dividers |
| `--alert` | `#FF7A1A` | Smokey is up. Speed warnings. |
| `--alert-dim` | `#FF7A1A22` | Alert backgrounds, glows |
| `--clear` | `#5DD9A7` | All clear. Safe states. |
| `--clear-dim` | `#5DD9A722` | Clear backgrounds |
| `--sky` | `#5BB6FF` | Map water, accent only |

**Rule:** orange (`--alert`) means *only* "Smokey is up" or "you should ease off." Never use it as a generic accent. Green (`--clear`) means *only* "no aircraft up." This semantic discipline is the whole product.

### Typography
- **Display & UI:** Inter, weights 500 / 600 / 700 / 800.
- **Mono / data:** JetBrains Mono, weights 500 / 600. Used for tail numbers (N305DK), altitude (1,800′), speed (62 mph), times (15:42), coordinates. Anything a pilot or trucker would read off a panel.
- **Tracking:** display sizes use `-0.04em`. UI sizes use 0. All-caps eyebrows use `+0.08em`.
- **Line-height:** 1.0 for display, 1.4 for body.

### Iconography
Stroke-based, 1.5px stroke, rounded caps. No filled icons except the plane glyph (which gets a subtle fill so it reads at 12px).

The **plane icon** is a top-down silhouette, not a side-view. This matters — it should look like something seen from below, looking up.

### Motion
- Pulses on live indicators: 1.6s ease-in-out blink, 0.4 → 1.0 opacity.
- Status changes (up → down): 240ms ease-out cross-fade.
- No bouncy, springy, or playful easing. The product is calm.

---

## 5. Layout principles

1. **The status is the page.** Whatever state Smokey is in dominates the viewport. Everything else is supporting cast.
2. **Glance-able first.** A rider at a stoplight should know in <1s whether to send it or not. Big type, semantic color, no decoration.
3. **Mono for data, sans for prose.** Anything numerical or callsign-y is JetBrains Mono. Everything else is Inter.
4. **Hairlines, not shadows.** Surfaces separate via `--hairline` borders, not drop shadows. Keeps the dark UI crisp.
5. **No icons-as-decoration.** Every icon either is interactive or labels data. Decorative iconography breaks the utility tone.

---

## 6. Asset inventory

All files are in `public/icons/` (after you copy them in from the brand kit bundle).

| File | Size | Purpose |
|---|---|---|
| `favicon.svg` | vector | Modern browsers |
| `favicon.ico` | 32×32 | Legacy fallback |
| `icon-192.png` | 192×192 | PWA / Android home screen |
| `icon-512.png` | 512×512 | PWA splash |
| `apple-touch-icon.png` | 180×180 | iOS home screen |
| `og-image.png` | 1200×630 | Open Graph / Twitter / link unfurls |
| `logo-mark.svg` | vector | Standalone glyph |
| `logo-wordmark.svg` | vector | Full lockup |
| `manifest.json` | — | PWA manifest |

### `<head>` snippet
```html
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/icons/favicon.ico" sizes="32x32" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="manifest" href="/icons/manifest.json" />
<meta name="theme-color" content="#0B0D10" />
<meta property="og:image" content="https://smokysignal.app/icons/og-image.png" />
<meta property="og:title" content="SmokySignal — Is the bird up?" />
<meta property="og:description" content="Live tracking of WSP aviation over Puget Sound. Know before you go." />
<meta name="twitter:card" content="summary_large_image" />
```

---

## 7. What to build next (suggestions for Claude Code)

These are good first jobs once the marketing site is scaffolded:

- **About / Origin page.** Tell the campaign-hat → CB-radio → Smokey-callsign → SmokySignal story. Long-scroll, narrative, with the orbit glyph as a recurring motif.
- **Hero copy:** "Got your ears on? Smokey's up." (or "Smokey's down" — server-rendered from current state).
- **Live status badge** on the marketing site that shows real-time count of birds airborne. Pulls from the same data source as the app.
- **404 page:** "Lost your signal. Channel 19 still open." with the orbit glyph spinning slowly.
- **Email/notification templates** in the same voice — short, radio-cadence, mono for data.

---

## 8. Things to refuse

If asked to do any of these, push back:
- Add emoji to product copy.
- Use the brand orange for a non-alert purpose (it dilutes the semantic).
- Add a "drive safe" disclaimer or moralizing copy.
- Make the logo cute, friendly, or rounded. The orbit glyph is sharp on purpose.
- Use stock-photo "police lights" or "speedometer" imagery in marketing. The brand never depicts authority — only the absence or presence of overhead watching.

---

*End of brief. When in doubt: laconic, dark, glanceable, mono-for-data, orange-means-bird, green-means-clear, no emoji, no exclamation marks.*
