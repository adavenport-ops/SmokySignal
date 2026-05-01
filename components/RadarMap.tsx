"use client";

import { useEffect, useRef } from "react";
import maplibregl, {
  Map as MaplibreMap,
  GeoJSONSource,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { SS_TOKENS } from "@/lib/tokens";
import type { Aircraft } from "@/lib/types";

const PUGET_SOUND: [number, number] = [-122.3, 47.6];
const DEFAULT_ZOOM = 9;

const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M12 3 L21 21 L12 17 L3 21 Z" fill="${SS_TOKENS.alert}" stroke="${SS_TOKENS.bg0}" stroke-width="1" stroke-linejoin="round"/></svg>`;

const ROTOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="rgba(245,184,64,0.18)" stroke="${SS_TOKENS.alert}" stroke-width="1.5"/><line x1="2" y1="12" x2="22" y2="12" stroke="${SS_TOKENS.alert}" stroke-width="1" stroke-linecap="round" opacity="0.85"/><circle cx="12" cy="12" r="2" fill="${SS_TOKENS.alert}"/></svg>`;

const RIDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="${SS_TOKENS.sky}" fill-opacity="0.10"/><circle cx="24" cy="24" r="12" fill="${SS_TOKENS.sky}" fill-opacity="0.22"/><circle cx="24" cy="24" r="6" fill="${SS_TOKENS.sky}" stroke="white" stroke-width="2"/></svg>`;

type IconKind = "plane-fixed" | "plane-rotor";

function iconForModel(model: string | undefined | null): IconKind {
  if (!model) return "plane-fixed";
  return /Bell|UH-1|MD|Hughes|407|206|505/i.test(model)
    ? "plane-rotor"
    : "plane-fixed";
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
  metaByTail: Map<string, { icon: IconKind; track: number; nickname: string | null }>;
  startedAt: number;
};

const EMPTY_SNAPSHOT: Snapshot = {
  fromByTail: new Map(),
  toByTail: new Map(),
  metaByTail: new Map(),
  startedAt: 0,
};

const ANIM_MS = 1000;

type RiderPos = { lat: number; lon: number };

export default function RadarMap({
  aircraft,
  rider,
  onMapReady,
}: {
  aircraft: Aircraft[];
  rider: RiderPos | null;
  onMapReady?: (map: MaplibreMap | null) => void;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const readyRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const pulseRef = useRef<number | null>(null);
  const stateRef = useRef<Snapshot>(EMPTY_SNAPSHOT);
  const aircraftRef = useRef<Aircraft[]>(aircraft);
  const riderRef = useRef<RiderPos | null>(rider);
  const userInteractedAtRef = useRef<number>(0);
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${key}`,
      center: PUGET_SOUND,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const onLoad = async () => {
      const [planeImg, rotorImg, riderImg] = await Promise.all([
        loadSvgBitmap(PLANE_SVG, 32),
        loadSvgBitmap(ROTOR_SVG, 32),
        loadSvgBitmap(RIDER_SVG, 48),
      ]);
      if (!mapRef.current) return; // guard — unmounted while loading
      map.addImage("plane-fixed", planeImg);
      map.addImage("plane-rotor", rotorImg);
      map.addImage("rider-dot", riderImg);

      // Rider — under aircraft so chevrons stay visually on top.
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
          "icon-size": 0.85,
        },
      });

      readyRef.current = true;
      applyAircraft(aircraftRef.current);
      applyRider(riderRef.current);
      startPulse();
      onMapReadyRef.current?.(map);
    };
    map.on("load", onLoad);

    // Pause auto-recenter for 15s after any pan or zoom interaction.
    const onUserInteract = () => {
      userInteractedAtRef.current = Date.now();
    };
    map.on("dragstart", onUserInteract);
    map.on("zoomstart", onUserInteract);

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
      if (typeof tail === "string") router.push(`/plane/${tail}`);
    };
    map.on("mouseenter", "aircraft", onMouseEnter);
    map.on("mouseleave", "aircraft", onMouseLeave);
    map.on("click", "aircraft", onClick);

    return () => {
      readyRef.current = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      map.off("load", onLoad);
      map.off("dragstart", onUserInteract);
      map.off("zoomstart", onUserInteract);
      map.off("mouseenter", "aircraft", onMouseEnter);
      map.off("mouseleave", "aircraft", onMouseLeave);
      map.off("click", "aircraft", onClick);
      onMapReadyRef.current?.(null);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply rider position when it updates from the geolocation watch.
  useEffect(() => {
    riderRef.current = rider;
    if (readyRef.current) applyRider(rider);
  }, [rider]);

  // Auto-recenter every 5s, paused for 15s after the user pans or zooms.
  useEffect(() => {
    if (!rider) return;
    const id = setInterval(() => {
      if (!readyRef.current || !mapRef.current) return;
      if (Date.now() - userInteractedAtRef.current < 15_000) return;
      const r = riderRef.current;
      if (!r) return;
      mapRef.current.easeTo({
        center: [r.lon, r.lat],
        duration: 800,
      });
    }, 5_000);
    return () => clearInterval(id);
  }, [rider]);

  function startPulse() {
    const map = mapRef.current;
    if (!map) return;
    const start = Date.now();
    const tick = () => {
      const phase = (Date.now() - start) / 1600; // 1.6s loop
      const sized = 0.5 + 0.15 * (Math.sin(phase * Math.PI * 2) + 1);
      try {
        map.setLayoutProperty("rider", "icon-size", sized);
      } catch {
        // Layer may not exist yet; ignore.
      }
      pulseRef.current = requestAnimationFrame(tick);
    };
    pulseRef.current = requestAnimationFrame(tick);
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
    const newMeta = new Map<string, { icon: IconKind; track: number; nickname: string | null }>();
    for (const a of list) {
      if (a.lat == null || a.lon == null) continue;
      newTo.set(a.tail, [a.lon, a.lat]);
      newMeta.set(a.tail, {
        icon: iconForModel(a.model),
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
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: { tail, icon: meta.icon, track: meta.track },
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
