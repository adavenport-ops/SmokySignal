"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SS_TOKENS } from "@/lib/tokens";

const STORAGE_KEY = "ss_install_dismissed";
const DISMISS_DAYS = 30;
const TABBAR_HEIGHT = 66;
// Routes whose layout includes the bottom tab bar — banner sits above it.
const TABBAR_PATHS = new Set(["/", "/radar", "/dash"]);

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
  const pathname = usePathname();
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

  // Sit above the tab bar on (tabs) pages, at the viewport bottom elsewhere.
  const onTabs = pathname != null && TABBAR_PATHS.has(pathname);
  const bottomOffset = onTabs ? TABBAR_HEIGHT : 0;

  return (
    <div
      role="dialog"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: bottomOffset,
        zIndex: 40,
        padding: "12px 14px calc(12px + env(safe-area-inset-bottom))",
        background: SS_TOKENS.bg1,
        borderTop: `.5px solid ${SS_TOKENS.hairline}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: SS_TOKENS.fg0 }}>
        Install SmokySignal — tap <ShareIcon /> then &ldquo;Add to Home Screen&rdquo;
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "transparent",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: SS_TOKENS.fg2,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
        }}
      >
        <XIcon />
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
      aria-hidden
    >
      <path d="M12 3 v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14a2 2 0 0 0 2-2v-6" />
      <path d="M3 13v6a2 2 0 0 0 2 2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
