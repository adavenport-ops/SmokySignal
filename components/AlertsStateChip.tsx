"use client";

// Tiny mono indicator showing the rider's current push-alerts state.
// Renders only when there's something useful to say — silent on
// unsupported browsers and during the brief load window — and links
// to /settings/alerts so the chip is also the entry point if the
// rider wants to change state.

import { useEffect, useState } from "react";
import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { isPushSupported } from "@/lib/push/client";
import { hasTappedArm } from "@/lib/alerts-ux";

type State = "loading" | "unsupported" | "denied" | "available" | "armed";

export function AlertsStateChip() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    // "Blocked" only after the rider has tapped Arm here. A browser that
    // starts out denied reads as plain "off" until then.
    if (Notification.permission === "denied") {
      setState(hasTappedArm() ? "denied" : "available");
      return;
    }
    let cancelled = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (!cancelled) setState(sub ? "armed" : "available");
      })
      .catch(() => {
        if (!cancelled) setState("available");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading" || state === "unsupported") return null;

  const armed = state === "armed";
  const denied = state === "denied";
  // Blocked is a rider-setting problem, not "Smokey is up": neutral fg0,
  // never orange.
  const color = armed ? SS_TOKENS.clear : denied ? SS_TOKENS.fg0 : SS_TOKENS.fg1;
  const label = armed ? "ALERTS ON" : denied ? "ALERTS BLOCKED" : "ALERTS OFF";

  return (
    <Link
      href="/settings/alerts"
      className="ss-mono"
      aria-label={`Push alerts: ${label.toLowerCase()}. Tap to manage.`}
      style={{
        // 44px hit area around a compact visual chip.
        display: "inline-flex",
        alignItems: "center",
        minHeight: 44,
        padding: "0 2px",
        textDecoration: "none",
        touchAction: "manipulation",
      }}
    >
      <span
        style={{
          fontSize: 12,
          letterSpacing: ".08em",
          color,
          padding: "3px 7px",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          borderRadius: 4,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </Link>
  );
}
