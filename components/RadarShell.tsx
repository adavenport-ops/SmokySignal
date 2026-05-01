"use client";

import { useEffect, useState } from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { SS_TOKENS } from "@/lib/tokens";
import { deriveStatus } from "@/lib/status";
import { StatusPill } from "./StatusPill";
import { SpottedButton } from "./SpottedButton";
import { HotZoneLayer } from "./HotZoneLayer";
import { HelpIcon } from "./HelpIcon";
import { Tooltip } from "./Tooltip";
import type { Aircraft, Snapshot } from "@/lib/types";

export type RiderPos = { lat: number; lon: number };

const RadarMap = nextDynamic(() => import("./RadarMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: SS_TOKENS.bg0,
      }}
    />
  ),
});

const TABBAR_HEIGHT = 66;

type Props = { initial: Snapshot; mockOn?: boolean };

export function RadarShell({ initial, mockOn = false }: Props) {
  const snap = useAircraft(initial, mockOn);
  const statusInfo = deriveStatus(snap);
  const airborne = snap.aircraft.filter((a) => a.airborne);
  const total = snap.aircraft.length;
  const pillKind = statusInfo.status === "all_clear" ? "clear" : "alert";
  const pillLabel =
    statusInfo.status === "smoky_up"
      ? "SMOKY UP"
      : statusInfo.status === "other_up"
        ? "EYES UP"
        : "SMOKY DOWN";
  const pillSub =
    statusInfo.status === "other_up" && statusInfo.othersAirborne.length > 1
      ? `${statusInfo.othersAirborne.length} watching`
      : undefined;
  const counterColor =
    statusInfo.totalAirborne > 0 ? SS_TOKENS.alert : SS_TOKENS.fg1;
  const pillTooltip =
    statusInfo.status === "smoky_up"
      ? "Smoky (N305DK) is airborne and watching this region."
      : statusInfo.status === "other_up"
        ? `${statusInfo.othersAirborne.length} non-Smoky watcher${statusInfo.othersAirborne.length === 1 ? "" : "s"} airborne. Smoky's down.`
        : "Nothing in our 16-tail registry is currently airborne.";

  const [rider, setRider] = useState<RiderPos | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);

  // Geolocation only kicks in when this component mounts — i.e. when the user
  // actually visits /radar. The home page never asks.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      flashToast(setToast, "Location off · radar still works");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setRider({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        flashToast(setToast, "Location off · radar still works");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        paddingBottom: TABBAR_HEIGHT,
      }}
    >
      <RadarMap aircraft={airborne} rider={rider} onMapReady={setMap} />
      <HotZoneLayer
        map={map}
        bottomBoost={airborne.length > 0 ? 130 : 0}
      />
      <HelpIcon />

      <header
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          // Right padding 96px reserves room for the fixed wake-lock
          // button (right:12) AND the help icon (right:52) so the
          // airborne counter never tucks under either.
          padding: "12px 96px 12px 16px",
          background: "rgba(11,13,16,.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: `.5px solid ${SS_TOKENS.hairline}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          zIndex: 10,
        }}
      >
        <StatusPill
          kind={pillKind}
          label={pillLabel}
          sub={pillSub}
          big
          tooltip={pillTooltip}
        />
        <Tooltip
          side="bottom"
          align="end"
          content="How many of our 16 tracked tails are airborne right now."
        >
          <span
            className="ss-mono"
            tabIndex={0}
            style={{
              fontSize: 10.5,
              color: counterColor,
              letterSpacing: ".06em",
              cursor: "help",
            }}
          >
            {airborne.length}/{total} AIRB
          </span>
        </Tooltip>
      </header>

      <CompassN />

      {airborne.length > 0 && <Carousel airborne={airborne} />}

      <SpottedButton airborne={airborne} />

      {toast && <Toast message={toast} hasCarousel={airborne.length > 0} />}
    </main>
  );
}

function flashToast(
  setter: (msg: string | null) => void,
  message: string,
  durationMs = 4000,
) {
  setter(message);
  setTimeout(() => setter(null), durationMs);
}

function Toast({
  message,
  hasCarousel,
}: {
  message: string;
  hasCarousel: boolean;
}) {
  // Sit just above whatever's currently anchored to the bottom — carousel
  // when present, tab bar otherwise.
  const bottomOffset = hasCarousel ? TABBAR_HEIGHT + 130 : TABBAR_HEIGHT + 16;
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: bottomOffset,
        padding: "8px 14px",
        borderRadius: 8,
        background: SS_TOKENS.bg2,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        color: SS_TOKENS.fg2,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: ".04em",
        zIndex: 20,
        whiteSpace: "nowrap",
      }}
    >
      {message}
    </div>
  );
}

function CompassN() {
  return (
    <Tooltip side="left" content="Map orientation: north is up.">
      <div
        className="ss-mono"
        tabIndex={0}
        aria-label="Map north indicator"
        style={{
          position: "absolute",
          top: 60,
          right: 12,
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          background: "rgba(11,13,16,.7)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          color: SS_TOKENS.fg1,
          zIndex: 10,
          cursor: "help",
        }}
      >
        N
      </div>
    </Tooltip>
  );
}

function Carousel({ airborne }: { airborne: Aircraft[] }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: TABBAR_HEIGHT,
        padding: "8px 16px 12px",
        background:
          "linear-gradient(to top, rgba(11,13,16,.92) 60%, rgba(11,13,16,0))",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 10,
      }}
    >
      <div
        className="ss-eyebrow"
        style={{ marginBottom: 8, paddingLeft: 2 }}
      >
        Up right now · tap to track
      </div>
      <div
        className="ss-scroll"
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          // Allow cards to bleed into right edge; iOS smooth scroll.
          WebkitOverflowScrolling: "touch",
        }}
      >
        {airborne.map((p) => (
          <PlaneCard key={p.tail} p={p} />
        ))}
      </div>
    </div>
  );
}

function PlaneCard({ p }: { p: Aircraft }) {
  return (
    <Link
      href={`/plane/${p.tail}`}
      prefetch={false}
      style={{
        flex: "0 0 auto",
        minWidth: 200,
        padding: 12,
        borderRadius: 12,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: SS_TOKENS.alert,
            animation: "ss-blink 1.6s infinite",
          }}
        />
        <span
          className="ss-mono"
          style={{ fontSize: 13, fontWeight: 600, color: SS_TOKENS.fg0 }}
        >
          {p.tail}
        </span>
        {p.nickname && (
          <span style={{ fontSize: 11, color: SS_TOKENS.fg1 }}>
            &ldquo;{p.nickname}&rdquo;
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: SS_TOKENS.fg2, marginTop: 5 }}>
        Puget Sound
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Stat
          label="ALT"
          value={
            p.altitude_ft != null
              ? `${p.altitude_ft.toLocaleString()}′`
              : "—"
          }
        />
        <Stat
          label="GS"
          value={p.ground_speed_kt != null ? `${p.ground_speed_kt}kt` : "—"}
        />
        <Stat
          label="TIME"
          value={p.time_aloft_min != null ? `${p.time_aloft_min}m` : "—"}
        />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="ss-mono"
        style={{
          fontSize: 9.5,
          color: SS_TOKENS.fg2,
          letterSpacing: ".08em",
        }}
      >
        {label}
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: SS_TOKENS.fg0,
          marginTop: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}
