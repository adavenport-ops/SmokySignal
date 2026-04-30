import Link from "next/link";
import { notFound } from "next/navigation";
import { FLEET, fleetHex } from "@/lib/seed";
import { getSnapshot } from "@/lib/snapshot";
import { SS_TOKENS } from "@/lib/tokens";
import { StatusPill } from "@/components/StatusPill";
import { fmtAgo, fmtAloft } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: { tail: string } };

export async function generateMetadata({ params }: Props) {
  const tail = params.tail.toUpperCase();
  return {
    title: `SmokySignal · ${tail}`,
  };
}

export default async function PlanePage({ params }: Props) {
  const tail = params.tail.toUpperCase();
  const entry = FLEET.find((f) => f.tail === tail);
  if (!entry) notFound();

  const snap = await getSnapshot();
  const live = snap.aircraft.find((a) => a.tail === tail);
  const up = Boolean(live?.airborne);

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "12px 18px 60px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 460,
        margin: "0 auto",
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
        <span className="ss-eyebrow">SmokySignal · Aircraft</span>
        <Link
          href="/radar"
          className="ss-mono"
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg1,
            textDecoration: "none",
          }}
        >
          ← Back
        </Link>
      </header>

      <section>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span
            className="ss-mono"
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: SS_TOKENS.fg0,
              letterSpacing: "-.02em",
            }}
          >
            {entry.tail}
          </span>
          {entry.nickname && (
            <span
              style={{
                fontSize: 14,
                color: SS_TOKENS.fg1,
                fontStyle: "italic",
              }}
            >
              &ldquo;{entry.nickname}&rdquo;
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: SS_TOKENS.fg2, marginTop: 4 }}>
          {entry.operator} · {entry.model} · {entry.role}
        </div>
        <div style={{ fontSize: 11, color: SS_TOKENS.fg3, marginTop: 4 }}>
          <span className="ss-mono">{fleetHex(entry).toUpperCase()}</span>
          {" · "}
          {entry.base}
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
      </section>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          borderRadius: 14,
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline}`,
        }}
      >
        <div className="ss-eyebrow" style={{ marginBottom: 8 }}>
          Aircraft detail
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.55,
            color: SS_TOKENS.fg1,
          }}
        >
          Detail screen coming soon — orbit glyph, live data block, typical
          haunts, and notify toggle land in the next iteration.
        </p>
      </section>
    </main>
  );
}
