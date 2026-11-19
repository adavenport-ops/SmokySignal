import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { buildMissionRows, hoursString, ledgerMonths, type LedgerRow } from "@/lib/ledger";
import { loadLedgerRows } from "@/lib/rollup-read";
import { LOG_START_DATE } from "@/lib/rollup-sessions";
import { missionLabel } from "@/lib/role-display";
import { formatTs } from "@/lib/time";
import { BackLink } from "@/components/BackLink";
import { ScrollX } from "@/components/ScrollX";
import { SeasonWrapCard } from "@/components/SeasonWrapCard";
import { pageMeta } from "@/lib/seo/site";
import { getRegistry } from "@/lib/registry";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, datasetJsonLd } from "@/lib/seo/jsonld";

// Cookies in the tabs layout make the route dynamic; the KV reads behind
// it are cached for 10 minutes (lib/rollup-read.ts).
export const dynamic = "force-dynamic";
export const metadata = pageMeta({
  title: "Data and CSV: open flight-hours dataset",
  description:
    "Monthly flight hours for every tracked tail, by tail and by mission, with a CSV download. Open data under ODbL 1.0, from public ADS-B.",
  path: "/data",
});

const CSV_PATH = "/data/flight-hours.csv";

export default async function DataPage() {
  let rows: LedgerRow[] = [];
  let failed = false;
  try {
    rows = await loadLedgerRows();
  } catch (e) {
    failed = true;
    console.warn("[data] load failed:", e);
  }
  const known = new Set((await getRegistry()).map((f) => f.tail));
  const months = ledgerMonths(rows);
  // Newest month first; missions keep their canonical order within it.
  const missionRows = buildMissionRows(rows).sort((a, b) => b.month.localeCompare(a.month));
  const newestFirst = [...rows].sort((a, b) => b.month.localeCompare(a.month) || a.tail.localeCompare(b.tail));

  return (
    <main className="ss-page" style={{ gap: 22 }}>
      <JsonLd
        data={[
          datasetJsonLd({ months }),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: "Data and CSV", path: "/data" },
          ]),
        ]}
      />
      <BackLink />
      <span className="ss-eyebrow">SmokySignal · Data and CSV</span>

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-.02em", color: SS_TOKENS.fg0, margin: 0 }}>
          Data and CSV.
        </h1>
        <p style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.5, margin: 0 }}>
          Monthly flight hours for every tail SmokySignal tracks, by tail and by mission. Take it,
          chart it, cite it. The{" "}
          <Link href={`/wrap/${formatTs(Date.now(), "date").slice(0, 4)}`} style={linkStyle}>
            season wrap
          </Link>{" "}
          reads the same log.
        </p>
        <p className="ss-mono" data-testid="data-span" style={{ fontSize: 12, color: SS_TOKENS.fg2, letterSpacing: ".04em", margin: 0 }}>
          {months.length === 0
            ? `No months on file yet. Log starts ${LOG_START_DATE}.`
            : `${months.length} month${months.length === 1 ? "" : "s"} on file, ${months[0]} to ${months[months.length - 1]}`}
        </p>
      </section>

      <Download months={months} />

      <SeasonWrapCard />

      {failed && (
        <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: 0 }}>
          The data did not load. Try again in a minute.
        </p>
      )}

      <section data-testid="data-missions">
        <SectionHead title="By mission" note="Hours aloft per month for each class of tail. Smokey is WSP, the sheriffs and mutual-aid neighbors." />
        <Scroll minWidth={420}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Mission</Th>
                <Th right>Flights</Th>
                <Th right>Hours</Th>
                <Th right>Tails</Th>
              </tr>
            </thead>
            <tbody>
              {missionRows.map((r) => (
                <tr key={`${r.month}-${r.mission}`} style={rowStyle}>
                  <Td mono>{r.month}</Td>
                  <Td>{missionLabel(r.mission)}</Td>
                  <Td mono right>{r.flights}</Td>
                  <Td mono right>{hoursString(r.airborne_s)}</Td>
                  <Td mono right>{r.tails}</Td>
                </tr>
              ))}
              {missionRows.length === 0 && <EmptyRow cols={5} />}
            </tbody>
          </table>
        </Scroll>
      </section>

      <section data-testid="data-tails">
        <SectionHead title="By tail" note="Same columns as the CSV, newest month first." />
        <Scroll minWidth={680}>
          <table style={tableStyle} data-testid="data-table">
            <thead>
              <tr>
                <Th>Month</Th>
                <Th>Tail</Th>
                <Th>Nickname</Th>
                <Th>Operator</Th>
                <Th>Mission</Th>
                <Th right>Flights</Th>
                <Th right>Hours</Th>
                <Th right>Max alt ft</Th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((r) => (
                <tr key={`${r.month}-${r.tail}`} style={rowStyle}>
                  <Td mono>{r.month}</Td>
                  <Td mono>
                    {known.has(r.tail) ? (
                      <Link href={`/plane/${r.tail}`} prefetch={false} style={{ color: SS_TOKENS.fg0, fontWeight: 700, textDecoration: "none" }}>
                        {r.tail}
                      </Link>
                    ) : (
                      // Tail since dropped from the registry: no page to link.
                      <span style={{ color: SS_TOKENS.fg0, fontWeight: 700 }}>{r.tail}</span>
                    )}
                  </Td>
                  <Td>{r.nickname ?? ""}</Td>
                  <Td>{r.operator}</Td>
                  <Td>{missionLabel(r.mission)}</Td>
                  <Td mono right>{r.flights}</Td>
                  <Td mono right>{hoursString(r.airborne_s)}</Td>
                  <Td mono right>{r.max_alt_ft > 0 ? r.max_alt_ft.toLocaleString("en-US") : ""}</Td>
                </tr>
              ))}
              {rows.length === 0 && <EmptyRow cols={8} />}
            </tbody>
          </table>
        </Scroll>
      </section>

      <Methods />
    </main>
  );
}

function Download({ months }: { months: string[] }) {
  const first = months[0];
  const last = months[months.length - 1];
  return (
    <section
      data-testid="data-download"
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <span className="ss-eyebrow">Download</span>
        <a href={CSV_PATH} download data-testid="data-csv-all" className="ss-mono" style={buttonStyle}>
          flight-hours.csv · all months
        </a>
      </div>
      {months.length > 1 && (
        <form action={CSV_PATH} method="get" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <MonthSelect name="from" label="From" months={months} value={first!} />
          <MonthSelect name="to" label="To" months={months} value={last!} />
          <button type="submit" className="ss-mono" style={{ ...buttonStyle, cursor: "pointer" }}>
            Download range
          </button>
        </form>
      )}
      <p className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg2, margin: 0, lineHeight: 1.5, overflowWrap: "anywhere" }}>
        {`${CSV_PATH}?from=YYYY-MM&to=YYYY-MM`}
      </p>
    </section>
  );
}

function MonthSelect({ name, label, months, value }: { name: string; label: string; months: string[]; value: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: SS_TOKENS.fg2 }}>
      <span className="ss-mono" style={{ letterSpacing: ".08em" }}>
        {label.toUpperCase()}
      </span>
      <select
        name={name}
        defaultValue={value}
        className="ss-mono"
        style={{
          background: SS_TOKENS.bg2,
          color: SS_TOKENS.fg0,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          borderRadius: 8,
          padding: "8px 10px",
          minHeight: 40,
          fontSize: 13,
        }}
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}

function Methods() {
  const p = { fontSize: 12.5, lineHeight: 1.55, color: SS_TOKENS.fg1, margin: 0 } as const;
  return (
    <section data-testid="data-methods" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SectionHead title="Methods" note="What the numbers are, and what they are not." />
      <p style={p}>
        <strong style={{ color: SS_TOKENS.fg0 }}>Source.</strong> Public ADS-B position reports, read live from{" "}
        <a href="https://adsb.fi" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          adsb.fi
        </a>{" "}
        and{" "}
        <a href="https://adsb.lol" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          adsb.lol
        </a>
        . Nothing here comes from an agency.
      </p>
      <p style={p}>
        <strong style={{ color: SS_TOKENS.fg0 }}>Coverage.</strong> Receivers are volunteer stations. Low flying,
        terrain and gaps between stations drop reports, and a tail flying with its transponder off never shows up.
        A flight is a run of reports with no gap over 5 minutes, so a dropout can split one sortie in two. Hours run
        from first report to last.
      </p>
      <p style={p}>
        <strong style={{ color: SS_TOKENS.fg0 }}>Span.</strong> Data starts{" "}
        <span className="ss-mono">{LOG_START_DATE}</span>. Nothing earlier is on file. Months are Pacific, counted by
        takeoff.
      </p>
      <p style={p}>
        <strong style={{ color: SS_TOKENS.fg0 }}>Detail.</strong> Aircraft only, never crew. Coarse on purpose: month,
        tail, flights, hours and peak altitude. No positions and no times of day in the CSV.
      </p>
      <p className="ss-mono" data-testid="data-license" style={{ ...p, fontSize: 12, color: SS_TOKENS.fg0 }}>
        License:{" "}
        <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          ODbL 1.0
        </a>
        . Attribute SmokySignal, adsb.fi and adsb.lol. Contains information from adsb.lol, made available under
        the Open Database License. Share-alike: databases built from this one stay under ODbL.
      </p>
    </section>
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

/** Tables scroll inside their own box so the page never scrolls sideways. */
// Wide tables scroll sideways inside their card on phones; ScrollX adds
// the edge fade and the "scroll →" hint.
function Scroll({ children, minWidth }: { children: React.ReactNode; minWidth: number }) {
  return (
    <ScrollX
      label="Scrollable table"
      frameStyle={{ border: `.5px solid ${SS_TOKENS.hairline}`, borderRadius: 12 }}
    >
      <div style={{ minWidth }}>{children}</div>
    </ScrollX>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className="ss-mono"
      style={{
        textAlign: right ? "right" : "left",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: SS_TOKENS.fg2,
        padding: "10px 10px 8px",
        whiteSpace: "nowrap",
        background: SS_TOKENS.bg1,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, mono, right }: { children: React.ReactNode; mono?: boolean; right?: boolean }) {
  return (
    <td
      className={mono ? "ss-mono" : undefined}
      style={{
        padding: "9px 10px",
        textAlign: right ? "right" : "left",
        color: SS_TOKENS.fg0,
        fontSize: 12.5,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} style={{ padding: "14px 10px", fontSize: 12.5, color: SS_TOKENS.fg1 }}>
        Nothing logged yet.
      </td>
    </tr>
  );
}

const tableStyle = { width: "100%", borderCollapse: "collapse" } as const;
const rowStyle = { borderTop: `.5px solid ${SS_TOKENS.hairline}` } as const;
const linkStyle = { color: SS_TOKENS.fg0, textDecoration: "underline" } as const;
const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 999,
  background: SS_TOKENS.bg2,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  color: SS_TOKENS.fg0,
  fontSize: 12,
  textDecoration: "none",
  whiteSpace: "nowrap",
} as const;
