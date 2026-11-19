"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  Map as MaplibreMap,
  GeoJSONSource,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import { applyNeutralBasemap, basemapStyleUrl } from "@/lib/basemap";
import "maplibre-gl/dist/maplibre-gl.css";
import { SS_TOKENS } from "@/lib/tokens";
import type { Aircraft, FleetRole } from "@/lib/types";
import {
  LIVE_GLYPH,
  LIVE_MARKER_SIZE,
  glyphRoleFor,
  isAlertGlyph,
  liveAircraftSvg,
  type GlyphRole,
} from "@/lib/brand/aircraft-glyphs";
import type { PaletteId, RadarPalette } from "@/lib/radar-palettes";
import { useRadarPalette } from "@/lib/hooks/useRadarPalette";
import {
  boundsForView,
  fitPadding,
  toLngLatBounds,
  type Bounds,
  type Padding,
  type RadarViewId,
} from "@/lib/radar-view";

// Camera ease when the rider picks a region. Short: it is a jump, not
// a tour.
const VIEW_FIT_MS = 700;
// Street-level zoom used the first time the rider's geolocation resolves
// — opens the map on the rider's actual neighborhood instead of the
// whole Puget Sound region.
const RIDER_ZOOM = 11;

// 1 nautical mile in degrees latitude (constant). Longitude varies with
// latitude — use cos(lat) to scale per-ring.
const NM_PER_DEG_LAT = 1 / 60;
const RING_SEGMENTS = 64;

function nmToDegLat(nm: number): number {
  return nm * NM_PER_DEG_LAT;
}

function circleRingCoords(
  centerLat: number,
  centerLon: number,
  radiusNm: number,
): Array<[number, number]> {
  const dLat = nmToDegLat(radiusNm);
  const dLon = dLat / Math.max(0.01, Math.cos((centerLat * Math.PI) / 180));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const theta = (i / RING_SEGMENTS) * 2 * Math.PI;
    out.push([centerLon + dLon * Math.sin(theta), centerLat + dLat * Math.cos(theta)]);
  }
  return out;
}

// Aircraft glyphs are role-keyed images in MapLibre's image atlas. We
// load one per role at map-init and the symbol layer's icon-image
// expression picks the right one per feature via properties.icon.
// 'unknown' maps to 'aircraft-smokey' (see glyphRoleFor — conservative
// alert default, matches computeStatus()).
// Live markers (lib/brand/aircraft-glyphs.ts liveAircraftSvg): near-white
// glyph on a dark halo disc with an identity ring, so a live tail never
// gets lost in warm heat. Rasterised at 2x and registered with
// pixelRatio 2 so the ring stays crisp on phones.
const MARKER_PIXEL_RATIO = 2;
const MARKER_BITMAP = LIVE_MARKER_SIZE * MARKER_PIXEL_RATIO;
const AIRCRAFT_ICON_SCALE = 0.95; // layer icon-size; marker ~42 px on screen
// Ring radius on screen, for the pulse that breathes out from it.
const MARKER_RING_PX = 19.2 * (LIVE_MARKER_SIZE / 44) * AIRCRAFT_ICON_SCALE;
const PULSE_LAYER = "aircraft-pulse";
const PULSE_MS = 1800;
const ROLE_ICON_KEY: Record<GlyphRole, string> = {
  smokey: "aircraft-smokey",
  patrol: "aircraft-patrol",
  sar: "aircraft-sar",
  transport: "aircraft-transport",
};

/** Icon keys that carry the alert (police) treatment. */
const ALERT_ICON_KEYS = new Set(
  (Object.entries(ROLE_ICON_KEY) as Array<[GlyphRole, string]>)
    .filter(([role]) => isAlertGlyph(role))
    .map(([, key]) => key),
);

function iconForRole(role: FleetRole | undefined | null, model?: string | null): string {
  return ROLE_ICON_KEY[glyphRoleFor(role, model)];
}

const RIDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="${SS_TOKENS.sky}" fill-opacity="0.10"/><circle cx="24" cy="24" r="12" fill="${SS_TOKENS.sky}" fill-opacity="0.22"/><circle cx="24" cy="24" r="6" fill="${SS_TOKENS.sky}" stroke="white" stroke-width="2"/></svg>`;

function markerBitmaps(p: RadarPalette): Promise<ImageBitmap[]> {
  const roles = Object.keys(ROLE_ICON_KEY) as GlyphRole[];
  return Promise.all(
    roles.map((role) =>
      loadSvgBitmap(
        liveAircraftSvg(role, {
          halo: p.live.halo,
          haloOpacity: p.live.haloOpacity,
          size: MARKER_BITMAP,
        }),
        MARKER_BITMAP,
      ),
    ),
  );
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

async function loadSvgBitmap(svg: string, size: number): Promise<ImageBitmap> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(size, size);
    img.src = url;
    await img.decode();
    return await createImageBitmap(img, { resizeWidth: size, resizeHeight: size });
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Snapshot = {
  fromByTail: Map<string, [number, number]>;
  toByTail: Map<string, [number, number]>;
  metaByTail: Map<
    string,
    { icon: string; track: number; nickname: string | null }
  >;
  startedAt: number;
};

const EMPTY_SNAPSHOT: Snapshot = {
  fromByTail: new Map(),
  toByTail: new Map(),
  metaByTail: new Map(),
  startedAt: 0,
};

const ANIM_MS = 1000;

// Re-center the map on the followed plane when EITHER:
//   (a) absolute screen distance from center exceeds FOLLOW_RECENTER_PX, OR
//   (b) the plane is within FOLLOW_EDGE_MARGIN of any viewport edge.
// (a) catches a plane orbiting wide across the screen; (b) catches a
// plane creeping toward an edge slowly. Without (b), a plane drifting
// roughly toward a corner could approach the edge without ever crossing
// the absolute-distance threshold.
const FOLLOW_RECENTER_PX = 200;
const FOLLOW_EDGE_MARGIN_RATIO = 0.2;

type RiderPos = { lat: number; lon: number };

export default function RadarMap({
  aircraft,
  rider,
  showDistanceRings = false,
  viewId,
  fitNonce = 0,
  dataExtent = null,
  insets,
  onLeaveView,
  onMapReady,
  cameraLocked = false,
  palette: initialPalette,
}: {
  aircraft: Aircraft[];
  rider: RiderPos | null;
  showDistanceRings?: boolean;
  /** Camera preset (lib/radar-view.ts). The map opens fitted to it and
   *  fits again whenever it or `fitNonce` changes. Camera only: it
   *  never filters the heat or route layers. */
  viewId: RadarViewId;
  /** Bumped on every region pick so re-picking the same view refits. */
  fitNonce?: number;
  /** Union of loaded heat + route extents, framed by "everything". */
  dataExtent?: Bounds | null;
  /** Screen space the overlays cover (header, pill row, tab bar). */
  insets: Padding;
  /** Fired when the camera moves off the picked view (rider gesture,
   *  rider auto-zoom, auto-recenter, follow-a-plane). */
  onLeaveView?: () => void;
  onMapReady?: (map: MaplibreMap | null) => void;
  /** History mode fits the camera to past flights; once set, the rider
   *  auto-zoom and 5 s auto-recenter stand down (same as a region pick). */
  cameraLocked?: boolean;
  /** Palette the server rendered with (ss_palette cookie); sets the
   *  live-marker halo. The rider can change it from the layers panel. */
  palette?: PaletteId;
}) {
  const [pal] = useRadarPalette(initialPalette);
  const palRef = useRef<RadarPalette>(pal);
  palRef.current = pal;
  // Palette the registered marker bitmaps were drawn with.
  const markerPaletteRef = useRef<PaletteId | null>(null);
  // Removes the prefers-reduced-motion listener startPulse() adds.
  const motionCleanupRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const readyRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const pulseRef = useRef<number | null>(null);
  const stateRef = useRef<Snapshot>(EMPTY_SNAPSHOT);
  const aircraftRef = useRef<Aircraft[]>(aircraft);
  const riderRef = useRef<RiderPos | null>(rider);
  const showDistanceRingsRef = useRef<boolean>(showDistanceRings);
  // Tracks whether we've done the one-time zoom-to-rider on first
  // geolocation resolve. Subsequent rider changes only recenter
  // (the existing 5s loop), they don't change zoom.
  const didFirstRiderZoomRef = useRef<boolean>(false);
  const userInteractedAtRef = useRef<number>(0);
  // Tail the map is currently "following" (click-to-follow). When set,
  // applyAircraft re-centers on this plane each snapshot if it has
  // drifted >FOLLOW_RECENTER_PX from screen center, and the rider
  // auto-recenter loop is suppressed so the two don't fight.
  const followedTailRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  const onLeaveViewRef = useRef(onLeaveView);
  onLeaveViewRef.current = onLeaveView;
  const viewIdRef = useRef<RadarViewId>(viewId);
  viewIdRef.current = viewId;
  const insetsRef = useRef<Padding>(insets);
  insetsRef.current = insets;
  const dataExtentRef = useRef<Bounds | null>(dataExtent);
  dataExtentRef.current = dataExtent;
  // True while the camera still shows the picked view. Cleared by any
  // move we did not make via fitView.
  const onViewRef = useRef(true);
  // Set once the rider picks a region this session. Suspends the
  // rider auto-zoom and the 5 s auto-recenter, which would otherwise
  // drag the camera off the view they just asked for.
  const viewLockedRef = useRef(false);
  if (cameraLocked) viewLockedRef.current = true;

  const leaveView = () => {
    if (!onViewRef.current) return;
    onViewRef.current = false;
    containerRef.current?.setAttribute("data-view", "custom");
    onLeaveViewRef.current?.();
  };

  const currentPadding = (): Padding => {
    const el = containerRef.current;
    const w = el?.clientWidth ?? 0;
    const h = el?.clientHeight ?? 0;
    // The iOS install prompt overlays the bottom of the map; its height
    // is published as a CSS var (0 when hidden).
    let prompt = 0;
    try {
      prompt =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--ss-install-prompt-h",
          ),
        ) || 0;
    } catch {
      prompt = 0;
    }
    const i = insetsRef.current;
    return fitPadding(w, h, { ...i, bottom: i.bottom + prompt });
  };

  const fitView = (duration: number) => {
    const map = mapRef.current;
    if (!map) return;
    const b = boundsForView(viewIdRef.current, dataExtentRef.current);
    onViewRef.current = true;
    containerRef.current?.setAttribute("data-view", viewIdRef.current);
    map.fitBounds(toLngLatBounds(b), {
      padding: currentPadding(),
      duration,
      essential: true,
    });
  };

  // Mount the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;

    if (!key) {
      containerRef.current.innerHTML = `
        <div style="
          position:absolute; inset:0; display:flex; align-items:center;
          justify-content:center; padding:24px; text-align:center;
          color:${SS_TOKENS.fg2}; font-size:13px; line-height:1.5;
        ">
          NEXT_PUBLIC_MAPTILER_KEY missing in this build.<br/>
          Map tiles unavailable.
        </div>
      `;
      return;
    }

    // Open already fitted to the rider's saved view (Puget Sound for a
    // first visit) so there is no fly-in on load.
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapStyleUrl(key),
      bounds: toLngLatBounds(
        boundsForView(viewIdRef.current, dataExtentRef.current),
      ),
      fitBoundsOptions: { padding: currentPadding() },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    containerRef.current.setAttribute("data-view", viewIdRef.current);

    const onLoad = async () => {
      // Load all four role glyphs in parallel + the rider dot. The map's
      // symbol layer expression picks the right one per feature via
      // properties.icon = "aircraft-${role}".
      // Greys + the palette's road tint; follows later palette picks.
      applyNeutralBasemap(map, palRef.current.id);
      const roleKeys = Object.values(ROLE_ICON_KEY);
      const markerPal = palRef.current;
      const [riderImg, roleImgs] = await Promise.all([
        loadSvgBitmap(RIDER_SVG, 48),
        markerBitmaps(markerPal),
      ]);
      if (!mapRef.current) return; // guard — unmounted while loading
      map.addImage("rider-dot", riderImg);
      roleKeys.forEach((key, i) => {
        map.addImage(key, roleImgs[i]!, { pixelRatio: MARKER_PIXEL_RATIO });
      });
      markerPaletteRef.current = markerPal.id;

      // Distance rings — sit beneath the rider so the dot stays on top.
      // Toggleable via showDistanceRings prop; visibility flips without
      // tearing the layer down.
      map.addSource("distance-rings", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "distance-rings",
        type: "line",
        source: "distance-rings",
        layout: {
          visibility: showDistanceRingsRef.current ? "visible" : "none",
        },
        paint: {
          "line-color": SS_TOKENS.fg2,
          "line-opacity": 0.4,
          "line-width": 0.75,
          "line-dasharray": [4, 4],
        },
      });
      // Tiny mono labels at the top of each ring ("5nm" / "10nm" / "15nm")
      // sit on a separate symbol layer so we can keep the line layer pure.
      map.addLayer({
        id: "distance-rings-labels",
        type: "symbol",
        source: "distance-rings",
        layout: {
          visibility: showDistanceRingsRef.current ? "visible" : "none",
          "text-field": ["get", "label"],
          "text-size": 9,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-offset": [0, -0.6],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": SS_TOKENS.fg2,
          "text-opacity": 0.8,
          "text-halo-color": SS_TOKENS.bg0,
          "text-halo-width": 1.5,
        },
        // Only render labels for the line vertices we tag — the polygon
        // outlines have no `label` property so they're skipped.
        filter: ["has", "label"],
      });

      // Rider — under aircraft so chevrons stay visually on top, but ABOVE
      // distance rings so the dot stays visually anchored.
      map.addSource("rider", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "rider",
        type: "symbol",
        source: "rider",
        layout: {
          "icon-image": "rider-dot",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 0.6,
        },
      });

      map.addSource("aircraft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "aircraft",
        type: "symbol",
        source: "aircraft",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["get", "track"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": AIRCRAFT_ICON_SCALE,
          // Tail label sits 4-6 px above the chevron. Hidden below z9 so
          // the regional view doesn't clutter; tail-only at z9-11; tail
          // plus nickname at z12+ for city zoom. Sky-blue mono matches
          // the brand info palette and stays distinct from the amber
          // chevron + heat halo.
          //
          // Font stack matches distance-rings-labels (the only other text
          // layer on this map) since MapTiler dataviz-dark glyphs
          // ship Open Sans + Arial Unicode but not JetBrains Mono.
          "text-field": [
            "step",
            ["zoom"],
            "",
            9,
            ["get", "tail"],
            12,
            [
              "case",
              ["has", "nickname"],
              ["concat", ["get", "tail"], " (", ["get", "nickname"], ")"],
              ["get", "tail"],
            ],
          ],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            10,
            14,
            12,
            18,
            13,
          ],
          "text-offset": [0, -2.2],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          "text-letter-spacing": 0.05,
        },
        paint: {
          "text-color": SS_TOKENS.sky,
          "text-halo-color": SS_TOKENS.bg0,
          "text-halo-width": 1.5,
        },
      });

      // Police pulse: a thin alert-orange ring that breathes out from
      // the marker. Added ABOVE the aircraft layer so the heat, routes
      // and trails (all inserted before "aircraft") never sit on top of
      // it; it is hollow, so it never covers the glyph. Other missions
      // get no pulse. Static (hidden) under prefers-reduced-motion.
      map.addLayer({
        id: PULSE_LAYER,
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "alert"], 1],
        layout: { visibility: "none" },
        paint: {
          "circle-radius": MARKER_RING_PX,
          "circle-opacity": 0,
          "circle-stroke-width": 2,
          "circle-stroke-color": LIVE_GLYPH.alertRing,
          "circle-stroke-opacity": 0,
          "circle-pitch-alignment": "map",
        },
      });

      readyRef.current = true;
      applyAircraft(aircraftRef.current);
      applyRider(riderRef.current);
      applyDistanceRings(riderRef.current);
      // Map mounted with rider already known (geolocation resolved
      // before MapLibre finished loading) — do the one-time zoom now.
      if (
        riderRef.current &&
        !didFirstRiderZoomRef.current &&
        !viewLockedRef.current
      ) {
        didFirstRiderZoomRef.current = true;
        leaveView();
        map.flyTo({
          center: [riderRef.current.lon, riderRef.current.lat],
          zoom: RIDER_ZOOM,
          duration: 1000,
        });
      }
      startPulse();
      refreshMarkers(); // a pick that landed while the map loaded
      onMapReadyRef.current?.(map);
    };
    map.on("load", onLoad);

    // Pause auto-recenter for 15s after any pan or zoom interaction.
    // Distinguish true user gestures from programmatic flyTo/easeTo by the
    // presence of `originalEvent` (only set for browser-driven events) —
    // otherwise our own follow-mode flyTo would self-cancel.
    const onUserInteract = (e?: { originalEvent?: unknown }) => {
      userInteractedAtRef.current = Date.now();
      // A real gesture (drag, pinch, wheel) moves the camera off the
      // picked view: the picker reads "Custom" until the next pick.
      if (e?.originalEvent) leaveView();
      if (e?.originalEvent && followedTailRef.current) {
        followedTailRef.current = null;
        popupRef.current?.remove();
        popupRef.current = null;
      }
    };
    map.on("dragstart", onUserInteract);
    map.on("zoomstart", onUserInteract);
    map.on("rotatestart", onUserInteract);
    map.on("pitchstart", onUserInteract);
    // Scroll-wheel zoom runs inside MapLibre's render frame, so its
    // zoomstart carries no originalEvent. The map's own wheel event
    // does, and is the reliable "rider zoomed" signal for a mouse.
    const onWheel = () => leaveView();
    map.on("wheel", onWheel);

    // Expose the live camera as data attributes for QA and the prod
    // audit (tests/visual/specs/p14-live-prod-audit.spec.ts). Read-only
    // numbers, no map handle on window.
    const onMoveEnd = () => {
      const el = containerRef.current;
      if (!el) return;
      const c = map.getCenter();
      el.setAttribute("data-center", `${c.lng.toFixed(4)},${c.lat.toFixed(4)}`);
      el.setAttribute("data-zoom", map.getZoom().toFixed(2));
    };
    map.on("moveend", onMoveEnd);
    onMoveEnd();

    // Cursor + click on chevrons.
    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    const onClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
      const feat = e.features?.[0];
      const tail = feat?.properties?.tail;
      if (typeof tail !== "string") return;
      const pos = stateRef.current.toByTail.get(tail);
      if (!pos) return;
      followedTailRef.current = tail;
      popupRef.current?.remove();
      const meta = stateRef.current.metaByTail.get(tail);
      const label = meta?.nickname ?? tail;
      // Build with DOM nodes + textContent (never setHTML): the nickname
      // comes from the admin-editable registry and must not be parsed
      // as markup.
      const content = document.createElement("div");
      content.style.font = "600 12px/1.4 ui-monospace,Menlo,monospace";
      content.style.color = SS_TOKENS.bg0;
      const labelEl = document.createElement("div");
      labelEl.textContent = label;
      const link = document.createElement("a");
      link.href = `/plane/${encodeURIComponent(tail)}`;
      link.textContent = "View detail";
      link.style.color = SS_TOKENS.sky;
      link.style.textDecoration = "underline";
      link.style.fontWeight = "400";
      content.append(labelEl, link);
      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        closeOnMove: false,
        offset: 24,
        className: "ss-plane-popup",
      })
        .setLngLat(pos)
        .setDOMContent(content)
        .addTo(map);
      popup.on("close", () => {
        if (followedTailRef.current === tail) {
          followedTailRef.current = null;
        }
        if (popupRef.current === popup) popupRef.current = null;
      });
      popupRef.current = popup;
      leaveView();
      map.flyTo({
        center: pos,
        zoom: Math.max(map.getZoom(), 12),
        duration: 600,
      });
    };
    // Click on empty map (no aircraft hit) → exit follow mode.
    const onMapClick = (e: MapMouseEvent) => {
      if (!followedTailRef.current) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: ["aircraft"],
      });
      if (features.length > 0) return;
      followedTailRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
    };
    map.on("mouseenter", "aircraft", onMouseEnter);
    map.on("mouseleave", "aircraft", onMouseLeave);
    map.on("click", "aircraft", onClick);
    map.on("click", onMapClick);

    return () => {
      readyRef.current = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      motionCleanupRef.current?.();
      motionCleanupRef.current = null;
      map.off("load", onLoad);
      map.off("dragstart", onUserInteract);
      map.off("zoomstart", onUserInteract);
      map.off("rotatestart", onUserInteract);
      map.off("pitchstart", onUserInteract);
      map.off("wheel", onWheel);
      map.off("moveend", onMoveEnd);
      map.off("mouseenter", "aircraft", onMouseEnter);
      map.off("mouseleave", "aircraft", onMouseLeave);
      map.off("click", "aircraft", onClick);
      map.off("click", onMapClick);
      popupRef.current?.remove();
      popupRef.current = null;
      onMapReadyRef.current?.(null);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply rider position when it updates from the geolocation watch.
  // First time the rider resolves AND the map is ready, fly to their
  // position at street-level zoom so a Tacoma rider opens to Tacoma,
  // not to the regional Puget Sound overview.
  useEffect(() => {
    riderRef.current = rider;
    if (readyRef.current) {
      applyRider(rider);
      applyDistanceRings(rider);
      if (rider && !didFirstRiderZoomRef.current && mapRef.current) {
        didFirstRiderZoomRef.current = true;
        // Skip the auto-zoom if the user has already manually panned
        // or zoomed, or picked a region (they meant it).
        if (
          Date.now() - userInteractedAtRef.current >= 15_000 &&
          !viewLockedRef.current
        ) {
          leaveView();
          mapRef.current.flyTo({
            center: [rider.lon, rider.lat],
            zoom: RIDER_ZOOM,
            duration: 1000,
          });
        }
      }
    }
  }, [rider]);

  // Toggle ring visibility without rebuilding the layer.
  useEffect(() => {
    showDistanceRingsRef.current = showDistanceRings;
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const v = showDistanceRings ? "visible" : "none";
    try {
      map.setLayoutProperty("distance-rings", "visibility", v);
      map.setLayoutProperty("distance-rings-labels", "visibility", v);
    } catch {
      /* layer not yet attached */
    }
  }, [showDistanceRings]);

  // Region pick (or re-pick of the same view, via fitNonce): ease the
  // camera to the view's box. The first run is skipped because the map
  // was created already fitted to the initial view.
  const lastFitKeyRef = useRef<string>(`${viewId}:${fitNonce}`);
  useEffect(() => {
    const key = `${viewId}:${fitNonce}`;
    if (key === lastFitKeyRef.current) return;
    lastFitKeyRef.current = key;
    if (!mapRef.current || !readyRef.current) return;
    viewLockedRef.current = true;
    followedTailRef.current = null;
    popupRef.current?.remove();
    popupRef.current = null;
    fitView(VIEW_FIT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId, fitNonce]);

  // "Everything" frames the data, which lands after the map opens.
  // Refit when the extent grows, but only while the camera is still on
  // that view (never yank a rider who has since panned away).
  useEffect(() => {
    if (viewIdRef.current !== "everything") return;
    if (!onViewRef.current) return;
    if (!mapRef.current || !readyRef.current) return;
    fitView(400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataExtent]);

  // Auto-recenter every 5s, paused for 15s after the user pans or zooms.
  // Also paused while a plane is being followed — applyAircraft handles
  // re-centering on the followed tail, and we don't want to fight it.
  useEffect(() => {
    if (!rider) return;
    const id = setInterval(() => {
      if (!readyRef.current || !mapRef.current) return;
      if (Date.now() - userInteractedAtRef.current < 15_000) return;
      if (followedTailRef.current) return;
      if (viewLockedRef.current) return;
      const r = riderRef.current;
      if (!r) return;
      leaveView();
      mapRef.current.easeTo({
        center: [r.lon, r.lat],
        duration: 800,
      });
    }, 5_000);
    return () => clearInterval(id);
  }, [rider]);

  // Rider dot breathes (1.6 s) and the police ring pulses out (1.8 s).
  // Both stop, and the ring hides, under prefers-reduced-motion; the
  // static ring baked into the marker still carries the identity.
  function startPulse() {
    const map = mapRef.current;
    if (!map) return;
    const run = () => {
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      pulseRef.current = null;
      if (prefersReducedMotion()) {
        try {
          map.setLayoutProperty("rider", "icon-size", 0.6);
          map.setLayoutProperty(PULSE_LAYER, "visibility", "none");
        } catch {
          /* layers not attached */
        }
        containerRef.current?.setAttribute("data-live-pulse", "off");
        return;
      }
      try {
        map.setLayoutProperty(PULSE_LAYER, "visibility", "visible");
      } catch {
        /* layer not attached */
      }
      containerRef.current?.setAttribute("data-live-pulse", "on");
      const start = Date.now();
      const tick = () => {
        const now = Date.now() - start;
        const phase = now / 1600;
        const sized = 0.5 + 0.15 * (Math.sin(phase * Math.PI * 2) + 1);
        const t = (now % PULSE_MS) / PULSE_MS; // 0 -> 1, ring grows and fades
        try {
          map.setLayoutProperty("rider", "icon-size", sized);
          map.setPaintProperty(PULSE_LAYER, "circle-radius", MARKER_RING_PX + 10 * t);
          map.setPaintProperty(PULSE_LAYER, "circle-stroke-opacity", 0.55 * (1 - t));
        } catch {
          // Layer may not exist yet; ignore.
        }
        pulseRef.current = requestAnimationFrame(tick);
      };
      pulseRef.current = requestAnimationFrame(tick);
    };
    run();
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", run);
      motionCleanupRef.current = () => mq.removeEventListener("change", run);
    } catch {
      /* matchMedia unavailable */
    }
  }

  // Palette pick: redraw the marker bitmaps with the new halo in place
  // (same size, so updateImage swaps them without touching the layer).
  function refreshMarkers() {
    const map = mapRef.current;
    const want = palRef.current;
    if (!map || !readyRef.current) return;
    if (markerPaletteRef.current === want.id) return;
    void markerBitmaps(want).then((imgs) => {
      // A newer pick landed while these rasterised; that call wins.
      if (mapRef.current !== map || palRef.current.id !== want.id) return;
      Object.values(ROLE_ICON_KEY).forEach((key, i) => {
        try {
          if (map.hasImage(key)) map.updateImage(key, imgs[i]!);
        } catch {
          /* map torn down */
        }
      });
      markerPaletteRef.current = want.id;
      map.triggerRepaint();
    });
  }
  useEffect(() => {
    refreshMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pal]);

  function applyDistanceRings(pos: RiderPos | null) {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("distance-rings") as GeoJSONSource | undefined;
    if (!source) return;
    if (!pos) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const RINGS_NM = [5, 10, 15] as const;
    const features: GeoJSON.Feature[] = [];
    for (const nm of RINGS_NM) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: circleRingCoords(pos.lat, pos.lon, nm),
        },
        properties: {},
      });
      // Label at the top (north) edge of each ring.
      const labelLat = pos.lat + nmToDegLat(nm);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pos.lon, labelLat] },
        properties: { label: `${nm}nm` },
      });
    }
    source.setData({ type: "FeatureCollection", features });
  }

  function applyRider(pos: RiderPos | null) {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("rider") as GeoJSONSource | undefined;
    if (!source) return;
    if (!pos) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
          properties: {},
        },
      ],
    });
  }

  // Re-render features when aircraft updates.
  useEffect(() => {
    aircraftRef.current = aircraft;
    if (readyRef.current) applyAircraft(aircraft);
  }, [aircraft]);

  // Compute new from/to and start a 1s linear interp.
  function applyAircraft(list: Aircraft[]) {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("aircraft") as GeoJSONSource | undefined;
    if (!source) return;

    const now = Date.now();
    const prev = stateRef.current;
    const t = prev.startedAt
      ? Math.min(1, (now - prev.startedAt) / ANIM_MS)
      : 1;

    // Snapshot: where each plane visually is right now.
    const newFrom = new Map<string, [number, number]>();
    for (const [tail, to] of prev.toByTail) {
      const from = prev.fromByTail.get(tail) ?? to;
      const lon = from[0] + (to[0] - from[0]) * t;
      const lat = from[1] + (to[1] - from[1]) * t;
      newFrom.set(tail, [lon, lat]);
    }

    const newTo = new Map<string, [number, number]>();
    const newMeta = new Map<
      string,
      { icon: string; track: number; nickname: string | null }
    >();
    for (const a of list) {
      if (a.lat == null || a.lon == null) continue;
      newTo.set(a.tail, [a.lon, a.lat]);
      newMeta.set(a.tail, {
        icon: iconForRole(a.role, a.model),
        track: a.heading ?? 0,
        nickname: a.nickname,
      });
      if (!newFrom.has(a.tail)) {
        // First time we see this plane — render it at its current position
        // immediately (no fly-in animation from undefined).
        newFrom.set(a.tail, [a.lon, a.lat]);
      }
    }

    stateRef.current = {
      fromByTail: newFrom,
      toByTail: newTo,
      metaByTail: newMeta,
      startedAt: now,
    };

    // Follow-mode recenter — once per snapshot, when the plane has drifted
    // either >FOLLOW_RECENTER_PX from center OR within FOLLOW_EDGE_MARGIN
    // of any viewport edge. If the plane has dropped out of the snapshot
    // (left the region, went offline), exit follow mode silently.
    const followedTail = followedTailRef.current;
    if (followedTail) {
      const pos = newTo.get(followedTail);
      if (pos) {
        popupRef.current?.setLngLat(pos);
        const screen = map.project(pos);
        const canvas = map.getCanvas();
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const cx = w / 2;
        const cy = h / 2;
        const dx = screen.x - cx;
        const dy = screen.y - cy;
        const farFromCenter = Math.hypot(dx, dy) > FOLLOW_RECENTER_PX;
        const edgeMarginX = w * FOLLOW_EDGE_MARGIN_RATIO;
        const edgeMarginY = h * FOLLOW_EDGE_MARGIN_RATIO;
        const nearEdge =
          screen.x < edgeMarginX ||
          screen.x > w - edgeMarginX ||
          screen.y < edgeMarginY ||
          screen.y > h - edgeMarginY;
        if (farFromCenter || nearEdge) {
          map.easeTo({ center: pos, duration: 600 });
        }
      } else {
        followedTailRef.current = null;
        popupRef.current?.remove();
        popupRef.current = null;
      }
    }

    if (animRef.current) cancelAnimationFrame(animRef.current);
    const tick = () => {
      const elapsed = (Date.now() - stateRef.current.startedAt) / ANIM_MS;
      const tt = Math.min(1, elapsed);
      const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
      for (const [tail, to] of stateRef.current.toByTail) {
        const from = stateRef.current.fromByTail.get(tail)!;
        const meta = stateRef.current.metaByTail.get(tail)!;
        const lon = from[0] + (to[0] - from[0]) * tt;
        const lat = from[1] + (to[1] - from[1]) * tt;
        const props: Record<string, string | number> = {
          tail,
          icon: meta.icon,
          track: meta.track,
          // 1 = police (alert glyph): drives the pulse layer filter.
          alert: ALERT_ICON_KEYS.has(meta.icon) ? 1 : 0,
        };
        // Only include nickname when present so the layer's `["has",
        // "nickname"]` expression cleanly toggles between "tail" and
        // "tail (nickname)" formats. Empty-string values would still
        // pass `has`, breaking the conditional.
        if (meta.nickname) props.nickname = meta.nickname;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: props,
        });
      }
      source.setData({ type: "FeatureCollection", features });
      if (tt < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
      }
    };
    tick();
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={`Live aircraft map, showing ${aircraft.length} airborne tail${aircraft.length === 1 ? "" : "s"}`}
      style={{
        position: "absolute",
        inset: 0,
        background: SS_TOKENS.bg0,
      }}
    />
  );
}
