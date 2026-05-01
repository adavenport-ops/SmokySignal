// Server-rendered SVG logo — emits the glyph + optional wordmark inline
// so it ships in the initial HTML and never causes a layout shift.
//
// All variants share the same campaign-hat geometry from
// lib/brand/glyph.ts. The icon files in public/icons/ are generated
// from that same source — keep these in lockstep.

import {
  COLORS,
  markPaths,
  markPathsCompact,
  mono as monoSvg,
} from "@/lib/brand/glyph";
import { SS_TOKENS } from "@/lib/tokens";

type LogoProps = {
  /** Pixel height of the rendered mark. Wordmark scales accordingly. */
  size?: number;
  /** Use the favicon-grade compact silhouette (no orbit blip + arc). */
  compact?: boolean;
  /** Render the mark in solid currentColor for use in headers / footers. */
  mono?: boolean;
  /** Render the wordmark "SmokySignal" alongside the mark. */
  wordmark?: boolean;
  className?: string;
  /** Override the alert/accent color used for the mark. */
  color?: string;
  /** Override the wordmark text color (defaults to current text color). */
  textColor?: string;
};

export function Logo({
  size = 24,
  compact = false,
  mono = false,
  wordmark = false,
  className,
  color,
  textColor,
}: LogoProps) {
  const accent = mono ? "currentColor" : color ?? COLORS.A;
  const paths = compact ? markPathsCompact(accent) : markPaths(accent);

  if (!wordmark) {
    if (mono) {
      const inner = monoSvg(size, compact);
      return (
        <span
          className={className}
          aria-label="SmokySignal"
          role="img"
          dangerouslySetInnerHTML={{ __html: inner }}
          style={{ display: "inline-flex", lineHeight: 0 }}
        />
      );
    }
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className={className}
        role="img"
        aria-label="SmokySignal"
        dangerouslySetInnerHTML={{ __html: paths }}
        style={{ display: "block" }}
      />
    );
  }

  // Wordmark lockup: hat mark on the left, "SmokySignal" text on the right.
  // viewBox is 360×64 so size=H means width≈H * 5.625 (auto-derived).
  const wordmarkText = textColor ?? SS_TOKENS.fg0;
  const w = Math.round(size * (360 / 64));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 64"
      width={w}
      height={size}
      className={className}
      role="img"
      aria-label="SmokySignal"
      style={{ display: "block" }}
    >
      <g dangerouslySetInnerHTML={{ __html: markPaths(accent) }} />
      <text
        x="80"
        y="42"
        fontFamily="var(--font-inter), Inter, system-ui, sans-serif"
        fontWeight={800}
        fontSize={30}
        letterSpacing="-0.02em"
        fill={wordmarkText}
      >
        SmokySignal
      </text>
    </svg>
  );
}
