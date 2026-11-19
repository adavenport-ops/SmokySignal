"use client";

// The Board, client half. Polls /api/aircraft and /api/activity every
// 15 s while the tab is visible, holds a screen wake lock where the
// browser offers one, and nudges the whole frame by 1 px every few
// minutes so a TV left on all day doesn't burn the layout in.
//
// Tiles sit on whole pixels: the rows area is measured and boardLayout()
// (lib/board.ts) turns it into integer px sizes, plus a sub-pixel pad that
// moves the first tile onto a whole-pixel x / y. Settled tiles carry no
// transform and no animation, so the TV composites one flat layer. Only a
// tile whose character changed after the first paint flips, never a
// blank one, and at most once a second.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { computeStatus } from "@/lib/status";
import { isFeedStale } from "@/lib/beacon";
import {
  BOARD_COLS,
  BOARD_GAP,
  BOARD_MAX_ROWS,
  boardLayout,
  boardRowText,
  buildBoardRows,
  filterSnapshotToRegion,
  fmtClockPT,
  type BoardLayout,
  type BoardRow,
} from "@/lib/board";
import { REGIONS, type RegionId } from "@/lib/regions";
import type { ActivityEntry } from "@/lib/activity";
import type { FleetEntry, Snapshot } from "@/lib/types";
import styles from "./board.module.css";

const POLL_MS = 15_000;
const TICK_MS = 5_000;
const SHIFT_MS = 3 * 60 * 1000;
// Four-step 1 px orbit: right, down, left, up.
const SHIFTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const ROW_CHARS = BOARD_COLS.base + BOARD_COLS.name + BOARD_COLS.status;
/** A tile flips at most this often (well under 1 Hz). */
const MIN_FLIP_INTERVAL_MS = 1000;

// useLayoutEffect on the client (a changed tile flips before it paints),
// useEffect on the server, where neither runs.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Geometry = { layout: BoardLayout; padX: number; padY: number };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The pad that moves an edge at `edge` px to the next whole pixel. Layout
 * runs in 1/64 px units, so round the pad UP to that grid: a pad a hair
 * short would snap back down and leave the tiles on a fraction.
 */
function snapPad(edge: number): number {
  const pad = Math.ceil(edge - 1 / 128) - edge;
  return pad <= 0 ? 0 : Math.ceil(pad * 64) / 64;
}

/** Measure the rows area and keep integer tile geometry for it. */
function useBoardGeometry(ref: React.RefObject<HTMLElement>): Geometry | null {
  const [geo, setGeo] = useState<Geometry | null>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // Pad the list so its first tile starts on a whole pixel even when
      // the vw / vh-sized header leaves the box on a fraction.
      const padX = snapPad(r.left);
      const padY = snapPad(r.top);
      const layout = boardLayout(r.width - padX, r.height - padY, BOARD_MAX_ROWS);
      setGeo((prev) =>
        prev &&
        prev.padX === padX &&
        prev.padY === padY &&
        JSON.stringify(prev.layout) === JSON.stringify(layout)
          ? prev
          : { layout, padX, padY },
      );
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return geo;
}

function geometryVars(g: Geometry | null): CSSProperties {
  if (!g) return {};
  const l = g.layout;
  const px = (n: number) => `${n}px`;
  return {
    ["--tile-w" as string]: px(l.tileW),
    ["--tile-h" as string]: px(l.tileH),
    ["--tile-gap" as string]: px(l.gap),
    ["--tile-fs" as string]: px(l.fontSize),
    ["--tile-r" as string]: px(l.radius),
    ["--split-y" as string]: px(l.splitY),
    ["--row-gap" as string]: px(l.rowGap),
    ["--line-gap" as string]: px(l.lineGap),
    ["--pad-x" as string]: px(g.padX),
    ["--pad-y" as string]: px(g.padY),
  };
}

type WakeState = "pending" | "active" | "released" | "unsupported" | "denied";

type Props = {
  initialSnapshot: Snapshot | null;
  initialActivity: ActivityEntry[];
  regionId: RegionId | null;
  mock: string | null;
  serverNow: number;
};

export function BoardView({
  initialSnapshot,
  initialActivity,
  regionId,
  mock,
  serverNow,
}: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(initialSnapshot);
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity);
  const [now, setNow] = useState(serverNow);
  const [shift, setShift] = useState(0);
  const [wake, setWake] = useState<WakeState>("pending");
  const rowsRef = useRef<HTMLOListElement>(null);
  const geo = useBoardGeometry(rowsRef);
  const compact = geo?.layout.compact ?? false;
  const slots = geo?.layout.rows ?? BOARD_MAX_ROWS;
  // Tiles flip only once the board has been measured and painted: the
  // first frame never animates.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!geo || armed) return;
    const t = setTimeout(() => setArmed(true), 50);
    return () => clearTimeout(t);
  }, [geo, armed]);

  // ── Polling, paused while hidden ────────────────────────────────────
  const poll = useCallback(async () => {
    const q = mock ? `?mock=${encodeURIComponent(mock)}` : "";
    const [snapRes, actRes] = await Promise.allSettled([
      fetch(`/api/aircraft${q}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<Snapshot>) : Promise.reject(r.status),
      ),
      fetch(`/api/activity?limit=100`, { cache: "no-store" }).then((r) =>
        r.ok
          ? (r.json() as Promise<{ entries: ActivityEntry[] }>)
          : Promise.reject(r.status),
      ),
    ]);
    // On failure keep the last read. Its fetched_at keeps aging, so the
    // header flips to "Feed quiet" on its own after two minutes.
    if (snapRes.status === "fulfilled" && Array.isArray(snapRes.value?.aircraft)) {
      setSnapshot(snapRes.value);
    }
    if (actRes.status === "fulfilled" && Array.isArray(actRes.value?.entries)) {
      setActivity(actRes.value.entries);
    }
    setNow(Date.now());
  }, [mock]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void poll();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  // ── Clock ───────────────────────────────────────────────────────────
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // ── Burn-in pixel shift ─────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setShift((s) => (s + 1) % SHIFTS.length), SHIFT_MS);
    return () => clearInterval(t);
  }, []);

  // ── Screen wake lock ────────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setWake("unsupported");
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (disposed) {
          void sentinel.release();
          return;
        }
        setWake("active");
        sentinel.addEventListener("release", () => {
          if (!disposed) setWake("released");
        });
      } catch {
        setWake("denied");
      }
    };
    // The lock drops whenever the tab hides; take it back on return. A
    // tap anywhere also retries, for browsers that want a gesture first.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    const onPointer = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerdown", onPointer);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, []);

  // ── Derived view ────────────────────────────────────────────────────
  const stale = isFeedStale(snapshot, now);
  const regional = useMemo(
    () => (snapshot ? filterSnapshotToRegion(snapshot, regionId) : null),
    [snapshot, regionId],
  );
  const status = useMemo(() => {
    if (!regional) return null;
    const fleet = new Map<string, FleetEntry>(regional.aircraft.map((a) => [a.tail, a]));
    return computeStatus(regional, fleet);
  }, [regional]);
  const rows = useMemo(
    () => buildBoardRows({ snapshot, activity, regionId, now, maxRows: slots }),
    [snapshot, activity, regionId, now, slots],
  );

  const state: "up" | "down" | "stale" = stale
    ? "stale"
    : status?.kind === "alert"
      ? "up"
      : "down";
  const lastRead = snapshot ? fmtClockPT(snapshot.fetched_at) : null;
  const regionLabel = (regionId ? REGIONS[regionId].label : "All Washington").toUpperCase();

  let word: string;
  let wordTone: string | undefined;
  let sub: string;
  if (state === "stale") {
    word = "FEED QUIET";
    wordTone = styles.toneStale;
    sub = lastRead ? `Feed quiet. Last read ${lastRead}` : "Feed quiet. No read yet";
  } else if (state === "up") {
    word = "SMOKEY UP";
    wordTone = styles.toneAlert;
    const n = status?.alertCount ?? 0;
    sub =
      n > 1
        ? `${n} birds up.`
        : `${status?.lead?.entry.nickname ?? status?.lead?.aircraft.tail ?? "The bird"} watching.`;
  } else {
    word = "ALL CLEAR";
    wordTone = styles.toneClear;
    sub = status?.footnote ?? "Quiet skies.";
  }

  const [sx, sy] = SHIFTS[shift] ?? [0, 0];

  return (
    <main
      className={`${styles.board} ${compact ? styles.compact : ""}`}
      data-board-state={state}
      data-wake-lock={wake}
      data-board-layout={geo ? (compact ? "compact" : "wide") : "pending"}
      data-board-tile={geo ? `${geo.layout.tileW}x${geo.layout.tileH}` : undefined}
      style={{
        ["--sx" as string]: `${sx}px`,
        ["--sy" as string]: `${sy}px`,
        ...geometryVars(geo),
      }}
    >
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>SmokySignal · Departures</div>
            <div className={styles.region}>{regionLabel}</div>
          </div>
          <div className={styles.status} role="status" aria-live="polite">
            <div className={`${styles.statusWord} ${wordTone ?? ""}`}>{word}</div>
            <div className={styles.statusSub}>{sub}</div>
          </div>
          <div className={styles.clock}>
            <div className={styles.clockTime} suppressHydrationWarning>
              {fmtClockPT(now)}
            </div>
            <div className={`${styles.eyebrow} ${styles.clockZone}`}>Pacific · 24h</div>
          </div>
        </header>

        <div className={styles.heads} aria-hidden="true">
          <span style={{ width: `calc(var(--cell) * ${BOARD_COLS.base + BOARD_GAP})` }}>From</span>
          {compact ? (
            <span>Flight · Status</span>
          ) : (
            <>
              <span style={{ width: `calc(var(--cell) * ${BOARD_COLS.name + BOARD_GAP})` }}>Flight</span>
              <span>Status</span>
            </>
          )}
        </div>

        {/* Lines are keyed by slot, like a real board: when a departure
            moves up a slot, only the letters that differ flip. */}
        <ol ref={rowsRef} className={styles.rows} aria-label="Departures">
          {Array.from({ length: slots }).map((_, i) => {
            const row = rows[i];
            if (row) {
              return <BoardLine key={i} slot={i} row={row} stale={stale} compact={compact} armed={armed} />;
            }
            if (i === 0) {
              // Stale with nothing to show is not the same as clear.
              const empty: BoardRow = {
                key: "empty",
                base: "",
                name: stale ? "FEED QUIET" : "QUIET SKIES",
                status: "",
                tone: "dim",
              };
              return <BoardLine key={i} slot={i} row={empty} stale={stale} compact={compact} armed={armed} />;
            }
            return <BoardLine key={i} slot={i} row={null} stale={false} compact={compact} armed={armed} />;
          })}
        </ol>

        <footer className={styles.footer}>
          {/* The one way out of the kiosk: small, dim, and still 44px tall. */}
          <Link href="/" className={styles.escape} data-testid="escape-link">
            ← SmokySignal
          </Link>
          <span>
            {lastRead ? `Last read ${lastRead} PT` : "No read yet"} · Every 15s
          </span>
        </footer>
      </div>
    </main>
  );
}

const BLANK: BoardRow = { key: "blank", base: "", name: "", status: "", tone: "dim" };

function BoardLine({
  slot,
  row,
  stale,
  compact,
  armed,
}: {
  slot: number;
  /** null renders a blank slot. */
  row: BoardRow | null;
  stale: boolean;
  compact: boolean;
  armed: boolean;
}) {
  const r = row ?? BLANK;
  const tone =
    r.tone === "alert"
      ? styles.toneRowAlert
      : r.tone === "neutral"
        ? styles.toneRowNeutral
        : styles.toneRowDim;
  const text = row ? boardRowText(row) : null;
  const t = (txt: string, width: number, offset: number) => (
    <Tiles text={txt} width={width} offset={offset} slot={slot} armed={armed} />
  );
  const base = t(r.base, BOARD_COLS.base, 0);
  const name = t(r.name, BOARD_COLS.name, BOARD_COLS.base);
  const status = t(r.status, BOARD_COLS.status, BOARD_COLS.base + BOARD_COLS.name);
  return (
    <li
      className={`${styles.row} ${tone} ${stale ? styles.rowStale : ""}`}
      data-board-row={text ?? undefined}
      aria-hidden={text ? undefined : true}
    >
      {text ? <span className={styles.srOnly}>{text.replace(/\s{2,}/g, ", ")}</span> : null}
      {compact ? (
        <>
          <span className={styles.line}>
            {base}
            <span className={styles.gap} />
            {name}
          </span>
          <span className={styles.line}>
            <span className={styles.indent} />
            {status}
          </span>
        </>
      ) : (
        <span className={styles.line}>
          {base}
          <span className={styles.gap} />
          {name}
          <span className={styles.gap} />
          {status}
        </span>
      )}
    </li>
  );
}

// One tile per character, keyed by position so a tile keeps its identity
// and only its letter changes.
function Tiles({
  text,
  width,
  offset,
  slot,
  armed,
}: {
  text: string;
  width: number;
  offset: number;
  slot: number;
  armed: boolean;
}) {
  const chars = text.padEnd(width).slice(0, width).split("");
  return (
    <span aria-hidden="true" className={styles.tiles}>
      {chars.map((ch, i) => (
        <Tile
          key={i}
          ch={ch}
          armed={armed}
          // Left-to-right ripple, a touch later on each lower line.
          delayMs={((offset + i) % ROW_CHARS) * 14 + slot * 40}
        />
      ))}
    </span>
  );
}

function Tile({ ch, armed, delayMs }: { ch: string; armed: boolean; delayMs: number }) {
  const prev = useRef(ch);
  const lastFlip = useRef(-Infinity);
  const [flip, setFlip] = useState(0);
  const [flipping, setFlipping] = useState(false);

  useIsoLayoutEffect(() => {
    if (prev.current === ch) return;
    prev.current = ch;
    // Blank tiles never animate; nor does anything before the first paint.
    if (!armed || ch === " " || prefersReducedMotion()) {
      setFlipping(false);
      return;
    }
    const t = performance.now();
    if (t - lastFlip.current < MIN_FLIP_INTERVAL_MS) return;
    lastFlip.current = t;
    setFlip((n) => n + 1);
    setFlipping(true);
  }, [ch, armed]);

  return (
    <span className={styles.tile}>
      <span
        key={flip}
        className={flipping ? `${styles.glyph} ${styles.flip}` : styles.glyph}
        style={flipping ? { animationDelay: `${delayMs}ms` } : undefined}
        // Drop the animation class once it has run: settled tiles keep no
        // animation and no transform.
        onAnimationEnd={() => setFlipping(false)}
      >
        {ch === " " ? " " : ch}
      </span>
    </span>
  );
}
