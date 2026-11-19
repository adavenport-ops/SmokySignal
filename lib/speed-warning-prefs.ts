// Rider-side speed-warning preferences (N1b). localStorage only, same
// footing as lib/voice-mode.ts and lib/proximity-alert.ts: nothing here
// is ever sent to the server.
//
//   ss_speed_warning            "1" = on. Default OFF.
//   ss_speed_limit_mph          rider's limit, whole mph (default 60)
//   ss_speed_limit_corridor     "1" = use corridor defaults (default off)
//   ss_speed_warning_mute_until epoch ms; "Mute 10 min"
//
// Every write dispatches SPEED_WARNING_PREFS_EVENT so a mounted
// <SpeedWarning/> picks the change up without a reload.

"use client";

import { DEFAULT_RIDER_LIMIT_MPH, clampRiderLimitMph } from "./speed-warning";

export const SPEED_WARNING_ENABLED_KEY = "ss_speed_warning";
export const SPEED_LIMIT_KEY = "ss_speed_limit_mph";
export const SPEED_LIMIT_CORRIDOR_KEY = "ss_speed_limit_corridor";
export const SPEED_WARNING_MUTE_KEY = "ss_speed_warning_mute_until";
export const SPEED_WARNING_PREFS_EVENT = "ss:speed-warning-prefs";

export type SpeedWarningPrefs = {
  enabled: boolean;
  limitMph: number;
  useCorridorDefaults: boolean;
  muteUntil: number | null;
};

export const DEFAULT_SPEED_WARNING_PREFS: SpeedWarningPrefs = {
  enabled: false,
  limitMph: DEFAULT_RIDER_LIMIT_MPH,
  useCorridorDefaults: false,
  muteUntil: null,
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private mode / storage blocked: the setting just won't stick
  }
  try {
    window.dispatchEvent(new Event(SPEED_WARNING_PREFS_EVENT));
  } catch {
    // no window
  }
}

export function readSpeedWarningPrefs(): SpeedWarningPrefs {
  if (typeof window === "undefined") return DEFAULT_SPEED_WARNING_PREFS;
  const rawLimit = read(SPEED_LIMIT_KEY);
  const rawMute = Number(read(SPEED_WARNING_MUTE_KEY));
  return {
    enabled: read(SPEED_WARNING_ENABLED_KEY) === "1",
    limitMph: rawLimit == null ? DEFAULT_RIDER_LIMIT_MPH : clampRiderLimitMph(rawLimit),
    useCorridorDefaults: read(SPEED_LIMIT_CORRIDOR_KEY) === "1",
    muteUntil: Number.isFinite(rawMute) && rawMute > 0 ? rawMute : null,
  };
}

export function setSpeedWarningEnabled(on: boolean): void {
  write(SPEED_WARNING_ENABLED_KEY, on ? "1" : "0");
}

export function setSpeedLimitMph(mph: number): void {
  write(SPEED_LIMIT_KEY, String(clampRiderLimitMph(mph)));
}

export function setUseCorridorDefaults(on: boolean): void {
  write(SPEED_LIMIT_CORRIDOR_KEY, on ? "1" : "0");
}

export function setSpeedWarningMuteUntil(until: number | null): void {
  write(SPEED_WARNING_MUTE_KEY, until == null ? null : String(Math.round(until)));
}
