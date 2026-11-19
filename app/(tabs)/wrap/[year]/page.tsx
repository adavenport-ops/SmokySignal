import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo/jsonld";
import { pageMeta } from "@/lib/seo/site";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { BackLink } from "@/components/BackLink";
import { SS_TOKENS } from "@/lib/tokens";
import { loadWrap } from "@/lib/rollup-read";
import { LOG_START_DATE } from "@/lib/rollup-sessions";
import { missionLabel } from "@/lib/role-display";
import { formatTs, fmtDurationHuman } from "@/lib/time";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { isWrapYear, type WrapMonth, type WrapSummary } from "@/lib/wrap";

export const dynamic = "force-dynamic";

type Props = { params: { year: string } };

function parseYear(raw: string): number | null {
  return /^\d{4}$/.test(raw) && isWrapYear(Number(raw), Date.now()) ? Number(raw) : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const year = parseYear(params.year);
  if (!year) return { title: "Season wrap", robots: { index: false, follow: false } };
  return pageMeta({
    title: `${year} season wrap: how the patrol aircraft flew`,
    description: `How the birds flew over Washington in ${year}: sorties, hours aloft, busiest month and the corridor worked most. Built from public ADS-B.`,
    path: `/wrap/${year}`,
    inheritImage: true,
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function monthName(m: string): string {
  return MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
}

function hours(s: number): string {
  return (s / 3600).toFixed(1);
}

export default async function WrapPage({ params }: Props) {
  const year = parseYear(params.year);
  if (!year) notFound();
  const hour12 = isHour12(getTimeFormatPref());
  let w: WrapSummary | null = null;
  try {
    w = await loadWrap(year);
  } catch (e) {
    console.warn(`[wrap] ${year} load failed:`, e);
  }

  return (
    <main className="ss-page" style={{ gap: 22 }}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "SmokySignal", path: "/" },
          { name: "Data and CSV", path: "/data" },
          { name: `${year} season wrap`, path: `/wrap/${year}` },
        ])}
      />
      <BackLink />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span className="ss-eyebrow">SmokySignal · Wrap</span>
        <ShareLinkButton path={`/wrap/${year}`} label="Share wrap" size="sm" ariaLabel={`Share the ${year} season wrap`} />
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.03em", color: SS_TOKENS.fg0, margin: 0, lineHeight: 1.1 }}>
          The {year} season, from overhead.
        </h1>
        <p style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>
          How the birds flew this year: every tracked tail, every logged sortie. Season means the calendar year,
          Pacific time.
        </p>
        {w?.limited && (
          <p data-testid="wrap-limited" style={{ fontSize: 13, color: SS_TOKENS.fg0, lineHeight: 1.5, margin: 0 }}>
            Our log starts {LOG_START_DATE}. Next year&rsquo;s wrap covers the whole season.
          </p>
        )}
        {w && (
          <p className="ss-mono" data-testid="wrap-span" style={{ fontSize: 12, color: SS_TOKENS.fg2, letterSpacing: ".04em", margin: 0 }}>
            {w.from} to {w.to}
            {w.in_progress ? " · season still running" : ""}
          </p>
        )}
      </section>

      {!w || w.totals.sorties === 0 ? (
        <section
          data-testid="wrap-empty"
          style={{ background: SS_TOKENS.bg1, border: `.5px solid ${SS_TOKENS.hairline}`, borderRadius: 14, padding: "18px 16px" }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, color: SS_TOKENS.fg0, margin: "0 0 6px" }}>Quiet skies on the books.</h2>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1, margin: 0 }}>
            No sorties logged for {year} yet. The log writes overnight, once a day closes.
          </p>
        </section>
      ) : (
        <WrapBody w={w} hour12={hour12} />
      )}

      <p style={{ fontSize: 12, lineHeight: 1.55, color: SS_TOKENS.fg2, margin: 0 }}>
        Counts aircraft, not people. A sortie is a run of public ADS-B reports with no gap over 5 minutes. Corridor
        time comes from orbit and racetrack patterns over named roads. Monthly numbers are on{" "}
        <Link href="/data" style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}>
          Data and CSV
        </Link>
        ; the rolling view is on{" "}
        <Link href="/stats" style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}>
          stats
        </Link>
        .
      </p>
    </main>
  );
}

function WrapBody({ w, hour12 }: { w: WrapSummary; hour12: boolean }) {
  const maxMonth = Math.max(1, ...w.months.map((m) => m.airborne_s));
  return (
    <>
      <section aria-label="Season totals" data-testid="wrap-totals" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Tile label="Sorties" value={String(w.totals.sorties)} sub={`${w.totals.tails} tail${w.totals.tails === 1 ? "" : "s"} flew`} />
        <Tile label="Hours aloft" value={hours(w.totals.airborne_s)} sub="all missions" />
        <Tile
          label="Busiest month"
          value={w.busiest_month ? monthName(w.busiest_month.month) : "—"}
          sub={w.busiest_month ? monthSub(w.busiest_month) : "no flights logged"}
        />
        <Tile
          label="Busiest day"
          value={w.busiest_day ? w.busiest_day.date.slice(5) : "—"}
          sub={w.busiest_day ? `${hours(w.busiest_day.airborne_s)} h · ${w.busiest_day.sorties} sortie${w.busiest_day.sorties === 1 ? "" : "s"}` : "no flights logged"}
        />
        <Tile
          label="Busiest hour"
          value={w.busiest_hour ? fmtHour(w.busiest_hour.hour, hour12) : "—"}
          sub={w.busiest_hour ? `${fmtStation(w.busiest_hour.minutes * 60)} aloft, PT` : "no flights logged"}
        />
        <Tile
          label="Longest sortie"
          value={w.longest ? fmtDurationHuman(w.longest.duration_s) : "—"}
          sub={w.longest ? `${w.longest.nickname ?? w.longest.tail} · ${formatTs(w.longest.start_ts, "date")}` : "no flights logged"}
        />
        <Tile
          label="Quietest month"
          value={w.quietest_month ? monthName(w.quietest_month.month) : "—"}
          sub={w.quietest_month ? monthSub(w.quietest_month) : "one month on the books"}
        />
        <Tile
          label="Most-worked corridor"
          value={w.corridor ? w.corridor.road : "—"}
          sub={
            w.corridor
              ? `${fmtStation(w.corridor.s)} in patterns${w.corridor.place ? `, mostly ${w.corridor.place}` : ""}`
              : w.sorties_with_detail > 0
                ? "patterns stayed off the named roads"
                : "pattern detail still filling in"
          }
        />
      </section>

      <section data-testid="wrap-months">
        <SectionHead title="Month by month" note="Hours aloft by takeoff month. Cut months are marked." />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {w.months.map((m) => (
            <div key={m.month} style={{ display: "grid", gridTemplateColumns: "64px 1fr 108px", alignItems: "center", gap: 10 }}>
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
                {m.month}
                {m.partial ? "*" : ""}
              </span>
              <span aria-hidden style={{ height: 12, borderRadius: 3, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(m.airborne_s / maxMonth) * 100}%`, background: SS_TOKENS.sky, opacity: 0.85 }} />
              </span>
              <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg0, textAlign: "right" }}>
                {m.sorties} · {hours(m.airborne_s)} h
              </span>
            </div>
          ))}
        </div>
        <p className="ss-mono" style={{ fontSize: 12.5, color: SS_TOKENS.fg2, margin: "6px 0 0" }}>
          * partial month
        </p>
      </section>

      <section data-testid="wrap-missions">
        <SectionHead title="By mission" note="Which kinds of birds were up, and for how long." />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th align="left">Mission</Th>
              <Th align="right">Sorties</Th>
              <Th align="right">Hours</Th>
              <Th align="right">Tails</Th>
            </tr>
          </thead>
          <tbody>
            {w.by_mission.map((m) => (
              <tr key={m.mission} style={{ borderTop: `.5px solid ${SS_TOKENS.hairline}` }}>
                <td style={{ padding: "10px 6px 10px 0", color: SS_TOKENS.fg0 }}>{missionLabel(m.mission)}</td>
                <td className="ss-mono" style={{ padding: "10px 6px", textAlign: "right", color: SS_TOKENS.fg0 }}>
                  {m.sorties}
                </td>
                <td className="ss-mono" style={{ padding: "10px 6px", textAlign: "right", color: SS_TOKENS.fg0 }}>
                  {hours(m.airborne_s)}
                </td>
                <td className="ss-mono" style={{ padding: "10px 0 10px 6px", textAlign: "right", color: SS_TOKENS.fg0 }}>
                  {m.tails}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function monthSub(m: WrapMonth): string {
  return `${m.month}${m.partial ? "*" : ""} · ${hours(m.airborne_s)} h · ${m.sorties} sortie${m.sorties === 1 ? "" : "s"}`;
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
      <span className="ss-mono" style={{ fontSize: 22, fontWeight: 700, color: SS_TOKENS.fg0, letterSpacing: "-.02em", overflowWrap: "anywhere" }}>
        {value}
      </span>
      <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".02em", overflowWrap: "anywhere" }}>
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

function Th({ children, align }: { children: React.ReactNode; align: "left" | "right" }) {
  return (
    <th
      scope="col"
      className="ss-mono"
      style={{ textAlign: align, fontSize: 12, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: SS_TOKENS.fg2, padding: "0 6px 8px" }}
    >
      {children}
    </th>
  );
}

function fmtHour(h: number, hour12: boolean): string {
  if (!hour12) return `${String(h).padStart(2, "0")}:00`;
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

/** "47 min" under two hours, "13.4 h" above. */
function fmtStation(seconds: number): string {
  const min = Math.round(seconds / 60);
  return min < 120 ? `${min} min` : `${(seconds / 3600).toFixed(1)} h`;
}
