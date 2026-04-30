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
 * Renders a small toggle badge top-right that lets riders flip the lock
 * on/off; the choice persists in localStorage. If the API is missing we
 * fail silent — no UI at all.
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

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={
        enabled ? "Screen-awake on, tap to disable" : "Screen-awake off, tap to enable"
      }
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 30,
        background: enabled ? SS_TOKENS.bg2 : "transparent",
        border: `.5px solid ${enabled ? `${SS_TOKENS.sky}55` : SS_TOKENS.hairline}`,
        color: enabled ? SS_TOKENS.sky : SS_TOKENS.fg3,
        borderRadius: 999,
        padding: "5px 10px",
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: ".08em",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: active ? SS_TOKENS.sky : SS_TOKENS.fg3,
          boxShadow: active ? `0 0 6px ${SS_TOKENS.sky}` : "none",
        }}
      />
      {enabled ? "AWAKE" : "OFF"}
    </button>
  );
}
