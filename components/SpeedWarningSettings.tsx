"use client";

// /settings: the speed-warning opt-in (N1b). Default OFF. Turning it on is
// the only place SmokySignal asks for location on the rider's behalf for
// this feature: one getCurrentPosition call, from the tap. The fix it
// returns is thrown away; we only want the permission answer.

import { useEffect, useState } from "react";
import Link from "next/link";
import { SS_TOKENS, TAP_MIN } from "@/lib/tokens";
import {
  BIRD_RADIUS_CHOICES_NM,
  MAX_RIDER_LIMIT_MPH,
  MIN_RIDER_LIMIT_MPH,
  birdRadiusLabel,
  clampRiderLimitMph,
  muteMinutesLeft,
} from "@/lib/speed-warning";
import {
  setSpeedLimitMph,
  setSpeedWarningEnabled,
  setSpeedWarningMuteUntil,
  setSpeedWarningRadiusNm,
  setUseCorridorDefaults,
} from "@/lib/speed-warning-prefs";
import { useSpeedWarningPrefs } from "./SpeedWarning";

type Ask = "idle" | "asking" | "blocked" | "no-geo";

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "14px 16px",
  borderRadius: 12,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  background: SS_TOKENS.bg1,
};

const sub: React.CSSProperties = {
  fontSize: 13,
  color: SS_TOKENS.fg1,
  lineHeight: 1.5,
  margin: 0,
};

export function SpeedWarningSettings() {
  const prefs = useSpeedWarningPrefs();
  const [ask, setAsk] = useState<Ask>("idle");
  const [limitText, setLimitText] = useState(String(prefs.limitMph));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setLimitText(String(prefs.limitMph)), [prefs.limitMph]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const onToggle = () => {
    if (prefs.enabled) {
      setSpeedWarningEnabled(false);
      setAsk("idle");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setAsk("no-geo");
      return;
    }
    setAsk("asking");
    navigator.geolocation.getCurrentPosition(
      () => {
        setSpeedWarningEnabled(true);
        setAsk("idle");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setAsk("blocked");
          return;
        }
        // Allowed, just no fix yet (indoors, cold GPS). Still on.
        setSpeedWarningEnabled(true);
        setAsk("idle");
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 20_000 },
    );
  };

  const commitLimit = () => {
    const mph = clampRiderLimitMph(limitText);
    setSpeedLimitMph(mph);
    setLimitText(String(mph)); // show the clamped value
  };

  const minsLeft = muteMinutesLeft(prefs.muteUntil, now);
  const on = prefs.enabled;

  return (
    <div style={card} data-testid="speed-warning-setting" id="speed-warning">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: SS_TOKENS.fg0 }}>
            Speed warning
          </div>
          <p style={{ ...sub, marginTop: 2 }}>
            Uses your phone&rsquo;s GPS speed while this screen is open. Nothing is sent to us. Not
            a radar detector; aircraft we can&rsquo;t hear won&rsquo;t trigger it.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Speed warning"
          data-testid="speed-warning-toggle"
          onClick={onToggle}
          disabled={ask === "asking"}
          className="ss-mono"
          style={{
            minWidth: 64,
            minHeight: TAP_MIN,
            padding: "0 14px",
            borderRadius: 999,
            border: `.5px solid ${on ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
            background: on ? SS_TOKENS.cta : "transparent",
            color: on ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".08em",
            cursor: ask === "asking" ? "wait" : "pointer",
            touchAction: "manipulation",
            flexShrink: 0,
          }}
        >
          {on ? "ON" : "OFF"}
        </button>
      </div>

      <p style={sub}>
        EASE OFF when you are over your limit, inside a hot zone, with Smokey up within{" "}
        {prefs.birdRadiusNm} nm. Runs on Flights (Now) and Handlebar mode. Clears on its own.{" "}
        <Link href="/help#speed-warning" style={{ color: SS_TOKENS.fg0 }}>
          How it works
        </Link>
      </p>

      {ask === "asking" && (
        <p style={sub} role="status">
          Asking your browser for location.
        </p>
      )}
      {ask === "blocked" && (
        <p style={{ ...sub, color: SS_TOKENS.fg0 }} role="status">
          Location is blocked for SmokySignal. Allow it in your browser settings, then turn this on
          again.
        </p>
      )}
      {ask === "no-geo" && (
        <p style={{ ...sub, color: SS_TOKENS.fg0 }} role="status">
          This browser has no location access, so the speed warning cannot run here.
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          borderTop: `.5px solid ${SS_TOKENS.hairline2}`,
          paddingTop: 12,
        }}
      >
        <label htmlFor="ss-speed-limit" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: SS_TOKENS.fg0 }}>My limit</div>
          <div style={sub}>
            We have no posted-limit feed. This number is the limit the warning uses.
          </div>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <input
            id="ss-speed-limit"
            data-testid="speed-limit-input"
            type="number"
            inputMode="numeric"
            min={MIN_RIDER_LIMIT_MPH}
            max={MAX_RIDER_LIMIT_MPH}
            step={1}
            value={limitText}
            onChange={(e) => setLimitText(e.target.value)}
            onBlur={commitLimit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLimit();
            }}
            className="ss-mono"
            style={{
              width: 72,
              minHeight: TAP_MIN,
              padding: "0 10px",
              borderRadius: 10,
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              background: SS_TOKENS.bg2,
              color: SS_TOKENS.fg0,
              fontSize: 16,
              fontWeight: 600,
              textAlign: "right",
            }}
          />
          <span className="ss-mono" style={{ fontSize: 13, color: SS_TOKENS.fg1 }}>
            mph
          </span>
        </div>
      </div>

      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          minHeight: TAP_MIN,
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          data-testid="speed-limit-corridor"
          checked={prefs.useCorridorDefaults}
          onChange={(e) => setUseCorridorDefaults(e.target.checked)}
          style={{ width: 22, height: 22, marginTop: 2, flexShrink: 0, accentColor: SS_TOKENS.cta }}
        />
        <span>
          <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: SS_TOKENS.fg0 }}>
            Use corridor defaults
          </span>
          <span style={{ ...sub, display: "block" }}>
            On I-5, I-405, SR-167 and the other named corridors, use that road&rsquo;s usual limit
            instead of yours. Approximate. Posted signs always win.
          </span>
        </span>
      </label>

      <div
        role="group"
        aria-labelledby="ss-speed-radius-label"
        data-testid="speed-warning-radius"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          borderTop: `.5px solid ${SS_TOKENS.hairline2}`,
          paddingTop: 12,
        }}
      >
        <div>
          <div
            id="ss-speed-radius-label"
            style={{ fontSize: 14, fontWeight: 600, color: SS_TOKENS.fg0 }}
          >
            How close the bird must be
          </div>
          <div style={sub}>
            Smokey has to be this close before the warning speaks up. Default 5 nm.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {BIRD_RADIUS_CHOICES_NM.map((nm) => {
            const picked = prefs.birdRadiusNm === nm;
            const label = birdRadiusLabel(nm);
            return (
              <button
                key={nm}
                type="button"
                aria-pressed={picked}
                aria-label={`${label.nm}, ${label.mi}`}
                data-testid={`speed-warning-radius-${nm}`}
                onClick={() => setSpeedWarningRadiusNm(nm)}
                className="ss-mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: TAP_MIN,
                  padding: "6px 8px",
                  borderRadius: 10,
                  border: `.5px solid ${picked ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
                  background: picked ? SS_TOKENS.cta : "transparent",
                  color: picked ? SS_TOKENS.ctaInk : SS_TOKENS.fg0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700 }}>{label.nm}</span>
                <span style={{ fontSize: 12, color: picked ? SS_TOKENS.ctaInk : SS_TOKENS.fg1 }}>
                  {label.mi}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {minsLeft > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span className="ss-mono" style={{ fontSize: 13, color: SS_TOKENS.fg1 }}>
            Muted · {minsLeft} min left
          </span>
          <button
            type="button"
            onClick={() => setSpeedWarningMuteUntil(null)}
            style={{
              minHeight: TAP_MIN,
              padding: "0 14px",
              borderRadius: 999,
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              background: "transparent",
              color: SS_TOKENS.fg0,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Unmute
          </button>
        </div>
      )}
    </div>
  );
}
