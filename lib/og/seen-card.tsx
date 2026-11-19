// /seen share card: 1200x630 PNG, "What flew over Puyallup at 14:30".
// Served by app/(tabs)/seen/og/route.tsx and named in /seen's metadata.
//
// Text only, no track read: the card takes a place name, a Pacific date
// and a time, never coordinates. Names are limited to the gazetteer and
// region labels (isKnownAreaName), so a link cannot print arbitrary text.
// Neutral colours: this is history, not "Smokey is up".

import { ImageResponse } from "next/og";
import { SS_TOKENS } from "@/lib/tokens";
import { isDateString, isKnownAreaName, isTimeString, ogTitle, placeByName } from "@/lib/seen-view";
import { loadGoogleFont } from "./status-card";

export const SEEN_CARD_SIZE = { width: 1200, height: 630 };
export const SEEN_CARD_ALT =
  "SmokySignal: what flew over a place at a time, from public ADS-B tracks of known agency aircraft.";

type OgFont = { name: string; data: ArrayBuffer; weight: 600 | 800; style: "normal" };

export type SeenCardInput = { area: string | null; date: string | null; time: string | null };

/** Validate the card's query: unknown names, dates or times are dropped. */
export function parseSeenCardParams(sp: URLSearchParams): SeenCardInput {
  const rawArea = sp.get("place");
  const area = isKnownAreaName(rawArea) ? (placeByName(rawArea)?.name ?? rawArea.trim()) : null;
  const date = sp.get("date");
  const time = sp.get("time");
  return {
    area,
    date: isDateString(date) ? date : null,
    time: isTimeString(time) ? time : null,
  };
}

export async function renderSeenCard(input: SeenCardInput): Promise<Response> {
  const brand = "SMOKYSIGNAL";
  const headline = `${ogTitle(input.area, input.time)}`;
  const stamp = input.date ? `${input.date}${input.time ? ` · ${input.time} PT` : ""}` : "Pick a time and place";
  const sub = "Every tracked aircraft that passed within range, closest first.";
  const url = "smokysignal.app/seen";

  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 800, `${headline}${brand}${sub}`),
    loadGoogleFont("JetBrains Mono", 600, `${stamp}${url}`),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 800, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
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
          borderLeft: `16px solid ${SS_TOKENS.sky}`,
        }}
      >
        <span style={{ ...sansStyle, fontSize: 26, fontWeight: 800, letterSpacing: 3, color: SS_TOKENS.fg1 }}>
          {brand}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <span style={{ ...sansStyle, fontSize: 84, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
            {headline}
          </span>
          <span style={{ ...sansStyle, fontSize: 32, fontWeight: 800, color: SS_TOKENS.fg1, lineHeight: 1.3 }}>
            {sub}
          </span>
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
          <span style={{ ...monoStyle, fontSize: 30, fontWeight: 600, color: SS_TOKENS.fg0 }}>{stamp}</span>
          <span style={{ ...monoStyle, fontSize: 24, fontWeight: 600, color: SS_TOKENS.fg1, flexShrink: 0 }}>{url}</span>
        </div>
      </div>
    ),
    { ...SEEN_CARD_SIZE, fonts: fonts.length ? fonts : undefined },
  );
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
