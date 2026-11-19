"use client";

// Camera controls shared by every 3D view (Flight3D mounts it, so the
// /flight share page, the plane page's Flight history, /radar history and
// live /radar all get the same cluster):
//
//   compass   shows the bearing; tap for north up at the view's own pitch
//   rotate    ±45° bearing, eased
//   tilt      walks the pitch steps 0 / 30 / 45 / 60 / 75
//   orbit     a slow spin (6°/s) around the current centre. Never starts
//             on its own, stops on any drag, pinch, wheel, key or button
//             press, waits while the tab is hidden, and is not offered
//             under reduced motion.
//
// Keyboard on the focused map: Q / E rotate, W / S tilt. Shift-drag tilts
// (box zoom is off in 3D). A one-time hint per device says how the
// gestures go. Logic lives in lib/map3d.ts.
//
// Layout: one 44px column under RESET VIEW when it fits above the
// parent's bottom overlays (scrubber, pill row, carousel), else a compact
// two-column block.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap, MapLibreEvent } from "maplibre-gl";
import { SS_TOKENS } from "@/lib/tokens";
import {
  OrbitController,
  STEP_EASE_MS,
  applyAction,
  compassResetTarget,
  enable3DGestures,
  HINT_MS,
  compassAriaLabel,
  gestureHint,
  keyAction,
  markHintSeen,
  pitchFromDrag,
  shouldShowHint,
  type CameraAction,
} from "@/lib/map3d";

type Props = {
  map: MaplibreMap | null;
  /** The view's home pitch: the compass returns here. */
  defaultPitch: number;
  /** px from the top / right of the 3D frame. */
  top: number;
  right: number;
  /** px at the bottom of the frame taken by other overlays. */
  bottomReserve: number;
};

const BTN = 44;
const GAP = 8;
/** Marks camera moves the orbit makes, so they never count as a rider's. */
const ORBIT_TAG = { ssOrbit: true } as const;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export default function Map3DControls({ map, defaultPitch, top, right, bottomReserve }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const orbitRef = useRef<OrbitController | null>(null);
  const defaultPitchRef = useRef(defaultPitch);
  defaultPitchRef.current = defaultPitch;
  const [cam, setCam] = useState({ bearing: 0, pitch: 0 });
  const [orbiting, setOrbiting] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [frameH, setFrameH] = useState(0);
  const [hint, setHint] = useState<string | null>(null);

  // Reduced motion: no Orbit button, and steps jump instead of easing.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const sync = () => {
      setReduced(mq.matches);
      if (mq.matches) orbitRef.current?.stop();
    };
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  // Room for the column: the frame height minus everything around it.
  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const sync = () => setFrameH(parent.clientHeight);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  const ease = useCallback(
    (target: { bearing: number; pitch: number }) => {
      if (!map) return;
      if (prefersReducedMotion()) map.jumpTo(target);
      else map.easeTo({ ...target, duration: STEP_EASE_MS, easing: easeOut });
    },
    [map],
  );

  const act = useCallback(
    (action: CameraAction) => {
      if (!map) return;
      orbitRef.current?.interrupt();
      ease(applyAction(action, { bearing: map.getBearing(), pitch: map.getPitch() }));
    },
    [map, ease],
  );

  const resetNorth = useCallback(() => {
    orbitRef.current?.interrupt();
    ease(compassResetTarget(defaultPitchRef.current));
  }, [ease]);

  const toggleOrbit = useCallback(() => {
    orbitRef.current?.toggle();
  }, []);

  // Wire the map: gestures, orbit, interaction detection, keys, readout.
  useEffect(() => {
    if (!map) return;
    enable3DGestures(map);

    const orbit = new OrbitController({
      getBearing: () => map.getBearing(),
      setBearing: (b) => {
        map.setBearing(b, ORBIT_TAG);
      },
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
      isHidden: () => document.visibilityState === "hidden",
      reducedMotion: prefersReducedMotion,
      onChange: setOrbiting,
    });
    orbitRef.current = orbit;

    // Any camera move the orbit did not make (gesture, button, key,
    // RESET VIEW, a re-frame) stops it.
    const onMoveStart = (e: MapLibreEvent & { ssOrbit?: boolean }) => {
      if (!e.ssOrbit) orbit.interrupt();
    };
    map.on("movestart", onMoveStart);

    // Readout for the compass, once per frame at most.
    let raf: number | null = null;
    const root = rootRef.current;
    const readout = () => {
      raf = null;
      const next = { bearing: map.getBearing(), pitch: map.getPitch() };
      setCam(next);
      if (root) {
        root.dataset.bearing = next.bearing.toFixed(1);
        root.dataset.pitch = next.pitch.toFixed(1);
      }
    };
    const onMove = () => {
      if (raf == null) raf = requestAnimationFrame(readout);
    };
    map.on("move", onMove);
    readout();

    // Touch / mouse / wheel on the map: the rider has taken the camera.
    const surface = map.getCanvasContainer();
    const onPointer = () => orbit.interrupt();
    surface.addEventListener("pointerdown", onPointer);
    surface.addEventListener("wheel", onPointer, { passive: true });
    surface.addEventListener("touchstart", onPointer, { passive: true });

    // Q / E rotate, W / S tilt while the map canvas has focus.
    const canvas = map.getCanvas();
    const onKey = (e: KeyboardEvent) => {
      const a = keyAction(e);
      if (!a) {
        orbit.interrupt();
        return;
      }
      e.preventDefault();
      orbit.interrupt();
      const target = applyAction(a, { bearing: map.getBearing(), pitch: map.getPitch() });
      if (prefersReducedMotion()) map.jumpTo(target);
      else map.easeTo({ ...target, duration: STEP_EASE_MS, easing: easeOut });
    };
    canvas.addEventListener("keydown", onKey);

    // Shift-drag tilts. Captured at the window so MapLibre's pan never
    // sees the press.
    const maxPitch = map.getMaxPitch();
    const onShiftDown = (e: MouseEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      if (!(e.target instanceof Node) || !surface.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      orbit.interrupt();
      const y0 = e.clientY;
      const p0 = map.getPitch();
      const onMove = (ev: MouseEvent) => map.setPitch(pitchFromDrag(p0, ev.clientY - y0, maxPitch));
      const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    };
    window.addEventListener("mousedown", onShiftDown, true);

    const onVisibility = () => orbit.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      orbit.dispose();
      orbitRef.current = null;
      if (raf != null) cancelAnimationFrame(raf);
      map.off("movestart", onMoveStart);
      map.off("move", onMove);
      surface.removeEventListener("pointerdown", onPointer);
      surface.removeEventListener("wheel", onPointer);
      surface.removeEventListener("touchstart", onPointer);
      canvas.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onShiftDown, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [map]);

  // Gesture hint, once per device. The ref keeps a re-run of this effect
  // (React dev double-invoke) from losing the auto-hide timer.
  const hintDecidedRef = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (!hintDecidedRef.current) {
      hintDecidedRef.current = true;
      const storage = safeStorage();
      if (shouldShowHint(storage)) {
        markHintSeen(storage);
        const coarse = !!window.matchMedia?.("(pointer: coarse)").matches;
        setHint(gestureHint(coarse));
      }
    }
    const t = window.setTimeout(() => setHint(null), HINT_MS);
    const surface = map.getCanvasContainer();
    const hide = () => setHint(null);
    surface.addEventListener("pointerdown", hide, { once: true });
    return () => {
      window.clearTimeout(t);
      surface.removeEventListener("pointerdown", hide);
    };
  }, [map]);

  const showOrbit = !reduced;
  const count = showOrbit ? 6 : 5;
  const columnH = count * BTN + (showOrbit ? 3 : 2) * GAP;
  const avail = frameH - top - bottomReserve;
  const layout: "column" | "grid" = frameH === 0 || avail >= columnH ? "column" : "grid";

  const compass = (
    <CtlButton
      label={compassAriaLabel(cam.bearing)}
      testId="map3d-compass"
      onClick={resetNorth}
      round
    >
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden style={{ transform: `rotate(${-cam.bearing}deg)` }}>
        <circle cx="13" cy="13" r="11.5" fill="none" stroke={SS_TOKENS.hairline2} strokeWidth="1" />
        <path d="M13 3.5 L16.2 13 L9.8 13 Z" fill={SS_TOKENS.fg0} />
        <path d="M13 22.5 L16.2 13 L9.8 13 Z" fill={SS_TOKENS.fg2} />
      </svg>
      <span
        aria-hidden
        className="ss-mono"
        style={{
          position: "absolute",
          top: 1,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 9,
          fontWeight: 700,
          color: SS_TOKENS.fg1,
          transform: `rotate(${-cam.bearing}deg)`,
          transformOrigin: "50% 21px",
          pointerEvents: "none",
        }}
      >
        N
      </span>
    </CtlButton>
  );
  const column = layout === "column";
  const rotL = (
    <CtlButton label="Rotate left" testId="map3d-rotate-left" onClick={() => act("rotate-left")} grouped={column ? "first" : undefined}>
      <RotateIcon dir={-1} />
    </CtlButton>
  );
  const rotR = (
    <CtlButton label="Rotate right" testId="map3d-rotate-right" onClick={() => act("rotate-right")} grouped={column ? "last" : undefined}>
      <RotateIcon dir={1} />
    </CtlButton>
  );
  const tiltUp = (
    <CtlButton label="Tilt up, toward the horizon" testId="map3d-tilt-up" onClick={() => act("tilt-up")} grouped={column ? "first" : undefined}>
      <TiltIcon dir={1} />
    </CtlButton>
  );
  const tiltDown = (
    <CtlButton label="Tilt down, toward overhead" testId="map3d-tilt-down" onClick={() => act("tilt-down")} grouped={column ? "last" : undefined}>
      <TiltIcon dir={-1} />
    </CtlButton>
  );
  const orbitBtn = showOrbit ? (
    <CtlButton
      label={orbiting ? "Stop orbit" : "Orbit: slow spin around the view"}
      testId="map3d-orbit"
      onClick={toggleOrbit}
      pressed={orbiting}
    >
      <OrbitIcon on={orbiting} />
    </CtlButton>
  ) : null;

  return (
    <>
      <div
        ref={rootRef}
        role="group"
        aria-label="3D camera"
        data-testid="map3d-controls"
        data-layout={layout}
        data-orbit={orbiting ? "on" : "off"}
        style={{
          position: "absolute",
          top,
          right,
          zIndex: 3,
          display: "grid",
          gridTemplateColumns: layout === "column" ? `${BTN}px` : `${BTN}px ${BTN}px`,
          gap: layout === "column" ? GAP : `${GAP}px 6px`,
          visibility: map ? "visible" : "hidden",
        }}
      >
        {layout === "column" ? (
          <>
            {compass}
            <Group>
              {rotL}
              {rotR}
            </Group>
            <Group>
              {tiltUp}
              {tiltDown}
            </Group>
            {orbitBtn}
          </>
        ) : (
          <>
            {compass}
            {orbitBtn ?? <span />}
            {rotL}
            {rotR}
            {tiltUp}
            {tiltDown}
          </>
        )}
      </div>
      {hint && (
        <div
          role="status"
          data-testid="map3d-hint"
          // Top-centre of the frame, one row under the top of the control
          // column (RESET VIEW sits level with it) and clear of the column
          // on the right and the + on the left, so it never covers a
          // button (tilt down used to hide under it on phones). Hides
          // itself after HINT_MS.
          style={{
            position: "absolute",
            left: 64,
            right: right + (layout === "column" ? BTN : 2 * BTN + 6) + 8,
            top: top + BTN + GAP,
            zIndex: 3,
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
              padding: "0 0 0 14px",
              borderRadius: 10,
              background: "rgba(11,13,16,0.88)",
              border: `.5px solid ${SS_TOKENS.hairline2}`,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              color: SS_TOKENS.fg0,
              fontSize: 13,
              lineHeight: 1.35,
              pointerEvents: "auto",
            }}
          >
            <span style={{ padding: "8px 0" }}>{hint}</span>
            <button
              type="button"
              onClick={() => setHint(null)}
              aria-label="Dismiss gesture hint"
              style={{
                width: BTN,
                height: BTN,
                flex: "0 0 auto",
                background: "transparent",
                border: 0,
                color: SS_TOKENS.fg1,
                fontSize: 18,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Two buttons joined into one pill with a hairline between them. */
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 10,
        overflow: "hidden",
        background: "rgba(11,13,16,0.82)",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {children}
    </div>
  );
}

function CtlButton({
  label,
  testId,
  onClick,
  pressed,
  round,
  grouped,
  children,
}: {
  label: string;
  testId: string;
  onClick: () => void;
  pressed?: boolean;
  round?: boolean;
  /** "first" / "last" inside a Group: the Group draws the chrome. */
  grouped?: "first" | "last";
  children: React.ReactNode;
}) {
  const chrome: React.CSSProperties = grouped
    ? {
        borderRadius: 0,
        background: "transparent",
        border: 0,
        borderTop: grouped === "last" ? `.5px solid ${SS_TOKENS.hairline2}` : 0,
      }
    : {
        borderRadius: round ? "50%" : 10,
        background: pressed ? SS_TOKENS.fg0 : "rgba(11,13,16,0.82)",
        border: `.5px solid ${pressed ? SS_TOKENS.fg0 : SS_TOKENS.hairline2}`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      style={{
        position: "relative",
        width: BTN,
        height: BTN,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        color: pressed ? SS_TOKENS.bg0 : SS_TOKENS.fg0,
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        ...chrome,
      }}
    >
      {children}
    </button>
  );
}

function RotateIcon({ dir }: { dir: -1 | 1 }) {
  // A three-quarter arc with an arrowhead; mirrored for the other way.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden style={{ transform: dir < 0 ? "scaleX(-1)" : undefined }}>
      <path d="M15.5 10a5.5 5.5 0 1 1-2.2-4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M13.6 2.6 L14.2 6.4 L10.4 6.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TiltIcon({ dir }: { dir: -1 | 1 }) {
  // A ground plane in perspective with an arrow: up leans to the horizon.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path d="M3 17 L7 11 L13 11 L17 17 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {dir > 0 ? (
        <path d="M10 8.5 V2.5 M7.5 5 L10 2.5 L12.5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M10 2.5 V8.5 M7.5 6 L10 8.5 L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function OrbitIcon({ on }: { on: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <ellipse cx="11" cy="12" rx="8.5" ry="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="12" r="1.8" fill="currentColor" />
      <circle cx={on ? 18.6 : 3.4} cy={on ? 13.5 : 10.5} r="2.2" fill="currentColor" />
      <path d="M11 3 V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
