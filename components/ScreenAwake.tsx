"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { Tooltip } from "./Tooltip";

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
 * Mounted by TabBar, so it only exists on (tabs) routes.
 *
 * Renders as a moon toggle inside the TabBar. Filled moon-with-slash
 * (MoonOff) = lock is held / screen won't sleep. Outline moon = lock
 * released / screen will sleep. Tap toggles; choice persists in
 * localStorage. Wake-lock-unsupported browsers render nothing.
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
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === PREF_OFF) setEnabled(false);
    } catch {
      // storage blocked: default to on
    }
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
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? PREF_ON : PREF_OFF);
        } catch {
          // storage blocked: preference lasts for this page only
        }
      }
      return next;
    });
  };

  // Lit = wake lock is currently held. Unlit = preference disabled or
  // tab hidden so the browser released it. Lit is neutral fg0, not
  // orange: alert is reserved for "Smokey is up".
  const lit = enabled && active;

  // Renders as a tab-bar item (mounted inside TabBar) instead of a
  // fixed top-right button. The old floating moon sat on top of page
  // headers and "Back" links on every route.
  return (
    <Tooltip
      side="top"
      content={
        lit
          ? "Screen stays awake while SmokySignal is open. Tap to let it sleep."
          : "Screen sleeps normally. Tap to keep it awake."
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        aria-label={
          enabled ? "Keep screen awake (currently on)" : "Keep screen awake (currently off)"
        }
        className="ss-tabbar-item"
        style={{ color: lit ? SS_TOKENS.fg0 : SS_TOKENS.fg1 }}
      >
        <span style={{ display: "flex", lineHeight: 1 }}>
          <MoonStateIcon lit={lit} />
        </span>
        <span className="ss-tabbar-label">Awake</span>
      </button>
    </Tooltip>
  );
}

// Lucide-style Moon (lit=false: outline, screen will sleep) and
// MoonOff (lit=true: filled crescent with diagonal slash, screen
// won't sleep).
function MoonStateIcon({ lit }: { lit: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={lit ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      {lit && <path d="m2 2 20 20" />}
    </svg>
  );
}
