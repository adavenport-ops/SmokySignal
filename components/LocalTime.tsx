"use client";

// Renders a timestamp in the rider's browser tz. SSR paint uses PT
// (server fallback); after mount we re-render with the resolved viewer
// tz. suppressHydrationWarning is React's official escape hatch for
// legitimate server/client text divergence.

import { useEffect, useState } from "react";
import {
  fmtRelativeDay,
  formatTs,
  getViewerTz,
  type FormatStyle,
} from "@/lib/time";

type Style = FormatStyle | "relative-day";

type Props = {
  ts: number;
  style: Style;
  /** Force a tz instead of viewer-local (e.g. PT_TZ on pattern surfaces). */
  tz?: string;
  className?: string;
};

export function LocalTime({ ts, style, tz, className }: Props) {
  const [resolvedTz, setResolvedTz] = useState<string | undefined>(tz);
  useEffect(() => {
    if (!tz) setResolvedTz(getViewerTz());
  }, [tz]);

  const out =
    style === "relative-day"
      ? fmtRelativeDay(ts, resolvedTz ? { tz: resolvedTz } : undefined)
      : formatTs(ts, style, resolvedTz ? { tz: resolvedTz } : undefined);

  return (
    <span className={className} suppressHydrationWarning>
      {out}
    </span>
  );
}
