// Local-preview track source for the history digest (road and town
// pages). Off unless all three hold: no KV binding, not a production
// deploy, and SS_DEV_HISTORY_BASE names an origin (e.g.
// https://www.smokysignal.app). It then reads that origin's public,
// read-only GET /api/history for the window and turns the simplified
// polylines back into track points, filling the gaps between vertices at
// 30 s so time-overhead numbers land close to the real ones.
//
// Why: `next dev` must never run against the production env, and a
// local build without KV renders empty road and town pages. This lets a
// reviewer see the pages with real numbers without a KV credential.
// Production always has KV, so this never runs there.

import { hasKv } from "./cache";
import { formatTs } from "./time";
import type { TrackPoint } from "./tracks";

const STEP_S = 30;
/** A vertex gap longer than this is a real gap, not a straight line to fill. */
const MAX_FILL_GAP_S = 300;

type PublicPolyline = { id: string; tail: string; points: [number, number, number | null, number][] };

export function devHistoryBase(): string | null {
  if (hasKv()) return null;
  if (process.env.VERCEL_ENV === "production") return null;
  const base = process.env.SS_DEV_HISTORY_BASE?.trim();
  if (!base || !/^https?:\/\/[^/]+$/.test(base.replace(/\/$/, ""))) return null;
  return base.replace(/\/$/, "");
}

/** Polyline vertices → track points every STEP_S seconds. Pure. */
export function densifyPolyline(points: PublicPolyline["points"]): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const [lat, lon, alt, ts] = points[i]!;
    out.push({ lat, lon, alt: alt ?? null, spd: null, trk: null, ts });
    const next = points[i + 1];
    if (!next) break;
    const gap = next[3] - ts;
    if (gap <= STEP_S || gap > MAX_FILL_GAP_S) continue;
    for (let t = ts + STEP_S; t < next[3]; t += STEP_S) {
      const f = (t - ts) / gap;
      out.push({
        lat: lat + (next[0] - lat) * f,
        lon: lon + (next[1] - lon) * f,
        alt: alt ?? null,
        spd: null,
        trk: null,
        ts: t,
      });
    }
  }
  return out;
}

/** Points per tail for the window, from the public history endpoint. */
export async function readPublicHistoryTracks(base: string, sinceMs: number, nowMs: number): Promise<Map<string, TrackPoint[]>> {
  const out = new Map<string, TrackPoint[]>();
  const from = formatTs(sinceMs, "date");
  const to = formatTs(nowMs, "date");
  const r = await fetch(`${base}/api/history?from=${from}&to=${to}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`public history ${r.status}`);
  const body = (await r.json()) as { polylines?: PublicPolyline[] };
  for (const pl of body.polylines ?? []) {
    if (!pl || typeof pl.tail !== "string" || !Array.isArray(pl.points)) continue;
    const list = out.get(pl.tail) ?? [];
    list.push(...densifyPolyline(pl.points));
    out.set(pl.tail, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}
