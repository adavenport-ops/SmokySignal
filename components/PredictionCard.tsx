"use client";

// Reads /api/predict on mount and renders the top likely-sweep window
// derived from accumulated activity events. Renders the canonical
// LearningPanel whenever we're inside the 30-day learning window OR
// the predictor returned too few events for a useful forecast.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "./Card";
import { LearningPanel } from "./LearningPanel";
import { SS_TOKENS } from "@/lib/tokens";
import type { PredictorOutput, PredictionWindow } from "@/lib/predictor";
import { LEARNING_THRESHOLD_DAYS, type LearningState } from "@/lib/learning";

const MIN_TOTAL_EVENTS_FOR_PREDICTION = 10;

const FALLBACK_LEARNING: LearningState = {
  firstSampleIso: null,
  daysElapsed: 0,
  daysRemaining: LEARNING_THRESHOLD_DAYS,
  progress: 0,
  stillLearning: true,
};

export function PredictionCard({ learning }: { learning?: LearningState }) {
  const [data, setData] = useState<PredictorOutput | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/predict", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as PredictorOutput;
        if (!cancelled) setData(d);
      } catch {
        /* transient — render placeholder */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While loading, render nothing — avoids a flash of the "still learning"
  // copy when the prediction is actually about to appear.
  if (data === null) return null;

  const tooFew = data.total_events < MIN_TOTAL_EVENTS_FOR_PREDICTION;
  const top = data.windows[0];
  // Show the learning panel whenever we're inside the 30-day window OR
  // the predictor doesn't have enough data yet. Past the threshold + with
  // enough events, the regular forecast card takes over.
  if (learning?.stillLearning || tooFew || !top) {
    return (
      <LearningPanel
        state={learning ?? FALLBACK_LEARNING}
        eventsSeen={data.total_events}
        variant="card"
      />
    );
  }

  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="ss-eyebrow" style={{ marginBottom: 6 }}>
            Next likely sweep
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: SS_TOKENS.fg0,
              lineHeight: 1.3,
            }}
          >
            {fmtDayLabel(top.window_start)}
          </div>
          <div
            className="ss-mono"
            style={{ fontSize: 12, color: SS_TOKENS.fg1, marginTop: 4 }}
          >
            {fmtTimeRange(top.window_start, top.window_end)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div
            className="ss-mono"
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: SS_TOKENS.alert,
              lineHeight: 1,
            }}
          >
            {Math.round(top.probability * 100)}%
          </div>
          <div
            className="ss-mono"
            style={{
              fontSize: 9,
              color: SS_TOKENS.fg2,
              letterSpacing: ".08em",
              marginTop: 4,
            }}
          >
            {confidenceLabel(top.confidence_level)}
          </div>
        </div>
      </div>
      {top.common_tails.length > 0 && (
        <div
          className="ss-mono"
          style={{
            fontSize: 10.5,
            color: SS_TOKENS.fg2,
            marginTop: 10,
            letterSpacing: ".04em",
          }}
        >
          {top.common_tails
            .map((t) => t.nickname ?? t.tail)
            .join(" · ")}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          color: SS_TOKENS.fg2,
          marginTop: 12,
          lineHeight: 1.45,
        }}
      >
        From {top.sample_count} historical sweep
        {top.sample_count === 1 ? "" : "s"} in this hour-of-week.{" "}
        <Link
          href="/forecast"
          style={{ color: SS_TOKENS.fg1, textDecoration: "underline" }}
        >
          View weekly forecast →
        </Link>
      </div>
    </Card>
  );
}

function confidenceLabel(c: PredictionWindow["confidence_level"]): string {
  if (c === "high") return "HIGH CONFIDENCE";
  if (c === "medium") return "MEDIUM";
  return "EARLY SIGNAL";
}

function fmtDayLabel(iso: string): string {
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diffDays = Math.floor((ts - now) / 86_400_000);
  if (diffDays < 1) return "Today";
  if (diffDays < 2) return "Tomorrow";
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "long",
    timeZone: "America/Los_Angeles",
  });
}

function fmtTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmt = (d: Date) =>
    d.toLocaleTimeString(undefined, {
      hour: "numeric",
      hour12: true,
      timeZone: "America/Los_Angeles",
    });
  return `${fmt(start)} – ${fmt(end)} PT`;
}
