"use client";

import { useEffect, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { haversineNm } from "@/lib/geo";
import { roundDecimals } from "@/lib/input-validation";
import { SPOT_COORD_DECIMALS } from "@/lib/spot-payload";
import type { Aircraft } from "@/lib/types";
import { Tooltip } from "./Tooltip";

const STORAGE_KEY = "ss_last_spot";
const RATE_LIMIT_MS = 30_000;
const TABBAR_HEIGHT = 66;
const TOAST_MS = 3500;
/** A spot is worth a quick fix, not a perfect one: give up after 5 s. */
const FIX_TIMEOUT_MS = 5000;
/** A fix this fresh is good enough for a spot, and instant. */
const FIX_MAX_AGE_MS = 30_000;

type Phase = "idle" | "logging" | "done" | "failed";
type Toast = { text: string; tone: "info" | "ok" | "fail"; retry?: boolean };

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Wrapping localStorage protects us against iOS Safari private-browsing
// where the API throws on every call.
function safeReadLastSpot(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
function safeWriteLastSpot(ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    /* private mode — rate limit becomes per-session, that's fine */
  }
}

export function SpottedButton({
  airborne,
  toastTop = "112px",
}: {
  airborne: Aircraft[];
  /** Where the status toast sits (top of the map, clear of the bottom
   *  pill rows and the TRAIL chip). */
  toastTop?: string;
}) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    },
    [],
  );

  const flash = (
    text: string,
    tone: Toast["tone"] = "info",
    ms = TOAST_MS,
    retry = false,
  ) => {
    setToast({ text, tone, retry });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  };
  const settle = (p: Phase) => {
    setPhase(p);
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    phaseTimerRef.current = setTimeout(() => setPhase("idle"), 2500);
  };
  const fail = (text: string, retry = false) => {
    flash(text, "fail", retry ? 8000 : 5000, retry);
    settle("failed");
  };

  const onTap = async () => {
    if (typeof window === "undefined") return;
    if (busy) return; // single-flight — ignore re-taps while a fix is in flight

    // Immediate visual ack — the user gets feedback in the same frame as
    // the tap, so there's no "did anything happen?" ambiguity even if the
    // geolocation prompt takes a beat.
    setPulsing(true);
    setTimeout(() => setPulsing(false), 200);

    // 1) rate limit
    const last = safeReadLastSpot();
    if (last > 0 && Date.now() - last < RATE_LIMIT_MS) {
      flash("Spot logged already. Wait 30 s for the next one.");
      return;
    }
    // 2) feature check
    if (!navigator.geolocation) {
      fail("Need location to log a spot.");
      return;
    }

    // Instant state, same frame as the tap.
    setBusy(true);
    setPhase("logging");
    flash("Logging…", "info", FIX_TIMEOUT_MS + 10_000);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: FIX_MAX_AGE_MS,
          timeout: FIX_TIMEOUT_MS,
        });
      });
      const riderLat = pos.coords.latitude;
      const riderLon = pos.coords.longitude;
      const ts = Date.now();

      const payloadTails = airborne
        .filter((a) => a.lat != null && a.lon != null)
        .map((a) => ({
          tail: a.tail,
          lat: a.lat ?? null,
          lon: a.lon ?? null,
          distance_nm:
            a.lat != null && a.lon != null
              ? haversineNm(riderLat, riderLon, a.lat, a.lon)
              : null,
        }));

      const r = await fetch("/api/spot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Coarsen on-device too; the server re-rounds before storing
        // (lib/spot-payload.ts), so this is defense in depth.
        body: JSON.stringify({
          lat: roundDecimals(riderLat, SPOT_COORD_DECIMALS),
          lon: roundDecimals(riderLon, SPOT_COORD_DECIMALS),
          ts,
          airborne_tails: payloadTails,
        }),
      });
      if (r.status === 429) {
        // Server-side per-IP limit (lib/rate-limit.ts).
        fail("Too many spots. Wait a minute.");
        return;
      }
      if (!r.ok) {
        fail("Spot didn't save.", true);
        return;
      }
      safeWriteLastSpot(ts);
      flash(`Spot logged, ${hhmm(ts)}. Thanks.`, "ok");
      settle("done");
    } catch (e) {
      const code = (e as GeolocationPositionError | undefined)?.code;
      if (code === 1 /* PERMISSION_DENIED */) {
        fail("Location is off. Allow it in your browser to log spots.");
      } else if (code === 3 /* TIMEOUT */) {
        fail("No location fix in 5 s.", true);
      } else if (code === 2 /* POSITION_UNAVAILABLE */) {
        fail("No location fix.", true);
      } else {
        fail("Spot didn't save.", true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip
        side="left"
        content="Spotted a watcher? Tap to log your location and time. Helps validate the live feed."
      >
        <button
        type="button"
        aria-label={
          phase === "logging"
            ? "Logging your spot"
            : "Log a spot of an airborne aircraft"
        }
        aria-busy={busy}
        data-phase={phase}
        data-testid="spotted-button"
        onClick={onTap}
        style={{
          position: "fixed",
          bottom: `calc(var(--ss-tabbar-h, ${TABBAR_HEIGHT}px) + 30px)`,
          right: 16,
          zIndex: 25,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: SS_TOKENS.alert,
          color: SS_TOKENS.bg0,
          border: 0,
          cursor: "pointer",
          // Removes iOS' 300ms double-tap delay and disables browser
          // gestures (pinch zoom) on top of the tap target — the
          // single biggest cause of "tap doesn't respond" on Safari.
          touchAction: "manipulation",
          // Suppresses the iOS gray flash; we have our own scale animation.
          WebkitTapHighlightColor: "transparent",
          opacity: 1,
          outline: phase === "failed" ? `2px solid ${SS_TOKENS.fg0}` : undefined,
          outlineOffset: 3,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            "0 4px 16px rgba(245,184,64,0.30), 0 1px 4px rgba(0,0,0,0.40)",
          transform: pulsing ? "scale(0.9)" : "scale(1)",
          transition: "transform 200ms ease, opacity 200ms ease",
        }}
      >
        {phase === "logging" ? (
          <Spinner />
        ) : phase === "done" ? (
          <CheckIcon />
        ) : (
          <BinocularsIcon />
        )}
        </button>
      </Tooltip>
      {toast && (
        <div
          role={toast.tone === "fail" ? "alert" : "status"}
          data-testid="spotted-toast"
          data-tone={toast.tone}
          style={{
            // Top of the map, under the picker row and between the + and
            // the compass: clear of the TRAIL chip and the pill rows.
            // Absolute inside the radar's fixed <main>, so it centres on
            // the map, not under the desktop sidebar.
            position: "absolute",
            top: toastTop,
            left: 64,
            right: 56,
            zIndex: 26,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              maxWidth: 420,
              minHeight: 44,
              padding: toast.retry ? "0 0 0 12px" : "0 12px",
              borderRadius: 10,
              background: "rgba(21,24,29,0.96)",
              color: SS_TOKENS.fg0,
              border: `.5px solid ${
                toast.tone === "ok" ? SS_TOKENS.clear : SS_TOKENS.hairline2
              }`,
              fontSize: 13,
              lineHeight: 1.3,
              pointerEvents: "auto",
            }}
          >
            <span>{toast.text}</span>
            {toast.retry && (
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  void onTap();
                }}
                style={{
                  minHeight: 44,
                  minWidth: 44,
                  padding: "0 12px",
                  background: "transparent",
                  border: 0,
                  color: SS_TOKENS.sky,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  touchAction: "manipulation",
                }}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Spinner() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  );
}

function BinocularsIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 4h3l1 4" />
      <path d="M19 4h-3l-1 4" />
      <path d="M9 8h6" />
      <circle cx="6.5" cy="14.5" r="3.5" />
      <circle cx="17.5" cy="14.5" r="3.5" />
      <path d="M10 14.5h4" />
    </svg>
  );
}
