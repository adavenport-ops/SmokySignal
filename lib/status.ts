// Single source of truth for "what's the fleet doing right now."
// Both the home hero (Glanceable) and the radar status pill derive
// their copy from deriveStatus() — keeps them from disagreeing when,
// say, Guardian One is up but Smoky isn't.

import { SMOKY_TAIL } from "./seed";
import type { Aircraft, Snapshot } from "./types";

export type FleetStatus = "smoky_up" | "other_up" | "all_clear";

export type FleetStatusInfo = {
  status: FleetStatus;
  smokyAirborne: Aircraft | null;
  othersAirborne: Aircraft[];
  totalAirborne: number;
};

export function deriveStatus(snapshot: Snapshot): FleetStatusInfo {
  const smoky =
    snapshot.aircraft.find((a) => a.tail === SMOKY_TAIL && a.airborne) ??
    null;
  const others = snapshot.aircraft.filter(
    (a) => a.airborne && a.tail !== SMOKY_TAIL,
  );

  let status: FleetStatus;
  if (smoky) status = "smoky_up";
  else if (others.length > 0) status = "other_up";
  else status = "all_clear";

  return {
    status,
    smokyAirborne: smoky,
    othersAirborne: others,
    totalAirborne: (smoky ? 1 : 0) + others.length,
  };
}
