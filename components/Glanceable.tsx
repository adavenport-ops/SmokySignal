"use client";

import { useEffect, useState } from "react";
import type { Aircraft, Snapshot } from "@/lib/types";
import { SMOKY_TAIL } from "@/lib/seed";
import { SS_TOKENS } from "@/lib/tokens";
import { fmtAgo, fmtAloft } from "@/lib/format";
import { StatusPill } from "./StatusPill";
import { Card } from "./Card";
import { PlaneIcon, planeKindFor } from "./PlaneIcon";
import { PredictionCard } from "./PredictionCard";

type Props = { initial: Snapshot; mockOn?: boolean };

export function Glanceable({ initial, mockOn = false }: Props) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [updatedAgo, setUpdatedAgo] = useState<number>(0);

  // Poll /api/aircraft every 10s; pause when the tab is hidden so we don't
  // hammer the upstream feed in background tabs.
  useEffect(() => {
    let cancelled = false;
    const url = mockOn ? "/api/aircraft?mock=up" : "/api/aircraft";

    const fetchSnap = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as Snapshot;
        if (!cancelled) setSnap(data);
      } catch {
        // transient error — next tick retries
      }
    };

    void fetchSnap();
    const id = setInterval(fetchSnap, 10_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchSnap();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mockOn]);

  // "Updated Xs ago" label.
  useEffect(() => {
    setUpdatedAgo(0);
    const id = setInterval(() => {
      setUpdatedAgo(Math.floor((Date.now() - snap.fetched_at) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [snap.fetched_at]);

  const smoky = snap.aircraft.find((a) => a.tail === SMOKY_TAIL);
  const others = snap.aircraft.filter(
    (a) => a.airborne && a.tail !== SMOKY_TAIL,
  );
  const up = Boolean(smoky?.airborne);

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
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
        }}
      >
        <span className="ss-eyebrow">SmokySignal · Live</span>
        <span
          className="ss-mono"
          style={{ fontSize: 10.5, color: SS_TOKENS.fg2 }}
        >
          <span
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
          UPDATED {updatedAgo}s AGO · {snap.source.toUpperCase()}
        </span>
      </header>

      <Hero up={up} smoky={smoky} />

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

function Hero({ up, smoky }: { up: boolean; smoky: Aircraft | undefined }) {
  const eyebrow = up ? "THE BIRD IS UP" : "ALL CLEAR";
  const accentColor = up ? SS_TOKENS.alert : SS_TOKENS.clear;
  const halo = up ? SS_TOKENS.alertDim : SS_TOKENS.clearDim;

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
        {eyebrow}
      </div>
      <h1
        style={{
          fontSize: "clamp(48px, 14vw, 72px)",
          fontWeight: 800,
          letterSpacing: "-.04em",
          lineHeight: 1,
          marginTop: 10,
          color: SS_TOKENS.fg0,
        }}
      >
        Smoky&rsquo;s
        <br />
        <span style={{ color: accentColor }}>
          {up ? "watching." : "down."}
        </span>
      </h1>

      <p
        style={{
          marginTop: 14,
          fontSize: 14,
          color: SS_TOKENS.fg1,
          lineHeight: 1.45,
        }}
      >
        {up && smoky ? (
          <>
            Airborne at{" "}
            <b style={{ color: SS_TOKENS.fg0 }}>
              {smoky.altitude_ft != null ? (
                <span className="ss-mono">
                  {smoky.altitude_ft.toLocaleString()}&prime;
                </span>
              ) : (
                "altitude unknown"
              )}
            </b>
            {smoky.ground_speed_kt != null && (
              <>
                {" · "}
                <span className="ss-mono">{smoky.ground_speed_kt} kt</span>
              </>
            )}
            . Mind the throttle.
          </>
        ) : (
          <>
            No WSP plane up locally for{" "}
            <b style={{ color: SS_TOKENS.fg0 }}>
              {fmtAgo(smoky?.last_seen_min ?? null)}
            </b>
            . Send it.
          </>
        )}
      </p>

      {up && smoky && (
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {smoky.time_aloft_min != null && (
            <StatusPill kind="alert" label={fmtAloft(smoky.time_aloft_min)} />
          )}
          {smoky.ground_speed_kt != null && (
            <StatusPill
              kind="alert"
              label={`${smoky.ground_speed_kt} kt`}
            />
          )}
        </div>
      )}
    </section>
  );
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
