// Canonical design tokens — see Design/BRAND.md section 4 for the full
// system. Two locked deviations from BRAND.md, decided in P3-BRAND v4:
//   1. `alert` keeps #f5b840 (matches the icon files in Design/) instead
//      of BRAND.md's #FF7A1A — the icons are the source of truth for
//      brand orange and we don't regenerate them here.
//   2. #FF7A1A is added as a NEW reserved token `warn` (not yet used; will
//      drive the over-the-limit speed-warning UX).
// Mirror in app/globals.css and tailwind.config.ts — keep all three in sync.
export const SS_TOKENS = {
  bg0: "#0B0D10", // page
  bg1: "#15181D", // card
  bg2: "#1E2229", // raised
  bg3: "#1E2229", // legacy alias for bg2 — used in a few places, kept to avoid churn
  fg0: "#F2F4F7", // primary text
  fg1: "#A8AEB8", // secondary text
  fg2: "#82899A", // tertiary / metadata — bumped from #6B7380 to clear WCAG AA 4.5:1 on bg-0
  fg3: "#3f4651", // legacy quaternary — kept for some inline styles
  alert: "#f5b840", // SEMANTIC: speed-enforcement plane up
  alertDim: "rgba(245,184,64,0.13)",
  warn: "#FF7A1A", // SEMANTIC: rider over speed (RESERVED — not yet used)
  warnDim: "rgba(255,122,26,0.13)",
  danger: "#dc2626", // emergency-squawk + speed-warning red
  clear: "#5DD9A7", // SEMANTIC: no enforcement plane up
  clearDim: "rgba(93,217,167,0.13)",
  sky: "#5BB6FF", // map water + sparing accent
  skyDim: "rgba(91,182,255,0.13)",
  hairline: "rgba(255,255,255,0.06)",
  hairline2: "rgba(255,255,255,0.10)",
} as const;

export type SSToken = keyof typeof SS_TOKENS;
