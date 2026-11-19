// /glance: the pure model behind the handlebar-mount screen. One snapshot
// plus "now" and an optional rider position in, one display model out.
// No React, no fetch, no Date.now(), so lib/glance.test.ts pins it.
//
// Honesty rule (same as the Beacon, lib/beacon.ts): a stale or missing
// read is never shown as DOWN, and never as UP either. The screen says
// the feed is quiet and when the last good read was.

import { countsAsSmokey } from "./mission";
import { isFeedStale } from "./beacon";
import { haversineNm } from "./geo";
import type { Aircraft, Snapshot } from "./types";

export type GlanceKind = "up" | "down" | "stale";

export type RiderPos = { lat: number; lon: number };

export type GlanceNearest = {
  tail: string;
  /** Short label for the bird: nickname, else the tail. */
  name: string;
  miles: number;
  /** Degrees clockwise from true north, rider to aircraft, 0..359. */
  bearingDeg: number;
  /** "NNE" style 16-point label. */
  compass: string;
};

export type GlanceModel = {
  kind: GlanceKind;
  /** Police aircraft up that count as Smokey. Last known when stale. */
  count: number;
  /** Null unless kind is "up" and a rider position is known. */
  nearest: GlanceNearest | null;
  /** Name of the lead bird when up, for the line shown without location. */
  leadName: string | null;
  /** ms of the last good read, or null when there is none. */
  readAt: number | null;
  ageS: number | null;
};

const NM_TO_MI = 1.15078;

/** Initial great-circle bearing, degrees clockwise from north, 0..359. */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((deg + 360) % 360) % 360;
}

const POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

/** 16-point compass label for a bearing in degrees. */
export function compassPoint(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(d / 22.5) % 16]!;
}

/** "0.4 MI" under ten miles, "27 MI" above. */
export function fmtMiles(mi: number): string {
  if (!Number.isFinite(mi)) return "--";
  return mi < 10 ? `${(Math.round(mi * 10) / 10).toFixed(1)} MI` : `${Math.round(mi)} MI`;
}

function hasPos(a: Aircraft): a is Aircraft & { lat: number; lon: number } {
  return typeof a.lat === "number" && typeof a.lon === "number";
}

function smokeyUp(snap: Snapshot): Aircraft[] {
  return snap.aircraft.filter(
    (a) =>
      a.airborne &&
      countsAsSmokey({ role: a.role, scope: a.scope, lat: a.lat, lon: a.lon }),
  );
}

/** Closest Smokey aircraft to the rider, or null when none has a position. */
export function nearestSmokey(
  snap: Snapshot,
  rider: RiderPos,
): GlanceNearest | null {
  let best: { a: Aircraft & { lat: number; lon: number }; nm: number } | null = null;
  for (const a of smokeyUp(snap)) {
    if (!hasPos(a)) continue;
    const nm = haversineNm(rider.lat, rider.lon, a.lat, a.lon);
    if (!best || nm < best.nm) best = { a, nm };
  }
  if (!best) return null;
  const b = bearingDeg(rider.lat, rider.lon, best.a.lat, best.a.lon);
  return {
    tail: best.a.tail,
    name: best.a.nickname ?? best.a.tail,
    miles: best.nm * NM_TO_MI,
    bearingDeg: b,
    compass: compassPoint(b),
  };
}

/**
 * Build the display model. `snap` null (never read, or the last fetch
 * failed before any good read) is stale. An old or degraded snapshot is
 * stale too: the stale rule is isFeedStale() from the Beacon.
 */
export function glanceModel(
  snap: Snapshot | null | undefined,
  now: number,
  rider: RiderPos | null,
): GlanceModel {
  if (!snap) {
    return { kind: "stale", count: 0, nearest: null, leadName: null, readAt: null, ageS: null };
  }
  const readAt = Number.isFinite(snap.fetched_at) ? snap.fetched_at : null;
  const ageS = readAt == null ? null : Math.max(0, Math.floor((now - readAt) / 1000));
  const up = smokeyUp(snap);
  if (isFeedStale(snap, now)) {
    return { kind: "stale", count: up.length, nearest: null, leadName: null, readAt, ageS };
  }
  if (up.length === 0) {
    return { kind: "down", count: 0, nearest: null, leadName: null, readAt, ageS };
  }
  const lead = [...up].sort((x, y) => {
    const wx = x.policeUnit === "wsp" ? 0 : 1;
    const wy = y.policeUnit === "wsp" ? 0 : 1;
    return wx - wy;
  })[0]!;
  return {
    kind: "up",
    count: up.length,
    nearest: rider ? nearestSmokey(snap, rider) : null,
    leadName: lead.nickname ?? lead.tail,
    readAt,
    ageS,
  };
}
