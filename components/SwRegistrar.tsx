"use client";

// Registers the static /sw.js service worker on every page load. Idempotent —
// the browser deduplicates by scope. Silent on unsupported browsers (Safari
// pre-16.4, anything not in `serviceWorker in navigator`).
//
// The SW is push-only; no offline caching. Mounted from app/layout.tsx so it
// gets a registration handle as early as the JS bundle hydrates.

import { useEffect } from "react";

export function SwRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* silent — PWA install + push will fail gracefully if SW can't register */
    });
  }, []);
  return null;
}
