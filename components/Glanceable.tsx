"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Aircraft, FleetEntry, Snapshot } from "@/lib/types";
import type { ActivityEntry } from "@/lib/activity";
import type { LearningState } from "@/lib/learning";
import { SS_TOKENS, TAP_MIN, TYPE } from "@/lib/tokens";
import { describeSource } from "@/lib/feed-sources";
import { fmtAgoTs, fmtAloft, formatTsBare } from "@/lib/time";
import { useAircraft } from "@/lib/hooks/useAircraft";
import { useGrantedRiderPos, type GrantedPos } from "@/lib/hooks/useGrantedRiderPos";
import { bearingDeg, compass8, haversineNm } from "@/lib/geo";
import { computeStatus, feedDownStatus, type StatusState } from "@/lib/status";
import { StatusPill } from "./StatusPill";
import { Card } from "./Card";
import { PlaneIcon } from "./PlaneIcon";
import { PredictionCard } from "./PredictionCard";
import { HelpIcon } from "./HelpIcon";
import { Tooltip } from "./Tooltip";
import { Logo } from "./brand/Logo";
import { FreshnessLabel } from "./FreshnessLabel";
import { ArmAlertsCallout } from "./ArmAlertsCallout";
import { AlertsStateChip } from "./AlertsStateChip";
import { IOSInstallPrompt } from "./IOSInstallPrompt";
import { HomeMiniMap } from "./HomeMiniMap";
import { ScreenAwakeToggle } from "./ScreenAwake";

// Hide the activity strip when the most recent event is older than this —
// a stale "Guardian One up · 8 hours ago" looks more like a bug than a
// feature on the home screen.
const ACTIVITY_STRIP_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type Props = {
  initial: Snapshot;
  mockOn?: boolean;
  initialActivity?: ActivityEntry[];
  learning?: LearningState;
  hour12?: boolean;
  /** Optional historical-context phrase rendered under the Hero
   *  ("usually up at this hour. 67% of weeks."). Server computes,
   *  passes the string in. null = hide. */
  contextLine?: string | null;
  /** ms-since-epoch of the most recent track sample. null = no
   *  meta:last_sample_ts in KV yet (renders "UNKNOWN"). */
  lastSampleMs?: number | null;
};

export function Glanceable({
  initial,
  mockOn = false,
  initialActivity = [],
  learning,
  hour12 = false,
  contextLine = null,
  lastSampleMs = null,
}: Props) {
  const snap = useAircraft(initial, mockOn);
  const [updatedAgo, setUpdatedAgo] = useState<number>(0);
  const [activity, setActivity] = useState<ActivityEntry[]>(initialActivity);
  // Only resolves when geolocation is ALREADY granted (e.g. from /radar).
  // Never prompts on the home screen.
  const rider = useGrantedRiderPos();

  // Poll /api/activity every 30s so the strip stays current without
  // forcing a full snapshot regen.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/activity?limit=1", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { entries: ActivityEntry[] };
        if (!cancelled) setActivity(d.entries);
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

  // "Updated Xs" label.
  useEffect(() => {
    setUpdatedAgo(0);
    const id = setInterval(() => {
      setUpdatedAgo(Math.floor((Date.now() - snap.fetched_at) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [snap.fetched_at]);

  const fleetMap = useMemo(
    () => new Map<string, FleetEntry>(snap.aircraft.map((a) => [a.tail, a])),
    [snap.aircraft],
  );
  // Degraded = every upstream feed failed. The snapshot is then the last
  // good read (original fetched_at) or, when none is on hand, an
  // all-grounded placeholder (source "none"). Either way the sky state is
  // unknown, so the hero must not claim "Smokey's down."
  const feedDown = snap.degraded === true;
  const lastGoodMs = feedDown && snap.source !== "none" ? snap.fetched_at : null;
  const status = useMemo(
    () =>
      feedDown
        ? feedDownStatus(lastGoodMs, hour12)
        : computeStatus(snap, fleetMap),
    [feedDown, lastGoodMs, hour12, snap, fleetMap],
  );
  // Drop the headline plane from the also-up list. Without this filter
  // the lead appears twice — once as the hero, once at the top of the
  // also-up card — and the count in the also-up header disagrees with
  // the "X other watchers up." footnote in lib/status.ts which already
  // excludes the lead.
  const leadTail = status.lead?.aircraft.tail ?? null;
  const airborne = useMemo(
    () => snap.aircraft.filter((a) => a.airborne),
    [snap.aircraft],
  );
  const others = airborne.filter((a) => a.tail !== leadTail);
  const latestActivity =
    activity.length > 0 &&
    Date.now() - activity[0]!.ts < ACTIVITY_STRIP_MAX_AGE_MS
      ? activity[0]!
      : null;

  return (
    <main
      // ss-home-page widens the column into the two-column console at
      // >= 1280px.
      className="ss-hero-bg ss-page-narrow ss-home-page"
      style={{
        minHeight: "100dvh",
        // Tab bar + safe-area clearance comes from .ss-tabs-shell in the
        // (tabs) layout. The iOS install tip is an inline card now, so
        // nothing floats over the bottom of the page.
        padding: "12px 18px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 4,
          gap: 8,
          // Wraps on narrow phones: brand + chip on one row, source line
          // + help on the next. Both rows are information-only.
          flexWrap: "wrap",
          rowGap: 2,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          <Logo size={32} wordmark />
          <AlertsStateChip />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Tooltip
            side="bottom"
            align="end"
            content={
              feedDown
                ? "Every feed is quiet. Showing the last good read; positions may be out of date."
                : `Time since last successful data pull. ${describeSource(snap.source).detail}`
            }
          >
            <span
              className="ss-mono"
              tabIndex={0}
              style={{
                fontSize: 12,
                color: SS_TOKENS.fg1,
                whiteSpace: "nowrap",
                cursor: "help",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: feedDown ? SS_TOKENS.fg2 : SS_TOKENS.clear,
                  marginRight: 6,
                  verticalAlign: "middle",
                  animation: feedDown ? undefined : "ss-blink 1.6s infinite",
                }}
              />
              {feedDown
                ? `FEED QUIET · LAST ${lastGoodMs != null ? formatTsBare(lastGoodMs, "time", { hour12 }) : "—"}`
                : `UPDATED ${updatedAgo}s · ${describeSource(snap.source).label}`}
            </span>
          </Tooltip>
          <ScreenAwakeToggle variant="icon" />
          <HelpIcon variant="inline" />
        </div>
      </header>

      <div className="ss-home-grid">
        <div className="ss-home-col">
          <Hero status={status} />

          <QuickLinks />

          {contextLine && (
            <p
              className="ss-mono"
              style={{
                fontSize: 13,
                color: SS_TOKENS.fg1,
                margin: "-4px 4px 0",
                letterSpacing: ".02em",
                lineHeight: 1.4,
              }}
            >
              {contextLine}
            </p>
          )}

          {latestActivity && <ActivityStrip latest={latestActivity} />}

          <IOSInstallPrompt />
          <ArmAlertsCallout />

          {others.length > 0 && <Others others={others} rider={rider} />}
        </div>

        <div className="ss-home-col ss-home-col-side">
          <HomeMiniMap airborne={airborne} />

          <PredictionCard learning={learning} hour12={hour12} />

          <div style={{ marginTop: 4, paddingLeft: 4 }}>
            <FreshnessLabel lastSampleMs={lastSampleMs} />
          </div>

          <Footer />
        </div>
      </div>
    </main>
  );
}

function Footer() {
  return (
    <footer
      className="ss-mono"
      style={{
        marginTop: 4,
        padding: "8px 4px 0",
        fontSize: 12,
        color: SS_TOKENS.fg1,
        letterSpacing: ".04em",
        lineHeight: 1.6,
      }}
    >
      Aircraft data from{" "}
      <a
        href="https://adsb.fi"
        target="_blank"
        rel="noopener noreferrer"
        style={FOOTER_LINK}
      >
        adsb.fi
      </a>{" "}
      ·{" "}
      <a
        href="https://adsb.lol"
        target="_blank"
        rel="noopener noreferrer"
        style={FOOTER_LINK}
      >
        adsb.lol
      </a>{" "}
      (ODbL) ·{" "}
      <a
        href="https://opensky-network.org"
        target="_blank"
        rel="noopener noreferrer"
        style={FOOTER_LINK}
      >
        OpenSky Network
      </a>
      <br />
      <Link href="/about" style={FOOTER_LINK}>
        More
      </Link>
      {" · "}
      <Link href="/legal" style={FOOTER_LINK}>
        Legal
      </Link>
    </footer>
  );
}

// Footer link style — inline-block + vertical padding so the tap area
// reaches WCAG-AA's 44 px minimum without changing visible layout.
// Negative vertical margin keeps the line-height of the surrounding
// flow text unchanged.
const FOOTER_LINK: React.CSSProperties = {
  color: SS_TOKENS.fg0,
  textDecoration: "underline",
  textDecorationColor: SS_TOKENS.hairline2,
  textUnderlineOffset: 3,
  display: "inline-block",
  padding: "14px 4px",
  margin: "-14px -4px",
  lineHeight: 1,
};

// Four doors under the hero to the pages riders look for and could not
// find from Home: what's circling now, what flew over earlier, their
// road, and the forecast. 2x2 on phones, one row of four from 520px
// (.ss-home-quick in app/globals.css).
const QUICK_LINKS = [
  { href: "/circling", label: "What\u2019s circling" },
  { href: "/seen", label: "What flew over?" },
  { href: "/road", label: "Your road" },
  { href: "/forecast", label: "Forecast" },
] as const;

function QuickLinks() {
  return (
    <nav
      aria-label="Shortcuts"
      data-testid="home-quick-links"
      className="ss-home-quick"
    >
      {QUICK_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          prefetch={false}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            minHeight: TAP_MIN,
            padding: "6px 8px",
            borderRadius: 10,
            background: SS_TOKENS.bg1,
            border: `.5px solid ${SS_TOKENS.hairline}`,
            color: SS_TOKENS.fg0,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.2,
            textDecoration: "none",
            touchAction: "manipulation",
          }}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

function ActivityStrip({ latest }: { latest: ActivityEntry }) {
  // Orange dot only for a takeoff (a bird going up). Landings and other
  // events are history, not "Smokey is up".
  const upEvent = latest.kind === "takeoff";
  return (
    <Link
      href="/flights?tab=recent"
      prefetch={false}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: TAP_MIN + 4,
        padding: "8px 14px",
        borderRadius: 10,
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        textDecoration: "none",
        color: SS_TOKENS.fg1,
        fontSize: TYPE.body,
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: upEvent ? SS_TOKENS.alert : SS_TOKENS.fg1,
          boxShadow: upEvent ? `0 0 8px ${SS_TOKENS.alert}` : "none",
          flexShrink: 0,
          animation: upEvent ? "ss-blink 1.6s infinite" : undefined,
        }}
      />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {latest.description}
      </span>
      <span
        className="ss-mono"
        style={{ fontSize: 12, color: SS_TOKENS.fg1, flexShrink: 0 }}
      >
        {fmtAgoTs(latest.ts)}
      </span>
    </Link>
  );
}

function Hero({ status }: { status: StatusState }) {
  const isAlert = status.kind === "alert";
  // Feed-down renders grey: not alert, not all clear.
  const neutral = status.kind === "feed_down";
  const accentColor = neutral
    ? SS_TOKENS.fg1
    : isAlert
      ? SS_TOKENS.alert
      : SS_TOKENS.clear;
  const halo = neutral
    ? SS_TOKENS.hairline2
    : isAlert
      ? SS_TOKENS.alertDim
      : SS_TOKENS.clearDim;
  return (
    <section
      className="ss-hero-bg"
      data-status={status.kind}
      style={{
        background: `radial-gradient(120% 80% at 50% 0%, ${halo}, transparent 70%), ${SS_TOKENS.bg1}`,
        border: `.5px solid ${isAlert ? `${SS_TOKENS.alert}40` : SS_TOKENS.hairline}`,
        borderRadius: 22,
        padding: "28px 22px 24px",
      }}
    >
      <div
        className="ss-eyebrow"
        style={{ color: accentColor, animation: "ss-fade 400ms ease-out" }}
      >
        {status.pill}
      </div>
      <h1
        data-testid="hero-headline"
        style={{
          fontSize: `clamp(40px, 12vw, ${TYPE.display}px)`,
          fontWeight: 800,
          letterSpacing: "-.04em",
          lineHeight: 1.05,
          marginTop: 10,
          color: accentColor,
        }}
      >
        {status.headline}
      </h1>
      <p
        style={{
          marginTop: 12,
          fontSize: TYPE.heading,
          color: SS_TOKENS.fg0,
          lineHeight: 1.4,
        }}
      >
        {status.body}
      </p>
      {status.footnote && (
        <p
          style={{
            marginTop: 8,
            fontSize: TYPE.body,
            fontStyle: "italic",
            color: SS_TOKENS.fg1,
            lineHeight: 1.45,
          }}
        >
          {status.footnote}
        </p>
      )}
      {status.lead && status.kind === "alert" && (
        <>
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status.lead.aircraft.time_aloft_min != null && (
              <StatusPill
                kind="alert"
                label={fmtAloft(status.lead.aircraft.time_aloft_min)}
              />
            )}
            {status.lead.aircraft.ground_speed_kt != null && (
              <StatusPill
                kind="alert"
                label={`${status.lead.aircraft.ground_speed_kt} kt`}
              />
            )}
          </div>
          <LeadIdentity
            tail={status.lead.aircraft.tail}
            nickname={status.lead.entry.nickname}
            operator={status.lead.entry.operator}
          />
        </>
      )}
    </section>
  );
}

function LeadIdentity({
  tail,
  nickname,
  operator,
}: {
  tail: string;
  nickname: string | null;
  operator: string;
}) {
  // Lead-identity line under the stat chips so a rider knows whether
  // the smokey at 4m aloft is the WSP Cessna near Olympia or the CBP
  // B300C at FL190. Tappable — drills into /plane/[tail] for live
  // map + history.
  const middle = nickname ? ` · "${nickname}" · ` : " · ";
  return (
    <Link
      href={`/plane/${tail}`}
      prefetch={false}
      aria-label={`View ${nickname ?? tail} details`}
      className="ss-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: TAP_MIN,
        marginTop: 4,
        marginBottom: -10,
        fontSize: 13,
        color: SS_TOKENS.fg1,
        letterSpacing: ".04em",
        textDecoration: "none",
      }}
    >
      {tail}
      {middle}
      {operator}
    </Link>
  );
}

/**
 * Right-hand readout for an "Also up" row. Distance + bearing from the
 * rider when geolocation is already granted and the tail has a fix;
 * otherwise altitude and time aloft. Mono, tabular.
 */
function rowReadout(
  p: Aircraft,
  rider: GrantedPos | null,
): { primary: string; secondary: string | null; label: string } {
  if (rider && p.lat != null && p.lon != null) {
    const nm = haversineNm(rider.lat, rider.lon, p.lat, p.lon);
    const dir = compass8(bearingDeg(rider.lat, rider.lon, p.lat, p.lon));
    const dist = nm < 10 ? nm.toFixed(1) : Math.round(nm).toString();
    const alt = p.altitude_ft != null ? `${p.altitude_ft.toLocaleString("en-US")}′` : null;
    return {
      primary: `${dist} nm ${dir}`,
      secondary: alt,
      label: `${dist} nautical miles ${dir} of you${alt ? `, ${p.altitude_ft} feet` : ""}`,
    };
  }
  const alt = p.altitude_ft != null ? `${p.altitude_ft.toLocaleString("en-US")}′` : null;
  const aloft =
    p.time_aloft_min != null
      ? p.time_aloft_min < 60
        ? `${p.time_aloft_min}m up`
        : `${Math.floor(p.time_aloft_min / 60)}h${String(p.time_aloft_min % 60).padStart(2, "0")} up`
      : null;
  if (alt) {
    return {
      primary: alt,
      secondary: aloft,
      label: `${p.altitude_ft} feet${aloft ? `, ${aloft}` : ""}`,
    };
  }
  if (aloft) return { primary: aloft, secondary: "NO FIX", label: `${aloft}, no position fix` };
  return { primary: "UP", secondary: "NO FIX", label: "airborne, no position fix" };
}

function Others({
  others,
  rider,
}: {
  others: Aircraft[];
  rider: GrantedPos | null;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          padding: "0 4px 8px",
        }}
      >
        <span className="ss-eyebrow">Also up</span>
        <span
          className="ss-mono"
          style={{ fontSize: 12, color: SS_TOKENS.fg1 }}
        >
          {rider ? "FROM YOU · " : ""}
          {others.length} UP
        </span>
      </div>
      <Card padded={false}>
        {others.map((p, i) => {
          const r = rowReadout(p, rider);
          return (
            <Link
              key={p.tail}
              href={`/plane/${p.tail}`}
              prefetch={false}
              aria-label={`View ${p.nickname ?? p.tail} details. ${r.label}.`}
              data-testid="also-up-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                minHeight: 60,
                padding: "10px 14px",
                borderBottom:
                  i === others.length - 1
                    ? 0
                    : `.5px solid ${SS_TOKENS.hairline}`,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <PlaneIcon size={18} role={p.role} model={p.model} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="ss-mono"
                  style={{
                    fontSize: TYPE.body,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.tail}
                  {p.nickname && (
                    <span
                      style={{
                        color: SS_TOKENS.fg1,
                        fontWeight: 400,
                        marginLeft: 6,
                      }}
                    >
                      &ldquo;{p.nickname}&rdquo;
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: SS_TOKENS.fg1,
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.operator} · {p.model}
                </div>
              </div>
              <div
                className="ss-mono"
                style={{ textAlign: "right", flexShrink: 0, lineHeight: 1.25 }}
              >
                <div style={{ fontSize: TYPE.body, color: SS_TOKENS.fg0 }}>
                  {r.primary}
                </div>
                {r.secondary && (
                  <div style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 2 }}>
                    {r.secondary}
                  </div>
                )}
              </div>
              <ChevronRight />
            </Link>
          );
        })}
      </Card>
    </div>
  );
}

// Right-pointing chevron icon used as the visual "tappable" affordance
// on Also-up rows. Inline SVG so it ships in the initial HTML.
function ChevronRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={SS_TOKENS.fg1}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
