// Town share card: 1200x630 PNG for /near/[town] (app/(tabs)/near/[town]/
// opengraph-image.tsx). "Over Puyallup this month: 12 flights", with a PT
// stamp so a card unfurled later cannot pass for current.
//
// Neutral colours only, the same as the road card: orange means "Smokey
// is up", and a town card is history.

import { ImageResponse } from "next/og";
import { getHistoryDigest } from "@/lib/history-digest";
import { townBySlug } from "@/lib/towns";
import { emptyTownSummary } from "@/lib/town-stats";
import { formatTs } from "@/lib/time";
import { SS_TOKENS } from "@/lib/tokens";
import { loadGoogleFont } from "./status-card";

export const TOWN_CARD_SIZE = { width: 1200, height: 630 };
export const TOWN_CARD_ALT =
  "SmokySignal town card: how many tracked flights came within about 9 miles of this town in the last 30 days.";
const CACHE_SECONDS = 300;

type OgFont = { name: string; data: ArrayBuffer; weight: 600 | 800; style: "normal" };

export async function renderTownCard(slug: string): Promise<Response> {
  const t = townBySlug(slug);
  const name = t?.name ?? "this town";
  let month = 0;
  let week = 0;
  let builtAt = Date.now();
  if (t) {
    try {
      const digest = await getHistoryDigest();
      const s = digest.towns?.[t.slug] ?? emptyTownSummary(t);
      month = s.flights30d;
      week = s.flights7d;
      builtAt = digest.builtAt;
    } catch (e) {
      console.warn("[og/town] digest read failed:", e);
    }
  }
  const brand = "SMOKYSIGNAL";
  const line1 = `Over ${name} this month:`;
  const line2 = `${month} flight${month === 1 ? "" : "s"}`;
  const stamp = `7 days: ${week} · ${formatTs(builtAt, "datetime")}`;
  const url = `smokysignal.app/near/${t?.slug ?? ""}`;

  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 800, `${line1}${brand}`),
    loadGoogleFont("JetBrains Mono", 600, `${line2}${stamp}${url}`),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 800, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
  const sansStyle = inter ? { fontFamily: "Inter" } : {};
  const monoStyle = mono ? { fontFamily: "JetBrains Mono" } : {};
  const big = name.length > 12 ? 60 : 72;

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
          <span style={{ ...sansStyle, fontSize: big, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05 }}>
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
    { ...TOWN_CARD_SIZE, fonts: fonts.length ? fonts : undefined },
  );
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
    },
  });
}
