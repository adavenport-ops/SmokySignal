"use client";

// "Flight history" on /plane/[tail]: every flight this tail flew in a
// period (Last 7 / 30 days, a month on record, or a custom range) on a
// small 2D map, plus summary stats. Tap a line for that flight.
//
// Data: GET /api/history?tail=…&from=…&to=… (lib/history-core.ts).
// Map plumbing is shared with the /radar overlay (lib/history-layers.ts).
//
// 3D: a 2D | 3D switch above the map (`?hview=3d`) swaps in
// components/Flight3D.tsx, loaded through next/dynamic so deck.gl never
// lands in this page's first-load JS. Paths and colours come from
// lib/history-3d.ts: one flight is orange with replay; many flights get a
// cool colour each, orange only for the one tapped, and no replay.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
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
import {
  HISTORY_VIEW_PARAM,
  historyPathKey,
  historyPaths3D,
  parseHistoryPathKey,
  parseMapView,
  replayAllowed,
  withMapView,
  type MapView,
} from "@/lib/history-3d";
import type { Flight3DPick } from "./Flight3D";
import { FlightMiniCard, PeriodPicker, Stat } from "./HistoryControls";
import { ViewToggle, hasWebGL2 } from "./View3DToggle";
import { MapBoundary, useReportMapLoss } from "./MapBoundary";
import { TrackSvgFallback } from "./TrackSvgFallback";
import { releaseMap } from "@/lib/webgl";

const MAP_HEIGHT = 260;
const HEIGHT_3D = "clamp(380px, 62vh, 560px)";

const Flight3D = nextDynamic(() => import("./Flight3D"), {
  ssr: false,
  loading: () => (
    <div
      className="ss-mono"
      style={{
        height: HEIGHT_3D,
        background: SS_TOKENS.bg0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: SS_TOKENS.fg1,
        fontSize: 12,
        letterSpacing: ".08em",
      }}
    >
      LOADING 3D
    </div>
  ),
});
const PUGET_SOUND: [number, number] = [-122.3, 47.6];

export default function PlaneHistory({ tail, since }: { tail: string; since?: string }) {
  const [today, setToday] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);
  const [selected, setSelected] = useState<HistoryLineKey | null>(null);
  const [view, setView] = useState<MapView>("2d");
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    const t = ptDate(Date.now());
    setToday(t);
    setRange(resolvePreset("last30", t, since) ?? { from: t, to: t });
    const v = parseMapView(new URLSearchParams(window.location.search).get(HISTORY_VIEW_PARAM));
    setView(v);
    if (v === "3d" && !hasWebGL2()) setUnavailable("webgl2");
  }, [since]);

  const chooseView = useCallback((next: MapView) => {
    setView(next);
    setUnavailable(next === "3d" && !hasWebGL2() ? "webgl2" : null);
    const url = new URL(window.location.href);
    const qs = withMapView(url.searchParams, HISTORY_VIEW_PARAM, next).toString();
    // replaceState, not a router push: no server round trip for a view flip.
    window.history.replaceState(window.history.state, "", `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`);
  }, []);

  const query = range ? historyApiQuery({ ...range, tails: [tail], missions: [] }) : null;
  const hist = useHistory(query);
  const body = hist.status === "ready" && hist.query === query ? hist.body : null;
  useEffect(() => setSelected(null), [query]);

  const selectedSession = useMemo(
    () => (body && selected ? body.sessions.find((s) => s.id === selected.id && s.tail === selected.tail) ?? null : null),
    [body, selected],
  );

  const show3d = view === "3d" && unavailable == null;
  const selectedKey = selected ? historyPathKey(selected) : null;
  const paths = useMemo(
    () => (show3d && body ? historyPaths3D(body.polylines, selectedKey) : []),
    [show3d, body, selectedKey],
  );
  const onPick = useCallback((p: Flight3DPick | null) => {
    if (p?.kind === "path") setSelected(parseHistoryPathKey(p.id));
    else setSelected(null);
  }, []);

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
        <PeriodPicker today={today} value={range} onPick={setRange} floor={since} />
      </div>
      <div style={{ padding: "0 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <ViewToggle view={view} onChange={chooseView} label="Flight history view" />
        {view === "3d" && unavailable && (
          <div role="status" style={{ fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
            {unavailable === "webgl2"
              ? "3D needs WebGL2, and this browser does not offer it. Here is the flat map."
              : "3D view dropped out on this device. Here is the flat map."}
          </div>
        )}
      </div>
      <div style={{ position: "relative" }}>
        {show3d ? (
          <div data-testid="plane-history-3d" style={{ height: HEIGHT_3D }}>
            <Flight3D
              paths={paths}
              fill
              scene="plane-history"
              replay={replayAllowed(paths)}
              annotate
              onPick={onPick}
              frameKey={body ? query : null}
              onUnavailable={setUnavailable}
            />
          </div>
        ) : (
          <MapBoundary
            name="plane-history"
            placeholder={<div aria-hidden style={{ height: MAP_HEIGHT, background: SS_TOKENS.bg0 }} />}
            fallback={<HistorySvgFallback body={body} />}
          >
            <HistoryMap tail={tail} body={body} selected={selected} onSelect={setSelected} />
          </MapBoundary>
        )}
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
          {tail} · {rangeLabel(range, today, since)}
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

/** Flat drawing of the period's flights when the 2D map cannot run. */
function HistorySvgFallback({ body }: { body: HistoryBody | null }) {
  if (!body) return <div aria-hidden style={{ height: MAP_HEIGHT, background: SS_TOKENS.bg0 }} />;
  return (
    <TrackSvgFallback
      height={MAP_HEIGHT}
      tracks={body.polylines.map((l) => ({
        id: `${l.tail}:${l.id}`,
        points: l.points.map(([lat, lon, , ts]) => ({ lat, lon, ts })),
      }))}
    />
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
  const reportLoss = useReportMapLoss();

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
    m.on("webglcontextlost", reportLoss);
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
      releaseMap(m);
    };
  }, [reportLoss]);

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
