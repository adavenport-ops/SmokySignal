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
//     With `onNearMe` (location known) the list also offers "Near me";
//     `nearMe` says the camera is centred on the rider right now, so the
//     control reads "Near me" instead of "Custom".

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
const NEAR_ME_VALUE = "near-me";
export const NEAR_ME_LABEL = "Near me";

type Props = {
  className?: string;
  style?: React.CSSProperties;
  /** Controlled current view. Omit for the self-managed settings mode. */
  value?: RadarViewId;
  /** Show "Custom" instead of the value (camera moved off the pick). */
  custom?: boolean;
  /** Called after the pick is persisted + broadcast. */
  onPick?: (id: RadarViewId) => void;
  /** Camera is centred on the rider (GPS): read "Near me". */
  nearMe?: boolean;
  /** Offer "Near me" in the list; called when it is picked. */
  onNearMe?: () => void;
};

export function RegionSelector({
  className,
  style,
  value,
  custom = false,
  onPick,
  nearMe = false,
  onNearMe,
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
  const showNearMe = nearMe || !!onNearMe;
  const selectValue = nearMe ? NEAR_ME_VALUE : custom ? CUSTOM_VALUE : current;

  return (
    <select
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NEAR_ME_VALUE) {
          onNearMe?.();
          return;
        }
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
      {showNearMe && (
        <option value={NEAR_ME_VALUE} disabled={!onNearMe}>
          {NEAR_ME_LABEL}
        </option>
      )}
      {custom && !nearMe && (
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
