// Pure activity-diff logic: (previous state, current snapshot) → events +
// next state. No Redis, no clock reads, no imports beyond types, so it can
// be unit-tested directly (lib/activity-diff.test.ts). lib/activity.ts owns
// the KV reads/writes around it.
//
// Event kinds:
//   takeoff           — was grounded, now airborne
//   landing           — was airborne, then missing/grounded for at least
//                       LANDING_DEBOUNCE_MS (see below)
//   first_seen        — no prev entry for this tail and now airborne
//                       (effectively "newly added to the registry and
//                        already in the air on first observation")
//   squawk_emergency  — current squawk is 7500/7600/7700 AND prev
//                       squawk differed (so we only fire on transitions,
//                       not continuously while the alert is active)
//
// `altitude_change` is preserved as a tolerated kind on read for any
// pre-existing entries written by the previous activity-detection
// implementation; we no longer emit it.
//
// Landing debounce: a tail that drops out of one ADS-B response (coverage
// gap, low altitude, a single bad upstream tick) used to be recorded as a
// landing immediately, and then as a takeoff on the next tick when it
// reappeared. That is how /activity filled up with repeated "Pierce One
// down" rows (issue #74). Now the first missing tick only opens a pending
// landing; the landing is emitted once the tail has stayed missing or
// grounded for LANDING_DEBOUNCE_MS. If it reappears airborne before then,
// the pending landing is dropped and no events fire.

import type { Aircraft, FleetRole, Snapshot } from "./types";

export const LANDING_DEBOUNCE_MS = 3 * 60 * 1000;

const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

export type ActivityKind =
  | "takeoff"
  | "landing"
  | "first_seen"
  | "squawk_emergency"
  | "altitude_change"; // tolerated for read-back; never emitted by current code

export type ActivityEntry = {
  /** ms since epoch (Date.now()) */
  ts: number;
  tail: string;
  icao24?: string;
  /** FleetRole at the time the event was recorded — used to color the
   *  event icon in the activity feed. Older entries may not have this. */
  role?: FleetRole;
  kind: ActivityKind;
  squawk?: string | null;
  lat?: number | null;
  lon?: number | null;
  alt_ft?: number | null;
  description: string;
};

/** A tail that was airborne and has since gone missing or grounded. */
export type PendingLanding = {
  /** ms timestamp of the first snapshot where the tail was not airborne. */
  since: number;
  /** Last airborne position, recorded on the landing event. */
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
};

/**
 * What lib/activity.ts persists between ticks: the last non-degraded
 * snapshot plus any landings still inside the debounce window. A plain
 * Snapshot (the pre-debounce stored shape) is a valid PrevState.
 */
export type PrevState = Snapshot & {
  pending_landings?: Record<string, PendingLanding>;
};

export type DiffResult = {
  events: ActivityEntry[];
  /** State to persist for the next tick. Null means keep the existing one. */
  next: PrevState | null;
};

/**
 * Generates the human-readable description for an event. Branches on
 * fleet role so SAR / transport events read calmer than smokey / patrol
 * events ("on a run" vs "off the deck"). Older callers without the role
 * arg get the conservative default behavior.
 */
export function describeEvent(
  tail: string,
  nickname: string | null | undefined,
  kind: ActivityKind,
  squawk?: string | null,
  role: FleetRole = "unknown",
): string {
  const name = nickname ?? tail;

  if (kind === "takeoff") {
    if (role === "smokey") {
      if (nickname === "Smokey 4") return "Smokey off the deck";
      return `${name} off the deck`;
    }
    if (role === "patrol") {
      return `${name} up`;
    }
    if (role === "sar") {
      return `${name} on a run`;
    }
    if (role === "transport") {
      return `${name} up`;
    }
    return `${name} up`;
  }

  if (kind === "landing") {
    if (role === "sar") return `${name} back on the ground`;
    if (role === "smokey" && nickname === "Smokey 4") return "Smokey down";
    return `${name} down`;
  }

  if (kind === "first_seen") {
    return `${name} on watch`;
  }

  if (kind === "squawk_emergency") {
    const meaning =
      squawk === "7700"
        ? "emergency"
        : squawk === "7600"
          ? "radio failure"
          : squawk === "7500"
            ? "hijack"
            : "alert";
    return `${name} squawking ${meaning}`;
  }

  // altitude_change (legacy) or unknown
  return `${tail} ${kind}`;
}

function indexByTail(snap: Snapshot | null): Map<string, Aircraft> {
  const m = new Map<string, Aircraft>();
  if (!snap) return m;
  for (const a of snap.aircraft) m.set(a.tail, a);
  return m;
}

/**
 * Diff the current snapshot against the persisted previous state.
 *
 * - Degraded snapshots produce no events and leave prev untouched
 *   (`next: null`): an upstream outage is not a fleet-wide landing.
 * - `now` is the clock used for the debounce; defaults to the snapshot's
 *   own fetched_at so the function stays deterministic.
 */
export function diffActivity(
  prev: PrevState | null,
  curr: Snapshot,
  now: number = curr.fetched_at,
): DiffResult {
  if (curr.degraded) return { events: [], next: null };

  const prevByTail = indexByTail(prev);
  const prevPending = prev?.pending_landings ?? {};
  const nextPending: Record<string, PendingLanding> = {};
  const out: ActivityEntry[] = [];

  for (const a of curr.aircraft) {
    const p = prevByTail.get(a.tail);
    const pending = prevPending[a.tail];
    const role: FleetRole = a.role ?? "unknown";
    const currentPos = {
      lat: a.lat ?? null,
      lon: a.lon ?? null,
      alt_ft: a.altitude_ft ?? null,
    };

    if (a.airborne) {
      if (pending) {
        // Back in the air (or back in coverage) inside the debounce
        // window. The gap was a dropout, not a landing + takeoff.
      } else if (!p) {
        // first_seen: tail wasn't in prev snapshot at all and is currently
        // airborne. Fires once per registry add for any tail that's
        // already up when it joins. Intentionally no takeoff as well.
        out.push({
          ts: now,
          tail: a.tail,
          icao24: a.icao24,
          role,
          ...currentPos,
          kind: "first_seen",
          squawk: a.squawk ?? null,
          description: describeEvent(a.tail, a.nickname, "first_seen", null, role),
        });
      } else if (!p.airborne) {
        // takeoff — current position is the moment of liftoff
        out.push({
          ts: now,
          tail: a.tail,
          icao24: a.icao24,
          role,
          ...currentPos,
          kind: "takeoff",
          squawk: a.squawk ?? null,
          description: describeEvent(a.tail, a.nickname, "takeoff", null, role),
        });
      }
    } else if (pending) {
      if (now - pending.since >= LANDING_DEBOUNCE_MS) {
        // Missing/grounded for the full window: a real landing. Record
        // the last airborne position (the current one is stale or null)
        // and the time the tail first went missing.
        out.push({
          ts: pending.since,
          tail: a.tail,
          icao24: a.icao24,
          role,
          lat: pending.lat,
          lon: pending.lon,
          alt_ft: pending.alt_ft,
          kind: "landing",
          squawk: a.squawk ?? null,
          description: describeEvent(a.tail, a.nickname, "landing", null, role),
        });
      } else {
        nextPending[a.tail] = pending;
      }
    } else if (p && p.airborne) {
      // First tick without the tail airborne: open a pending landing.
      nextPending[a.tail] = {
        since: now,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
        alt_ft: p.altitude_ft ?? null,
      };
    }

    // squawk transition into emergency code
    const cs = a.squawk ?? null;
    const ps = p?.squawk ?? null;
    if (cs && EMERGENCY_SQUAWKS.has(cs) && cs !== ps) {
      out.push({
        ts: now,
        tail: a.tail,
        icao24: a.icao24,
        role,
        ...currentPos,
        kind: "squawk_emergency",
        squawk: cs,
        description: describeEvent(
          a.tail,
          a.nickname,
          "squawk_emergency",
          cs,
          role,
        ),
      });
    }
  }

  // The pending map travels with the stored snapshot. A pending tail is
  // stored as it was observed (airborne:false); the diff checks `pending`
  // before `p.airborne`, so a later reappearance is not read as a takeoff.
  const next: PrevState = {
    ...curr,
    ...(Object.keys(nextPending).length > 0
      ? { pending_landings: nextPending }
      : {}),
  };
  return { events: out, next };
}
