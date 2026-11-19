// Flight card: a 1200x1500 PNG per flight for saving or sharing.
// GET /flight/[tail]/[flightId]/card
//
// Track silhouette (SVG path fitted to the bounds, lib/flight-card.ts),
// altitude sparkline, departure → arrival, duration, peak altitude,
// pattern time and the tail's identity. Times are 24-hour Pacific.
//
// Cache: a finished flight never changes, so the card is cached for a
// year. A flight still in progress gets a one-minute window.

import { ImageResponse } from "next/og";
import { airportById } from "@/lib/airports";
import { flightDetailFromPoints } from "@/lib/flight-detail";
import { altitudeSparkline, cardRoute, projectTrack, subPath } from "@/lib/flight-card";
import { SESSION_GAP_MS, getFlightById } from "@/lib/flights";
import { loadGoogleFont, type OgFont } from "@/lib/og/status-card";
import { detectOrbits } from "@/lib/orbit";
import { getRegistry } from "@/lib/registry";
import { missionLabel, policeUnitLabel } from "@/lib/role-display";
import { formatTs, formatTsBare, fmtDurationHuman } from "@/lib/time";
import { SS_TOKENS } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const W = 1200;
const H = 1500;
const PAD = 64;
const MAP = { width: W - 2 * PAD, height: 540 };
const LEGEND_H = 52;
const SPARK = { width: W - 2 * PAD, height: 120 };

const FINISHED_CACHE = "public, max-age=31536000, s-maxage=31536000, immutable";
const LIVE_CACHE = "public, max-age=60, s-maxage=60";

type Params = { params: { tail: string; flightId: string } };

export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const tail = params.tail.toUpperCase();
  const fleet = await getRegistry();
  const entry = fleet.find((f) => f.tail === tail);
  if (!entry) return notFound();
  const flight = await getFlightById(tail, entry.nickname, params.flightId);
  if (!flight || flight.points.length < 2) return notFound();

  const { session, points } = flight;
  const inProgress = Date.now() - session.end_ts < SESSION_GAP_MS;
  const detail = flightDetailFromPoints(points, inProgress);
  const orbits = detectOrbits(points);
  const geom = projectTrack(points, { ...MAP, pad: 48 });
  const orbitPaths = orbits.map((o) => subPath(geom, o.startTs, o.endTs)).filter(Boolean);
  const spark = altitudeSparkline(points, { ...SPARK, pad: 6 });

  const mission = missionLabel(entry.role).toUpperCase();
  const unit = policeUnitLabel(entry.policeUnit);
  const idLine = [mission, unit !== entry.operator ? unit : null, entry.operator, entry.model]
    .filter(Boolean)
    .join(" · ");
  const dep = detail.dep;
  const arr = inProgress ? null : detail.arr;
  const { codes: route, names: routeNames } = cardRoute({
    dep,
    arr,
    inProgress,
    nameOf: (id) => airportById(id)?.name ?? null,
  });
  const when = `${formatTs(session.start_ts, "date")} ${formatTsBare(session.start_ts, "time")} to ${formatTsBare(session.end_ts, "time")} PT`;
  const duration = fmtDurationHuman(session.duration_s);
  const maxAlt = session.max_alt_ft > 0 ? `${session.max_alt_ft.toLocaleString("en-US")} ft` : "—";
  const orbitMin = Math.round(detail.orbit_s / 60);
  const patterns = orbits.length > 0 ? `${orbitMin} min` : "None";
  const patternSub = orbits.length > 0 ? `${orbits.length} pattern${orbits.length === 1 ? "" : "s"}` : "no orbits flown";
  const corridor = detail.corridors[0]?.label ?? (orbits.length > 0 ? "Off the named roads" : "No patterns");
  const status = inProgress ? `IN PROGRESS · AS OF ${formatTsBare(session.end_ts, "time")} PT` : "COMPLETED FLIGHT";
  const url = `smokysignal.app/flight/${tail}/${params.flightId}`;

  const sansText = `SMOKYSIGNAL · FLIGHT CARD ${entry.nickname ?? ""} ${routeNames} ${idLine} ${patternSub} ${corridor}`;
  const monoText = `${tail}${route}${when}${duration}${maxAlt}${patterns}${corridor}${status}${url}DURATIONMAX ALTON STATIONWORKEDALTITUDEROUTETAKEOFFLANDINGLAST FIXPATTERNN↑0123456789`;
  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 700, uniqueChars(sansText)),
    loadGoogleFont("JetBrains Mono", 600, uniqueChars(monoText)),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 700, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
  // Satori needs a family name on every styled run; without the web
  // fonts it falls back to its built-in sans.
  const sans = inter ? "Inter" : "sans-serif";
  const monoF = mono ? "JetBrains Mono" : sans;

  const label = (text: string) => (
    <span style={{ fontFamily: monoF, fontSize: 19, letterSpacing: 3, color: SS_TOKENS.fg2 }}>{text}</span>
  );
  const stat = (k: string, v: string, sub?: string) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        flex: 1,
        background: SS_TOKENS.bg2,
        borderRadius: 14,
        padding: "16px 20px",
        minWidth: 0,
      }}
    >
      {label(k)}
      <span style={{ fontFamily: monoF, fontSize: 34, fontWeight: 600, color: SS_TOKENS.fg0 }}>{v}</span>
      {sub && <span style={{ fontFamily: sans, fontSize: 19, color: SS_TOKENS.fg1 }}>{sub}</span>}
    </div>
  );
  const swatch = (kind: "ring" | "dot" | "bar") => (
    <div
      style={{
        display: "flex",
        width: kind === "bar" ? 26 : 16,
        height: kind === "bar" ? 7 : 16,
        borderRadius: 999,
        background: kind === "ring" ? "transparent" : kind === "dot" ? SS_TOKENS.fg0 : SS_TOKENS.sky,
        border: kind === "ring" ? `3px solid ${SS_TOKENS.fg0}` : "none",
      }}
    />
  );
  const legendItem = (kind: "ring" | "dot" | "bar", text: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {swatch(kind)}
      <span>{text}</span>
    </div>
  );

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: SS_TOKENS.bg0,
          color: SS_TOKENS.fg0,
          padding: PAD,
          gap: 26,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 14, height: 14, borderRadius: 999, background: SS_TOKENS.sky }} />
            <span style={{ fontFamily: sans, fontSize: 24, fontWeight: 700, letterSpacing: 3, color: SS_TOKENS.fg1 }}>
              SMOKYSIGNAL · FLIGHT CARD
            </span>
          </div>
          <span style={{ fontFamily: monoF, fontSize: 21, color: inProgress ? SS_TOKENS.fg0 : SS_TOKENS.fg2, letterSpacing: 2 }}>
            {status}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
            <span style={{ fontFamily: monoF, fontSize: 92, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>{tail}</span>
            {entry.nickname && (
              <span style={{ fontFamily: sans, fontSize: 42, fontWeight: 700, color: SS_TOKENS.fg1 }}>{entry.nickname}</span>
            )}
          </div>
          <span style={{ fontFamily: sans, fontSize: 24, color: SS_TOKENS.fg1 }}>{idLine}</span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: MAP.width,
            height: MAP.height + LEGEND_H,
            background: SS_TOKENS.bg1,
            border: `1px solid ${SS_TOKENS.hairline2}`,
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <svg width={MAP.width} height={MAP.height} viewBox={`0 0 ${MAP.width} ${MAP.height}`}>
            {gridLines(MAP.width, MAP.height, 96)}
            <path d={geom.d} fill="none" stroke={SS_TOKENS.sky} strokeOpacity={0.55} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
            {orbitPaths.map((d, i) => (
              <path key={i} d={d} fill="none" stroke={SS_TOKENS.sky} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {geom.start && (
              <circle cx={geom.start.x} cy={geom.start.y} r={12} fill={SS_TOKENS.bg1} stroke={SS_TOKENS.fg0} strokeWidth={5} />
            )}
            {geom.end && <circle cx={geom.end.x} cy={geom.end.y} r={9} fill={SS_TOKENS.fg0} />}
          </svg>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 30,
              height: LEGEND_H,
              padding: "0 24px",
              borderTop: `1px solid ${SS_TOKENS.hairline}`,
              fontFamily: monoF,
              fontSize: 18,
              letterSpacing: 2,
              color: SS_TOKENS.fg2,
            }}
          >
            {legendItem("ring", "TAKEOFF")}
            {legendItem("dot", inProgress ? "LAST FIX" : "LANDING")}
            {orbitPaths.length > 0 && legendItem("bar", "PATTERN")}
            <span style={{ marginLeft: "auto" }}>N ↑</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {label("ROUTE")}
            <span style={{ fontFamily: monoF, fontSize: 58, fontWeight: 600, lineHeight: 1 }}>{route}</span>
            <span style={{ fontFamily: sans, fontSize: 21, color: SS_TOKENS.fg1 }}>{routeNames}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, maxWidth: 470 }}>
            {label("WORKED")}
            <span style={{ fontFamily: monoF, fontSize: 32, fontWeight: 600, textAlign: "right" }}>{corridor}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14 }}>
          {stat("DURATION", duration)}
          {stat("MAX ALT", maxAlt)}
          {stat("ON STATION", patterns, patternSub)}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {label("ALTITUDE")}
          <svg width={SPARK.width} height={SPARK.height} viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}>
            <rect x={0} y={0} width={SPARK.width} height={SPARK.height} rx={12} fill={SS_TOKENS.bg1} />
            {spark.area && <path d={spark.area} fill={SS_TOKENS.sky} fillOpacity={0.14} />}
            {spark.d && <path d={spark.d} fill="none" stroke={SS_TOKENS.sky} strokeWidth={4} strokeLinejoin="round" />}
          </svg>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${SS_TOKENS.hairline2}`,
            paddingTop: 20,
            marginTop: "auto",
            fontFamily: monoF,
            fontSize: 21,
            color: SS_TOKENS.fg1,
          }}
        >
          <span style={{ color: SS_TOKENS.fg0 }}>{when}</span>
          <span>{url}</span>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fonts.length ? fonts : undefined },
  );

  // ImageResponse appends its own immutable Cache-Control; re-wrap so a
  // live flight gets exactly one short window.
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": inProgress ? LIVE_CACHE : FINISHED_CACHE,
      "Content-Disposition": `inline; filename="${tail}-${params.flightId}.png"`,
    },
  });
}

/** Each character once, so the font subset request stays short. */
function uniqueChars(s: string): string {
  return [...new Set(s)].join("");
}

function gridLines(w: number, h: number, step: number) {
  const out = [];
  for (let x = step; x < w; x += step) {
    out.push(<path key={`x${x}`} d={`M${x} 0 L${x} ${h}`} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />);
  }
  for (let y = step; y < h; y += step) {
    out.push(<path key={`y${y}`} d={`M0 ${y} L${w} ${y}`} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />);
  }
  return out;
}

function notFound(): Response {
  return new Response("Flight not on file.\n", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}
