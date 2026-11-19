// Press kit data: which launch-post media goes in the kit, the logo files
// scripts/marketing-assets.ts writes to public/press-kit/, and the citation
// line. Pure data plus tiny helpers; /press renders it.
//
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks, none
// of the voice-gate words. This is page copy.

export const PRESS_POST = "2026-11-19-the-big-update";
export const PRESS_MEDIA_BASE = `/blog/media/${PRESS_POST}`;

/** The six screenshots in the kit, in display order (ids in the post manifest). */
export const PRESS_SHOTS = ["home-phone", "home-desktop", "circling", "seen-fife", "board", "flight-card"] as const;
/** The hero 3D clip. */
export const PRESS_CLIP = "hero-3d";

export const CITATION =
  "Source: SmokySignal (smokysignal.app), built on public ADS-B from adsb.fi and adsb.lol (ODbL)";

/** The feedback address shown on /legal. */
export const PRESS_EMAIL = "feedback@smokysignal.app";

export type LogoFile = { id: string; label: string; file: string; format: "SVG" | "PNG"; note: string; dark: boolean };

/** Written by `npm run marketing:assets`. */
export const LOGO_FILES: readonly LogoFile[] = [
  { id: "mark-dark-svg", label: "Mark, for dark backgrounds", file: "smokysignal-mark-dark.svg", format: "SVG", note: "Amber, transparent", dark: true },
  { id: "mark-dark-png", label: "Mark, for dark backgrounds", file: "smokysignal-mark-dark.png", format: "PNG", note: "1024 px, transparent", dark: true },
  { id: "mark-light-svg", label: "Mark, for light backgrounds", file: "smokysignal-mark-light.svg", format: "SVG", note: "Deep amber, transparent", dark: false },
  { id: "mark-light-png", label: "Mark, for light backgrounds", file: "smokysignal-mark-light.png", format: "PNG", note: "1024 px, transparent", dark: false },
  { id: "wordmark-dark-svg", label: "Wordmark, for dark backgrounds", file: "smokysignal-wordmark-dark.svg", format: "SVG", note: "Mark and name", dark: true },
  { id: "wordmark-dark-png", label: "Wordmark, for dark backgrounds", file: "smokysignal-wordmark-dark.png", format: "PNG", note: "1440 px wide, transparent", dark: true },
  { id: "wordmark-light-svg", label: "Wordmark, for light backgrounds", file: "smokysignal-wordmark-light.svg", format: "SVG", note: "Mark and name", dark: false },
  { id: "wordmark-light-png", label: "Wordmark, for light backgrounds", file: "smokysignal-wordmark-light.png", format: "PNG", note: "1440 px wide, transparent", dark: false },
];

export function logoHref(f: LogoFile): string {
  return `/press-kit/${f.file}`;
}
