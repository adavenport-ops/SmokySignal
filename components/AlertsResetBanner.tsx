"use client";

// Alerts-reset nudge (B21). One dismissible line on home for a rider whose
// browser still allows notifications but holds no push subscription, which
// is what the 2026-11-19 store overwrite left behind. One tap subscribes
// again; the browser does not prompt, because permission is already
// granted. Rule and storage: lib/alerts-reset.ts.
//
// Never shown for "default" or "denied" permission, after the rider turned
// alerts off themselves, or within 30 days of "Not now".

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SS_TOKENS, TAP_PREFERRED } from "@/lib/tokens";
import {
  getPushPermission,
  hasPushSubscription,
  isPushSupported,
  pushAvailableInThisContext,
  subscribePush,
} from "@/lib/push/client";
import {
  ALERTS_RESET_ACTION,
  ALERTS_RESET_LINE,
  alertsResetVisible,
  dismissAlertsReset,
  readResetDismissedAt,
  wasDisarmedByRider,
} from "@/lib/alerts-reset";
import { currentBlockedAlertsHelp, markArmTapped } from "@/lib/alerts-ux";

type Phase = "checking" | "hidden" | "show" | "busy" | "done" | "error";

export function AlertsResetBanner() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = isPushSupported();
      const permission = getPushPermission();
      // Cheap gates first; only look up the subscription when it matters.
      if (!supported || permission !== "granted" || !pushAvailableInThisContext().available) {
        if (!cancelled) setPhase("hidden");
        return;
      }
      let hasSubscription = true; // unknown reads as "fine": stay quiet
      try {
        hasSubscription = await hasPushSubscription();
      } catch {
        // leave it true
      }
      const show = alertsResetVisible({
        supported,
        contextAvailable: true,
        permission,
        hasSubscription,
        dismissedAt: readResetDismissedAt(),
        disarmedByRider: wasDisarmedByRider(),
        now: Date.now(),
      });
      if (!cancelled) setPhase(show ? "show" : "hidden");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The confirmation stays a few seconds, then the line goes away.
  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("hidden"), 6000);
    return () => clearTimeout(t);
  }, [phase]);

  const onTurnOn = useCallback(async () => {
    setPhase("busy");
    setError(null);
    const r = await subscribePush();
    if (r.ok) {
      setPhase("done");
      return;
    }
    if (r.reason === "denied") {
      markArmTapped();
      setError(currentBlockedAlertsHelp());
    } else {
      setError("Could not turn alerts back on here.");
    }
    setPhase("error");
  }, []);

  const onDismiss = useCallback(() => {
    dismissAlertsReset();
    setPhase("hidden");
  }, []);

  if (phase === "checking" || phase === "hidden") return null;

  const notNow = (
    <button
      type="button"
      data-testid="alerts-reset-dismiss"
      onClick={onDismiss}
      aria-label="Not now. Hide for 30 days"
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
  );

  return (
    <section
      aria-label="Alerts were switched off"
      aria-live="polite"
      data-testid="alerts-reset-banner"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 14,
        padding: "10px 8px 10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {phase === "done" ? (
        <p style={{ margin: 0, fontSize: 14, color: SS_TOKENS.fg0, lineHeight: 1.4 }}>
          10-4. Alerts are back on.
        </p>
      ) : phase === "error" ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: SS_TOKENS.fg0, lineHeight: 1.45, flex: "1 1 200px" }}>
            {error}{" "}
            <Link
              href="/settings/alerts"
              style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
            >
              Alert settings
            </Link>
          </p>
          {notNow}
        </>
      ) : (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: SS_TOKENS.fg0,
              lineHeight: 1.35,
              flex: "1 1 180px",
              minWidth: 0,
            }}
          >
            {ALERTS_RESET_LINE}
          </p>
          <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
            <button
              type="button"
              data-testid="alerts-reset-turn-on"
              onClick={onTurnOn}
              disabled={phase === "busy"}
              aria-busy={phase === "busy"}
              style={{
                minHeight: TAP_PREFERRED,
                padding: "0 14px",
                borderRadius: 10,
                border: "none",
                background: SS_TOKENS.cta,
                color: SS_TOKENS.ctaInk,
                fontSize: 14,
                fontWeight: 700,
                whiteSpace: "nowrap",
                cursor: phase === "busy" ? "wait" : "pointer",
                touchAction: "manipulation",
              }}
            >
              {phase === "busy" ? "Turning on" : ALERTS_RESET_ACTION}
            </button>
            {notNow}
          </div>
        </>
      )}
    </section>
  );
}
