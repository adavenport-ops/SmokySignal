"use client";

// The rider's radar palette on the client. Starts from the value the
// server rendered with (the ss_palette cookie, resolved against the
// contrast pref in lib/user-prefs.ts) so SSR and the first client render
// agree, then follows picks made anywhere on the page: the picker writes
// the cookie and broadcasts PALETTE_CHANGE_EVENT, and every map layer
// that uses this hook repaints in place with setPaintProperty.

import { useCallback, useEffect, useState } from "react";
import {
  PALETTE_CHANGE_EVENT,
  getPalette,
  paletteFromCookieHeader,
  resolvePalette,
  serializePaletteCookie,
  type PaletteId,
  type RadarPalette,
} from "@/lib/radar-palettes";

/** Palette from document.cookie + body[data-contrast], client only. */
export function readClientPalette(): PaletteId {
  if (typeof document === "undefined") return resolvePalette(null, null);
  const contrast = document.body?.dataset.contrast === "high" ? "high" : "normal";
  return resolvePalette(paletteFromCookieHeader(document.cookie), contrast);
}

/** Persist a pick and tell every subscribed layer. */
export function writeClientPalette(id: PaletteId): void {
  if (typeof document === "undefined") return;
  document.cookie = serializePaletteCookie(id);
  window.dispatchEvent(new CustomEvent(PALETTE_CHANGE_EVENT, { detail: id }));
}

export function useRadarPalette(
  initial?: PaletteId,
): [RadarPalette, (id: PaletteId) => void] {
  const [id, setId] = useState<PaletteId>(() => initial ?? resolvePalette(null, null));
  useEffect(() => {
    // A cached RSC payload or a surface rendered without the prop can
    // disagree with the cookie; the cookie wins once mounted.
    const fromCookie = readClientPalette();
    setId((cur) => (cur === fromCookie ? cur : fromCookie));
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<PaletteId>).detail;
      if (next) setId(next);
    };
    window.addEventListener(PALETTE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(PALETTE_CHANGE_EVENT, onChange);
  }, []);
  const choose = useCallback((next: PaletteId) => {
    setId(next);
    writeClientPalette(next);
  }, []);
  return [getPalette(id), choose];
}
