"use client";

// The Board, client half. Polls /api/aircraft and /api/activity every
// 15 s while the tab is visible, holds a screen wake lock where the
// browser offers one, and nudges the whole frame by 1 px every few
// minutes so a TV left on all day doesn't burn the layout in.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { computeStatus } from "@/lib/status";
import { isFeedStale } from "@/lib/beacon";
import {
  BOARD_COLS,
  BOARD_MAX_ROWS,
  boardRowText,
  buildBoardRows,
  filterSnapshotToRegion,
  fmtClockPT,
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
    () => buildBoardRows({ snapshot, activity, regionId, now }),
    [snapshot, activity, regionId, now],
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
      className={styles.board}
      data-board-state={state}
      data-wake-lock={wake}
      style={{ ["--sx" as string]: `${sx}px`, ["--sy" as string]: `${sy}px` }}
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
            <div className={styles.eyebrow} style={{ marginTop: "0.8vh" }}>
              Pacific · 24h
            </div>
          </div>
        </header>

        <div className={styles.heads} aria-hidden="true">
          <span style={{ width: `calc(var(--cell) * ${BOARD_COLS.base + 2})` }}>From</span>
          <span style={{ width: `calc(var(--cell) * ${BOARD_COLS.name + 2})` }}>Flight</span>
          <span>Status</span>
        </div>

        <ol className={styles.rows} aria-label="Departures">
          {rows.length === 0 ? (
            <BoardLine
              row={{
                key: "empty",
                base: "",
                // Stale with nothing to show is not the same as clear.
                name: stale ? "FEED QUIET" : "QUIET SKIES",
                status: "",
                tone: "dim",
              }}
              stale={stale}
            />
          ) : (
            rows.map((r) => <BoardLine key={r.key} row={r} stale={stale} />)
          )}
          {Array.from({
            length: Math.max(0, BOARD_MAX_ROWS - Math.max(rows.length, 1)),
          }).map((_, i) => (
            <BlankLine key={`blank-${i}`} />
          ))}
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

function BoardLine({ row, stale }: { row: BoardRow; stale: boolean }) {
  const tone =
    row.tone === "alert"
      ? styles.toneRowAlert
      : row.tone === "neutral"
        ? styles.toneRowNeutral
        : styles.toneRowDim;
  const text = boardRowText(row);
  return (
    <li
      className={`${styles.row} ${tone} ${stale ? styles.rowStale : ""}`}
      data-board-row={text}
    >
      <span className={styles.srOnly}>{text.replace(/\s{2,}/g, ", ")}</span>
      <Tiles text={row.base} width={BOARD_COLS.base} offset={0} />
      <span className={styles.gap} />
      <Tiles text={row.name} width={BOARD_COLS.name} offset={BOARD_COLS.base} />
      <span className={styles.gap} />
      <Tiles
        text={row.status}
        width={BOARD_COLS.status}
        offset={BOARD_COLS.base + BOARD_COLS.name}
      />
    </li>
  );
}

function BlankLine() {
  return (
    <li className={`${styles.row} ${styles.toneRowDim}`} aria-hidden="true">
      <Tiles text="" width={BOARD_COLS.base} offset={0} />
      <span className={styles.gap} />
      <Tiles text="" width={BOARD_COLS.name} offset={BOARD_COLS.base} />
      <span className={styles.gap} />
      <Tiles text="" width={BOARD_COLS.status} offset={BOARD_COLS.base + BOARD_COLS.name} />
    </li>
  );
}

// One tile per character. Keyed on index + character, so a changed
// letter remounts its tile and replays the flip; unchanged tiles stay put.
function Tiles({ text, width, offset }: { text: string; width: number; offset: number }) {
  const chars = text.padEnd(width).slice(0, width).split("");
  return (
    <span aria-hidden="true" style={{ display: "inline-flex" }}>
      {chars.map((ch, i) => (
        <span
          key={`${i}:${ch}`}
          className={styles.tile}
          style={{ ["--d" as string]: `${((offset + i) % ROW_CHARS) * 18}ms` }}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
