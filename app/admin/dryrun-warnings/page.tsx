// Admin viewer for the speed-warning DRY-RUN log (N1a). Reads the
// dryrun-warnings:{YYYYMMDD} list for the current UTC day and renders
// a compact table. Used to tune the trigger threshold before shipping
// any rider-facing warning surface (N1b).
//
// N1b retired the client beacon: the warning is computed on the device
// and nothing about speed or position is sent, so POST
// /api/dryrun-warnings answers 410 and this view only shows rows still
// inside their 7-day TTL.

import { getRedis } from "@/lib/cache";
import { isAdminAuthed, isAdminPasscodeConfigured } from "@/lib/admin-auth";
import { LoginForm } from "../LoginForm";
import { SS_TOKENS } from "@/lib/tokens";
import { toViewRow, type DryRunViewRow } from "@/lib/dryrun-payload";
import { dryrunWarningsKey } from "@/lib/storage-keys";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "SmokySignal · Admin · Dry-run warnings",
  robots: { index: false, follow: false },
};

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parse(raw: unknown): DryRunViewRow | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return toViewRow(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return toViewRow(raw);
}

async function fetchToday(): Promise<DryRunViewRow[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const key = dryrunWarningsKey(utcDateKey(new Date()));
  try {
    const raw = (await redis.lrange(key, 0, -1)) as unknown[];
    return raw.map(parse).filter((r): r is DryRunViewRow => r !== null);
  } catch {
    return [];
  }
}

export default async function DryRunPage() {
  if (!isAdminPasscodeConfigured()) {
    return <Missing />;
  }
  if (!isAdminAuthed()) {
    return <LoginForm next="/admin/dryrun-warnings" />;
  }

  const records = await fetchToday();
  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "24px 18px 80px",
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
          Admin · N1a dry-run
        </div>
        <h1
          className="ss-mono"
          style={{
            fontSize: 18,
            color: SS_TOKENS.fg0,
            letterSpacing: ".04em",
            margin: 0,
          }}
        >
          Speed-warning candidates · today (UTC)
        </h1>
        <p style={{ color: SS_TOKENS.fg1, fontSize: 13, marginTop: 8 }}>
          Logged when a rider was over the limit, in a hot zone, and a
          tracked bird was within 5 nm. No rider-facing surface yet —
          this is the data we&rsquo;ll tune the threshold against.
        </p>
        <p style={{ color: SS_TOKENS.fg2, fontSize: 12, marginTop: 6 }}>
          Records hold only coarse buckets: over-limit band, hot-zone
          cell, tail, and distance to 0.5 nm. Rider speed and position
          are not stored. Rows marked legacy predate this format and are
          shown bucketed.
        </p>
      </header>

      {records.length === 0 ? (
        <div
          style={{
            padding: "40px 18px",
            background: SS_TOKENS.bg1,
            border: `.5px solid ${SS_TOKENS.hairline}`,
            borderRadius: 12,
            textAlign: "center",
            color: SS_TOKENS.fg2,
            fontSize: 13,
          }}
        >
          No dry-run candidates today yet.
        </div>
      ) : (
        <Table records={records} />
      )}
    </main>
  );
}

function Table({ records }: { records: DryRunViewRow[] }) {
  return (
    <div
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <table
        className="ss-mono"
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          color: SS_TOKENS.fg1,
        }}
      >
        <thead style={{ background: SS_TOKENS.bg2 }}>
          <tr>
            <Th>UTC time</Th>
            <Th align="right">Over by (mph)</Th>
            <Th>Zone cell</Th>
            <Th align="right">Bird nm</Th>
            <Th>Tail</Th>
            <Th>Format</Th>
          </tr>
        </thead>
        <tbody>
          {records
            .slice()
            .reverse()
            .map((r, i) => (
              <tr
                key={i}
                style={{ borderTop: `.5px solid ${SS_TOKENS.hairline}` }}
              >
                <Td>
                  {new Date(r.ts)
                    .toISOString()
                    .slice(11, 19)}
                </Td>
                <Td align="right">{r.overLimitBy ?? "—"}</Td>
                <Td>{r.nearestZoneId ?? "—"}</Td>
                <Td align="right">
                  {r.nearestBirdNm == null ? "—" : r.nearestBirdNm.toFixed(1)}
                </Td>
                <Td>{r.nearestTail ?? "—"}</Td>
                <Td>{r.legacy ? "legacy" : "v2"}</Td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      style={{
        padding: "10px 12px",
        textAlign: align ?? "left",
        color: SS_TOKENS.fg2,
        fontWeight: 600,
        letterSpacing: ".04em",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        textAlign: align ?? "left",
        color: SS_TOKENS.fg0,
      }}
    >
      {children}
    </td>
  );
}

function Missing() {
  return (
    <div style={{ padding: 24, color: SS_TOKENS.fg1 }}>
      ADMIN_PASSCODE not set in this environment.
    </div>
  );
}
