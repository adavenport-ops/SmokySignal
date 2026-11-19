"use client";

// The /embed widget body. Polls /api/status.json every 30 s, pauses while
// its tab is hidden and re-reads the moment it becomes visible again.
// A missing, failed or aged read shows FEED QUIET, never ALL CLEAR
// (lib/embed.ts embedDisplay).

import { useEffect, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import { formatTs } from "@/lib/time";
import {
  EMBED_POLL_MS,
  embedDisplay,
  type EmbedDisplay,
  type EmbedKind,
  type EmbedRead,
  type EmbedTheme,
} from "@/lib/embed";

type Props = {
  theme: EmbedTheme;
  /** Region id the widget is scoped to, or null for the whole state. */
  region: string | null;
  regionLabel: string;
  /** Validated ?mock= value to forward to the API, or null. */
  mock: string | null;
  homeUrl: string;
};

const TONE: Record<EmbedKind, { color: string; dim: string }> = {
  up: { color: SS_TOKENS.alert, dim: SS_TOKENS.alertDim },
  down: { color: SS_TOKENS.clear, dim: SS_TOKENS.clearDim },
  stale: { color: SS_TOKENS.fg2, dim: "rgba(130,137,154,0.13)" },
};

function pill(d: EmbedDisplay | null): string {
  if (!d) return "READING";
  if (d.kind === "up") return d.count > 1 ? `SMOKEY UP · ${d.count}` : "SMOKEY UP";
  if (d.kind === "down") return "ALL CLEAR";
  return "FEED QUIET";
}

function headline(d: EmbedDisplay | null): string {
  if (!d) return "Reading the sky.";
  if (d.kind === "up") return "Smokey's up.";
  if (d.kind === "down") return "Smokey's down.";
  return "Feed's quiet.";
}

function body(d: EmbedDisplay | null): string {
  if (!d) return "First read in a moment.";
  const t = d.readAt != null ? `${formatTs(d.readAt, "time")}` : null;
  if (d.kind === "up") return "Mind the throttle.";
  if (d.kind === "down") return "No bird up. Send it.";
  return t
    ? `No fresh read since ${t}. Not calling it clear.`
    : "No read yet. Not calling it clear.";
}

export function EmbedView({ theme, region, regionLabel, mock, homeUrl }: Props) {
  const [read, setRead] = useState<EmbedRead | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (region) q.set("region", region);
    if (mock) q.set("mock", mock);
    const url = `/api/status.json${q.toString() ? `?${q}` : ""}`;

    let timer: ReturnType<typeof setInterval> | null = null;
    let ctrl: AbortController | null = null;
    let alive = true;

    const poll = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as {
          state?: string;
          count?: number;
          age_s?: number | null;
        };
        if (!alive) return;
        const state = j.state === "up" || j.state === "down" ? j.state : "stale";
        setRead({
          state,
          count: typeof j.count === "number" ? j.count : 0,
          ageS: typeof j.age_s === "number" ? j.age_s : null,
          receivedAt: Date.now(),
        });
      } catch (e) {
        // Keep the last good read; embedDisplay() ages it into FEED QUIET.
        if (e instanceof DOMException && e.name === "AbortError") return;
      } finally {
        if (alive) {
          setLoaded(true);
          setNow(Date.now());
        }
      }
    };

    const start = () => {
      if (timer) return;
      void poll();
      timer = setInterval(() => {
        void poll();
      }, EMBED_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      ctrl?.abort();
    };
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [region, mock]);

  const display = loaded && now != null ? embedDisplay(read, now) : null;
  const kind: EmbedKind = display?.kind ?? "stale";
  const tone = TONE[kind];
  const readTime =
    display?.readAt != null ? formatTs(display.readAt, "time") : null;

  const frame: React.CSSProperties = {
    display: "block",
    boxSizing: "border-box",
    width: "100%",
    minHeight: "100dvh",
    background: SS_TOKENS.bg0,
    color: SS_TOKENS.fg0,
    textDecoration: "none",
    padding: theme === "card" ? "16px 18px" : "0 14px",
  };

  if (theme === "compact") {
    return (
      <a
        href={homeUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-embed-theme="compact"
        data-embed-state={display?.kind ?? "loading"}
        aria-label={`SmokySignal: ${pill(display)}. Open SmokySignal.`}
        style={{ ...frame, display: "flex", alignItems: "center", gap: 12 }}
      >
        <span
          aria-hidden
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: tone.color,
            boxShadow: kind === "up" ? `0 0 0 4px ${tone.dim}` : "none",
            flexShrink: 0,
          }}
        />
        <span
          role="status"
          className="ss-mono"
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: ".04em",
            color: tone.color,
            whiteSpace: "nowrap",
          }}
        >
          {pill(display)}
        </span>
        <span style={{ flex: 1, minWidth: 0 }} />
        <span
          className="ss-mono"
          style={{
            fontSize: 11,
            color: SS_TOKENS.fg2,
            letterSpacing: ".06em",
            whiteSpace: "nowrap",
          }}
        >
          {readTime ? `${readTime}` : "SMOKYSIGNAL"}
        </span>
      </a>
    );
  }

  return (
    <a
      href={homeUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-embed-theme="card"
      data-embed-state={display?.kind ?? "loading"}
      aria-label={`SmokySignal: ${headline(display)} Open SmokySignal.`}
      style={{
        ...frame,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 10,
        borderLeft: `4px solid ${tone.color}`,
      }}
    >
      <span
        className="ss-eyebrow"
        style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
      >
        <span>SmokySignal &middot; {regionLabel}</span>
        <span style={{ color: tone.color }}>{pill(display)}</span>
      </span>
      <span role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: "-.03em",
            lineHeight: 1.05,
            color: tone.color,
          }}
        >
          {headline(display)}
        </span>
        <span style={{ fontSize: 13.5, lineHeight: 1.4, color: SS_TOKENS.fg1 }}>
          {body(display)}
        </span>
      </span>
      <span
        className="ss-mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          letterSpacing: ".08em",
          color: SS_TOKENS.fg2,
        }}
      >
        <span>{readTime ? `READ ${readTime}` : "NO READ YET"}</span>
        <span>smokysignal.app</span>
      </span>
    </a>
  );
}
