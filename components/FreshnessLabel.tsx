"use client";

import { useEffect, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { STALE_MS } from "@/lib/freshness";
import { formatTsBare } from "@/lib/time";

type Props = {
  /** ms-since-epoch of the last successful track sample. null = unknown. */
  lastSampleMs: number | null;
  className?: string;
  style?: React.CSSProperties;
};

export function FreshnessLabel({ lastSampleMs, className, style }: Props) {
  // Re-tick every 30s so the label stays honest without requiring a
  // server round-trip. The cookie/cache layer keeps the underlying value
  // current at server-render time; this just ages it gracefully.
  const [now, setNow] = useState<number>(() =>
    typeof window === "undefined" ? lastSampleMs ?? 0 : Date.now(),
  );
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!lastSampleMs) {
    return (
      <span
        className={`ss-mono ${className ?? ""}`}
        style={{ fontSize: 12, color: SS_TOKENS.fg1, ...style }}
        aria-label="Last sample unknown"
      >
        <span className="ss-fresh-full">LAST SAMPLE — UNKNOWN</span>
        <span className="ss-fresh-short" aria-hidden="true">SAMPLE UNKNOWN</span>
      </span>
    );
  }
  const ageMs = Math.max(0, now - lastSampleMs);
  const stale = ageMs > STALE_MS;
  const m = Math.floor(ageMs / 60_000);
  const label = m < 1 ? "JUST NOW" : `${m}m AGO`;
  const clock = formatTsBare(lastSampleMs, "hour-min");
  return (
    <span
      className={`ss-mono ${className ?? ""}`}
      style={{
        fontSize: 12,
        // Stale is a data-health warning, not "Smokey is up": bright
        // neutral, never orange.
        color: stale ? SS_TOKENS.fg0 : SS_TOKENS.fg1,
        letterSpacing: ".06em",
        ...style,
      }}
      aria-label={`Last sample ${label.toLowerCase()}, ${clock} Pacific`}
      title={
        stale
          ? "Live cron may be down — last sample is older than 15 minutes."
          : `Last sample — ${label.toLowerCase()} · ${clock} PT`
      }
    >
      <span className="ss-fresh-full">
        LAST SAMPLE — {label} · {clock} PT
      </span>
      {/* Narrow phones: the full text runs under the region picker, so
          show the age + clock only. The full text stays in aria-label. */}
      <span className="ss-fresh-short" aria-hidden="true">
        {label} · {clock}
      </span>
    </span>
  );
}
