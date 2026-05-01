import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";

/**
 * Small "?" pill that links to /help. Discovery surface so the docs
 * are findable from every meaningful screen without crowding the
 * already-busy headers.
 */
export function HelpIcon({
  variant = "fixed",
  ariaLabel = "Help and documentation",
}: {
  /** "fixed" floats next to the wake-lock button; "inline" sits in flow. */
  variant?: "fixed" | "inline";
  ariaLabel?: string;
}) {
  const fixedStyle: React.CSSProperties = {
    position: "fixed",
    top: 12,
    right: 52,
    zIndex: 30,
  };
  const inlineStyle: React.CSSProperties = {};

  return (
    <Link
      href="/help"
      aria-label={ariaLabel}
      title="Help & docs"
      style={{
        ...(variant === "fixed" ? fixedStyle : inlineStyle),
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "rgba(11,13,16,0.55)",
        border: `.5px solid ${SS_TOKENS.hairline}`,
        color: SS_TOKENS.fg1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 700,
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      ?
    </Link>
  );
}
