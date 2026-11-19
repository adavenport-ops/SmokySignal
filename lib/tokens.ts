// Canonical design tokens. See design/BRAND.md section 4 for the system.
// Mirror the colours in app/globals.css and tailwind.config.ts; keep all
// three in sync.
//
// COLOUR RULES (read before you reach for a warm colour)
//
//   alert  #FF7A1A  Means one thing: Smokey is up (or "ease off"). Hero
//                   headline + halo in the up state, the up status pill,
//                   up chips, live-aircraft dots and tracks on maps.
//                   Never a CTA, never a link colour, never a "selected"
//                   state, never decoration. If the sky is clear, nothing
//                   on the page should be orange. One exception: the
//                   /radar heat palette the rider picks (Ember, the
//                   default, runs red to amber; lib/radar-palettes.ts).
//                   On the map, alert orange is the live police ring.
//   warn            Alias of alert for the speed-warning path ("EASE OFF").
//                   Same hue on purpose: BRAND.md gives orange both jobs.
//   clear  #5DD9A7  Means one thing: nothing is up. All-clear hero, clear
//                   pill, "alerts on" confirmation.
//   brand  #F5B840  The amber of the hat mark (logo, favicon, app icons).
//                   Used for the mark only. Not for buttons, links or
//                   text; that amber is too close to alert to sit next to
//                   it as a UI accent.
//   cta / ctaInk    Neutral primary button: near-white fill, near-black
//                   ink. Generic accents (Arm alerts, Add zone, Save,
//                   selected toggles) use this or a hairline outline.
//   sky    #5BB6FF  Map water, the rider's own position, focus rings.
//   danger #dc2626  Emergency squawk and destructive actions only.
//
// TYPE RULES
//
//   Five-step scale, TYPE below: 56 display / 28 title / 18 heading /
//   14 body / 11 micro. Page h1 is TYPE.title. Rider-facing text never
//   renders below TYPE_FLOOR (12px): metadata that used to sit at 10-11px
//   is 12px now, and at that size it uses fg1, not fg2 (fg2 at 10-11px
//   washes out in direct sun). TYPE.micro is kept for fixed-size canvas
//   overlays (map labels, chart ticks), never page copy.
//   Numerics (times, altitudes, tails, counts) are mono with tabular-nums:
//   use the `ss-mono` class or NUMERIC below.
//
// TARGET RULES
//
//   Every control is at least TAP_MIN (44px) in both axes; prefer
//   TAP_PREFERRED (48px) for primary actions (gloved hands).
export const SS_TOKENS = {
  bg0: "#0B0D10", // page
  bg1: "#15181D", // card
  bg2: "#1E2229", // raised
  bg3: "#1E2229", // legacy alias for bg2, kept to avoid churn
  fg0: "#F2F4F7", // primary text
  fg1: "#A8AEB8", // secondary text + 12px metadata
  fg2: "#82899A", // tertiary; only at >=13px. Bumped from #6B7380 for WCAG AA on bg-0
  fg3: "#3f4651", // legacy quaternary, kept for some inline styles
  alert: "#FF7A1A", // SEMANTIC: Smokey is up. Nothing else.
  alertDim: "rgba(255,122,26,0.13)",
  warn: "#FF7A1A", // SEMANTIC: rider over speed ("EASE OFF"). Same hue as alert.
  warnDim: "rgba(255,122,26,0.13)",
  brand: "#F5B840", // the hat mark only (logo, icons). Not a UI accent.
  cta: "#F2F4F7", // neutral primary button fill
  ctaInk: "#0B0D10", // text on a cta fill
  danger: "#dc2626", // emergency-squawk + destructive actions
  clear: "#5DD9A7", // SEMANTIC: nothing up
  clearDim: "rgba(93,217,167,0.13)",
  sky: "#5BB6FF", // map water, rider position, focus ring
  skyDim: "rgba(91,182,255,0.13)",
  hairline: "rgba(255,255,255,0.06)",
  hairline2: "rgba(255,255,255,0.10)",
} as const;

export type SSToken = keyof typeof SS_TOKENS;

/** Five-step type scale (px). Page h1 = title. See TYPE RULES above. */
export const TYPE = {
  display: 56,
  title: 28,
  heading: 18,
  body: 14,
  micro: 11,
} as const;

/** Minimum rendered size for any rider-facing text, metadata included. */
export const TYPE_FLOOR = 12;

/** Minimum and preferred interactive target sizes (px). */
export const TAP_MIN = 44;
export const TAP_PREFERRED = 48;

/** Spread into a style object for numerics outside an `ss-mono` element. */
export const NUMERIC = {
  fontVariantNumeric: "tabular-nums",
} as const;
