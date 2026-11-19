"use client";

// Mission chips for /forecast. Shares the radar filter state
// (lib/radar-filter.ts, localStorage "ss_hotzones_filter") so a rider who
// widened /radar to Everything sees the same slice here, and the other
// way round. The server page reads the choice from ?missions=, so this
// component mirrors the stored filter into the URL on mount and on every
// tap. Default: Smokey only.

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SS_TOKENS } from "@/lib/tokens";
import type { Mission } from "@/lib/types";
import { formatMissionsParam } from "@/lib/mission";
import {
  RIDER_BUCKETS,
  isEverything,
  readRadarFilter,
  toggleEverything,
  toggleMission,
  writeRadarFilter,
} from "@/lib/radar-filter";

export function ForecastMissionFilter({ selected }: { selected: Mission[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const go = (missions: Mission[]) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    next.set("missions", formatMissionsParam(missions));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  // First visit without ?missions=: adopt the stored radar filter.
  useEffect(() => {
    if (params?.get("missions")) return;
    const stored = readRadarFilter().buckets;
    if (formatMissionsParam(stored) !== formatMissionsParam(selected)) go(stored);
    // Mount-only: later changes come from taps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (missions: Mission[]) => {
    writeRadarFilter({ ...readRadarFilter(), buckets: missions });
    go(missions);
  };

  const everything = isEverything(selected);
  return (
    <section
      aria-label="Forecast missions"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <span
        className="ss-mono"
        style={{ fontSize: 9.5, color: SS_TOKENS.fg2, letterSpacing: ".1em" }}
      >
        MISSIONS · SAME AS /RADAR
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Chip active={everything} onClick={() => apply(toggleEverything(selected))}>
          Everything
        </Chip>
        {RIDER_BUCKETS.map((b) => (
          <Chip
            key={b.id}
            active={selected.includes(b.id)}
            onClick={() => apply(toggleMission(selected, b.id))}
          >
            {b.label}
          </Chip>
        ))}
      </div>
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="ss-mono"
      style={{
        padding: "6px 10px",
        minHeight: 32,
        borderRadius: 999,
        background: active ? SS_TOKENS.alert : "transparent",
        border: `.5px solid ${active ? SS_TOKENS.alert : SS_TOKENS.hairline2}`,
        color: active ? SS_TOKENS.bg0 : SS_TOKENS.fg1,
        fontSize: 10.5,
        letterSpacing: ".04em",
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
