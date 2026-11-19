"use client";

import { useEffect, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";

const ORIGIN = "https://www.smokysignal.app";

export function ShareLinkButton({
  path,
  label = "Copy link",
  size = "md",
  text,
  ariaLabel,
  variant = "default",
  testId,
}: {
  path: string;
  label?: string;
  size?: "sm" | "md";
  /**
   * Optional message shared alongside the URL. Read at tap time, so a
   * caller can pass live copy. Clipboard fallback copies "text url".
   */
  text?: string;
  ariaLabel?: string;
  /** "primary": a filled button for the moment the share is the point. */
  variant?: "default" | "primary";
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const onClick = async () => {
    const url = `${ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
    try {
      // Prefer native share sheet on mobile; fall back to clipboard.
      const navAny = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>;
      };
      if (typeof navAny.share === "function") {
        try {
          await navAny.share(text ? { text, url } : { url });
          return; // share sheet handles its own UI
        } catch {
          // user cancelled, or share unsupported — try clipboard
        }
      }
      await navigator.clipboard.writeText(text ? `${text} ${url}` : url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — silently no-op */
    }
  };

  const isSm = size === "sm";
  const primary = variant === "primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? `Copy share link${path ? `: ${path}` : ""}`}
      className="ss-mono"
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: primary ? 8 : 6,
        padding: primary ? "10px 18px" : isSm ? "5px 9px" : "7px 12px",
        borderRadius: 999,
        background: copied ? SS_TOKENS.clearDim : primary ? SS_TOKENS.cta : SS_TOKENS.bg2,
        border: `.5px solid ${copied ? `${SS_TOKENS.clear}55` : primary ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
        color: copied ? SS_TOKENS.clear : primary ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
        fontSize: primary ? 14 : 12,
        fontWeight: primary ? 700 : undefined,
        minHeight: primary ? 48 : 44,
        letterSpacing: ".04em",
        cursor: "pointer",
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <ShareIcon size={primary ? 16 : isSm ? 12 : 14} />
      {copied ? "Copied" : label}
    </button>
  );
}

function ShareIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
