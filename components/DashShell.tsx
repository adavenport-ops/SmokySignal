"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { useRiderPos } from "@/lib/hooks/useRiderPos";
import { SS_TOKENS } from "@/lib/tokens";
import { SMOKY_TAIL } from "@/lib/seed";
import { countsAsSmokey } from "@/lib/mission";
import { haversineNm } from "@/lib/geo";
import { fmtAloft } from "@/lib/time";
import { roleBadgeStyle, roleBadgeText } from "@/lib/role-display";
import { StatusPill } from "./StatusPill";
import { Card } from "./Card";
import { AlertsOptInCard } from "./AlertsOptInCard";
import { ProximityFlash } from "./ProximityFlash";
import { ShareStatusButton } from "./ShareStatusButton";
import { SpeedWarning } from "./SpeedWarning";
import type { Aircraft, Snapshot } from "@/lib/types";
const NEAR_NM = 5;
// Top-N airborne planes to surface in the watcher list. Three is enough
// to convey crowdedness without dominating the screen.
const NEAREST_LIST_LIMIT = 3;

type Props = {
  initial: Snapshot;
  mockOn?: boolean;
  /** Page heading + Now/Recent switch, rendered above the live cards.
   *  The status pill sits on the heading row. */
  header: ReactNode;
  /** The Now/Recent segmented control, rendered under the heading row. */
  switcher?: ReactNode;
  /** Server kill switch for the rider speed warning (lib/flags.ts). */
  speedWarningAvailable?: boolean;
};

/**
 * The "Now" tab of /flights: what is up, and the nearest watchers to
 * the rider. The recent-events feed is the "Recent" tab
 * (components/ActivityFeed.tsx), so it is not repeated here.
 */
export function DashShell({
  initial,
  mockOn = false,
  header,
  switcher,
  speedWarningAvailable = true,
}: Props) {
  const snap = useAircraft(initial, mockOn);
  const { pos } = useRiderPos();

  const smoky = snap.aircraft.find((a) => a.tail === SMOKY_TAIL);
  const up = Boolean(smoky?.airborne);
  const airborne = useMemo(
    () => snap.aircraft.filter((a) => a.airborne),
    [snap.aircraft],
  );

  // Top-N airborne planes by Haversine distance — sorted ascending so
  // nearestList[0] is the single closest. Drives both the watcher list
  // and the proximity-flash trigger.
  const nearestList = useMemo<
    Array<{ plane: Aircraft; distanceNm: number }>
  >(() => {
    if (!pos) return [];
    const ranked: Array<{ plane: Aircraft; distanceNm: number }> = [];
    for (const a of airborne) {
      if (a.lat == null || a.lon == null) continue;
      ranked.push({
        plane: a,
        distanceNm: haversineNm(pos.lat, pos.lon, a.lat, a.lon),
      });
    }
    ranked.sort((x, y) => x.distanceNm - y.distanceNm);
    return ranked.slice(0, NEAREST_LIST_LIMIT);
  }, [pos, airborne]);
  const nearest = nearestList[0] ?? null;

  return (
    <main className="ss-page" style={{ gap: 14 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
          marginTop: 4,
        }}
      >
        {header}
        <StatusPill
          kind={up ? "alert" : "clear"}
          label={up ? "BIRD UP" : "ALL CLEAR"}
          sub={`${airborne.length}/${snap.aircraft.length}`}
        />
      </header>

      {switcher}

      <UpNowCard airborne={airborne} />

      <NearestCard
        nearestList={nearestList}
        riderHasFix={Boolean(pos)}
        smokyUp={up}
      />

      <ContextLine
        airborneCount={airborne.length}
        nearest={nearest}
      />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ShareStatusButton snapshot={snap} />
      </div>

      <AlertsOptInCard />

      <ProximityFlash
        active={
          nearest != null &&
          nearest.distanceNm <= NEAR_NM &&
          countsAsSmokey(nearest.plane)
        }
      />

      {/* N1b: on-device only, opt-in from /settings. */}
      <SpeedWarning aircraft={airborne} available={speedWarningAvailable} />
    </main>
  );
}

function NearestCard({
  nearestList,
  riderHasFix,
  smokyUp,
}: {
  nearestList: Array<{ plane: Aircraft; distanceNm: number }>;
  riderHasFix: boolean;
  smokyUp: boolean;
}) {
  return (
    <Card padded={false}>
      <div style={{ padding: "12px 14px 8px" }}>
        <span className="ss-eyebrow">Nearest watchers</span>
      </div>
      {nearestList.length > 0 ? (
        nearestList.map((entry, i) => (
          <NearestRow key={entry.plane.tail} entry={entry} primary={i === 0} />
        ))
      ) : (
        <NearestEmpty riderHasFix={riderHasFix} smokyUp={smokyUp} />
      )}
    </Card>
  );
}

function NearestRow({
  entry,
  primary,
}: {
  entry: { plane: Aircraft; distanceNm: number };
  primary: boolean;
}) {
  const inRange = entry.distanceNm <= NEAR_NM;
  return (
    <Link
      href={`/plane/${entry.plane.tail}`}
      prefetch={false}
      style={{
        display: "flex",
        gap: 12,
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderTop: `.5px solid ${SS_TOKENS.hairline}`,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            className="ss-mono"
            style={{
              fontSize: primary ? 15 : 13,
              fontWeight: 700,
              color: SS_TOKENS.fg0,
            }}
          >
            {entry.plane.tail}
          </span>
          {entry.plane.nickname && (
            <span
              style={{
                fontSize: 12,
                color: SS_TOKENS.fg1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entry.plane.nickname}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 1 }}>
          {entry.plane.operator} · {entry.plane.model}
        </div>
      </div>
      <span
        className="ss-mono"
        style={{
          fontSize: primary ? 18 : 14,
          fontWeight: 700,
          color: inRange ? SS_TOKENS.alert : SS_TOKENS.fg1,
        }}
      >
        {entry.distanceNm.toFixed(1)} nm
      </span>
    </Link>
  );
}

function NearestEmpty({
  riderHasFix,
  smokyUp,
}: {
  riderHasFix: boolean;
  smokyUp: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    padding: "12px 14px 16px",
    borderTop: `.5px solid ${SS_TOKENS.hairline}`,
  };
  if (!riderHasFix) {
    return (
      <div style={{ ...baseStyle, fontSize: 13, color: SS_TOKENS.fg2 }}>
        Need your location to compute distance — accept the prompt above to enable.
      </div>
    );
  }
  if (!smokyUp) {
    return (
      <div
        style={{ ...baseStyle, display: "flex", alignItems: "center", gap: 10 }}
      >
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
    );
  }
  return (
    <div style={{ ...baseStyle, fontSize: 13, color: SS_TOKENS.fg2 }}>
      A plane is up but we don&rsquo;t have its position yet.
    </div>
  );
}

function ContextLine({
  airborneCount,
  nearest,
}: {
  airborneCount: number;
  nearest: { plane: Aircraft; distanceNm: number } | null;
}) {
  let text: string;
  let color: string;
  if (nearest && nearest.distanceNm <= NEAR_NM) {
    const display = nearest.plane.nickname || nearest.plane.tail;
    text = `Heads up · ${display} ${nearest.distanceNm.toFixed(1)}nm away`;
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

function UpNowCard({ airborne }: { airborne: Aircraft[] }) {
  return (
    <Card padded={false}>
      <div
        style={{
          padding: "12px 14px 8px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span className="ss-eyebrow">Tails up</span>
        <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
          {airborne.length}
        </span>
      </div>
      {airborne.length === 0 ? (
        <div
          style={{
            padding: "12px 14px 16px",
            borderTop: `.5px solid ${SS_TOKENS.hairline}`,
            fontSize: 13,
            color: SS_TOKENS.fg1,
          }}
        >
          Nothing up right now. The sky is quiet.
        </div>
      ) : (
        airborne.map((a) => (
          <Link
            key={a.tail}
            href={`/plane/${a.tail}`}
            prefetch={false}
            data-testid="up-now-row"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 52,
              padding: "8px 14px",
              borderTop: `.5px solid ${SS_TOKENS.hairline}`,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  className="ss-mono"
                  style={{ fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}
                >
                  {a.tail}
                </span>
                {a.nickname && (
                  <span
                    style={{
                      fontSize: 12,
                      color: SS_TOKENS.fg1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.nickname}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 2 }}>
                {a.operator} · {fmtAloft(a.time_aloft_min)}
              </div>
            </div>
            <span className="ss-mono" style={{ ...roleBadgeStyle(a.role), flexShrink: 0 }}>
              {roleBadgeText(a.role)}
            </span>
          </Link>
        ))
      )}
    </Card>
  );
}
