"use client";

// 7×24 heatmap of takeoff probability per (dow, hour) bucket. Tap a
// cell to see the top contributing tails for that bucket.

import { useMemo, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import type { ForecastGrid, ForecastCell } from "@/lib/predictor";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ForecastGridView({ grid }: { grid: ForecastGrid }) {
  const maxProb = useMemo(
    () => Math.max(...grid.cells.map((c) => c.probability), 0.01),
    [grid.cells],
  );
  const now = useMemo(() => pacificNow(), []);
  const [selected, setSelected] = useState<ForecastCell | null>(null);

  // Build rows: dow × 24 hours.
  const byDow: ForecastCell[][] = Array.from({ length: 7 }, () => []);
  for (const c of grid.cells) byDow[c.dow]!.push(c);
  for (const row of byDow) row.sort((a, b) => a.hour - b.hour);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          overflowX: "auto",
          paddingBottom: 4,
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto repeat(24, 1fr)",
            gap: 2,
            minWidth: 560,
          }}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="ss-mono"
              style={{
                fontSize: 8.5,
                color: SS_TOKENS.fg2,
                textAlign: "center",
                padding: "0 1px 4px",
              }}
            >
              {h % 6 === 0 ? h : ""}
            </div>
          ))}
          {byDow.map((row, dow) => (
            <DowRow
              key={dow}
              dow={dow}
              cells={row}
              maxProb={maxProb}
              now={now}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>
      </div>

      <CellDetail cell={selected} />
    </div>
  );
}

function DowRow({
  dow,
  cells,
  maxProb,
  now,
  selected,
  onSelect,
}: {
  dow: number;
  cells: ForecastCell[];
  maxProb: number;
  now: { dow: number; hour: number };
  selected: ForecastCell | null;
  onSelect: (c: ForecastCell) => void;
}) {
  return (
    <>
      <div
        className="ss-mono"
        style={{
          fontSize: 10,
          color: dow === now.dow ? SS_TOKENS.alert : SS_TOKENS.fg2,
          letterSpacing: ".06em",
          paddingRight: 6,
          alignSelf: "center",
        }}
      >
        {DAYS[dow]}
      </div>
      {cells.map((c) => {
        const isNow = c.dow === now.dow && c.hour === now.hour;
        const isSelected =
          selected && selected.dow === c.dow && selected.hour === c.hour;
        return (
          <button
            key={`${c.dow}-${c.hour}`}
            type="button"
            onClick={() => onSelect(c)}
            aria-label={`${DAYS[c.dow]} ${c.hour}:00, ${Math.round(c.probability * 100)}%`}
            style={{
              aspectRatio: "1 / 1",
              border: isNow
                ? `1px solid ${SS_TOKENS.alert}`
                : isSelected
                  ? `.5px solid ${SS_TOKENS.fg0}`
                  : `.5px solid ${SS_TOKENS.hairline}`,
              borderRadius: 3,
              background: heatColor(c.probability, maxProb),
              cursor: "pointer",
              padding: 0,
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          />
        );
      })}
    </>
  );
}

function heatColor(p: number, max: number): string {
  if (p === 0) return "rgba(255,255,255,0.03)";
  const t = Math.min(1, p / max);
  // Fade from a faint amber to bright alert as t → 1.
  const alpha = 0.12 + 0.78 * t;
  return `rgba(245,184,64,${alpha.toFixed(3)})`;
}

function CellDetail({ cell }: { cell: ForecastCell | null }) {
  if (!cell) {
    return (
      <div
        style={{
          fontSize: 12,
          color: SS_TOKENS.fg2,
          textAlign: "center",
          padding: "16px 8px",
        }}
      >
        Tap a cell to see the most common tails for that hour.
      </div>
    );
  }
  return (
    <div
      style={{
        background: SS_TOKENS.bg1,
        border: `.5px solid ${SS_TOKENS.hairline}`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          className="ss-mono"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: SS_TOKENS.fg0,
            letterSpacing: ".04em",
          }}
        >
          {DAYS[cell.dow]} · {fmtHour(cell.hour)} PT
        </span>
        <span
          className="ss-mono"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: SS_TOKENS.alert,
          }}
        >
          {Math.round(cell.probability * 100)}%
        </span>
      </div>
      <div
        className="ss-mono"
        style={{ fontSize: 10.5, color: SS_TOKENS.fg2, letterSpacing: ".04em" }}
      >
        {cell.sample_count} historical takeoff
        {cell.sample_count === 1 ? "" : "s"} in this bucket
      </div>
      {cell.common_tails.length > 0 && (
        <div
          className="ss-mono"
          style={{ fontSize: 11, color: SS_TOKENS.fg1, lineHeight: 1.6 }}
        >
          {cell.common_tails
            .map((t) => `${t.nickname ?? t.tail} (${t.count})`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function fmtHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function pacificNow(): { dow: number; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  let hourStr: string | null = null;
  let weekday: string | null = null;
  for (const p of parts) {
    if (p.type === "hour") hourStr = p.value;
    if (p.type === "weekday") weekday = p.value;
  }
  const hour = Number(hourStr ?? 0) % 24;
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = weekday != null ? (dowMap[weekday] ?? 0) : 0;
  return { hour, dow };
}
