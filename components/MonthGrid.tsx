"use client";

// Hour × weekday grid of minutes aloft for one month on /forecast.
// Mobile first: the grid scrolls sideways inside its own container while
// the weekday column stays pinned, so the page itself never scrolls
// horizontally at 390 px. On wide screens the cells simply grow.
// Cool ramp on purpose: amber is reserved for "Smokey is up right now".

import { useEffect, useRef, useState } from "react";
import { ScrollX } from "./ScrollX";
import { SS_TOKENS } from "@/lib/tokens";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAY_COL_PX = 44;

type Cell = { dow: number; hour: number; minutes: number };

export function MonthGrid({
  grid,
  hour12 = false,
  label,
}: {
  /** [dow 0 = Sun][hour 0..23] minutes aloft. */
  grid: number[][];
  hour12?: boolean;
  /** Accessible summary of the whole grid. */
  label: string;
}) {
  const [selected, setSelected] = useState<Cell | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  let max = 0;
  let peakHour = -1;
  for (const row of grid) {
    row.forEach((v, h) => {
      if (v > max) {
        max = v;
        peakHour = h;
      }
    });
  }

  // On a narrow screen only part of the day fits. Open the grid scrolled
  // so the busiest hour sits mid-view instead of the empty small hours.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || peakHour < 0 || el.scrollWidth <= el.clientWidth) return;
    const cellW = (el.scrollWidth - DAY_COL_PX) / 24;
    const target = DAY_COL_PX + (peakHour + 0.5) * cellW - (el.clientWidth + DAY_COL_PX) / 2;
    el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
  }, [peakHour]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ScrollX
        trackRef={scrollRef}
        label="Hour by weekday grid of minutes aloft. Scrolls sideways."
        testId="month-grid-scroll"
      >
        <div
          role="group"
          aria-label={label}
          style={{
            display: "grid",
            gridTemplateColumns: `${DAY_COL_PX}px repeat(24, minmax(20px, 1fr))`,
            gap: 2,
            minWidth: DAY_COL_PX + 24 * 22,
          }}
        >
          <div style={stickyStyle} aria-hidden />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="ss-mono"
              aria-hidden
              style={{
                fontSize: 12, // 12px floor, chart ticks included
                color: SS_TOKENS.fg1,
                textAlign: "center",
                padding: "0 0 4px",
              }}
            >
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </div>
          ))}
          {grid.map((row, dow) => (
            <Row
              key={dow}
              dow={dow}
              row={row}
              max={max}
              selected={selected}
              onSelect={setSelected}
              hour12={hour12}
            />
          ))}
        </div>
      </ScrollX>
      <div
        aria-live="polite"
        className="ss-mono"
        data-testid="forecast-month-cell"
        style={{ fontSize: 12, color: selected ? SS_TOKENS.fg0 : SS_TOKENS.fg1, minHeight: 18 }}
      >
        {selected
          ? `${DAYS[selected.dow]} ${fmtHour(selected.hour, hour12)} PT · ${fmtMinutes(selected.minutes)} aloft this month`
          : "Tap a cell for its minutes aloft."}
      </div>
    </div>
  );
}

const stickyStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  background: SS_TOKENS.bg0,
};

function Row({
  dow,
  row,
  max,
  selected,
  onSelect,
  hour12,
}: {
  dow: number;
  row: number[];
  max: number;
  selected: Cell | null;
  onSelect: (c: Cell) => void;
  hour12: boolean;
}) {
  return (
    <>
      <div
        className="ss-mono"
        style={{
          ...stickyStyle,
          fontSize: 12,
          color: SS_TOKENS.fg1,
          letterSpacing: ".06em",
          alignSelf: "stretch",
          display: "flex",
          alignItems: "center",
          paddingRight: 6,
        }}
      >
        {DAYS[dow]}
      </div>
      {row.map((v, h) => {
        const isSel = selected?.dow === dow && selected.hour === h;
        return (
          <button
            key={h}
            type="button"
            aria-label={`${DAYS[dow]} ${fmtHour(h, hour12)}, ${fmtMinutes(v)} aloft`}
            onClick={() => onSelect({ dow, hour: h, minutes: v })}
            style={{
              aspectRatio: "1 / 1",
              minHeight: 20,
              padding: 0,
              border: isSel ? `1px solid ${SS_TOKENS.fg0}` : `.5px solid ${SS_TOKENS.hairline}`,
              borderRadius: 3,
              background: coolHeat(v, max),
              cursor: "pointer",
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          />
        );
      })}
    </>
  );
}

function coolHeat(v: number, max: number): string {
  if (v <= 0 || max <= 0) return "rgba(255,255,255,0.03)";
  const t = Math.min(1, v / max);
  return `rgba(91,182,255,${(0.12 + 0.78 * t).toFixed(3)})`;
}

function fmtMinutes(m: number): string {
  return `${Math.round(m)} min`;
}

function fmtHour(h: number, hour12: boolean): string {
  if (!hour12) return `${String(h).padStart(2, "0")}:00`;
  if (h === 0) return "12:00 AM";
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return "12:00 PM";
  return `${h - 12}:00 PM`;
}
