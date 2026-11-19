import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { getForecastGrid } from "@/lib/predictor";
import { ForecastGridView } from "@/components/ForecastGridView";
import { LearningPanel } from "@/components/LearningPanel";
import { getLearningState } from "@/lib/learning";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { getSnapshot } from "@/lib/snapshot";
import { getRegistry } from "@/lib/registry";
import { parseMissionsParam, resolveAllowedTails } from "@/lib/mission";
import { ForecastMissionFilter } from "@/components/ForecastMissionFilter";
import { computeStatus } from "@/lib/status";
import {
  applyMockForecastGrid,
  applyMockLearning,
  applyMockState,
  parseMockState,
} from "@/lib/mock-state";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "SmokySignal · Forecast",
  description: "Weekly probability of fleet takeoffs by hour and day.",
};

const FORECAST_LEARNING_EVENT_FLOOR = 30;

type SP = { mock?: string; missions?: string };

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const mockState = parseMockState(searchParams.mock);
  // Same mission filter as /radar (lib/radar-filter.ts). The client chip
  // row writes the shared filter state and mirrors it into ?missions=.
  // Default: Smokey only.
  const missions = parseMissionsParam(searchParams.missions);
  const fleet = await getRegistry();
  const allowedTails = resolveAllowedTails(fleet, { roles: missions });
  const [realGrid, realLearning, realSnap] = await Promise.all([
    getForecastGrid({ tails: allowedTails }),
    getLearningState(),
    getSnapshot(),
  ]);
  const grid = applyMockForecastGrid(realGrid, mockState);
  const learning = applyMockLearning(realLearning, mockState);
  const snap = applyMockState(realSnap, mockState);
  const fleetMap = new Map(fleet.map((f) => [f.tail, f]));
  const liveStatus = computeStatus(snap, fleetMap);
  const showLearning =
    learning.stillLearning ||
    grid.total_events < FORECAST_LEARNING_EVENT_FLOOR;
  const days = learning.daysElapsed;
  const daysNum = `${days}${learning.stillLearning ? "" : "+"}`;
  const daysWord = days === 1 ? "day" : "days";
  const hour12 = isHour12(getTimeFormatPref());
  return (
    <main
      style={{
        minHeight: "100dvh",
        // 180 px bottom clears tab bar + iOS install prompt overlay.
        padding: "12px 18px 180px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
          paddingRight: 48,
          gap: 12,
        }}
      >
        <span className="ss-eyebrow">SmokySignal · Forecast</span>
        <Link
          href="/"
          className="ss-mono"
          style={{ fontSize: 11, color: SS_TOKENS.fg1, textDecoration: "none" }}
        >
          ← Home
        </Link>
      </header>

      {liveStatus.kind === "alert" && (
        <Link
          href="/radar"
          aria-label={`Live now: ${liveStatus.pill}. Open radar.`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: SS_TOKENS.bg1,
            border: `1px solid ${SS_TOKENS.alert}`,
            borderRadius: 12,
            padding: "10px 14px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 0,
            }}
          >
            <span
              className="ss-mono ss-eyebrow"
              style={{ color: SS_TOKENS.alert }}
            >
              LIVE NOW
            </span>
            <span
              className="ss-mono"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: SS_TOKENS.fg0,
                letterSpacing: ".02em",
              }}
            >
              {liveStatus.pill}
              {liveStatus.pillSub ? ` · ${liveStatus.pillSub}` : ""}
            </span>
          </span>
          <span
            className="ss-mono"
            style={{
              fontSize: 11,
              color: SS_TOKENS.fg1,
              letterSpacing: ".06em",
              flexShrink: 0,
            }}
          >
            SEE /RADAR →
          </span>
        </Link>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-.02em",
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          Weekly forecast
        </h1>
        <p
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg1,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Hour-of-week probability of a takeoff in the classes picked below, drawn from{" "}
          <span className="ss-mono">{grid.total_events}</span> logged
          takeoff{grid.total_events === 1 ? "" : "s"}, seen in public ADS-B
          data via adsb.fi and adsb.lol {days <= 0 ? (
            "so far"
          ) : (
            <>
              over <span className="ss-mono">{daysNum}</span> {daysWord}
            </>
          )}
          . Brighter cells,
          busier hour. Tap a cell to see the regular birds.
        </p>
        <p
          style={{
            fontSize: 12,
            color: SS_TOKENS.fg1,
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          This page is check-back, not push. It never pings you. Live takeoff
          alerts are set up in{" "}
          <Link
            href="/settings/alerts"
            className="ss-mono"
            style={{ color: SS_TOKENS.alert, textDecoration: "underline" }}
          >
            /settings/alerts
          </Link>
          .
        </p>
      </section>

      <ForecastMissionFilter selected={missions} />

      {showLearning && (
        <LearningPanel
          state={learning}
          eventsSeen={grid.total_events}
          variant="banner"
        />
      )}

      <ForecastGridView grid={grid} hour12={hour12} />
    </main>
  );
}
