import { notFound } from "next/navigation";
import nextDynamic from "next/dynamic";
import { fleetHex } from "@/lib/seed";
import { getRegistry } from "@/lib/registry";
import { getSnapshot } from "@/lib/snapshot";
import { mockAirborneSnapshot } from "@/lib/mock";
import { getMostRecentFlightForTail } from "@/lib/flights";
import { SS_TOKENS } from "@/lib/tokens";
import { StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/Card";
import { fmtAgo, fmtAloft } from "@/lib/format";
import type { Aircraft } from "@/lib/types";
import type { RecentFlightForTail } from "@/lib/flights";
import { BackLink } from "@/components/BackLink";

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

type Props = {
  params: { tail: string };
  searchParams: { mock?: string };
};

export async function generateMetadata({ params }: Props) {
  return { title: `SmokySignal · ${params.tail.toUpperCase()}` };
}

export default async function PlanePage({ params, searchParams }: Props) {
  const tail = params.tail.toUpperCase();

  const [fleet, real] = await Promise.all([getRegistry(), getSnapshot()]);
  const entry = fleet.find((f) => f.tail === tail);
  if (!entry) notFound();
  const recentFlight = await getMostRecentFlightForTail(tail, entry.nickname);
  const snap = searchParams.mock === "up" ? mockAirborneSnapshot(real) : real;

  const live = snap.aircraft.find((a) => a.tail === tail);
  const up = Boolean(live?.airborne);
  const updatedSec = Math.max(0, Math.floor((Date.now() - snap.fetched_at) / 1000));

  return (
    <main
      style={{
        minHeight: "100dvh",
        maxWidth: 460,
        margin: "0 auto",
        padding: "12px 18px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <BackLink />

      <header>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span
            className="ss-mono"
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: SS_TOKENS.fg0,
              letterSpacing: "-.02em",
            }}
          >
            {entry.tail}
          </span>
          {entry.nickname && (
            <span style={{ fontSize: 14, color: SS_TOKENS.fg1, fontStyle: "italic" }}>
              &ldquo;{entry.nickname}&rdquo;
            </span>
          )}
        </div>
        <div
          className="ss-mono"
          style={{ fontSize: 11, color: SS_TOKENS.fg2, marginTop: 6, letterSpacing: ".04em" }}
        >
          {entry.operator} · {entry.model} · {entry.base}
        </div>
        <div style={{ marginTop: 12 }}>
          <StatusPill
            kind={up ? "alert" : "clear"}
            label={up ? "AIRBORNE · WATCHING" : "GROUNDED"}
            sub={
              up
                ? fmtAloft(live?.time_aloft_min)
                : `last seen ${fmtAgo(live?.last_seen_min)}`
            }
            big
          />
        </div>
      </header>

      <section>
        {up && live ? (
          <LiveDataBlock live={live} updatedSec={updatedSec} />
        ) : (
          <GroundedNote live={live} />
        )}
      </section>

      <section>
        <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
          Recent track
        </div>
        <RecentTrackBlock tail={entry.tail} flight={recentFlight} />
      </section>

      <FleetMeta hex={fleetHex(entry).toUpperCase()} role={entry.role} />
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
        />
        <KV
          label="GS"
          value={live.ground_speed_kt != null ? `${live.ground_speed_kt} kt` : "—"}
        />
        <KV
          label="HDG"
          value={live.heading != null ? `${Math.round(live.heading)}°` : "—"}
        />
        <SquawkKV squawk={live.squawk ?? null} />
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 11,
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
  return (
    <Card>
      <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
        Currently
      </div>
      <div style={{ fontSize: 14, color: SS_TOKENS.fg1 }}>
        On the ground · last seen{" "}
        <span className="ss-mono" style={{ color: SS_TOKENS.fg0 }}>
          {fmtAgo(live?.last_seen_min)}
        </span>
      </div>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: SS_TOKENS.bg2,
        padding: "10px 12px",
        borderRadius: 8,
      }}
    >
      <div
        className="ss-mono"
        style={{
          fontSize: 9.5,
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
}

function SquawkKV({ squawk }: { squawk: string | null }) {
  let color: string = SS_TOKENS.fg0;
  const value = squawk ?? "—";
  let alertNote: string | null = null;
  if (!squawk) {
    color = SS_TOKENS.fg3;
  } else if (squawk === "7700" || squawk === "7500") {
    color = SS_TOKENS.danger;
    alertNote = squawk === "7700" ? "EMERGENCY" : "HIJACK";
  } else if (squawk === "7600") {
    color = SS_TOKENS.warn;
    alertNote = "COMMS";
  }
  return (
    <div
      style={{
        background: SS_TOKENS.bg2,
        padding: "10px 12px",
        borderRadius: 8,
      }}
    >
      <div
        className="ss-mono"
        style={{
          fontSize: 9.5,
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
            fontSize: 9,
            color,
            marginTop: 2,
            letterSpacing: ".1em",
          }}
        >
          {alertNote}
        </div>
      )}
    </div>
  );
}

function RecentTrackBlock({
  tail,
  flight,
}: {
  tail: string;
  flight: RecentFlightForTail | null;
}) {
  if (!flight || flight.points.length < 2) {
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
          No flight history yet. Once {tail} flies, the track will appear
          here.
        </div>
      </Card>
    );
  }

  const { session, points, inProgress } = flight;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <PlaneTrackMap points={points} inProgress={inProgress} />
      <Card>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <KV label="FIRST" value={fmtClock(session.start_ts)} />
          <KV
            label={inProgress ? "NOW" : "LAST"}
            value={fmtClock(session.end_ts)}
          />
          <KV label="DURATION" value={fmtDuration(session.duration_s)} />
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
            value={inProgress ? "IN PROGRESS" : fmtRelativeShort(session.end_ts)}
          />
        </div>
        <div
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg2,
            marginTop: 12,
            lineHeight: 1.45,
          }}
        >
          Tap map to interact · pinch to zoom.
        </div>
      </Card>
    </div>
  );
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0
    ? `${h}h ${String(m).padStart(2, "0")}m`
    : `${m}m`;
}

function fmtRelativeShort(tsMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function FleetMeta({ hex, role }: { hex: string; role: string }) {
  return (
    <div
      className="ss-mono"
      style={{
        fontSize: 10.5,
        color: SS_TOKENS.fg3,
        letterSpacing: ".06em",
        textAlign: "center",
        marginTop: 8,
      }}
    >
      {hex} · {role.toUpperCase()}
    </div>
  );
}
