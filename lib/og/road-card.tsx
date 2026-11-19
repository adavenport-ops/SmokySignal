// Road share card: 1200x630 PNG for /road/[id] (app/(tabs)/road/[id]/
// opengraph-image.tsx). "Planes over SR-512 this week: 7 flights", with a
// PT stamp so a card unfurled later can't pass for current.
//
// Neutral colours only: orange means "Smokey is up", and a road card is
// history. Same font loader and cache shape as lib/og/status-card.tsx.

import { ImageResponse } from "next/og";
import { getHistoryDigest } from "@/lib/history-digest";
import { corridorById, emptyRoadSummary } from "@/lib/road";
import { formatTs } from "@/lib/time";
import { SS_TOKENS } from "@/lib/tokens";
import { loadGoogleFont } from "./status-card";

export const ROAD_CARD_SIZE = { width: 1200, height: 630 };
export const ROAD_CARD_ALT =
  "SmokySignal road card: how many tracked flights passed over this corridor in the last 7 days.";
const CACHE_SECONDS = 300;

type OgFont = { name: string; data: ArrayBuffer; weight: 600 | 800; style: "normal" };

export async function renderRoadCard(id: string): Promise<Response> {
  const c = corridorById(id);
  const name = c?.name ?? "this road";
  let week = 0;
  let month = 0;
  let builtAt = Date.now();
  if (c) {
    try {
      const digest = await getHistoryDigest();
      const s = digest.roads[c.id] ?? emptyRoadSummary(c);
      week = s.flights7d;
      month = s.flights30d;
      builtAt = digest.builtAt;
    } catch (e) {
      console.warn("[og/road] digest read failed:", e);
    }
  }
  const brand = "SMOKYSIGNAL";
  const line1 = `Planes over ${name} this week:`;
  const line2 = `${week} flight${week === 1 ? "" : "s"}`;
  const stamp = `30 days: ${month} flight${month === 1 ? "" : "s"} · ${formatTs(builtAt, "datetime")}`;
  const url = `smokysignal.app/road/${c?.id ?? ""}`;

  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 800, `${line1}${brand}`),
    loadGoogleFont("JetBrains Mono", 600, `${line2}${stamp}${url}`),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 800, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
  // Satori throws on `fontFamily: undefined`, so only set a family when its
  // font loaded; otherwise the card renders in the built-in sans.
  const sansStyle = inter ? { fontFamily: "Inter" } : {};
  const monoStyle = mono ? { fontFamily: "JetBrains Mono" } : {};

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: SS_TOKENS.bg0,
          color: SS_TOKENS.fg0,
          padding: 72,
          borderLeft: `16px solid ${SS_TOKENS.fg2}`,
        }}
      >
        <span style={{ ...sansStyle, fontSize: 26, fontWeight: 800, letterSpacing: 3, color: SS_TOKENS.fg1 }}>
          {brand}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <span style={{ ...sansStyle, fontSize: 72, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
            {line1}
          </span>
          <span style={{ ...monoStyle, fontSize: 120, fontWeight: 600, lineHeight: 1 }}>{line2}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: `1px solid ${SS_TOKENS.hairline2}`,
            paddingTop: 28,
            gap: 24,
          }}
        >
          <span style={{ ...monoStyle, fontSize: 26, fontWeight: 600, color: SS_TOKENS.fg0 }}>{stamp}</span>
          <span style={{ ...monoStyle, fontSize: 22, fontWeight: 600, color: SS_TOKENS.fg1, flexShrink: 0 }}>{url}</span>
        </div>
      </div>
    ),
    { ...ROAD_CARD_SIZE, fonts: fonts.length ? fonts : undefined },
  );
  // See lib/og/status-card.tsx: replace ImageResponse's year-long cache.
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
    },
  });
}
