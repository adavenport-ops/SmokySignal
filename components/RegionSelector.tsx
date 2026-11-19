"use client";

// Region picker. On /radar it is a camera control: picking a view
// persists it as the rider's default and broadcasts REGION_CHANGE_EVENT,
// and RadarMap fits the map to that view. It never filters data.
//
// Two modes:
//   - standalone (settings page): reads + writes the pref itself.
//   - controlled (radar): pass `value` and `custom`. When `custom` is
//     true the rider has panned or zoomed off the last pick, so the
//     control reads "Custom" and re-picking that same view refits.

import { useEffect, useState } from "react";
import {
  CUSTOM_VIEW_LABEL,
  DEFAULT_RADAR_VIEW,
  RADAR_VIEW_LABEL,
  RADAR_VIEW_ORDER,
  isRadarViewId,
  type RadarViewId,
} from "@/lib/radar-view";
import {
  REGION_CHANGE_EVENT,
  getRegion,
  setRegion,
} from "@/lib/region-pref";
import { SS_TOKENS } from "@/lib/tokens";

const CUSTOM_VALUE = "custom";

type Props = {
  className?: string;
  style?: React.CSSProperties;
  /** Controlled current view. Omit for the self-managed settings mode. */
  value?: RadarViewId;
  /** Show "Custom" instead of the value (camera moved off the pick). */
  custom?: boolean;
  /** Called after the pick is persisted + broadcast. */
  onPick?: (id: RadarViewId) => void;
};

export function RegionSelector({
  className,
  style,
  value,
  custom = false,
  onPick,
}: Props) {
  // Start from the default on both server and first client render so
  // hydration matches, then read the stored pref.
  const [own, setOwn] = useState<RadarViewId>(DEFAULT_RADAR_VIEW);

  useEffect(() => {
    setOwn(getRegion());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ id: RadarViewId }>).detail;
      setOwn(detail?.id ?? getRegion());
    };
    window.addEventListener(REGION_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(REGION_CHANGE_EVENT, onChange);
  }, []);

  const current = value ?? own;
  const selectValue = custom ? CUSTOM_VALUE : current;

  return (
    <select
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (!isRadarViewId(v)) return;
        setRegion(v);
        onPick?.(v);
      }}
      aria-label="Region"
      title="Jump the map to a region. Heat and routes cover the whole map."
      className={`ss-mono ${className ?? ""}`}
      style={{
        fontSize: 12,
        minHeight: 44,
        background: "rgba(11,13,16,0.78)",
        color: SS_TOKENS.fg0,
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        borderRadius: 8,
        padding: "0 10px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        ...style,
      }}
    >
      {custom && (
        <option value={CUSTOM_VALUE} disabled>
          {CUSTOM_VIEW_LABEL}
        </option>
      )}
      {RADAR_VIEW_ORDER.map((id) => (
        <option key={id} value={id}>
          {RADAR_VIEW_LABEL[id]}
        </option>
      ))}
    </select>
  );
}
