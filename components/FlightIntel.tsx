// Route + pattern summary for a single flight session on /plane/[tail].
// Server component: pure derivation from the session's track points via
// lib/airports.ts and lib/orbit.ts. Renders nothing when there is nothing
// to say (no field resolved and no pattern flown).

import { Card } from "@/components/Card";
import { Tooltip } from "@/components/Tooltip";
import { inferArrival, inferDeparture } from "@/lib/airports";
import { detectOrbits, type OrbitSegment } from "@/lib/orbit";
import { SS_TOKENS } from "@/lib/tokens";
import type { TrackPoint } from "@/lib/tracks";

const MAX_PATTERN_LINES = 3;

export function FlightIntel({
  points,
  inProgress,
}: {
  points: TrackPoint[];
  inProgress: boolean;
}) {
  if (points.length < 2) return null;
  const dep = inferDeparture(points);
  const arr = inProgress ? null : inferArrival(points);
  const orbits = detectOrbits(points);
  if (!dep && !arr && orbits.length === 0) return null;

  const lastTs = points.reduce((m, p) => (p.ts > m ? p.ts : m), -Infinity);
  const route = `${dep?.id ?? "—"} → ${arr?.id ?? (inProgress ? "up" : "—")}`;

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <Tooltip content="Inferred from where the track starts and ends. Best guess from ADS-B, not a filed flight plan.">
          <span tabIndex={0} className="ss-eyebrow" style={{ cursor: "help" }}>
            Route
          </span>
        </Tooltip>
        <span
          className="ss-mono"
          data-testid="flight-route"
          style={{ fontSize: 15, fontWeight: 600, color: SS_TOKENS.fg0, letterSpacing: ".02em" }}
        >
          {route}
        </span>
      </div>
      {orbits.length > 0 && (
        <ul
          data-testid="flight-patterns"
          style={{
            listStyle: "none",
            margin: "10px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {orbits.slice(0, MAX_PATTERN_LINES).map((o) => (
            <li key={o.startTs} className="ss-mono" style={{ fontSize: 12.5, color: SS_TOKENS.fg1 }}>
              {patternLine(o, inProgress && lastTs - o.endTs <= 120)}
            </li>
          ))}
          {orbits.length > MAX_PATTERN_LINES && (
            <li className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
              +{orbits.length - MAX_PATTERN_LINES} more
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function patternLine(o: OrbitSegment, ongoing: boolean): string {
  const min = Math.max(1, Math.round(o.durationS / 60));
  const where = o.corridor ? ` over ${o.corridor}` : "";
  return ongoing
    ? `Working a pattern${where}, ${min} min so far`
    : `Worked a pattern${where}, ${min} min`;
}
