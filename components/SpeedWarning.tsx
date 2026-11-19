"use client";

// Speed warning (N1b). Full-screen "EASE OFF" when the rider is over
// their limit, inside a hot zone, with a police-mission bird airborne
// within 5 nm. Mounted on /flights (Now) and /glance only.
//
// Runs only when ALL of these hold:
//   - the server kill switch is on (lib/flags.ts, /admin)
//   - the rider turned it on in /settings (localStorage, default OFF)
//   - the page is in the foreground (unmounts when hidden, so the GPS
//     watch stops and the hysteresis resets)
//   - location permission is already granted. This component never
//     raises the permission prompt; the /settings toggle does that, once,
//     when the rider turns the warning on.
//
// Privacy: the GPS fix and speed live in this component's memory and go
// nowhere. The decision is lib/speed-warning.ts (pure, no network). The
// only request this file makes is GET /api/hotzones, a public grid that
// carries nothing about the rider (no query string, no body).

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Aircraft } from "@/lib/types";
import type { HotZone } from "@/lib/hotzones";
import {
  INITIAL_WARN_STATE,
  formatWarning,
  isMuted,
  muteUntilFrom,
  resolveLimitMph,
  runWarningTick,
  speedMphFromMps,
  stepWarning,
  type ResolvedLimit,
  type SpeedWarningInput,
  type WarnState,
} from "@/lib/speed-warning";
import {
  DEFAULT_SPEED_WARNING_PREFS,
  SPEED_WARNING_PREFS_EVENT,
  readSpeedWarningPrefs,
  setSpeedWarningMuteUntil,
  type SpeedWarningPrefs,
} from "@/lib/speed-warning-prefs";
import { speakAlert } from "@/lib/voice-mode";
import s from "./SpeedWarning.module.css";

const CLOCK_MS = 1000;
/** One short pattern, once per warning. */
const VIBRATE_PATTERN = [180, 90, 180];

type Fix = { lat: number; lon: number; speedMps: number | null };

const NO_AIRCRAFT: Aircraft[] = [];

type Props = {
  /** Live fleet from the host page's own poll. Filtered to police in
   *  evaluateWarning (countsAsSmokey). */
  aircraft: Aircraft[] | null | undefined;
  /** Server kill switch (lib/flags.ts). Default on. */
  available?: boolean;
};

/** Rider prefs, live: re-read on our own writes and on other tabs'. */
export function useSpeedWarningPrefs(): SpeedWarningPrefs {
  const [prefs, setPrefs] = useState<SpeedWarningPrefs>(DEFAULT_SPEED_WARNING_PREFS);
  useEffect(() => {
    const sync = () => setPrefs(readSpeedWarningPrefs());
    sync();
    window.addEventListener(SPEED_WARNING_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPEED_WARNING_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return prefs;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}

export function SpeedWarning({ aircraft, available = true }: Props) {
  const prefs = useSpeedWarningPrefs();
  const visible = usePageVisible();
  if (!available || !prefs.enabled || !visible) return null;
  return <SpeedWarningActive aircraft={aircraft ?? NO_AIRCRAFT} prefs={prefs} />;
}

type Action =
  | { type: "fix"; input: SpeedWarningInput | null; now: number }
  | { type: "fleet"; input: SpeedWarningInput | null; now: number }
  | { type: "clock"; now: number };

function reducer(state: WarnState, a: Action): WarnState {
  if (a.type === "clock") return stepWarning(state, { kind: "clock", now: a.now });
  return runWarningTick(state, a.type, a.input, a.now);
}

function buildInput(
  fix: Fix,
  aircraft: Aircraft[],
  zones: HotZone[],
  prefs: SpeedWarningPrefs,
): { input: SpeedWarningInput | null; limit: ResolvedLimit } {
  const limit = resolveLimitMph({
    riderLimitMph: prefs.limitMph,
    useCorridorDefaults: prefs.useCorridorDefaults,
    lat: fix.lat,
    lon: fix.lon,
  });
  const mph = speedMphFromMps(fix.speedMps);
  if (mph == null) return { input: null, limit };
  return {
    input: {
      riderLat: fix.lat,
      riderLon: fix.lon,
      riderSpeedMph: mph,
      postedLimitMph: limit.limitMph,
      hotZones: zones,
      airborneAircraft: aircraft,
    },
    limit,
  };
}

function useHotZones(): HotZone[] {
  const [zones, setZones] = useState<HotZone[]>([]);
  useEffect(() => {
    let dead = false;
    fetch("/api/hotzones")
      .then((r) => (r.ok ? r.json() : { zones: [] }))
      .then((d: { zones?: unknown }) => {
        if (!dead && Array.isArray(d?.zones)) setZones(d.zones as HotZone[]);
      })
      .catch(() => {
        // no zones = never fires; that is the safe failure
      });
    return () => {
      dead = true;
    };
  }, []);
  return zones;
}

/** watchPosition, but only once permission is already "granted". */
function useGrantedFix(onFix: (f: Fix) => void): void {
  const cb = useRef(onFix);
  cb.current = onFix;
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let watchId: number | null = null;
    let status: PermissionStatus | null = null;
    let dead = false;
    const start = () => {
      if (dead || watchId != null) return;
      watchId = navigator.geolocation.watchPosition(
        (p) =>
          cb.current({
            lat: p.coords.latitude,
            lon: p.coords.longitude,
            speedMps: p.coords.speed,
          }),
        () => {
          // denied or no fix: the clock step stands the warning down
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 },
      );
    };
    const stop = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const apply = () => {
      if (!status) return;
      if (status.state === "granted") start();
      else stop();
    };
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((st) => {
          if (dead) return;
          status = st;
          st.addEventListener("change", apply);
          apply();
        })
        // No Permissions API answer: the rider granted location when they
        // turned this on in /settings, so watching will not prompt.
        .catch(start);
    } else {
      start();
    }
    return () => {
      dead = true;
      stop();
      status?.removeEventListener("change", apply);
    };
  }, []);
}

function SpeedWarningActive({
  aircraft,
  prefs,
}: {
  aircraft: Aircraft[];
  prefs: SpeedWarningPrefs;
}) {
  const zones = useHotZones();
  const [state, dispatch] = useReducer(reducer, INITIAL_WARN_STATE);
  const [now, setNow] = useState(() => Date.now());
  const [limit, setLimit] = useState<ResolvedLimit | null>(null);

  const ctx = useRef({ aircraft, zones, prefs });
  ctx.current = { aircraft, zones, prefs };
  const lastFix = useRef<Fix | null>(null);

  useGrantedFix((fix) => {
    lastFix.current = fix;
    const { input, limit: l } = buildInput(
      fix,
      ctx.current.aircraft,
      ctx.current.zones,
      ctx.current.prefs,
    );
    setLimit(l);
    dispatch({ type: "fix", input, now: Date.now() });
  });

  // Fleet or zone refresh: re-check against the last fix. Can clear the
  // warning (bird left the radius) but never counts toward showing it.
  useEffect(() => {
    const fix = lastFix.current;
    if (!fix) return;
    const { input } = buildInput(fix, aircraft, zones, prefs);
    dispatch({ type: "fleet", input, now: Date.now() });
  }, [aircraft, zones, prefs]);

  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      dispatch({ type: "clock", now: n });
    }, CLOCK_MS);
    return () => clearInterval(t);
  }, []);

  const muted = isMuted(prefs.muteUntil, now);
  const showing = state.phase === "showing" && state.detail != null && !muted;

  const copy = useMemo(
    () =>
      state.detail
        ? formatWarning({ birdNm: state.detail.birdNm, overMph: state.detail.overMph })
        : null,
    [state.detail],
  );

  // Haptic + voice once per warning, on the way in.
  const announced = useRef(false);
  useEffect(() => {
    if (!showing) {
      announced.current = false;
      return;
    }
    if (announced.current || !copy) return;
    announced.current = true;
    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate(VIBRATE_PATTERN);
    } catch {
      // unsupported or blocked
    }
    speakAlert(copy.spoken); // no-op unless voice mode is on
  }, [showing, copy]);

  if (!showing || !copy) return null;
  return (
    <WarningOverlay
      detail={copy.detail}
      text={copy.text}
      limit={limit}
      onMute={() => setSpeedWarningMuteUntil(muteUntilFrom(Date.now()))}
    />
  );
}

/** Numbers in the detail line get tabular figures. Mono at this size
 *  spreads "1.2" into "1 . 2", so the sentence stays in Inter. */
function DetailLine({ detail }: { detail: string }) {
  const line = detail.charAt(0).toUpperCase() + detail.slice(1);
  const parts = line.split(/(\d+(?:\.\d+)?)/);
  return (
    <p className={s.detail} data-testid="speed-warning-detail">
      {parts.map((p, i) =>
        /^\d/.test(p) ? (
          <span key={i} className={s.num}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

export function WarningOverlay({
  detail,
  text,
  limit,
  onMute,
}: {
  detail: string;
  text: string;
  limit: ResolvedLimit | null;
  onMute: () => void;
}) {
  const limitLine = limit
    ? `Limit ${limit.limitMph} · ${limit.source === "corridor" ? `${limit.corridor} default` : "your setting"}`
    : null;
  return (
    <div
      className={s.root}
      role="alert"
      aria-live="assertive"
      aria-label={text}
      data-testid="speed-warning"
    >
      <div className={s.edge} aria-hidden="true" />
      <span className={`${s.eyebrow} ss-mono`}>Speed warning</span>
      <h2 className={s.headline}>EASE OFF</h2>
      <DetailLine detail={detail} />
      <p className={s.note}>Ride within the posted limit.</p>
      {limitLine && <span className={`${s.meta} ss-mono`}>{limitLine}</span>}
      <button type="button" className={s.mute} onClick={onMute} data-testid="speed-warning-mute">
        Mute 10 min
      </button>
    </div>
  );
}
