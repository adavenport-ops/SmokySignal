// Single source of truth for "what's the fleet doing right now," driven by
// FleetEntry.role (the mission taxonomy, lib/types.ts). The home hero
// (Glanceable), the radar status pill, the PWA app-icon badge, the
// beacon, the board and the embeddable /api/badge.svg all derive their
// copy from computeStatus().
//
// Owner decision, 2026-11: "Smokey's up" counts police only. That is WSP,
// county sheriffs, city / tribal police, and police mutual aid from OR /
// ID while it is inside Washington airspace (lib/mission.ts
// countsAsSmokey). Federal, SAR, wildfire, medevac, survey, transport and
// unconfirmed tails never flip the pill; when one is up alone we still
// show ALL CLEAR with a footnote ("SnoHawk 10 on a rescue run.") so
// riders have context without alarm.

import { formatTs } from "./time";
import type { Aircraft, Snapshot, FleetEntry, Mission } from "./types";
import {
  countsAsSmokey,
  isPoliceMission,
  isRotorcraftModel,
  normalizeMission,
} from "./mission";

/**
 * "feed_down": both upstream feeds failed, so the sky state is unknown.
 * Rendered neutral (grey), never as alert or all clear. Produced only by
 * feedDownStatus(); computeStatus() still returns alert | clear.
 */
export type StatusKind = "alert" | "clear" | "feed_down";

/**
 * Hero copy for a degraded snapshot. Deliberately neither "up" nor
 * "down": with both feeds quiet we do not know where Smokey is.
 * `lastGoodMs` is the fetched_at of the last good read, or null when the
 * snapshot is the all-grounded placeholder.
 */
export function feedDownStatus(
  lastGoodMs: number | null,
  hour12 = false,
): StatusState {
  return {
    kind: "feed_down",
    pill: "FEED QUIET",
    headline: "Feed's quiet.",
    body:
      lastGoodMs != null
        ? `Last good read ${formatTs(lastGoodMs, "time", { hour12 })}. Positions below may be out of date. Checking again every few seconds.`
        : "No good read from either feed yet. Checking again every few seconds.",
    lead: null,
    alertCount: 0,
    totalAirborne: 0,
  };
}

export type StatusState = {
  kind: StatusKind;
  /** Top-line label inside the pill: SMOKEY UP / ALL CLEAR. */
  pill: string;
  /** Optional sub-label inside the pill (e.g. "2 watching"). */
  pillSub?: string;
  /** Big home-page hero h1. */
  headline: string;
  /** Home-page subtitle paragraph. */
  body: string;
  /** Small footnote line under body when only clear-class aircraft are up. */
  footnote?: string;
  /** Lead aircraft + fleet entry, for callers that need raw context. */
  lead: { aircraft: Aircraft; entry: FleetEntry } | null;
  /**
   * Count of police aircraft up that count as Smokey (mutual aid only
   * inside WA airspace). Drives the "X up" suffix on the embeddable badge
   * and the PWA app-icon badge. Every other mission is excluded.
   */
  alertCount: number;
  /** Total airborne across all roles. */
  totalAirborne: number;
};

type Up = { aircraft: Aircraft; entry: FleetEntry };

/** Footnote phrase for a non-Smokey airframe that is up. */
function describeClearUp(up: Up): string {
  const name = up.entry.nickname ?? up.aircraft.tail;
  const mission = normalizeMission(up.entry.role);
  if (mission === "police") return `${name} up outside Washington.`;
  return `${name} ${CLEAR_PHRASE[mission]}`;
}

const CLEAR_PHRASE: Record<Exclude<Mission, "police">, string> = {
  federal_le: "up. Federal, not Smokey.",
  sar: "on a rescue run.",
  wildfire: "on a fire run.",
  medevac: "on a medical run.",
  survey: "on a survey run.",
  transport: "on a transport.",
  unknown: "up. Not confirmed as Smokey.",
};

// Lead order inside the Smokey class: WSP first (the speed-enforcement
// fleet), then everyone else in snapshot order.
function smokeyRank(e: FleetEntry): number {
  return e.policeUnit === "wsp" ? 0 : 1;
}

function alertBody(lead: Up): string {
  const e = lead.entry;
  if (e.policeUnit === "wsp" && !isRotorcraftModel(e.model)) {
    return e.nickname
      ? `${e.nickname} watching. Mind the throttle.`
      : "Speed enforcement plane in the air. Mind the throttle.";
  }
  if (e.scope === "mutual_aid") {
    return e.nickname
      ? `${e.nickname} over Washington. Mind the throttle.`
      : "Out-of-state bird over Washington. Mind the throttle.";
  }
  if (e.nickname) return `${e.nickname} in the air. Could be patrol.`;
  return e.policeUnit === "sheriff"
    ? "Sheriff's bird in the air. Mind the throttle."
    : "Patrol bird in the air. Mind the throttle.";
}

export function computeStatus(
  snapshot: Snapshot,
  fleet: Map<string, FleetEntry>,
): StatusState {
  const airborne = snapshot.aircraft.filter((a) => a.airborne);
  const smokey: Up[] = [];
  const other: Up[] = [];
  for (const a of airborne) {
    const entry = fleet.get(a.tail);
    if (!entry) continue;
    const up = { aircraft: a, entry };
    if (countsAsSmokey({ role: entry.role, scope: entry.scope, lat: a.lat, lon: a.lon })) {
      smokey.push(up);
    } else {
      other.push(up);
    }
  }
  const alertCount = smokey.length;

  if (smokey.length > 0) {
    const ordered = [...smokey].sort(
      (x, y) => smokeyRank(x.entry) - smokeyRank(y.entry),
    );
    const lead = ordered[0]!;
    return {
      kind: "alert",
      pill: "SMOKEY UP",
      pillSub: alertCount > 1 ? `${alertCount} up` : undefined,
      headline: "Smokey’s up.",
      body: alertBody(lead),
      footnote: buildAlertFootnote(ordered, lead),
      lead,
      alertCount,
      totalAirborne: airborne.length,
    };
  }

  // Clear with footnote: only non-Smokey airframes up. ALL CLEAR, green.
  if (other.length > 0) {
    const lead = other[0]!;
    return {
      kind: "clear",
      pill: "ALL CLEAR",
      headline: "Smokey’s down.",
      body: "No bird up over Washington. Send it.",
      footnote: describeClearUp(lead),
      lead,
      alertCount: 0,
      totalAirborne: airborne.length,
    };
  }

  // Nothing airborne. ALL CLEAR, green.
  return {
    kind: "clear",
    pill: "ALL CLEAR",
    headline: "Smokey’s down.",
    body: "No bird up over Washington. Send it.",
    lead: null,
    alertCount: 0,
    totalAirborne: 0,
  };
}

function buildAlertFootnote(smokey: Up[], lead: Up): string | undefined {
  const others = smokey
    .filter((r) => r.aircraft.tail !== lead.aircraft.tail)
    .map((r) => r.entry.nickname ?? r.aircraft.tail);
  if (others.length === 0) return undefined;
  if (others.length === 1) return `${others[0]} also up.`;
  return `${others.length} other watchers up.`;
}

/** Convenience for callers that only have an array, not a Map. */
export function makeFleetMap(fleet: FleetEntry[]): Map<string, FleetEntry> {
  return new Map(fleet.map((f) => [f.tail, f]));
}

/**
 * True for the Smokey class (police). Accepts legacy role values too.
 * Position-blind: callers that need the mutual-aid airspace rule use
 * countsAsSmokey() from lib/mission.ts.
 */
export function isAlertRole(role: Mission | string | undefined | null): boolean {
  return isPoliceMission(role);
}
