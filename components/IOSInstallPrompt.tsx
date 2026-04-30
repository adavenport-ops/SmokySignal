"use client";

import { useEffect, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";

const STORAGE_KEY = "ss_install_dismissed";
const DISMISS_DAYS = 30;
const TABBAR_HEIGHT = 66;

type Standalone = Navigator & { standalone?: boolean };

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iPadOS 13+ reports as Mac; check maxTouchPoints to disambiguate.
  const iPadOS =
    ua.includes("Macintosh") &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return Boolean((navigator as Standalone).standalone);
}

function isDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

export function IOSInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIOSSafari()) return;
    if (isStandalone()) return;
    if (isDismissed()) return;
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: TABBAR_HEIGHT + 12,
        zIndex: 40,
        padding: "10px 14px",
        borderRadius: 12,
        background: SS_TOKENS.bg2,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ flex: 1, lineHeight: 1.45 }}>
        <div
          className="ss-mono"
          style={{
            fontSize: 9.5,
            letterSpacing: ".12em",
            color: SS_TOKENS.fg2,
            textTransform: "uppercase",
          }}
        >
          INSTALL
        </div>
        <div style={{ fontSize: 12.5, color: SS_TOKENS.fg0, marginTop: 2 }}>
          Tap <ShareIcon /> then &ldquo;Add to Home Screen&rdquo; to install SmokySignal.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        style={{
          background: "transparent",
          border: `.5px solid ${SS_TOKENS.hairline}`,
          color: SS_TOKENS.fg2,
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          letterSpacing: ".04em",
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: "-2px", margin: "0 2px" }}
    >
      <path d="M12 3 v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14a2 2 0 0 0 2-2v-6" />
      <path d="M3 13v6a2 2 0 0 0 2 2" />
    </svg>
  );
}
