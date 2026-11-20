"use client";

// /settings/alerts — single-screen opt-in surface for push notifications.
// Five sections: status row + mission picker + zones + quiet hours + test.
// Missions default to Smokey only (lib/mission.ts DEFAULT_MISSIONS); riders
// can add any other class. Stored in push prefs as `missions`.
// All copy passes the design/BRAND.md voice rules (no emoji, no '!',
// 3–6 word headlines, ≤140 char bodies, "Smokey" with the E for the bird).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SS_TOKENS, TAP_MIN, TAP_PREFERRED, TYPE } from "@/lib/tokens";
import { currentBlockedAlertsHelp, hasTappedArm, markArmTapped } from "@/lib/alerts-ux";
import {
  getCurrentSubscriptionId,
  getPushPermission,
  isPushSupported,
  pushAvailableInThisContext,
  showLocalTestNotification,
  subscribePush,
  unsubscribePush,
  updatePushPrefs,
} from "@/lib/push/client";
import {
  DEFAULT_PREFS,
  effectiveMissions,
  tierForMissions,
  type AlertPrefs,
} from "@/lib/push/types";
import type { Mission } from "@/lib/types";
import { DEFAULT_MISSIONS, MISSIONS } from "@/lib/mission";
import { isAlertMission, missionBlurb, missionLabel } from "@/lib/role-display";
import {
  DEFAULT_PROXIMITY_NM,
  getProximityThresholdNm,
  isProximityEnabled,
  setProximityEnabled,
  setProximityThresholdNm,
} from "@/lib/proximity-alert";
import {
  isVoiceModeEnabled,
  isVoiceModeSupported,
  setVoiceModeEnabled,
  speakAlert,
} from "@/lib/voice-mode";

type LoadState = "loading" | "ready";

export type TailOption = {
  tail: string;
  nickname: string | null;
  operator: string;
  role: string;
};

export function AlertsSettings({ tails: registry = [] }: { tails?: TailOption[] }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [supported, setSupported] = useState(true);
  const [contextOk, setContextOk] = useState<{
    available: boolean;
    reason?: "ios-not-pwa" | "ios-too-old";
  }>({ available: true });
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subId, setSubId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULT_PREFS);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proximityOn, setProximityOn] = useState<boolean>(false);
  const [proximityNm, setProximityNm] = useState<number>(DEFAULT_PROXIMITY_NM);
  const [voiceOn, setVoiceOn] = useState<boolean>(false);
  const [voiceSupported, setVoiceSupported] = useState<boolean>(true);
  // Blocked-permission copy only appears after the rider taps Arm.
  const [armTapped, setArmTapped] = useState<boolean>(false);
  useEffect(() => {
    setArmTapped(hasTappedArm());
  }, []);
  // Hydrate proximity prefs from localStorage on mount.
  useEffect(() => {
    setProximityOn(isProximityEnabled());
    setProximityNm(getProximityThresholdNm());
    setVoiceOn(isVoiceModeEnabled());
    setVoiceSupported(isVoiceModeSupported());
  }, []);

  // Hydrate from current SW state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sup = isPushSupported();
      setSupported(sup);
      setContextOk(pushAvailableInThisContext());
      setPermission(getPushPermission());
      if (sup) {
        const id = await getCurrentSubscriptionId();
        if (!cancelled && id) setSubId(id);
      }
      if (!cancelled) setLoadState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const onArm = useCallback(async () => {
    markArmTapped();
    setArmTapped(true);
    setBusy(true);
    const r = await subscribePush(prefs);
    setBusy(false);
    setPermission(getPushPermission());
    if (r.ok) {
      setSubId(r.id);
      flash("10-4. We'll keep you posted.");
    } else if (r.reason === "denied") {
      flash(currentBlockedAlertsHelp());
    } else if (r.reason === "vapid_missing") {
      flash("Push isn't configured on this build. Try the live site.");
    } else if (r.reason === "unsupported") {
      flash("This browser doesn't support push.");
    } else {
      flash("Couldn't subscribe. Try again in a moment.");
    }
  }, [prefs, flash]);

  const onDisarm = useCallback(async () => {
    setBusy(true);
    await unsubscribePush();
    setBusy(false);
    setSubId(null);
    flash("Off the air. Channel 19 still open if you change your mind.");
  }, [flash]);

  const persistPrefs = useCallback(
    async (next: Partial<AlertPrefs>) => {
      const merged: AlertPrefs = { ...prefs, ...next };
      setPrefs(merged);
      if (!subId) return; // not yet subscribed; nothing to persist
      const ok = await updatePushPrefs(subId, next);
      if (!ok) flash("Couldn't save preference. Try again.");
    },
    [prefs, subId, flash],
  );

  const onTest = useCallback(async () => {
    if (permission !== "granted") {
      flash("Arm alerts first to receive the test ping.");
      return;
    }
    const ok = await showLocalTestNotification();
    if (!ok) flash("Couldn't send the test ping.");
  }, [permission, flash]);

  const missions = effectiveMissions(prefs);
  const toggleMissionPref = useCallback(
    (m: Mission) => {
      const set = new Set(missions);
      if (set.has(m)) set.delete(m);
      else set.add(m);
      const next = MISSIONS.filter((x) => set.has(x));
      // An empty list would mean "never ping". Fall back to Smokey only;
      // riders who want silence disarm instead.
      const list = next.length > 0 ? next : [...DEFAULT_MISSIONS];
      void persistPrefs({ missions: list, tier: tierForMissions(list) });
    },
    [missions, persistPrefs],
  );

  const missionKey = missions.join(",");
  const statusBadge = useMemo<{ label: string; color: string; bg: string }>(() => {
    // Armed reads as a confirmation (clear green), not as "Smokey is up".
    if (!subId) return { label: "OFF", color: SS_TOKENS.fg1, bg: SS_TOKENS.bg2 };
    const list = missionKey.split(",");
    if (list.length === MISSIONS.length)
      return { label: "ALL", color: SS_TOKENS.clear, bg: SS_TOKENS.clearDim };
    if (list.length === 1 && isAlertMission(list[0] ?? ""))
      return { label: "SMOKEY ONLY", color: SS_TOKENS.clear, bg: SS_TOKENS.clearDim };
    return {
      label: `${list.length} CLASSES`,
      color: SS_TOKENS.clear,
      bg: SS_TOKENS.clearDim,
    };
  }, [subId, missionKey]);

  return (
    <main
      className="ss-page"
      style={{
        // No 100dvh min-height: the other-channels card and the display
        // link render after this <main>, and a full-viewport main left
        // a screen of dead space above them on short states.
        // Tab bar + safe-area clearance comes from .ss-tabs-shell in
        // the (tabs) layout; the install prompt no longer floats.
        minHeight: 0,
        paddingBottom: 2,
      }}
    >
      {/* Alerts is a tab root, so no back link. */}
      <header style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        <span className="ss-eyebrow">SmokySignal · Channel 19</span>
        <h1
          style={{
            fontSize: TYPE.title,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          Alerts
        </h1>
        <p style={{ fontSize: 14, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>
          Get a ping when the bird&rsquo;s up.
        </p>
        <p
          data-testid="alerts-channel-19-note"
          style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}
        >
          Channel 19 was the truckers&rsquo; CB channel for calling out Smokey.
          This is ours.
        </p>
      </header>

      {loadState === "loading" ? (
        <Card>
          <p style={{ color: SS_TOKENS.fg1, fontSize: 13 }}>Checking…</p>
        </Card>
      ) : !supported ? (
        <UnsupportedCard />
      ) : !contextOk.available ? (
        <IosNotPwaCard reason={contextOk.reason} />
      ) : (
        <>
          {/* Status row */}
          <Card>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div className="ss-eyebrow">Status</div>
                <div
                  className="ss-mono"
                  style={{
                    display: "inline-block",
                    marginTop: 6,
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: ".1em",
                    color: statusBadge.color,
                    background: statusBadge.bg,
                    border: `.5px solid ${statusBadge.color}55`,
                  }}
                >
                  {statusBadge.label}
                </div>
                {!subId && (
                  <p
                    style={{
                      marginTop: 10,
                      fontSize: 13,
                      color: SS_TOKENS.fg1,
                      lineHeight: 1.45,
                    }}
                  >
                    No alerts armed.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={subId ? onDisarm : onArm}
                // Stays tappable when the browser has denied permission:
                // the tap is what reveals the platform-specific unblock
                // steps below.
                disabled={busy}
                style={{
                  minHeight: TAP_PREFERRED,
                  padding: "0 18px",
                  borderRadius: 999,
                  border: subId ? `.5px solid ${SS_TOKENS.hairline2}` : 0,
                  background: subId ? SS_TOKENS.bg2 : SS_TOKENS.cta,
                  color: subId ? SS_TOKENS.fg0 : SS_TOKENS.ctaInk,
                  fontFamily: "var(--font-inter)",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: ".02em",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {subId ? "Disarm" : "Arm alerts"}
              </button>
            </div>

            {permission === "denied" && armTapped && (
              <p
                role="note"
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  fontSize: 13,
                  color: SS_TOKENS.fg0,
                  lineHeight: 1.45,
                }}
              >
                {currentBlockedAlertsHelp()}
              </p>
            )}
          </Card>

          {/* Mission picker: multi-select, Smokey only by default */}
          <Section id="missions" eyebrow="What pings you">
            <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0, lineHeight: 1.45 }}>
              Smokey only by default. Add any other class you want to hear
              about.
            </p>
            <div
              role="group"
              aria-label="Missions that ping you"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {MISSIONS.map((m) => (
                <RadioCard
                  key={m}
                  active={missions.includes(m)}
                  onClick={() => toggleMissionPref(m)}
                  title={missionLabel(m)}
                  body={missionBlurb(m)}
                />
              ))}
            </div>
          </Section>

          {/* Tails — optional allow-list. Empty = all tails (subject to other
              filters). Each row toggles a tail in/out of prefs.tails. */}
          <Section id="tails" eyebrow="Tails">
            <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0, lineHeight: 1.45 }}>
              Pick specific tails to follow. Leave all unchecked to hear about
              every bird in the classes above.
            </p>
            <div
              className="ss-mono"
              style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 8, marginBottom: 6, letterSpacing: ".06em" }}
            >
              {!prefs.tails || prefs.tails.length === 0
                ? "ALL TAILS"
                : `${prefs.tails.length} TAIL${prefs.tails.length === 1 ? "" : "S"}`}
            </div>
            {registry.length === 0 ? (
              <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0 }}>
                Registry unavailable.
              </p>
            ) : (
              <div
                role="group"
                aria-label="Per-tail allow-list"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  border: `.5px solid ${SS_TOKENS.hairline}`,
                  borderRadius: 8,
                  overflow: "hidden",
                }}
              >
                {registry.map((t, i) => {
                  const checked =
                    Array.isArray(prefs.tails) &&
                    prefs.tails.includes(t.tail.toUpperCase());
                  return (
                    <label
                      key={t.tail}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minHeight: TAP_MIN,
                        padding: "6px 12px",
                        borderBottom:
                          i === registry.length - 1
                            ? 0
                            : `.5px solid ${SS_TOKENS.hairline}`,
                        cursor: "pointer",
                        background: checked ? SS_TOKENS.bg2 : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const upper = t.tail.toUpperCase();
                          const current = Array.isArray(prefs.tails)
                            ? prefs.tails
                            : [];
                          const next = e.target.checked
                            ? Array.from(new Set([...current, upper]))
                            : current.filter((x) => x !== upper);
                          // Empty array → drop the field so dispatcher
                          // sees "no constraint" cleanly.
                          persistPrefs({
                            tails: next.length > 0 ? next : undefined,
                          });
                        }}
                        style={{ flexShrink: 0, width: 20, height: 20 }}
                      />
                      <span
                        className="ss-mono"
                        style={{ fontSize: 13, fontWeight: 600, minWidth: 64 }}
                      >
                        {t.tail}
                      </span>
                      {t.nickname && (
                        <span
                          style={{
                            fontSize: 12,
                            color: SS_TOKENS.fg1,
                            fontStyle: "italic",
                          }}
                        >
                          &ldquo;{t.nickname}&rdquo;
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 12,
                          color: SS_TOKENS.fg1,
                          marginLeft: "auto",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                        }}
                      >
                        {missionLabel(t.role)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Zones (placeholder — per-zone opt-in needs hot-zone load; today is 'any') */}
          <Section id="zones" eyebrow="Zones">
            <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0, lineHeight: 1.45 }}>
              For now, pings cover every corridor. Zone-only pings come
              once we&rsquo;ve watched your stretch of sky long enough.
            </p>
            <div
              className="ss-mono"
              style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 8, letterSpacing: ".06em" }}
            >
              {prefs.zones === "any"
                ? "ANY ZONE"
                : `${prefs.zones.length} ZONE${prefs.zones.length === 1 ? "" : "S"}`}
            </div>
            <Link
              href="/settings/zones"
              style={{
                display: "inline-flex",
                alignItems: "center",
                alignSelf: "flex-start",
                minHeight: TAP_MIN,
                marginTop: 2,
                color: SS_TOKENS.fg0,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "underline",
                textDecorationColor: SS_TOKENS.hairline2,
                textUnderlineOffset: 4,
              }}
            >
              Manage your zones →
            </Link>
          </Section>

          {/* Proximity (foreground-only, client-side) — fires a local
              notification when an alert-tier tail enters the threshold
              while the app is open + GPS granted. No server-side rider
              position; pure client logic. */}
          <Section id="proximity" eyebrow="Proximity">
            <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0, lineHeight: 1.45 }}>
              While the app is open and GPS is granted, ping me when a
              tracked bird gets within range.
            </p>
            <div
              style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minHeight: TAP_MIN,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={proximityOn}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setProximityOn(next);
                    setProximityEnabled(next);
                  }}
                />
                <span className="ss-mono" style={{ fontSize: 13, letterSpacing: ".04em" }}>
                  ENABLED
                </span>
              </label>
              <span style={{ flex: 1 }} />
              <input
                type="number"
                min={1}
                max={50}
                value={proximityNm}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) {
                    setProximityNm(n);
                    setProximityThresholdNm(n);
                  }
                }}
                disabled={!proximityOn}
                aria-label="Proximity threshold in nautical miles"
                style={{
                  width: 64,
                  minHeight: TAP_MIN,
                  padding: "6px 8px",
                  background: SS_TOKENS.bg2,
                  border: `.5px solid ${SS_TOKENS.hairline2}`,
                  borderRadius: 6,
                  color: SS_TOKENS.fg0,
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  textAlign: "right",
                  opacity: proximityOn ? 1 : 0.5,
                }}
              />
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                NM
              </span>
            </div>
          </Section>

          {/* Voice readback (NX4) — when an alert fires while the page
              is open, speak the body via speechSynthesis. iOS needs a
              user gesture before the first speak() works; the toggle
              click + the test-notification flow both prime the API. */}
          <Section id="voice" eyebrow="Voice">
            <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0, lineHeight: 1.45 }}>
              Read alerts aloud while the page is open. Useful with helmet
              audio. Closed-tab background pings don't speak.
            </p>
            <div
              style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minHeight: TAP_MIN,
                  cursor: voiceSupported ? "pointer" : "not-allowed",
                  opacity: voiceSupported ? 1 : 0.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={voiceOn}
                  disabled={!voiceSupported}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setVoiceOn(next);
                    setVoiceModeEnabled(next);
                    // Prime the API on first opt-in so iOS allows
                    // subsequent speak() calls without user gesture.
                    if (next) speakAlert("Voice readback on.");
                  }}
                />
                <span className="ss-mono" style={{ fontSize: 13, letterSpacing: ".04em" }}>
                  ENABLED
                </span>
              </label>
              {!voiceSupported && (
                <span
                  className="ss-mono"
                  style={{ fontSize: 12, color: SS_TOKENS.fg1 }}
                >
                  UNSUPPORTED
                </span>
              )}
            </div>
            <p
              data-testid="voice-telegram-pointer"
              style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}
            >
              Voice only works with this page open. Phone locked? Get alerts in{" "}
              <Link href="/relay#telegram" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
                Telegram
              </Link>
              ; your phone can read them aloud into your helmet.
            </p>
          </Section>

          {/* Quiet hours */}
          <Section id="quiet-hours" eyebrow="Quiet hours">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <HourInput
                value={prefs.quiet_start_h}
                onChange={(h) => persistPrefs({ quiet_start_h: h })}
              />
              <span className="ss-mono" style={{ color: SS_TOKENS.fg1, fontSize: 13 }}>
                →
              </span>
              <HourInput
                value={prefs.quiet_end_h}
                onChange={(h) => persistPrefs({ quiet_end_h: h })}
              />
              <span className="ss-mono" style={{ color: SS_TOKENS.fg1, fontSize: 12 }}>
                {prefs.tz}
              </span>
            </div>
            <p
              style={{
                marginTop: 10,
                fontSize: 13,
                color: SS_TOKENS.fg1,
                lineHeight: 1.45,
              }}
            >
              Channel 19 stays quiet between these hours.
            </p>
          </Section>

          {/* Test button */}
          <Section id="test" eyebrow="Test">
            <button
              type="button"
              onClick={onTest}
              disabled={permission !== "granted"}
              style={{
                alignSelf: "flex-start",
                minHeight: TAP_MIN,
                padding: "0 16px",
                borderRadius: 999,
                border: `.5px solid ${SS_TOKENS.hairline2}`,
                background: SS_TOKENS.bg2,
                color: SS_TOKENS.fg0,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                letterSpacing: ".04em",
                cursor: permission === "granted" ? "pointer" : "default",
                opacity: permission === "granted" ? 1 : 0.5,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Send me a test ping
            </button>
          </Section>
        </>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(var(--ss-tabbar-h) + env(safe-area-inset-bottom) + 18px)",
            padding: "10px 14px",
            borderRadius: 999,
            background: "rgba(11,13,16,0.92)",
            color: SS_TOKENS.fg0,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: ".04em",
            zIndex: 30,
            maxWidth: "calc(100% - 32px)",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}
    </main>
  );
}

function Section({
  id,
  eyebrow,
  children,
}: {
  /** Anchor the search palette links to (/settings/alerts#voice). */
  id?: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id}>
      <div className="ss-eyebrow" style={{ marginBottom: 12 }}>
        {eyebrow}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </Card>
  );
}

function Card({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      {children}
    </section>
  );
}

function RadioCard({
  active,
  onClick,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: "left",
        minHeight: TAP_PREFERRED,
        padding: "10px 12px",
        borderRadius: 10,
        // Selected = neutral bright outline; orange is reserved for "up".
        background: active ? SS_TOKENS.bg2 : SS_TOKENS.bg1,
        border: active
          ? `1px solid ${SS_TOKENS.fg0}`
          : `.5px solid ${SS_TOKENS.hairline2}`,
        color: SS_TOKENS.fg0,
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <span style={{ fontSize: TYPE.body, fontWeight: 700, color: SS_TOKENS.fg0 }}>
        {title}
      </span>
      <span style={{ fontSize: 13, color: SS_TOKENS.fg1 }}>{body}</span>
    </button>
  );
}

function HourInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (h: number) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={23}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        const clamped = Math.max(0, Math.min(23, Math.trunc(n)));
        onChange(clamped);
      }}
      className="ss-mono"
      style={{
        width: 64,
        minHeight: TAP_MIN,
        padding: "6px 8px",
        borderRadius: 8,
        background: SS_TOKENS.bg2,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        color: SS_TOKENS.fg0,
        fontSize: 14,
        textAlign: "center",
      }}
    />
  );
}

function UnsupportedCard() {
  return (
    <Card>
      <p style={{ fontSize: 13.5, color: SS_TOKENS.fg1, margin: 0, lineHeight: 1.5 }}>
        This browser doesn&rsquo;t support push notifications. Try Chrome,
        Firefox, or Safari on iOS 16.4+ (after Add to Home Screen).
      </p>
    </Card>
  );
}

function IosNotPwaCard({
  reason,
}: {
  reason?: "ios-not-pwa" | "ios-too-old";
}) {
  return (
    <Card>
      <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
        On iPhone
      </div>
      <p style={{ fontSize: 14, color: SS_TOKENS.fg0, margin: 0, lineHeight: 1.5 }}>
        {reason === "ios-too-old"
          ? "iOS 16.4 or later is required for browser-based push. Update iOS to enable alerts."
          : "Alerts only work after you Add to Home Screen. Tap Share, then Add to Home Screen, then open the app icon."}
      </p>
    </Card>
  );
}
