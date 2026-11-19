// Server-side reader for per-rider display preferences. Cookies are the
// transport so the SAME render path (server + client) sees the same value
// — no SSR/CSR divergence. Mirrors the simplicity of the rest of the app:
// no auth, no DB, just a cookie.

import { cookies } from "next/headers";
import {
  PALETTE_COOKIE,
  parsePaletteCookie,
  resolvePalette,
  type PaletteId,
} from "@/lib/radar-palettes";

export const TIME_FORMAT_COOKIE = "ss_time_format";
export type TimeFormat = "24" | "12";
export const DEFAULT_TIME_FORMAT: TimeFormat = "24";

/** Read the rider's preferred time format. Server Components only. */
export function getTimeFormatPref(): TimeFormat {
  const v = cookies().get(TIME_FORMAT_COOKIE)?.value;
  return v === "12" ? "12" : DEFAULT_TIME_FORMAT;
}

export function isHour12(pref: TimeFormat): boolean {
  return pref === "12";
}

// Contrast variant. We do NOT ship light mode — high-contrast stays
// dark, just lifts secondary text + hairline opacity so WCAG-AAA-leaning
// riders (or daytime-glare conditions) read the meta lines and dividers
// reliably. Stored via the same cookie pattern as TIME_FORMAT_COOKIE so
// the SSR/CSR rendered HTML stays identical.
export const CONTRAST_COOKIE = "ss_contrast";
export type ContrastMode = "normal" | "high";
export const DEFAULT_CONTRAST: ContrastMode = "normal";

/** Read the rider's preferred contrast mode. Server Components only. */
export function getContrastPref(): ContrastMode {
  const v = cookies().get(CONTRAST_COOKIE)?.value;
  return v === "high" ? "high" : DEFAULT_CONTRAST;
}

// Radar colour palette (lib/radar-palettes.ts). Same cookie pattern so
// SSR paints the rider's palette on first byte. With no pick on record,
// a rider on high contrast gets the High contrast palette.
export { PALETTE_COOKIE } from "@/lib/radar-palettes";

/** The rider's explicit palette pick, or null. Server Components only. */
export function getChosenPalette(): PaletteId | null {
  return parsePaletteCookie(cookies().get(PALETTE_COOKIE)?.value);
}

/** The palette to render. Server Components only. */
export function getPalettePref(): PaletteId {
  return resolvePalette(getChosenPalette(), getContrastPref());
}
