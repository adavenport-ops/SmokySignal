"use client";

// 2D | 3D controls shared by the plane page's Flight history, the /radar
// history banner and the live /radar pill row. Light on purpose: no
// deck.gl here. The 3D views themselves load through next/dynamic.

import { SS_TOKENS } from "@/lib/tokens";
import type { MapView } from "@/lib/history-3d";
import { supportsWebGL2 } from "@/lib/webgl";

/** True when the browser can give us a WebGL2 context (3D needs it). */
export function hasWebGL2(): boolean {
  // Cached probe that releases its context (lib/webgl.ts): a bare
  // getContext() here held one of the browser's context slots per call.
  return supportsWebGL2();
}

/** Segmented 2D | 3D switch, 44px targets. */
export function ViewToggle({
  view,
  onChange,
  label = "Map view",
}: {
  view: MapView;
  onChange: (v: MapView) => void;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid="view-toggle"
      style={{
        display: "inline-flex",
        alignSelf: "flex-start",
        padding: 3,
        gap: 3,
        borderRadius: 10,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
      }}
    >
      {(["2d", "3d"] as const).map((v) => {
        const on = view === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            data-view={v}
            onClick={() => onChange(v)}
            className="ss-mono"
            style={{
              minWidth: 60,
              height: 44,
              padding: "0 14px",
              borderRadius: 8,
              border: "none",
              background: on ? SS_TOKENS.bg2 : "transparent",
              boxShadow: on ? `inset 0 0 0 .5px ${SS_TOKENS.hairline2}` : "none",
              color: on ? SS_TOKENS.fg0 : SS_TOKENS.fg1,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: ".06em",
              cursor: "pointer",
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {v.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One-tap 3D pill for map overlays (live /radar row, history banner).
 * Pressed = 3D. `variant="banner"` drops the pill chrome to sit inside
 * the HISTORY banner.
 */
export function Pill3D({
  active,
  onClick,
  variant = "pill",
  testId,
}: {
  active: boolean;
  onClick: () => void;
  variant?: "pill" | "banner";
  testId?: string;
}) {
  const banner = variant === "banner";
  const common: React.CSSProperties = {
    minWidth: 44,
    minHeight: 44,
    flex: "0 0 auto",
    cursor: "pointer",
    whiteSpace: "nowrap",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".06em",
  };
  if (banner) {
    // Full 44px hit area; the visible chip sits inside the banner's edge.
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={active ? "3D on. Back to the flat map" : "Show in 3D"}
        data-testid={testId}
        className="ss-mono"
        style={{ ...common, padding: "0 4px", background: "transparent", border: 0, color: SS_TOKENS.fg0 }}
      >
        <span
          style={{
            padding: "5px 9px",
            borderRadius: 7,
            background: active ? SS_TOKENS.fg0 : "transparent",
            border: `.5px solid ${active ? SS_TOKENS.fg0 : "rgba(143,169,224,0.55)"}`,
            color: active ? "#24265C" : SS_TOKENS.fg0,
          }}
        >
          3D
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "3D on. Back to the flat map" : "Show in 3D"}
      data-testid={testId}
      className="ss-mono"
      style={{
        ...common,
        padding: "0 14px",
        borderRadius: 999,
        background: active ? SS_TOKENS.fg0 : "rgba(11,13,16,0.78)",
        border: `.5px solid ${active ? SS_TOKENS.fg0 : SS_TOKENS.hairline2}`,
        color: active ? SS_TOKENS.bg0 : SS_TOKENS.fg1,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      3D
    </button>
  );
}
