// Label decluttering for the 3D view (components/Flight3D.tsx). Pure and
// client-safe so it is pinned under node:test (lib/label-declutter.test.ts):
//   - placeLabels: screen-space collision, boxes in, visible ids out.
//   - mergeOrbits: repeated patterns at the same corridor + place become one.
//   - selectMultiPathLabels: with more than one path on screen, only the
//     tapped flight's patterns plus the few longest overall get text.
//   - mergeFields: one airport, one tag ("KOLM · DEP/ARR").

import { fmtMinutes } from "./flight3d";

// ─── screen-space collision ──────────────────────────────────────────

/** A screen rectangle, px. */
export type Rect = { x: number; y: number; w: number; h: number };

/** A label's screen rectangle, px, plus its priority (higher wins). */
export type LabelBox = Rect & {
  id: string;
  priority: number;
};

/** Gap kept between two visible labels, px. */
export const LABEL_GAP = 4;

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Greedy: walk boxes from highest priority down and keep one only when it
 * clears every box already kept and every obstacle (controls, scrubber,
 * readout: rectangles no label may sit under). Ties keep input order
 * (stable), so the result does not flicker while the camera moves.
 */
export function placeLabels(
  boxes: ReadonlyArray<LabelBox>,
  obstacles: ReadonlyArray<Rect> = [],
  gap = LABEL_GAP,
): Set<string> {
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => q.b.priority - p.b.priority || p.i - q.i);
  const kept: LabelBox[] = [];
  for (const { b } of order) {
    if (obstacles.some((o) => overlaps(b, o, 0))) continue;
    if (kept.every((k) => !overlaps(b, k, gap))) kept.push(b);
  }
  return new Set(kept.map((k) => k.id));
}

/**
 * Horizontal shift (px) that brings a label inside the frame and out from
 * under any obstacle it overlaps (the controls column, the readout), so a
 * label near the edge slides over instead of vanishing. When no shift
 * clears it the result still leaves it overlapping and placeLabels drops it.
 */
export function nudgeX(
  box: Rect,
  obstacles: ReadonlyArray<Rect>,
  frame: { w: number; h: number },
  margin = 4,
): number {
  let dx = 0;
  const clamp = () => {
    if (box.x + dx < margin) dx = margin - box.x;
    if (box.x + dx + box.w > frame.w - margin) dx = frame.w - margin - box.w - box.x;
  };
  clamp();
  for (let i = 0; i < 3; i++) {
    const hit = obstacles.find(
      (o) => box.y < o.y + o.h && o.y < box.y + box.h && box.x + dx < o.x + o.w && o.x < box.x + dx + box.w,
    );
    if (!hit) break;
    dx = hit.x - margin - box.w - box.x;
    clamp();
  }
  return Math.round(dx);
}

/** Rough footprint of a monospace label: `size` px type, plate padding. */
export function textBox(text: string, size = 12, padX = 8, padY = 5, lineHeight = 1.25): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  return {
    w: Math.ceil(longest * size * 0.62) + padX * 2,
    h: Math.ceil(lines.length * size * lineHeight) + padY * 2,
  };
}

// ─── orbits ──────────────────────────────────────────────────────────

export type OrbitInput = {
  /** Path (flight) the orbit belongs to. */
  pathId: string;
  corridor?: string;
  durationS: number;
  lat: number;
  lon: number;
  altFt: number;
  radiusNm: number;
};

export type OrbitGroup = {
  /** Corridor + place key. */
  key: string;
  corridor?: string;
  count: number;
  totalS: number;
  /** The longest member: where the label sits. */
  anchor: OrbitInput;
  pathIds: string[];
};

/** Same corridor label means same place; with none, a ~1 nm grid cell. */
export function orbitKey(o: Pick<OrbitInput, "corridor" | "lat" | "lon">): string {
  if (o.corridor) return `c:${o.corridor}`;
  return `g:${(Math.round(o.lat * 60) / 60).toFixed(3)},${(Math.round(o.lon * 60) / 60).toFixed(3)}`;
}

/** Merge repeats at one corridor + place, longest total first. */
export function mergeOrbits(orbits: ReadonlyArray<OrbitInput>): OrbitGroup[] {
  const groups = new Map<string, OrbitGroup>();
  for (const o of orbits) {
    const key = orbitKey(o);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, corridor: o.corridor, count: 1, totalS: o.durationS, anchor: o, pathIds: [o.pathId] });
      continue;
    }
    g.count += 1;
    g.totalS += o.durationS;
    if (o.durationS > g.anchor.durationS) g.anchor = o;
    if (!g.pathIds.includes(o.pathId)) g.pathIds.push(o.pathId);
  }
  return [...groups.values()].sort((a, b) => b.totalS - a.totalS);
}

/** "13m", "1h 12m". */
export function fmtShort(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

const patterns = (n: number) => `${n} pattern${n === 1 ? "" : "s"}`;

/**
 * One flight: "Worked a pattern" over "I-5 · Fife · 13 min", or for a
 * repeat "I-5 · Fife" over "2 patterns, 22 min".
 */
export function singleLabelText(g: OrbitGroup): string {
  if (g.count === 1) {
    const tail = [g.corridor, fmtMinutes(g.totalS)].filter(Boolean).join(" · ");
    return `Worked a pattern\n${tail}`;
  }
  const stats = `${patterns(g.count)}, ${fmtMinutes(g.totalS)}`;
  return g.corridor ? `${g.corridor}\n${stats}` : stats;
}

/** Many flights: one line, "I-5 · Fife · 6 patterns · 1h 12m". */
export function summaryLabelText(g: OrbitGroup): string {
  return [g.corridor, patterns(g.count), fmtShort(g.totalS)].filter(Boolean).join(" · ");
}

export type OrbitLabel = {
  /** Stable id: the group key, scoped to selected or overall. */
  id: string;
  group: OrbitGroup;
  text: string;
  selected: boolean;
};

/** Longest overall labelled besides the tapped flight's. */
export const MULTI_PATH_TOP = 3;

/**
 * More than one path on screen: label only the tapped flight's patterns
 * (merged within that flight) plus up to `top` of the longest corridor +
 * place groups across everything, skipping places already labelled.
 */
export function selectMultiPathLabels(
  orbits: ReadonlyArray<OrbitInput>,
  selectedPathId: string | null,
  top = MULTI_PATH_TOP,
): OrbitLabel[] {
  const out: OrbitLabel[] = [];
  const used = new Set<string>();
  if (selectedPathId) {
    for (const g of mergeOrbits(orbits.filter((o) => o.pathId === selectedPathId))) {
      out.push({ id: `sel:${g.key}`, group: g, text: singleLabelText(g), selected: true });
      used.add(g.key);
    }
  }
  let n = 0;
  for (const g of mergeOrbits(orbits)) {
    if (n >= top) break;
    if (used.has(g.key)) continue;
    out.push({ id: `top:${g.key}`, group: g, text: summaryLabelText(g), selected: false });
    used.add(g.key);
    n += 1;
  }
  return out;
}

/** One flight: every merged group labelled (collision thins them later). */
export function selectSinglePathLabels(orbits: ReadonlyArray<OrbitInput>): OrbitLabel[] {
  return mergeOrbits(orbits).map((g) => ({ id: `one:${g.key}`, group: g, text: singleLabelText(g), selected: false }));
}

// ─── airports ────────────────────────────────────────────────────────

export type FieldInput = { id: string; lat: number; lon: number; tag: "DEP" | "ARR" };
export type FieldLabel = { id: string; lat: number; lon: number; text: string };

/** One label per airport: "KOLM · DEP/ARR", DEP before ARR. */
export function mergeFields(fields: ReadonlyArray<FieldInput>): FieldLabel[] {
  const by = new Map<string, { lat: number; lon: number; tags: Set<string> }>();
  for (const f of fields) {
    const prev = by.get(f.id);
    if (prev) prev.tags.add(f.tag);
    else by.set(f.id, { lat: f.lat, lon: f.lon, tags: new Set([f.tag]) });
  }
  return [...by.entries()].map(([id, v]) => ({
    id,
    lat: v.lat,
    lon: v.lon,
    text: `${id} · ${(["DEP", "ARR"] as const).filter((t) => v.tags.has(t)).join("/")}`,
  }));
}
