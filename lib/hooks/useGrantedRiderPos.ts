"use client";

import { useEffect, useState } from "react";

export type GrantedPos = { lat: number; lon: number };

const OPTS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 60_000,
  timeout: 15_000,
};

/**
 * Rider position for the home screen, but ONLY when geolocation is
 * already granted. Unlike useRiderPos this never triggers the browser's
 * permission prompt: it asks the Permissions API first and does nothing
 * unless the answer is "granted" (riders grant it on /radar or /dash).
 * Position stays in memory; nothing is stored or sent anywhere.
 */
export function useGrantedRiderPos(): GrantedPos | null {
  const [pos, setPos] = useState<GrantedPos | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const perms = navigator.permissions;
    if (!perms?.query) return;
    let watchId: number | null = null;
    let status: PermissionStatus | null = null;
    let cancelled = false;

    const start = () => {
      if (watchId != null) return;
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          if (!cancelled) {
            setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
          }
        },
        () => {
          /* keep the last fix, or the altitude fallback */
        },
        OPTS,
      );
    };
    const stop = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const onChange = () => {
      if (status?.state === "granted") start();
      else {
        stop();
        setPos(null);
      }
    };

    perms
      .query({ name: "geolocation" as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.addEventListener?.("change", onChange);
        if (s.state === "granted") start();
      })
      .catch(() => {
        /* Permissions API unavailable: stay on the fallback */
      });

    return () => {
      cancelled = true;
      stop();
      status?.removeEventListener?.("change", onChange);
    };
  }, []);

  return pos;
}
