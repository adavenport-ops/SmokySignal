"use client";

// 3D flight view: MapLibre terrain + hillshade under a deck.gl overlay that
// draws each path at its true (exaggerated) altitude, a faint curtain down to
// the ground, orbit rings, airport labels and a replay with a fading trail.
//
// Loaded only through next/dynamic (ssr: false) once a rider picks 3D, so
// deck.gl never lands in a page's first-load JS. Reusable: takes any number
// of paths plus optional live markers. Mounted by the /flight share page,
// the plane page's Flight history, /radar history mode and live /radar 3D.
// The map is built once; new paths / markers flow through render() and
// only rebuild deck.gl layers, so a 10 s live poll never re-creates the map.
// Camera controls (rotate, tilt, compass, Orbit, Q/E/W/S, Shift-drag tilt)
// come from components/Map3DControls.tsx, mounted under RESET VIEW.
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
import { applyNeutralBasemap, basemapStyleUrl, firstRoadLayerId } from "@/lib/basemap";
import Map3DControls from "./Map3DControls";
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
import { supportsWebGL2 } from "@/lib/webgl";
import { MapBoundary } from "./MapBoundary";
import { TrackSvgFallback } from "./TrackSvgFallback";
import type { TrackPoint } from "@/lib/tracks";
import { detectOrbits, type OrbitSegment } from "@/lib/orbit";
import { inferArrival, inferDeparture, type AirportMatch } from "@/lib/airports";
import { formatTs } from "@/lib/time";
import { SELECTED_FLIGHT_COLOR } from "@/lib/history-3d";
import {
  mergeFields,
  nudgeX,
  placeLabels,
  selectMultiPathLabels,
  selectSinglePathLabels,
  textBox,
  type LabelBox,
  type OrbitInput,
  type Rect,
} from "@/lib/label-declutter";
import {
  MAX_VERTICES,
  TERRAIN_EXAGGERATION,
  advanceProgress,
  altitudeZ,
  boundsOf,
  clampFrameZoom,
  decimateAll,
  framePadding as initialFramePadding,
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

export type Flight3DPick = { kind: "path" | "marker"; id: string };

type Props = {
  paths: Flight3DPath[];
  /** Live aircraft to pin in the scene (/radar live 3D). */
  markers?: Flight3DMarker[];
  /** CSS height. Default: most of a phone screen, capped on desktop. */
  height?: number | string;
  /** Fill the parent edge to edge (no card border), e.g. full-screen /radar. */
  fill?: boolean;
  /** Where the RESET VIEW button sits, px from the top-right corner. */
  resetInset?: { top: number; right: number };
  /** Tap on a path or marker; null for a tap on empty ground. */
  onPick?: (pick: Flight3DPick | null) => void;
  /** Re-frame the camera when this changes (new data set, new range). */
  frameKey?: string | number | null;
  /** Camera when there is nothing to frame. Default: Puget Sound. */
  emptyView?: { center: [number, number]; zoom: number };
  /** Extra px the parent's overlays cover on each side, kept clear when framing. */
  framePadding?: { top: number; bottom: number; left: number; right: number };
  /** Camera pitch, degrees. Default 60 (side-on, for one track's curtain). */
  pitch?: number;
  /** QA hook: stamped on the container as data-scene. */
  scene?: string;
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
  // Seed from a flat fit of the footprint, a step wider for the pitch.
  // Starting at a fixed zoom, points far from the centroid (a few aircraft
  // spread over the Sound) can project past the horizon, get skipped, and
  // the fit settles on whatever is left.
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of pts) {
    minLon = Math.min(minLon, p[0]);
    maxLon = Math.max(maxLon, p[0]);
    minLat = Math.min(minLat, p[1]);
    maxLat = Math.max(maxLat, p[1]);
  }
  if (maxLon - minLon > 1e-6 || maxLat - minLat > 1e-6) {
    try {
      const flat = new WebMercatorViewport({ width, height }).fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: pad },
      );
      if (Number.isFinite(flat.zoom)) {
        zoom = Math.min(maxZoom, flat.zoom - 1);
        lon = flat.longitude;
        lat = flat.latitude;
      }
    } catch {
      /* box too small for the padding: keep the default seed */
    }
  }
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

/**
 * One label the declutter pass may show or hide. Orbit labels float on a
 * leader above their ring (anchor at z + lift); field tags hang below the
 * airport dot.
 */
type LabelCand = {
  id: string;
  kind: "orbit" | "field";
  text: string;
  priority: number;
  lon: number;
  lat: number;
  /** Ring altitude (orbit) or ground lift (field), m. */
  z: number;
  /** Leader height above the ring, m (orbit only). */
  lift: number;
  /** Label size and padding, px. */
  size: number;
  padX: number;
  padY: number;
};

const LABEL_SIZE = 12;
const FIELD_PRIORITY = 900;
const SELECTED_PRIORITY = 1e7;

function buildLabels(
  models: ReadonlyArray<PathModel>,
  selectedId: string | null,
): LabelCand[] {
  const multi = models.length > 1;
  const orbits: OrbitInput[] = models.flatMap((m) =>
    m.orbits.map((o, k) => ({
      pathId: m.id,
      corridor: o.corridor,
      durationS: o.durationS,
      lat: o.centroid.lat,
      lon: o.centroid.lon,
      altFt: m.orbitAlts[k] ?? 0,
      radiusNm: o.radiusNm,
    })),
  );
  const picked = multi ? selectMultiPathLabels(orbits, selectedId) : selectSinglePathLabels(orbits);
  const out: LabelCand[] = picked.map((l) => {
    const a = l.group.anchor;
    return {
      id: l.id,
      kind: "orbit",
      text: l.text,
      priority: (l.selected ? SELECTED_PRIORITY : 0) + l.group.totalS,
      lon: a.lon,
      lat: a.lat,
      z: altitudeZ(a.altFt),
      lift: Math.max(350, Math.max(a.radiusNm, MIN_RING_NM) * NM_TO_M * 0.75),
      size: LABEL_SIZE,
      padX: 8,
      padY: 5,
    };
  });
  const fields = mergeFields(
    models.flatMap((m) => [
      ...(m.dep ? [{ id: m.dep.id, lat: m.dep.lat, lon: m.dep.lon, tag: "DEP" as const }] : []),
      ...(m.arr ? [{ id: m.arr.id, lat: m.arr.lat, lon: m.arr.lon, tag: "ARR" as const }] : []),
    ]),
  );
  for (const f of fields) {
    out.push({
      id: `field:${f.id}`,
      kind: "field",
      text: f.text,
      priority: FIELD_PRIORITY,
      lon: f.lon,
      lat: f.lat,
      z: 3,
      lift: 0,
      size: LABEL_SIZE,
      padX: 6,
      padY: 4,
    });
  }
  return out;
}

/** Label footprints for framing: orbit callouts above rings, field tags below. */
function labelBoxes(labels: ReadonlyArray<LabelCand>): Box[] {
  return labels.map((l) => {
    const t = textBox(l.text, l.size, l.padX, l.padY);
    const half = t.w / 2;
    return l.kind === "orbit"
      ? { pos: [l.lon, l.lat, l.z] as Position3, left: half, right: half, up: t.h + 36, down: 0 }
      : { pos: [l.lon, l.lat, 0] as Position3, left: half, right: half, up: 0, down: t.h + 16 };
  });
}

/**
 * Ground-anchored screen position for a lon/lat/altitude, matching what
 * MapLibre draws with terrain on: its terrain-aware project() for the
 * ground point plus the lift from a plain mercator viewport.
 */
function screenProjector(map: MaplibreMap) {
  const c = map.getContainer();
  const center = map.getCenter();
  const vp = new WebMercatorViewport({
    width: c.clientWidth,
    height: c.clientHeight,
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  });
  return (lon: number, lat: number, z: number, ground: number): [number, number] => {
    const g = map.project([lon, lat]);
    const a = vp.project([lon, lat, z]) as number[];
    const b = vp.project([lon, lat, ground]) as number[];
    return [g.x + a[0]! - b[0]!, g.y + a[1]! - b[1]!];
  };
}

/** On-screen overlays (controls column, reset, readout, scrubber) no label may sit under. */
const OBSTACLE_SELECTOR =
  '[data-label-obstacle],[data-testid="map3d-controls"],[data-testid="map3d-hint"],button[aria-label="Reset view"]';
const OBSTACLE_PAD = 6;

function obstacleRects(wrap: HTMLElement | null): Rect[] {
  if (!wrap) return [];
  const wr = wrap.getBoundingClientRect();
  const out: Rect[] = [];
  wrap.querySelectorAll<HTMLElement>(OBSTACLE_SELECTOR).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    out.push({
      x: r.left - wr.left - OBSTACLE_PAD,
      y: r.top - wr.top - OBSTACLE_PAD,
      w: r.width + OBSTACLE_PAD * 2,
      h: r.height + OBSTACLE_PAD * 2,
    });
  });
  return out;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const NO_MARKERS: Flight3DMarker[] = [];
const DEFAULT_EMPTY_VIEW = { center: [-122.35, 47.45] as [number, number], zoom: 8.6 };
/** Touch slop around a 3 px ribbon, px. */
const PICK_RADIUS = 14;
/** Touch slop around a 9 px live dot, px. Markers win over ribbons. */
const MARKER_PICK_RADIUS = 24;

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}
/** Translucent layers must not write depth or they hide what is behind them. */
const NO_DEPTH_WRITE = { depthWriteEnabled: false } as const;

const DEFAULT_HEIGHT = "clamp(420px, 66vh, 640px)";

/**
 * Error boundary around the 3D view. The inner component already probes
 * for WebGL2 and reports a refusal through onUnavailable; this catches
 * anything that still throws while mounting (contexts used up) and shows
 * the tracks flat instead of taking the page down.
 */
export default function Flight3D(props: Props) {
  const { onUnavailable } = props;
  const onCrash = useCallback(() => onUnavailable?.("context"), [onUnavailable]);
  return (
    <MapBoundary
      gate={false}
      name="flight3d"
      onCrash={onCrash}
      fallback={
        <TrackSvgFallback
          height={props.fill ? "100%" : (props.height ?? DEFAULT_HEIGHT)}
          tracks={props.paths.map((p) => ({ id: p.id, points: p.points, color: p.color }))}
        />
      }
    >
      <Flight3DInner {...props} />
    </MapBoundary>
  );
}

function Flight3DInner({
  paths,
  markers = NO_MARKERS,
  height = DEFAULT_HEIGHT,
  replay = true,
  annotate = true,
  hour12 = false,
  onUnavailable,
  fill = false,
  resetInset,
  onPick,
  frameKey = null,
  emptyView = DEFAULT_EMPTY_VIEW,
  framePadding,
  pitch = PITCH,
  scene,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  /** Terrain height (m) under each vertex, by path id. */
  const groundRef = useRef<Map<string, number[]>>(new Map());
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const emptyViewRef = useRef(emptyView);
  emptyViewRef.current = emptyView;
  const framePadRef = useRef(framePadding);
  framePadRef.current = framePadding;
  const resetInsetRef = useRef(resetInset);
  resetInsetRef.current = resetInset;
  const pitchRef = useRef(pitch);
  pitchRef.current = pitch;
  const fontRef = useRef<string>("monospace");
  const rafRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const playingRef = useRef(false);
  const readyRef = useRef(false);
  /** Label ids that survived the last collision pass; null = not run yet. */
  const visRef = useRef<{ vis: Set<string>; dx: Map<string, number>; key: string } | null>(null);
  const labelTimerRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  /** The live map once loaded, for the camera controls. */
  const [mapObj, setMapObj] = useState<MaplibreMap | null>(null);

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
    // Several paths: the tapped one (the orange one) keeps its labels.
    const sel = SELECTED_FLIGHT_COLOR.toLowerCase();
    const selectedId =
      paths.length > 1 ? (paths.find((p) => p.color?.toLowerCase() === sel)?.id ?? null) : null;
    const labels = buildLabels(models, selectedId);
    return { models, markers, clock, axis, labels, selectedId, bounds: bounds ? padBounds(bounds, 2) : null };
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

  /**
   * Collision pass: project each label's box to the screen and keep the
   * highest-priority ones that clear each other and the on-screen controls.
   * A few dozen boxes, so cheap enough to run on every camera settle.
   */
  const computeVisible = useCallback((): { vis: Set<string>; dx: Map<string, number>; key: string } | null => {
    const map = mapRef.current;
    const labels = modelRef.current.labels;
    if (!map || labels.length === 0) return null;
    const c = map.getContainer();
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w <= 0 || h <= 0) return null;
    const project = screenProjector(map);
    const boxes: LabelBox[] = [];
    const keep = new Set<string>();
    const dxs = new Map<string, number>();
    const obstacles = obstacleRects(c.parentElement);
    for (const l of labels) {
      const elev = Math.max(0, map.queryTerrainElevation([l.lon, l.lat]) ?? 0);
      const t = textBox(l.text, l.size, l.padX, l.padY);
      let box: LabelBox;
      if (l.kind === "orbit") {
        const [sx, sy] = project(l.lon, l.lat, l.z + l.lift, elev);
        box = { id: l.id, x: sx - t.w / 2, y: sy - 6 - t.h, w: t.w, h: t.h, priority: l.priority };
      } else {
        const [sx, sy] = project(l.lon, l.lat, elev + l.z, elev);
        box = { id: l.id, x: sx - t.w / 2, y: sy + 14, w: t.w, h: t.h, priority: l.priority };
      }
      // Fully off-screen labels cannot collide with anything visible.
      if (box.x + box.w < 0 || box.x > w || box.y + box.h < 0 || box.y > h) {
        keep.add(l.id);
        continue;
      }
      // Slide a label in from the edge or out from under the controls
      // rather than dropping it.
      const dx = nudgeX(box, obstacles, { w, h });
      if (dx !== 0) {
        box.x += dx;
        dxs.set(l.id, dx);
      }
      boxes.push(box);
    }
    for (const id of placeLabels(boxes, obstacles)) keep.add(id);
    const key = [...keep].sort().map((id) => `${id}@${dxs.get(id) ?? 0}`).join("|");
    return { vis: keep, dx: dxs, key };
  }, []);

  const buildStatic = useCallback((): Layer[] => {
    const { models, labels } = modelRef.current;
    const multi = models.length > 1;
    const selectedId = modelRef.current.selectedId;
    const placed = computeVisible();
    visRef.current = placed;
    const shown = (id: string) => !placed || placed.vis.has(id);
    const shiftOf = (id: string) => placed?.dx.get(id) ?? 0;
    const ground = groundRef.current;
    const font = fontRef.current;
    const map = mapRef.current;
    const layers: Layer[] = [];
    const noDepthWrite = NO_DEPTH_WRITE;

    // Many stacked flights: thinner curtains so the walls do not fog the
    // terrain out.
    const curtainAlpha = models.length > 3 ? 24 : 60;
    // Dozens of flights: slimmer ribbons and a fainter glow, or they fuse.
    const dense = models.length > 12;
    models.forEach((m) => {
      const g0 = ground.get(m.id);
      const g = g0 && g0.length === m.positions.length ? g0 : [];
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
          getFillColor: [r, gg, b, curtainAlpha],
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
          getColor: [r, gg, b, models.length > 3 ? 70 : 120],
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
          getColor: [r, gg, b, dense ? 28 : 48],
          getWidth: dense ? 7 : 9,
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
          getColor: [r, gg, b, dense ? 215 : 235],
          getWidth: dense ? 2 : 3,
          widthUnits: "pixels",
          billboard: true,
          jointRounded: true,
          capRounded: true,
        }),
      );
    });

    // Orbit rings (faint when many flights share the view) + labels.
    const rings: { path: Position3[]; alpha: number }[] = [];
    for (const m of models) {
      m.orbits.forEach((o, k) => {
        const z = altitudeZ(m.orbitAlts[k] ?? 0);
        rings.push({
          path: ringPositions(o.centroid, o.radiusNm, z),
          alpha: !multi ? 210 : m.id === selectedId ? 210 : 70,
        });
      });
    }
    if (rings.length > 0) {
      layers.push(
        new PathLayer<(typeof rings)[number]>({
          id: "orbit-ring",
          data: rings,
          getPath: (d) => d.path,
          getColor: (d) => [242, 244, 247, d.alpha],
          getWidth: 2,
          widthUnits: "pixels",
          billboard: true,
          parameters: noDepthWrite,
        }),
      );
    }
    // The label floats on a short leader above the ring so it never sits on
    // top of the pattern it describes.
    const orbitLabels = labels
      .filter((l) => l.kind === "orbit" && shown(l.id))
      .map((l) => ({
        text: l.text,
        dx: shiftOf(l.id),
        mid: [l.lon, l.lat, l.z] as Position3,
        top: [l.lon, l.lat, l.z + l.lift] as Position3,
      }));
    if (orbitLabels.length > 0) {
      layers.push(
        new LineLayer<(typeof orbitLabels)[number]>({
          id: "orbit-leader",
          data: orbitLabels,
          getSourcePosition: (d) => d.mid,
          getTargetPosition: (d) => d.top,
          getColor: [242, 244, 247, 140],
          getWidth: 1,
          widthUnits: "pixels",
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
        new TextLayer<(typeof orbitLabels)[number]>({
          id: "orbit-label",
          data: orbitLabels,
          getPosition: (d) => d.top,
          getText: (d) => d.text,
          fontFamily: font,
          characterSet: "auto",
          getSize: LABEL_SIZE,
          getColor: [242, 244, 247, 255],
          getAlignmentBaseline: "bottom",
          getPixelOffset: (d) => [d.dx, -6],
          lineHeight: 1.25,
          background: true,
          getBackgroundColor: [11, 13, 16, 235],
          getBorderColor: [242, 244, 247, 60],
          getBorderWidth: 1,
          backgroundPadding: [8, 5],
          backgroundBorderRadius: 6,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
      );
    }

    // Departure / arrival fields: one dot per airport, one tag per airport.
    const fieldData = labels
      .filter((l) => l.kind === "field")
      .map((l) => {
        const elev = map?.queryTerrainElevation([l.lon, l.lat]) ?? 0;
        return {
          id: l.id,
          dx: shiftOf(l.id),
          pos: [l.lon, l.lat, Math.max(0, elev) + 3] as Position3,
          text: l.text,
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
          data: fieldData.filter((d) => shown(d.id)),
          getPosition: (d) => d.pos,
          getText: (d) => d.text,
          fontFamily: font,
          characterSet: "auto",
          getSize: LABEL_SIZE,
          getColor: [200, 205, 214, 255],
          getPixelOffset: (d) => [d.dx, 14],
          getAlignmentBaseline: "top",
          background: true,
          getBackgroundColor: [11, 13, 16, 235],
          backgroundPadding: [6, 4],
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
          id: mk.id,
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
          getRadius: 9,
          radiusUnits: "pixels",
          billboard: true,
          stroked: true,
          getFillColor: (d) => d.rgba,
          // Light rim so the grey neutral dot holds up over dark terrain.
          getLineColor: [242, 244, 247, 230],
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
        new TextLayer<(typeof live)[number]>({
          id: "live-label",
          data: live.filter((d) => d.label),
          getPosition: (d) => d.pos,
          getText: (d) => d.label,
          fontFamily: font,
          characterSet: "auto",
          getSize: LABEL_SIZE,
          getColor: [242, 244, 247, 255],
          getPixelOffset: [0, -18],
          background: true,
          getBackgroundColor: [11, 13, 16, 235],
          backgroundPadding: [5, 3],
          parameters: { depthCompare: "always", depthWriteEnabled: false },
        }),
      );
    }
    return layers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, computeVisible]);

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

  /**
   * What sits under a screen point: the nearest live marker within
   * MARKER_PICK_RADIUS, else the nearest ribbon within PICK_RADIUS.
   */
  const hitTest = useCallback((x: number, y: number): Flight3DPick | null => {
    const map = mapRef.current;
    if (!map) return null;
    const c = map.getContainer();
    const center = map.getCenter();
    const vp = new WebMercatorViewport({
      width: c.clientWidth,
      height: c.clientHeight,
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    });
    const toScreen = (lon: number, lat: number, z: number, ground: number): [number, number] => {
      const g = map.project([lon, lat]);
      const a = vp.project([lon, lat, z]) as number[];
      const b = vp.project([lon, lat, ground]) as number[];
      return [g.x + a[0]! - b[0]!, g.y + a[1]! - b[1]!];
    };
    let best: Flight3DPick | null = null;
    let bestD = MARKER_PICK_RADIUS * MARKER_PICK_RADIUS;
    for (const mk of modelRef.current.markers) {
      const ground = Math.max(0, map.queryTerrainElevation([mk.lon, mk.lat]) ?? 0);
      const [sx, sy] = toScreen(mk.lon, mk.lat, altitudeZ(mk.altFt ?? 0), ground);
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = { kind: "marker", id: mk.id };
      }
    }
    if (best) return best;
    bestD = PICK_RADIUS * PICK_RADIUS;
    const w = c.clientWidth;
    const h = c.clientHeight;
    // Later paths draw on top (the tapped flight goes last), so they win ties.
    for (const m of modelRef.current.models) {
      const g0 = groundRef.current.get(m.id);
      const g = g0 && g0.length === m.positions.length ? g0 : null;
      let prev: [number, number] | null = null;
      for (let k = 0; k < m.positions.length; k++) {
        const p = m.positions[k]!;
        const s = toScreen(p[0], p[1], p[2], g ? g[k]! : 0);
        if (prev) {
          const off =
            (prev[0] < -50 && s[0] < -50) ||
            (prev[0] > w + 50 && s[0] > w + 50) ||
            (prev[1] < -50 && s[1] < -50) ||
            (prev[1] > h + 50 && s[1] > h + 50);
          if (!off) {
            const d = segDist2(x, y, prev[0], prev[1], s[0], s[1]);
            if (d <= bestD) {
              bestD = d;
              best = { kind: "path", id: m.id };
            }
          }
        }
        prev = s;
      }
    }
    return best;
  }, []);

  /** Sample terrain under every vertex. Cheap (DEM lookups), and keyed by
   *  path id so a live poll that adds or drops a tail keeps the rest. */
  const recomputeGround = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const next = new Map<string, number[]>();
    for (const pm of modelRef.current.models) {
      next.set(
        pm.id,
        pm.positions.map((p) => Math.max(0, m.queryTerrainElevation([p[0], p[1]]) ?? 0)),
      );
    }
    groundRef.current = next;
  }, []);

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
    if (!map) return;
    const b = modelRef.current.bounds;
    if (!b) {
      const ev = emptyViewRef.current;
      const target = { center: ev.center, zoom: ev.zoom, pitch: pitchRef.current, bearing: BEARING };
      if (animate) map.easeTo({ ...target, duration: INTRO_MS });
      else map.jumpTo(target);
      return;
    }
    const bearing = homeBearing(map);
    const c = map.getContainer();
    const pts = framingPoints(modelRef.current.models);
    for (const mk of modelRef.current.markers) {
      const z = altitudeZ(mk.altFt ?? 0);
      pts.push([mk.lon, mk.lat, z], [mk.lon, mk.lat, 0]);
    }
    if (pts.length === 0) pts.push([b.minLon, b.minLat, 0], [b.maxLon, b.maxLat, 0]);
    // Keep the track clear of the controls column (every width), the
    // replay readout and scrubber or the gesture hint, and the parent's
    // overlays (lib/flight3d.ts framePadding).
    const padding = initialFramePadding({
      width: c.clientWidth,
      height: c.clientHeight,
      replay,
      controlsRight: resetInsetRef.current?.right ?? 10,
      parent: framePadRef.current,
    });
    const fitted = fitCamera(
      pts,
      c.clientWidth,
      c.clientHeight,
      bearing,
      pitchRef.current,
      padding,
      14,
      // Many flights: labels are thinned by collision, so they do not widen
      // the frame (a dozen 270 px plates would zoom a phone right out).
      modelRef.current.models.length > 1 ? [] : labelBoxes(modelRef.current.labels),
    );
    // Regional tracks never open wider than a sensible zoom.
    const cam = fitted
      ? {
          ...fitted,
          zoom: clampFrameZoom(fitted.zoom, {
            bounds: b,
            frameW: c.clientWidth - padding.left - padding.right,
            frameH: c.clientHeight - padding.top - padding.bottom,
          }),
        }
      : null;
    if (!cam) return;
    const target = { ...cam, bearing, pitch: pitchRef.current };
    if (animate) {
      map.easeTo({ ...target, duration: INTRO_MS, easing: (t) => 1 - Math.pow(1 - t, 3) });
    } else {
      map.jumpTo(target);
    }
  }, [homeBearing, replay]);

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
        pitchRef.current,
        { top: pad + 90, bottom: pad + 64, left: pad, right: pad },
        14.5,
      );
      if (!cam) return;
      const target = { ...cam, bearing: map.getBearing(), pitch: pitchRef.current };
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

    // Cached probe that releases its own context (lib/webgl.ts).
    if (!supportsWebGL2()) {
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

    // Taps. deck.gl's own picking pass drifts several px from what MapLibre
    // draws once terrain is on, enough to miss a dot under a fingertip, so
    // hit-test in screen space instead: MapLibre's terrain-aware project()
    // puts the ground point where it is drawn, and a plain mercator
    // viewport adds the lift from the ground up to the altitude.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      const cb = onPickRef.current;
      if (cb) cb(hitTest(e.point.x, e.point.y));
    };
    const onMapMove = (e: maplibregl.MapMouseEvent) => {
      if (!onPickRef.current || e.originalEvent.buttons) return;
      map.getCanvas().style.cursor = hitTest(e.point.x, e.point.y) ? "pointer" : "";
    };
    map.on("click", onMapClick);
    map.on("mousemove", onMapMove);

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

    // Re-run label collision when the camera moves: at most every 150 ms
    // while it moves, and once more when it settles.
    const scheduleLabels = () => {
      if (labelTimerRef.current != null) return;
      labelTimerRef.current = window.setTimeout(() => {
        labelTimerRef.current = null;
        if (disposed || !readyRef.current) return;
        const prev = visRef.current;
        const next = computeVisible();
        if (prev?.key === next?.key) return;
        staticRef.current = null;
        render(progressRef.current);
      }, 150);
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
      // Hillshade goes under the roads so their tint is not shaded over;
      // the keyless style has no roads, so under the first label.
      const firstSymbol =
        firstRoadLayerId(layers) ?? layers.find((l) => l.type === "symbol")?.id;
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
      map.on("move", scheduleLabels);
      map.on("idle", scheduleLabels);
      readyRef.current = true;
      setReady(true);
      setMapObj(map);

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
      if (labelTimerRef.current != null) {
        window.clearTimeout(labelTimerRef.current);
        labelTimerRef.current = null;
      }
      map.off("click", onMapClick);
      map.off("mousemove", onMapMove);
      try {
        map.removeControl(overlay);
      } catch {
        /* overlay never attached */
      }
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      setMapObj(null);
    };
    // Mount once; data changes flow through render().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data / marker changes after mount: resample the ground under the new
  // vertices and rebuild layers. The map itself stays put.
  useEffect(() => {
    if (!readyRef.current) return;
    recomputeGround();
    render(progressRef.current);
  }, [model, render, recomputeGround]);

  // New data set (another range, first live fix): re-frame the camera.
  useEffect(() => {
    if (!readyRef.current) return;
    frame(!prefersReducedMotion());
  }, [frameKey, frame]);

  // Replay switched off (one flight became many): stop the loop.
  useEffect(() => {
    if (!replay) setPlaying(false);
  }, [replay]);

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

  const orbitChips = fill ? [] : models.flatMap((m) => m.orbits);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: fill ? "100%" : undefined }}>
    <div
      data-testid="flight-3d"
      data-ready={ready ? "1" : "0"}
      data-scene={scene}
      data-paths={models.length}
      data-markers={markers.length}
      style={{
        position: "relative",
        width: "100%",
        height: fill ? "100%" : height,
        borderRadius: fill ? 0 : 12,
        overflow: "hidden",
        background: SS_TOKENS.bg0,
        border: fill ? "none" : `.5px solid ${SS_TOKENS.hairline}`,
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Readout */}
      {replay && primary && (
        <div
          aria-live="off"
          data-label-obstacle="readout"
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

      {/* Rotate / tilt / compass / orbit, under RESET VIEW. */}
      <Map3DControls
        map={mapObj}
        defaultPitch={pitch}
        top={(resetInset?.top ?? 10) + 52}
        right={resetInset?.right ?? 10}
        // The scrubber (or the parent's pill row / carousel) owns the bottom.
        bottomReserve={Math.max(replay && primary ? 64 : 12, framePadding?.bottom ?? 0) + 8}
      />

      {/* Reset view */}
      <button
        type="button"
        onClick={() => frame(!prefersReducedMotion())}
        className="ss-mono"
        aria-label="Reset view"
        style={{
          position: "absolute",
          top: resetInset?.top ?? 10,
          right: resetInset?.right ?? 10,
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
          data-label-obstacle="scrubber"
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
