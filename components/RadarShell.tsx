"use client";

import { geoErrorKind, geoErrorMessage, geoHelpHref } from "@/lib/geo-error";
import { missionLabel } from "@/lib/role-display";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import type { Map as MaplibreMap } from "maplibre-gl";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { SS_TOKENS } from "@/lib/tokens";
import { computeStatus } from "@/lib/status";
import { StatusPill } from "./StatusPill";
import { SpottedButton } from "./SpottedButton";
import { HotZoneLayer, RADAR_DATA_EXTENT_EVENT } from "./HotZoneLayer";
import { FlightPathLayer } from "./FlightPathLayer";
import { UserZoneLayer } from "./UserZoneLayer";
import { AircraftTrailLayer } from "./AircraftTrailLayer";
import { TrailStatusBadge } from "./TrailStatusBadge";
import {
  HISTORY_BANNER_SPACE,
  HistoryOverlay,
  HistoryPill,
} from "./HistoryOverlay";
import { removeUserZone, type UserZone } from "@/lib/user-zones";
import { AddZoneSheet } from "./AddZoneSheet";
import {
  zoneRadiusMi,
  zoneToRemoveOnUndo,
  zoneUndoReducer,
  type ZoneUndo,
} from "@/lib/zone-draft";
import {
  detectProximityHits,
  fireProximityNotifications,
  getProximityThresholdNm,
  isProximityEnabled,
} from "@/lib/proximity-alert";
import { HelpIcon } from "./HelpIcon";
import { Tooltip } from "./Tooltip";
import { FreshnessLabel } from "./FreshnessLabel";
import { RegionSelector } from "./RegionSelector";
import { REGION_CHANGE_EVENT, getRegion } from "@/lib/region-pref";
import type { LeaveReason } from "./RadarMap";
import {
  DEFAULT_RADAR_VIEW,
  isRadarViewId,
  unionBounds,
  type Bounds,
  type RadarViewId,
} from "@/lib/radar-view";
import {
  DEFAULT_RADAR_FILTER,
  RADAR_FILTER_CHANGE_EVENT,
  passesAircraftFilter,
  readRadarFilter,
  type RadarFilter,
} from "@/lib/radar-filter";
import type { Aircraft, FleetEntry, Snapshot } from "@/lib/types";
import type { LearningState } from "@/lib/learning";
import type { PaletteId } from "@/lib/radar-palettes";
import { LIVE_VIEW_PARAM, parseMapView, withMapView } from "@/lib/history-3d";
import { Pill3D, hasWebGL2 } from "./View3DToggle";
import { displayNickname } from "@/lib/nickname-display";

export type RiderPos = { lat: number; lon: number };

const RadarMap = nextDynamic(() => import("./RadarMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: SS_TOKENS.bg0,
      }}
    />
  ),
});

// Live 3D (`?view=3d`). This chunk and the deck.gl one behind it load only
// once a rider turns 3D on.
const RadarLive3D = nextDynamic(() => import("./RadarLive3D"), { ssr: false });

// Phone tab bar height. From 1024 px the bar becomes a left rail
// (app/globals.css sets --ss-tabbar-h to 0 there), so bottom overlays
// drop to the screen edge instead of floating over an empty band.
const TABBAR_HEIGHT = 66;
const TABBAR_CSS = "var(--ss-tabbar-h, 66px)";
const RAIL_QUERY = "(min-width: 1024px)";

function useTabbarHeight(): number {
  const [h, setH] = useState(TABBAR_HEIGHT);
  useEffect(() => {
    const mq = window.matchMedia(RAIL_QUERY);
    const sync = () => setH(mq.matches ? 0 : TABBAR_HEIGHT);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return h;
}
/** Top of the region picker + freshness row, just under the header. */
const PICKER_TOP = 60;
/** Street zoom the map opens at on the rider (RadarMap RIDER_ZOOM). */
const NEAR_ME_ZOOM = 11;

type Props = {
  initial: Snapshot;
  mockOn?: boolean;
  learning?: LearningState;
  /** ms-since-epoch of the most recent track sample. null = unknown. */
  lastSampleMs?: number | null;
  /** Radar colour palette from the ss_palette cookie (lib/user-prefs.ts). */
  palette?: PaletteId;
};

export function RadarShell({
  initial,
  mockOn = false,
  learning,
  lastSampleMs = null,
  palette,
}: Props) {
  const snap = useAircraft(initial, mockOn);
  const fleetMap = useMemo(
    () => new Map<string, FleetEntry>(snap.aircraft.map((a) => [a.tail, a])),
    [snap.aircraft],
  );
  const status = useMemo(() => computeStatus(snap, fleetMap), [snap, fleetMap]);
  // Mirror the heatmap chevron's filter so aircraft markers stay in sync —
  // tapping "Smokey only" should hide non-smokey markers as well as
  // non-smokey heat. Read once on mount and subscribe to the shared
  // change event for cross-component updates.
  const [radarFilter, setRadarFilter] = useState<RadarFilter>(
    DEFAULT_RADAR_FILTER,
  );
  useEffect(() => {
    setRadarFilter(readRadarFilter());
    const onFilterChange = (e: Event) => {
      const detail = (e as CustomEvent<RadarFilter>).detail;
      if (detail) setRadarFilter(detail);
    };
    window.addEventListener(RADAR_FILTER_CHANGE_EVENT, onFilterChange);
    return () => {
      window.removeEventListener(RADAR_FILTER_CHANGE_EVENT, onFilterChange);
    };
  }, []);
  const airborne = useMemo(
    () =>
      snap.aircraft.filter(
        (a) => a.airborne && passesAircraftFilter(a, radarFilter),
      ),
    [snap.aircraft, radarFilter],
  );
  const total = snap.aircraft.length;
  const pillKind = status.kind;
  const pillTooltip =
    status.kind === "alert"
      ? `${status.alertCount} Smokey up. Only Smokey-class tails turn the status orange.`
      : status.lead
        ? `Nothing alerting. ${displayNickname(status.lead.entry.nickname) ?? status.lead.aircraft.tail} is up, classed ${missionLabel(status.lead.entry.role)}.`
        : `Nothing in our ${total}-tail registry is up.`;
  const counterColor =
    status.alertCount > 0 ? SS_TOKENS.alert : SS_TOKENS.fg1;

  const [rider, setRider] = useState<RiderPos | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // A help link riding on one toast message (the iPhone location block
  // points at /help/iphone). Shown only while that exact message is up.
  const [toastLink, setToastLink] = useState<{ message: string; href: string } | null>(null);
  // + opens the add-zone sheet; a save leaves an undo toast.
  const [addZoneOpen, setAddZoneOpen] = useState(false);
  const [zoneUndo, dispatchZoneUndo] = useReducer(
    zoneUndoReducer,
    { kind: "idle" } as ZoneUndo,
  );
  useEffect(() => {
    if (zoneUndo.kind === "idle") return;
    const id = setTimeout(
      () => dispatchZoneUndo({ type: "tick", now: Date.now() }),
      Math.max(0, zoneUndo.until - Date.now()),
    );
    return () => clearTimeout(id);
  }, [zoneUndo]);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [showRings, setShowRings] = useState(false);
  // Region = camera preset (lib/radar-view.ts), never a data filter.
  // viewId is the last pick (persisted); viewCustom flips on once the
  // camera moves off it; fitNonce makes a re-pick of the same view
  // refit. The map waits for `viewHydrated` so it opens on the saved
  // view instead of flying there from the default.
  const [viewId, setViewId] = useState<RadarViewId>(DEFAULT_RADAR_VIEW);
  const [viewCustom, setViewCustom] = useState(false);
  // The camera left the pick to centre on the rider: the picker reads
  // "Near me" rather than "Custom".
  const [viewNearMe, setViewNearMe] = useState(false);
  // ?region=<id> opened this view: hold it, no rider auto-zoom.
  const [viewFromUrl, setViewFromUrl] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);
  const [viewHydrated, setViewHydrated] = useState(false);
  const [dataExtent, setDataExtent] = useState<Bounds | null>(null);
  // History mode (components/HistoryOverlay.tsx): past flights for a
  // date range. Hides live trails + the 30-day layers and pushes the
  // top-row controls down under the HISTORY banner.
  const [historyOn, setHistoryOn] = useState(false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const topShift = historyOn ? HISTORY_BANNER_SPACE : 0;
  // Set when history fit the camera; on exit the picked region is
  // restored (refit) so the picker's name matches the map again.
  const historyMovedCameraRef = useRef(false);
  const prevHistoryOnRef = useRef(false);
  useEffect(() => {
    const was = prevHistoryOnRef.current;
    prevHistoryOnRef.current = historyOn;
    if (was && !historyOn && historyMovedCameraRef.current) {
      historyMovedCameraRef.current = false;
      setViewCustom(false);
      setViewNearMe(false);
      setFitNonce((n) => n + 1);
    }
  }, [historyOn]);
  // Live 3D: hydrated from `?view=3d`, mirrored back with replaceState.
  // History mode has its own 3D switch in its banner.
  const [live3d, setLive3d] = useState(false);
  // History mode's own 3D view (reported by HistoryOverlay).
  const [history3d, setHistory3d] = useState(false);
  useEffect(() => {
    const want = parseMapView(new URLSearchParams(window.location.search).get(LIVE_VIEW_PARAM)) === "3d";
    if (want && !hasWebGL2()) flashToast(setToast, "3D needs WebGL2 · flat map");
    setLive3d(want && hasWebGL2());
  }, []);
  const setLive3dUrl = (on: boolean) => {
    setLive3d(on);
    const qs = withMapView(window.location.search, LIVE_VIEW_PARAM, on ? "3d" : "2d").toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
    );
  };
  // Hydrate the rings pref + region from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setShowRings(window.localStorage.getItem("ss_distance_rings_visible") === "1");
    } catch {
      /* storage blocked: rings start off */
    }
    // ?region=puget_sound opens on that region for this visit (a shared
    // link), without changing the rider's saved default.
    const fromUrl = new URLSearchParams(window.location.search).get("region");
    if (isRadarViewId(fromUrl)) {
      setViewId(fromUrl);
      setViewFromUrl(true);
    } else {
      setViewId(getRegion());
    }
    setViewHydrated(true);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ id: RadarViewId }>).detail;
      setViewId(detail?.id ?? getRegion());
      setViewCustom(false);
      setViewNearMe(false);
      setFitNonce((n) => n + 1);
    };
    // Heat + route layers report their data extent; the union is what
    // the "Everything" preset frames.
    const extents: Record<string, Bounds | null> = {};
    const onExtent = (e: Event) => {
      const detail = (
        e as CustomEvent<{ source: string; bounds: Bounds | null }>
      ).detail;
      if (!detail?.source) return;
      extents[detail.source] = detail.bounds ?? null;
      setDataExtent(
        Object.values(extents).reduce<Bounds | null>(
          (acc, b) => unionBounds(acc, b),
          null,
        ),
      );
    };
    window.addEventListener(REGION_CHANGE_EVENT, onChange);
    window.addEventListener(RADAR_DATA_EXTENT_EVENT, onExtent);
    return () => {
      window.removeEventListener(REGION_CHANGE_EVENT, onChange);
      window.removeEventListener(RADAR_DATA_EXTENT_EVENT, onExtent);
    };
  }, []);
  // Persist on the rider's tap only. A mount-time write raced the read
  // above and could store "0" over a saved "1".
  const toggleRings = () => {
    setShowRings((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("ss_distance_rings_visible", next ? "1" : "0");
      } catch {
        /* storage blocked: the choice lasts for this page only */
      }
      return next;
    });
  };

  // Foreground proximity alerts. Runs whenever snap.aircraft changes
  // (every poll cycle from useAircraft) — when a tracked alert-tier
  // tail enters the rider's threshold, fire a local notification via
  // the SW. No server-side rider position storage; pure client logic.
  // Per-tail cooldown lives in localStorage to prevent re-firing
  // every 10s while a plane orbits within range.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    if (!rider) return;
    if (!isProximityEnabled()) return;
    const hits = detectProximityHits(
      snap.aircraft,
      rider,
      getProximityThresholdNm(),
    );
    if (hits.length > 0) void fireProximityNotifications(hits);
  }, [snap.aircraft, rider]);

  // Geolocation only kicks in when this component mounts — i.e. when the user
  // actually visits /radar. The home page never asks.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      flashToast(setToast, "Location off · radar still works");
      return;
    }
    let waitingToastShown = false;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setRider({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        // A slow first fix is not "off"; only say so once per mount.
        if (geoErrorKind(err?.code) === "waiting") {
          if (waitingToastShown) return;
          waitingToastShown = true;
        }
        const blocked = geoErrorKind(err?.code) === "blocked";
        const message = geoErrorMessage(err?.code, navigator.userAgent);
        const href = geoHelpHref(err?.code, navigator.userAgent);
        setToastLink(href ? { message, href } : null);
        flashToast(setToast, message, blocked ? 9000 : 4000);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // No geolocation region auto-pick any more: the region is a camera
  // preset, and RadarMap already opens on the rider at street zoom the
  // first time their position resolves (the picker then reads Custom).

  const bottomBoost = airborne.length > 0 ? 130 : 0;
  const tabbarH = useTabbarHeight();
  // Overlay space the fit keeps the region box clear of: header on top;
  // tab bar + pill row (+ carousel when planes are up) at the bottom.
  const fitInsets = useMemo(
    () => ({
      // Header + the picker row under it.
      top: PICKER_TOP + 44 + 12,
      bottom: tabbarH + 16 + 44 + 12 + bottomBoost,
      left: 16,
      right: 16,
    }),
    [bottomBoost, tabbarH],
  );
  const historyInsets = useMemo(
    () => ({
      ...fitInsets,
      top: fitInsets.top + HISTORY_BANNER_SPACE,
      // Summary chip, which sits above the rings + history row and
      // clears the spotted button.
      bottom: fitInsets.bottom + 96,
    }),
    [fitInsets],
  );
  const rowBottom = tabbarH + 16 + bottomBoost;

  return (
    <main
      // app/globals.css lifts the map attribution above the tab bar here.
      className="ss-radar-shell"
      data-history={historyOn ? "on" : "off"}
      style={{
        position: "fixed",
        inset: 0,
        paddingBottom: TABBAR_CSS,
      }}
    >
      {viewHydrated && (
        <RadarMap
          aircraft={airborne}
          rider={rider}
          showDistanceRings={showRings}
          viewId={viewId}
          fitNonce={fitNonce}
          dataExtent={dataExtent}
          insets={fitInsets}
          onLeaveView={(reason: LeaveReason) => {
            setViewCustom(true);
            setViewNearMe(reason === "rider");
          }}
          onMapReady={setMap}
          cameraLocked={historyOn}
          viewLocked={viewFromUrl}
          palette={palette}
        />
      )}
      {live3d && !historyOn && (
        <RadarLive3D
          airborne={airborne}
          renderCard={(a) => <PlaneCard p={a} />}
          resetInset={{ top: PICKER_TOP + 90, right: 12 }}
          framePadding={{ top: PICKER_TOP, bottom: rowBottom + 44, left: 0, right: 60 }}
          // Just above the RINGS / HISTORY / 3D row.
          cardBottom={`calc(${rowBottom + 52}px + var(--ss-install-prompt-h, 0px))`}
          onUnavailable={() => {
            setLive3dUrl(false);
            flashToast(setToast, "3D dropped out · flat map");
          }}
        />
      )}
      <HotZoneLayer
        map={map}
        bottomBoost={airborne.length > 0 ? 130 : 0}
        learning={learning}
        // 3D draws neither heat nor 30-day paths, so their row steps aside.
        suppressed={historyOn || live3d}
        initialPalette={palette}
        // LAYERS sits under the + in the top-left column.
        layersTop={PICKER_TOP + 44 + 52}
        layersBottomReserve={`calc(${rowBottom + 88 + 12}px + var(--ss-install-prompt-h, 0px))`}
      />
      <FlightPathLayer map={map} suppressed={historyOn || live3d} initialPalette={palette} />
      <UserZoneLayer map={map} />
      <AircraftTrailLayer map={map} airborne={airborne} hidden={historyOn} />
      <HistoryOverlay
        map={map}
        sheetOpen={historySheetOpen}
        onSheetOpenChange={setHistorySheetOpen}
        onActiveChange={setHistoryOn}
        onCameraFit={() => {
          // History moved the camera off the picked region.
          historyMovedCameraRef.current = true;
          setViewCustom(true);
          setViewNearMe(false);
        }}
        insets={historyInsets}
        bannerTop={PICKER_TOP}
        chipBottom={`calc(${rowBottom + 80}px + var(--ss-install-prompt-h, 0px))`}
        initialPalette={palette}
        on3dChange={setHistory3d}
      />
      <AddZoneButton
        // Under the freshness chip (top 60, ~34 px tall), so a long
        // "SAMPLE UNKNOWN" label never runs over it on a phone.
        top={PICKER_TOP + 44 + topShift}
        open={addZoneOpen}
        onClick={() => setAddZoneOpen((v) => !v)}
      />
      {addZoneOpen && (
        <AddZoneSheet
          map={map}
          rider={rider}
          top={PICKER_TOP + 44 + topShift}
          bottom={TABBAR_CSS}
          onClose={() => setAddZoneOpen(false)}
          onSaved={(z: UserZone) => {
            setAddZoneOpen(false);
            dispatchZoneUndo({
              type: "added",
              zoneId: z.id,
              name: z.label,
              radiusMi: zoneRadiusMi(z),
              now: Date.now(),
            });
          }}
        />
      )}
      <DistanceRingsToggle
        active={showRings}
        onToggle={toggleRings}
        bottom={`calc(${
          16 + (airborne.length > 0 ? 130 : 0)
        }px + ${TABBAR_CSS} + var(--ss-install-prompt-h, 0px))`}
        disabled={!rider}
        raised={!historyOn && !live3d}
        trailing={
          <>
            <HistoryPill
              active={historyOn}
              onClick={() => setHistorySheetOpen(true)}
            />
            {!historyOn && (
              <Pill3D
                active={live3d}
                testId="radar-3d-toggle"
                onClick={() => {
                  if (!live3d && !hasWebGL2()) {
                    flashToast(setToast, "3D needs WebGL2 · flat map");
                    return;
                  }
                  setLive3dUrl(!live3d);
                }}
              />
            )}
          </>
        }
      />
      {/* PROMPT_19C diagnostic — sits two rows above the HOT ZONES /
          FLIGHT PATHS pill row (which is at TABBAR_HEIGHT + 16 +
          bottomBoost) and one row above DistanceRingsToggle (+44).
          The calc() adds the iOS install-prompt overlay height so
          the badge stays visible above the prompt on iOS Safari.
          Removed in the follow-up PR once trail rendering is
          confirmed in the wild. */}
      {!historyOn && !live3d && (
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: `calc(${
              16 + (airborne.length > 0 ? 130 : 0) + 88
            }px + ${TABBAR_CSS} + var(--ss-install-prompt-h, 0px))`,
            zIndex: 12,
          }}
        >
          <TrailStatusBadge airborne={airborne} />
        </div>
      )}
      <HelpIcon />

      <header
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          // Right padding 96px reserves room for the fixed wake-lock
          // button (right:12) AND the help icon (right:52) so the
          // airborne counter never tucks under either.
          padding: "12px 96px 12px 16px",
          background: "rgba(11,13,16,.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: `.5px solid ${SS_TOKENS.hairline}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          zIndex: 10,
        }}
      >
        <div
          // History mode: the HISTORY banner is the state. The live pill
          // and counter step back so they don't read as the past's status.
          aria-hidden={historyOn || undefined}
          data-testid="radar-live-status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flex: "1 1 auto",
            minWidth: 0,
            opacity: historyOn ? 0.32 : 1,
            filter: historyOn ? "grayscale(1)" : undefined,
            pointerEvents: historyOn ? "none" : undefined,
            transition: "opacity 240ms ease-out",
          }}
        >
        <StatusPill
          kind={pillKind}
          label={status.pill}
          sub={status.pillSub}
          big
          tooltip={pillTooltip}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Tooltip
            side="bottom"
            align="end"
            content="How many of our 16 tracked tails are up right now."
          >
            <span
              className="ss-mono"
              tabIndex={0}
              style={{
                fontSize: 12,
                color: counterColor,
                letterSpacing: ".06em",
                cursor: "help",
              }}
            >
              {airborne.length}/{total} UP
            </span>
          </Tooltip>
        </div>
        </div>
      </header>

      {/* Region picker: a camera control in the map's top-right
          corner, under the header. Jumps the view; never filters the
          heat or routes. */}
      {/* Hidden in history mode: history frames its own flights and
          locks the camera, so a live region pick means nothing there. */}
      {!historyOn && (
        <div
          style={{
            position: "absolute",
            top: PICKER_TOP + topShift,
            right: 12,
            zIndex: 10,
          }}
        >
          <RegionSelector
            value={viewId}
            custom={viewCustom}
            nearMe={viewCustom && viewNearMe && !!rider}
            onNearMe={
              rider
                ? () => {
                    setViewCustom(true);
                    setViewNearMe(true);
                    map?.flyTo({
                      center: [rider.lon, rider.lat],
                      zoom: NEAR_ME_ZOOM,
                      duration: 900,
                    });
                  }
                : undefined
            }
            style={{ maxWidth: 190 }}
          />
        </div>
      )}

      {/* 3D carries its own compass (Map3DControls); a fixed "north is
          up" mark would be wrong once the rider rotates. */}
      {!(live3d && !historyOn) && !(historyOn && history3d) && (
        <CompassN top={PICKER_TOP + 52 + topShift} />
      )}

      {!historyOn && (
      <div
        data-testid="radar-freshness"
        style={{
          position: "absolute",
          top: 60 + topShift,
          left: 12,
          padding: "4px 8px",
          borderRadius: 6,
          background: "rgba(11,13,16,0.7)",
          border: `.5px solid ${SS_TOKENS.hairline}`,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          zIndex: 10,
        }}
      >
        <FreshnessLabel lastSampleMs={lastSampleMs} />
      </div>
      )}

      {airborne.length > 0 && <Carousel airborne={airborne} />}

      <SpottedButton airborne={airborne} toastTop={TOAST_TOP_CSS(topShift)} />

      {zoneUndo.kind !== "idle" ? (
        <Toast
          message={zoneUndo.text}
          top={TOAST_TOP_CSS(topShift)}
          testId="zone-undo-toast"
          action={
            zoneUndo.kind === "added"
              ? {
                  label: "Undo",
                  onClick: () => {
                    const id = zoneToRemoveOnUndo(zoneUndo, Date.now());
                    if (id) removeUserZone(id);
                    dispatchZoneUndo({ type: "undo", now: Date.now() });
                  },
                }
              : undefined
          }
        />
      ) : (
        toast && (
          <Toast
            message={toast}
            top={TOAST_TOP_CSS(topShift)}
            link={toastLink?.message === toast ? { label: "Steps", href: toastLink.href } : undefined}
          />
        )
      )}
    </main>
  );
}

function flashToast(
  setter: (msg: string | null) => void,
  message: string,
  durationMs = 4000,
) {
  setter(message);
  setTimeout(() => setter(null), durationMs);
}

// Toasts sit at the top of the map, under the picker row and between
// the + and the compass, so they never cover the bottom pill rows
// (HOT ZONES, RINGS, TRAIL) or the SPOTTED button.
function TOAST_TOP_CSS(topShift: number): string {
  return `${PICKER_TOP + 52 + topShift}px`;
}

// "+" floating button: opens the add-zone sheet (components/
// AddZoneSheet.tsx), where the rider names the zone, picks a radius and
// a centre (GPS or a dropped pin) before anything is saved.
function AddZoneButton({
  top,
  open,
  onClick,
}: {
  top: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip side="right" content="Add a zone: alerts when Smokey goes up near it">
      <button
        type="button"
        onClick={onClick}
        aria-label="Add a zone"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="radar-add-zone"
        style={{
          position: "absolute",
          top,
          left: 12,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: `.5px solid ${open ? SS_TOKENS.fg1 : SS_TOKENS.hairline2}`,
          background: open ? "rgba(30,34,41,0.94)" : "rgba(11,13,16,.7)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: SS_TOKENS.fg0,
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
          zIndex: 10,
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        +
      </button>
    </Tooltip>
  );
}

function Toast({
  message,
  top,
  action,
  link,
  testId,
}: {
  message: string;
  top: string;
  action?: { label: string; onClick: () => void };
  /** A page link instead of a button (same look, real navigation). */
  link?: { label: string; href: string };
  testId?: string;
}) {
  const hasControl = Boolean(action || link);
  return (
    <div
      role="status"
      data-testid={testId ?? "radar-toast"}
      style={{
        position: "absolute",
        // Between the + (left 12, 44 wide) and the compass (right 20).
        left: 64,
        right: 56,
        top,
        zIndex: 20,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          maxWidth: 420,
          padding: hasControl ? "0 0 0 12px" : "10px 12px",
          minHeight: hasControl ? 44 : undefined,
          borderRadius: 10,
          background: "rgba(21,24,29,0.96)",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: SS_TOKENS.fg0,
          fontSize: 13,
          lineHeight: 1.3,
          pointerEvents: "auto",
        }}
      >
        <span>{message}</span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            style={{
              minHeight: 44,
              minWidth: 44,
              padding: "0 12px",
              background: "transparent",
              border: 0,
              color: SS_TOKENS.sky,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            {action.label}
          </button>
        )}
        {link && !action && (
          <Link
            href={link.href}
            data-testid="radar-toast-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              flexShrink: 0,
              minHeight: 44,
              minWidth: 44,
              padding: "0 12px",
              color: SS_TOKENS.sky,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              touchAction: "manipulation",
            }}
          >
            {link.label}
          </Link>
        )}
      </div>
    </div>
  );
}

function CompassN({ top }: { top: number }) {
  return (
    <Tooltip side="left" content="Map orientation: north is up.">
      <div
        className="ss-mono"
        tabIndex={0}
        aria-label="Map north indicator"
        style={{
          position: "absolute",
          // Sits under the region picker (PICKER_TOP + 44 + 8).
          top,
          right: 20,
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          background: "rgba(11,13,16,.7)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: SS_TOKENS.fg1,
          zIndex: 10,
          cursor: "help",
        }}
      >
        N
      </div>
    </Tooltip>
  );
}

function Carousel({ airborne }: { airborne: Aircraft[] }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: TABBAR_CSS,
        padding: "8px 16px 12px",
        background:
          "linear-gradient(to top, rgba(11,13,16,.92) 60%, rgba(11,13,16,0))",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 10,
      }}
    >
      <div
        className="ss-eyebrow"
        style={{ marginBottom: 8, paddingLeft: 2 }}
      >
        Up right now · tap to track
      </div>
      <div
        className="ss-scroll"
        style={{
          display: "flex",
          gap: 10,
          overflowX: "auto",
          // Allow cards to bleed into right edge; iOS smooth scroll.
          WebkitOverflowScrolling: "touch",
        }}
      >
        {airborne.map((p) => (
          <PlaneCard key={p.tail} p={p} />
        ))}
      </div>
    </div>
  );
}

function PlaneCard({ p }: { p: Aircraft }) {
  return (
    <Link
      href={`/plane/${p.tail}`}
      prefetch={false}
      style={{
        flex: "0 0 auto",
        minWidth: 200,
        padding: 12,
        borderRadius: 12,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: SS_TOKENS.alert,
            animation: "ss-blink 1.6s infinite",
          }}
        />
        <span
          className="ss-mono"
          style={{ fontSize: 13, fontWeight: 600, color: SS_TOKENS.fg0 }}
        >
          {p.tail}
        </span>
        {p.nickname && (
          <span style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
            &ldquo;{displayNickname(p.nickname)}&rdquo;
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 5 }}>
        {p.operator}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <Stat
          label="ALT"
          value={
            p.altitude_ft != null
              ? `${p.altitude_ft.toLocaleString()}′`
              : "—"
          }
        />
        <Stat
          label="GS"
          value={p.ground_speed_kt != null ? `${p.ground_speed_kt}kt` : "—"}
        />
        <Stat
          label="TIME"
          value={p.time_aloft_min != null ? `${p.time_aloft_min}m` : "—"}
        />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg1,
          letterSpacing: ".08em",
        }}
      >
        {label}
      </div>
      <div
        className="ss-mono"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: SS_TOKENS.fg0,
          marginTop: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DistanceRingsToggle({
  active,
  onToggle,
  bottom,
  disabled,
  raised = true,
  trailing,
}: {
  active: boolean;
  onToggle: () => void;
  bottom: number | string;
  disabled?: boolean;
  /** Sit one row (44px) above `bottom`. False in history mode, where
   *  the hot-zone pill row is hidden and this row drops into its slot. */
  raised?: boolean;
  /** Controls placed to the right of the toggle (the HISTORY pill). */
  trailing?: React.ReactNode;
}) {
  // Sit just above the hot-zones toggle row so it doesn't compete for the
  // same horizontal space. Also disabled when there's no rider position to
  // pin the rings to — the toggle stays visible (so the user knows the
  // feature exists) but greys out.
  const lift = raised ? 44 : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom:
          typeof bottom === "number"
            ? bottom + lift
            : `calc(${bottom} + ${lift}px)`,
        zIndex: 12,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
    <Tooltip
      side="top"
      align="start"
      content={
        disabled
          ? "Distance rings need your location. Allow location access on /radar."
          : "5, 10 and 15 mi rings around your position. Tap to toggle."
      }
    >
      <button
        type="button"
        onClick={() => {
          if (!disabled) onToggle();
        }}
        aria-pressed={active}
        aria-disabled={disabled}
        className="ss-mono"
        style={{
          minHeight: 44,
          padding: "0 14px",
          borderRadius: 999,
          background: "rgba(11,13,16,0.78)",
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: disabled
            ? SS_TOKENS.fg3
            : active
              ? SS_TOKENS.fg0
              : SS_TOKENS.fg1,
          fontSize: 12,
          letterSpacing: ".06em",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          cursor: disabled ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {active ? "● RINGS" : "○ RINGS"}
      </button>
    </Tooltip>
    {trailing}
    </div>
  );
}
