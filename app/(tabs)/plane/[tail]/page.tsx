import { notFound } from "next/navigation";
import nextDynamic from "next/dynamic";
import { fleetHex } from "@/lib/seed";
import { getRegistry } from "@/lib/registry";
import { getSnapshot } from "@/lib/snapshot";
import { applyMockState, parseMockState } from "@/lib/mock-state";
import { getMostRecentFlightForTail, flightIdFromTs } from "@/lib/flights";
import { SS_TOKENS } from "@/lib/tokens";
import { StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/Card";
import { fmtAgo, fmtAgoTs, fmtAloft, formatTs } from "@/lib/time";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import type { Aircraft } from "@/lib/types";
import type { RecentFlightForTail } from "@/lib/flights";
import type { TrackPoint } from "@/lib/tracks";
import { BackLink } from "@/components/BackLink";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { FlightIntel } from "@/components/FlightIntel";
import { Logbook } from "@/components/Logbook";
import { Tooltip } from "@/components/Tooltip";
import {
  confidenceBadgeStyle,
  confidenceLabel,
  isAlertMission,
  missionLabel,
  policeUnitLabel,
  roleBadgeStyle,
  roleBadgeText,
  roleTooltip,
  sourceLabel,
} from "@/lib/role-display";
import type { FleetEntry } from "@/lib/types";
import type { Metadata } from "next";
import { agencyName } from "@/lib/agencies";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, planePageJsonLd } from "@/lib/seo/jsonld";
import { pageMeta } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const PlaneTrackMap = nextDynamic(() => import("@/components/PlaneTrackMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 280,
        background: SS_TOKENS.bg0,
        borderRadius: 12,
      }}
    />
  ),
});

const PerPlaneHeatLayer = nextDynamic(
  () => import("@/components/PerPlaneHeatLayer"),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: 220, background: SS_TOKENS.bg0 }} />
    ),
  },
);

// Flight history (period presets + custom range) on a 2D map.
const PlaneHistory = nextDynamic(() => import("@/components/PlaneHistory"), {
  ssr: false,
  loading: () => <div style={{ height: 440, background: SS_TOKENS.bg0 }} />,
});

type Props = {
  params: { tail: string };
  searchParams: { mock?: string };
};

// Title budget leaves room for the " · SmokySignal" template suffix.
const TITLE_BUDGET = 65 - " · SmokySignal".length;
const DESC_BUDGET = 160;

/** First candidate that fits the budget, else the last one. */
function fit(budget: number, candidates: string[]): string {
  return candidates.find((c) => c.length <= budget) ?? candidates[candidates.length - 1]!;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const tail = params.tail.toUpperCase();
  const entry = (await getRegistry()).find((f) => f.tail === tail);
  if (!entry) return { title: "Unknown tail", robots: { index: false, follow: false } };
  const agency = agencyName(entry.operator);
  const nick = entry.nickname ? ` "${entry.nickname}"` : "";
  const model = entry.model.replace(/\s*\(.*\)\s*$/, "");
  return pageMeta({
    // Short form for the title (operator code, model without the
    // parenthetical); the description carries the full names. Each takes
    // the longest variant that fits.
    title: fit(TITLE_BUDGET, [
      `${entry.tail}${nick}: ${entry.operator} ${model}`,
      `${entry.tail}: ${entry.operator} ${model}`,
      `${entry.tail}: ${entry.operator} ${model.split(" ").slice(0, 2).join(" ")}`,
    ]),
    description: fit(DESC_BUDGET, [
      `Is ${entry.tail} flying now? Live status, recent flights and a 30-day map for ${entry.tail}${nick}, a ${entry.model} flown by ${agency} from ${entry.base}.`,
      `Is ${entry.tail} flying now? Live status, recent flights and a 30-day map for ${entry.tail}, a ${model} flown by ${agency} from ${entry.base}.`,
      `Live status and recent flights for ${entry.tail}, a ${model} flown by ${agency} from ${entry.base}.`,
      `Live status and recent flights for ${entry.tail}, a ${model} flown by ${agency}.`,
    ]),
    path: `/plane/${entry.tail}`,
    // Lowercase tails and ?mock= states are the same page.
    noindex: params.tail !== entry.tail || Object.keys(searchParams ?? {}).length > 0,
  });
}

export default async function PlanePage({ params, searchParams }: Props) {
  const tail = params.tail.toUpperCase();

  const [fleet, real] = await Promise.all([getRegistry(), getSnapshot()]);
  const entry = fleet.find((f) => f.tail === tail);
  if (!entry) notFound();
  const recentFlight = await getMostRecentFlightForTail(tail, entry.nickname);
  const snap = applyMockState(real, parseMockState(searchParams.mock));

  const live = snap.aircraft.find((a) => a.tail === tail);
  const up = Boolean(live?.airborne);
  const updatedSec = Math.max(0, Math.floor((Date.now() - snap.fetched_at) / 1000));
  const hour12 = isHour12(getTimeFormatPref());

  return (
    <main
      style={{
        minHeight: "100dvh",
        maxWidth: 460,
        margin: "0 auto",
        // 180 px bottom clears tab bar + iOS install prompt overlay.
        padding: "12px 18px 180px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <BackLink href="/flights" label="Flights" />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a
            href="#flight-history"
            className="ss-mono"
            data-testid="flight-history-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              padding: "0 4px",
              fontSize: 12,
              color: SS_TOKENS.fg1,
              textDecoration: "underline",
              whiteSpace: "nowrap",
            }}
          >
            Flight history ↓
          </a>
          {recentFlight && (
            <ShareLinkButton
              path={`/flight/${entry.tail}/${flightIdFromTs(recentFlight.session.start_ts)}`}
              label="Share flight"
              size="sm"
            />
          )}
        </div>
      </div>

      <JsonLd
        data={[
          planePageJsonLd(entry, fleetHex(entry)),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: "All aircraft", path: "/aircraft" },
            { name: entry.tail, path: `/plane/${entry.tail}` },
          ]),
        ]}
      />
      <header>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1
            className="ss-mono"
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: SS_TOKENS.fg0,
              letterSpacing: "-.02em",
              margin: 0,
              lineHeight: "inherit",
            }}
          >
            {entry.tail}
          </h1>
          {entry.nickname && (
            <span style={{ fontSize: 14, color: SS_TOKENS.fg1, fontStyle: "italic" }}>
              &ldquo;{entry.nickname}&rdquo;
            </span>
          )}
        </div>
        <div
          className="ss-mono"
          style={{ fontSize: 12, color: SS_TOKENS.fg2, marginTop: 6, letterSpacing: ".04em" }}
        >
          {entry.operator} · {entry.model} · {entry.base}
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <StatusPill
            kind={up && isAlertMission(entry.role) ? "alert" : "clear"}
            label={up ? (isAlertMission(entry.role) ? "AIRBORNE · WATCHING" : "AIRBORNE") : "GROUNDED"}
            sub={
              up
                ? fmtAloft(live?.time_aloft_min)
                : recentFlight
                  ? `Last flew ${fmtAgoTs(recentFlight.session.end_ts)}`
                  : live?.last_seen_min != null
                    ? `Last contact ${fmtAgo(live.last_seen_min)}`
                    : "No recent contact"
            }
            big
            tooltip={
              up
                ? "Live state from latest ADS-B observation."
                : "Some helicopters fly with intermittent transponder coverage; 'last contact' (most recent ADS-B trace) isn't always 'last flew' (most recent completed flight session)."
            }
          />
          <Tooltip content={roleTooltip(entry.role)}>
            <span tabIndex={0} className="ss-mono" style={roleBadgeStyle(entry.role)}>
              {roleBadgeText(entry.role)}
            </span>
          </Tooltip>
          <Tooltip
            content={
              entry.roleConfidence === "confirmed"
                ? "Confirmed. The FAA owner record and an agency source agree."
                : "Tentative. One source only, or the callsign-to-tail link is inferred. May be refined."
            }
          >
            <span
              tabIndex={0}
              className="ss-mono"
              data-confidence={entry.roleConfidence}
              style={confidenceBadgeStyle(entry.roleConfidence)}
            >
              {confidenceLabel(entry.roleConfidence)}
            </span>
          </Tooltip>
        </div>
      </header>

      <ClassificationCard entry={entry} />

      <section>
        {up && live ? (
          <LiveDataBlock live={live} updatedSec={updatedSec} />
        ) : (
          <GroundedNote live={live} />
        )}
      </section>

      <section>
        <h2 className="ss-eyebrow" style={{ margin: "0 0 8px", fontWeight: "inherit" }}>
          {recentFlight && !up ? "Last flight" : "Recent track"}
        </h2>
        <RecentTrackBlock
          tail={entry.tail}
          flight={recentFlight}
          live={live ?? null}
          isAirborne={up}
          hour12={hour12}
        />
      </section>

      <section>
        <Card padded={false}>
          <div style={{ padding: "12px 14px 8px" }}>
            <h2 className="ss-eyebrow" style={{ margin: 0, fontWeight: "inherit" }}>Where this plane patrols</h2>
            <div
              style={{
                fontSize: 12,
                color: SS_TOKENS.fg2,
                marginTop: 2,
              }}
            >
              30-day heatmap of recorded positions
            </div>
          </div>
          <PerPlaneHeatLayer tail={entry.tail} />
        </Card>
      </section>

      <Logbook tail={entry.tail} nickname={entry.nickname} hour12={hour12} />

      {/* Flight history: kept as its own block (see components/PlaneHistory.tsx). */}
      <section id="flight-history" aria-label="Flight history" data-testid="flight-history-section">
        <Card padded={false}>
          <div style={{ padding: "12px 14px 10px" }}>
            <h2 className="ss-eyebrow" style={{ margin: 0, fontWeight: "inherit" }}>Flight history</h2>
            <div style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 2 }}>
              Every flight on record for a period. Pacific dates.
            </div>
          </div>
          <PlaneHistory tail={entry.tail} />
        </Card>
      </section>

      <FleetMeta tail={entry.tail} hex={fleetHex(entry).toUpperCase()} role={entry.roleDescription} />
    </main>
  );
}

function LiveDataBlock({
  live,
  updatedSec,
}: {
  live: Aircraft;
  updatedSec: number;
}) {
  return (
    <Card>
      <div className="ss-eyebrow" style={{ marginBottom: 10 }}>
        Currently
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <KV
          label="ALT"
          value={live.altitude_ft != null ? `${live.altitude_ft.toLocaleString()}′` : "—"}
          tooltip="Pressure altitude in feet, from the aircraft's transponder."
        />
        <KV
          label="GS"
          value={live.ground_speed_kt != null ? `${live.ground_speed_kt} kt` : "—"}
          tooltip="Ground speed in knots. 1 kt ≈ 1.15 mph."
        />
        <KV
          label="HDG"
          value={live.heading != null ? `${Math.round(live.heading)}°` : "—"}
          tooltip="Heading in degrees magnetic. 0° = north, 90° = east."
        />
        <SquawkKV squawk={live.squawk ?? null} />
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg2,
          marginTop: 12,
          letterSpacing: ".04em",
        }}
      >
        Updated {updatedSec}s ago
      </div>
    </Card>
  );
}

function GroundedNote({ live }: { live: Aircraft | undefined }) {
  const lastSeen = live?.last_seen_min;
  return (
    <Card>
      <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
        Currently
      </div>
      <div style={{ fontSize: 14, color: SS_TOKENS.fg1 }}>
        {lastSeen != null ? (
          <>
            On the ground. Last position broadcast{" "}
            <span className="ss-mono" style={{ color: SS_TOKENS.fg0 }}>
              {fmtAgo(lastSeen)}
            </span>{" "}
            back.
          </>
        ) : (
          "On the ground. Awaiting next position broadcast."
        )}
      </div>
    </Card>
  );
}

function KV({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  tooltip?: React.ReactNode;
}) {
  const card = (
    <div
      tabIndex={tooltip ? 0 : undefined}
      style={{
        background: SS_TOKENS.bg2,
        padding: "10px 12px",
        borderRadius: 8,
        cursor: tooltip ? "help" : "default",
      }}
    >
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg2,
          letterSpacing: ".1em",
        }}
      >
        {label}
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: SS_TOKENS.fg0,
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
  if (!tooltip) return card;
  return <Tooltip content={tooltip}>{card}</Tooltip>;
}

function SquawkKV({ squawk }: { squawk: string | null }) {
  let color: string = SS_TOKENS.fg0;
  const value = squawk ?? "—";
  let alertNote: string | null = null;
  if (!squawk) {
    // fg2 not fg3 — fg3 fails WCAG AA on bg-0 for body text. Same
    // fix pattern as the FleetMeta footer (PR #13).
    color = SS_TOKENS.fg2;
  } else if (squawk === "7700" || squawk === "7500") {
    color = SS_TOKENS.danger;
    alertNote = squawk === "7700" ? "EMERGENCY" : "HIJACK";
  } else if (squawk === "7600") {
    color = SS_TOKENS.warn;
    alertNote = "COMMS";
  }
  return (
    <Tooltip content="4-digit transponder code. 1200 = VFR. 7500 = hijack, 7600 = radio failure, 7700 = general emergency.">
    <div
      tabIndex={0}
      style={{
        background: SS_TOKENS.bg2,
        padding: "10px 12px",
        borderRadius: 8,
        cursor: "help",
      }}
    >
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg2,
          letterSpacing: ".1em",
        }}
      >
        SQUAWK
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 18,
          fontWeight: 600,
          color,
          marginTop: 3,
        }}
      >
        {value}
      </div>
      {alertNote && (
        <div
          className="ss-mono"
          style={{
            fontSize: 12,
            color,
            marginTop: 2,
            letterSpacing: ".1em",
          }}
        >
          {alertNote}
        </div>
      )}
    </div>
    </Tooltip>
  );
}

function RecentTrackBlock({
  tail,
  flight,
  live,
  isAirborne,
  hour12,
}: {
  tail: string;
  flight: RecentFlightForTail | null;
  live: Aircraft | null;
  isAirborne: boolean;
  hour12: boolean;
}) {
  // Mount the map whenever there's anything to render — historical
  // session OR a currently-airborne tail with a live position. The
  // live-polling inside PlaneTrackMap fills in the polyline as new
  // /api/trails samples arrive (every 10 s); without this the map
  // stays a blank "No flight history yet" card for the first few
  // minutes after takeoff before the session has accumulated 2+
  // samples.
  const hasHistory = !!flight && flight.points.length >= 2;
  const hasLivePosition =
    isAirborne && typeof live?.lat === "number" && typeof live?.lon === "number";
  if (!hasHistory && !hasLivePosition) {
    return (
      <Card>
        <div
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg2,
            textAlign: "center",
            padding: "16px 8px",
            lineHeight: 1.45,
          }}
        >
          No flight history yet. Once {tail} goes up, the track shows up
          here.
        </div>
      </Card>
    );
  }

  // When the historical session is empty but the tail is live, seed the
  // map with the single current position so it renders centered while
  // the trail polls fill in.
  const seedPoints: TrackPoint[] = hasHistory
    ? flight!.points
    : hasLivePosition
      ? [
          {
            lat: live!.lat as number,
            lon: live!.lon as number,
            alt: live!.altitude_ft ?? null,
            spd: live!.ground_speed_kt ?? null,
            trk: live!.heading ?? null,
            ts: Math.floor(Date.now() / 1000),
          },
        ]
      : [];
  const inProgress = isAirborne || (flight?.inProgress ?? false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <PlaneTrackMap tail={tail} points={seedPoints} inProgress={inProgress} />
      {hasHistory && flight && <RecentTrackStats flight={flight} hour12={hour12} />}
      {hasHistory && flight && (
        <FlightIntel points={flight.points} inProgress={flight.inProgress} />
      )}
    </div>
  );
}

function RecentTrackStats({
  flight,
  hour12,
}: {
  flight: RecentFlightForTail;
  hour12: boolean;
}) {
  const { session, inProgress } = flight;
  return (
    <>
      <Card>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <KV label="FIRST" value={formatTs(session.start_ts, "datetime", { hour12 })} />
          <KV
            label={inProgress ? "NOW" : "LAST"}
            value={formatTs(session.end_ts, "datetime", { hour12 })}
          />
          <KV label="DURATION" value={fmtSessionDuration(session.duration_s)} />
          <KV label="SAMPLES" value={String(session.sample_count)} />
          <KV
            label="MAX ALT"
            value={
              session.max_alt_ft > 0
                ? `${session.max_alt_ft.toLocaleString()}′`
                : "—"
            }
          />
          <KV
            label="STATUS"
            value={inProgress ? "IN PROGRESS" : fmtAgoTs(session.end_ts)}
          />
        </div>
        <div
          style={{
            fontSize: 12,
            color: SS_TOKENS.fg2,
            marginTop: 12,
            lineHeight: 1.45,
          }}
        >
          Tap map to interact · pinch to zoom.
        </div>
      </Card>
    </>
  );
}

// "3h 12m" / "47m" — keeps the human-readable session-duration format
// for the FIRST/LAST/DURATION KV row.
function fmtSessionDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// Mission, unit, confidence and sources for this tail. Sources come from
// the registry research (FAA registry first, then agency or press pages).
function ClassificationCard({ entry }: { entry: FleetEntry }) {
  const unit = policeUnitLabel(entry.policeUnit);
  const rows: Array<[string, string]> = [["MISSION", missionLabel(entry.role)]];
  if (unit) rows.push(["UNIT", unit]);
  if (entry.secondaryMission) rows.push(["ALSO FLIES", missionLabel(entry.secondaryMission)]);
  rows.push(["BASED", entry.scope === "mutual_aid" ? "Out of state, mutual aid" : "Washington"]);
  rows.push(["CONFIDENCE", confidenceLabel(entry.roleConfidence)]);
  return (
    <section aria-label="Classification" data-testid="classification">
      <Card>
        <div className="ss-eyebrow" style={{ marginBottom: 10 }}>
          Classification
        </div>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "6px 14px",
            margin: 0,
          }}
        >
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg2, letterSpacing: ".08em" }}>
                {k}
              </dt>
              <dd className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg0, margin: 0 }}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {entry.roleNote && (
          <p style={{ fontSize: 12, color: SS_TOKENS.fg1, margin: "10px 0 0", lineHeight: 1.45 }}>
            {entry.roleNote}
          </p>
        )}
        <div className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg2, letterSpacing: ".08em", marginTop: 12 }}>
          SOURCES
        </div>
        {entry.sources.length === 0 ? (
          <p style={{ fontSize: 12, color: SS_TOKENS.fg2, margin: "4px 0 0" }}>
            None on file yet.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0", display: "flex", flexDirection: "column", gap: 2 }}>
            {entry.sources.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ss-mono"
                  style={{
                    fontSize: 12,
                    color: SS_TOKENS.fg1,
                    textDecoration: "underline",
                    display: "inline-flex",
                    minHeight: 28,
                    alignItems: "center",
                  }}
                >
                  {sourceLabel(url)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function FleetMeta({
  tail,
  hex,
  role,
}: {
  tail: string;
  hex: string;
  role: string;
}) {
  return (
    <div
      className="ss-mono"
      style={{
        fontSize: 12,
        // fg2 instead of fg3 — fg3 (#3f4651) fails WCAG AA 4.5:1 against
        // bg-0 for body text. fg2 reads at ~5.2:1.
        color: SS_TOKENS.fg2,
        letterSpacing: ".06em",
        textAlign: "center",
        marginTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "center",
      }}
    >
      <div>
        <Tooltip content="ICAO24 Mode-S code — the unique aircraft identifier broadcast over ADS-B. Used to filter the live feed.">
          <span tabIndex={0} style={{ cursor: "help" }}>
            {hex}
          </span>
        </Tooltip>
        {" · "}
        {role.toUpperCase()}
      </div>
      <a
        href={`https://registry.faa.gov/aircraftinquiry/Search/NNumberResult?nNumberTxt=${tail}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: SS_TOKENS.fg2, textDecoration: "none" }}
      >
        FAA registry →
      </a>
    </div>
  );
}
