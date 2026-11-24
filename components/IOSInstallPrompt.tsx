"use client";

// iOS Safari "Add to Home Screen" card. iOS only delivers web push to an
// installed PWA, so riders on iPhone need this before Arm alerts can
// work. It used to be a fixed bar pinned above the tab bar on every
// route (~80px over the radar controls and the home hero). It is now an
// inline, dismissible card rendered in the home page flow only, so it
// can never cover /radar.
//
// Once the rider is in the installed app, ArmAlertsCallout takes over
// (push is supported there), so this card only handles the pre-install
// step.

import Link from "next/link";
import { useEffect, useState } from "react";
import { IPHONE_HELP_PATH } from "@/lib/iphone-help";
import { SS_TOKENS } from "@/lib/tokens";

const STORAGE_KEY = "ss_install_dismissed";
const DISMISS_DAYS = 30;
const DISMISS_MS = DISMISS_DAYS * 24 * 60 * 60 * 1000;

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

function readDismissed(): boolean {
  try {
    const ts = Number(window.localStorage.getItem(STORAGE_KEY) ?? "0");
    return Number.isFinite(ts) && ts > 0 && Date.now() - ts < DISMISS_MS;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // storage blocked: the card stays hidden for this page view only
  }
}

/** True on iOS Safari outside the installed app (the card's audience). */
export function needsIOSInstall(): boolean {
  return isIOSSafari() && !isStandalone();
}

export function IOSInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (needsIOSInstall() && !readDismissed()) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <section
      aria-label="Install SmokySignal for push alerts"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 14,
        padding: "12px 4px 12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ss-eyebrow" style={{ marginBottom: 4 }}>
          Alerts on iPhone
        </div>
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.45,
            color: SS_TOKENS.fg0,
          }}
        >
          Tap <ShareIcon /> then{" "}
          <strong style={{ fontWeight: 700 }}>Add to Home Screen</strong>.
          Open the icon and arm alerts.
        </div>
        <Link
          href={IPHONE_HELP_PATH}
          data-testid="ios-install-setup-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            fontSize: 13,
            fontWeight: 600,
            color: SS_TOKENS.fg0,
            textDecoration: "underline",
            textUnderlineOffset: 3,
            touchAction: "manipulation",
          }}
        >
          Full iPhone setup, location too
        </Link>
      </div>
      <button
        type="button"
        onClick={() => {
          writeDismissed();
          setShow(false);
        }}
        aria-label="Dismiss install tip"
        style={{
          width: 48,
          height: 48,
          background: "transparent",
          border: 0,
          color: SS_TOKENS.fg1,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <XIcon />
        </span>
      </button>
    </section>
  );
}

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "-3px", margin: "0 2px" }}
      aria-label="Share"
      role="img"
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
