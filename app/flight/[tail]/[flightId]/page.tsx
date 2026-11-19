// Public, unauthenticated flight share page. /flight/[tail]/[flightId]
// renders the polyline + metadata for a single completed flight session.
// Lives OUTSIDE the (tabs) group on purpose — no bottom nav, no
// rider-screen chrome, social-friendly canonical URL.

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getRegistry } from "@/lib/registry";
import { fleetHex } from "@/lib/seed";
import { getFlightById, parseFlightId } from "@/lib/flights";
import { SS_TOKENS } from "@/lib/tokens";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { SaveFlightCardButton } from "@/components/SaveFlightCardButton";
import { BackLink } from "@/components/BackLink";
import FlightMapView from "@/components/FlightMapView";
import { fmtDurationHuman, formatTs } from "@/lib/time";
import { getTimeFormatPref, isHour12 } from "@/lib/user-prefs";
import { agencyName } from "@/lib/agencies";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbJsonLd, flightPageJsonLd } from "@/lib/seo/jsonld";
import { pageMeta } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

type Props = {
  params: { tail: string; flightId: string };
  searchParams?: { view?: string | string[] };
};

// One read per request for both metadata and the page.
const loadFlight = cache(async (tail: string, nickname: string | null, flightId: string) =>
  getFlightById(tail, nickname, flightId),
);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const tail = params.tail.toUpperCase();
  const fleet = await getRegistry();
  const entry = fleet.find((f) => f.tail === tail);
  const parsed = parseFlightId(params.flightId);
  if (!entry || !parsed) return { title: "Flight not found", robots: { index: false, follow: false } };
  const flight = await loadFlight(tail, entry.nickname, params.flightId);
  const niceName = entry.nickname ? ` "${entry.nickname}"` : "";
  const startMs = flight?.session.start_ts ?? parsed.tsMs;
  const when = `${formatTs(startMs, "date")} ${formatTs(startMs, "time")}`;
  return pageMeta({
    title: `${tail}${niceName} flight, ${when}`,
    description: `Recorded track of ${tail}${niceName}, a ${entry.model} flown by ${agencyName(entry.operator)}, on ${when}: route, altitude and time aloft from public ADS-B.`,
    path: `/flight/${tail}/${params.flightId}`,
    inheritImage: true,
    socialTitle: `${tail}${niceName} · Flight ${params.flightId}`,
    socialDescription: "Flight track captured by SmokySignal.",
    ogType: "article",
    // A pruned flight renders a "not available" note; keep it out of the
    // index. ?view=3d is the same flight.
    noindex: !flight || params.tail !== tail || Object.keys(searchParams ?? {}).length > 0,
  });
}

export default async function FlightSharePage({ params, searchParams }: Props) {
  const tail = params.tail.toUpperCase();
  const fleet = await getRegistry();
  const entry = fleet.find((f) => f.tail === tail);
  if (!entry) notFound();

  const parsed = parseFlightId(params.flightId);
  if (!parsed) notFound();

  const flight = await loadFlight(tail, entry.nickname, params.flightId);
  if (!flight) {
    return <Missing tail={tail} />;
  }

  const { session, points } = flight;
  const hour12 = isHour12(getTimeFormatPref());
  const rawView = searchParams?.view;
  const initialView = (Array.isArray(rawView) ? rawView[0] : rawView) === "3d" ? "3d" : "2d";

  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: "16px 18px 40px",
        maxWidth: 720,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        color: SS_TOKENS.fg0,
      }}
    >
      <JsonLd
        data={[
          flightPageJsonLd({
            entry,
            flightId: params.flightId,
            startMs: session.start_ts,
            endMs: session.end_ts,
            hex: fleetHex(entry),
          }),
          breadcrumbJsonLd([
            { name: "SmokySignal", path: "/" },
            { name: entry.tail, path: `/plane/${entry.tail}` },
            { name: `Flight ${params.flightId}`, path: `/flight/${entry.tail}/${params.flightId}` },
          ]),
        ]}
      />
      <BackLink href={`/plane/${entry.tail}`} label="Back to plane" />
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
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
          <div
            className="ss-mono"
            style={{
              fontSize: 12,
              color: SS_TOKENS.fg1,
              marginTop: 4,
              letterSpacing: ".04em",
            }}
          >
            {entry.operator} · {entry.model}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ShareLinkButton
            path={`/flight/${entry.tail}/${params.flightId}`}
            label="Copy share link"
          />
          <SaveFlightCardButton tail={entry.tail} flightId={params.flightId} />
        </div>
      </header>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 11px",
          borderRadius: 999,
          background: SS_TOKENS.alertDim,
          border: `.5px solid ${SS_TOKENS.alert}55`,
          color: SS_TOKENS.alert,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: ".04em",
          alignSelf: "flex-start",
        }}
      >
        Completed flight · {formatTs(session.start_ts, "date-short")} ·{" "}
        {fmtDurationHuman(session.duration_s)}
      </div>

      <FlightMapView
        tail={tail}
        points={points}
        initialView={initialView}
        hour12={hour12}
      />

      <section
        style={{
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline}`,
          borderRadius: 12,
          padding: "16px 18px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <KV label="FIRST SEEN" value={formatTs(session.start_ts, "datetime", { hour12 })} />
          <KV label="LAST SEEN" value={formatTs(session.end_ts, "datetime", { hour12 })} />
          <KV label="DURATION" value={fmtDurationHuman(session.duration_s)} />
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
            label="HEX"
            value={fleetHex(entry).toUpperCase()}
          />
        </div>
      </section>

      <footer
        className="ss-mono"
        style={{
          marginTop: 8,
          fontSize: 12,
          color: SS_TOKENS.fg1,
          letterSpacing: ".04em",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        Tracked by{" "}
        <Link
          href="/"
          style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
        >
          SmokySignal
        </Link>
        <br />
        <Link
          href="/"
          style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
        >
          View live tracker →
        </Link>
      </footer>
    </main>
  );
}

function Missing({ tail }: { tail: string }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        padding: 32,
        maxWidth: 480,
        margin: "0 auto",
        color: SS_TOKENS.fg1,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <h1
        style={{
          fontSize: 22,
          color: SS_TOKENS.fg0,
          fontWeight: 700,
          margin: 0,
        }}
      >
        Flight not available
      </h1>
      <p style={{ fontSize: 14, lineHeight: 1.5 }}>
        This flight is no longer in our window. We keep flight tracks for
        the most recent 30 days and prune older ones to keep storage
        light.
      </p>
      <Link
        href={`/plane/${tail}`}
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.alert,
          textDecoration: "underline",
        }}
      >
        See {tail}&rsquo;s recent activity →
      </Link>
    </main>
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
        style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".1em" }}
      >
        {label}
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 16,
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

