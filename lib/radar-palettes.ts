// Rider-selectable colour palettes for the /radar overlays.
//
// Each palette paints four things on top of the neutral charcoal basemap
// (lib/basemap.ts):
//   heat     30-day hot-zone heatmap, MapLibre heatmap-color stops
//   route    30-day flight-path threads, colour + opacity by zoom
//   history  per-tail lines in history mode: six distinct colours plus
//            one "many" colour once more than six tails show
//   live     the dark halo disc behind live aircraft glyphs
//   roadTint the basemap road network by class (lib/basemap.ts):
//            motorway, major (primary / secondary) and street (tertiary
//            and below, fading in from about z12). Muted on purpose: the
//            roads give the map some colour without outranking the heat,
//            the routes or a live aircraft.
//
// Rules every palette holds (lib/radar-palettes.test.ts enforces them):
//   - Heat and routes differ in LIGHTNESS, not only hue, so the two read
//     apart in greyscale and for colour-blind riders.
//   - Route colour clears 3:1 against the basemap land and water greys.
//   - History colours stay out of the palette's own heat hues and clear
//     the categorical CVD / normal-vision floors on adjacent slots.
//   - Road tints take a hue far from the palette's heat and routes, sit
//     at least 0.15 OKLCH L below the route colour, and stay well under
//     the heat midpoint, the route and the live marker in salience
//     (lib/basemap.test.ts has the numbers).
//   - Live aircraft never get lost in the heat: the glyph is near-white
//     on a dark halo disc with an identity ring (alert orange for police,
//     neutral for every other mission). The disc keeps 3:1 against every
//     heat stop, so a glyph over the hottest cell still reads.
//
// Heat may be warm now (Ember is the default, at the owner's request).
// Alert orange #FF7A1A keeps one job on the map: the ring around a live
// police tail. Ember stays on the red side of it.
//
// The choice is a cookie (ss_palette) so SSR renders the right palette;
// parse / serialize live here, pure, so node:test can cover them.

import type { ExpressionSpecification } from "maplibre-gl";
import type { ZoomStops } from "./radar-zoom";

export const PALETTE_IDS = ["ember", "magma", "ice", "high-contrast", "mono"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const DEFAULT_PALETTE: PaletteId = "ember";
/** Default when the rider has high contrast on and never picked a palette. */
export const HIGH_CONTRAST_PALETTE: PaletteId = "high-contrast";

export type HeatStops = ReadonlyArray<readonly [number, string]>;

/** Basemap road colours, opaque, painted at line-opacity 1 over the
 *  land grey (BASEMAP.land in lib/basemap.ts). */
export type RoadTint = {
  /** motorway + trunk */
  motorway: string;
  /** primary + secondary */
  major: string;
  /** tertiary, minor, service, track; fades in from about z12 */
  street: string;
};

export type RadarPalette = {
  id: PaletteId;
  /** Chip label and aria-label stem. */
  label: string;
  /** One-line description for the settings page. */
  description: string;
  heat: HeatStops;
  route: { color: string; opacity: ZoomStops };
  history: { tails: readonly [string, string, string, string, string, string]; many: string };
  live: { halo: string; haloOpacity: number };
  roadTint: RoadTint;
};

/** Route opacity for the bright-thread palettes. Routes sit above the
 *  heat now, so they carry a touch more opacity than the old cool
 *  threads to stay readable over a hot cell. */
const THREAD_OPACITY: ZoomStops = [
  [4, 0.46],
  [7, 0.44],
  [9, 0.4],
  [12, 0.4],
  [15, 0.44],
  [18, 0.5],
];

/** High contrast runs a darker saturated cyan near-opaque: bright sun
 *  washes out anything thinner. */
const SUN_OPACITY: ZoomStops = [
  [4, 0.78],
  [7, 0.76],
  [9, 0.74],
  [12, 0.74],
  [15, 0.78],
  [18, 0.84],
];

export const PALETTES: Record<PaletteId, RadarPalette> = {
  ember: {
    id: "ember",
    label: "Ember",
    description: "Deep red to amber heat, pale sand routes.",
    heat: [
      [0, "rgba(0,0,0,0)"],
      [0.05, "rgba(150,22,26,0.3)"],
      [0.3, "rgba(190,30,28,0.48)"],
      [0.55, "rgba(222,50,32,0.62)"],
      [0.8, "rgba(244,104,40,0.74)"],
      [1.0, "rgba(255,178,66,0.86)"],
    ],
    route: { color: "#F1E8D8", opacity: THREAD_OPACITY },
    history: {
      tails: ["#179FA5", "#9477DD", "#05A388", "#5F87E7", "#36A558", "#0497D2"],
      many: "#9DB8E8",
    },
    live: { halo: "#0B0D10", haloOpacity: 0.82 },
    // Slate-teal: the cool side of the wheel from the red heat and the
    // sand routes.
    roadTint: { motorway: "#4E757D", major: "#455D62", street: "#3C494C" },
  },
  magma: {
    id: "magma",
    label: "Magma",
    description: "Perceptual purple to pale yellow heat, ice routes.",
    heat: [
      [0, "rgba(0,0,0,0)"],
      [0.05, "rgba(84,26,140,0.3)"],
      [0.3, "rgba(134,36,150,0.48)"],
      [0.55, "rgba(200,58,120,0.62)"],
      [0.8, "rgba(246,122,86,0.74)"],
      [1.0, "rgba(252,236,170,0.86)"],
    ],
    route: { color: "#BFF0F5", opacity: THREAD_OPACITY },
    history: {
      tails: ["#05A388", "#3690E3", "#36A558", "#089AC3", "#6D9D2D", "#179FA5"],
      many: "#8FD3C8",
    },
    live: { halo: "#0B0D10", haloOpacity: 0.82 },
    // Muted sand, away from the purple-pink heat and the ice routes.
    // A touch more chroma than the others: at less, protan / deutan
    // riders lose it against the pink heat stop at the same lightness.
    roadTint: { motorway: "#796F45", major: "#5E5942", street: "#4A473A" },
  },
  ice: {
    id: "ice",
    label: "Ice",
    description: "The original cool heat, indigo to ice, sand routes.",
    heat: [
      [0, "rgba(0,0,0,0)"],
      [0.05, "rgba(72,74,170,0.16)"],
      [0.35, "rgba(70,110,215,0.38)"],
      [0.7, "rgba(64,190,210,0.52)"],
      [1.0, "rgba(205,240,255,0.65)"],
    ],
    route: { color: "#EADFC8", opacity: THREAD_OPACITY },
    history: {
      tails: ["#B08505", "#9B74D9", "#55A144", "#BE67B7", "#929300", "#D06091"],
      many: "#D8C08A",
    },
    live: { halo: "#0B0D10", haloOpacity: 0.82 },
    // Clay, a warm grey against the blue heat, far darker than the
    // sand routes.
    roadTint: { motorway: "#816A5D", major: "#64554C", street: "#4F4641" },
  },
  "high-contrast": {
    id: "high-contrast",
    label: "High contrast",
    description: "Yellow to white heat, saturated cyan routes, for bright sun.",
    heat: [
      [0, "rgba(0,0,0,0)"],
      [0.05, "rgba(138,122,0,0.34)"],
      [0.3, "rgba(201,176,0,0.56)"],
      [0.55, "rgba(236,212,0,0.72)"],
      [0.8, "rgba(255,242,122,0.84)"],
      [1.0, "rgba(255,255,255,0.94)"],
    ],
    route: { color: "#0096D6", opacity: SUN_OPACITY },
    history: {
      tails: ["#05A388", "#7C7FE5", "#D86165", "#0895DA", "#55A144", "#B36BC4"],
      many: "#36C9E0",
    },
    live: { halo: "#000000", haloOpacity: 0.9 },
    // Neutral grey, held 0.15 L under the cyan routes so the yellow heat
    // and the cyan stay the loudest things in bright sun. That caps the
    // motorway at 2.4:1 on the land (a 3:1 grey would sit level with the
    // cyan in lightness).
    roadTint: { motorway: "#5E5E5E", major: "#525252", street: "#464646" },
  },
  mono: {
    id: "mono",
    label: "Mono",
    description: "Grey to white heat, white routes. No hue at all.",
    heat: [
      [0, "rgba(0,0,0,0)"],
      [0.05, "rgba(110,110,110,0.3)"],
      [0.3, "rgba(135,135,135,0.46)"],
      [0.55, "rgba(165,165,165,0.6)"],
      [0.8, "rgba(208,208,208,0.72)"],
      [1.0, "rgba(250,250,250,0.86)"],
    ],
    route: { color: "#FFFFFF", opacity: THREAD_OPACITY },
    history: {
      tails: ["#D86353", "#0895DA", "#B08505", "#8C79E0", "#55A144", "#BE67B7"],
      many: "#9DB8E8",
    },
    live: { halo: "#000000", haloOpacity: 0.88 },
    // Very faint grey, darker than the lowest grey heat stop so low
    // density never reads as a road.
    roadTint: { motorway: "#525252", major: "#4B4B4B", street: "#444444" },
  },
};

export function getPalette(id: PaletteId | string | null | undefined): RadarPalette {
  return isPaletteId(id) ? PALETTES[id] : PALETTES[DEFAULT_PALETTE];
}

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === "string" && (PALETTE_IDS as readonly string[]).includes(v);
}

// ─── MapLibre expressions ────────────────────────────────────────────

/** `["interpolate", ["linear"], ["heatmap-density"], d0, c0, ...]`. */
export function heatColorExpressionFor(p: RadarPalette): ExpressionSpecification {
  const out: unknown[] = ["interpolate", ["linear"], ["heatmap-density"]];
  for (const [d, c] of p.heat) out.push(d, c);
  return out as ExpressionSpecification;
}

/** Heat colour at a density, interpolated the way MapLibre does (RGBA). */
export function heatAt(p: RadarPalette, density: number): string {
  const s = p.heat;
  if (density <= s[0]![0]) return s[0]![1];
  for (let i = 1; i < s.length; i++) {
    const [d1, c1] = s[i]!;
    if (density <= d1) {
      const [d0, c0] = s[i - 1]!;
      return lerpRgba(c0, c1, (density - d0) / (d1 - d0));
    }
  }
  return s[s.length - 1]![1];
}

function rgbaParts(c: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 1];
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (!m) return [0, 0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

function lerpRgba(a: string, b: string, t: number): string {
  const A = rgbaParts(a);
  const B = rgbaParts(b);
  const v = (i: number) => A[i]! + (B[i]! - A[i]!) * t;
  return `rgba(${Math.round(v(0))},${Math.round(v(1))},${Math.round(v(2))},${Math.round(v(3) * 1000) / 1000})`;
}

/** The stop colour with its alpha dropped (`rgb(...)`), for swatches. */
export function opaque(c: string): string {
  const [r, g, b] = rgbaParts(c);
  return `rgb(${r},${g},${b})`;
}

/** Swatch for UI that labels the heat layer (the HOT ZONES pill). */
export function heatSwatch(p: RadarPalette): string {
  return opaque(heatAt(p, 0.6));
}

/** CSS gradient for the picker chip: the heat ramp, low to high. */
export function heatGradientCss(p: RadarPalette): string {
  const stops = p.heat
    .filter(([d]) => d > 0)
    .map(([d, c]) => `${opaque(c)} ${Math.round(d * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** Per-tail history colours for a palette. Tails are de-duped and sorted
 *  so the mapping is stable across reloads and shared links. */
export function assignPaletteTailColors(
  p: RadarPalette,
  tails: readonly string[],
  perTailMax: number,
): Record<string, string> {
  const uniq = [...new Set(tails.map((t) => t.toUpperCase()))].sort();
  const out: Record<string, string> = {};
  const perTail = uniq.length <= perTailMax;
  uniq.forEach((t, i) => {
    out[t] = perTail ? p.history.tails[i % p.history.tails.length]! : p.history.many;
  });
  return out;
}

// ─── cookie ──────────────────────────────────────────────────────────

export const PALETTE_COOKIE = "ss_palette";
export const PALETTE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
/** Same-tab broadcast when the rider picks a palette on /radar. */
export const PALETTE_CHANGE_EVENT = "ss-radar-palette-change";

/** Cookie value → palette id, or null when unset / unknown. */
export function parsePaletteCookie(raw: string | null | undefined): PaletteId | null {
  if (!raw) return null;
  const v = decodeURIComponent(raw).trim().toLowerCase();
  return isPaletteId(v) ? v : null;
}

/** `document.cookie` assignment string for a palette choice. */
export function serializePaletteCookie(id: PaletteId): string {
  return `${PALETTE_COOKIE}=${id}; Path=/; Max-Age=${PALETTE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Read the palette cookie out of a full `Cookie` header / document.cookie. */
export function paletteFromCookieHeader(header: string | null | undefined): PaletteId | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === PALETTE_COOKIE) return parsePaletteCookie(part.slice(eq + 1));
  }
  return null;
}

/** The palette to render: the rider's pick, else High contrast when the
 *  contrast pref is high, else the default. */
export function resolvePalette(
  chosen: PaletteId | null | undefined,
  contrast: "normal" | "high" | null | undefined,
): PaletteId {
  if (chosen && isPaletteId(chosen)) return chosen;
  return contrast === "high" ? HIGH_CONTRAST_PALETTE : DEFAULT_PALETTE;
}
