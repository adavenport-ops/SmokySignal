"use client";

// /glance body. Read-only: the only control is the small EXIT link.
//
//   - Polls /api/aircraft every 15 s while visible (the server holds the
//     same read for ~10 s) and re-reads when the tab comes back.
//   - Distance + bearing only when geolocation is ALREADY granted. This
//     view never calls getCurrentPosition unless Permissions says
//     "granted", so it can never raise a prompt.
//   - Holds a screen wake lock while visible, released when hidden.
//   - Forces high contrast on <body> and restores it on exit.
//   - A stale or missing read renders FEED QUIET, never DOWN
//     (lib/glance.ts glanceModel).

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatTs } from "@/lib/time";
import {
  fmtMiles,
  glanceModel,
  type GlanceModel,
  type RiderPos,
} from "@/lib/glance";
import type { Snapshot } from "@/lib/types";
import { SpeedWarning } from "@/components/SpeedWarning";
import s from "./glance.module.css";

const POLL_MS = 15_000;

type WakeSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (t: string, l: () => void) => void;
};
type WakeNav = Navigator & {
  wakeLock?: { request: (t: "screen") => Promise<WakeSentinel> };
};

type Props = {
  initialSnapshot: Snapshot | null;
  serverNow: number;
  /** Validated ?mock= value to forward to the API, or null. */
  mock: string | null;
  /** Speed warning kill switch (lib/flags.ts). The rider opts in on /settings. */
  speedWarningAvailable?: boolean;
};

const WORD = { up: "UP", down: "DOWN", stale: "NO READ" } as const;

export function GlanceView({ initialSnapshot, serverNow, mock, speedWarningAvailable = true }: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(initialSnapshot);
  const [now, setNow] = useState(serverNow);
  const [rider, setRider] = useState<RiderPos | null>(null);
  const [mounted, setMounted] = useState(false);

  // Clock tick: drives the 24h clock and re-evaluates staleness.
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Forced high contrast for as long as this screen is open.
  useEffect(() => {
    const prev = document.body.dataset.contrast;
    document.body.dataset.contrast = "high";
    return () => {
      if (prev === undefined) delete document.body.dataset.contrast;
      else document.body.dataset.contrast = prev;
    };
  }, []);

  // Poll the snapshot while visible.
  useEffect(() => {
    const url = `/api/aircraft${mock ? `?mock=${encodeURIComponent(mock)}` : ""}`;
    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;
    let alive = true;
    const poll = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as Snapshot;
        if (alive && j && Array.isArray(j.aircraft)) setSnap(j);
      } catch {
        // Keep the last snapshot; its age turns it into NO READ.
      }
    };
    const start = () => {
      if (timer) return;
      void poll();
      timer = setInterval(() => void poll(), POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      ctrl?.abort();
    };
    const onVis = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mock]);

  // Rider position, only when permission is already granted.
  useEffect(() => {
    if (!("geolocation" in navigator) || !navigator.permissions?.query) return;
    let watchId: number | null = null;
    let status: PermissionStatus | null = null;
    let dead = false;
    const clear = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const apply = () => {
      if (dead || !status) return;
      if (status.state !== "granted") {
        clear();
        setRider(null);
        return;
      }
      if (watchId != null || document.hidden) return;
      watchId = navigator.geolocation.watchPosition(
        (p) => setRider({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => setRider(null),
        { enableHighAccuracy: false, maximumAge: 15_000, timeout: 20_000 },
      );
    };
    const onVis = () => {
      if (document.hidden) clear();
      else apply();
    };
    navigator.permissions
      .query({ name: "geolocation" })
      .then((st) => {
        if (dead) return;
        status = st;
        st.onchange = apply;
        apply();
      })
      .catch(() => {});
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      clear();
      if (status) status.onchange = null;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Screen wake lock: hold while visible, release when hidden.
  const sentinel = useRef<WakeSentinel | null>(null);
  useEffect(() => {
    const nav = navigator as WakeNav;
    if (!nav.wakeLock) return;
    let dead = false;
    const acquire = async () => {
      if (dead || document.hidden) return;
      if (sentinel.current && !sentinel.current.released) return;
      try {
        sentinel.current = await nav.wakeLock!.request("screen");
      } catch {
        sentinel.current = null; // battery saver, or no user activation yet
      }
    };
    const release = () => {
      const cur = sentinel.current;
      sentinel.current = null;
      if (cur && !cur.released) void cur.release().catch(() => {});
    };
    const onVis = () => (document.hidden ? release() : void acquire());
    void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVis);
      release();
    };
  }, []);

  const m = glanceModel(snap, now, rider);
  const clock = mounted ? formatTs(now, "time-sec") : "--:--:--";
  const read = m.readAt != null ? formatTs(m.readAt, "time-sec") : null;

  return (
    <main
      className={s.root}
      data-glance
      data-kind={m.kind}
      aria-label="Smokey status at a glance"
    >
      <div className={s.bar}>
        <Link href="/" className={`${s.exit} ss-mono`} aria-label="Leave handlebar mode, back to SmokySignal" data-testid="escape-link">
          ← SmokySignal
        </Link>
        <span className={`${s.clock} ss-mono`} data-glance-clock suppressHydrationWarning>
          {clock}
        </span>
      </div>

      <div className={s.main}>
        <div className={s.status} role="status" aria-live="polite">
          <h1 className={`${s.word} ss-mono`} data-glance-word>
            {WORD[m.kind]}
          </h1>
          <p className={s.sub}>{subLine(m)}</p>
        </div>
        <Panel m={m} read={read} />
      </div>

      <div className={`${s.foot} ss-mono`}>
        <span>{read ? `READ ${read}` : "NO READ YET"}</span>
        <span>{m.ageS != null && m.kind !== "stale" ? `${m.ageS}s ago` : "smokysignal.app"}</span>
      </div>

      {/* N1b speed warning: on-device only, opt-in from /settings. */}
      <SpeedWarning aircraft={snap?.aircraft} available={speedWarningAvailable} />
    </main>
  );
}

function subLine(m: GlanceModel): string {
  if (m.kind === "up") {
    const n = m.count;
    return `${n} bird${n === 1 ? "" : "s"} up. Mind the throttle.`;
  }
  if (m.kind === "down") return "No bird up. Send it.";
  return "Feed's quiet.";
}

function Panel({ m, read }: { m: GlanceModel; read: string | null }) {
  if (m.kind === "up" && m.nearest) {
    return (
      <section className={s.nearest} aria-label="Nearest Smokey" data-glance-nearest>
        <span className={`${s.label} ss-mono`}>Nearest &middot; {m.nearest.name}</span>
        <span className={`${s.dist} ss-mono`}>{fmtMiles(m.nearest.miles)}</span>
        <span className={`${s.bearing} ss-mono`}>
          {m.nearest.compass} {String(m.nearest.bearingDeg).padStart(3, "0")}&deg;
        </span>
      </section>
    );
  }
  if (m.kind === "up") {
    return (
      <section className={s.nearest} aria-label="Nearest Smokey">
        <span className={`${s.label} ss-mono`}>Nearest{m.leadName ? ` · ${m.leadName}` : ""}</span>
        <p className={s.note}>
          Distance needs location. It is off for this site, or not reporting. Allow it in
          your browser settings before you ride.
        </p>
      </section>
    );
  }
  if (m.kind === "down") {
    return (
      <section className={s.nearest} aria-label="Sky">
        <span className={`${s.label} ss-mono`}>Sky</span>
        <p className={s.note}>
          Nothing up over Washington on the last read. Smokey can be up at any hour.
        </p>
      </section>
    );
  }
  return (
    <section className={s.nearest} aria-label="Feed">
      <span className={`${s.label} ss-mono`}>Feed quiet</span>
      <p className={s.note}>
        {read
          ? `Last good read ${read}. Not calling it down. Checking again.`
          : "No good read yet. Not calling it down. Checking again."}
      </p>
    </section>
  );
}
