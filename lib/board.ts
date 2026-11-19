// The Board — pure row model for the /board split-flap kiosk.
//
// One row per tail, departures-board style:
//
//   KOLM  SMOKEY 4        UP 47M
//   KRNT  GUARDIAN ONE    LANDED 09:40
//
// Rules:
//   - Airborne tails come first, as "UP <time aloft>". Alert-class roles
//     (smokey / patrol / unknown) light orange; SAR / transport stay
//     neutral, matching computeStatus() semantics.
//   - Grounded tails show their latest takeoff / landing / first-seen
//     event from the last BOARD_EVENT_WINDOW_MS, newest first. One row per
//     tail, so a dropout-cycling tail can't flood the board.
//   - ?region= narrows both by last known position against REGIONS[id].bbox.
//     A row with no position is left off a regional board rather than
//     guessed into it.
//
// No KV, no fetch, no React — lib/board.test.ts pins the formatter.

import { REGIONS, type RegionId } from "./regions";
import { PT_TZ } from "./time";
import { isAlertRole } from "./status";
import type { ActivityEntry } from "./activity";
import type { FleetRole, Snapshot } from "./types";

export type BoardTone = "alert" | "neutral" | "dim";

export type BoardRow = {
  /** Stable React key: tail. */
  key: string;
  base: string;
  name: string;
  status: string;
  tone: BoardTone;
};

/** Fixed column widths, in characters. The kiosk lays tiles out on these. */
export const BOARD_COLS = { base: 4, name: 14, status: 14 } as const;
export const BOARD_GAP = 2;
export const BOARD_EVENT_WINDOW_MS = 12 * 60 * 60 * 1000;
export const BOARD_MAX_ROWS = 8;

const BOARD_EVENT_KINDS = new Set(["takeoff", "landing", "first_seen"]);

/**
 * Validate a ?region= value. Object.hasOwn so "constructor", "__proto__"
 * and friends don't resolve to Object.prototype members.
 */
export function parseBoardRegion(
  value: string | string[] | null | undefined,
): RegionId | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string" || v.length === 0) return null;
  return Object.hasOwn(REGIONS, v) ? (v as RegionId) : null;
}

/** "KOLM Olympia" → "KOLM". Bases without an airport code read "----". */
export function baseCode(base: string | null | undefined): string {
  const first = (base ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[A-Z0-9]{3,4}$/.test(first) ? first : "----";
}

/** Nickname (or tail), upper-cased, parentheticals dropped, clipped to the column. */
export function boardName(nickname: string | null | undefined, tail: string): string {
  const raw = (nickname ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim() || tail;
  return raw.toUpperCase().replace(/\s+/g, " ").slice(0, BOARD_COLS.name);
}

const CLOCK_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: PT_TZ,
  hour: "2-digit",
  minute: "2-digit",
  // h23, not hour12:false — some engines render midnight as "24:00" otherwise.
  hourCycle: "h23",
});

/** 24-hour Pacific HH:MM, no suffix. */
export function fmtClockPT(tsMs: number): string {
  return CLOCK_FMT.format(new Date(tsMs));
}

/** "UP 47M", "UP 1H 12M", or bare "UP" when time aloft is unknown. */
export function fmtUpFor(aloftMin: number | null | undefined): string {
  if (aloftMin == null || !Number.isFinite(aloftMin) || aloftMin < 0) return "UP";
  const m = Math.floor(aloftMin);
  if (m < 60) return `UP ${m}M`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `UP ${h}H` : `UP ${h}H ${rem}M`;
}

export type BoardRowInput = {
  tail: string;
  nickname: string | null | undefined;
  base: string | null | undefined;
  role: FleetRole | undefined;
} & (
  | { kind: "up"; aloftMin?: number | null }
  | { kind: "takeoff" | "landing" | "first_seen"; ts: number }
);

const EVENT_WORD = {
  takeoff: "DEPARTED",
  landing: "LANDED",
  first_seen: "SPOTTED",
} as const;

export function formatBoardRow(input: BoardRowInput): BoardRow {
  const base = baseCode(input.base);
  const name = boardName(input.nickname, input.tail);
  if (input.kind === "up") {
    return {
      key: input.tail,
      base,
      name,
      status: fmtUpFor(input.aloftMin),
      tone: isAlertRole(input.role ?? "unknown") ? "alert" : "neutral",
    };
  }
  return {
    key: input.tail,
    base,
    name,
    status: `${EVENT_WORD[input.kind]} ${fmtClockPT(input.ts)}`,
    tone: "dim",
  };
}

/** The row as one padded line — what the tiles spell out. */
export function boardRowText(row: BoardRow): string {
  const gap = " ".repeat(BOARD_GAP);
  return [
    row.base.padEnd(BOARD_COLS.base).slice(0, BOARD_COLS.base),
    row.name.padEnd(BOARD_COLS.name).slice(0, BOARD_COLS.name),
    row.status.slice(0, BOARD_COLS.status),
  ]
    .join(gap)
    .trimEnd();
}

export function inRegion(
  lat: number | null | undefined,
  lon: number | null | undefined,
  regionId: RegionId | null,
): boolean {
  if (!regionId) return true;
  const bbox = REGIONS[regionId].bbox;
  if (!bbox) return true;
  if (lat == null || lon == null) return false;
  return (
    lat >= bbox.latMin && lat <= bbox.latMax && lon >= bbox.lonMin && lon <= bbox.lonMax
  );
}

/**
 * Snapshot narrowed to the region: airborne tails outside it (or without
 * a position) are treated as not up, so computeStatus() answers for the
 * region rather than the state.
 */
export function filterSnapshotToRegion(snap: Snapshot, regionId: RegionId | null): Snapshot {
  if (!regionId || !REGIONS[regionId].bbox) return snap;
  return {
    ...snap,
    aircraft: snap.aircraft.map((a) =>
      a.airborne && !inRegion(a.lat, a.lon, regionId) ? { ...a, airborne: false } : a,
    ),
  };
}

export function buildBoardRows(args: {
  snapshot: Snapshot | null;
  activity: ActivityEntry[];
  regionId: RegionId | null;
  now: number;
  maxRows?: number;
}): BoardRow[] {
  const { snapshot, activity, regionId, now } = args;
  const maxRows = args.maxRows ?? BOARD_MAX_ROWS;
  const aircraft = snapshot?.aircraft ?? [];
  const byTail = new Map(aircraft.map((a) => [a.tail, a]));

  const up = aircraft
    .filter((a) => a.airborne && inRegion(a.lat, a.lon, regionId))
    .sort((a, b) => {
      const ar = isAlertRole(a.role) ? 0 : 1;
      const br = isAlertRole(b.role) ? 0 : 1;
      if (ar !== br) return ar - br;
      return (b.time_aloft_min ?? -1) - (a.time_aloft_min ?? -1);
    });
  const upTails = new Set(up.map((a) => a.tail));

  const rows: BoardRow[] = up.map((a) =>
    formatBoardRow({
      kind: "up",
      tail: a.tail,
      nickname: a.nickname,
      base: a.base,
      role: a.role,
      aloftMin: a.time_aloft_min,
    }),
  );

  // Latest qualifying event per grounded tail. getRecentActivity returns
  // newest-first, but sort anyway so callers can pass any order.
  const seen = new Set<string>();
  const events = [...activity]
    .filter(
      (e) =>
        BOARD_EVENT_KINDS.has(e.kind) &&
        Number.isFinite(e.ts) &&
        now - e.ts <= BOARD_EVENT_WINDOW_MS &&
        e.ts <= now + 60_000,
    )
    .sort((a, b) => b.ts - a.ts);
  for (const e of events) {
    if (seen.has(e.tail) || upTails.has(e.tail)) continue;
    seen.add(e.tail);
    if (!inRegion(e.lat, e.lon, regionId)) continue;
    const entry = byTail.get(e.tail);
    rows.push(
      formatBoardRow({
        kind: e.kind as "takeoff" | "landing" | "first_seen",
        tail: e.tail,
        nickname: entry?.nickname ?? null,
        base: entry?.base ?? null,
        role: entry?.role ?? e.role,
        ts: e.ts,
      }),
    );
  }

  return rows.slice(0, maxRows);
}

// ─── Tile geometry ──────────────────────────────────────────────────────
//
// Every tile sits on whole CSS pixels. Fractional tile sizes (the old
// min(2.95vw, 7.2vh) sizing gave 44.17 x 69.09 px at 1080p) put glyph
// edges between device pixels, and TV GPUs resample them into a shimmer.
// BoardView measures the rows area and feeds it here; the result goes out
// as integer px CSS variables.

/** Tile cells across one wide row: 4 + 2 + 14 + 2 + 14. */
export const BOARD_WIDE_CELLS =
  BOARD_COLS.base + BOARD_GAP + BOARD_COLS.name + BOARD_GAP + BOARD_COLS.status;
/**
 * Tile cells across one compact (phone) row. The departure stacks on two
 * lines, base + name over the status, so each tile can be much bigger.
 */
export const BOARD_COMPACT_CELLS = BOARD_COLS.base + BOARD_GAP + BOARD_COLS.name;
/** Below this many px per tile cell the wide row is unreadable: stack it. */
export const BOARD_COMPACT_MIN_CELL = 22;
/** Tile height over tile width, from the original 1.22 / 0.78 em tile. */
const TILE_ASPECT = 1.56;

export type BoardLayout = {
  compact: boolean;
  /** Departures shown, blanks included. */
  rows: number;
  /** All integer CSS px. tileH is even, so the split lands on a whole pixel. */
  tileW: number;
  tileH: number;
  gap: number;
  /** Space between departures. */
  rowGap: number;
  /** Space between the two lines of a compact departure. */
  lineGap: number;
  fontSize: number;
  /** Top edge of the 1 px split band, from the tile's top: tileH / 2 - 1. */
  splitY: number;
  radius: number;
};

const even = (n: number) => Math.max(4, 2 * Math.floor(n / 2));

/**
 * Integer tile geometry for a rows area of `width` x `height` CSS px.
 * Wide screens get `maxRows` one-line departures sized to fit both ways.
 * Narrow screens stack each departure on two lines, size the tiles from
 * the width, and show as many departures as the height holds.
 */
export function boardLayout(
  width: number,
  height: number,
  maxRows: number = BOARD_MAX_ROWS,
): BoardLayout {
  const w = Math.max(0, Math.floor(Number.isFinite(width) ? width : 0));
  const h = Math.max(0, Math.floor(Number.isFinite(height) ? height : 0));
  const compact = Math.floor(w / BOARD_WIDE_CELLS) < BOARD_COMPACT_MIN_CELL;
  const cells = compact ? BOARD_COMPACT_CELLS : BOARD_WIDE_CELLS;
  const lines = compact ? 2 : 1;

  // Width bound: cells * (tileW + gap) <= w, the gap about 7% of a cell.
  const cell = Math.max(5, Math.floor(w / cells));
  const gap = Math.max(1, Math.round(cell * 0.07));
  let tileH = even((cell - gap) * TILE_ASPECT);

  const rowGapFor = (th: number) => Math.max(2, Math.round(th * 0.18));
  const lineGapFor = (th: number) => (compact ? Math.max(1, Math.round(th * 0.06)) : 0);
  const stack = (th: number, n: number) =>
    n * (th * lines + lineGapFor(th)) + Math.max(0, n - 1) * rowGapFor(th);

  let rows = Math.max(1, Math.floor(maxRows));
  if (compact) {
    // Keep the width-sized tile; show as many departures as fit.
    const want = rows;
    rows = 1;
    while (rows < want && stack(tileH, rows + 1) <= h) rows++;
  }
  // Height bound: shrink in even steps until the rows fit.
  while (tileH > 4 && stack(tileH, rows) > h) tileH -= 2;
  const tileW = Math.max(3, Math.min(cell - gap, Math.round(tileH / TILE_ASPECT)));
  // On a phone the stack fills the screen: spare height opens up the
  // space between departures (up to one tile), in whole pixels.
  let rowGap = rowGapFor(tileH);
  if (compact && rows > 1) {
    const spare = h - stack(tileH, rows);
    rowGap = Math.min(tileH, rowGap + Math.max(0, Math.floor(spare / (rows - 1))));
  }

  return {
    compact,
    rows,
    tileW,
    tileH,
    gap,
    rowGap,
    lineGap: lineGapFor(tileH),
    fontSize: Math.max(8, Math.floor(tileH * 0.8)),
    splitY: tileH / 2 - 1,
    radius: Math.max(1, Math.round(tileH * 0.06)),
  };
}
