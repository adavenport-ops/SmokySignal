"use client";

// Renders a MapLibre heatmap layer on the radar map for our 30-day grid
// aggregate of fleet-aircraft pings (lib/hotzones.ts). Owns:
//   - the source + heatmap layer lifecycle on the passed-in map
//   - the bottom-left toggle button (visibility) + chevron filter panel
//   - localStorage persistence for both visibility and filter
//   - re-fetching /api/hotzones whenever the filter changes
//
// Layer is added BELOW the "aircraft" symbol layer so chevrons stay on top.

import { useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap, GeoJSONSource } from "maplibre-gl";
import { SS_TOKENS } from "@/lib/tokens";
import type { HotZone } from "@/lib/hotzones";
import { Tooltip } from "./Tooltip";

const VISIBLE_KEY = "ss_hotzones_visible";
const FILTER_KEY = "ss_hotzones_filter";
const SOURCE_ID = "hotzones";
const LAYER_ID = "hotzones-heat";
const AIRCRAFT_LAYER_ID = "aircraft";
const TABBAR_HEIGHT = 66;

const SMOKY_TAILS = ["N305DK", "N2446X"] as const;
const OPERATORS = [
  "WSP",
  "KCSO",
  "Pierce SO",
  "Snohomish SO",
  "Spokane SO",
  "State of WA",
] as const;

type ShowMode = "all" | "smoky" | "operator";
type Region = "puget_sound" | "all";

type Filter = {
  showMode: ShowMode;
  operator: string | null;
  region: Region;
};

const DEFAULT_FILTER: Filter = {
  showMode: "all",
  operator: "WSP",
  region: "puget_sound",
};

function readFilter(): Filter {
  if (typeof window === "undefined") return DEFAULT_FILTER;
  try {
    const raw = window.localStorage.getItem(FILTER_KEY);
    if (!raw) return DEFAULT_FILTER;
    const parsed = JSON.parse(raw) as Partial<Filter>;
    return {
      showMode:
        parsed.showMode === "smoky" || parsed.showMode === "operator"
          ? parsed.showMode
          : "all",
      operator:
        typeof parsed.operator === "string" &&
        OPERATORS.includes(parsed.operator as (typeof OPERATORS)[number])
          ? parsed.operator
          : "WSP",
      region: parsed.region === "all" ? "all" : "puget_sound",
    };
  } catch {
    return DEFAULT_FILTER;
  }
}

function buildQueryString(f: Filter): string {
  const p = new URLSearchParams();
  p.set("region", f.region);
  if (f.showMode === "smoky") p.set("tails", SMOKY_TAILS.join(","));
  if (f.showMode === "operator" && f.operator) p.set("operator", f.operator);
  return p.toString();
}

type Props = {
  map: MaplibreMap | null;
  /** Extra px above the tab bar — pass when the airborne carousel is on. */
  bottomBoost?: number;
};

export function HotZoneLayer({ map, bottomBoost = 0 }: Props) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER);
  const [zones, setZones] = useState<HotZone[] | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Load persisted state once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(VISIBLE_KEY);
    if (v === "0") setEnabled(false);
    else if (v === "1") setEnabled(true);
    setFilter(readFilter());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VISIBLE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  }, [filter]);

  // Fetch (re-fetch when filter changes). Each request is small + edge-cached
  // for 5 min so flipping filters is cheap.
  useEffect(() => {
    let cancelled = false;
    const qs = buildQueryString(filter);
    (async () => {
      try {
        const r = await fetch(`/api/hotzones?${qs}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { zones: HotZone[] };
        if (!cancelled) setZones(Array.isArray(d.zones) ? d.zones : []);
      } catch {
        /* transient — leave previous zones, button still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Add or update the source + layer whenever the map, zones, or
  // enabled flag changes. Cleanly removes both on unmount.
  useEffect(() => {
    if (!map || !zones) return;
    if (!map.isStyleLoaded()) {
      const onReady = () => addOrUpdate(map, zones, enabled);
      map.once("idle", onReady);
      return () => {
        map.off("idle", onReady);
      };
    }
    addOrUpdate(map, zones, enabled);
  }, [map, zones, enabled]);

  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map may already be torn down */
      }
    };
  }, [map]);

  const bottom = TABBAR_HEIGHT + 16 + bottomBoost;

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom,
          zIndex: 12,
          display: "flex",
          gap: 6,
        }}
      >
        <Tooltip
          side="top"
          align="start"
          content="30-day patrol density heatmap. Brighter areas = more time spent. Tap to hide."
        >
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            aria-pressed={enabled}
            className="ss-mono"
            style={pillStyle(enabled ? SS_TOKENS.alert : SS_TOKENS.fg1)}
          >
            {enabled ? "● HOT ZONES" : "○ HOT ZONES"}
          </button>
        </Tooltip>
        <Tooltip side="top" content="Filter by tail, operator, or region.">
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-label="Hot zone filters"
            aria-expanded={panelOpen}
            className="ss-mono"
            style={{
              ...pillStyle(panelOpen ? SS_TOKENS.alert : SS_TOKENS.fg1),
              padding: "8px 10px",
            }}
          >
            {panelOpen ? "▴" : "▾"}
          </button>
        </Tooltip>
      </div>

      {panelOpen && (
        <FilterPanel
          bottom={bottom + 44}
          filter={filter}
          onChange={setFilter}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}

function pillStyle(color: string): React.CSSProperties {
  return {
    padding: "8px 12px",
    borderRadius: 999,
    background: "rgba(11,13,16,0.78)",
    border: `.5px solid ${SS_TOKENS.hairline2}`,
    color,
    fontSize: 11,
    letterSpacing: ".06em",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    touchAction: "manipulation",
    WebkitTapHighlightColor: "transparent",
  };
}

function FilterPanel({
  bottom,
  filter,
  onChange,
  onClose,
}: {
  bottom: number;
  filter: Filter;
  onChange: (f: Filter) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom,
        zIndex: 13,
        width: 240,
        padding: "12px 14px",
        borderRadius: 14,
        background: "rgba(11,13,16,0.92)",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: SS_TOKENS.fg0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          className="ss-mono"
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg2,
            letterSpacing: ".1em",
          }}
        >
          HOT ZONES
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filter panel"
          style={{
            background: "transparent",
            border: 0,
            color: SS_TOKENS.fg2,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            touchAction: "manipulation",
          }}
        >
          ×
        </button>
      </div>

      <Group label="Show">
        <Pill
          active={filter.showMode === "all"}
          onClick={() => onChange({ ...filter, showMode: "all" })}
        >
          All
        </Pill>
        <Pill
          active={filter.showMode === "smoky"}
          onClick={() => onChange({ ...filter, showMode: "smoky" })}
        >
          Smoky
        </Pill>
        <Pill
          active={filter.showMode === "operator"}
          onClick={() => onChange({ ...filter, showMode: "operator" })}
        >
          Operator
        </Pill>
      </Group>

      {filter.showMode === "operator" && (
        <select
          value={filter.operator ?? "WSP"}
          onChange={(e) => onChange({ ...filter, operator: e.target.value })}
          className="ss-mono"
          style={{
            background: SS_TOKENS.bg2,
            border: `.5px solid ${SS_TOKENS.hairline2}`,
            color: SS_TOKENS.fg0,
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 8,
          }}
        >
          {OPERATORS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      <Group label="Region">
        <Pill
          active={filter.region === "puget_sound"}
          onClick={() => onChange({ ...filter, region: "puget_sound" })}
        >
          Puget Sound
        </Pill>
        <Pill
          active={filter.region === "all"}
          onClick={() => onChange({ ...filter, region: "all" })}
        >
          Statewide
        </Pill>
      </Group>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        className="ss-mono"
        style={{
          fontSize: 9.5,
          color: SS_TOKENS.fg2,
          letterSpacing: ".1em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Pill({
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
        padding: "5px 10px",
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

function addOrUpdate(map: MaplibreMap, zones: HotZone[], enabled: boolean) {
  const fc: GeoJSON.FeatureCollection<GeoJSON.Point, { count: number }> = {
    type: "FeatureCollection",
    features: zones.map((z) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [z.lon, z.lat] },
      properties: { count: z.count },
    })),
  };

  const existing = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(fc);
  } else {
    map.addSource(SOURCE_ID, { type: "geojson", data: fc });
    const beforeId = map.getLayer(AIRCRAFT_LAYER_ID)
      ? AIRCRAFT_LAYER_ID
      : undefined;
    map.addLayer(
      {
        id: LAYER_ID,
        type: "heatmap",
        source: SOURCE_ID,
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            1,
            0.2,
            20,
            1,
          ],
          "heatmap-intensity": 1,
          "heatmap-radius": 32,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.05,
            "rgba(245,184,64,0.18)",
            0.3,
            "rgba(245,184,64,0.55)",
            0.7,
            "rgba(245,140,40,0.70)",
            1.0,
            "rgba(220,38,38,0.78)",
          ],
          "heatmap-opacity": 0.85,
        },
      },
      beforeId,
    );
  }

  try {
    map.setLayoutProperty(
      LAYER_ID,
      "visibility",
      enabled ? "visible" : "none",
    );
  } catch {
    /* layer may not exist yet on a fresh style swap */
  }
}
