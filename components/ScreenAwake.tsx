"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";

const STORAGE_KEY = "ss_wake_lock";
const PREF_ON = "on";
const PREF_OFF = "off";

type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
};

/**
 * Keeps the screen awake while the user is on the rider-facing screens.
 * Mounted by app/(tabs)/layout.tsx so /admin and /about are unaffected.
 *
 * Renders a small sun-icon toggle top-right. Bright = active, dim = off.
 * Tap toggles; choice persists in localStorage. Wake-lock-unsupported
 * browsers render nothing — silent fail per spec.
 */
export function ScreenAwake() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  // Bootstrap once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === PREF_OFF) setEnabled(false);
  }, []);

  const release = useCallback(async () => {
    const s = sentinelRef.current;
    sentinelRef.current = null;
    if (s && !s.released) {
      try {
        await s.release();
      } catch {
        // already gone
      }
    }
    setActive(false);
  }, []);

  const acquire = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    try {
      const s = await nav.wakeLock.request("screen");
      sentinelRef.current = s;
      setActive(true);
      // Browsers auto-release on tab hide; mark inactive so the next visible
      // event re-acquires.
      s.addEventListener?.("release", () => {
        if (sentinelRef.current === s) sentinelRef.current = null;
        setActive(false);
      });
    } catch {
      setActive(false);
    }
  }, []);

  // Acquire / release based on enabled + visibility.
  useEffect(() => {
    if (!supported) return;
    if (!enabled) {
      void release();
      return;
    }
    void acquire();
    const onVis = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        void acquire();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void release();
    };
  }, [supported, enabled, acquire, release]);

  if (!supported) return null;

  const onToggle = () => {
    setEnabled((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next ? PREF_ON : PREF_OFF);
      }
      return next;
    });
  };

  // Bright = active (lock held). Dim = off (preference disabled, or tab
  // hidden so browser released the lock).
  const lit = enabled && active;
  const color = lit ? SS_TOKENS.alert : SS_TOKENS.fg3;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={
        enabled
          ? "Screen wake lock on, tap to disable"
          : "Screen wake lock off, tap to enable"
      }
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 30,
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: lit ? "rgba(245,184,64,0.12)" : "rgba(11,13,16,0.55)",
        border: `.5px solid ${lit ? `${SS_TOKENS.alert}55` : SS_TOKENS.hairline}`,
        color,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        transition: "color 200ms, background 200ms",
      }}
    >
      <SunIcon lit={lit} />
    </button>
  );
}

function SunIcon({ lit }: { lit: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={lit ? 2 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" fill={lit ? "currentColor" : "none"} />
      <path d="M12 2 v2" />
      <path d="M12 20 v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12 h2" />
      <path d="M20 12 h2" />
      <path d="m4.93 19.07 1.41-1.41" />
      <path d="m17.66 6.34 1.41-1.41" />
    </svg>
  );
}
