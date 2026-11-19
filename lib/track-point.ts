// Per-point capture for the permanent track history. Pure: no Redis, no
// Next imports, so lib/track-point.test.ts can pin it.
//
// Feed rows are normalized once, upstream, in lib/feeds/readsb.ts for every
// readsb v2 feed (adsb.fi, adsb.lol, airplanes.live). It fills NormalizedAc
// with the capture fields and tags `src`; lib/feed-merge.ts unions them by hex. captureFields() then folds
// the merged NormalizedAc into the compact optional keys appended to each
// TrackPoint, and parseTrackPoint() reads stored points back.
//
// Stored JSON stays compact: short keys, and a key is written only when
// the source reported a usable value (JSON.stringify drops undefined).
// Every new key is optional, so points written before 2026-11-18 (only
// lat/lon/alt/spd/trk/ts) still parse as TrackPoint.

import type { NormalizedAc, StoredFeedSrc } from "./types";

/** Optional per-point capture. Short keys keep each stored point small. */
export type TrackCapture = {
  /** Geometric (GNSS) altitude, ft. adsb.fi `alt_geom`. */
  ag?: number;
  /** Barometric vertical rate, ft/min. adsb.fi `baro_rate`. */
  vr?: number;
  /** Geometric vertical rate, ft/min. adsb.fi `geom_rate`. */
  vg?: number;
  /** Mode A squawk, 4 octal digits. */
  sq?: string;
  /** Emergency status when not "none" (e.g. "general", "lifeguard"). adsb.fi `emergency`. */
  em?: string;
  /** 1 when the position came from MLAT, not the aircraft's own ADS-B. */
  ml?: 1;
  /** ADS-B emitter category ("A1".."C7"). adsb.fi `category`. */
  cat?: string;
  /** Navigation integrity category. adsb.fi `nic`. */
  nic?: number;
  /** Radius of containment, metres. adsb.fi `rc`. */
  rc?: number;
  /** Navigation accuracy category for position. adsb.fi `nac_p`. */
  nacp?: number;
  /** Seconds between the position report and the feed snapshot. adsb.fi `seen_pos`. */
  sp?: number;
  /** Signal strength at the receiving station, dBFS. adsb.fi `rssi`. */
  rs?: number;
  /** Receivers that heard this aircraft, when the source says. */
  rx?: number;
  /** Callsign / flight ID, trimmed. adsb.fi `flight`. */
  cs?: string;
  /** Feed that supplied the position: "fi", "lol" or "apl"; older points may carry "os" (lib/types.ts StoredFeedSrc). */
  src?: StoredFeedSrc;
};

export type TrackPoint = {
  lat: number;
  lon: number;
  /** Barometric altitude, ft. */
  alt: number | null;
  /** Ground speed, kt. (adsb.fi `gs`; there is no separate speed field to keep.) */
  spd: number | null;
  /** True track, degrees. */
  trk: number | null;
  /** Snapshot time, unix seconds. Position time is ts - sp when sp is present. */
  ts: number;
} & TrackCapture;

// ─── value guards ────────────────────────────────────────────────────

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n);
}

function dec1(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n * 10) / 10;
}

const SQUAWK_RE = /^[0-7]{4}$/;
const CATEGORY_RE = /^[A-D][0-7]$/;
const CALLSIGN_RE = /^[A-Z0-9-]{1,8}$/;
const EMERGENCY_RE = /^[a-z_]{1,16}$/;

// ─── capture ─────────────────────────────────────────────────────────

/**
 * True when the position (lat/lon) came from multilateration. readsb
 * lists MLAT-derived fields in `mlat`; `type: "mlat"` marks a target
 * with no ADS-B position of its own.
 */
export function isMlatPosition(ac: Pick<NormalizedAc, "type" | "mlat">): boolean {
  if (ac.type === "mlat") return true;
  return Array.isArray(ac.mlat) && (ac.mlat.includes("lat") || ac.mlat.includes("lon"));
}

/** Compact optional capture for one aircraft observation. */
export function captureFields(ac: NormalizedAc): TrackCapture {
  const c: TrackCapture = {};
  const ag = int(ac.alt_geom);
  if (ag !== undefined) c.ag = ag;
  const vr = int(ac.baro_rate);
  if (vr !== undefined) c.vr = vr;
  const vg = int(ac.geom_rate);
  if (vg !== undefined) c.vg = vg;
  if (typeof ac.squawk === "string" && SQUAWK_RE.test(ac.squawk)) c.sq = ac.squawk;
  if (
    typeof ac.emergency === "string" &&
    ac.emergency !== "none" &&
    EMERGENCY_RE.test(ac.emergency)
  ) {
    c.em = ac.emergency;
  }
  if (isMlatPosition(ac)) c.ml = 1;
  if (typeof ac.category === "string" && CATEGORY_RE.test(ac.category)) c.cat = ac.category;
  const nic = int(ac.nic);
  if (nic !== undefined) c.nic = nic;
  const rc = int(ac.rc);
  if (rc !== undefined) c.rc = rc;
  const nacp = int(ac.nac_p);
  if (nacp !== undefined) c.nacp = nacp;
  const sp = dec1(ac.seen_pos);
  if (sp !== undefined && sp >= 0) c.sp = sp;
  const rs = dec1(ac.rssi);
  if (rs !== undefined) c.rs = rs;
  const rx = int(ac.receivers);
  if (rx !== undefined && rx >= 0) c.rx = rx;
  const cs = typeof ac.flight === "string" ? ac.flight.trim().toUpperCase() : "";
  if (CALLSIGN_RE.test(cs)) c.cs = cs;
  if (ac.src) c.src = ac.src;
  return c;
}

// ─── reading stored points ───────────────────────────────────────────

/**
 * Barometric altitudes outside this band are transponder or feed glitches
 * (an archive point once read 74,900 ft for a county Cessna). Nothing in
 * the tracked fleet flies above FL450 or below the Dead Sea.
 */
export const MAX_PLAUSIBLE_ALT_FT = 50_000;
export const MIN_PLAUSIBLE_ALT_FT = -2_000;

/** A finite altitude inside the plausible band, else undefined. */
export function plausibleAlt(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined || n > MAX_PLAUSIBLE_ALT_FT || n < MIN_PLAUSIBLE_ALT_FT) return undefined;
  return n;
}

/**
 * Parse one stored list element. Upstash may hand back the JSON string or
 * an already-deserialized object. Returns null when lat/lon/ts are not
 * finite numbers. Extra keys pass through untouched.
 */
export function parseTrackPoint(raw: unknown): TrackPoint | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const p = obj as Partial<TrackPoint>;
  if (num(p.lat) === undefined || num(p.lon) === undefined || num(p.ts) === undefined) {
    return null;
  }
  return {
    ...(p as TrackPoint),
    alt: plausibleAlt(p.alt) ?? null,
    spd: num(p.spd) ?? null,
    trk: num(p.trk) ?? null,
  };
}
