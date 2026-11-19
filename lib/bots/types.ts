// Shared shapes for the bot pipeline. Pure.

import type { Mission, MissionScope, PoliceUnit } from "../types";

/** One takeoff, as every bot sees it. */
export type BotTakeoffEvent = {
  tail: string;
  nickname: string | null;
  /** The aircraft's mission (normalized). */
  mission: Mission;
  /**
   * The mission this takeoff matches rider filters as: mutual-aid police
   * outside Washington airspace match nothing (null), same rule as push.
   */
  matchMission: Mission | null;
  policeUnit?: PoliceUnit;
  scope?: MissionScope;
  lat: number | null;
  lon: number | null;
  alt_ft: number | null;
  /** Takeoff time, ms since epoch. */
  tsMs: number;
};

/** A best-effort fan-out summary. */
export type BotSendSummary = {
  sent: number;
  skipped: number;
  removed: number;
  reason?: string;
};
