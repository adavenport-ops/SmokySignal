// Pure validation for the push pipeline. No node:* or KV imports so it can
// be unit-tested in isolation (lib/push/validate.test.ts).
//
// Two layers:
//   - Strict validators (parsePushSubscription, validatePrefsInput) used by
//     the /api/push/* routes. Anything malformed is rejected with a 400.
//   - Lenient normalizers (normalizeUserZone, isValidZoneId, validateTz)
//     shared with lib/push/store.ts so legacy rows written before this
//     validation existed are cleaned on their next write instead of
//     failing the whole update.

import type { AlertPrefs, AlertTier, UserZoneSpec } from "./types";

// ─── Endpoint allow-list ─────────────────────────────────────────────
//
// The dispatcher POSTs to every stored endpoint, so an unrestricted
// endpoint turns the server into an open request relay (SSRF) and lets a
// slow host stall the fan-out. Only the browser push services are allowed.

/** Hosts that must match exactly. */
const PUSH_EXACT_HOSTS: ReadonlySet<string> = new Set([
  "fcm.googleapis.com", // Chrome, Edge (Chromium), Samsung Internet, Opera, Brave
  "updates.push.services.mozilla.com", // Firefox
]);

/** Hosts allowed only as proper subdomains (e.g. web.push.apple.com). */
const PUSH_HOST_SUFFIXES: readonly string[] = [
  "push.apple.com", // Safari: web.push.apple.com
  "notify.windows.com", // Legacy Edge / WNS: *.notify.windows.com
];

const MAX_ENDPOINT_CHARS = 2048;

export function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (PUSH_EXACT_HOSTS.has(host)) return true;
  return PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`));
}

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string") return false;
  if (endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_CHARS) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  // Push services listen on the default port. A custom port is never a
  // legitimate subscription and would let a caller aim at another service.
  if (url.port !== "" && url.port !== "443") return false;
  return isAllowedPushHost(url.hostname);
}

// ─── Subscription keys ───────────────────────────────────────────────

const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/;

export function isBase64Url(v: unknown, minLen: number, maxLen: number): v is string {
  return (
    typeof v === "string" &&
    v.length >= minLen &&
    v.length <= maxLen &&
    BASE64URL_RE.test(v)
  );
}

/**
 * p256dh is a 65-byte uncompressed P-256 point (87 chars base64url, 88
 * padded). auth is a 16-byte secret (22 chars, 24 padded). Bounds leave a
 * little slack for encoder differences while rejecting junk.
 */
const P256DH_MIN = 80;
const P256DH_MAX = 100;
const AUTH_MIN = 16;
const AUTH_MAX = 32;

/** The only subscription fields we persist or send to. */
export type StoredPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * Validates a browser PushSubscriptionJSON and returns a fresh object with
 * only `{ endpoint, keys: { p256dh, auth } }`. Extra fields are dropped.
 * Returns null on anything malformed or off the allow-list.
 */
export function parsePushSubscription(v: unknown): StoredPushSubscription | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isAllowedPushEndpoint(o.endpoint)) return null;
  if (!o.keys || typeof o.keys !== "object") return null;
  const k = o.keys as Record<string, unknown>;
  if (!isBase64Url(k.p256dh, P256DH_MIN, P256DH_MAX)) return null;
  if (!isBase64Url(k.auth, AUTH_MIN, AUTH_MAX)) return null;
  return { endpoint: o.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

// ─── Prefs primitives ────────────────────────────────────────────────

export const MAX_TZ_CHARS = 64;
export const MAX_ZONES = 20;
export const MAX_USER_ZONES = 20;
export const MAX_USER_ZONE_RADIUS_NM = 250;
export const MAX_ZONE_LABEL_CHARS = 64;

/** Returns the tz string if it is a real IANA zone, else null. */
export function validateTz(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_TZ_CHARS) {
    return null;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: v });
    return v;
  } catch {
    return null;
  }
}

// Mirrors zoneIdForPoint() in lib/hotzones.ts: "${lat.toFixed(4)},${lon.toFixed(4)}".
const ZONE_ID_RE = /^(-?\d{1,2}\.\d{4}),(-?\d{1,3}\.\d{4})$/;

export function isValidZoneId(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ZONE_ID_RE.exec(v);
  if (!m) return false;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Validates one rider geofence and returns the stored form. lat/lon are
 * rounded to 2 decimals (~1 km) so we never hold a rider's exact home or
 * work coordinates server-side. Returns null when the entry is malformed.
 */
export function normalizeUserZone(v: unknown): UserZoneSpec | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const { lat, lon, radiusNm, label } = r;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return null;
  }
  if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return null;
  }
  if (
    typeof radiusNm !== "number" ||
    !Number.isFinite(radiusNm) ||
    radiusNm <= 0 ||
    radiusNm > MAX_USER_ZONE_RADIUS_NM
  ) {
    return null;
  }
  if (typeof label !== "string") return null;
  return {
    lat: round2(lat),
    lon: round2(lon),
    radiusNm: round2(radiusNm),
    label: label.slice(0, MAX_ZONE_LABEL_CHARS),
  };
}

function parseHour(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return n;
}

// ─── Strict prefs validation (routes) ────────────────────────────────

export type PrefsValidation =
  | { ok: true; prefs: Partial<AlertPrefs> }
  | { ok: false; error: string };

/**
 * Validates a client-supplied prefs object. Returns only known, validated
 * fields; unknown keys are dropped. `undefined`/`null` is a valid empty
 * input (subscribe may omit prefs).
 */
export function validatePrefsInput(v: unknown): PrefsValidation {
  if (v === undefined || v === null) return { ok: true, prefs: {} };
  if (typeof v !== "object" || Array.isArray(v)) {
    return { ok: false, error: "invalid_prefs" };
  }
  const p = v as Record<string, unknown>;
  const out: Partial<AlertPrefs> = {};

  if (p.tier !== undefined) {
    if (p.tier !== "all" && p.tier !== "alert_only") {
      return { ok: false, error: "invalid_tier" };
    }
    out.tier = p.tier as AlertTier;
  }

  if (p.zones !== undefined) {
    if (p.zones === "any") {
      out.zones = "any";
    } else if (
      Array.isArray(p.zones) &&
      p.zones.length <= MAX_ZONES &&
      p.zones.every(isValidZoneId)
    ) {
      out.zones = Array.from(new Set(p.zones as string[]));
    } else {
      return { ok: false, error: "invalid_zones" };
    }
  }

  if (p.userZones !== undefined) {
    if (!Array.isArray(p.userZones)) {
      return { ok: false, error: "invalid_user_zones" };
    }
    const zones: UserZoneSpec[] = [];
    for (const z of p.userZones) {
      const n = normalizeUserZone(z);
      if (!n) return { ok: false, error: "invalid_user_zones" };
      zones.push(n);
    }
    // Riders can keep more zones locally than we route on; cap rather than
    // reject so a long list still syncs its first MAX_USER_ZONES entries.
    out.userZones = zones.slice(0, MAX_USER_ZONES);
  }

  if (p.tails !== undefined) {
    if (!Array.isArray(p.tails)) return { ok: false, error: "invalid_tails" };
    // Format + cap are enforced by sanitizeTails() in store.ts.
    out.tails = p.tails.filter((t): t is string => typeof t === "string");
  }

  for (const field of ["quiet_start_h", "quiet_end_h"] as const) {
    if (p[field] !== undefined) {
      const h = parseHour(p[field]);
      if (h === null) return { ok: false, error: `invalid_${field}` };
      out[field] = h;
    }
  }

  if (p.tz !== undefined) {
    const tz = validateTz(p.tz);
    if (!tz) return { ok: false, error: "invalid_tz" };
    out.tz = tz;
  }

  return { ok: true, prefs: out };
}
