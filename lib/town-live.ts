// The live line on a town page: "Anything up near Puyallup right now?"
// answered from the current snapshot. Pure and client-safe.
//
// Copy rules (design/BRAND.md §3): "all clear" only when nothing we track
// is airborne at all, and always next to the note that we only see what
// receivers hear. Something up far away is "nothing within 15 mi", not
// all clear.

import { bearingDeg, haversineNm } from "./geo";
import { corridorLabel } from "./corridor";
import { countsAsSmokey } from "./mission";
import { missionLabel } from "./role-display";
import { compassWord, fmtMiles } from "./seen-view";
import type { Aircraft, Snapshot } from "./types";

/** "Near" for the live line, statute miles. */
export const LIVE_NEAR_MI = 15;
const NM_TO_MI = 1.15078;

export type TownLiveState =
  | { kind: "loading" }
  | { kind: "no_signal" }
  | { kind: "clear" }
  | { kind: "near" | "far"; name: string; tail: string; mission: string; smokey: boolean; mi: number; direction: string; road: string | null; altFt: number | null; others: number };

type Point = { lat: number; lon: number };

function airborneWithFix(a: Aircraft): a is Aircraft & { lat: number; lon: number } {
  return a.airborne && typeof a.lat === "number" && typeof a.lon === "number" && Number.isFinite(a.lat) && Number.isFinite(a.lon);
}

export function townLiveState(snap: Pick<Snapshot, "fetched_at" | "aircraft" | "degraded"> | null, town: Point): TownLiveState {
  if (!snap || snap.fetched_at <= 0) return { kind: "loading" };
  if (snap.degraded) return { kind: "no_signal" };
  const up = snap.aircraft.filter(airborneWithFix);
  if (up.length === 0) return { kind: "clear" };
  const ranked = up
    .map((a) => ({ a, nm: haversineNm(town.lat, town.lon, a.lat, a.lon) }))
    .sort((x, y) => x.nm - y.nm);
  const { a, nm } = ranked[0]!;
  const mi = nm * NM_TO_MI;
  return {
    kind: mi <= LIVE_NEAR_MI ? "near" : "far",
    name: a.nickname?.trim() || a.tail,
    tail: a.tail,
    mission: missionLabel(a.role),
    smokey: countsAsSmokey(a),
    mi,
    // From the town to the aircraft.
    direction: compassWord(bearingDeg(town.lat, town.lon, a.lat, a.lon)),
    road: corridorLabel(a.lat, a.lon),
    altFt: typeof a.altitude_ft === "number" && Number.isFinite(a.altitude_ft) ? a.altitude_ft : null,
    others: ranked.filter((r) => r.nm * NM_TO_MI <= LIVE_NEAR_MI).length - (mi <= LIVE_NEAR_MI ? 1 : 0),
  };
}

/** The one-line answer. */
export function townLiveLine(s: TownLiveState, townName: string): string {
  switch (s.kind) {
    case "loading":
      return "Checking the feed.";
    case "no_signal":
      return "No signal from the feed right now. The live map says more once it is back.";
    case "clear":
      return `All clear near ${townName}. Nothing we track is up right now.`;
    case "near": {
      const where = s.road ? `, over ${s.road}` : "";
      const alt = s.altFt != null ? `, ${Math.round(s.altFt).toLocaleString("en-US")} ft` : "";
      const more = s.others > 0 ? ` ${s.others} more within ${LIVE_NEAR_MI} mi.` : "";
      return `Yes. ${s.name} is up ${fmtMiles(s.mi)} mi ${s.direction} of ${townName}${where}${alt}.${more}`;
    }
    case "far":
      return `Nothing we track within ${LIVE_NEAR_MI} mi of ${townName}. Nearest up: ${s.name}, ${fmtMiles(s.mi)} mi ${s.direction}${s.road ? `, over ${s.road}` : ""}.`;
  }
}
