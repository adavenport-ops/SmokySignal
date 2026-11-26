// Web Audio player for the alert earcons (B23). Shapes and timing live in
// `lib/earcon-core.ts`; this file only owns the AudioContext and the
// rider's on/off choice (localStorage, same footing as voice mode).
//
// iOS Safari starts every AudioContext suspended until a user gesture.
// `primeEarcons()` runs inside one (the voice toggle, the tone preview,
// or the first tap anywhere, via SwRegistrar) and resumes the context;
// after that, tones play from timers and service-worker messages.

"use client";

import {
  EARCON_GAIN,
  EARCON_RAMP_MS,
  earconSchedule,
  type EarconKind,
} from "./earcon-core";

const TONES_KEY = "ss_voice_tones";

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isEarconSupported(): boolean {
  return audioCtor() != null;
}

/** Tones are on unless the rider turned them off. */
export function areEarconsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TONES_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setEarconsEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TONES_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

/**
 * Create or resume the AudioContext. Call from a user gesture; on iOS a
 * one-sample silent buffer inside the gesture is what unlocks output.
 * Resolves once the context runs (or could not be started).
 */
export function primeEarcons(): Promise<void> {
  const Ctor = audioCtor();
  if (!Ctor) return Promise.resolve();
  try {
    if (!ctx) ctx = new Ctor();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    if (ctx.state !== "running") return ctx.resume().catch(() => {});
  } catch {
    // best-effort
  }
  return Promise.resolve();
}

/** True when the AudioContext exists and runs. No side effects. */
export function isEarconRunning(): boolean {
  return ctx != null && ctx.state === "running";
}

/**
 * True when a tone played now would be heard. When the context exists
 * but is suspended, also asks it to resume (without waiting), so the next
 * alert may get its tone even if this one goes out without.
 */
export function earconAudioReady(): boolean {
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  void ctx.resume().catch(() => {});
  return false;
}

/** Schedule one earcon. Returns false when nothing could be scheduled. */
export function playEarcon(kind: EarconKind): boolean {
  if (!ctx || ctx.state !== "running") return false;
  try {
    const t0 = ctx.currentTime + 0.02;
    const ramp = EARCON_RAMP_MS / 1000;
    for (const n of earconSchedule(kind, t0)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.hz, n.start);
      gain.gain.setValueAtTime(0, n.start);
      gain.gain.linearRampToValueAtTime(EARCON_GAIN, n.start + ramp);
      gain.gain.setValueAtTime(EARCON_GAIN, n.end - ramp);
      gain.gain.linearRampToValueAtTime(0, n.end);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(n.start);
      osc.stop(n.end + 0.01);
    }
    return true;
  } catch {
    return false;
  }
}
