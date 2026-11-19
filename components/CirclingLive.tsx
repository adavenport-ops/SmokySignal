"use client";

// Live list for /circling. Server-rendered first paint, then a quiet
// 30 s refresh from /api/circling while the tab is visible.
//
// "Near me" uses browser geolocation and sorts on this device only. The
// coordinates are never put in a request: /api/circling takes no
// parameters, and nothing here stores the position.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { formatTs } from "@/lib/time";
import { roleBadgeStyle } from "@/lib/role-display";
import {
  NEAR_ME_MILES,
  countWithin,
  fmtMiles,
  sortByDistance,
} from "@/lib/near-me";
import type { CirclingItem } from "@/lib/circling";
import type { CirclingResponse } from "@/lib/circling-server";
import styles from "./pattern-pages.module.css";

const REFRESH_MS = 30_000;

type GeoState = "off" | "asking" | "on" | "denied" | "unavailable";

export function CirclingLive({
  initial,
  hour12,
}: {
  initial: CirclingResponse;
  hour12: boolean;
}) {
  const [data, setData] = useState<CirclingResponse>(initial);
  const [geo, setGeo] = useState<GeoState>("off");
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/circling");
        if (!r.ok) return;
        const body = (await r.json()) as CirclingResponse;
        if (!stopped && Array.isArray(body.patterns)) setData(body);
      } catch {
        /* keep the last good list */
      }
    }
    const id = window.setInterval(tick, REFRESH_MS);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const askNearMe = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGeo("unavailable");
      return;
    }
    setGeo("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setGeo("on");
      },
      (err) => {
        setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  const clearNearMe = useCallback(() => {
    setMe(null);
    setGeo("off");
  }, []);

  const sorted = useMemo(
    () => (me ? sortByDistance(data.patterns, me) : null),
    [data.patterns, me],
  );
  const nearCount = sorted ? countWithin(sorted, NEAR_ME_MILES) : null;
  const list: (CirclingItem & { distanceMi?: number })[] = sorted ?? data.patterns;
  const updated = formatTs(data.fetched_at, "time", { hour12 });

  return (
    <section aria-label="Working a pattern now" className={styles.col} data-testid="circling-live">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {geo === "on" ? (
          <button type="button" className={styles.button} onClick={clearNearMe}>
            Sorted by distance · Clear
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            onClick={askNearMe}
            disabled={geo === "asking"}
            data-testid="near-me"
          >
            {geo === "asking" ? "Finding you" : "Near me"}
          </button>
        )}
        <span
          className="ss-mono"
          data-testid="circling-count"
          style={{ fontSize: 12, color: SS_TOKENS.fg1 }}
        >
          {data.degraded
            ? `Feed quiet · last read ${updated}`
            : `${data.patterns.length} working a pattern · ${updated}`}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg2 }}>
        {geo === "denied"
          ? "Location is blocked for this site, so the list stays sorted by time in the pattern."
          : geo === "unavailable"
            ? "This browser could not find a position. The list stays sorted by time in the pattern."
            : "Your location stays on this device. It is never sent to SmokySignal."}
      </p>

      {nearCount === 0 && !data.degraded ? (
        <div className={styles.card} data-testid="near-me-none">
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
            Nothing circling within {NEAR_ME_MILES} miles right now.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
            {data.patterns.length > 0
              ? `${data.patterns.length} working a pattern farther out, listed below.`
              : "Nothing tracked is working a pattern anywhere right now."}{" "}
            Not an all-clear: a bird in transit can start a pattern at any time.
          </p>
        </div>
      ) : null}

      {data.degraded ? (
        <div className={styles.card} data-testid="circling-degraded">
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
            Feed quiet. We can&rsquo;t see the sky right now.
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
            The public ADS-B feeds did not answer, so an empty list here means
            nothing. Check back in a minute.
          </p>
        </div>
      ) : list.length === 0 ? (
        <EmptyState alsoUp={data.also_up} />
      ) : (
        <ul className={styles.list} data-testid="circling-list">
          {list.map((item) => (
            <PatternCard key={item.tail} item={item} hour12={hour12} />
          ))}
        </ul>
      )}

      {list.length > 0 && data.also_up.length > 0 ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: SS_TOKENS.fg2 }}>
          Also up, not in a pattern:{" "}
          {data.also_up.map((a) => `${a.name} (${a.missionLabel})`).join(", ")}.
        </p>
      ) : null}
    </section>
  );
}

function EmptyState({ alsoUp }: { alsoUp: CirclingResponse["also_up"] }) {
  return (
    <div className={styles.card} data-testid="circling-empty">
      <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: SS_TOKENS.fg0 }}>
        Nothing tracked is working a pattern right now.
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5, color: SS_TOKENS.fg1 }}>
        {alsoUp.length > 0
          ? `Up and moving: ${alsoUp.map((a) => `${a.name} (${a.missionLabel})`).join(", ")}.`
          : "Nothing on our list is in the air."}{" "}
        A circling aircraft we don&rsquo;t track, or one flying below receiver
        coverage, won&rsquo;t show here.
      </p>
    </div>
  );
}

function PatternCard({
  item,
  hour12,
}: {
  item: CirclingItem & { distanceMi?: number };
  hour12: boolean;
}) {
  const meta = [
    item.altFt != null ? `${item.altFt.toLocaleString("en-US")}′` : null,
    `since ${formatTs(item.sinceTs, "time", { hour12 })}`,
    item.tail,
  ].filter(Boolean);
  return (
    <li className={styles.card} data-testid="circling-item" data-tail={item.tail} data-mission={item.mission}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: SS_TOKENS.fg0, letterSpacing: "-.01em" }}>
            {item.name}
          </div>
          <div style={{ fontSize: 13, color: SS_TOKENS.fg1, marginTop: 2 }}>
            {item.airframe} · {item.operator}
          </div>
        </div>
        <span className="ss-mono" style={roleBadgeStyle(item.mission)} title={item.missionNote}>
          {item.missionBadge}
        </span>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.45, color: SS_TOKENS.fg0 }}>
        {item.sentence}
      </p>
      <div
        className="ss-mono"
        style={{ marginTop: 8, fontSize: 12, color: SS_TOKENS.fg1, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}
      >
        {item.distanceMi != null ? (
          <span style={{ color: SS_TOKENS.fg0 }} data-testid="circling-distance">
            {fmtMiles(item.distanceMi)} away
          </span>
        ) : null}
        {meta.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.45, color: SS_TOKENS.fg2 }}>
        {item.missionNote}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 18px", marginTop: 4 }}>
        <Link href={`/plane/${item.tail}`} className={styles.linkRow} style={{ fontSize: 13, color: SS_TOKENS.fg0 }}>
          This tail&rsquo;s page →
        </Link>
        {item.roadId ? (
          <Link href={`/road/${item.roadId}`} className={styles.linkRow} style={{ fontSize: 13, color: SS_TOKENS.fg0 }}>
            {item.road} history →
          </Link>
        ) : null}
      </div>
    </li>
  );
}
