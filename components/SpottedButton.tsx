"use client";

import { useEffect, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { haversineNm } from "@/lib/geo";
import type { Aircraft } from "@/lib/types";

const STORAGE_KEY = "ss_last_spot";
const RATE_LIMIT_MS = 30_000;
const TABBAR_HEIGHT = 66;

export function SpottedButton({ airborne }: { airborne: Aircraft[] }) {
  const [toast, setToast] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2000);
  };

  const onTap = async () => {
    if (typeof window === "undefined") return;
    // 1) rate limit
    const last = Number(window.localStorage.getItem(STORAGE_KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < RATE_LIMIT_MS) {
      flash("Easy there — wait a bit");
      return;
    }
    // 2) one-shot location fix
    if (!navigator.geolocation) {
      flash("Need location to log a spot");
      return;
    }

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 5000,
        });
      });
      const riderLat = pos.coords.latitude;
      const riderLon = pos.coords.longitude;
      const ts = Date.now();

      // 4) build airborne_tails snapshot
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

      // 5) post
      const r = await fetch("/api/spot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: riderLat,
          lon: riderLon,
          ts,
          airborne_tails: payloadTails,
        }),
      });
      if (!r.ok) {
        flash("Spot didn't save");
        return;
      }
      // 6) record success time
      window.localStorage.setItem(STORAGE_KEY, String(ts));
      flash("Spotted, thanks");
      // 7) brief scale animation
      setPulsing(true);
      setTimeout(() => setPulsing(false), 200);
    } catch (e) {
      const code = (e as GeolocationPositionError | undefined)?.code;
      if (code === 1 /* PERMISSION_DENIED */) {
        flash("Need location to log a spot");
      } else {
        flash("Couldn't get a fix");
      }
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Log a spot of an airborne aircraft"
        onClick={onTap}
        style={{
          position: "fixed",
          bottom: TABBAR_HEIGHT + 30,
          right: 16,
          zIndex: 25,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: SS_TOKENS.alert,
          color: SS_TOKENS.bg0,
          border: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            "0 4px 16px rgba(245,184,64,0.30), 0 1px 4px rgba(0,0,0,0.40)",
          transform: pulsing ? "scale(0.9)" : "scale(1)",
          transition: "transform 200ms ease",
        }}
      >
        <BinocularsIcon />
      </button>
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: TABBAR_HEIGHT + 100,
            zIndex: 26,
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(11,13,16,0.92)",
            color: SS_TOKENS.fg0,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: ".04em",
            whiteSpace: "nowrap",
          }}
        >
          {toast}
        </div>
      )}
    </>
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
