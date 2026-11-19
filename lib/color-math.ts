// Colour math for the radar palettes (lib/radar-palettes.ts) and their
// tests. Pure functions, no DOM, so node:test can check every palette
// against the basemap without a browser.
//
// The formulas follow the dataviz validator the palettes were tuned with:
// WCAG 2 relative luminance + contrast ratio, OKLab / OKLCH for
// lightness, and the Machado-Oliveira-Fernandes (2009) severity-1.0
// simulation for protan / deutan colour-blind checks. Delta E is
// Euclidean distance in OKLab x100.

export type Rgb = readonly [number, number, number]; // 0-255
export type Rgba = readonly [number, number, number, number]; // rgb 0-255, alpha 0-1

/** Parse `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)`. Throws on anything else. */
export function parseColor(input: string): Rgba {
  const s = input.trim();
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 1];
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  }
  throw new Error(`parseColor: unsupported colour "${input}"`);
}

export function toHex([r, g, b]: Rgb | Rgba): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Source-over composite of `top` (with its alpha times `opacity`) on an
 *  opaque `bottom`, in sRGB space, the way the browser blends a layer. */
export function composite(top: string, bottom: string, opacity = 1): string {
  const [r, g, b, a] = parseColor(top);
  const [R, G, B] = parseColor(bottom);
  const t = Math.max(0, Math.min(1, a * opacity));
  return toHex([r * t + R * (1 - t), g * t + G * (1 - t), b * t + B * (1 - t)]);
}

/** Linear interpolation between two colours, alpha included (MapLibre's
 *  `interpolate linear` on colours works in RGBA the same way). */
export function mixRgba(a: string, b: string, t: number): string {
  const A = parseColor(a);
  const B = parseColor(b);
  const m = (i: number) => A[i]! + (B[i]! - A[i]!) * t;
  return `rgba(${Math.round(m(0))},${Math.round(m(1))},${Math.round(m(2))},${Math.round(m(3) * 1000) / 1000})`;
}

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function linear(color: string): [number, number, number] {
  const [r, g, b] = parseColor(color);
  return [s2lin(r / 255), s2lin(g / 255), s2lin(b / 255)];
}

export function relativeLuminance(color: string): number {
  const [r, g, b] = linear(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, alpha ignored (composite first if it matters). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function oklabFromLinear([r, g, b]: readonly [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklab(color: string): [number, number, number] {
  return oklabFromLinear(linear(color));
}

/** OKLCH [L 0-1, C, hue degrees]. Hue is meaningless when C is ~0. */
export function oklch(color: string): [number, number, number] {
  const [L, a, b] = oklab(color);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, Math.hypot(a, b), h];
}

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

export type CvdKind = keyof typeof MACHADO;

function simulate(color: string, kind: CvdKind): [number, number, number] {
  const [r, g, b] = linear(color);
  const M = MACHADO[kind];
  const c = (v: number) => Math.max(0, Math.min(1, v));
  return [
    c(M[0][0] * r + M[0][1] * g + M[0][2] * b),
    c(M[1][0] * r + M[1][1] * g + M[1][2] * b),
    c(M[2][0] * r + M[2][1] * g + M[2][2] * b),
  ];
}

/** OKLab Delta E x100. With `kind`, both colours are first simulated
 *  for that colour-vision deficiency. */
export function deltaE(a: string, b: string, kind?: CvdKind): number {
  const A = oklabFromLinear(kind ? simulate(a, kind) : linear(a));
  const B = oklabFromLinear(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/** Worst of protan / deutan Delta E between two colours. */
export function cvdDeltaE(a: string, b: string): number {
  return Math.min(deltaE(a, b, "protan"), deltaE(a, b, "deutan"));
}
