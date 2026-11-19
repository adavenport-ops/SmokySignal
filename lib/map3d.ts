// Camera controls for every 3D view (components/Map3DControls.tsx over
// components/Flight3D.tsx): bearing / pitch stepping, the compass reset,
// the keyboard map, the slow "Orbit" spin and the one-time gesture hint.
//
// Pure apart from the injected host, so node:test covers the stepping and
// the orbit state machine without a browser (lib/map3d.test.ts).

/** Rotate buttons and Q / E turn the camera this far, degrees. */
export const BEARING_STEP = 45;
/** Tilt buttons and W / S walk these pitches, degrees. */
export const PITCH_STEPS = [0, 30, 45, 60, 75] as const;
/** Orbit spin rate, degrees of bearing per second. */
export const ORBIT_DEG_PER_S = 6;
/** Longest frame gap the orbit integrates, ms: a slow GPU still spins
 *  at full rate down to 4 fps, and a stall never jumps. */
export const ORBIT_MAX_DT_MS = 250;
/** Button / key camera moves ease over this long (0 under reduced motion). */
export const STEP_EASE_MS = 450;

/** Bearing folded into (-180, 180]. */
export function normalizeBearing(b: number): number {
  if (!Number.isFinite(b)) return 0;
  let x = ((b % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x === -180 ? 180 : x;
}

/** One rotate step. dir -1 turns the view left (bearing down), +1 right. */
export function stepBearing(bearing: number, dir: -1 | 1): number {
  return normalizeBearing(bearing + dir * BEARING_STEP);
}

/** Next pitch step up (+1, toward the horizon) or down (-1, toward
 *  overhead), from wherever the camera is now. Clamps at the ends. */
export function stepPitch(pitch: number, dir: -1 | 1): number {
  const eps = 0.5;
  if (dir > 0) return PITCH_STEPS.find((p) => p > pitch + eps) ?? PITCH_STEPS[PITCH_STEPS.length - 1]!;
  for (let i = PITCH_STEPS.length - 1; i >= 0; i--) {
    if (PITCH_STEPS[i]! < pitch - eps) return PITCH_STEPS[i]!;
  }
  return PITCH_STEPS[0];
}

/** Where the compass tap sends the camera: north up, the view's own pitch. */
export function compassResetTarget(defaultPitch: number): { bearing: number; pitch: number } {
  return { bearing: 0, pitch: defaultPitch };
}

/** Compass label: the bearing as a whole-degree heading, 0-359. */
export function headingLabel(bearing: number): string {
  const h = Math.round(((normalizeBearing(bearing) % 360) + 360) % 360) % 360;
  return String(h).padStart(3, "0");
}

export type CameraAction = "rotate-left" | "rotate-right" | "tilt-up" | "tilt-down";

/** Q / E rotate, W / S tilt. Modifier chords are left to the browser. */
export function keyAction(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): CameraAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case "q":
      return "rotate-left";
    case "e":
      return "rotate-right";
    case "w":
      return "tilt-up";
    case "s":
      return "tilt-down";
    default:
      return null;
  }
}

/** Camera target for one action from the current bearing / pitch. */
export function applyAction(
  action: CameraAction,
  cam: { bearing: number; pitch: number },
): { bearing: number; pitch: number } {
  switch (action) {
    case "rotate-left":
      return { bearing: stepBearing(cam.bearing, -1), pitch: cam.pitch };
    case "rotate-right":
      return { bearing: stepBearing(cam.bearing, 1), pitch: cam.pitch };
    case "tilt-up":
      return { bearing: cam.bearing, pitch: stepPitch(cam.pitch, 1) };
    case "tilt-down":
      return { bearing: cam.bearing, pitch: stepPitch(cam.pitch, -1) };
  }
}

/** Shift-drag tilt: drag up to lean toward the horizon. */
export function pitchFromDrag(startPitch: number, dyPx: number, maxPitch = 80): number {
  return Math.max(0, Math.min(maxPitch, startPitch - dyPx * 0.5));
}

// ─── gestures ────────────────────────────────────────────────────────

type Toggle = { enable(): void; disable(): void };

/** The handler surface of a MapLibre map that 3D needs. */
export type GestureMap = {
  dragRotate: Toggle;
  touchZoomRotate: Toggle & { enableRotation(): void };
  touchPitch: Toggle;
  keyboard: Toggle;
  boxZoom: Toggle;
};

/**
 * Every 3D view: right-drag / Ctrl-drag rotate (and tilt), two-finger
 * twist and two-finger tilt, keyboard on. Box zoom off, because Shift-drag
 * tilts in 3D (Map3DControls handles it).
 */
export function enable3DGestures(map: GestureMap): void {
  map.dragRotate.enable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.enableRotation();
  map.touchPitch.enable();
  map.keyboard.enable();
  map.boxZoom.disable();
}

// ─── gesture hint ────────────────────────────────────────────────────

export const HINT_STORAGE_KEY = "ss_3d_gesture_hint_seen";

export const GESTURE_HINT = {
  desktop: "Right-drag or Ctrl-drag to rotate · Shift-drag to tilt",
  touch: "Two fingers to rotate and tilt",
} as const;

export function gestureHint(coarsePointer: boolean): string {
  return coarsePointer ? GESTURE_HINT.touch : GESTURE_HINT.desktop;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** True when this device has not seen the hint. Storage that throws
 *  (private mode, blocked site data) counts as seen: never nag. */
export function shouldShowHint(storage: StorageLike | null | undefined): boolean {
  try {
    if (!storage) return false;
    return storage.getItem(HINT_STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markHintSeen(storage: StorageLike | null | undefined): void {
  try {
    storage?.setItem(HINT_STORAGE_KEY, "1");
  } catch {
    /* storage blocked: the hint simply shows again next time */
  }
}

// ─── orbit ───────────────────────────────────────────────────────────

/** What the orbit needs from the page: the camera, a frame clock and the
 *  tab / motion state. Injected so tests drive it by hand. */
export type OrbitHost = {
  getBearing(): number;
  /** Must not count as a user interaction (Map3DControls tags the event). */
  setBearing(bearing: number): void;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(id: number): void;
  isHidden(): boolean;
  reducedMotion(): boolean;
  /** Called whenever `active` flips, for the button state. */
  onChange?(active: boolean): void;
};

export type OrbitState = "off" | "spinning" | "suspended";

/**
 * Slow continuous bearing rotation around the current centre.
 *
 *   off -> start() -> spinning           (never under reduced motion)
 *   spinning -> interrupt() / stop() -> off   (any user interaction)
 *   spinning -> tab hidden -> suspended -> tab visible -> spinning
 *
 * It never starts on its own: only start() / toggle() turn it on.
 */
export class OrbitController {
  private _state: OrbitState = "off";
  private frame: number | null = null;
  private last: number | null = null;

  constructor(
    private readonly host: OrbitHost,
    private readonly degPerSec = ORBIT_DEG_PER_S,
  ) {}

  get state(): OrbitState {
    return this._state;
  }

  /** On (spinning, or waiting for the tab to come back). */
  get active(): boolean {
    return this._state !== "off";
  }

  /** Turn the orbit on. Returns false (and stays off) under reduced motion. */
  start(): boolean {
    if (this.host.reducedMotion()) {
      this.stop();
      return false;
    }
    if (this._state === "spinning") return true;
    const next: OrbitState = this.host.isHidden() ? "suspended" : "spinning";
    this.set(next);
    if (next === "spinning") this.schedule();
    return true;
  }

  /** Turn it off (button press, reduced motion switched on). */
  stop(): void {
    this.cancel();
    this.set("off");
  }

  /** A drag, pinch, wheel, key or other button press: stop spinning. */
  interrupt(): void {
    if (this._state !== "off") this.stop();
  }

  toggle(): boolean {
    if (this.active) {
      this.stop();
      return false;
    }
    return this.start();
  }

  /** Call on `visibilitychange`. Hidden suspends; visible resumes. */
  visibilityChanged(): void {
    if (this._state === "off") return;
    if (this.host.isHidden()) {
      this.cancel();
      this.set("suspended");
    } else if (this._state === "suspended") {
      if (this.host.reducedMotion()) return this.stop();
      this.set("spinning");
      this.schedule();
    }
  }

  dispose(): void {
    this.cancel();
    this._state = "off";
  }

  private set(s: OrbitState) {
    const was = this.active;
    this._state = s;
    if (was !== this.active) this.host.onChange?.(this.active);
  }

  private schedule() {
    if (this.frame != null) return;
    this.last = null;
    this.frame = this.host.requestFrame(this.tick);
  }

  private cancel() {
    if (this.frame != null) this.host.cancelFrame(this.frame);
    this.frame = null;
    this.last = null;
  }

  private tick = (t: number) => {
    this.frame = null;
    if (this._state !== "spinning") return;
    if (this.host.isHidden()) {
      this.set("suspended");
      return;
    }
    const dt = this.last == null ? 0 : Math.min(ORBIT_MAX_DT_MS, Math.max(0, t - this.last));
    this.last = t;
    if (dt > 0) {
      this.host.setBearing(normalizeBearing(this.host.getBearing() + (this.degPerSec * dt) / 1000));
    }
    // setBearing may have interrupted us (a host that misreports it).
    if ((this._state as OrbitState) === "spinning") this.frame = this.host.requestFrame(this.tick);
  };
}
