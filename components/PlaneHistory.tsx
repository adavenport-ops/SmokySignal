"use client";

// "Flight history" on /plane/[tail]: every flight this tail flew in a
// period (Last 7 / 30 days, a month on record, or a custom range) on a
// small 2D map, plus summary stats. Tap a line for that flight.
//
// Data: GET /api/history?tail=…&from=…&to=… (lib/history-core.ts).
// Map plumbing is shared with the /radar overlay (lib/history-layers.ts).
//
// 3D: TODO(flight3d) — components/Flight3D.tsx (paths: {id, points,
// color?}[]) is in a separate PR and was not on main when this shipped.
// When it lands, add a 2D | 3D toggle above the map here and render
// <Flight3D paths={historyToFlight3DPaths(body.polylines, colors)} />
// for 3D. The adapter is ready in lib/history-view.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MaplibreMap, NavigationControl } from "maplibre-gl";
import { applyNeutralBasemap, basemapStyleUrl } from "@/lib/basemap";
import "maplibre-gl/dist/maplibre-gl.css";
import { SS_TOKENS } from "@/lib/tokens";
import type { HistoryBody } from "@/lib/history-core";
import {
  HISTORY_COPY,
  assignTailColors,
  formatDuration,
  formatHours,
  historyApiQuery,
  polylineExtent,
  polylinesToGeoJSON,
  ptDate,
  rangeLabel,
  resolvePreset,
  type DateRange,
} from "@/lib/history-view";
import {
  historyLineAt,
  setHistoryData,
  setHistorySelected,
  setHistoryVisible,
  type HistoryLineKey,
} from "@/lib/history-layers";
import { useHistory } from "@/lib/hooks/useHistory";
import { useHistoryLayers } from "@/lib/hooks/useHistoryLayers";
import { useRadarPalette } from "@/lib/hooks/useRadarPalette";
import { FlightMiniCard, PeriodPicker, Stat } from "./HistoryControls";

const MAP_HEIGHT = 260;
const PUGET_SOUND: [number, number] = [-122.3, 47.6];

export default function PlaneHistory({ tail }: { tail: string }) {
  const [today, setToday] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);
  const [selected, setSelected] = useState<HistoryLineKey | null>(null);

  useEffect(() => {
    const t = ptDate(Date.now());
    setToday(t);
    setRange(resolvePreset("last30", t) ?? { from: t, to: t });
  }, []);

  const query = range ? historyApiQuery({ ...range, tails: [tail], missions: [] }) : null;
  const hist = useHistory(query);
  const body = hist.status === "ready" && hist.query === query ? hist.body : null;
  useEffect(() => setSelected(null), [query]);

  const selectedSession = useMemo(
    () => (body && selected ? body.sessions.find((s) => s.id === selected.id && s.tail === selected.tail) ?? null : null),
    [body, selected],
  );

  if (!today || !range) {
    return <div style={{ height: MAP_HEIGHT + 180 }} aria-hidden />;
  }

  let status: string | null = null;
  if (hist.status === "loading" || (hist.status !== "idle" && hist.query !== query)) status = HISTORY_COPY.loading;
  else if (hist.status === "error") status = HISTORY_COPY[hist.error];
  else if (body && body.summary.flights === 0) status = HISTORY_COPY.empty;

  return (
    <div data-testid="plane-history" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ padding: "0 14px" }}>
        <PeriodPicker today={today} value={range} onPick={setRange} />
      </div>
      <div style={{ position: "relative" }}>
        <HistoryMap tail={tail} body={body} selected={selected} onSelect={setSelected} />
        {status && (
          <div
            className="ss-mono"
            data-testid="plane-history-status"
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              top: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgba(11,13,16,0.9)",
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              color: SS_TOKENS.fg0,
              fontSize: 12,
              letterSpacing: ".04em",
              textAlign: "center",
            }}
          >
            {status}
          </div>
        )}
      </div>
      {selectedSession && (
        <div style={{ padding: "0 14px" }}>
          <FlightMiniCard session={selectedSession} onClose={() => setSelected(null)} />
        </div>
      )}
      <div style={{ padding: "0 14px 14px" }}>
        <div className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".06em", marginBottom: 8 }}>
          {tail} · {rangeLabel(range, today)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Stat label="FLIGHTS" value={body ? String(body.summary.flights) : "—"} />
          <Stat label="AIRBORNE" value={body ? formatHours(body.summary.airborne_s) : "—"} />
          <Stat
            label="MAX ALT"
            value={body && body.summary.max_alt_ft > 0 ? `${body.summary.max_alt_ft.toLocaleString("en-US")}′` : "—"}
          />
          <Stat label="DAYS UP" value={body ? String(body.summary.days_with_data) : "—"} />
          <Stat label="BUSIEST" value={body?.summary.busiest_day ? shortDate(body.summary.busiest_day.date) : "—"} />
          <Stat
            label="LONGEST"
            value={body && body.sessions.length > 0 ? formatDuration(Math.max(...body.sessions.map((s) => s.duration_s))) : "—"}
          />
        </div>
        {body && body.summary.flights > 0 && (
          <div style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 10 }}>Tap a line for the flight.</div>
        )}
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
}

function HistoryMap({
  tail,
  body,
  selected,
  onSelect,
}: {
  tail: string;
  body: HistoryBody | null;
  selected: HistoryLineKey | null;
  onSelect: (k: HistoryLineKey | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
    if (!key) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleUrl(key),
      center: PUGET_SOUND,
      zoom: 7,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    m.touchZoomRotate.disableRotation();
    const onLoad = () => {
      applyNeutralBasemap(m);
      setMap(m);
    };
    m.on("load", onLoad);
    return () => {
      m.off("load", onLoad);
      setMap(null);
      m.remove();
    };
  }, []);

  const ready = useHistoryLayers(map, { heat: false });
  const [palette] = useRadarPalette();
  const colors = useMemo(() => assignTailColors([tail], palette), [tail, palette]);
  const lines = useMemo(() => (body ? polylinesToGeoJSON(body.polylines, colors) : null), [body, colors]);

  useEffect(() => {
    if (!map || !ready) return;
    setHistoryData(map, lines, null);
    setHistoryVisible(map, true);
    const ext = body ? polylineExtent(body.polylines) : null;
    if (ext) {
      map.fitBounds(
        [
          [ext[0], ext[1]],
          [ext[2], ext[3]],
        ],
        { padding: 28, duration: 0, maxZoom: 12 },
      );
    }
  }, [map, ready, lines, body]);

  useEffect(() => {
    if (!map || !ready) return;
    setHistorySelected(map, selected);
  }, [map, ready, selected]);

  useEffect(() => {
    if (!map || !ready) return;
    const onClick = (e: maplibregl.MapMouseEvent) => onSelectRef.current(historyLineAt(map, e.point));
    const onMove = (e: maplibregl.MapMouseEvent) => {
      map.getCanvas().style.cursor = historyLineAt(map, e.point) ? "pointer" : "";
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
    };
  }, [map, ready]);

  return (
    <div
      ref={containerRef}
      data-testid="plane-history-map"
      data-lines={lines?.features.length ?? 0}
      aria-label={`Map of ${tail} flights in the chosen period`}
      style={{ position: "relative", height: MAP_HEIGHT, background: SS_TOKENS.bg0 }}
    />
  );
}
