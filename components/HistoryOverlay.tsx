"use client";

// History mode on /radar: "show me this plane's flights in November".
//
//   HistoryPill     44px pill in the layer-toggle row; opens the sheet
//   HistorySheet    bottom sheet (phone) / side panel (desktop): period
//                   presets + custom range, aircraft picker, missions
//   HistoryOverlay  owns the applied state, the /api/history fetch, the
//                   map layers, the HISTORY banner, the summary chip and
//                   the tapped-flight mini card
//
// State lives in the URL (?h=1&from=&to=&tail=&mission=, lib/history-
// view.ts) so an overlay is a shareable link. While history is on,
// RadarShell hides live trails and the 30-day heat / paths, and the
// banner says HISTORY so nobody reads it as live.
//
// Map: one GeoJSON source for lines and one for heat (lib/history-
// layers.ts), attached once and updated with setData. Turning history
// off empties and hides them; nothing is re-added on the next toggle.
//
// 3D: the banner's 3D button (`?hview=3d`) lays components/Flight3D.tsx
// over the map with every flight in range stacked over terrain. Loaded
// through next/dynamic, so deck.gl stays out of /radar's first-load JS.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { createPortal } from "react-dom";
import type { Map as MaplibreMap, MapMouseEvent } from "maplibre-gl";
import { SS_TOKENS } from "@/lib/tokens";
import { DEFAULT_MISSIONS, MISSIONS, normalizeMission } from "@/lib/mission";
import { missionLabel } from "@/lib/role-display";
import {
  RIDER_BUCKETS,
  getRegistryTails,
  isEverything,
  toggleEverything,
  toggleMission,
  type RegistryTail,
} from "@/lib/radar-filter";
import {
  HISTORY_COPY,
  HISTORY_FLOOR,
  HISTORY_MAX_TAILS,
  assignTailColors,
  clearHistoryParams,
  formatDayMonYear,
  formatSummaryChip,
  heatToGeoJSON,
  historyApiQuery,
  historySubject,
  parseHistoryParams,
  polylineExtent,
  polylinesToGeoJSON,
  ptDate,
  rangeLabel,
  resolvePreset,
  sameHistoryState,
  serializeHistoryParams,
  type HistoryState,
} from "@/lib/history-view";
import { fitPadding, type Padding } from "@/lib/radar-view";
import {
  historyLineAt,
  setHistoryData,
  setHistoryPalette,
  setHistorySelected,
  setHistoryVisible,
  type HistoryLineKey,
} from "@/lib/history-layers";
import { useHistory } from "@/lib/hooks/useHistory";
import { useHistoryLayers } from "@/lib/hooks/useHistoryLayers";
import { useRadarPalette } from "@/lib/hooks/useRadarPalette";
import type { PaletteId } from "@/lib/radar-palettes";
import type { Mission } from "@/lib/types";
import {
  HISTORY_VIEW_PARAM,
  historyPathKey,
  historyPaths3D,
  parseHistoryPathKey,
  parseMapView,
  tailColors3D,
  withMapView,
} from "@/lib/history-3d";
import type { Flight3DPick } from "./Flight3D";
import { Chip, Eyebrow, FlightMiniCard, PeriodPicker, useIsDesktop } from "./HistoryControls";
import { Pill3D, hasWebGL2 } from "./View3DToggle";
import { displayNickname } from "@/lib/nickname-display";

const Flight3D = nextDynamic(() => import("./Flight3D"), {
  ssr: false,
  loading: () => <div style={{ position: "absolute", inset: 0, background: SS_TOKENS.bg0 }} />,
});

const NO_WEBGL2_NOTE = "3D needs WebGL2, and this browser does not offer it. Flat map it is.";
const DROPPED_NOTE = "3D view dropped out on this device. Back on the flat map.";

/** Vertical space the banner takes under the header (44 + 8 gap). */
export const HISTORY_BANNER_SPACE = 52;

export function HistoryPill({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-haspopup="dialog"
      aria-label={active ? "History on. Change range" : "History. See past flights"}
      data-testid="history-pill"
      className="ss-mono"
      style={{
        padding: "0 14px",
        minHeight: 44,
        borderRadius: 999,
        background: active ? SS_TOKENS.cta : "rgba(11,13,16,0.78)",
        border: `.5px solid ${active ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
        color: active ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
        fontSize: 12,
        letterSpacing: ".06em",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      HISTORY
    </button>
  );
}

type Props = {
  map: MaplibreMap | null;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  onActiveChange: (active: boolean) => void;
  /** Called when history fits the camera to its lines. */
  onCameraFit?: () => void;
  /** Screen space the overlays cover, for fitting the camera to the lines. */
  insets: Padding;
  /** Banner top, just under the header. */
  bannerTop: number;
  /** CSS bottom for the summary chip / flight card, above the pill row. */
  chipBottom: string;
  /** Palette the server rendered with (ss_palette cookie). */
  initialPalette?: PaletteId;
  /** Fired when the history 3D view comes and goes (the static north
   *  indicator steps aside; 3D has its own compass). */
  on3dChange?: (on: boolean) => void;
};

function defaultState(today: string): HistoryState {
  const r = resolvePreset("last7", today) ?? { from: today, to: today };
  return { ...r, tails: [], missions: [...DEFAULT_MISSIONS] };
}

export function HistoryOverlay({
  map,
  sheetOpen,
  onSheetOpenChange,
  onActiveChange,
  onCameraFit,
  insets,
  bannerTop,
  chipBottom,
  initialPalette,
  on3dChange,
}: Props) {
  const [palette] = useRadarPalette(initialPalette);
  const [today, setToday] = useState<string | null>(null);
  const [applied, setApplied] = useState<HistoryState | null>(null);
  const [selected, setSelected] = useState<HistoryLineKey | null>(null);
  const [view3d, setView3d] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Hydrate from the URL once (and on back/forward).
  useEffect(() => {
    const read = () => {
      const t = ptDate(Date.now());
      const params = new URLSearchParams(window.location.search);
      setToday(t);
      setApplied(parseHistoryParams(params, t));
      const want3d = parseMapView(params.get(HISTORY_VIEW_PARAM)) === "3d";
      if (want3d && !hasWebGL2()) setNote(NO_WEBGL2_NOTE);
      setView3d(want3d && hasWebGL2());
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const onActiveRef = useRef(onActiveChange);
  onActiveRef.current = onActiveChange;
  const onCameraFitRef = useRef(onCameraFit);
  onCameraFitRef.current = onCameraFit;
  useEffect(() => {
    onActiveRef.current(applied !== null);
    setSelected(null);
    if (today === null) return;
    // Mirror to the URL without a navigation (a router push would
    // re-render the server page and refetch the live snapshot).
    const cur = new URLSearchParams(window.location.search);
    const next = withMapView(
      applied ? serializeHistoryParams(applied, cur) : clearHistoryParams(cur),
      HISTORY_VIEW_PARAM,
      applied && view3d ? "3d" : "2d",
    );
    const qs = next.toString();
    if (qs !== cur.toString()) {
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", url);
    }
  }, [applied, today, view3d]);

  // A note (no WebGL2, 3D dropped out) shows in the chip slot for a beat.
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(id);
  }, [note]);

  const toggle3d = useCallback(() => {
    if (view3d) return setView3d(false);
    if (!hasWebGL2()) return setNote(NO_WEBGL2_NOTE);
    setNote(null);
    setView3d(true);
  }, [view3d]);
  const on3dUnavailable = useCallback((reason: string) => {
    setView3d(false);
    setNote(reason === "webgl2" ? NO_WEBGL2_NOTE : DROPPED_NOTE);
  }, []);
  const onPick3d = useCallback((p: Flight3DPick | null) => {
    setSelected(p?.kind === "path" ? parseHistoryPathKey(p.id) : null);
  }, []);

  const query = applied ? historyApiQuery(applied) : null;
  const hist = useHistory(query);
  // Only a body for the current query: for one render after a change,
  // useHistory still holds the previous range's data.
  const body = hist.status === "ready" && hist.query === query ? hist.body : null;

  const colors = useMemo(
    () => (body ? assignTailColors(body.polylines.map((p) => p.tail), palette) : {}),
    [body, palette],
  );
  const lines = useMemo(() => (body ? polylinesToGeoJSON(body.polylines, colors) : null), [body, colors]);
  const heat = useMemo(() => (body ? heatToGeoJSON(body.heat.cells) : null), [body]);

  const layersReady = useHistoryLayers(map, { heat: true });

  // Heat in history mode follows the rider's palette too.
  useEffect(() => {
    if (!map || !layersReady) return;
    setHistoryPalette(map, palette);
  }, [map, layersReady, palette]);

  // Push data + visibility. Loading and error states clear the lines so
  // the banner's range never sits over a different range's tracks.
  const lastFitRef = useRef<string | null>(null);
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  useEffect(() => {
    if (!map || !layersReady) return;
    if (!applied) {
      setHistoryData(map, null, null);
      setHistoryVisible(map, false);
      map.getContainer().removeAttribute("data-history-lines");
      lastFitRef.current = null;
      return;
    }
    const pushed = setHistoryData(map, lines, heat);
    setHistoryVisible(map, true);
    // Read-only QA hook (tests/visual/specs/p14-live-prod-audit.spec.ts):
    // how many line features the history source last received.
    if (pushed) map.getContainer().setAttribute("data-history-lines", String(lines?.features.length ?? 0));
    if (body && query && lastFitRef.current !== query) {
      lastFitRef.current = query;
      const ext = polylineExtent(body.polylines);
      if (ext) {
        const el = map.getContainer();
        const pad = fitPadding(el.clientWidth, el.clientHeight, insetsRef.current);
        try {
          map.fitBounds(
            [
              [ext[0], ext[1]],
              [ext[2], ext[3]],
            ],
            { padding: pad, duration: 600, maxZoom: 12, essential: true },
          );
          onCameraFitRef.current?.();
        } catch {
          /* degenerate box */
        }
      }
    }
  }, [map, layersReady, applied, lines, heat, body, query]);

  useEffect(() => {
    if (!map || !layersReady) return;
    setHistorySelected(map, selected);
  }, [map, layersReady, selected]);

  // Tap a line → select that flight; tap empty map → clear.
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  useEffect(() => {
    if (!map || !layersReady) return;
    const onClick = (e: MapMouseEvent) => {
      if (!appliedRef.current) return;
      setSelected(historyLineAt(map, e.point));
    };
    const onMove = (e: MapMouseEvent) => {
      if (!appliedRef.current) return;
      const hit = historyLineAt(map, e.point);
      map.getCanvas().style.cursor = hit ? "pointer" : "";
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
    };
  }, [map, layersReady]);

  const selectedSession = useMemo(() => {
    if (!body || !selected) return null;
    return body.sessions.find((s) => s.id === selected.id && s.tail === selected.tail) ?? null;
  }, [body, selected]);

  // Phones: the tapped-flight card covers the bottom of the map, so
  // fit the selected line into the space above it (card + tab bar).
  const isDesktop = useIsDesktop();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const selectedKey = selectedSession ? `${selectedSession.tail}:${selectedSession.id}` : null;
  useEffect(() => {
    if (!map || isDesktop || !selectedKey || !body) return;
    const line = body.polylines.find((p) => `${p.tail}:${p.id}` === selectedKey);
    const ext = line ? polylineExtent([line]) : null;
    if (!ext) return;
    const raf = requestAnimationFrame(() => {
      const el = map.getContainer();
      const card = cardRef.current;
      if (!card) return;
      // Space from the card's top edge to the map's bottom edge: the
      // card plus the tab bar the map extends behind.
      const covered = Math.max(0, el.getBoundingClientRect().bottom - card.getBoundingClientRect().top);
      // Never scale the bottom padding down (the card must stay clear
      // of the line); shrink the top padding first, keeping a sliver
      // of map for the line itself.
      const bottom = covered + 16;
      const minVisible = 96;
      const top = Math.max(
        8,
        Math.min(insetsRef.current.top, el.clientHeight - bottom - minVisible),
      );
      const pad = { top, bottom, left: 24, right: 24 };
      try {
        map.fitBounds(
          [
            [ext[0], ext[1]],
            [ext[2], ext[3]],
          ],
          { padding: pad, duration: 500, maxZoom: 12, essential: true },
        );
      } catch {
        /* degenerate box */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [map, isDesktop, selectedKey, body]);
  const show3d = applied !== null && view3d;
  const on3dChangeRef = useRef(on3dChange);
  on3dChangeRef.current = on3dChange;
  useEffect(() => {
    on3dChangeRef.current?.(show3d);
  }, [show3d]);
  const selectedPathKey = selected ? historyPathKey(selected) : null;
  const paths3d = useMemo(
    () => (show3d && body ? historyPaths3D(body.polylines, selectedPathKey) : []),
    [show3d, body, selectedPathKey],
  );

  if (today === null) return null;

  const range = applied ? rangeLabel(applied, today) : "";
  let chip: React.ReactNode = null;
  if (applied) {
    const stale = hist.status !== "idle" && hist.query !== query;
    if (note) chip = <StatusChip text={note} />;
    else if (hist.status === "loading" || stale) chip = <StatusChip text={HISTORY_COPY.loading} pending />;
    else if (hist.status === "error") chip = <StatusChip text={HISTORY_COPY[hist.error]} />;
    else if (body && body.summary.flights === 0) chip = <StatusChip text={HISTORY_COPY.empty} />;
    else if (body) {
      // In 3D the ribbons use the 3D palette (lib/history-3d.ts); the
      // legend follows whichever view is on screen.
      const legend = Object.entries(show3d ? tailColors3D(Object.keys(colors)) : colors);
      chip = (
        <div
          data-testid="history-summary"
          data-flights={body.summary.flights}
          data-lines={lines?.features.length ?? 0}
          className="ss-mono"
          style={chipStyle}
        >
          <div style={{ color: SS_TOKENS.fg0 }}>
            {formatSummaryChip({
              subject: historySubject(applied),
              range,
              flights: body.summary.flights,
              airborne_s: body.summary.airborne_s,
            })}
          </div>
          {legend.length > 1 && legend.length <= 6 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 6 }}>
              {legend.map(([tail, color]) => (
                <span key={tail} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: SS_TOKENS.fg1 }}>
                  <span aria-hidden style={{ width: 14, height: 3, borderRadius: 2, background: color }} />
                  {tail}
                </span>
              ))}
            </div>
          )}
          <div style={{ color: SS_TOKENS.fg1, marginTop: 4 }}>Tap a line for the flight.</div>
        </div>
      );
    }
  }

  return (
    <>
      {show3d && (
        <div
          data-testid="history-3d"
          style={{ position: "absolute", inset: 0, zIndex: 5, background: SS_TOKENS.bg0 }}
        >
          <Flight3D
            paths={paths3d}
            fill
            scene="radar-history"
            replay={false}
            annotate={false}
            onPick={onPick3d}
            frameKey={body ? query : null}
            // Under the region picker + compass column (banner, picker
            // row, compass), so nothing in the top bar moves.
            resetInset={{ top: bannerTop + HISTORY_BANNER_SPACE + 90, right: 12 }}
            framePadding={insets}
            onUnavailable={on3dUnavailable}
          />
        </div>
      )}
      {applied && (
        <div
          role="status"
          data-testid="history-banner"
          className="ss-mono"
          style={{
            position: "absolute",
            top: bannerTop,
            left: 12,
            right: 12,
            zIndex: 11,
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            borderRadius: 12,
            // Indigo tint from the heat ramp: clearly not the live UI.
            background: "rgba(36,38,92,0.88)",
            border: ".5px solid rgba(143,169,224,0.45)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            color: SS_TOKENS.fg0,
            fontSize: 12,
            letterSpacing: ".08em",
            maxWidth: 560,
            margin: "0 auto",
          }}
        >
          <button
            type="button"
            onClick={() => onSheetOpenChange(true)}
            aria-label={`History, ${range}. Change range`}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 44,
              padding: "0 12px",
              background: "transparent",
              border: 0,
              color: "inherit",
              font: "inherit",
              letterSpacing: "inherit",
              textAlign: "left",
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              touchAction: "manipulation",
            }}
          >
            <span style={{ fontWeight: 700 }}>HISTORY</span>
            <span style={{ color: SS_TOKENS.fg1 }}> · </span>
            <span>{range}</span>
          </button>
          <Pill3D active={view3d} onClick={toggle3d} variant="banner" testId="history-3d-toggle" />
          <button
            type="button"
            onClick={() => {
              setApplied(null);
              onSheetOpenChange(false);
            }}
            aria-label="Close history, back to live"
            data-testid="history-close"
            style={{
              width: 44,
              height: 44,
              flex: "0 0 44px",
              background: "transparent",
              border: 0,
              color: SS_TOKENS.fg0,
              fontSize: 20,
              lineHeight: 1,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            ×
          </button>
        </div>
      )}

      {applied && (selectedSession || chip) && (
        <div
          ref={cardRef}
          style={{
            position: "absolute",
            left: 12,
            bottom: chipBottom,
            zIndex: 13,
            width: selectedSession ? 340 : undefined,
            maxWidth: "calc(100vw - 24px)",
          }}
        >
          {selectedSession ? (
            <FlightMiniCard session={selectedSession} onClose={() => setSelected(null)} />
          ) : (
            chip
          )}
        </div>
      )}

      {sheetOpen && (
        <HistorySheet
          today={today}
          initial={applied ?? defaultState(today)}
          active={applied !== null}
          onApply={(s) => {
            setApplied((cur) => (sameHistoryState(cur, s) ? cur : s));
            onSheetOpenChange(false);
          }}
          onLive={() => {
            setApplied(null);
            onSheetOpenChange(false);
          }}
          onClose={() => onSheetOpenChange(false)}
        />
      )}
    </>
  );
}

const chipStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  background: "rgba(11,13,16,0.92)",
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  fontSize: 12,
  letterSpacing: ".04em",
  lineHeight: 1.4,
};

function StatusChip({ text, pending }: { text: string; pending?: boolean }) {
  return (
    <div
      className="ss-mono"
      data-testid="history-status"
      aria-busy={pending || undefined}
      style={{ ...chipStyle, color: SS_TOKENS.fg0 }}
    >
      {text}
      {pending && <span style={{ color: SS_TOKENS.fg1 }}> ...</span>}
    </div>
  );
}

// ─── sheet ───────────────────────────────────────────────────────────

function HistorySheet({
  today,
  initial,
  active,
  onApply,
  onLive,
  onClose,
}: {
  today: string;
  initial: HistoryState;
  active: boolean;
  onApply: (s: HistoryState) => void;
  onLive: () => void;
  onClose: () => void;
}) {
  const desktop = useIsDesktop();
  const [draft, setDraft] = useState<HistoryState>(initial);
  const [registry, setRegistry] = useState<RegistryTail[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getRegistryTails().then((r) => {
      if (!cancelled) setRegistry(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byMission = new Map<Mission, RegistryTail[]>();
    for (const r of registry) {
      if (q && !r.tail.toLowerCase().includes(q) && !(r.nickname ?? "").toLowerCase().includes(q)) continue;
      const m = normalizeMission(r.role);
      const list = byMission.get(m) ?? [];
      list.push(r);
      byMission.set(m, list);
    }
    // Tails picked earlier (or from a shared link) that left the registry.
    const known = new Set(registry.map((r) => r.tail));
    const orphans = draft.tails.filter((t) => !known.has(t));
    return {
      list: MISSIONS.filter((m) => byMission.has(m)).map((m) => ({
        mission: m,
        tails: byMission.get(m)!.sort((a, b) => a.tail.localeCompare(b.tail)),
      })),
      orphans,
    };
  }, [registry, search, draft.tails]);

  const toggleTail = (tail: string) => {
    setDraft((d) => {
      const set = new Set(d.tails);
      if (set.has(tail)) set.delete(tail);
      else if (set.size < HISTORY_MAX_TAILS) set.add(tail);
      return { ...d, tails: [...set].sort() };
    });
  };

  const tailsPicked = draft.tails.length > 0;
  const everything = isEverything(draft.missions);

  const panel: React.CSSProperties = desktop
    ? {
        position: "fixed",
        top: 72,
        right: 12,
        bottom: 78,
        width: 380,
        borderRadius: 16,
        zIndex: 30,
      }
    : {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "86dvh",
        borderRadius: "16px 16px 0 0",
        zIndex: 60,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      };

  // Portaled to <body>: RadarShell's <main> is position:fixed, which makes
  // it a stacking context below the tab bar (z 50), so a sheet rendered
  // inside it could never cover the bar.
  return createPortal(
    <>
      {!desktop && (
        <div
          aria-hidden
          onClick={onClose}
          style={{ position: "fixed", inset: 0, zIndex: 59, background: "rgba(0,0,0,0.45)" }}
        />
      )}
      <div
        role="dialog"
        aria-modal={!desktop}
        aria-label="History"
        data-testid="history-sheet"
        style={{
          ...panel,
          display: "flex",
          flexDirection: "column",
          background: "rgba(15,17,21,0.97)",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          color: SS_TOKENS.fg0,
          boxShadow: "0 -8px 32px rgba(0,0,0,0.45)",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 6px 0 16px",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>History</div>
            <div style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
              Flights on record since <span className="ss-mono">{formatDayMonYear(HISTORY_FLOOR)}</span>. Pacific dates.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history panel"
            style={{
              width: 44,
              height: 44,
              background: "transparent",
              border: 0,
              color: SS_TOKENS.fg1,
              fontSize: 20,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            ×
          </button>
        </div>

        <div
          className="ss-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "12px 16px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            WebkitOverflowScrolling: "touch",
          }}
        >
          <PeriodPicker
            today={today}
            value={draft}
            onPick={(r) => setDraft((d) => ({ ...d, from: r.from, to: r.to }))}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Eyebrow>Aircraft</Eyebrow>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Chip active={!tailsPicked} onClick={() => setDraft((d) => ({ ...d, tails: [] }))}>
                Any
              </Chip>
              {draft.tails.map((t) => (
                <Chip key={t} active onClick={() => toggleTail(t)} ariaLabel={`Remove ${t}`}>
                  {t} ×
                </Chip>
              ))}
            </div>
            {registry.length > 8 && (
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tail or nickname"
                aria-label="Search tail or nickname"
                autoComplete="off"
                spellCheck={false}
                className="ss-mono"
                style={{
                  minHeight: 44,
                  padding: "0 12px",
                  borderRadius: 10,
                  background: SS_TOKENS.bg2,
                  border: `.5px solid ${SS_TOKENS.hairline2}`,
                  color: SS_TOKENS.fg0,
                  // 16px stops iOS Safari zooming the page on focus.
                  fontSize: 16,
                  outline: "none",
                }}
              />
            )}
            {groups.list.map((g) => (
              <div key={g.mission} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 12, color: SS_TOKENS.fg2 }}>{missionLabel(g.mission)}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {g.tails.map((r) => (
                    <Chip key={r.tail} active={draft.tails.includes(r.tail)} onClick={() => toggleTail(r.tail)}>
                      {r.tail}
                      {r.nickname ? <span style={{ opacity: 0.7 }}> · {displayNickname(r.nickname)}</span> : null}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
            {registry.length === 0 && (
              <div style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>Loading the registry.</div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Eyebrow>Missions</Eyebrow>
            {tailsPicked && (
              <div style={{ fontSize: 12, color: SS_TOKENS.fg1, lineHeight: 1.4 }}>
                Picked aircraft show whatever their mission. Set Aircraft to Any to filter by mission.
              </div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Chip
                active={everything}
                dim={tailsPicked}
                onClick={() => setDraft((d) => ({ ...d, missions: toggleEverything(d.missions) }))}
              >
                Everything
              </Chip>
              {RIDER_BUCKETS.map((b) => (
                <Chip
                  key={b.id}
                  active={draft.missions.includes(b.id)}
                  dim={tailsPicked}
                  onClick={() => setDraft((d) => ({ ...d, missions: toggleMission(d.missions, b.id) }))}
                >
                  {b.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 16px 12px",
            borderTop: `.5px solid ${SS_TOKENS.hairline2}`,
          }}
        >
          {active && (
            <button type="button" onClick={onLive} className="ss-mono" style={secondaryBtn}>
              Back to live
            </button>
          )}
          <button
            type="button"
            onClick={() => onApply(draft)}
            data-testid="history-apply"
            className="ss-mono"
            style={primaryBtn}
          >
            Show on map
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

const primaryBtn: React.CSSProperties = {
  flex: 1,
  minHeight: 48,
  borderRadius: 999,
  background: SS_TOKENS.cta,
  border: 0,
  color: SS_TOKENS.ctaInk,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: ".06em",
  cursor: "pointer",
  touchAction: "manipulation",
};

const secondaryBtn: React.CSSProperties = {
  flex: "0 0 auto",
  minHeight: 48,
  padding: "0 16px",
  borderRadius: 999,
  background: "transparent",
  border: `.5px solid ${SS_TOKENS.hairline2}`,
  color: SS_TOKENS.fg0,
  fontSize: 13,
  letterSpacing: ".06em",
  cursor: "pointer",
  touchAction: "manipulation",
};
