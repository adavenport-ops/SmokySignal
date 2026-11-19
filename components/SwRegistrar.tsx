"use client";

// Registers the static /sw.js service worker on every page load. Idempotent —
// the browser deduplicates by scope. Silent on unsupported browsers (Safari
// pre-16.4, anything not in `serviceWorker in navigator`).
//
// The SW handles push plus a minimal offline shell (/offline, hashed
// chunks, icons; never API JSON, never HTML). See public/sw.js. Mounted
// from app/layout.tsx so it gets a registration handle as early as the JS
// bundle hydrates.

import { useEffect } from "react";
import { speakAlert } from "@/lib/voice-mode";

const RESYNC_KEY = "ss:push-resync-at";
const RESYNC_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * A rider who already granted notifications keeps a push subscription in
 * the browser even if the server lost its copy. Re-register it at most once
 * a day; the server only creates the row when it is missing.
 */
async function resyncPush(reg: ServiceWorkerRegistration): Promise<void> {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!reg.pushManager) return;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(RESYNC_KEY) ?? 0);
    } catch {
      /* storage blocked: resync every load, the server is idempotent */
    }
    if (Date.now() - last < RESYNC_EVERY_MS) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const r = await fetch("/api/push/resync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sub: sub.toJSON() }),
    });
    if (r.ok) {
      try {
        window.localStorage.setItem(RESYNC_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort */
  }
}

export function SwRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => resyncPush(reg))
      .catch(() => {
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
