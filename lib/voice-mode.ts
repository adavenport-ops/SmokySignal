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

const ENABLED_KEY = "ss_voice_mode";

export function isVoiceModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) === "1";
}

export function setVoiceModeEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
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
 * Brand voice: trust the caller to pass already-laconic copy. The push
 * dispatcher's voice-guardian guarantees no exclamation marks and the
 * mono-numerical phrasing — speak() does not transform.
 */
export function speakAlert(text: string): void {
  if (!text) return;
  if (!isVoiceModeEnabled()) return;
  if (!isVoiceModeSupported()) return;
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
