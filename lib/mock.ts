// Backward-compat shim. New code should use lib/mock-state.ts directly,
// which supports the full mock state machine (?mock=up|down|eyes-up|
// multiple|stale). This module preserves the original two exports so
// historical call sites keep working through the migration.

import type { Snapshot } from "./types";
import { applyMockState, parseMockState } from "./mock-state";

/** Equivalent to `applyMockState(snap, "up")`. */
export function mockAirborneSnapshot(snap: Snapshot): Snapshot {
  return applyMockState(snap, "up");
}

/** True iff `?mock=up` is set. New code should use `getMockStateFromRequest`. */
export function isMockOn(req: Request): boolean {
  return parseMockState(new URL(req.url).searchParams.get("mock")) === "up";
}
