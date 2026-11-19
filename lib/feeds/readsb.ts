// Normalizer for readsb-style v2 JSON. adsb.fi, adsb.lol and
// airplanes.live all serve this row shape (ADSBexchange v2 compatible);
// they differ only in the envelope:
//   adsb.fi         { aircraft: [...], now: <epoch SECONDS, float> }
//   adsb.lol        { ac: [...],       now: <epoch MILLISECONDS> }
//   airplanes.live  { ac: [...],       now: <epoch ms> }
// The 2026-04-30 incident (reading `ac` off adsb.fi, whose field is
// `aircraft`) classified every tail as grounded for days, so each adapter
// names its envelope field explicitly and a missing array throws instead
// of reading as an empty sky.
//
// Besides the merge fields, each row keeps the extras the permanent track
// log captures (lib/track-point.ts captureFields): geometric altitude,
// vertical rates, emergency, category, integrity / accuracy, RSSI, MLAT
// field list, message type and callsign. Unknown fields are ignored, so
// a feed that adds fields never breaks the parser.

import type { FeedSrc, NormalizedAc } from "../types";
import { FeedPayloadError } from "./http";

/** readsb `now` is seconds on some feeds and milliseconds on others. */
export function epochMs(now: unknown, fallbackMs: number): number {
  if (typeof now !== "number" || !Number.isFinite(now) || now <= 0) {
    return fallbackMs;
  }
  return now > 1e12 ? Math.round(now) : Math.round(now * 1000);
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const short = (v: unknown, max: number): string | undefined => {
  const s = str(v);
  return s && s.length <= max ? s : undefined;
};

export function normalizeReadsbRow(
  row: unknown,
  src: FeedSrc,
  responseMs: number,
): NormalizedAc | null {
  if (!row || typeof row !== "object") return null;
  const a = row as Record<string, unknown>;
  const hex = str(a.hex)?.toLowerCase();
  if (!hex) return null;

  const lat = num(a.lat);
  const lon = num(a.lon);
  const hasPos = lat !== undefined && lon !== undefined;
  const seen_pos = hasPos ? num(a.seen_pos) : undefined;

  const out: NormalizedAc = { hex, src };
  const r = str(a.r);
  if (r) out.r = r;
  if (hasPos) {
    out.lat = lat;
    out.lon = lon;
    if (seen_pos !== undefined) out.seen_pos = seen_pos;
    out.pos_ts = Math.round(responseMs - (seen_pos ?? 0) * 1000);
  }
  if (a.alt_baro === "ground") out.alt_baro = "ground";
  else if (num(a.alt_baro) !== undefined) out.alt_baro = num(a.alt_baro);
  const gs = num(a.gs);
  if (gs !== undefined) out.gs = gs;
  const track = num(a.track);
  if (track !== undefined) out.track = track;
  const squawk = str(a.squawk);
  if (squawk) out.squawk = squawk;

  // Track-log extras. Numeric fields only when finite; strings trimmed and
  // length-capped so a hostile feed can't bloat the stored point.
  const alt_geom = num(a.alt_geom);
  if (alt_geom !== undefined) out.alt_geom = alt_geom;
  const baro_rate = num(a.baro_rate);
  if (baro_rate !== undefined) out.baro_rate = baro_rate;
  const geom_rate = num(a.geom_rate);
  if (geom_rate !== undefined) out.geom_rate = geom_rate;
  const emergency = short(a.emergency, 16);
  if (emergency) out.emergency = emergency;
  const category = short(a.category, 2);
  if (category) out.category = category;
  const flight = short(a.flight, 8);
  if (flight) out.flight = flight;
  const type = short(a.type, 24);
  if (type) out.type = type;
  // Position-quality fields describe this row's fix, so they travel with
  // it through the merge (lib/feed-merge.ts takes the fix as one unit).
  if (hasPos) {
    const nic = num(a.nic);
    if (nic !== undefined) out.nic = nic;
    const rc = num(a.rc);
    if (rc !== undefined) out.rc = rc;
    const nac_p = num(a.nac_p);
    if (nac_p !== undefined) out.nac_p = nac_p;
    if (Array.isArray(a.mlat)) {
      out.mlat = a.mlat.filter((f): f is string => typeof f === "string").slice(0, 32);
    }
  }
  const rssi = num(a.rssi);
  if (rssi !== undefined) out.rssi = rssi;
  return out;
}

export function normalizeReadsb(
  body: unknown,
  field: "aircraft" | "ac",
  src: FeedSrc,
  fetchedAtMs: number,
): NormalizedAc[] {
  const env = (body ?? {}) as Record<string, unknown>;
  const rows = env[field];
  if (!Array.isArray(rows)) throw new FeedPayloadError(src);
  const responseMs = epochMs(env.now, fetchedAtMs);
  const out: NormalizedAc[] = [];
  for (const row of rows) {
    const n = normalizeReadsbRow(row, src, responseMs);
    if (n) out.push(n);
  }
  return out;
}
