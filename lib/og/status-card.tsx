// Live status share card: 1200x630 PNG for the home route's og:image and
// twitter:image (app/(tabs)/opengraph-image.tsx + twitter-image.tsx).
//
// Reads the same snapshot + computeStatus() the home hero uses. Copy comes
// from lib/share-card.ts (pure, unit-tested). Every variant shows a PT
// clock and date so a card unfurled hours later can't pass for "now".
//
// Fonts: Inter (headline) and JetBrains Mono (numerics) are fetched from
// Google Fonts as subset TTFs, with a short timeout. If that fails the
// card still renders in the built-in sans, so an unfurl never 500s.

import { ImageResponse } from "next/og";
import { getSnapshot } from "@/lib/snapshot";
import { computeStatus, makeFleetMap } from "@/lib/status";
import {
  statusCardText,
  type CardTone,
  type StatusCardText,
} from "@/lib/share-card";
import { SS_TOKENS } from "@/lib/tokens";

export const STATUS_CARD_SIZE = { width: 1200, height: 630 };
export const STATUS_CARD_ALT =
  "SmokySignal live status: whether Smokey is up, with the time it was checked.";

// CDN cache window. The card is regenerated at most once a minute; the
// stamp on the card says exactly when its data was true.
const CACHE_SECONDS = 60;
const FONT_TIMEOUT_MS = 2500;

const TONE_COLOR: Record<CardTone, string> = {
  alert: SS_TOKENS.alert,
  clear: SS_TOKENS.clear,
  unknown: SS_TOKENS.fg1,
};

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700 | 800;
  style: "normal";
};

export async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FONT_TIMEOUT_MS);
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      family,
    )}:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(cssUrl, { signal: ctrl.signal })).text();
    const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
    if (!src?.[1]) return null;
    const res = await fetch(src[1], { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function renderStatusCard(): Promise<Response> {
  const now = Date.now();
  let text: StatusCardText;
  try {
    const snap = await getSnapshot();
    const status = computeStatus(snap, makeFleetMap(snap.aircraft));
    text = statusCardText(status, snap.fetched_at, now);
  } catch (e) {
    console.warn("[og/status] snapshot read failed:", e);
    text = statusCardText(null, null, now);
  }
  return renderStatusCardImage(text);
}

/** Render a card from already-built text. Split out for previews. */
export async function renderStatusCardImage(
  text: StatusCardText,
): Promise<Response> {
  const color = TONE_COLOR[text.tone];
  const brand = "SMOKYSIGNAL";
  const url = "smokysignal.app";

  const [inter, mono] = await Promise.all([
    loadGoogleFont("Inter", 800, `${text.headline}${text.detail}${brand}`),
    loadGoogleFont("JetBrains Mono", 600, `${text.stamp}${text.detail}${url}`),
  ]);
  const fonts: OgFont[] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 800, style: "normal" });
  if (mono) fonts.push({ name: "JetBrains Mono", data: mono, weight: 600, style: "normal" });
  const sans = inter ? "Inter" : undefined;
  const monoFamily = mono ? "JetBrains Mono" : undefined;
  // Satori throws on `fontFamily: undefined`; omit the key when a font
  // failed to load so the card falls back to the default face.
  const ff = (family: string | undefined) => (family ? { fontFamily: family } : {});

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
          borderLeft: `16px solid ${color}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: color,
            }}
          />
          <span
            style={{
              ...ff(sans),
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 3,
              color: SS_TOKENS.fg1,
            }}
          >
            {brand}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span
            style={{
              ...ff(sans),
              fontSize: 132,
              fontWeight: 800,
              letterSpacing: -5,
              lineHeight: 1,
              color,
            }}
          >
            {text.headline}
          </span>
          <span
            style={{
              ...ff(text.tone === "alert" ? monoFamily : sans),
              fontSize: 48,
              fontWeight: text.tone === "alert" ? 600 : 800,
              color: SS_TOKENS.fg0,
              letterSpacing: text.tone === "alert" ? 0 : -1,
            }}
          >
            {text.detail}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: `1px solid ${SS_TOKENS.hairline2}`,
            paddingTop: 28,
          }}
        >
          <span
            style={{
              ...ff(monoFamily),
              fontSize: 44,
              fontWeight: 600,
              color: SS_TOKENS.fg0,
            }}
          >
            {text.stamp}
          </span>
          <span
            style={{
              ...ff(monoFamily),
              fontSize: 26,
              fontWeight: 600,
              color: SS_TOKENS.fg1,
            }}
          >
            {url}
          </span>
        </div>
      </div>
    ),
    {
      ...STATUS_CARD_SIZE,
      fonts: fonts.length ? fonts : undefined,
    },
  );
  // ImageResponse ships `public, immutable, max-age=31536000` and appends
  // (not replaces) any custom Cache-Control. The metadata URL hash is
  // fixed per build, so that would pin one card for a year. Re-wrap the
  // body with a single, short CDN window instead.
  return new Response(image.body, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": `public, max-age=0, s-maxage=${CACHE_SECONDS}`,
    },
  });
}
