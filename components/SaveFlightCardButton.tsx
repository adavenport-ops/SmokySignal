"use client";

// "Save flight card" on /flight/[tail]/[flightId]. A plain download link
// to the 1200x1500 PNG at ./card, upgraded on phones that can share files
// to hand the image straight to the share sheet.

import { useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";

export function SaveFlightCardButton({ tail, flightId }: { tail: string; flightId: string }) {
  const [busy, setBusy] = useState(false);
  const href = `/flight/${tail}/${flightId}/card`;
  const filename = `${tail}-${flightId}.png`;

  const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    const nav = navigator as Navigator & {
      canShare?: (d: ShareData) => boolean;
      share?: (d: ShareData) => Promise<void>;
    };
    if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return;
    if (typeof File === "undefined") return;
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(String(res.status));
      const file = new File([await res.blob()], filename, { type: "image/png" });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `${tail} flight card` });
      } else {
        window.location.assign(href);
      }
    } catch {
      // Share cancelled or unsupported: fall back to opening the image.
      window.location.assign(href);
    } finally {
      setBusy(false);
    }
  };

  return (
    <a
      href={href}
      download={filename}
      onClick={onClick}
      data-testid="save-flight-card"
      aria-label={`Save flight card for ${tail} as an image`}
      className="ss-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        minHeight: 32,
        borderRadius: 999,
        background: SS_TOKENS.bg2,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        color: SS_TOKENS.fg1,
        fontSize: 11,
        letterSpacing: ".04em",
        textDecoration: "none",
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12" />
        <polyline points="7 10 12 15 17 10" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      {busy ? "Saving" : "Save flight card"}
    </a>
  );
}
