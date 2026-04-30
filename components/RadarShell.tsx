"use client";

import nextDynamic from "next/dynamic";
import Link from "next/link";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { SS_TOKENS } from "@/lib/tokens";
import { SMOKY_TAIL } from "@/lib/seed";
import { StatusPill } from "./StatusPill";
import type { Aircraft, Snapshot } from "@/lib/types";

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
  const smoky = snap.aircraft.find((a) => a.tail === SMOKY_TAIL);
  const up = Boolean(smoky?.airborne);
  const airborne = snap.aircraft.filter((a) => a.airborne);
  const total = snap.aircraft.length;

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        paddingBottom: TABBAR_HEIGHT,
      }}
    >
      <RadarMap aircraft={airborne} />

      <header
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          padding: "12px 16px",
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
          kind={up ? "alert" : "clear"}
          label={up ? "SMOKY UP" : "SMOKY DOWN"}
          big
        />
        <span
          className="ss-mono"
          style={{
            fontSize: 10.5,
            color: SS_TOKENS.fg2,
            letterSpacing: ".06em",
          }}
        >
          {airborne.length}/{total} AIRBORNE
        </span>
      </header>

      <CompassN />

      {airborne.length > 0 && <Carousel airborne={airborne} />}
    </main>
  );
}

function CompassN() {
  return (
    <div
      className="ss-mono"
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
      }}
    >
      N
    </div>
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
