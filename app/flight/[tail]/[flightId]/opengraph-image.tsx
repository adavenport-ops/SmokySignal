// Generates a 1200×630 social-share card for /flight/[tail]/[flightId].
// Uses MapTiler Static Maps to render the polyline as the background;
// Next.js ImageResponse overlays the tail/nickname/date/duration. If the
// flight or MapTiler key is missing, falls back to a plain dark card so
// share previews never 500.
//
// TZ NOTE: dates render in PT and are labelled "PT". OG images are
// rendered once per flight share URL on the server and embedded in
// chat/social previews where the viewer's tz is unknowable. PT is the
// geography the flight actually occurred in — a friend in EDT seeing
// the unfurl learns the local-PT clock time, which is what they'd
// want for "when did this happen?" anyway.

import { ImageResponse } from "next/og";
import { getRegistry } from "@/lib/registry";
import { getFlightById } from "@/lib/flights";
import { fmtDurationHuman, formatTs } from "@/lib/time";

export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt = "SmokySignal flight track";

const SS_BG = "#0b0d10";
const SS_FG = "#eef0f3";
const SS_FG2 = "#a8adb6";
const SS_ALERT = "#f5b840";

const MAX_PATH_POINTS = 200; // MapTiler URL length cap

type Props = { params: { tail: string; flightId: string } };

export default async function OGImage({ params }: Props) {
  const tail = params.tail.toUpperCase();
  const fleet = await getRegistry();
  const entry = fleet.find((f) => f.tail === tail) ?? null;
  const flight = entry
    ? await getFlightById(tail, entry.nickname, params.flightId)
    : null;

  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const staticMapUrl =
    key && flight && flight.points.length >= 2
      ? buildStaticMapUrl(flight.points, key)
      : null;

  const title = entry
    ? entry.nickname
      ? `${tail} · ${entry.nickname}`
      : tail
    : tail;
  const subtitle = flight
    ? `${formatTs(flight.session.start_ts, "date-short")} PT · ${fmtDurationHuman(flight.session.duration_s)}`
    : "Flight track";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: SS_BG,
          color: SS_FG,
          position: "relative",
        }}
      >
        {staticMapUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={staticMapUrl}
            alt=""
            width={1200}
            height={630}
            style={{
              position: "absolute",
              inset: 0,
              objectFit: "cover",
              opacity: 0.85,
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to bottom, rgba(11,13,16,0.6) 0%, rgba(11,13,16,0.2) 50%, rgba(11,13,16,0.92) 100%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 64,
            width: "100%",
            height: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: SS_ALERT,
              }}
            />
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 1.6,
                color: SS_FG,
              }}
            >
              SMOKYSIGNAL
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span
              style={{
                fontSize: 92,
                fontWeight: 800,
                color: SS_FG,
                letterSpacing: -2,
                lineHeight: 1,
              }}
            >
              {title}
            </span>
            <span style={{ fontSize: 28, color: SS_ALERT, fontWeight: 600 }}>
              {subtitle}
            </span>
            {entry && (
              <span style={{ fontSize: 22, color: SS_FG2 }}>
                {entry.operator} · {entry.model}
              </span>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 18, color: SS_FG2 }}>
              smokysignal.app
            </span>
            <span style={{ fontSize: 18, color: SS_FG2 }}>
              /flight/{tail}/{params.flightId}
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      headers: {
        // 1-day CDN cache — completed flights don't change.
        "Cache-Control": "public, max-age=0, s-maxage=86400, immutable",
      },
    },
  );
}

function buildStaticMapUrl(
  points: { lat: number; lon: number }[],
  key: string,
): string {
  // Downsample to MAX_PATH_POINTS to stay under MapTiler URL length limits.
  const stride = Math.max(1, Math.ceil(points.length / MAX_PATH_POINTS));
  const sampled: string[] = [];
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i]!;
    sampled.push(`${p.lat.toFixed(5)},${p.lon.toFixed(5)}`);
  }
  if (
    points.length > 0 &&
    sampled[sampled.length - 1] !==
      `${points[points.length - 1]!.lat.toFixed(5)},${points[points.length - 1]!.lon.toFixed(5)}`
  ) {
    const last = points[points.length - 1]!;
    sampled.push(`${last.lat.toFixed(5)},${last.lon.toFixed(5)}`);
  }
  const path = `path=fill:transparent|stroke:${encodeURIComponent("#F5B840")}|width:5|${sampled.join("|")}`;
  return `https://api.maptiler.com/maps/streets-v2-dark/static/auto/1200x630.png?${path}&key=${key}`;
}

