// Shared role-badge display helpers. Used by /about and /plane/[tail]
// so the role taxonomy reads consistently across the app.

import type { FleetRole } from "./types";
import { SS_TOKENS } from "./tokens";

export function roleBadgeText(role: FleetRole): string {
  switch (role) {
    case "smokey":
      return "SPEED ENFORCEMENT";
    case "patrol":
      return "MULTI-ROLE PATROL";
    case "sar":
      return "SEARCH & RESCUE";
    case "transport":
      return "TRANSPORT / MISC";
    case "unknown":
      return "ROLE UNCONFIRMED";
  }
}

export function roleTooltip(role: FleetRole): string {
  switch (role) {
    case "smokey":
      return "Fixed-wing speed enforcement plane. These are the Smokeys. Up = ease off.";
    case "patrol":
      return "Multi-role helicopter. Could be traffic enforcement, pursuit, or SAR. We err on alert.";
    case "sar":
      return "Search and rescue helicopter. Almost always responding to a rescue, not enforcement.";
    case "transport":
      return "State transport or photography aircraft. Not enforcement-related.";
    case "unknown":
      return "Role not yet confirmed. Treated as alert until classified.";
  }
}

/**
 * Inline style for the role badge pill. Smokey + patrol get the alert
 * amber tint; sar / transport / unknown get a neutral fg2 tint.
 */
export function roleBadgeStyle(role: FleetRole): React.CSSProperties {
  const isAlert = role === "smokey" || role === "patrol" || role === "unknown";
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 9.5,
    letterSpacing: ".06em",
    background: isAlert ? SS_TOKENS.alertDim : "rgba(107,115,128,0.13)",
    color: isAlert ? SS_TOKENS.alert : SS_TOKENS.fg1,
    border: `.5px solid ${isAlert ? `${SS_TOKENS.alert}55` : SS_TOKENS.hairline2}`,
    cursor: "help",
    whiteSpace: "nowrap",
  };
}
