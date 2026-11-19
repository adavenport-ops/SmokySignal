import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import { currentWrapYear } from "@/lib/wrap";

/**
 * "Season wrap" door for /stats and /data: the same log, as one card
 * you can share. Server component; the year is this PT year.
 */
export function SeasonWrapCard() {
  const year = currentWrapYear(Date.now());
  return (
    <Link
      href={`/wrap/${year}`}
      data-testid="season-wrap-card"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        minHeight: 56,
        padding: "12px 16px",
        borderRadius: 14,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        textDecoration: "none",
        color: SS_TOKENS.fg0,
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="ss-eyebrow">Season wrap</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>The {year} season, in one card</span>
        <span style={{ fontSize: 13, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>
          Sorties, hours aloft, the busiest month and the road worked most.
        </span>
      </span>
      <span aria-hidden style={{ fontSize: 18, color: SS_TOKENS.fg1, flexShrink: 0 }}>
        ›
      </span>
    </Link>
  );
}
