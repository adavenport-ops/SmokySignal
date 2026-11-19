// Run: npx tsx --test lib/map3d.test.ts
//
// 3D camera controls: bearing / pitch stepping, the keyboard map, the
// gesture setup, the one-time hint and the orbit state machine (start,
// pause on interaction, tab hidden / visible, resume, reduced motion).

import { test } from "node:test";
import assert from "node:assert";
import {
  BEARING_STEP,
  GESTURE_HINT,
  HINT_STORAGE_KEY,
  ORBIT_DEG_PER_S,
  ORBIT_MAX_DT_MS,
  OrbitController,
  PITCH_STEPS,
  applyAction,
  compassResetTarget,
  enable3DGestures,
  gestureHint,
  headingLabel,
  keyAction,
  markHintSeen,
  normalizeBearing,
  pitchFromDrag,
  shouldShowHint,
  stepBearing,
  stepPitch,
  type OrbitHost,
} from "./map3d";

// ─── stepping ────────────────────────────────────────────────────────

test("normalizeBearing folds into (-180, 180]", () => {
  assert.strictEqual(normalizeBearing(0), 0);
  assert.strictEqual(normalizeBearing(180), 180);
  assert.strictEqual(normalizeBearing(-180), 180);
  assert.strictEqual(normalizeBearing(190), -170);
  assert.strictEqual(normalizeBearing(-190), 170);
  assert.strictEqual(normalizeBearing(720 + 45), 45);
  assert.strictEqual(normalizeBearing(Number.NaN), 0);
});

test("rotate steps 45 degrees each way and wraps", () => {
  assert.strictEqual(BEARING_STEP, 45);
  assert.strictEqual(stepBearing(0, 1), 45);
  assert.strictEqual(stepBearing(0, -1), -45);
  assert.strictEqual(stepBearing(170, 1), -145);
  assert.strictEqual(stepBearing(-160, -1), 155);
  // Eight presses go all the way round.
  let b = 12;
  for (let i = 0; i < 8; i++) b = stepBearing(b, 1);
  assert.ok(Math.abs(b - 12) < 1e-9, String(b));
});

test("tilt walks 0 / 30 / 45 / 60 / 75 from wherever the camera is", () => {
  assert.deepStrictEqual([...PITCH_STEPS], [0, 30, 45, 60, 75]);
  assert.strictEqual(stepPitch(0, 1), 30);
  assert.strictEqual(stepPitch(30, 1), 45);
  assert.strictEqual(stepPitch(60, 1), 75);
  assert.strictEqual(stepPitch(75, 1), 75, "clamps at the top");
  assert.strictEqual(stepPitch(80, 1), 75, "a gesture past the top comes back to it");
  assert.strictEqual(stepPitch(75, -1), 60);
  assert.strictEqual(stepPitch(30, -1), 0);
  assert.strictEqual(stepPitch(0, -1), 0, "clamps at overhead");
  // Off-step pitches (after a drag) go to the next step, not past it.
  assert.strictEqual(stepPitch(52, 1), 60);
  assert.strictEqual(stepPitch(52, -1), 45);
  // Within half a degree of a step counts as on it.
  assert.strictEqual(stepPitch(44.8, 1), 60);
  assert.strictEqual(stepPitch(45.3, -1), 30);
});

test("compass resets to north up at the view's own pitch", () => {
  assert.deepStrictEqual(compassResetTarget(60), { bearing: 0, pitch: 60 });
  assert.deepStrictEqual(compassResetTarget(45), { bearing: 0, pitch: 45 });
  assert.strictEqual(headingLabel(0), "000");
  assert.strictEqual(headingLabel(-45), "315");
  assert.strictEqual(headingLabel(89.6), "090");
  assert.strictEqual(headingLabel(180), "180");
  assert.strictEqual(headingLabel(-0.2), "000");
});

test("Q / E rotate and W / S tilt; modifier chords are ignored", () => {
  assert.strictEqual(keyAction({ key: "q" }), "rotate-left");
  assert.strictEqual(keyAction({ key: "E" }), "rotate-right");
  assert.strictEqual(keyAction({ key: "w" }), "tilt-up");
  assert.strictEqual(keyAction({ key: "S" }), "tilt-down");
  assert.strictEqual(keyAction({ key: "a" }), null);
  assert.strictEqual(keyAction({ key: "ArrowLeft" }), null);
  assert.strictEqual(keyAction({ key: "w", metaKey: true }), null, "Cmd-W closes the tab, not our business");
  assert.strictEqual(keyAction({ key: "s", ctrlKey: true }), null);
  assert.deepStrictEqual(applyAction("rotate-left", { bearing: 10, pitch: 60 }), { bearing: -35, pitch: 60 });
  assert.deepStrictEqual(applyAction("rotate-right", { bearing: 10, pitch: 60 }), { bearing: 55, pitch: 60 });
  assert.deepStrictEqual(applyAction("tilt-up", { bearing: 10, pitch: 60 }), { bearing: 10, pitch: 75 });
  assert.deepStrictEqual(applyAction("tilt-down", { bearing: 10, pitch: 60 }), { bearing: 10, pitch: 45 });
});

test("shift-drag tilt: up leans to the horizon, clamped", () => {
  assert.strictEqual(pitchFromDrag(45, -20), 55);
  assert.strictEqual(pitchFromDrag(45, 20), 35);
  assert.strictEqual(pitchFromDrag(45, 400), 0);
  assert.strictEqual(pitchFromDrag(45, -400, 80), 80);
});

// ─── gestures + hint ─────────────────────────────────────────────────

test("enable3DGestures turns on rotate, twist, two-finger tilt and keys", () => {
  const calls: string[] = [];
  const toggle = (name: string) => ({
    enable: () => calls.push(`${name}.enable`),
    disable: () => calls.push(`${name}.disable`),
  });
  enable3DGestures({
    dragRotate: toggle("dragRotate"),
    touchZoomRotate: { ...toggle("touchZoomRotate"), enableRotation: () => calls.push("touchZoomRotate.enableRotation") },
    touchPitch: toggle("touchPitch"),
    keyboard: toggle("keyboard"),
    boxZoom: toggle("boxZoom"),
  });
  for (const c of [
    "dragRotate.enable",
    "touchZoomRotate.enable",
    "touchZoomRotate.enableRotation",
    "touchPitch.enable",
    "keyboard.enable",
    "boxZoom.disable",
  ]) {
    assert.ok(calls.includes(c), c);
  }
});

test("gesture hint copy per pointer type", () => {
  assert.strictEqual(gestureHint(false), "Right-drag or Ctrl-drag to rotate · Shift-drag to tilt");
  assert.strictEqual(gestureHint(true), "Two fingers to rotate and tilt");
  for (const s of Object.values(GESTURE_HINT)) assert.ok(!s.includes("!"), "no exclamation marks");
});

test("gesture hint shows once per device and never throws", () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.strictEqual(shouldShowHint(storage), true);
  markHintSeen(storage);
  assert.strictEqual(mem.get(HINT_STORAGE_KEY), "1");
  assert.strictEqual(shouldShowHint(storage), false);
  const blocked = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.strictEqual(shouldShowHint(blocked), false, "blocked storage never nags");
  assert.doesNotThrow(() => markHintSeen(blocked));
  assert.strictEqual(shouldShowHint(null), false);
});

// ─── orbit ───────────────────────────────────────────────────────────

/** A hand-cranked frame clock + camera. */
function fakeHost(opts: { reduced?: boolean; hidden?: boolean } = {}) {
  const frames = new Map<number, (t: number) => void>();
  let nextId = 1;
  const host = {
    bearing: 0,
    hidden: opts.hidden ?? false,
    reduced: opts.reduced ?? false,
    changes: [] as boolean[],
    sets: 0,
  };
  const api: OrbitHost = {
    getBearing: () => host.bearing,
    setBearing: (b) => {
      host.bearing = b;
      host.sets++;
    },
    requestFrame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => void frames.delete(id),
    isHidden: () => host.hidden,
    reducedMotion: () => host.reduced,
    onChange: (a) => host.changes.push(a),
  };
  /** Run every pending frame at time t. */
  const flush = (t: number) => {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, cb] of pending) cb(t);
  };
  return { host, api, flush, pending: () => frames.size };
}

test("orbit never starts on its own", () => {
  const { host, api, flush, pending } = fakeHost();
  const o = new OrbitController(api);
  assert.strictEqual(o.state, "off");
  assert.strictEqual(pending(), 0);
  flush(1000);
  assert.strictEqual(host.sets, 0);
});

test("orbit spins at about 6 degrees a second once started", () => {
  const { host, api, flush } = fakeHost();
  const o = new OrbitController(api);
  assert.strictEqual(o.start(), true);
  assert.strictEqual(o.state, "spinning");
  assert.deepStrictEqual(host.changes, [true]);
  // First frame only sets the clock; then 60 frames of 16.67 ms = 1 s.
  flush(0);
  for (let i = 1; i <= 60; i++) flush(i * (1000 / 60));
  assert.ok(Math.abs(host.bearing - ORBIT_DEG_PER_S) < 0.01, `bearing ${host.bearing}`);
});

test("orbit caps a long frame gap so a stall never jumps", () => {
  const { host, api, flush } = fakeHost();
  const o = new OrbitController(api);
  o.start();
  flush(0);
  flush(5000);
  assert.ok(Math.abs(host.bearing - (ORBIT_DEG_PER_S * ORBIT_MAX_DT_MS) / 1000) < 1e-9, String(host.bearing));
});

test("any interaction pauses the orbit; tapping Orbit again resumes from there", () => {
  const { host, api, flush, pending } = fakeHost();
  const o = new OrbitController(api);
  o.start();
  flush(0);
  flush(500);
  const at = host.bearing;
  o.interrupt();
  assert.strictEqual(o.state, "off");
  assert.strictEqual(pending(), 0, "frame cancelled");
  flush(1000);
  assert.strictEqual(host.bearing, at, "no drift after the pause");
  assert.deepStrictEqual(host.changes, [true, false]);
  // Resume: carries on from the rider's bearing, no catch-up jump.
  host.bearing = 90;
  assert.strictEqual(o.toggle(), true);
  flush(5000);
  flush(5050);
  assert.ok(Math.abs(host.bearing - (90 + ORBIT_DEG_PER_S * 0.05)) < 1e-9, String(host.bearing));
  assert.strictEqual(o.toggle(), false);
  assert.strictEqual(o.state, "off");
});

test("interrupt when already off is a no-op", () => {
  const { host, api } = fakeHost();
  const o = new OrbitController(api);
  o.interrupt();
  assert.strictEqual(o.state, "off");
  assert.deepStrictEqual(host.changes, []);
});

test("hidden tab suspends the orbit and a visible tab resumes it", () => {
  const { host, api, flush, pending } = fakeHost();
  const o = new OrbitController(api);
  o.start();
  flush(0);
  flush(100);
  host.hidden = true;
  o.visibilityChanged();
  assert.strictEqual(o.state, "suspended");
  assert.strictEqual(o.active, true, "still on: the button stays pressed");
  assert.strictEqual(pending(), 0);
  const at = host.bearing;
  host.hidden = false;
  o.visibilityChanged();
  assert.strictEqual(o.state, "spinning");
  flush(60_000); // first frame after resume only sets the clock
  assert.strictEqual(host.bearing, at, "no jump for the time away");
  flush(60_100);
  assert.ok(host.bearing > at);
  // A frame that lands while hidden suspends too.
  host.hidden = true;
  flush(60_200);
  assert.strictEqual(o.state, "suspended");
});

test("starting while the tab is hidden waits for it", () => {
  const { api, host, pending } = fakeHost({ hidden: true });
  const o = new OrbitController(api);
  assert.strictEqual(o.start(), true);
  assert.strictEqual(o.state, "suspended");
  assert.strictEqual(pending(), 0);
  host.hidden = false;
  o.visibilityChanged();
  assert.strictEqual(o.state, "spinning");
});

test("reduced motion: orbit refuses to start and stops if switched on mid-spin", () => {
  const r = fakeHost({ reduced: true });
  const o = new OrbitController(r.api);
  assert.strictEqual(o.start(), false);
  assert.strictEqual(o.toggle(), false);
  assert.strictEqual(o.state, "off");
  assert.strictEqual(r.pending(), 0);

  const s = fakeHost();
  const o2 = new OrbitController(s.api);
  o2.start();
  s.host.hidden = true;
  o2.visibilityChanged();
  s.host.reduced = true;
  s.host.hidden = false;
  o2.visibilityChanged();
  assert.strictEqual(o2.state, "off", "comes back off, not spinning");
});

test("dispose cancels the frame", () => {
  const { api, pending } = fakeHost();
  const o = new OrbitController(api);
  o.start();
  assert.strictEqual(pending(), 1);
  o.dispose();
  assert.strictEqual(pending(), 0);
  assert.strictEqual(o.state, "off");
});
