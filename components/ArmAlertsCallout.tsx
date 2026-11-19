"use client";

// Visible "Arm alerts" call-to-action for the home page. Self-hides when
// it isn't relevant: armed already, push unsupported, iOS Safari before
// Add to Home Screen (IOSInstallPrompt owns that step), or the rider
// dismissed it within the last 14 days. The settings page is one tap
// away; the CTA exists purely to point riders at it.
//
// "Blocked" only shows after the rider has tapped Arm on this device
// (lib/alerts-ux.ts). A browser that starts with notifications denied
// gets the ordinary opt-in card, not an error the rider never caused.

import { useEffect, useState } from "react";
import Link from "next/link";
import { SS_TOKENS, TAP_PREFERRED } from "@/lib/tokens";
import { isPushSupported, getPushPermission } from "@/lib/push/client";
import {
  currentBlockedAlertsHelp,
  hasTappedArm,
  markArmTapped,
} from "@/lib/alerts-ux";
import { needsIOSInstall } from "./IOSInstallPrompt";

const DISMISS_KEY = "ss_arm_alerts_dismissed_at";
const DISMISS_DAYS = 14;
const DISMISS_MS = DISMISS_DAYS * 24 * 60 * 60 * 1000;

type State =
  | { kind: "loading" }
  | { kind: "hidden" }
  | { kind: "blocked"; help: string }
  | { kind: "armed" }
  | { kind: "available"; recentlyDismissed: boolean };

function readDismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) ?? "0");
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // storage blocked: hidden for this page view only
  }
}

export function ArmAlertsCallout() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (needsIOSInstall() || !isPushSupported()) {
      setState({ kind: "hidden" });
      return;
    }
    if (getPushPermission() === "denied" && hasTappedArm()) {
      setState({ kind: "blocked", help: currentBlockedAlertsHelp() });
      return;
    }
    let cancelled = false;

    // Render the dismiss-aware "available" state IMMEDIATELY. Waiting on
    // navigator.serviceWorker.ready first left first-visit riders with
    // no CTA at all (PR #39). If the SW then reveals the rider is armed,
    // hide afterward; a one-tick flicker beats a missing CTA.
    setState({ kind: "available", recentlyDismissed: readDismissedRecently() });

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled && sub) setState({ kind: "armed" });
      })
      .catch(() => {
        // already showing the available state
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading" || state.kind === "hidden") return null;
  // Armed state has its own indicator (AlertsStateChip); don't double up.
  if (state.kind === "armed") return null;

  if (state.kind === "blocked") {
    return (
      <div
        role="note"
        style={{
          fontSize: 13,
          lineHeight: 1.45,
          color: SS_TOKENS.fg1,
          padding: "12px 14px",
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          borderRadius: 12,
        }}
      >
        {state.help}
      </div>
    );
  }

  if (state.recentlyDismissed) return null;

  return (
    <section
      aria-label="Push alerts"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 14,
        padding: "12px 8px 12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 160px" }}>
        <div className="ss-eyebrow" style={{ marginBottom: 4 }}>
          Opt in
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: SS_TOKENS.fg0,
            lineHeight: 1.3,
          }}
        >
          Get a ping when Smokey&rsquo;s up.
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
        <Link
          href="/settings/alerts"
          onClick={() => markArmTapped()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: TAP_PREFERRED,
            background: SS_TOKENS.cta,
            color: SS_TOKENS.ctaInk,
            padding: "0 16px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Arm alerts
        </Link>
        <button
          type="button"
          onClick={() => {
            writeDismissed();
            setState({ kind: "available", recentlyDismissed: true });
          }}
          aria-label="Dismiss for 14 days"
          style={{
            background: "none",
            border: "none",
            color: SS_TOKENS.fg1,
            fontSize: 13,
            cursor: "pointer",
            minHeight: TAP_PREFERRED,
            minWidth: TAP_PREFERRED,
            padding: "0 10px",
            touchAction: "manipulation",
          }}
        >
          Not now
        </button>
      </div>
    </section>
  );
}
