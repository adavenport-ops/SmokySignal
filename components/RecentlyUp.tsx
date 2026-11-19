"use client";

// "Recently up": the tails with the most recent activity, newest first,
// each with its nickname (or tail), a mission badge and "up now" /
// "2h ago". Sidebar and More sheet share it. Events come from the
// existing /api/activity feed (lib/hooks/useNavData.ts caches it); a live
// snapshot, when the caller has one, decides "up now".

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { recentLabel, recentlyUp } from "@/lib/nav";
import { normalizeMission } from "@/lib/mission";
import { useNavTails, useRecentActivity } from "@/lib/hooks/useNavData";
import type { Mission, Snapshot } from "@/lib/types";

const SHORT_BADGE: Record<Mission, string> = {
  police: "SMOKEY",
  federal_le: "FEDERAL",
  sar: "SAR",
  wildfire: "FIRE",
  medevac: "MEDEVAC",
  survey: "SURVEY",
  transport: "TRANSPORT",
  unknown: "UNCONFIRMED",
};

type Props = {
  variant: "sidebar" | "sheet";
  /** Live snapshot when the page has one (the sidebar does). */
  snapshot?: Snapshot | null;
  pathname?: string;
  limit?: number;
};

export function RecentlyUp({ variant, snapshot = null, pathname = "", limit = 5 }: Props) {
  const events = useRecentActivity();
  // Nicknames: from the snapshot when there is one, else the search index.
  const tails = useNavTails(!snapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [events]);

  const lookup = useMemo(() => {
    const m = new Map<string, { nickname: string | null; role: string }>();
    for (const t of tails ?? []) m.set(t.tail, { nickname: t.nickname, role: t.role });
    for (const a of snapshot?.aircraft ?? []) m.set(a.tail, { nickname: a.nickname, role: a.role });
    return m;
  }, [tails, snapshot]);

  const airborne = useMemo(
    () =>
      snapshot && !snapshot.degraded
        ? new Set(snapshot.aircraft.filter((a) => a.airborne).map((a) => a.tail))
        : null,
    [snapshot],
  );

  const rows = useMemo(
    () => (events ? recentlyUp(events, { nowMs: now, limit, airborne }) : null),
    [events, now, limit, airborne],
  );

  if (rows === null) {
    return <p className={variant === "sidebar" ? "ss-sb-empty" : "ss-sb-empty"}>Reading the log</p>;
  }
  if (rows.length === 0) {
    return <p className="ss-sb-empty">No flights logged yet.</p>;
  }

  return (
    <ul
      className={variant === "sheet" ? "ss-more-recent-list" : undefined}
      style={{ listStyle: "none", margin: 0, padding: 0, display: variant === "sheet" ? undefined : "flex", flexDirection: "column" }}
      data-testid={`recently-up-${variant}`}
    >
      {rows.map((r) => {
        const info = lookup.get(r.tail);
        const mission = normalizeMission(info?.role ?? r.role ?? "unknown");
        const alert = r.up && mission === "police";
        const name = info?.nickname ?? r.tail;
        const when = recentLabel(r, now);
        const href = `/plane/${encodeURIComponent(r.tail)}`;
        const current = pathname === href ? "page" : undefined;
        const upAttr = r.up ? (alert ? "alert" : "up") : undefined;
        if (variant === "sheet") {
          return (
            <li key={r.tail}>
              <Link href={href} className="ss-more-tail" aria-current={current}>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                  <span className="ss-mono ss-sb-tail-meta" data-up={upAttr}>
                    {info?.nickname ? `${r.tail} · ` : ""}
                    {when}
                  </span>
                </span>
                <span className="ss-mission" data-alert={alert ? "true" : undefined}>
                  {SHORT_BADGE[mission]}
                </span>
              </Link>
            </li>
          );
        }
        return (
          <li key={r.tail}>
            <Link href={href} className="ss-sb-tail" aria-current={current}>
              <span className="ss-sb-tail-row">
                <span className="ss-sb-tail-name">{name}</span>
                <span className="ss-mission" data-alert={alert ? "true" : undefined}>
                  {SHORT_BADGE[mission]}
                </span>
              </span>
              <span className="ss-mono ss-sb-tail-meta" data-up={upAttr}>
                {info?.nickname ? `${r.tail} · ` : ""}
                {when}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
