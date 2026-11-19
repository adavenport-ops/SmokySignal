"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { displayNicknameText } from "@/lib/nickname-display";
import { SS_TOKENS } from "@/lib/tokens";
import type { ActivityEntry, ActivityKind } from "@/lib/activity";
import { fmtAgoTs, fmtRelativeDay, formatTs, formatTsBare } from "@/lib/time";
import {
  groupActivity,
  groupByDay,
  placeLabel,
  rowTitle,
  type ActivityRow,
} from "@/lib/activity-group";

/**
 * The "Recent" tab of /flights: the activity feed, grouped by day.
 * `header` is the page heading row and `switcher` the Now/Recent
 * control, so both tabs share the same chrome.
 */
export function ActivityFeed({
  initial,
  header,
  switcher,
}: {
  initial: ActivityEntry[];
  header: ReactNode;
  switcher?: ReactNode;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>(initial);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/activity?limit=50", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { entries: ActivityEntry[] };
        if (!cancelled) setEntries(d.entries);
      } catch {
        /* transient */
      }
    };
    const id = setInterval(tick, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <main className="ss-page" style={{ gap: 14 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
          marginTop: 4,
        }}
      >
        {header}
      </header>

      {switcher}

      {entries.length === 0 ? <Empty /> : <List entries={entries} />}
    </main>
  );
}

function Empty() {
  return (
    <div
      style={{
        marginTop: 24,
        padding: "32px 16px",
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        color: SS_TOKENS.fg1,
      }}
    >
      <RadarPulse />
      <div style={{ fontSize: 13.5, textAlign: "center", lineHeight: 1.5 }}>
        Watching the sky.
        <br />
        Events appear here as planes takeoff, land, or signal.
      </div>
    </div>
  );
}

function List({ entries }: { entries: ActivityEntry[] }) {
  const days = useMemo(() => groupByDay(groupActivity(entries)), [entries]);
  const hasOnWatch = days.some((d) => d.rows.some((r) => r.kind === "first_seen"));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {days.map((d) => (
        <section key={d.day} aria-label={d.day}>
          <h2
            className="ss-mono"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              margin: 0,
              padding: "6px 2px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: SS_TOKENS.fg1,
              background: SS_TOKENS.bg0,
            }}
          >
            {fmtRelativeDay(d.rows[0]!.lastTs)} ·{" "}
            {formatTs(d.rows[0]!.lastTs, "date-short")}
          </h2>
          <div
            style={{
              background: SS_TOKENS.bg1,
              border: `.5px solid ${SS_TOKENS.hairline}`,
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {d.rows.map((r, i) => (
              <Row key={r.key} row={r} first={i === 0} />
            ))}
          </div>
        </section>
      ))}
      {hasOnWatch && <OnWatchLegend />}
    </div>
  );
}

/** "On watch" reads like jargon on its own; one line says what it means. */
function OnWatchLegend() {
  return (
    <p
      data-testid="activity-on-watch-legend"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: 0,
        padding: "0 2px",
        fontSize: 13,
        lineHeight: 1.45,
        color: SS_TOKENS.fg1,
      }}
    >
      <KindIcon kind="first_seen" />
      <span>
        <strong style={{ color: SS_TOKENS.fg0, fontWeight: 600 }}>On watch</strong>{" "}
        means the tail was already up when we first picked it up, so there is no takeoff time.
      </span>
    </p>
  );
}

function Row({ row, first }: { row: ActivityRow; first: boolean }) {
  const entry = row.entry;
  const isEmergency = row.kind === "squawk_emergency";
  const place = placeLabel(entry);
  const t0 = formatTsBare(row.firstTs, "hour-min");
  const t1 = formatTsBare(row.lastTs, "hour-min");
  const span =
    row.count > 1 && t0 !== t1 ? `${t0}–${t1} PT` : `${t1} PT`;
  return (
    <Link
      href={`/plane/${row.tail}`}
      prefetch={false}
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 14px",
        alignItems: "center",
        textDecoration: "none",
        color: "inherit",
        background: isEmergency
          ? "rgba(220,38,38,0.06)"
          : "transparent",
        borderTop: first ? 0 : `.5px solid ${SS_TOKENS.hairline}`,
      }}
    >
      <KindIcon kind={row.kind} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: isEmergency ? SS_TOKENS.danger : SS_TOKENS.fg0,
            lineHeight: 1.4,
          }}
        >
          {displayNicknameText(rowTitle(row))}
        </div>
        {place && (
          <div
            className="ss-mono"
            style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 2 }}
          >
            {place}
          </div>
        )}
        <div
          className="ss-mono"
          style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 2 }}
        >
          {fmtAgoTs(row.lastTs)} · {span}
        </div>
      </div>
      <span
        style={{
          fontSize: 18,
          // fg2 not fg3 — chevron is a navigation affordance and needs
          // visible contrast on the row background.
          color: SS_TOKENS.fg2,
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ›
      </span>
    </Link>
  );
}

function KindIcon({ kind }: { kind: ActivityKind }) {
  const baseStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: "var(--font-mono)",
    fontSize: 14,
    fontWeight: 700,
  };
  if (kind === "takeoff") {
    return (
      <span
        style={{
          ...baseStyle,
          background: "rgba(95,207,138,0.14)",
          color: SS_TOKENS.clear,
        }}
      >
        ↗
      </span>
    );
  }
  if (kind === "landing") {
    return (
      <span
        style={{
          ...baseStyle,
          background: "rgba(168,173,182,0.10)",
          color: SS_TOKENS.fg1,
        }}
      >
        ↘
      </span>
    );
  }
  if (kind === "first_seen") {
    return (
      <span
        style={{
          ...baseStyle,
          background: "rgba(125,211,252,0.14)",
          color: SS_TOKENS.sky,
        }}
        role="img"
        aria-label="On watch: already up when first seen"
        title="On watch: already up when we first picked it up"
      >
        ✦
      </span>
    );
  }
  if (kind === "squawk_emergency") {
    return (
      <span
        style={{
          ...baseStyle,
          background: "rgba(220,38,38,0.18)",
          color: SS_TOKENS.danger,
        }}
      >
        ⚠
      </span>
    );
  }
  return (
    <span
      style={{
        ...baseStyle,
        background: SS_TOKENS.bg2,
        color: SS_TOKENS.fg2,
      }}
    >
      ·
    </span>
  );
}

function RadarPulse() {
  return (
    <svg width="36" height="36" viewBox="0 0 32 32" aria-hidden>
      <circle
        cx="16"
        cy="16"
        r="14"
        fill="none"
        stroke={SS_TOKENS.alert}
        strokeOpacity="0.4"
        strokeWidth=".75"
      />
      <circle
        cx="16"
        cy="16"
        r="9"
        fill="none"
        stroke={SS_TOKENS.alert}
        strokeOpacity="0.6"
        strokeWidth=".75"
      />
      <circle cx="16" cy="16" r="3" fill={SS_TOKENS.alert}>
        <animate
          attributeName="opacity"
          values="1;0.3;1"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

