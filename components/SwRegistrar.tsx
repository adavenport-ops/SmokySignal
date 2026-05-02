"use client";

// Registers the static /sw.js service worker on every page load. Idempotent —
// the browser deduplicates by scope. Silent on unsupported browsers (Safari
// pre-16.4, anything not in `serviceWorker in navigator`).
//
// The SW is push-only; no offline caching. Mounted from app/layout.tsx so it
// gets a registration handle as early as the JS bundle hydrates.

import { useEffect } from "react";
import { speakAlert } from "@/lib/voice-mode";

export function SwRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* silent — PWA install + push will fail gracefully if SW can't register */
    });
    // Voice readback bridge — SW posts title/body on every push so we
    // can speak it. speakAlert no-ops when voice mode is off.
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { kind?: string; title?: string; body?: string } | null;
      if (!d || d.kind !== "ss-voice-readback") return;
      const text = [d.title, d.body].filter(Boolean).join(". ");
      if (text) speakAlert(text);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);
  return null;
}
