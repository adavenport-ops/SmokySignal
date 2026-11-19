"use client";

// 3D flight view: MapLibre terrain + hillshade under a deck.gl overlay that
// draws each path at its true (exaggerated) altitude, a faint curtain down to
// the ground, orbit rings, airport labels and a replay with a fading trail.
//
// Loaded only through next/dynamic (ssr: false) once a rider picks 3D, so
// deck.gl never lands in a page's first-load JS. Reusable: takes any number
// of paths plus optional live markers, so /radar and date-range overlays can
// mount the same component later.
//
// Vertical scale: terrain exaggeration and altitude share TERRAIN_EXAGGERATION
// (lib/flight3d.ts), so height above the ground stays proportional. HUD
// numbers are always true altitude.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type Map as MaplibreMap,
  type StyleSpecification,
  type SourceSpecification,
} from "maplibre-gl";
import { applyNeutralBasemap, basemapStyleUrl } from "@/lib/basemap";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { WebMercatorViewport, type Layer } from "@deck.gl/core";
import {
  LineLayer,
  PathLayer,
  ScatterplotLayer,
  SolidPolygonLayer,
  TextLayer,
} from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";
import { detectOrbits, type OrbitSegment } from "@/lib/orbit";
import { inferArrival, inferDeparture, type AirportMatch } from "@/lib/airports";
import { formatTs } from "@/lib/time";
import {
  MAX_VERTICES,
  TERRAIN_EXAGGERATION,
  advanceProgress,
  altitudeZ,
  boundsOf,
  decimateAll,
  hexToRgba,
  orbitAltitudeFt,
  orbitLabel,
  padBounds,
  progressToTs,
  relativeTs,
  replayClock,
  resolveTrack,
  ringPositions,
  foldBearing,
  principalBearing,
  MIN_RING_NM,
  NM_TO_M,
  sampleAt,
  smoothTrack,
  smoothingFactor,
  toPosition,
  tsToProgress,
  type Position3,
  type ResolvedPoint,
} from "@/lib/flight3d";

/** Path color: the alert orange, which on maps means a Smokey track. */
export const RIBBON_HEX = SS_TOKENS.alert;

export type Flight3DPath = {
  id: string;
  points: TrackPoint[];
  /** "#RRGGBB". Defaults to the ribbon orange. */
  color?: string;
};

export type Flight3DMarker = {
  id: string;
  lat: number;
  lon: number;
  altFt: number | null;
  color?: string;
  label?: string;
};

type Props = {
  paths: Flight3DPath[];
  /** Live aircraft to pin in the scene (e.g. a later /radar 3D mode). */
  markers?: Flight3DMarker[];
  /** CSS height. Default: most of a phone screen, capped on desktop. */
  height?: number | string;
  /** Show the replay scrubber + animated marker. Default true. */
  replay?: boolean;
  /** Mark orbits and departure / arrival fields. Default true. */
  annotate?: boolean;
  hour12?: boolean;
  /** Called when WebGL2 or the map fails; parent swaps in the 2D map. */
  onUnavailable?: (reason: string) => void;
};

const PITCH = 60;
/** Camera yaw off the side-on view: landscape, then portrait. */
const BEARING = -18;
const PORTRAIT_SLANT = -42;
const INTRO_MS = 2400;
const DEM_EXAGGERATION = TERRAIN_EXAGGERATION;
const MAPTILER_DEM = (key: string) =>
  `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${key}`;
const TERRARIUM_TILES =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

type PathModel = {
  id: string;
  rgba: [number, number, number, number];
  full: ResolvedPoint[];
  /** Decimated, then spline-smoothed: what gets drawn and replayed. */
  verts: ResolvedPoint[];
  positions: Position3[];
  timestamps: number[];
  orbits: OrbitSegment[];
  orbitAlts: number[];
  dep: AirportMatch | null;
  arr: AirportMatch | null;
};

function demSource(key: string | undefined): SourceSpecification {
  return key
    ? { type: "raster-dem", url: MAPTILER_DEM(key), tileSize: 256 }
    : {
        type: "raster-dem",
        tiles: [TERRARIUM_TILES],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 15,
        attribution: "Terrain: Mapzen / AWS Open Data",
      };
}

/** Keyless fallback: dark background + hillshade only. */
function bareStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "ss-bg", type: "background", paint: { "background-color": SS_TOKENS.bg0 } }],
  };
}

function monoFamily(): string {
  if (typeof window === "undefined") return "monospace";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return v ? `${v}, "JetBrains Mono", ui-monospace, Menlo, monospace` : "ui-monospace, Menlo, monospace";
}

type Pad = { top: number; bottom: number; left: number; right: number };
/** A screen-space box (px around a projected anchor) that must also fit, e.g. a label. */
type Box = { pos: Position3; left: number; right: number; up: number; down: number };

/**
 * Center + zoom that fit `pts` (3D, altitude included) inside the padded
 * screen at a given pitch and bearing. MapLibre's cameraForBounds fits the
 * geographic bbox corners, which wastes most of the frame on a diagonal or
 * pitched track; this projects the actual points and converges in a few
 * passes.
 */
function fitCamera(
  pts: Position3[],
  width: number,
  height: number,
  bearing: number,
  pitch: number,
  pad: Pad,
  maxZoom: number,
  boxes: ReadonlyArray<Box> = [],
): { center: [number, number]; zoom: number } | null {
  if (pts.length === 0 || width <= 0 || height <= 0) return null;
  let lon = 0;
  let lat = 0;
  for (const p of pts) {
    lon += p[0];
    lat += p[1];
  }
  lon /= pts.length;
  lat /= pts.length;
  let zoom = 10;
  const availW = Math.max(40, width - pad.left - pad.right);
  const availH = Math.max(40, height - pad.top - pad.bottom);
  for (let pass = 0; pass < 6; pass++) {
    const vp = new WebMercatorViewport({ width, height, longitude: lon, latitude: lat, zoom, pitch, bearing });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const [x, y] = vp.project(p) as [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (const b of boxes) {
      const [x, y] = vp.project(b.pos) as [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x - b.left);
      maxX = Math.max(maxX, x + b.right);
      minY = Math.min(minY, y - b.up);
      maxY = Math.max(maxY, y + b.down);
    }
    if (!Number.isFinite(minX)) return null;
    const usedW = Math.max(1, maxX - minX);
    const usedH = Math.max(1, maxY - minY);
    const cx = (minX + maxX) / 2 - (pad.left + availW / 2);
    const cy = (minY + maxY) / 2 - (pad.top + availH / 2);
    const next = vp.unproject([width / 2 + cx, height / 2 + cy]) as [number, number];
    if (Number.isFinite(next[0]) && Number.isFinite(next[1])) {
      lon = next[0];
      lat = next[1];
    }
    zoom = Math.min(maxZoom, zoom + Math.log2(Math.min(availW / usedW, availH / usedH)));
  }
  return { center: [lon, lat], zoom };
}

/** Up to `max` path vertices plus their ground footprints, for framing. */
function framingPoints(models: ReadonlyArray<{ positions: Position3[] }>, max = 400): Position3[] {
  const all = models.flatMap((m) => m.positions);
  const step = Math.max(1, Math.ceil(all.length / max));
  const out: Position3[] = [];
  for (let i = 0; i < all.length; i += step) {
    const p = all[i]!;
    out.push(p, [p[0], p[1], 0]);
  }
  return out;
}

/** Label footprints for framing: orbit callouts above rings, field tags below. */
function labelBoxes(
  models: ReadonlyArray<{ orbits: OrbitSegment[]; orbitAlts: number[]; dep: AirportMatch | null; arr: AirportMatch | null }>,
): Box[] {
  const out: Box[] = [];
  for (const m of models) {
    m.orbits.forEach((o, k) => {
      const lines = orbitLabel(o).split(" · ");
      const longest = Math.max(lines[0]!.length, lines.slice(1).join(" · ").length);
      const half = (longest * 7.4) / 2 + 10;
      const z = altitudeZ(m.orbitAlts[k] ?? 0);
      out.push({ pos: [o.centroid.lon, o.centroid.lat, z], left: half, right: half, up: 70, down: 0 });
    });
    for (const a of [m.dep, m.arr]) {
      if (a) out.push({ pos: [a.lon, a.lat, 0], left: 60, right: 60, up: 0, down: 34 });
    }
  }
  return out;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const NO_MARKERS: Flight3DMarker[] = [];
/** Translucent layers must not write depth or they hide what is behind them. */
const NO_DEPTH_WRITE = { depthWriteEnabled: false } as const;

export default function Flight3D({
  paths,
  markers = NO_MARKERS,
  height = "clamp(420px, 66vh, 640px)",
  replay = true,
  annotate = true,
  hour12 = false,
  onUnavailable,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const groundRef = useRef<number[][]>([]);
  const fontRef = useRef<string>("monospace");
  const rafRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const playingRef = useRef(false);
  const readyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // ---- data model --------------------------------------------------------
  const model = useMemo(() => {
    const resolved = paths.map((p) => resolveTrack(p.points));
    const decimated = decimateAll(resolved, MAX_VERTICES);
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const r of resolved) {
      if (r.length === 0) continue;
      tMin = Math.min(tMin, r[0]!.ts);
      tMax = Math.max(tMax, r[r.length - 1]!.ts);
    }
    if (!Number.isFinite(tMin)) {
      tMin = 0;
      tMax = 0;
    }
    const clock = replayClock(tMin, tMax);
    const subdiv = smoothingFactor(decimated.reduce((s, d) => s + d.length, 0));
    const models: PathModel[] = paths.map((p, i) => {
      const full = resolved[i]!;
      const verts = smoothTrack(decimated[i]!, subdiv);
      const orbits = annotate ? detectOrbits(p.points) : [];
      return {
        id: p.id,
        rgba: hexToRgba(p.color ?? RIBBON_HEX),
        full,
        verts,
        positions: verts.map((v) => toPosition(v)),
        timestamps: verts.map((v) => relativeTs(clock, v.ts)),
        orbits,
        orbitAlts: orbits.map((o) => orbitAltitudeFt(full, o)),
        dep: annotate ? inferDeparture(p.points) : null,
        arr: annotate ? inferArrival(p.points) : null,
      };
    });
    const bounds = boundsOf([
      ...resolved,
      markers.map((m) => ({ lat: m.lat, lon: m.lon })),
    ]);
    const axis = principalBearing(resolved.flat());
    return { models, clock, axis, bounds: bounds ? padBounds(bounds, 2) : null };
  }, [paths, markers, annotate]);

  const modelRef = useRef(model);
  modelRef.current = model;

  // ---- layers ------------------------------------------------------------
  // Static layers (ribbon, curtain, rings, labels, live markers) are rebuilt
  // only when their inputs change; per-frame replay only swaps the trail and
  // the aircraft marker, so deck.gl never re-tessellates the curtain mid-play.
  const staticRef = useRef<{
    model: unknown;
    ground: unknown;
    markers: unknown;
    font: string;
    layers: Layer[];
  } | null>(null);

  const buildStatic = useCallback((): Layer[] => {
    const { models } = modelRef.current;
    const ground = groundRef.current;
    const font = fontRef.current;
    const map = mapRef.current;
    const layers: Layer[] = [];
    const noDepthWrite = NO_DEPTH_WRITE;

    models.forEach((m, pi) => {
      const g = ground[pi] ?? [];
      const groundAt = (k: number) => g[k] ?? 0;
      const [r, gg, b] = m.rgba;

      // Curtain: translucent vertical wall from the path down to the ground.
      const quads: Position3[][] = [];
      for (let k = 0; k < m.positions.length - 1; k++) {
        const a = m.positions[k]!;
        const c = m.positions[k + 1]!;
        quads.push([
          [a[0], a[1], groundAt(k)],
          [c[0], c[1], groundAt(k + 1)],
          [c[0], c[1], c[2]],
          [a[0], a[1], a[2]],
        ]);
      }
      layers.push(
        new SolidPolygonLayer<Position3[]>({
          id: `curtain-${m.id}`,
          data: quads,
          getPolygon: (d) => d,
          _full3d: true,
          filled: true,
          extruded: false,
          getFillColor: [r, gg, b, 60],
          parameters: noDepthWrite,
        }),
      );
      // Sparse vertical ticks give the curtain some texture.
      const step = Math.max(1, Math.round(m.positions.length / 70));
      const ticks: { s: Position3; t: Position3 }[] = [];
      for (let k = 0; k < m.positions.length; k += step) {
        const p = m.positions[k]!;
        ticks.push({ s: [p[0], p[1], groundAt(k)], t: p });
      }
      layers.push(
        new LineLayer<{ s: Position3; t: Position3 }>({
          id: `ticks-${m.id}`,
          data: ticks,
          getSourcePosition: (d) => d.s,
          getTargetPosition: (d) => d.t,
          getColor: [r, gg, b, 120],
          getWidth: 1,
          widthUnits: "pixels",
          parameters: noDepthWrite,
        }),
      );
      // Ground track.
      layers.push(
        new PathLayer<Position3[]>({
          id: `shadow-${m.id}`,
          data: [m.positions.map((p, k) => [p[0], p[1], groundAt(k) + 2] as Position3)],
          getPath: (d) => d,
          getColor: [242, 244, 247, 70],
          getWidth: 2,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
        }),
      );
      // Ribbon: wide soft glow + bright core.
      layers.push(
        new PathLayer<Position3[]>({
          id: `glow-${m.id}`,
          data: [m.positions],
          getPath: (d) => d,
          getColor: [r, gg, b, 48],
          getWidth: 9,
          widthUnits: "pixels",
          billboard: true,
          jointRounded: true,
          capRounded: true,
          parameters: noDepthWrite,
        }),
        new PathLayer<Position3[]>({
          id: `core-${m.id}`,
          data: [m.positions],
          getPath: (d) => d,
          getColor: [r, gg, b, 235],
          getWidth: 3,
          widthUnits: "pixels",
          billboard: true,
          jointRounded: true,
          capRounded: true,
        }),
      );
    });

    // Orbit rings + labels.
    const rings: { path: Position3[]; label: string; mid: Position3; top: Position3 }[] = [];
    for (const m of models) {
      m.orbits.forEach((o, k) => {
        const z = altitudeZ(m.orbitAlts[k] ?? 0);
        const path = ringPositions(o.centroid, o.radiusNm, z);
        // Two short lines read on a phone; the chip under the map has the full line.
        const [head, ...rest] = orbitLabel(o).split(" · ");
        // The label floats on a short leader above the ring so it never
        // sits on top of the pattern it describes.
        const lift = Math.max(350, Math.max(o.radiusNm, MIN_RING_NM) * NM_TO_M * 0.75);
        rings.push({
          path,
          label: `${head}\n${rest.join(" · ")}`,
          mid: [o.centroid.lon, o.centroid.lat, z],
          top: [o.centroid.lon, o.centroid.lat, z + lift],
        });
      });
    }
    if (rings.length > 0) {
      layers.push(
        new PathLayer<(typeof rings)[number]>({
          id: "orbit-ring",
          data: rings,
          getPath: (d) => d.path,
          getColor: [242, 244, 247, 210],
          getWidth: 2,
          widthUnits: "pixels",
          billboard: true,
          parameters: noDepthWrite,
        }),
        new LineLayer<(typeof rings)[number]>({
          id: "orbit-leader",
          data: rings,
          getSourcePosition: (d) => d.mid,
          getTargetPosition: (d) => d.top,
          getColor: [242, 244, 247, 140],
          getWidth: 1,
          widthUnits: "pixels",
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
        new TextLayer<(typeof rings)[number]>({
          id: "orbit-label",
          data: rings,
          getPosition: (d) => d.top,
          getText: (d) => d.label,
          fontFamily: font,
          characterSet: "auto",
          getSize: 12,
          getColor: [242, 244, 247, 255],
          getAlignmentBaseline: "bottom",
          getPixelOffset: [0, -6],
          lineHeight: 1.25,
          background: true,
          getBackgroundColor: [11, 13, 16, 215],
          getBorderColor: [242, 244, 247, 60],
          getBorderWidth: 1,
          backgroundPadding: [8, 5],
          backgroundBorderRadius: 6,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
      );
    }

    // Departure / arrival fields.
    const fields = new Map<string, { a: AirportMatch; tags: Set<string>; z: number }>();
    models.forEach((m) => {
      for (const [a, tag] of [
        [m.dep, "DEP"],
        [m.arr, "ARR"],
      ] as const) {
        if (!a) continue;
        const prev = fields.get(a.id);
        if (prev) prev.tags.add(tag);
        else fields.set(a.id, { a, tags: new Set([tag]), z: 0 });
      }
    });
    const fieldData = [...fields.values()].map((f) => {
      const elev = map?.queryTerrainElevation([f.a.lon, f.a.lat]) ?? 0;
      return {
        pos: [f.a.lon, f.a.lat, Math.max(0, elev) + 3] as Position3,
        text: `${f.a.id} · ${[...f.tags].join("/")}`,
      };
    });
    if (fieldData.length > 0) {
      layers.push(
        new ScatterplotLayer<(typeof fieldData)[number]>({
          id: "field-dot",
          data: fieldData,
          getPosition: (d) => d.pos,
          getRadius: 4,
          radiusUnits: "pixels",
          billboard: true,
          getFillColor: [168, 174, 184, 255],
          getLineColor: [11, 13, 16, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          stroked: true,
        }),
        new TextLayer<(typeof fieldData)[number]>({
          id: "field-label",
          data: fieldData,
          getPosition: (d) => d.pos,
          getText: (d) => d.text,
          fontFamily: font,
          characterSet: "auto",
          getSize: 11,
          getColor: [168, 174, 184, 255],
          getPixelOffset: [0, 14],
          getAlignmentBaseline: "top",
          background: true,
          getBackgroundColor: [11, 13, 16, 190],
          backgroundPadding: [5, 3],
          backgroundBorderRadius: 4,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
      );
    }

    // Live markers.
    if (markers.length > 0) {
      const live = markers.map((mk) => {
        const z = altitudeZ(mk.altFt ?? 0);
        const elev = map?.queryTerrainElevation([mk.lon, mk.lat]) ?? 0;
        return {
          pos: [mk.lon, mk.lat, z] as Position3,
          ground: Math.max(0, elev),
          rgba: hexToRgba(mk.color ?? RIBBON_HEX),
          label: mk.label ?? "",
        };
      });
      layers.push(
        new LineLayer<(typeof live)[number]>({
          id: "live-drop",
          data: live,
          getSourcePosition: (d) => [d.pos[0], d.pos[1], d.ground],
          getTargetPosition: (d) => d.pos,
          getColor: (d) => [d.rgba[0], d.rgba[1], d.rgba[2], 150],
          getWidth: 1.5,
          widthUnits: "pixels",
        }),
        new ScatterplotLayer<(typeof live)[number]>({
          id: "live-dot",
          data: live,
          getPosition: (d) => d.pos,
          getRadius: 7,
          radiusUnits: "pixels",
          billboard: true,
          stroked: true,
          getFillColor: (d) => d.rgba,
          getLineColor: [11, 13, 16, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 2,
        }),
        new TextLayer<(typeof live)[number]>({
          id: "live-label",
          data: live.filter((d) => d.label),
          getPosition: (d) => d.pos,
          getText: (d) => d.label,
          fontFamily: font,
          characterSet: "auto",
          getSize: 11,
          getColor: [242, 244, 247, 255],
          getPixelOffset: [0, -18],
          background: true,
          getBackgroundColor: [11, 13, 16, 200],
          backgroundPadding: [5, 3],
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
      );
    }
    return layers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers]);

  const buildDynamic = useCallback(
    (prog: number): Layer[] => {
      const { models, clock } = modelRef.current;
      const map = mapRef.current;
      const ts = progressToTs(clock, prog);
      const relNow = relativeTs(clock, ts);
      const layers: Layer[] = [];
      const noDepthWrite = NO_DEPTH_WRITE;
      // Replay: fading trail + aircraft marker with a drop line.
      if (replay) {
        const span = clock.t1 - clock.t0;
        layers.push(
          new TripsLayer<PathModel>({
            id: "trail",
            data: models,
            getPath: (d) => d.positions,
            getTimestamps: (d) => d.timestamps,
            getColor: [255, 244, 232, 255],
            getWidth: 6,
            widthUnits: "pixels",
            billboard: true,
            jointRounded: true,
            capRounded: true,
            fadeTrail: true,
            trailLength: Math.max(180, span * 0.1),
            currentTime: relNow,
            parameters: { depthCompare: "always", depthWriteEnabled: false },
          }),
        );
        const heads = models
          .map((m) => {
            const s = sampleAt(m.verts, ts);
            if (!s) return null;
            const elev = map?.queryTerrainElevation([s.lon, s.lat]) ?? 0;
            return { pos: toPosition(s), ground: Math.max(0, elev), rgba: m.rgba };
          })
          .filter((h): h is NonNullable<typeof h> => h != null);
        layers.push(
          new LineLayer<(typeof heads)[number]>({
            id: "head-drop",
            data: heads,
            getSourcePosition: (d) => [d.pos[0], d.pos[1], d.ground],
            getTargetPosition: (d) => d.pos,
            getColor: [242, 244, 247, 150],
            getWidth: 1.5,
            widthUnits: "pixels",
            parameters: noDepthWrite,
          }),
          new ScatterplotLayer<(typeof heads)[number]>({
            id: "head-glow",
            data: heads,
            getPosition: (d) => d.pos,
            getRadius: 16,
            radiusUnits: "pixels",
            billboard: true,
            getFillColor: (d) => [d.rgba[0], d.rgba[1], d.rgba[2], 70],
            parameters: { depthCompare: "always", depthWriteEnabled: false },
          }),
          new ScatterplotLayer<(typeof heads)[number]>({
            id: "head",
            data: heads,
            getPosition: (d) => d.pos,
            getRadius: 6,
            radiusUnits: "pixels",
            billboard: true,
            stroked: true,
            getFillColor: [242, 244, 247, 255],
            getLineColor: (d) => d.rgba,
            lineWidthUnits: "pixels",
            getLineWidth: 2.5,
            parameters: { depthCompare: "always", depthWriteEnabled: false },
          }),
        );
      }

      return layers;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replay],
  );

  const render = useCallback(
    (prog: number) => {
      const c = staticRef.current;
      if (
        !c ||
        c.model !== modelRef.current ||
        c.ground !== groundRef.current ||
        c.markers !== markers ||
        c.font !== fontRef.current
      ) {
        staticRef.current = {
          model: modelRef.current,
          ground: groundRef.current,
          markers,
          font: fontRef.current,
          layers: buildStatic(),
        };
      }
      overlayRef.current?.setProps({ layers: [...staticRef.current!.layers, ...buildDynamic(prog)] });
    },
    [buildStatic, buildDynamic, markers],
  );

  // ---- camera ------------------------------------------------------------
  /**
   * Look at the flight's long axis from the side so the curtain shows
   * height. Portrait screens get a steeper diagonal so a long track uses the
   * tall frame instead of a thin strip.
   */
  const homeBearing = useCallback((map: MaplibreMap) => {
    const c = map.getContainer();
    const portrait = c.clientHeight > c.clientWidth * 1.05;
    const axis = modelRef.current.axis;
    return foldBearing(axis - 90 + (portrait ? PORTRAIT_SLANT : BEARING));
  }, []);

  const frame = useCallback((animate: boolean) => {
    const map = mapRef.current;
    const b = modelRef.current.bounds;
    if (!map || !b) return;
    const bearing = homeBearing(map);
    const c = map.getContainer();
    const pad = Math.round(Math.min(c.clientWidth, c.clientHeight) * 0.07);
    const pts = framingPoints(modelRef.current.models);
    if (pts.length === 0) pts.push([b.minLon, b.minLat, 0], [b.maxLon, b.maxLat, 0]);
    const cam = fitCamera(
      pts,
      c.clientWidth,
      c.clientHeight,
      bearing,
      PITCH,
      { top: pad + 70, bottom: pad + 64, left: pad, right: pad },
      14,
      labelBoxes(modelRef.current.models),
    );
    if (!cam) return;
    const target = { ...cam, bearing, pitch: PITCH };
    if (animate) {
      map.easeTo({ ...target, duration: INTRO_MS, easing: (t) => 1 - Math.pow(1 - t, 3) });
    } else {
      map.jumpTo(target);
    }
  }, [homeBearing]);

  /** Swing the camera onto an orbit ring and park the replay at its start. */
  const focusOrbit = useCallback(
    (o: OrbitSegment) => {
      const map = mapRef.current;
      if (!map) return;
      setPlaying(false);
      const p = tsToProgress(modelRef.current.clock, o.startTs);
      progressRef.current = p;
      setProgress(p);
      render(p);
      const z = altitudeZ(orbitAltitudeFt(modelRef.current.models[0]?.full ?? [], o));
      const ring = ringPositions(o.centroid, Math.max(o.radiusNm * 1.6, 0.6), z, 24);
      const pts = ring.flatMap((p) => [p, [p[0], p[1], 0] as Position3]);
      const c = map.getContainer();
      const pad = Math.round(Math.min(c.clientWidth, c.clientHeight) * 0.1);
      const cam = fitCamera(
        pts,
        c.clientWidth,
        c.clientHeight,
        map.getBearing(),
        PITCH,
        { top: pad + 90, bottom: pad + 64, left: pad, right: pad },
        14.5,
      );
      if (!cam) return;
      const target = { ...cam, bearing: map.getBearing(), pitch: PITCH };
      if (prefersReducedMotion()) map.jumpTo(target);
      else map.easeTo({ ...target, duration: 1600, easing: (t) => 1 - Math.pow(1 - t, 3) });
    },
    [render],
  );

  // ---- mount -------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const fail = (reason: string) => {
      setFailed(reason);
      onUnavailable?.(reason);
    };

    const probe = document.createElement("canvas").getContext("webgl2");
    if (!probe) {
      fail("webgl2");
      return;
    }

    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const reduced = prefersReducedMotion();
    const b = modelRef.current.bounds;
    const center: [number, number] = b
      ? [(b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2]
      : [-122.3, 47.6];

    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: key
          ? basemapStyleUrl(key)
          : bareStyle(),
        center,
        zoom: 9,
        pitch: 0,
        bearing: 0,
        maxPitch: 80,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        attributionControl: { compact: true },
        dragRotate: true,
        touchPitch: true,
        touchZoomRotate: true,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      fail("map");
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.enableRotation();

    // Tile hiccups are expected on flaky mobile links; keep them off the
    // error console and let the map retry. A rejected basemap style (bad key,
    // origin not allowed) drops to the keyless terrain-only style instead of
    // hanging on "loading".
    let demKey = key;
    let loaded = false;
    map.on("error", (e) => {
      const msg = String(e.error?.message ?? "").replace(/key=[^&\s]+/g, "key=…");
      console.warn("[flight3d] map:", msg || "error");
      if (!loaded && demKey && /style\.json/.test(msg)) {
        demKey = undefined;
        map.setStyle(bareStyle());
      }
    });
    // map.remove() drops the context on purpose; only an unplanned loss counts.
    let disposed = false;
    map.getCanvas().addEventListener(
      "webglcontextlost",
      () => {
        if (!disposed) fail("context");
      },
      { once: true },
    );

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    overlayRef.current = overlay;

    // Fit an un-pitched view first so the intro has somewhere to come from.
    const b0 = modelRef.current.bounds;
    if (b0) {
      map.fitBounds(
        [
          [b0.minLon, b0.minLat],
          [b0.maxLon, b0.maxLat],
        ],
        { padding: 40, duration: 0, maxZoom: 14 },
      );
    }

    const recomputeGround = () => {
      const m = mapRef.current;
      if (!m) return;
      groundRef.current = modelRef.current.models.map((pm) =>
        pm.positions.map((p) => Math.max(0, m.queryTerrainElevation([p[0], p[1]]) ?? 0)),
      );
    };

    let lastGroundZoom = -1;
    const onIdle = () => {
      const z = map.getZoom();
      if (Math.abs(z - lastGroundZoom) < 0.75) return;
      lastGroundZoom = z;
      recomputeGround();
      render(progressRef.current);
    };

    map.on("load", async () => {
      loaded = true;
      applyNeutralBasemap(map);
      const key = demKey;
      const layers = map.getStyle().layers ?? [];
      const firstSymbol = layers.find((l) => l.type === "symbol")?.id;
      map.addSource("ss-dem", demSource(key));
      map.addSource("ss-hillshade", demSource(key));
      map.addLayer(
        {
          id: "ss-hillshade",
          type: "hillshade",
          source: "ss-hillshade",
          paint: {
            "hillshade-exaggeration": 0.55,
            "hillshade-shadow-color": "#000000",
            "hillshade-highlight-color": "#4c4c4c",
            "hillshade-accent-color": "#0B0D10",
            "hillshade-illumination-direction": 315,
          },
        },
        firstSymbol,
      );
      map.setTerrain({ source: "ss-dem", exaggeration: DEM_EXAGGERATION });
      map.setSky({
        "sky-color": "#0B0D10",
        "horizon-color": "#1E2229",
        "fog-color": "#0B0D10",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.85,
        "atmosphere-blend": 0,
      });

      try {
        await document.fonts?.ready;
      } catch {
        /* fonts API missing — fall back to whatever is loaded */
      }
      fontRef.current = monoFamily();
      if (!mapRef.current) return;
      map.addControl(overlay);
      // Compact attribution starts expanded and would sit over the scrubber;
      // fold it to the (i) button. Riders can still open it.
      el.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove(
        "maplibregl-compact-show",
      );
      render(progressRef.current);
      map.on("idle", onIdle);
      readyRef.current = true;
      setReady(true);

      frame(!reduced);
      if (replay && !reduced) {
        window.setTimeout(() => {
          if (!mapRef.current || playingRef.current) return;
          playingRef.current = true;
          setPlaying(true);
        }, INTRO_MS);
      }
    });

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      disposed = true;
      readyRef.current = false;
      try {
        map.removeControl(overlay);
      } catch {
        /* overlay never attached */
      }
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // Mount once; data changes flow through render().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data / marker changes after mount.
  useEffect(() => {
    if (!readyRef.current) return;
    render(progressRef.current);
  }, [model, render]);

  // ---- replay loop -------------------------------------------------------
  useEffect(() => {
    playingRef.current = playing;
    if (!playing) return;
    let last = performance.now();
    let lastHud = 0;
    if (progressRef.current >= 1) progressRef.current = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const next = advanceProgress(modelRef.current.clock, progressRef.current, dt);
      progressRef.current = next;
      render(next);
      if (now - lastHud > 80 || next >= 1) {
        lastHud = now;
        setProgress(next);
      }
      if (next >= 1) {
        playingRef.current = false;
        setPlaying(false);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, render]);

  const onScrub = (v: number) => {
    progressRef.current = v;
    setProgress(v);
    render(v);
  };

  // ---- HUD ---------------------------------------------------------------
  const { clock, models } = model;
  const nowTs = progressToTs(clock, progress);
  const primary = models[0];
  const sample = primary ? sampleAt(primary.verts, nowTs) : null;
  const timeLabel = formatTs(nowTs * 1000, "time-sec", { hour12 });
  const altLabel = sample ? `${Math.round(sample.altFt / 25) * 25}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "′" : "—";
  const spdLabel = sample?.spd != null ? `${Math.round(sample.spd)} kt` : "— kt";

  if (failed) {
    return (
      <div
        role="status"
        style={{
          height: 120,
          borderRadius: 12,
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline}`,
          color: SS_TOKENS.fg1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 20,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {failed === "webgl2"
          ? "3D needs WebGL2, and this browser does not offer it. The flat map still has the whole track."
          : "3D view dropped out. The flat map still has the whole track."}
      </div>
    );
  }

  const orbitChips = models.flatMap((m) => m.orbits);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div
      data-testid="flight-3d"
      data-ready={ready ? "1" : "0"}
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: 12,
        overflow: "hidden",
        background: SS_TOKENS.bg0,
        border: `.5px solid ${SS_TOKENS.hairline}`,
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Readout */}
      {replay && primary && (
        <div
          aria-live="off"
          className="ss-mono"
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            padding: "8px 11px",
            borderRadius: 8,
            background: "rgba(11,13,16,0.82)",
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            pointerEvents: "none",
            minWidth: 128,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 600, color: SS_TOKENS.fg0, letterSpacing: ".01em" }}>
            {timeLabel}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 13, color: SS_TOKENS.fg0 }}>
            <span>
              <span style={{ color: SS_TOKENS.fg1, letterSpacing: ".08em" }}>ALT </span>
              {altLabel}
            </span>
            <span>
              <span style={{ color: SS_TOKENS.fg1, letterSpacing: ".08em" }}>GS </span>
              {spdLabel}
            </span>
          </div>
        </div>
      )}

      {/* Reset view */}
      <button
        type="button"
        onClick={() => frame(!prefersReducedMotion())}
        className="ss-mono"
        aria-label="Reset view"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          height: 44,
          padding: "0 12px",
          borderRadius: 8,
          background: "rgba(11,13,16,0.82)",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: SS_TOKENS.fg1,
          fontSize: 12,
          letterSpacing: ".06em",
          cursor: "pointer",
        }}
      >
        RESET VIEW
      </button>

      {/* Replay controls */}
      {replay && primary && (
        <div
          style={{
            position: "absolute",
            left: 10,
            right: 44,
            bottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 6px 0 0",
            borderRadius: 10,
            background: "rgba(11,13,16,0.82)",
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause replay" : "Play replay"}
            aria-pressed={playing}
            style={{
              width: 44,
              height: 44,
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              color: SS_TOKENS.fg0,
              cursor: "pointer",
            }}
          >
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
                <rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" fill="currentColor" />
              </svg>
            )}
          </button>
          <input
            type="range"
            aria-label="Replay position"
            min={0}
            max={1000}
            step={1}
            value={Math.round(progress * 1000)}
            onChange={(e) => {
              if (playing) setPlaying(false);
              onScrub(Number(e.target.value) / 1000);
            }}
            className="ss-flight3d-range"
            style={{ flex: 1, minWidth: 0, height: 44, accentColor: SS_TOKENS.cta, cursor: "pointer" }}
          />
          <span
            className="ss-mono"
            style={{ fontSize: 12, color: SS_TOKENS.fg1, flex: "0 0 auto", minWidth: 40, textAlign: "right" }}
          >
            {formatTs(clock.t1 * 1000, "time", { hour12 }).replace(/\s+PT$/, "")}
          </span>
        </div>
      )}

      {!ready && (
        <div
          className="ss-mono"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: SS_TOKENS.fg1,
            fontSize: 12,
            letterSpacing: ".08em",
            pointerEvents: "none",
          }}
        >
          LOADING TERRAIN
        </div>
      )}
    </div>

      {orbitChips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {orbitChips.map((o) => (
            <button
              key={`${o.startTs}-${o.endTs}`}
              type="button"
              onClick={() => focusOrbit(o)}
              data-testid="flight-3d-orbit"
              className="ss-mono"
              style={{
                minHeight: 44,
                padding: "0 14px",
                borderRadius: 10,
                background: SS_TOKENS.bg1,
                border: `.5px solid ${SS_TOKENS.hairline2}`,
                color: SS_TOKENS.fg0,
                fontSize: 12,
                letterSpacing: ".02em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                textAlign: "left",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <circle cx="7" cy="7" r="5.25" fill="none" stroke={SS_TOKENS.fg1} strokeWidth="1.5" />
                <circle cx="7" cy="1.75" r="1.5" fill={SS_TOKENS.fg0} />
              </svg>
              <span>
                {/* Keep "13 min" on one line when the chip wraps on a phone. */}
                {orbitLabel(o).replace(/ (min)\b/g, "\u00a0$1")}
                <span style={{ color: SS_TOKENS.fg1 }}>
                  {" · "}
                  {formatTs(o.startTs * 1000, "time", { hour12 })}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
