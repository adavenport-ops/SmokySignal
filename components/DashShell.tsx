"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { useRiderPos } from "@/lib/hooks/useRiderPos";
import { SS_TOKENS } from "@/lib/tokens";
import { SMOKY_TAIL } from "@/lib/seed";
import { haversineNm, DEFAULT_SPEED_LIMIT_MPH } from "@/lib/geo";
import { StatusPill } from "./StatusPill";
import { Card } from "./Card";
import { Speedometer } from "./Speedometer";
import type { Aircraft, Snapshot } from "@/lib/types";
import type { ActivityEntry } from "@/lib/activity";

const TABBAR_HEIGHT = 66;
const NEAR_NM = 5;
const MPS_TO_MPH = 2.236936;

type Props = {
  initial: Snapshot;
  initialActivity: ActivityEntry[];
  mockOn?: boolean;
};

export function DashShell({ initial, initialActivity, mockOn = false }: Props) {
  const snap = useAircraft(initial, mockOn);
  const { pos, unavailable } = useRiderPos();
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity);

  const smoky = snap.aircraft.find((a) => a.tail === SMOKY_TAIL);
  const up = Boolean(smoky?.airborne);
  const airborne = useMemo(
    () => snap.aircraft.filter((a) => a.airborne),
    [snap.aircraft],
  );

  // Speed in mph from device. Some browsers report null when stationary.
  const mph =
    pos?.speedMps != null && pos.speedMps >= 0
      ? pos.speedMps * MPS_TO_MPH
      : 0;
  const hasSpeedSignal = pos?.speedMps != null && pos.speedMps >= 0;
  const limit = DEFAULT_SPEED_LIMIT_MPH;
  const speeding = mph > limit;

  // Nearest airborne plane by Haversine.
  const nearest = useMemo<{
    plane: Aircraft;
    distanceNm: number;
  } | null>(() => {
    if (!pos) return null;
    let best: { plane: Aircraft; distanceNm: number } | null = null;
    for (const a of airborne) {
      if (a.lat == null || a.lon == null) continue;
      const d = haversineNm(pos.lat, pos.lon, a.lat, a.lon);
      if (!best || d < best.distanceNm) best = { plane: a, distanceNm: d };
    }
    return best;
  }, [pos, airborne]);

  // Poll /api/activity every 10s.
  useEffect(() => {
    let cancelled = false;
    const fetchActivity = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/activity?limit=10", { cache: "no-store" });
        if (!r.ok) return;
        const data = (await r.json()) as { entries: ActivityEntry[] };
        if (!cancelled) setActivity(data.entries);
      } catch {
        // transient — try again next tick
      }
    };
    const id = setInterval(fetchActivity, 10_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchActivity();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: `12px 18px ${TABBAR_HEIGHT + 24}px`,
        maxWidth: 460,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
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
        <span className="ss-eyebrow">SmokySignal · Dash</span>
        <StatusPill
          kind={up ? "alert" : "clear"}
          label={up ? "BIRD UP" : "ALL CLEAR"}
          sub={`${airborne.length}/${snap.aircraft.length}`}
        />
      </header>

      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 6,
          }}
        >
          <Speedometer
            mph={mph}
            limit={limit}
            hasSignal={hasSpeedSignal}
          />
        </div>
        {unavailable && (
          <div
            className="ss-mono"
            style={{
              marginTop: 8,
              textAlign: "center",
              fontSize: 11,
              color: SS_TOKENS.fg2,
              letterSpacing: ".04em",
            }}
          >
            Location off · speed unavailable
          </div>
        )}
      </Card>

      <NearestCard nearest={nearest} riderHasFix={Boolean(pos)} smokyUp={up} />

      <ContextLine
        speeding={speeding}
        airborneCount={airborne.length}
        nearest={nearest}
      />

      <ActivityFeed entries={activity} />
    </main>
  );
}

function NearestCard({
  nearest,
  riderHasFix,
  smokyUp,
}: {
  nearest: { plane: Aircraft; distanceNm: number } | null;
  riderHasFix: boolean;
  smokyUp: boolean;
}) {
  return (
    <Card>
      <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
        Nearest watcher
      </div>
      {nearest ? (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="ss-mono"
              style={{ fontSize: 16, fontWeight: 700, color: SS_TOKENS.fg0 }}
            >
              {nearest.plane.tail}
            </span>
            {nearest.plane.nickname && (
              <span style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                &ldquo;{nearest.plane.nickname}&rdquo;
              </span>
            )}
          </div>
          <div
            className="ss-mono"
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: nearest.distanceNm <= NEAR_NM ? SS_TOKENS.alert : SS_TOKENS.fg0,
              marginTop: 4,
            }}
          >
            {nearest.distanceNm.toFixed(1)} nm
          </div>
          <div style={{ fontSize: 11.5, color: SS_TOKENS.fg2, marginTop: 2 }}>
            {nearest.plane.operator} · {nearest.plane.model}
          </div>
        </div>
      ) : !riderHasFix ? (
        <div style={{ fontSize: 13, color: SS_TOKENS.fg2 }}>
          Need your location to compute distance — accept the prompt above to enable.
        </div>
      ) : !smokyUp ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: SS_TOKENS.clear,
              boxShadow: `0 0 8px ${SS_TOKENS.clear}`,
            }}
          />
          <span style={{ fontSize: 14, color: SS_TOKENS.fg1 }}>
            All clear · Smokey&rsquo;s down
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: SS_TOKENS.fg2 }}>
          A plane is up but we don&rsquo;t have its position yet.
        </div>
      )}
    </Card>
  );
}

function ContextLine({
  speeding,
  airborneCount,
  nearest,
}: {
  speeding: boolean;
  airborneCount: number;
  nearest: { plane: Aircraft; distanceNm: number } | null;
}) {
  let text: string;
  let color: string;
  if (
    speeding &&
    nearest &&
    nearest.distanceNm <= NEAR_NM
  ) {
    const display = nearest.plane.nickname || nearest.plane.tail;
    text = `Mind the throttle · ${display} ${nearest.distanceNm.toFixed(1)}nm away`;
    color = SS_TOKENS.warn;
  } else if (airborneCount > 0) {
    text = "Smokey up but not nearby";
    color = SS_TOKENS.fg1;
  } else {
    text = "Clear skies";
    color = SS_TOKENS.clear;
  }
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        fontSize: 13,
        color,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <Card padded={false}>
      <div style={{ padding: "12px 14px 8px" }}>
        <span className="ss-eyebrow">Recent activity</span>
      </div>
      {entries.length === 0 ? (
        <div
          style={{
            padding: "16px 14px",
            fontSize: 12.5,
            color: SS_TOKENS.fg2,
            borderTop: `.5px solid ${SS_TOKENS.hairline}`,
          }}
        >
          Nothing notable — feed populates as planes take off, land, or change altitude.
        </div>
      ) : (
        entries.map((e, i) => <ActivityRow key={i} entry={e} />)
      )}
    </Card>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <Link
      href={`/plane/${entry.tail}`}
      prefetch={false}
      style={{
        display: "flex",
        gap: 10,
        padding: "10px 14px",
        borderTop: `.5px solid ${SS_TOKENS.hairline}`,
        alignItems: "flex-start",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span
        className="ss-mono"
        style={{
          fontSize: 10,
          color: SS_TOKENS.fg2,
          minWidth: 56,
          marginTop: 2,
        }}
      >
        {fmtRelative(entry.ts)}
      </span>
      <span style={{ flex: 1, fontSize: 12.5, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>
        {entry.description}
      </span>
    </Link>
  );
}

function fmtRelative(tsSec: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - tsSec));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
