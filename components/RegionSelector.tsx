"use client";

// Compact dropdown that lets the rider pivot the radar viewport
// between Puget Sound (default) / Pierce / Snohomish / Spokane / All
// Washington. Persists to localStorage; other components subscribe to
// the same CustomEvent so the map flies on change.

import { useEffect, useState } from "react";
import { REGIONS, type RegionId } from "@/lib/regions";
import {
  REGION_CHANGE_EVENT,
  getRegion,
  setRegion,
} from "@/lib/region-pref";
import { SS_TOKENS } from "@/lib/tokens";

type Props = {
  className?: string;
  style?: React.CSSProperties;
};

export function RegionSelector({ className, style }: Props) {
  const [current, setCurrent] = useState<RegionId>(() => getRegion());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ id: RegionId }>).detail;
      setCurrent(detail?.id ?? getRegion());
    };
    window.addEventListener(REGION_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(REGION_CHANGE_EVENT, onChange);
  }, []);

  return (
    <select
      value={current}
      onChange={(e) => setRegion(e.target.value as RegionId)}
      aria-label="Region"
      className={`ss-mono ${className ?? ""}`}
      style={{
        fontSize: 11,
        background: "rgba(11,13,16,0.78)",
        color: SS_TOKENS.fg0,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 6,
        padding: "4px 8px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        ...style,
      }}
    >
      {Object.values(REGIONS).map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
