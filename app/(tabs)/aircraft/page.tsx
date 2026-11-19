import Link from "next/link";
import { fleetHex } from "@/lib/seed";
import { getRegistry } from "@/lib/registry";
import { SS_TOKENS, TYPE } from "@/lib/tokens";
import { Tooltip } from "@/components/Tooltip";
import { BackLink } from "@/components/BackLink";
import {
  MISSION_ORDER,
  confidenceBadgeStyle,
  confidenceLabel,
  missionBlurb,
  missionLabel,
  policeUnitLabel,
  roleBadgeStyle,
  roleBadgeText,
  roleTooltip,
  sourceLabel,
} from "@/lib/role-display";
import { normalizeMission } from "@/lib/mission";
import type { FleetEntry } from "@/lib/types";

// All aircraft: the tail registry, grouped by job. Moved off the More
// hub (/about) so the hub stays a hub. One compact row per tail, each
// with its confidence badge and a source link, for transparency.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "All aircraft",
  description: "Every tail SmokySignal watches, grouped by job, with the source for each.",
};

export default async function AircraftPage() {
  const fleet = await getRegistry();
  const groups = groupByMission(fleet);
  return (
    <main className="ss-page">
      <BackLink />
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="ss-eyebrow">SmokySignal · Aircraft</span>
        <h1
          style={{
            fontSize: TYPE.title,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
            margin: 0,
            color: SS_TOKENS.fg0,
          }}
        >
          All aircraft.
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: SS_TOKENS.fg1, margin: 0 }}>
          The {fleet.length} tails this app watches, grouped by job. Each one
          is checked against the FAA registry and, where we found one, an
          agency or press source. Only Smokey flips the pill. Who flies them
          and why is on{" "}
          <Link href="/program" style={{ color: SS_TOKENS.fg0, textDecoration: "underline" }}>
            the program
          </Link>
          .
        </p>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {groups.map((g) => (
          <MissionGroup key={g.mission} mission={g.mission} entries={g.entries} />
        ))}
      </div>
    </main>
  );
}

function groupByMission(
  fleet: FleetEntry[],
): Array<{ mission: FleetEntry["role"]; entries: FleetEntry[] }> {
  return MISSION_ORDER.map((m) => ({
    mission: m,
    entries: fleet.filter((f) => normalizeMission(f.role) === m),
  })).filter((g) => g.entries.length > 0);
}

function MissionGroup({
  mission,
  entries,
}: {
  mission: FleetEntry["role"];
  entries: FleetEntry[];
}) {
  return (
    <section aria-label={`${missionLabel(mission)} tails`} data-mission={mission}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2
          className="ss-mono"
          style={{ fontSize: 13, letterSpacing: ".12em", margin: 0, color: SS_TOKENS.fg0 }}
        >
          {roleBadgeText(mission)}
        </h2>
        <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>
          {entries.length} {entries.length === 1 ? "tail" : "tails"}
        </span>
      </div>
      <p style={{ fontSize: 13, color: SS_TOKENS.fg1, margin: "2px 0 8px", lineHeight: 1.45 }}>
        {missionBlurb(mission)}
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          background: SS_TOKENS.bg1,
          border: `.5px solid ${SS_TOKENS.hairline}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {entries.map((f, i) => (
          <TailRow key={f.tail} entry={f} first={i === 0} />
        ))}
      </ul>
    </section>
  );
}

function TailRow({ entry, first }: { entry: FleetEntry; first: boolean }) {
  const unit = policeUnitLabel(entry.policeUnit);
  const source = entry.sources[0];
  const mutualAid = entry.scope === "mutual_aid";
  return (
    <li
      data-tail={entry.tail}
      style={{
        padding: "8px 14px",
        borderTop: first ? "none" : `.5px solid ${SS_TOKENS.hairline}`,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "4px 10px",
      }}
    >
      <Link
        href={`/plane/${entry.tail}`}
        prefetch={false}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          textDecoration: "none",
          color: "inherit",
          flex: "1 1 220px",
          minWidth: 0,
        }}
      >
        <span
          className="ss-mono"
          style={{ fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0, letterSpacing: "-.01em" }}
        >
          {entry.tail}
        </span>
        <span
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.nickname ? `“${entry.nickname}” · ` : ""}
          {entry.operator} · {entry.model}
        </span>
      </Link>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Tooltip content={roleTooltip(entry.role)}>
          <span className="ss-mono" style={roleBadgeStyle(entry.role)} tabIndex={0}>
            {roleBadgeText(entry.role)}
          </span>
        </Tooltip>
        <Tooltip content={confidenceTip(entry.roleConfidence)}>
          <span
            className="ss-mono"
            tabIndex={0}
            data-confidence={entry.roleConfidence}
            style={confidenceBadgeStyle(entry.roleConfidence)}
          >
            {confidenceLabel(entry.roleConfidence)}
          </span>
        </Tooltip>
      </span>
      <div
        className="ss-mono"
        style={{
          flexBasis: "100%",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0 10px",
          fontSize: 12,
          color: SS_TOKENS.fg1,
          letterSpacing: ".04em",
        }}
      >
        <span>
          {fleetHex(entry).toUpperCase()} · {entry.base}
          {unit ? ` · ${unit}` : ""}
          {mutualAid ? " · Mutual aid" : ""}
        </span>
        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Source for ${entry.tail}: ${sourceLabel(source)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              color: SS_TOKENS.fg1,
              textDecoration: "underline",
            }}
          >
            source: {sourceLabel(source)}
            {entry.sources.length > 1 ? ` +${entry.sources.length - 1}` : ""}
          </a>
        )}
      </div>
    </li>
  );
}

function confidenceTip(confidence: FleetEntry["roleConfidence"]): string {
  return confidence === "confirmed"
    ? "Confirmed. The FAA owner record and an agency source agree."
    : confidence === "tentative"
      ? "Tentative. One source only, or the callsign-to-tail link is inferred. May be refined."
      : "Unverified. We have not confirmed this yet.";
}
