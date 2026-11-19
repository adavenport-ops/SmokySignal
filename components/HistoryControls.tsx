"use client";

// Shared pieces of history mode: the period picker (presets + native
// date inputs), the chip, the tapped-flight mini card and a desktop
// media hook. Used by the /radar history sheet (HistoryOverlay.tsx) and
// the plane page's Flight history section (PlaneHistory.tsx).

import { useEffect, useState } from "react";
import Link from "next/link";
import { SS_TOKENS } from "@/lib/tokens";
import {
  HISTORY_FLOOR,
  clampRange,
  flightCardText,
  historyPresets,
  presetForRange,
  resolvePreset,
  type DateRange,
} from "@/lib/history-view";
import type { HistorySession } from "@/lib/history-core";
import { displayNickname } from "@/lib/nickname-display";

/** Side panel instead of bottom sheet from this width up. */
export const DESKTOP_MIN_PX = 768;

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(min-width: ${DESKTOP_MIN_PX}px)`);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return desktop;
}

export function Chip({
  active,
  onClick,
  children,
  ariaLabel,
  disabled,
  dim,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  /** Visually muted (e.g. mission chips while picked tails override them). */
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={disabled}
      className="ss-mono"
      style={{
        minHeight: 44,
        padding: "0 14px",
        borderRadius: 999,
        // Selected = neutral; orange is reserved for live aircraft.
        background: active ? SS_TOKENS.cta : "transparent",
        border: `.5px solid ${active ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
        color: active ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
        fontSize: 12,
        letterSpacing: ".04em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: dim ? 0.45 : 1,
        whiteSpace: "nowrap",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="ss-mono"
      style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".1em", textTransform: "uppercase" }}
    >
      {children}
    </div>
  );
}

/**
 * Presets (Last 7 days, Last 30 days, each month on record) plus a
 * custom range on two native date inputs, floored at the first day on
 * record and capped at today. Calls onPick with a clamped range.
 */
export function PeriodPicker({
  today,
  value,
  onPick,
  floor = HISTORY_FLOOR,
}: {
  today: string;
  value: DateRange;
  onPick: (r: DateRange) => void;
  /** First Pacific date on record (lib/data-since.ts). */
  floor?: string;
}) {
  const presets = historyPresets(today, floor);
  const active = presetForRange(value, today, floor);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  useEffect(() => {
    setFrom(value.from);
    setTo(value.to);
  }, [value.from, value.to]);

  const commit = (a: string, b: string) => {
    const r = clampRange(a, b, today, floor);
    if (r) onPick(r);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow>Period</Eyebrow>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {presets.map((p) => (
          <Chip
            key={p.id}
            active={active === p.id}
            onClick={() => {
              const r = resolvePreset(p.id, today, floor);
              if (r) onPick(r);
            }}
          >
            {p.label}
          </Chip>
        ))}
      </div>
      <Eyebrow>Custom range</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <DateField
          label="From"
          value={from}
          min={floor}
          max={to || today}
          onChange={(v) => {
            setFrom(v);
            commit(v, to);
          }}
        />
        <DateField
          label="To"
          value={to}
          min={from || floor}
          max={today}
          onChange={(v) => {
            setTo(v);
            commit(from, v);
          }}
        />
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".08em" }}>
        {label.toUpperCase()}
      </span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="ss-mono"
        style={{
          // 16px stops iOS Safari zooming the page on focus.
          fontSize: 16,
          minHeight: 44,
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          padding: "0 10px",
          borderRadius: 10,
          background: SS_TOKENS.bg2,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: SS_TOKENS.fg0,
          colorScheme: "dark",
          outline: "none",
        }}
      />
    </label>
  );
}

/** Tapped history line: date, time, duration, max alt, Open flight. */
export function FlightMiniCard({
  session,
  onClose,
  style,
}: {
  session: HistorySession;
  onClose: () => void;
  style?: React.CSSProperties;
}) {
  const c = flightCardText(session);
  return (
    <div
      role="dialog"
      aria-label={`Flight ${c.tail} ${c.date}`}
      data-testid="history-flight-card"
      style={{
        padding: "12px 14px",
        borderRadius: 14,
        background: "rgba(11,13,16,0.94)",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: SS_TOKENS.fg0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="ss-mono" style={{ fontSize: 14, fontWeight: 600 }}>
          {c.tail}
        </span>
        {c.nickname && (
          <span style={{ fontSize: 12, color: SS_TOKENS.fg1 }}>&ldquo;{displayNickname(c.nickname)}&rdquo;</span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close flight card"
          style={{
            marginLeft: "auto",
            width: 44,
            height: 44,
            marginRight: -10,
            marginTop: -10,
            marginBottom: -10,
            background: "transparent",
            border: 0,
            color: SS_TOKENS.fg1,
            fontSize: 18,
            cursor: "pointer",
            touchAction: "manipulation",
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
        <Stat label="DATE" value={c.date} />
        <Stat label="TIME" value={c.time} />
        <Stat label="DURATION" value={c.duration} />
        <Stat label="MAX ALT" value={c.maxAlt} />
      </div>
      <Link
        href={c.href}
        prefetch={false}
        className="ss-mono"
        style={{
          minHeight: 44,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: SS_TOKENS.cta,
          color: SS_TOKENS.ctaInk,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: ".06em",
          textDecoration: "none",
        }}
      >
        Open flight
      </Link>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="ss-mono" style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".08em" }}>
        {label}
      </div>
      <div
        className="ss-mono"
        style={{ fontSize: 13, fontWeight: 600, color: SS_TOKENS.fg0, marginTop: 2, whiteSpace: "nowrap" }}
      >
        {value}
      </div>
    </div>
  );
}
