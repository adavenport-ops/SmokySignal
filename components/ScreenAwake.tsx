"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { SS_TOKENS, TAP_MIN } from "@/lib/tokens";
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

// ---------------------------------------------------------------------
// Shared state. The lock is held by one controller mounted in the (tabs)
// layout, so it covers every tabbed route. The toggles (Home header,
// /settings) only read and flip the preference; they never hold a lock
// of their own. A tiny external store keeps every toggle in sync.
// ---------------------------------------------------------------------

type AwakeState = { supported: boolean; enabled: boolean; active: boolean };

const SERVER_STATE: AwakeState = { supported: false, enabled: true, active: false };
let state: AwakeState = SERVER_STATE;
let booted = false;
const listeners = new Set<() => void>();

function emit(next: Partial<AwakeState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  const supported = Boolean((navigator as WakeLockNavigator).wakeLock);
  let enabled = true;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === PREF_OFF) enabled = false;
  } catch {
    // storage blocked: default to on
  }
  state = { supported, enabled, active: false };
}

function subscribe(l: () => void) {
  boot();
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  boot();
  return state;
}

function getServerSnapshot() {
  return SERVER_STATE;
}

function useAwakeState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function setEnabled(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? PREF_ON : PREF_OFF);
  } catch {
    // storage blocked: preference lasts for this page only
  }
  emit({ enabled: next });
}

/**
 * Holds the screen wake lock while the rider is on a tabbed route and
 * the preference is on. Renders nothing. Mounted once by the (tabs)
 * layout; the visible toggles live in the Home header and /settings.
 */
export function ScreenAwakeController() {
  const { supported, enabled } = useAwakeState();
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!supported) return;
    const release = async () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) {
        try {
          await s.release();
        } catch {
          // already gone
        }
      }
      emit({ active: false });
    };
    if (!enabled) {
      void release();
      return;
    }
    const acquire = async () => {
      const nav = navigator as WakeLockNavigator;
      if (!nav.wakeLock) return;
      try {
        const s = await nav.wakeLock.request("screen");
        sentinelRef.current = s;
        emit({ active: true });
        // Browsers auto-release on tab hide; mark inactive so the next
        // visible event re-acquires.
        s.addEventListener?.("release", () => {
          if (sentinelRef.current === s) sentinelRef.current = null;
          emit({ active: false });
        });
      } catch {
        emit({ active: false });
      }
    };
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
  }, [supported, enabled]);

  return null;
}

/**
 * Screen-awake toggle. `icon` is the 44px moon button for the Home
 * header; `row` is the labelled switch row on /settings. Browsers
 * without the Wake Lock API render nothing for `icon` and an
 * explanatory line for `row`.
 */
export function ScreenAwakeToggle({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const { supported, enabled, active } = useAwakeState();
  // Lit = wake lock is currently held. Lit is neutral fg0, not orange:
  // alert is reserved for "Smokey is up".
  const lit = enabled && active;
  const onToggle = () => setEnabled(!enabled);

  if (variant === "row") {
    return (
      <div
        data-testid="awake-setting"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 12,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          background: SS_TOKENS.bg1,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: SS_TOKENS.fg0 }}>
            Keep screen awake
          </div>
          <div style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.5, marginTop: 2 }}>
            {supported
              ? "The screen stays on while SmokySignal is open. Handy on a mount."
              : "This browser can't hold the screen on. Your phone's display settings still apply."}
          </div>
        </div>
        {supported && (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Keep screen awake"
            onClick={onToggle}
            className="ss-mono"
            style={{
              minWidth: 64,
              minHeight: TAP_MIN,
              padding: "0 14px",
              borderRadius: 999,
              border: `.5px solid ${enabled ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
              background: enabled ? SS_TOKENS.cta : "transparent",
              color: enabled ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".08em",
              cursor: "pointer",
              touchAction: "manipulation",
              flexShrink: 0,
            }}
          >
            {enabled ? "ON" : "OFF"}
          </button>
        )}
      </div>
    );
  }

  if (!supported) return null;

  return (
    <Tooltip
      side="bottom"
      align="end"
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
        data-testid="awake-toggle"
        style={{
          width: TAP_MIN,
          height: TAP_MIN,
          padding: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: 0,
          color: lit ? SS_TOKENS.fg0 : SS_TOKENS.fg1,
          cursor: "pointer",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(11,13,16,0.55)",
            border: `.5px solid ${SS_TOKENS.hairline}`,
          }}
        >
          <MoonStateIcon lit={lit} />
        </span>
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
      width="16"
      height="16"
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
