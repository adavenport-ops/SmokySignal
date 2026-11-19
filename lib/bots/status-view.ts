// Read-side for the bots: the current status and one tail's last flight,
// with tight timeouts. Discord wants an answer inside 3 seconds, so a
// slow cache-miss rebuild falls back to the long-TTL health mirror
// (which will usually read stale) instead of hanging the interaction.
//
// Server-only (reads KV through lib/snapshot and lib/flights).

import { beaconFromSnapshot } from "../beacon";
import { countsAsSmokey } from "../mission";
import { computeStatus, makeFleetMap, type StatusState } from "../status";
import type { Aircraft, FleetEntry, Snapshot } from "../types";
import type { FlightSession } from "../flights";

export const SNAPSHOT_READ_TIMEOUT_MS = 1_800;
export const FLIGHT_READ_TIMEOUT_MS = 1_200;

export type StatusView = {
  state: "up" | "down" | "stale";
  status: StatusState | null;
  fetchedAt: number | null;
  /** Airborne aircraft that count as Smokey, WSP first. */
  smokeys: Aircraft[];
};

export type PlaneView = {
  tail: string;
  entry: FleetEntry | null;
  live: Aircraft | null;
  /** True when the live row counts as Smokey right now. */
  smokeyUp: boolean;
  lastFlight: FlightSession | null;
  lastFlightInProgress: boolean;
  fetchedAt: number | null;
  stale: boolean;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function readSnapshotQuick(): Promise<Snapshot | null> {
  const { getSnapshot, peekHealthSnapshot } = await import("../snapshot");
  const snap = await withTimeout(getSnapshot(), SNAPSHOT_READ_TIMEOUT_MS);
  if (snap) return snap;
  return await withTimeout(peekHealthSnapshot(), 800);
}

/** Pure: snapshot → StatusView. */
export function statusViewFromSnapshot(snap: Snapshot | null, now: number): StatusView {
  if (!snap) return { state: "stale", status: null, fetchedAt: null, smokeys: [] };
  const fleet = makeFleetMap(snap.aircraft);
  const beacon = beaconFromSnapshot(snap, fleet, now);
  const status = computeStatus(snap, fleet);
  const smokeys = snap.aircraft
    .filter((a) => a.airborne && countsAsSmokey({ role: a.role, scope: a.scope, lat: a.lat, lon: a.lon }))
    .sort((x, y) => (x.policeUnit === "wsp" ? 0 : 1) - (y.policeUnit === "wsp" ? 0 : 1));
  return { state: beacon.state, status, fetchedAt: beacon.fetched_at, smokeys };
}

export async function readStatusView(now: number = Date.now()): Promise<StatusView> {
  return statusViewFromSnapshot(await readSnapshotQuick(), now);
}

export function normalizeTail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{2,10}$/.test(t) ? t : null;
}

export async function readPlaneView(tail: string, now: number = Date.now()): Promise<PlaneView | null> {
  const [{ getRegistry }, snap] = await Promise.all([import("../registry"), readSnapshotQuick()]);
  const registry = (await withTimeout(getRegistry(), SNAPSHOT_READ_TIMEOUT_MS)) ?? [];
  const live = snap?.aircraft.find((a) => a.tail.toUpperCase() === tail) ?? null;
  const entry = registry.find((f) => f.tail.toUpperCase() === tail) ?? live ?? null;
  if (!entry) return null;
  const { getMostRecentFlightForTail } = await import("../flights");
  const recent = await withTimeout(
    getMostRecentFlightForTail(entry.tail, entry.nickname),
    FLIGHT_READ_TIMEOUT_MS,
  );
  const stale = statusViewFromSnapshot(snap, now).state === "stale";
  return {
    tail: entry.tail,
    entry,
    live,
    smokeyUp: Boolean(
      live?.airborne && countsAsSmokey({ role: live.role, scope: live.scope, lat: live.lat, lon: live.lon }),
    ),
    lastFlight: recent?.session ?? null,
    lastFlightInProgress: recent?.inProgress ?? false,
    fetchedAt: snap?.fetched_at ?? null,
    stale,
  };
}
