// Shared basemap for every MapLibre map in the app (radar, home mini-map,
// plane track, plane history, tracks, spots, per-plane heat, Flight3D).
//
// MapTiler `dataviz-dark` is a neutral charcoal style: grey land, darker
// grey water, no blue anywhere. applyNeutralBasemap() pins land / water to
// the greys the palette contrast tests (lib/radar-palettes.test.ts,
// lib/basemap.test.ts) measure against, then paints the road network in
// the rider's palette road tint (RadarPalette.roadTint): motorways a
// muted, clearly visible tint, major roads a duller step of it, streets a
// faint step that only fades in from about z12. The heat ramp, routes and
// live aircraft stay the loudest things on the map.
//
// Road layers are found by classifying the style's own layers (source
// layer, class filter, brunnel), not by hard-coded ids, so a style
// revision that splits the network into per-class layers still gets
// tinted. The fixture in lib/fixtures/ is the layer list this was built
// against.
//
// Picking a palette repaints the roads in place with setPaintProperty
// (PALETTE_CHANGE_EVENT); no style reload.
//
// Same host as before (api.maptiler.com), so the CSP in next.config.mjs
// is unchanged.

import type {
  ExpressionSpecification,
  Map as MaplibreMap,
} from "maplibre-gl";
import {
  PALETTE_CHANGE_EVENT,
  getPalette,
  paletteFromCookieHeader,
  resolvePalette,
  type PaletteId,
  type RoadTint,
} from "./radar-palettes";

export const BASEMAP_STYLE_ID = "dataviz-dark";

export function basemapStyleUrl(key: string): string {
  return `https://api.maptiler.com/maps/${BASEMAP_STYLE_ID}/style.json?key=${key}`;
}

/** The greys the basemap paints, after applyNeutralBasemap(). The
 *  palette tests check route, heat and road colours against these. */
export const BASEMAP = {
  land: "#232323",
  water: "#131313",
  /** Neutral road grey, the fallback when no palette applies. */
  road: "#3a3a3a",
  /** Casing under motorways and major roads: a step darker than the
   *  land, so a tinted line keeps a crisp edge over hillshade. */
  roadCasing: "#191919",
  label: "#7d7d7d",
  /** Halo behind road / place labels. */
  labelHalo: "#141414",
} as const;

/** Paint overrides by MapTiler layer id. Missing layers are skipped, so a
 *  style revision that renames one degrades to the stock paint. Roads are
 *  not listed: applyRoadTint() finds them by class. */
export const BASEMAP_PAINT: ReadonlyArray<readonly [string, string, string]> = [
  ["Background", "background-color", BASEMAP.land],
  ["Landcover", "fill-color", BASEMAP.land],
  ["Water", "fill-color", BASEMAP.water],
  ["River", "line-color", BASEMAP.water],
];

// ─── road classification ─────────────────────────────────────────────

export type RoadTier = "motorway" | "major" | "street";
export const ROAD_TIERS: readonly RoadTier[] = ["motorway", "major", "street"];

/** OpenMapTiles `transportation.class` values per tier. The last three
 *  street classes are not in OMT; they cover other vector schemas.
 *  `track` is left out: dataviz-dark draws tracks with its path layers,
 *  and a track inside the road network still falls to the street tint
 *  (the street arm is the match default). */
export const ROAD_TIER_CLASSES: Record<RoadTier, readonly string[]> = {
  motorway: ["motorway", "trunk"],
  major: ["primary", "secondary"],
  street: ["tertiary", "minor", "service", "residential", "unclassified", "living_street"],
};

const ALL_ROAD_CLASSES = ROAD_TIERS.flatMap((t) => ROAD_TIER_CLASSES[t]);

export type RoadRole = "road" | "casing" | "tunnel" | "tunnel-casing" | "label";

export type RoadLayerClass = { id: string; role: RoadRole; tiers: RoadTier[] };

/** The bits of a style layer the classifier reads. */
export type StyleLayerLike = {
  id: string;
  type: string;
  "source-layer"?: string;
  filter?: unknown;
};

type ClassConstraint = { allow: Set<string> | null; deny: Set<string> };

/** Which `class` values a filter lets through, for the legacy filter
 *  syntax the MapTiler styles use and the common expression forms.
 *  Anything it cannot read counts as "no constraint". */
function classConstraint(filter: unknown): ClassConstraint {
  const out: ClassConstraint = { allow: null, deny: new Set() };
  const allow = (vals: string[]) => {
    const next = new Set(vals);
    out.allow = out.allow ? new Set([...out.allow].filter((v) => next.has(v))) : next;
  };
  const isClassKey = (k: unknown) =>
    k === "class" || (Array.isArray(k) && k[0] === "get" && k[1] === "class" && k.length === 2);
  const literal = (v: unknown): string[] => {
    if (Array.isArray(v) && v[0] === "literal" && Array.isArray(v[1])) return v[1].map(String);
    if (Array.isArray(v)) return v.map(String);
    return [String(v)];
  };
  const walk = (f: unknown) => {
    if (!Array.isArray(f) || f.length === 0) return;
    const [op, ...args] = f as unknown[];
    if (op === "all") {
      for (const a of args) walk(a);
      return;
    }
    if (op === "match" && isClassKey(args[0]) && args[2] === true) {
      // ["match", ["get","class"], [...], true, false]
      allow(literal(args[1]));
      return;
    }
    if (!isClassKey(args[0])) return;
    const rest = args.slice(1);
    if (op === "in") {
      // legacy ["in","class",a,b] or expression ["in",["get","class"],["literal",[...]]]
      allow(rest.length === 1 && Array.isArray(rest[0]) ? literal(rest[0]) : rest.map(String));
    } else if (op === "!in") {
      for (const v of rest) out.deny.add(String(v));
    } else if (op === "==") {
      allow([String(rest[0])]);
    } else if (op === "!=") {
      out.deny.add(String(rest[0]));
    }
  };
  walk(filter);
  return out;
}

function hasTunnel(filter: unknown): boolean {
  const s = JSON.stringify(filter ?? null);
  return /"==","brunnel","tunnel"|\["==",\["get","brunnel"\],"tunnel"\]/.test(s);
}

/**
 * Classify one style layer. Returns null for anything that is not a road
 * line or a road label: rail, paths, piers, aeroways, bridges (fills),
 * and layers whose class filter admits no road class.
 */
export function classifyRoadLayer(layer: StyleLayerLike): RoadLayerClass | null {
  const sl = layer["source-layer"];
  const isLabel = layer.type === "symbol" && sl === "transportation_name";
  const isLine = layer.type === "line" && sl === "transportation";
  if (!isLabel && !isLine) return null;
  const c = classConstraint(layer.filter);
  const admitted = ALL_ROAD_CLASSES.filter((k) => (c.allow ? c.allow.has(k) : true) && !c.deny.has(k));
  const tiers = ROAD_TIERS.filter((t) => ROAD_TIER_CLASSES[t].some((k) => admitted.includes(k)));
  if (tiers.length === 0) return null;
  if (isLabel) return { id: layer.id, role: "label", tiers };
  const casing = /outline|casing|case\b/i.test(layer.id);
  const tunnel = hasTunnel(layer.filter);
  const role: RoadRole = tunnel ? (casing ? "tunnel-casing" : "tunnel") : casing ? "casing" : "road";
  return { id: layer.id, role, tiers };
}

/** Every road layer in a style, in draw order. */
export function classifyRoadLayers(layers: ReadonlyArray<StyleLayerLike>): RoadLayerClass[] {
  const out: RoadLayerClass[] = [];
  for (const l of layers) {
    const c = classifyRoadLayer(l);
    if (c) out.push(c);
  }
  return out;
}

/** Id of the first road line layer (draw order), for slotting a layer
 *  such as hillshade underneath the roads. */
export function firstRoadLayerId(layers: ReadonlyArray<StyleLayerLike>): string | undefined {
  return classifyRoadLayers(layers).find((c) => c.role !== "label")?.id;
}

// ─── paint expressions ───────────────────────────────────────────────

const CLASS_GET: ExpressionSpecification = ["get", "class"];

/** Zoom where streets start to fade in, and where they are fully tinted. */
export const STREET_FADE: readonly [number, number] = [11, 12.5];

/** `match` on class over the tiers a layer covers, one value per tier.
 *  A single tier collapses to the plain value. */
function byTier<T>(tiers: readonly RoadTier[], value: (t: RoadTier) => T): T | ExpressionSpecification {
  if (tiers.length === 1) return value(tiers[0]!);
  const out: unknown[] = ["match", CLASS_GET];
  const last = tiers[tiers.length - 1]!;
  for (const t of tiers.slice(0, -1)) out.push([...ROAD_TIER_CLASSES[t]], value(t));
  out.push(value(last));
  return out as ExpressionSpecification;
}

/** line-color for a road layer: tint per tier; streets fade in from the
 *  land grey between STREET_FADE[0] and STREET_FADE[1]. */
export function roadColorExpression(
  tint: RoadTint,
  tiers: readonly RoadTier[],
): string | ExpressionSpecification {
  if (!tiers.includes("street")) return byTier(tiers, (t) => tint[t]);
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    STREET_FADE[0],
    byTier(tiers, (t) => (t === "street" ? BASEMAP.land : tint[t])),
    STREET_FADE[1],
    byTier(tiers, (t) => tint[t]),
  ] as ExpressionSpecification;
}

/** Road core widths in px by zoom. Motorways a step wider than major
 *  roads at every zoom; streets zero until z11. */
export const ROAD_WIDTHS: Record<RoadTier, ReadonlyArray<readonly [number, number]>> = {
  motorway: [
    [6, 0.7],
    [8, 1.1],
    [10, 1.8],
    [12, 2.8],
    [14, 4.6],
    [16, 8],
    [18, 13],
    [20, 22],
  ],
  major: [
    [6, 0.3],
    [8, 0.6],
    [10, 1.1],
    [12, 1.9],
    [14, 3.4],
    [16, 6.5],
    [18, 11],
    [20, 20],
  ],
  street: [
    [6, 0],
    [8, 0],
    [10, 0],
    [12, 0.6],
    [14, 1.7],
    [16, 3.8],
    [18, 8],
    [20, 15],
  ],
};

/** Casing adds this much width (px) around motorway / major cores; none
 *  under streets, which stay faint. Zero below z10. */
export const CASING_EXTRA: ReadonlyArray<readonly [number, number]> = [
  [6, 0],
  [8, 0],
  [10, 1],
  [12, 1.4],
  [14, 2],
  [16, 2.6],
  [18, 3.2],
  [20, 4],
];

function widthAt(stops: ReadonlyArray<readonly [number, number]>, z: number): number {
  return stops.find(([sz]) => sz === z)![1];
}

/** line-width for a road (or casing) layer, per tier, with motorway ramps
 *  drawn at major-road width. */
export function roadWidthExpression(tiers: readonly RoadTier[], casing = false): ExpressionSpecification {
  const zooms = ROAD_WIDTHS.motorway.map(([z]) => z);
  const out: unknown[] = ["interpolate", ["exponential", 1.5], ["zoom"]];
  for (const z of zooms) {
    const w = (t: RoadTier) => {
      const core = widthAt(ROAD_WIDTHS[t], z);
      if (!casing) return core;
      return t === "street" ? 0 : core + widthAt(CASING_EXTRA, z);
    };
    const v = byTier(tiers, (t) =>
      t === "motorway" ? (["match", ["get", "ramp"], 1, w("major"), w("motorway")] as unknown as number) : w(t),
    );
    out.push(z, v);
  }
  return out as ExpressionSpecification;
}

/**
 * The motorway colour a live road layer is painted with, read back from
 * its line-color (string, match, or zoom interpolate of either). For the
 * p14 audit and QA stamps. Null when it cannot tell.
 */
export function motorwayColorOf(paint: unknown): string | null {
  if (typeof paint === "string") return paint;
  if (!Array.isArray(paint)) return null;
  if (paint[0] === "interpolate" || paint[0] === "step") {
    return motorwayColorOf(paint[paint.length - 1]);
  }
  if (paint[0] === "match") {
    for (let i = 2; i < paint.length - 1; i += 2) {
      const labels = paint[i];
      const hit = Array.isArray(labels) ? labels.includes("motorway") : labels === "motorway";
      if (hit) return motorwayColorOf(paint[i + 1]);
    }
    return motorwayColorOf(paint[paint.length - 1]);
  }
  return null;
}

// ─── apply ───────────────────────────────────────────────────────────

type MapLike = Pick<MaplibreMap, "getStyle" | "setPaintProperty" | "getPaintProperty" | "getContainer">;

function setPaint(map: MapLike, id: string, prop: string, value: unknown) {
  try {
    map.setPaintProperty(id, prop as never, value as never);
  } catch {
    /* layer shape differs in this style revision; keep stock paint */
  }
}

/** Paint every classified road layer with a palette's road tint. Safe to
 *  call again on palette change (setPaintProperty only). */
export function applyRoadTint(map: MapLike, tint: RoadTint): RoadLayerClass[] {
  let layers: StyleLayerLike[] = [];
  try {
    layers = (map.getStyle()?.layers ?? []) as StyleLayerLike[];
  } catch {
    return [];
  }
  const roads = classifyRoadLayers(layers);
  for (const r of roads) {
    switch (r.role) {
      case "road":
      case "tunnel":
        setPaint(map, r.id, "line-color", roadColorExpression(tint, r.tiers));
        setPaint(map, r.id, "line-width", roadWidthExpression(r.tiers));
        break;
      case "casing":
      case "tunnel-casing":
        setPaint(map, r.id, "line-color", BASEMAP.roadCasing);
        setPaint(map, r.id, "line-width", roadWidthExpression(r.tiers, true));
        break;
      case "label":
        // Legible but recessive: neutral grey on a dark halo, never the
        // tint (text wears text colours).
        setPaint(map, r.id, "text-color", BASEMAP.label);
        setPaint(map, r.id, "text-halo-color", BASEMAP.labelHalo);
        break;
    }
  }
  // QA stamp: what the first road layer is actually painted with, read
  // back from MapLibre (the p14 audit checks it is not grey).
  const first = roads.find((r) => r.role === "road");
  try {
    const el = map.getContainer();
    if (first && el) {
      const painted = motorwayColorOf(map.getPaintProperty(first.id, "line-color"));
      if (painted) el.setAttribute("data-road-motorway", painted);
      el.setAttribute("data-road-layer", first.id);
    }
  } catch {
    /* no container (tests) */
  }
  return roads;
}

/** Palette from document.cookie + body[data-contrast], client only. */
function clientPaletteId(): PaletteId {
  if (typeof document === "undefined") return resolvePalette(null, null);
  const contrast = document.body?.dataset.contrast === "high" ? "high" : "normal";
  return resolvePalette(paletteFromCookieHeader(document.cookie), contrast);
}

const followed = new WeakSet<object>();

/**
 * Apply BASEMAP_PAINT and the road tint for `palette` (default: the
 * rider's palette cookie). Call from the map's `load` (or `style.load`)
 * handler; safe to call more than once. The first call per map also
 * follows palette picks (PALETTE_CHANGE_EVENT) until the map is removed.
 */
export function applyNeutralBasemap(map: MaplibreMap, palette?: PaletteId): void {
  for (const [id, prop, value] of BASEMAP_PAINT) {
    try {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, prop as never, value);
      }
    } catch {
      /* layer shape differs in this style revision; keep stock paint */
    }
  }
  applyRoadTint(map, getPalette(palette ?? clientPaletteId()).roadTint);

  if (typeof window === "undefined" || followed.has(map)) return;
  followed.add(map);
  const onPalette = (e: Event) => {
    const next = (e as CustomEvent<PaletteId>).detail;
    if (next) applyRoadTint(map, getPalette(next).roadTint);
  };
  window.addEventListener(PALETTE_CHANGE_EVENT, onPalette);
  map.once("remove", () => window.removeEventListener(PALETTE_CHANGE_EVENT, onPalette));
}
