"use client";

// The radar's add-zone sheet, opened by the + button (components/
// RadarShell.tsx). A bottom sheet on phones, a small card beside the +
// on wider screens. Name (prefilled from the nearest place), radius
// chips (2 / 5 / 10 mi), centre from GPS or a pin dropped on the map,
// Save. State and naming live in lib/zone-draft.ts; storage in
// lib/user-zones.ts. The draft circle is previewed on the map.

import { useEffect, useReducer, useRef, useState } from "react";
import type { GeoJSONSource, Map as MaplibreMap, MapMouseEvent } from "maplibre-gl";
import { SS_TOKENS, TAP_MIN } from "@/lib/tokens";
import { ringCoords } from "@/lib/distance-rings";
import { addUserZone, readUserZones, type UserZone } from "@/lib/user-zones";
import {
  ZONE_RADII_MI,
  canSaveZone,
  initialZoneDraft,
  zoneDraftReducer,
  zoneInputFromDraft,
  zonePlaceName,
  type ZonePoint,
} from "@/lib/zone-draft";

const DRAFT_SOURCE = "zone-draft";
const DRAFT_LINE = "zone-draft-line";
const DRAFT_DOT = "zone-draft-dot";
const SHEET_QUERY = "(max-width: 639px)";

type Props = {
  map: MaplibreMap | null;
  rider: ZonePoint | null;
  /** Top of the card on wide screens (beside the + button). */
  top: number;
  /** Bottom inset on phones: the tab bar. */
  bottom: string;
  onClose: () => void;
  onSaved: (zone: UserZone) => void;
};

function usePhoneSheet(): boolean {
  const [phone, setPhone] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(SHEET_QUERY);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

export function AddZoneSheet({ map, rider, top, bottom, onClose, onSaved }: Props) {
  const phone = usePhoneSheet();
  const [draft, dispatch] = useReducer(zoneDraftReducer, null, () =>
    initialZoneDraft(rider, readUserZones().map((z) => z.label)),
  );

  // Escape closes (or backs out of pin mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (draft.placing) dispatch({ type: "cancel-pin" });
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft.placing, onClose]);

  // Pin mode: the next tap on the map is the centre.
  useEffect(() => {
    if (!map || !draft.placing) return;
    const root = document.documentElement;
    root.dataset.ssPlacingZone = "1";
    const canvas = map.getCanvas();
    const prevCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    const onClick = (e: MapMouseEvent) => {
      dispatch({
        type: "drop-pin",
        point: { lat: e.lngLat.lat, lon: e.lngLat.lng },
        existing: readUserZones().map((z) => z.label),
      });
    };
    map.once("click", onClick);
    return () => {
      map.off("click", onClick);
      canvas.style.cursor = prevCursor;
      // Clear on the next tick so the same tap never reaches the zone layer.
      setTimeout(() => {
        delete root.dataset.ssPlacingZone;
      }, 0);
    };
  }, [map, draft.placing]);

  // Preview the draft circle on the map.
  const point = draft.point;
  const radiusMi = draft.radiusMi;
  useEffect(() => {
    if (!map) return;
    const data: GeoJSON.FeatureCollection = point
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "LineString", coordinates: ringCoords(point.lat, point.lon, radiusMi) },
              properties: {},
            },
            { type: "Feature", geometry: { type: "Point", coordinates: [point.lon, point.lat] }, properties: {} },
          ],
        }
      : { type: "FeatureCollection", features: [] };
    const apply = () => {
      if (!map.isStyleLoaded()) return;
      const src = map.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
        return;
      }
      map.addSource(DRAFT_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: DRAFT_LINE,
        type: "line",
        source: DRAFT_SOURCE,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": SS_TOKENS.sky, "line-width": 2, "line-dasharray": [2, 1.5] },
      });
      map.addLayer({
        id: DRAFT_DOT,
        type: "circle",
        source: DRAFT_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": SS_TOKENS.sky,
          "circle-stroke-color": SS_TOKENS.bg0,
          "circle-stroke-width": 2,
        },
      });
    };
    apply();
    if (point) {
      try {
        map.easeTo({ center: [point.lon, point.lat], duration: 400 });
      } catch {
        /* map torn down */
      }
    }
    map.on("styledata", apply);
    return () => {
      map.off("styledata", apply);
    };
  }, [map, point, radiusMi]);

  // Remove the preview when the sheet closes.
  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(DRAFT_DOT)) map.removeLayer(DRAFT_DOT);
        if (map.getLayer(DRAFT_LINE)) map.removeLayer(DRAFT_LINE);
        if (map.getSource(DRAFT_SOURCE)) map.removeSource(DRAFT_SOURCE);
      } catch {
        /* map torn down */
      }
    };
  }, [map]);

  const save = () => {
    const input = zoneInputFromDraft(draft);
    if (!input) return;
    onSaved(addUserZone(input));
  };

  if (draft.placing) {
    return (
      <div
        role="status"
        data-testid="add-zone-pin-banner"
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          top,
          margin: "0 auto",
          maxWidth: 420,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 4px 4px 14px",
          borderRadius: 12,
          background: "rgba(11,13,16,0.94)",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: SS_TOKENS.fg0,
          fontSize: 14,
        }}
      >
        <span style={{ flex: 1 }}>Tap the map to drop the pin.</span>
        <button type="button" onClick={() => dispatch({ type: "cancel-pin" })} style={ghostBtn}>
          Cancel
        </button>
      </div>
    );
  }

  const where = point ? zonePlaceName(point.lat, point.lon) : null;
  const centreLine = !point
    ? "Pick a center: your location or a pin."
    : draft.source === "pin"
      ? `Pin${where ? ` near ${where}` : ""}`
      : `Your location${where ? `, near ${where}` : ""}`;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="add-zone-title"
      data-testid="add-zone-sheet"
      style={{
        position: "absolute",
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "8px 16px 16px",
        background: "rgba(15,17,21,0.97)",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        color: SS_TOKENS.fg0,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        ...(phone
          ? { left: 0, right: 0, bottom, borderRadius: "16px 16px 0 0", borderBottom: 0 }
          : { left: 122, top, width: 320, borderRadius: 14 }),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 id="add-zone-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          Add a zone
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" style={closeBtn}>
          <span aria-hidden>×</span>
        </button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="ss-eyebrow">Name</span>
        <input
          type="text"
          value={draft.name}
          maxLength={40}
          placeholder="Home, the shop, a meet spot"
          onChange={(e) => dispatch({ type: "rename", name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSaveZone(draft)) save();
          }}
          data-testid="add-zone-name"
          style={{
            minHeight: TAP_MIN,
            padding: "0 12px",
            borderRadius: 10,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            background: SS_TOKENS.bg2,
            color: SS_TOKENS.fg0,
            // 16px stops iOS Safari zooming the page on focus.
            fontSize: 16,
          }}
        />
      </label>

      <div role="radiogroup" aria-label="Radius" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="ss-eyebrow" aria-hidden>
          Radius
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {ZONE_RADII_MI.map((mi) => {
            const on = draft.radiusMi === mi;
            return (
              <button
                key={mi}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => dispatch({ type: "radius", radiusMi: mi })}
                className="ss-mono"
                data-testid={`add-zone-radius-${mi}`}
                style={{
                  flex: 1,
                  minHeight: TAP_MIN,
                  borderRadius: 999,
                  border: `.5px solid ${on ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
                  background: on ? SS_TOKENS.cta : "transparent",
                  color: on ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
                  fontSize: 14,
                  fontWeight: on ? 600 : 500,
                  cursor: "pointer",
                  touchAction: "manipulation",
                }}
              >
                {mi} mi
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="ss-eyebrow">Center</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={!rider}
            aria-pressed={draft.source === "gps"}
            onClick={() =>
              rider &&
              dispatch({ type: "use-location", point: rider, existing: readUserZones().map((z) => z.label) })
            }
            style={{ ...choiceBtn(draft.source === "gps"), opacity: rider ? 1 : 0.5 }}
          >
            Use my location
          </button>
          <button
            type="button"
            aria-pressed={draft.source === "pin"}
            onClick={() => dispatch({ type: "start-pin" })}
            data-testid="add-zone-drop-pin"
            style={choiceBtn(draft.source === "pin")}
          >
            Drop a pin
          </button>
        </div>
        <span style={{ fontSize: 13, color: SS_TOKENS.fg1 }}>
          {rider || point ? centreLine : "Location is off. Drop a pin to place the zone."}
        </span>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!canSaveZone(draft)}
        data-testid="add-zone-save"
        style={{
          minHeight: 48,
          borderRadius: 12,
          border: 0,
          background: SS_TOKENS.cta,
          color: SS_TOKENS.ctaInk,
          fontSize: 15,
          fontWeight: 700,
          cursor: canSaveZone(draft) ? "pointer" : "not-allowed",
          opacity: canSaveZone(draft) ? 1 : 0.45,
          touchAction: "manipulation",
        }}
      >
        Save
      </button>
    </div>
  );
}

const closeBtn: React.CSSProperties = {
  width: TAP_MIN,
  height: TAP_MIN,
  marginRight: -10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: 0,
  borderRadius: 10,
  color: SS_TOKENS.fg1,
  fontSize: 22,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  minHeight: TAP_MIN,
  padding: "0 14px",
  borderRadius: 10,
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  background: SS_TOKENS.bg2,
  color: SS_TOKENS.fg0,
  fontSize: 14,
  cursor: "pointer",
};

function choiceBtn(on: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: TAP_MIN,
    padding: "0 10px",
    borderRadius: 10,
    border: `${on ? 1.5 : 0.5}px solid ${on ? SS_TOKENS.fg0 : SS_TOKENS.hairline2}`,
    background: on ? SS_TOKENS.bg2 : "transparent",
    color: on ? SS_TOKENS.fg0 : SS_TOKENS.fg1,
    fontSize: 14,
    fontWeight: on ? 600 : 500,
    cursor: "pointer",
    touchAction: "manipulation",
  };
}
