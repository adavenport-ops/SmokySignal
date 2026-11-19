"use client";

// /aircraft list: search (tail, nickname, agency), a single-select
// mission filter, a sort (last flew, 30-day flights, tail) and one row per
// tail with last flew and 30-day flights. Two columns at >= 1024px. Rows
// come from the server (app/(tabs)/aircraft/page.tsx); filtering is pure
// (lib/aircraft-list.ts). State lives in the URL query so a filtered list
// can be shared and survives the back button.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Tooltip } from "@/components/Tooltip";
import { filterAircraft, type AircraftFilter, type AircraftRow, type AircraftSort } from "@/lib/aircraft-list";
import { MISSIONS } from "@/lib/mission";
import {
  confidenceBadgeStyle,
  confidenceLabel,
  missionBlurb,
  missionLabel,
  roleBadgeStyle,
  roleBadgeText,
  roleTooltip,
  sourceLabel,
} from "@/lib/role-display";
import { SS_TOKENS } from "@/lib/tokens";
import type { Mission, RoleConfidence } from "@/lib/types";

export type AircraftListRow = AircraftRow & {
  hex: string;
  base: string;
  unit: string | null;
  mutualAid: boolean;
  confidence: RoleConfidence;
  sources: string[];
};

const SORTS: { id: AircraftSort; label: string }[] = [
  { id: "last_flew", label: "Last flew" },
  { id: "flights", label: "30-day flights" },
  { id: "tail", label: "Tail" },
];

function readParams(): Partial<AircraftFilter> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const mission = p.get("mission");
  const sort = p.get("sort");
  return {
    q: p.get("q") ?? "",
    mission: mission && (MISSIONS as readonly string[]).includes(mission) ? (mission as Mission) : "all",
    sort: SORTS.some((s) => s.id === sort) ? (sort as AircraftSort) : "last_flew",
  };
}

function writeParams(f: AircraftFilter) {
  const url = new URL(window.location.href);
  const set = (k: string, v: string, dflt: string) =>
    v && v !== dflt ? url.searchParams.set(k, v) : url.searchParams.delete(k);
  set("q", f.q.trim(), "");
  set("mission", f.mission, "all");
  set("sort", f.sort, "last_flew");
  window.history.replaceState(null, "", url.toString());
}

export function AircraftList({ rows }: { rows: AircraftListRow[] }) {
  const [filter, setFilter] = useState<AircraftFilter>({ q: "", mission: "all", sort: "last_flew" });
  // URL state applies after mount so the server render and hydration match.
  useEffect(() => {
    setFilter((f) => ({ ...f, ...readParams() }));
  }, []);
  const update = useCallback((patch: Partial<AircraftFilter>) => {
    setFilter((f) => {
      const next = { ...f, ...patch };
      writeParams(next);
      return next;
    });
  }, []);

  const missions = useMemo(() => {
    const present = new Set(rows.map((r) => r.mission));
    return MISSIONS.filter((m) => present.has(m));
  }, [rows]);
  const shown = useMemo(() => filterAircraft(rows, filter), [rows, filter]) as AircraftListRow[];

  return (
    <section aria-label="Aircraft list" data-testid="aircraft-list" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="ss-aircraft-controls">
        <label className="ss-aircraft-field" style={{ flex: "2 1 220px" }}>
          <span className="ss-eyebrow">Search</span>
          <input
            type="search"
            value={filter.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Tail, nickname or agency"
            aria-label="Search by tail, nickname or agency"
            data-testid="aircraft-search"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="ss-aircraft-field" style={{ flex: "1 1 160px" }}>
          <span className="ss-eyebrow">Mission</span>
          <select
            value={filter.mission}
            onChange={(e) => update({ mission: e.target.value as Mission | "all" })}
            data-testid="aircraft-mission"
          >
            <option value="all">Every mission</option>
            {missions.map((m) => (
              <option key={m} value={m}>
                {missionLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="ss-aircraft-field" style={{ flex: "1 1 160px" }}>
          <span className="ss-eyebrow">Sort</span>
          <select
            value={filter.sort}
            onChange={(e) => update({ sort: e.target.value as AircraftSort })}
            data-testid="aircraft-sort"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="ss-mono" role="status" style={{ fontSize: 12, color: SS_TOKENS.fg1, margin: 0 }}>
        {shown.length === rows.length
          ? `${rows.length} tails`
          : `${shown.length} of ${rows.length} tails`}
        {filter.mission !== "all" ? ` · ${missionBlurb(filter.mission)}` : ""}
      </p>

      {shown.length === 0 ? (
        <p style={{ fontSize: 14, color: SS_TOKENS.fg1, margin: 0 }} data-testid="aircraft-empty">
          No tail matches that. Clear the search or pick Every mission.
        </p>
      ) : (
        <ul className="ss-aircraft-grid" data-testid="aircraft-rows">
          {shown.map((r) => (
            <TailRow key={r.tail} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TailRow({ row }: { row: AircraftListRow }) {
  const source = row.sources[0];
  return (
    <li data-tail={row.tail} className="ss-aircraft-row">
      <Link
        href={`/plane/${row.tail}`}
        prefetch={false}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          textDecoration: "none",
          color: "inherit",
          minWidth: 0,
        }}
      >
        <span
          className="ss-mono"
          style={{ fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0, letterSpacing: "-.01em", whiteSpace: "nowrap" }}
        >
          {row.tail}
        </span>
        <span
          style={{
            fontSize: 13,
            color: SS_TOKENS.fg1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {row.nickname ? `“${row.nickname}” · ` : ""}
          {row.operator} · {row.model}
        </span>
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Tooltip content={roleTooltip(row.mission)}>
          <span className="ss-mono" style={roleBadgeStyle(row.mission)} tabIndex={0}>
            {roleBadgeText(row.mission)}
          </span>
        </Tooltip>
        <Tooltip content={confidenceTip(row.confidence)}>
          <span
            className="ss-mono"
            tabIndex={0}
            data-confidence={row.confidence}
            style={confidenceBadgeStyle(row.confidence)}
          >
            {confidenceLabel(row.confidence)}
          </span>
        </Tooltip>
      </div>
      <dl className="ss-aircraft-stats">
        <div>
          <dt>Last flew</dt>
          <dd data-testid="aircraft-last-flew">
            {row.up ? <span style={{ color: SS_TOKENS.alert }}>Up now</span> : (row.last_flew_label ?? "Not on file")}
          </dd>
        </div>
        <div>
          <dt>30-day flights</dt>
          <dd data-testid="aircraft-flights-30d">{row.flights_30d}</dd>
        </div>
      </dl>
      <div
        className="ss-mono"
        style={{
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
          {row.hex} · {row.base}
          {row.unit ? ` · ${row.unit}` : ""}
          {row.mutualAid ? " · Mutual aid" : ""}
        </span>
        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Source for ${row.tail}: ${sourceLabel(source)}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              color: SS_TOKENS.fg1,
              textDecoration: "underline",
            }}
          >
            source: {sourceLabel(source)}
            {row.sources.length > 1 ? ` +${row.sources.length - 1}` : ""}
          </a>
        )}
      </div>
    </li>
  );
}

function confidenceTip(confidence: RoleConfidence): string {
  return confidence === "confirmed"
    ? "Confirmed. The FAA owner record and an agency source agree."
    : confidence === "tentative"
      ? "Tentative. One source only, or the callsign-to-tail link is inferred. May be refined."
      : "Unverified. We have not confirmed this yet.";
}
