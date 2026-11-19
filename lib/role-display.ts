// Shared mission-badge display helpers. Used by /about, /plane/[tail],
// /program, the radar filter and /settings/alerts so the taxonomy reads
// the same everywhere.
//
// Rider mental model: police aircraft are "Smokey" and get the alert
// styling. Every other class gets its own plain label and a neutral badge.
// Copy rules (design/BRAND.md §3): no emoji, no exclamation marks, and
// none of the voice-gate words, so these strings can render anywhere.

import type { Mission, PoliceUnit, RoleConfidence } from "./types";
import { SS_TOKENS } from "./tokens";
import { MISSIONS, normalizeMission } from "./mission";

const BADGE: Record<Mission, string> = {
  police: "SMOKEY",
  federal_le: "FEDERAL",
  sar: "SEARCH & RESCUE",
  wildfire: "WILDFIRE",
  medevac: "MEDEVAC",
  survey: "SURVEY",
  transport: "TRANSPORT",
  unknown: "UNCONFIRMED",
};

/** Title-case label for filter chips, settings rows and group headings. */
const LABEL: Record<Mission, string> = {
  police: "Smokey",
  federal_le: "Federal",
  sar: "Search & Rescue",
  wildfire: "Wildfire",
  medevac: "Medevac",
  survey: "Survey",
  transport: "Transport",
  unknown: "Unconfirmed",
};

const TOOLTIP: Record<Mission, string> = {
  police:
    "Smokey. WSP, a county sheriff, or a neighboring agency on mutual aid. Up = ease off.",
  federal_le:
    "Federal. Customs and Border Protection air unit. Border work, not traffic. Doesn't count as Smokey.",
  sar: "Search and rescue. Almost always responding to a rescue, not traffic.",
  wildfire: "Wildfire. DNR or a fire district, on fire duty.",
  medevac: "Medevac. Air ambulance on a patient run.",
  survey: "Survey. Wildlife, mapping, or photo flights.",
  transport: "Transport. Moves people and gear. Not traffic work.",
  unknown: "Unconfirmed. We haven't pinned down this tail's job yet. Doesn't count as Smokey.",
};

/** Short blurb for the /about group headings and the settings list. */
const BLURB: Record<Mission, string> = {
  police: "WSP, county sheriffs, and neighbors on mutual aid. One of these up turns the status orange.",
  federal_le: "Customs and Border Protection. Up near the border. Never turns the status orange.",
  sar: "Rescue runs.",
  wildfire: "DNR and fire districts on fire duty.",
  medevac: "Air ambulances.",
  survey: "Wildlife and mapping flights.",
  transport: "People and gear between airports.",
  unknown: "Tails we haven't classified.",
};

const UNIT: Record<PoliceUnit, string> = {
  wsp: "WSP",
  sheriff: "Sheriff",
  city: "City",
  tribal: "Tribal",
  state: "Out-of-state patrol",
};

const CONFIDENCE: Record<RoleConfidence, string> = {
  confirmed: "CONFIRMED",
  tentative: "TENTATIVE",
  unknown: "UNVERIFIED",
};

export function roleBadgeText(role: Mission | string): string {
  return BADGE[normalizeMission(role)];
}

export function missionLabel(role: Mission | string): string {
  return LABEL[normalizeMission(role)];
}

export function roleTooltip(role: Mission | string): string {
  return TOOLTIP[normalizeMission(role)];
}

export function missionBlurb(role: Mission | string): string {
  return BLURB[normalizeMission(role)];
}

export function policeUnitLabel(unit: PoliceUnit | undefined | null): string | null {
  return unit ? UNIT[unit] : null;
}

export function confidenceLabel(c: RoleConfidence): string {
  return CONFIDENCE[c];
}

/** Missions in display order, for group-by and pickers. */
export const MISSION_ORDER: readonly Mission[] = MISSIONS;

/** True when the badge should use the alert styling (police only). */
export function isAlertMission(role: Mission | string): boolean {
  return normalizeMission(role) === "police";
}

/**
 * Inline style for the mission badge pill. Police gets the alert amber
 * tint; every other class gets the neutral fg1 tint.
 */
export function roleBadgeStyle(role: Mission | string): React.CSSProperties {
  const isAlert = isAlertMission(role);
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    letterSpacing: ".06em",
    background: isAlert ? SS_TOKENS.alertDim : "rgba(107,115,128,0.13)",
    color: isAlert ? SS_TOKENS.alert : SS_TOKENS.fg1,
    border: `.5px solid ${isAlert ? `${SS_TOKENS.alert}55` : SS_TOKENS.hairline2}`,
    cursor: "help",
    whiteSpace: "nowrap",
  };
}

/** Small confirmed / tentative badge. Confirmed reads brighter. */
export function confidenceBadgeStyle(c: RoleConfidence): React.CSSProperties {
  const confirmed = c === "confirmed";
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 12,
    letterSpacing: ".08em",
    background: "transparent",
    color: SS_TOKENS.fg1,
    border: `.5px ${confirmed ? "solid" : "dashed"} ${SS_TOKENS.hairline2}`,
    cursor: "help",
    whiteSpace: "nowrap",
  };
}

/** Human label for a source URL: the host, minus "www.". */
export function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "registry.faa.gov") return "FAA registry";
    return host;
  } catch {
    return "source";
  }
}
