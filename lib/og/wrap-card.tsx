// Share card for /wrap/[year]: 1200x630 PNG, used as the page's
// og:image and twitter:image. Same fonts and fallbacks as the live status
// card (lib/og/status-card.tsx).

import { ImageResponse } from "next/og";
import { loadGoogleFont, type OgFont } from "./status-card";
import { loadWrap } from "@/lib/rollup-read";
import { SS_TOKENS } from "@/lib/tokens";
import { isWrapYear, type WrapSummary } from "@/lib/wrap";

export const WRAP_CARD_SIZE = { width: 1200, height: 630 };
export const WRAP_CARD_ALT = "SmokySignal season wrap: sorties, hours aloft and the busiest month.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export async function renderWrapCard(rawYear: string): Promise<Response> {
  const year = /^\d{4}$/.test(rawYear) && isWrapYear(Number(rawYear), Date.now()) ? Number(rawYear) : null;
  let w: WrapSummary | null = null;
  if (year) {
    try {
      w = await loadWrap(year);
    } catch (e) {
      console.warn("[og/wrap] load failed:", e);
    }
  }
  const title = year ? `${year} SEASON WRAP` : "SEASON WRAP";
  const stats: Array<[string, string]> = w
    ? [
        ["FLIGHTS", String(w.totals.sorties)],
        ["HOURS ALOFT", (w.totals.airborne_s / 3600).toFixed(1)],
        ["BUSIEST MONTH", w.busiest_month ? MONTHS[Number(w.busiest_month.month.slice(5)) - 1]! : "—"],
        ["TOP CORRIDOR", w.corridor ? w.corridor.road : "—"],
      ]
    : [];
  const note = w?.limited
    ? `Log starts ${w.from}`
    : w?.in_progress
      ? `Through ${w.to}`
      : w
        ? `${w.from} to ${w.to}`
        : "How the birds flew.";
  const brand = "SMOKYSIGNAL";
  const url = year ? `smokysignal.app/wrap/${year}` : "smokysignal.app";
  const allText = [...new Set(`${title}${brand}${note}${url}${stats.map(([k, v]) => k + v).join("")}0123456789.`)].join("");
  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 800, allText),
    loadGoogleFont("JetBrains Mono", 600, allText),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 800, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
  // Satori needs a family name on every styled run.
  const sans = inter ? "Inter" : "sans-serif";
  const monoF = mono ? "JetBrains Mono" : sans;

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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 18, height: 18, borderRadius: 999, background: SS_TOKENS.sky }} />
          <span style={{ fontFamily: sans, fontSize: 26, fontWeight: 800, letterSpacing: 3, color: SS_TOKENS.fg1 }}>{brand}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <span style={{ fontFamily: sans, fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>{title}</span>
          <div style={{ display: "flex", gap: 44 }}>
            {stats.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontFamily: monoF, fontSize: 20, letterSpacing: 3, color: SS_TOKENS.fg2 }}>{k}</span>
                <span style={{ fontFamily: monoF, fontSize: 56, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${SS_TOKENS.hairline2}`,
            paddingTop: 26,
            gap: 24,
            fontFamily: monoF,
            fontSize: 24,
            color: SS_TOKENS.fg1,
          }}
        >
          <span>{note}</span>
          <span>{url}</span>
        </div>
      </div>
    ),
    { ...WRAP_CARD_SIZE, fonts: fonts.length ? fonts : undefined },
  );
  // A closed year never changes; a running one refreshes hourly.
  const closed = w != null && !w.in_progress;
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": closed ? "public, max-age=86400, s-maxage=604800" : "public, max-age=0, s-maxage=3600",
    },
  });
}
