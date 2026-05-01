"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Aircraft, Snapshot } from "@/lib/types";
import type { ActivityEntry } from "@/lib/activity";
import { SS_TOKENS } from "@/lib/tokens";
import { fmtAgo, fmtAloft } from "@/lib/format";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { deriveStatus, type FleetStatusInfo } from "@/lib/status";
import { StatusPill } from "./StatusPill";
import { Card } from "./Card";
import { PlaneIcon, planeKindFor } from "./PlaneIcon";
import { PredictionCard } from "./PredictionCard";
import { HelpIcon } from "./HelpIcon";
import { Tooltip } from "./Tooltip";

// Hide the activity strip when the most recent event is older than this
// — a stale "Guardian One up · 8 hours ago" looks more like a bug than
// a feature on the home screen.
const ACTIVITY_STRIP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type Props = {
  initial: Snapshot;
  mockOn?: boolean;
  initialActivity?: ActivityEntry[];
};

export function Glanceable({
  initial,
  mockOn = false,
  initialActivity = [],
}: Props) {
  const snap = useAircraft(initial, mockOn);
  const [updatedAgo, setUpdatedAgo] = useState<number>(0);
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity);

  // Poll /api/activity every 30s so the strip stays current without
  // forcing a full snapshot regen.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/activity?limit=1", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { entries: ActivityEntry[] };
        if (!cancelled) setActivity(d.entries);
      } catch {
        /* transient */
      }
    };
    const id = setInterval(tick, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // "Updated Xs ago" label.
  useEffect(() => {
    setUpdatedAgo(0);
    const id = setInterval(() => {
      setUpdatedAgo(Math.floor((Date.now() - snap.fetched_at) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [snap.fetched_at]);

  const statusInfo = deriveStatus(snap);
  const others = statusInfo.othersAirborne;
  const latestActivity =
    activity.length > 0 &&
    Date.now() - activity[0]!.ts < ACTIVITY_STRIP_MAX_AGE_MS
      ? activity[0]!
      : null;

  return (
    <main
      className="ss-hero-bg"
      style={{
        minHeight: "100dvh",
        padding: "12px 18px 100px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 460,
        margin: "0 auto",
      }}
    >
      <HelpIcon />
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
          // Reserve room for the fixed wake-lock + help buttons (top:12,
          // right:12 + right:52, both 32px wide) so the source line never
          // tucks under either icon.
          paddingRight: 96,
          gap: 12,
        }}
      >
        <span className="ss-eyebrow">SmokySignal · Live</span>
        <Tooltip
          side="bottom"
          align="end"
          content={`Time since last successful data pull. ${snap.source === "adsbfi" ? "ADSBFI = adsb.fi (primary feed)." : snap.source === "opensky" ? "OPENSKY = OpenSky Network (fallback)." : "MOCK = synthetic data."}`}
        >
          <span
            className="ss-mono"
            tabIndex={0}
            style={{
              fontSize: 10.5,
              color: SS_TOKENS.fg2,
              whiteSpace: "nowrap",
              cursor: "help",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: SS_TOKENS.clear,
                marginRight: 6,
                verticalAlign: "middle",
                animation: "ss-blink 1.6s infinite",
              }}
            />
            UPDATED {updatedAgo}s · {snap.source.toUpperCase()}
          </span>
        </Tooltip>
      </header>

      <Hero info={statusInfo} />

      {latestActivity && <ActivityStrip latest={latestActivity} />}

      {others.length > 0 && <Others others={others} />}

      <PredictionCard />

      <Footer />
    </main>
  );
}

function Footer() {
  return (
    <footer
      className="ss-mono"
      style={{
        marginTop: 8,
        padding: "16px 4px 0",
        fontSize: 10.5,
        color: SS_TOKENS.fg2,
        letterSpacing: ".04em",
        lineHeight: 1.5,
      }}
    >
      Aircraft data from{" "}
      <a
        href="https://adsb.fi"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
      >
        adsb.fi
      </a>{" "}
      ·{" "}
      <a
        href="https://opensky-network.org"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
      >
        OpenSky Network
      </a>
      <br />
      <a
        href="/about"
        style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
      >
        About · Legal
      </a>
    </footer>
  );
}

function ActivityStrip({ latest }: { latest: ActivityEntry }) {
  return (
    <Link
      href="/activity"
      prefetch={false}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderRadius: 10,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        textDecoration: "none",
        color: SS_TOKENS.fg1,
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: SS_TOKENS.alert,
          boxShadow: `0 0 8px ${SS_TOKENS.alert}`,
          flexShrink: 0,
          animation: "ss-blink 1.6s infinite",
        }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {latest.description}
      </span>
      <span
        className="ss-mono"
        style={{ fontSize: 11, color: SS_TOKENS.fg2, flexShrink: 0 }}
      >
        {fmtRelativeStrip(latest.ts)}
      </span>
    </Link>
  );
}

function fmtRelativeStrip(tsMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Hero({ info }: { info: FleetStatusInfo }) {
  const isAlert = info.status !== "all_clear";
  const accentColor = isAlert ? SS_TOKENS.alert : SS_TOKENS.clear;
  const halo = isAlert ? SS_TOKENS.alertDim : SS_TOKENS.clearDim;

  return (
    <section
      className="ss-hero-bg"
      style={{
        background: `radial-gradient(120% 80% at 50% 0%, ${halo}, transparent 70%), ${SS_TOKENS.bg1}`,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 22,
        padding: "32px 22px 26px",
      }}
    >
      <div
        className="ss-eyebrow"
        style={{ color: accentColor, animation: "ss-fade 400ms ease-out" }}
      >
        {heroEyebrow(info)}
      </div>
      <h1
        style={{
          fontSize: "clamp(40px, 12vw, 64px)",
          fontWeight: 800,
          letterSpacing: "-.04em",
          lineHeight: 1.05,
          marginTop: 10,
          color: SS_TOKENS.fg0,
        }}
      >
        <HeroHeadline info={info} accent={accentColor} />
      </h1>

      <p
        style={{
          marginTop: 14,
          fontSize: 14,
          color: SS_TOKENS.fg1,
          lineHeight: 1.45,
        }}
      >
        <HeroSubcopy info={info} />
      </p>

      {info.status === "smoky_up" && info.smokyAirborne && (
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {info.smokyAirborne.time_aloft_min != null && (
            <StatusPill
              kind="alert"
              label={fmtAloft(info.smokyAirborne.time_aloft_min)}
            />
          )}
          {info.smokyAirborne.ground_speed_kt != null && (
            <StatusPill
              kind="alert"
              label={`${info.smokyAirborne.ground_speed_kt} kt`}
            />
          )}
        </div>
      )}
    </section>
  );
}

function heroEyebrow(info: FleetStatusInfo): string {
  if (info.status === "smoky_up") return "BIRD UP";
  if (info.status === "other_up") return "EYES UP";
  return "ALL CLEAR";
}

function HeroHeadline({
  info,
  accent,
}: {
  info: FleetStatusInfo;
  accent: string;
}) {
  if (info.status === "smoky_up") {
    return (
      <>
        Smoky&rsquo;s
        <br />
        <span style={{ color: accent }}>watching.</span>
      </>
    );
  }
  if (info.status === "other_up") {
    if (info.othersAirborne.length === 1) {
      const a = info.othersAirborne[0]!;
      const label = a.nickname ?? a.tail;
      return (
        <span style={{ color: accent }}>
          {a.nickname ? (
            label
          ) : (
            <span className="ss-mono" style={{ letterSpacing: "-.02em" }}>
              {label}
            </span>
          )}{" "}
          is up.
        </span>
      );
    }
    return (
      <span style={{ color: accent }}>
        {info.othersAirborne.length} watchers
        <br />
        airborne.
      </span>
    );
  }
  // all_clear
  return (
    <>
      Smoky&rsquo;s
      <br />
      <span style={{ color: accent }}>down.</span>
    </>
  );
}

function HeroSubcopy({ info }: { info: FleetStatusInfo }) {
  if (info.status === "smoky_up") {
    const s = info.smokyAirborne;
    return (
      <>
        Airborne at{" "}
        <b style={{ color: SS_TOKENS.fg0 }}>
          {s?.altitude_ft != null ? (
            <span className="ss-mono">
              {s.altitude_ft.toLocaleString()}&prime;
            </span>
          ) : (
            "altitude unknown"
          )}
        </b>
        {s?.ground_speed_kt != null && (
          <>
            {" · "}
            <span className="ss-mono">{s.ground_speed_kt} kt</span>
          </>
        )}
        . Mind the throttle. Take it easy.
      </>
    );
  }
  if (info.status === "other_up") {
    return info.othersAirborne.length === 1 ? (
      <>Smoky&rsquo;s down — but a watcher is airborne.</>
    ) : (
      <>Smoky&rsquo;s down — but the sky is busy.</>
    );
  }
  // all_clear
  return <>No WSP plane up locally for a while. Send it.</>;
}

function Others({ others }: { others: Aircraft[] }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "0 4px 8px",
        }}
      >
        <span className="ss-eyebrow">Also airborne</span>
        <span
          className="ss-mono"
          style={{ fontSize: 10.5, color: SS_TOKENS.fg2 }}
        >
          {others.length} ACTIVE
        </span>
      </div>
      <Card padded={false}>
        {others.map((p, i) => (
          <div
            key={p.tail}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderBottom:
                i === others.length - 1
                  ? 0
                  : `.5px solid ${SS_TOKENS.hairline}`,
            }}
          >
            <PlaneIcon
              size={18}
              kind={planeKindFor(p.model)}
              color={SS_TOKENS.alert}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="ss-mono"
                style={{ fontSize: 13, fontWeight: 600 }}
              >
                {p.tail}
                {p.nickname && (
                  <span
                    style={{
                      color: SS_TOKENS.fg1,
                      fontWeight: 400,
                      marginLeft: 6,
                    }}
                  >
                    &ldquo;{p.nickname}&rdquo;
                  </span>
                )}
              </div>
              <div
                style={{ fontSize: 11, color: SS_TOKENS.fg2, marginTop: 1 }}
              >
                {p.operator} · {p.model}
              </div>
            </div>
            <div
              className="ss-mono"
              style={{ fontSize: 12, color: SS_TOKENS.fg1 }}
            >
              {p.altitude_ft != null
                ? `${p.altitude_ft.toLocaleString()}′`
                : "—"}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
