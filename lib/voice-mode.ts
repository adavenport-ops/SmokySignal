// Voice readback for push + proximity alerts. localStorage-backed,
// mirrors the proximity-alert pattern. iOS Safari requires a
// user-gesture before speechSynthesis.speak() works the first time —
// the toggle's button click + the test-notification flow on
// /settings/alerts both count, so the rider primes the API by opting
// in.
//
// Limitation: speechSynthesis only fires when a page is open.
// Background pushes with the tab fully closed will NOT speak. The
// realistic helmet-audio use case keeps /radar or /dash visible while
// riding, so this is acceptable for now.

"use client";

import { planSpokenAlert, type EarconKind } from "./earcon-core";
import { areEarconsEnabled, earconAudioReady, playEarcon } from "./earcon";

const ENABLED_KEY = "ss_voice_mode";

let pendingSpeech: ReturnType<typeof setTimeout> | null = null;

export function isVoiceModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export function setVoiceModeEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  if (!on) cancelPendingSpeech();
}

function cancelPendingSpeech(): void {
  if (pendingSpeech != null) {
    clearTimeout(pendingSpeech);
    pendingSpeech = null;
  }
}

export function isVoiceModeSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "speechSynthesis" in window;
}

/**
 * Speak the given text via the platform speech synthesizer. No-op when
 * voice mode is off, the API is unavailable, or text is empty. Cancels
 * any in-flight utterance so back-to-back alerts don't queue forever.
 *
 * With `kind` set and tones on (B23), a short earcon plays first and the
 * words wait for it, so helmet coms are awake before the first word.
 * A newer alert replaces one still waiting on its tone.
 *
 * Brand voice: trust the caller to pass already-laconic copy. The push
 * dispatcher's voice-guardian guarantees no exclamation marks and the
 * mono-numerical phrasing — speak() does not transform.
 */
export function speakAlert(text: string, kind?: EarconKind): void {
  if (!text) return;
  if (!isVoiceModeEnabled()) return;
  if (!isVoiceModeSupported()) return;
  cancelPendingSpeech();
  const plan = planSpokenAlert({
    kind,
    tonesOn: areEarconsEnabled(),
    audioAvailable: kind != null && earconAudioReady(),
  });
  const played = plan.tone != null && playEarcon(plan.tone);
  if (!played) {
    say(text);
    return;
  }
  try {
    window.speechSynthesis.cancel();
  } catch {
    // best-effort
  }
  pendingSpeech = setTimeout(() => {
    pendingSpeech = null;
    // Voice may have been turned off while the tone played.
    if (isVoiceModeEnabled()) say(text);
  }, plan.speakDelayMs);
}

function say(text: string): void {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    window.speechSynthesis.speak(u);
  } catch {
    // best-effort
  }
}
