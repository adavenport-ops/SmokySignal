import Link from "next/link";
import { unstable_cache } from "next/cache";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { getForecastGrid } from "@/lib/predictor";
import { ForecastGridView } from "@/components/ForecastGridView";
import { LearningPanel } from "@/components/LearningPanel";
import { MonthGrid } from "@/components/MonthGrid";
import { MonthSelect } from "@/components/MonthSelect";
import { getLearningState } from "@/lib/learning";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { getSnapshot } from "@/lib/snapshot";
import { getRegistry } from "@/lib/registry";
import { parseMissionsParam, resolveAllowedTails } from "@/lib/mission";
import { ForecastMissionFilter } from "@/components/ForecastMissionFilter";
import { computeStatus } from "@/lib/status";
import type { Mission } from "@/lib/types";
import { getRollupIndex, getRollups } from "@/lib/rollup";
import {
  LAST_30,
  resolveMonthParam,
  rollupMonths,
  summarizeMonth,
  utcDaysForMonth,
  type MonthSummary,
} from "@/lib/forecast-month";
import {
  applyMockForecastGrid,
  applyMockLearning,
  applyMockState,
  parseMockState,
} from "@/lib/mock-state";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "SmokySignal · Forecast",
  description: "Weekly probability of fleet takeoffs by hour and day, plus each month on record.",
};

const FORECAST_LEARNING_EVENT_FLOOR = 30;
const CACHE_SECONDS = 300;

const loadIndex = unstable_cache(
  async (): Promise<string[]> => getRollupIndex(),
  ["forecast-rollup-index-v1"],
  { revalidate: CACHE_SECONDS },
);

const loadMonth = unstable_cache(
  async (month: string, index: string[], tails: string[] | null): Promise<MonthSummary> => {
    const have = new Set(index);
    const docs = await getRollups(utcDaysForMonth(month).filter((d) => have.has(d)));
    return summarizeMonth(docs, month, index, Date.now(), tails ? new Set(tails) : null);
  },
  ["forecast-month-v1"],
  { revalidate: CACHE_SECONDS },
);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type SP = { mock?: string; month?: string; missions?: string };

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const mockState = parseMockState(searchParams.mock);
  let index: string[] = [];
  try {
    index = await loadIndex();
  } catch (e) {
    console.warn("[forecast] rollup index load failed:", e);
  }
  const months = rollupMonths(index);
  const period = resolveMonthParam(searchParams.month, months);
  const options = [{ value: LAST_30, label: "Last 30 days" }, ...months];

  // Same mission filter as /radar (lib/radar-filter.ts). The client chip
  // row writes the shared filter state and mirrors it into ?missions=.
  // Default: Smokey only. Applies to both the forecast and the month view.
  const missions = parseMissionsParam(searchParams.missions);
  const fleet = await getRegistry();
  const allowedTails = resolveAllowedTails(fleet, { roles: missions });
  const [realGrid, realLearning, realSnap] = await Promise.all([
    getForecastGrid({ tails: allowedTails }),
    getLearningState(),
    getSnapshot(),
  ]);
  let monthSummary: MonthSummary | null = null;
  if (period !== LAST_30) {
    try {
      monthSummary = await loadMonth(
        period,
        index,
        allowedTails ? [...allowedTails].sort() : null,
      );
    } catch (e) {
      console.warn("[forecast] month load failed:", e);
    }
  }

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
      className="ss-forecast-main"
      style={{
        minHeight: "100dvh",
        // 180 px bottom clears tab bar + iOS install prompt overlay.
        padding: "12px 18px 180px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        margin: "0 auto",
        minWidth: 0,
      }}
    >
      <style>{`
        .ss-forecast-main { max-width: 720px; }
        .ss-forecast-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (min-width: 768px) {
          .ss-forecast-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        @media (min-width: 1100px) {
          .ss-forecast-main { max-width: 1040px; }
        }
      `}</style>
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

      <MonthSelect value={period} options={options} />

      {period === LAST_30 ? (
        <>
          <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={h1Style}>Weekly forecast</h1>
            <p style={leadStyle}>
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
            <DeliveryNote />
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
        </>
      ) : (
        <MonthView
          summary={monthSummary}
          month={period}
          hour12={hour12}
          missions={missions}
        />
      )}
    </main>
  );
}

const h1Style: React.CSSProperties = {
  fontSize: TYPE.title,
  fontWeight: 800,
  letterSpacing: "-.03em",
  lineHeight: 1.1,
  color: SS_TOKENS.fg0,
  margin: 0,
};

const leadStyle: React.CSSProperties = {
  fontSize: 13,
  color: SS_TOKENS.fg1,
  lineHeight: 1.5,
  margin: 0,
};

function DeliveryNote() {
  return (
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
        style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}
      >
        /settings/alerts
      </Link>
      .
    </p>
  );
}

function MonthView({
  summary,
  month,
  hour12,
  missions,
}: {
  summary: MonthSummary | null;
  month: string;
  hour12: boolean;
  missions: Mission[];
}) {
  if (!summary) {
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={h1Style}>{month}</h1>
        <p style={leadStyle}>
          The log for this month did not load. Try again in a minute.
        </p>
        <DeliveryNote />
      </section>
    );
  }
  const s = summary;
  const n = s.days_of_data;
  const daysLine = `${n} day${n === 1 ? "" : "s"} of data in this month`;
  const peak = s.busiest_hour;
  const gridLabel = peak
    ? `Most time aloft in ${s.label}: ${DAYS[peak.dow]} ${fmtHour(peak.hour, hour12)} PT, ${Math.round(peak.minutes)} min.`
    : `No time aloft logged in ${s.label}.`;
  return (
    <>
      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={h1Style} data-testid="forecast-month-title">
          {s.label}
        </h1>
        <p style={leadStyle}>
          Minutes aloft by Pacific hour and weekday for the classes picked
          below, from the permanent daily log of public ADS-B data via adsb.fi and adsb.lol. A record of when the birds
          flew this month, not a promise about next week. Brighter cell, more
          time up.
        </p>
        <p
          className="ss-mono"
          data-testid="forecast-month-days"
          style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".04em", margin: 0 }}
        >
          {daysLine}
          {` (of ${s.days_in_month})`}
          {s.first_data_date && n < s.days_in_month
            ? ` · ${s.first_data_date} to ${s.last_data_date}`
            : ""}
        </p>
        {s.in_progress && (
          <p style={{ fontSize: 12, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>
            Month in progress. Each day is logged after it closes (UTC), so
            today is not counted yet.
          </p>
        )}
        <DeliveryNote />
      </section>

      <ForecastMissionFilter selected={missions} />

      <section
        aria-label="Month totals"
        className="ss-forecast-tiles"
        style={{ display: "grid", gap: 10 }}
      >
        <Tile
          label="Hours aloft"
          value={fmtHours(s.totals.airborne_s)}
          sub={`${s.totals.tails_flown} tail${s.totals.tails_flown === 1 ? "" : "s"} flew`}
        />
        <Tile label="Flights" value={String(s.totals.flights)} sub="takeoffs this month" />
        <Tile
          label="Busiest day"
          value={s.busiest_day ? s.busiest_day.date.slice(5) : "—"}
          sub={
            s.busiest_day
              ? `${DAYS[dowOf(s.busiest_day.date)]} · ${fmtHours(s.busiest_day.airborne_s)} h`
              : "no flights logged"
          }
        />
        <Tile
          label="Busiest hour"
          value={peak ? fmtHour(peak.hour, hour12) : "—"}
          sub={peak ? `${DAYS[peak.dow]} · ${Math.round(peak.minutes)} min aloft` : "no flights logged"}
        />
      </section>

      <section data-testid="forecast-month-grid" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="ss-eyebrow" style={{ margin: 0, fontWeight: 600 }}>
          Hour × weekday · minutes aloft
        </h2>
        <MonthGrid grid={s.week_grid} hour12={hour12} label={gridLabel} />
        <p className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, margin: 0 }}>
          {gridLabel}
        </p>
      </section>

      {s.per_tail.length > 0 && (
        <section data-testid="forecast-month-tails">
          <h2 className="ss-eyebrow" style={{ margin: "0 0 8px", fontWeight: 600 }}>
            Most time up
          </h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {s.per_tail.slice(0, 5).map((t) => (
              <li
                key={t.tail}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 0",
                  borderTop: `.5px solid ${SS_TOKENS.hairline}`,
                  fontSize: 13,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <Link
                    href={`/plane/${t.tail}`}
                    prefetch={false}
                    className="ss-mono"
                    style={{ color: SS_TOKENS.fg0, fontWeight: 700, textDecoration: "none" }}
                  >
                    {t.tail}
                  </Link>
                  <span style={{ color: SS_TOKENS.fg1 }}>
                    {" "}· {t.nickname ?? t.operator}
                  </span>
                </span>
                <span className="ss-mono" style={{ color: SS_TOKENS.fg0, flexShrink: 0 }}>
                  {fmtHours(t.airborne_s)} h · {t.flights}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p style={{ fontSize: 12, lineHeight: 1.55, color: SS_TOKENS.fg1, margin: 0 }}>
        Counts the tails in the classes picked above. A flight is a run
        of position reports with no gap over 5 minutes, so a coverage dropout
        can split one sortie in two. Times are Pacific, 24-hour unless you
        chose 12-hour in settings.
      </p>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <span className="ss-eyebrow">{label}</span>
      <span
        className="ss-mono"
        style={{ fontSize: 22, fontWeight: 700, color: SS_TOKENS.fg0, letterSpacing: "-.02em" }}
      >
        {value}
      </span>
      <span
        className="ss-mono"
        style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".02em", overflowWrap: "anywhere" }}
      >
        {sub}
      </span>
    </div>
  );
}

function dowOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function fmtHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

function fmtHour(h: number, hour12: boolean): string {
  if (!hour12) return `${String(h).padStart(2, "0")}:00`;
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}
