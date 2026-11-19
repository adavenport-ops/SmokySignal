import Link from "next/link";
import { unstable_cache } from "next/cache";
import { SS_TOKENS } from "@/lib/tokens";
import { getRollupIndex, getRollups } from "@/lib/rollup";
import {
  summarizeRollups,
  WEEKLY_WINDOW_DAYS,
  type StatsSummary,
  type TailStat,
} from "@/lib/rollup-core";
import { formatTs, fmtDurationHuman } from "@/lib/time";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { BackLink } from "@/components/BackLink";
import { ScrollX } from "@/components/ScrollX";
import { SeasonWrapCard } from "@/components/SeasonWrapCard";
import { pageMeta } from "@/lib/seo/site";
import { getRegistry } from "@/lib/registry";

// Cookies (time-format pref, flags in the tabs layout) make the route
// dynamic; the KV reads behind it are cached for 5 minutes instead.
export const dynamic = "force-dynamic";
export const metadata = pageMeta({
  title: "Stats: daily flight hours for every tracked tail",
  description:
    "How the bird flew: a permanent daily log of flight hours for every tracked WSP, sheriff and other aircraft over Washington.",
  path: "/stats",
});

// Cap the docs one render reads. A year of daily docs is a few hundred KB.
const MAX_DAYS_LOADED = 366;
const CACHE_SECONDS = 300;

const loadStats = unstable_cache(
  async (): Promise<StatsSummary> => {
    const index = await getRollupIndex();
    const docs = await getRollups(index.slice(-MAX_DAYS_LOADED));
    return summarizeRollups(docs, index, Date.now());
  },
  ["stats-summary-v1"],
  { revalidate: CACHE_SECONDS },
);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export default async function StatsPage() {
  const hour12 = isHour12(getTimeFormatPref());
  let stats: StatsSummary | null = null;
  try {
    stats = await loadStats();
  } catch (e) {
    console.warn("[stats] load failed:", e);
  }
  const empty = !stats || stats.days_on_record === 0;
  const known = new Set((await getRegistry()).map((f) => f.tail));

  return (
    <main className="ss-page" style={{ gap: 22 }}>
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · Stats</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            color: SS_TOKENS.fg0,
            margin: 0,
          }}
        >
          How the bird flew.
        </h1>
        <p style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>
          A permanent daily log of hours aloft, built from the same public
          ADS-B tracks as the radar. History, not a forecast.
        </p>
        <p
          className="ss-mono"
          data-testid="stats-span"
          style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".04em", margin: 0 }}
        >
          {empty
            ? "0 days of data"
            : `${stats!.days_on_record} day${stats!.days_on_record === 1 ? "" : "s"} of data since ${stats!.first_date}`}
        </p>
      </section>

      {empty ? <EmptyState /> : <StatsBody stats={stats!} hour12={hour12} known={known} />}

      <SeasonWrapCard />
    </main>
  );
}

function EmptyState() {
  return (
    <section
      data-testid="stats-empty"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "18px 16px",
      }}
    >
      <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
        Log is empty
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: SS_TOKENS.fg0, margin: "0 0 6px" }}>
        Nothing on the books yet.
      </h2>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1, margin: 0 }}>
        The daily log writes overnight, once a day closes. Check back
        tomorrow. For what is up right now, see{" "}
        <Link href="/radar" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
          /radar
        </Link>
        .
      </p>
    </section>
  );
}

function StatsBody({ stats, hour12, known }: { stats: StatsSummary; hour12: boolean; known: ReadonlySet<string> }) {
  const { totals, busiest_day: busiest, longest_sortie: longest } = stats;
  return (
    <>
      <section
        aria-label="Totals"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        <Tile label="Hours aloft" value={fmtHours(totals.airborne_s)} sub="all on record" />
        <Tile label="Flights" value={String(totals.flights)} sub="all tracked tails" />
        <Tile
          label="Busiest day"
          value={busiest ? busiest.date : "—"}
          sub={
            busiest
              ? `${fmtHours(busiest.airborne_s)} h · ${busiest.flights} flight${busiest.flights === 1 ? "" : "s"}`
              : "no flights logged"
          }
        />
        <Tile
          label="Longest sortie"
          value={longest ? fmtDurationHuman(longest.duration_s) : "—"}
          sub={
            longest
              ? `${longest.nickname ?? longest.tail} · ${formatTs(longest.start_ts, "datetime", { hour12 })}`
              : "no flights logged"
          }
        />
      </section>

      <WeeklyBars stats={stats} />
      <WeekGrid grid={stats.week_grid} hour12={hour12} days={stats.days_on_record} />
      <TailTable rows={stats.per_tail} known={known} />

      <p
        style={{
          fontSize: 12,
          lineHeight: 1.55,
          color: SS_TOKENS.fg2,
          margin: 0,
        }}
      >
        Counts every tail SmokySignal watches, not only WSP. A flight is a
        run of position reports with no gap over 5 minutes, so a coverage
        dropout can split one sortie in two. Times are Pacific.
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

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
      <h2 className="ss-eyebrow" style={{ margin: 0, fontWeight: 600 }}>
        {title}
      </h2>
      <p style={{ fontSize: 12, color: SS_TOKENS.fg2, margin: 0, lineHeight: 1.45 }}>{note}</p>
    </div>
  );
}

function WeeklyBars({ stats }: { stats: StatsSummary }) {
  const max = Math.max(...stats.weekly.map((w) => w.airborne_s), 1);
  return (
    <section data-testid="stats-weekly">
      <SectionHead
        title={`Last ${WEEKLY_WINDOW_DAYS} days · hours aloft per week`}
        note="Weeks start Monday, Pacific. Cut weeks are marked."
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {stats.weekly.map((w) => (
          <div
            key={w.week_start}
            style={{
              display: "grid",
              gridTemplateColumns: "88px 1fr 56px",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
              {w.week_start.slice(5)}
              {w.partial ? "*" : ""}
            </span>
            <span
              aria-hidden
              style={{
                height: 12,
                borderRadius: 3,
                background: "rgba(255,255,255,0.04)",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${(w.airborne_s / max) * 100}%`,
                  background: SS_TOKENS.sky,
                  opacity: 0.85,
                }}
              />
            </span>
            <span
              className="ss-mono"
              style={{ fontSize: 12, color: SS_TOKENS.fg0, textAlign: "right" }}
            >
              {fmtHours(w.airborne_s)} h
            </span>
          </div>
        ))}
      </div>
      <p className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, margin: "6px 0 0" }}>
        * partial week
      </p>
    </section>
  );
}

function WeekGrid({ grid, hour12, days }: { grid: number[][]; hour12: boolean; days: number }) {
  let max = 0;
  let peak: { dow: number; hour: number; min: number } | null = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = grid[d]![h]!;
      if (v > max) {
        max = v;
        peak = { dow: d, hour: h, min: v };
      }
    }
  }
  const summary = peak
    ? `Most time aloft: ${DAYS[peak.dow]} ${fmtHour(peak.hour, hour12)} PT, ${Math.round(peak.min)} min over ${days} day${days === 1 ? "" : "s"}.`
    : "No time aloft logged yet.";
  return (
    <section data-testid="stats-grid">
      <SectionHead
        title="Hour × weekday · minutes aloft"
        note="Every logged minute of flight, stacked by Pacific hour and weekday. Brighter cell, more time up."
      />
      <ScrollX label="Hour by weekday grid of minutes aloft" testId="stats-grid-scroll">
        <div
          role="img"
          aria-label={summary}
          style={{
            display: "grid",
            gridTemplateColumns: "auto repeat(24, 1fr)",
            gap: 2,
            minWidth: 560,
          }}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="ss-mono"
              style={{
                fontSize: 12,
                color: SS_TOKENS.fg1,
                textAlign: "center",
                padding: "0 1px 4px",
              }}
            >
              {h % 6 === 0 ? h : ""}
            </div>
          ))}
          {grid.map((row, dow) => (
            <GridRow key={dow} dow={dow} row={row} max={max} />
          ))}
        </div>
      </ScrollX>
      <p className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, margin: "8px 0 0" }}>
        {summary}
      </p>
    </section>
  );
}

function GridRow({ dow, row, max }: { dow: number; row: number[]; max: number }) {
  return (
    <>
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg1,
          letterSpacing: ".06em",
          paddingRight: 6,
          alignSelf: "center",
        }}
      >
        {DAYS[dow]}
      </div>
      {row.map((v, h) => (
        <div
          key={h}
          style={{
            aspectRatio: "1 / 1",
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 3,
            background: coolHeat(v, max),
          }}
        />
      ))}
    </>
  );
}

/**
 * Cool ramp on purpose: amber means "Smokey is up right now" and is
 * reserved for live state. History gets the sky token.
 */
function coolHeat(v: number, max: number): string {
  if (v <= 0 || max <= 0) return "rgba(255,255,255,0.03)";
  const t = Math.min(1, v / max);
  const alpha = 0.12 + 0.78 * t;
  return `rgba(91,182,255,${alpha.toFixed(3)})`;
}

function TailTable({ rows, known }: { rows: TailStat[]; known: ReadonlySet<string> }) {
  return (
    <section data-testid="stats-tails">
      <SectionHead title="By tail" note="Flights and hours aloft for every tail on record." />
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0 }}>No flights logged yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th align="left">Tail</Th>
              <Th align="left">Operator</Th>
              <Th align="right">Flights</Th>
              <Th align="right">Hours</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tail} style={{ borderTop: `.5px solid ${SS_TOKENS.hairline}` }}>
                <td style={{ padding: "10px 6px 10px 0" }}>
                  {known.has(r.tail) ? (
                    <Link
                      href={`/plane/${r.tail}`}
                      prefetch={false}
                      className="ss-mono"
                      style={{ color: SS_TOKENS.fg0, textDecoration: "none", fontWeight: 700 }}
                    >
                      {r.tail}
                    </Link>
                  ) : (
                    // Tail since dropped from the registry: no page to link.
                    <span className="ss-mono" style={{ color: SS_TOKENS.fg0, fontWeight: 700 }}>
                      {r.tail}
                    </span>
                  )}
                  {r.nickname && (
                    <span style={{ display: "block", fontSize: 12, color: SS_TOKENS.fg1 }}>
                      {r.nickname}
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px 6px", color: SS_TOKENS.fg1 }}>{r.operator}</td>
                <td className="ss-mono" style={{ padding: "10px 6px", textAlign: "right", color: SS_TOKENS.fg0 }}>
                  {r.flights}
                </td>
                <td className="ss-mono" style={{ padding: "10px 0 10px 6px", textAlign: "right", color: SS_TOKENS.fg0 }}>
                  {fmtHours(r.airborne_s)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" }) {
  return (
    <th
      scope="col"
      className="ss-mono"
      style={{
        textAlign: align,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: SS_TOKENS.fg2,
        padding: "0 6px 8px",
      }}
    >
      {children}
    </th>
  );
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
