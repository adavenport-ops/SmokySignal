"use client";

// Radar filter panel — extracted from HotZoneLayer.tsx in P16 Phase 3.
// Lives in its own file so other surfaces (future weather toggle,
// time-scrubber settings) can mount alongside the existing radar
// filters without bloating the heatmap layer module.
//
// Rows, top to bottom (Colors first since walk-a, the most-used pick):
//   Missions   — Everything + one chip per mission (default Smokey only)
//   Operators  — multi-select chips per registry operator
//   Tails      — typeahead + chip set, follow a single tail
//   Layers     — Hot zones / Flight paths toggles inside the panel
//   Colors     — radar palette swatches (lib/radar-palettes.ts)
//
// The pre-P19 Quick filter row (All / Smokey / Operator) duplicated
// the rider buckets in Categories and the multi-select chips in
// Operators, so it retired. Persisted state migrates forward in
// readRadarFilter() — a saved showMode === "smoky" auto-selects the
// Smokey bucket; showMode === "operator" + operator value seeds the
// operator chip set.
//
// Filter shape: see lib/radar-filter.ts. The Missions row lists the
// mission taxonomy (lib/types.ts) with rider labels from
// lib/role-display.ts. Default is Smokey only; "Everything" selects
// every mission. Removing the last chip falls back to Smokey.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SS_TOKENS } from "@/lib/tokens";
import {
  OPERATORS,
  RIDER_BUCKETS,
  getRegistryTails,
  isEverything,
  toggleEverything,
  toggleMission,
  searchRegistryTails,
  type RadarFilter as Filter,
  type RegistryTail,
  type RiderBucketId,
} from "@/lib/radar-filter";
import type { PaletteId } from "@/lib/radar-palettes";
import { PaletteChips } from "./PaletteChips";
import { displayNickname } from "@/lib/nickname-display";

type Props = {
  /** Top of the panel, px: it drops down from the LAYERS button. */
  top: number;
  /** Tallest the panel may grow (CSS length), so it stops above the
   *  bottom pill rows and the tab bar. It scrolls inside. */
  maxHeight: string;
  filter: Filter;
  onChange: (f: Filter) => void;
  onClose: () => void;
  hotZonesEnabled: boolean;
  onToggleHotZones: () => void;
  flightPathsEnabled: boolean;
  onToggleFlightPaths: () => void;
  /** Radar colour palette (lib/radar-palettes.ts). Omit to hide the row. */
  palette?: PaletteId;
  onPaletteChange?: (id: PaletteId) => void;
};

export function FilterPanel({
  top,
  maxHeight,
  filter,
  onChange,
  onClose,
  hotZonesEnabled,
  onToggleHotZones,
  flightPathsEnabled,
  onToggleFlightPaths,
  palette,
  onPaletteChange,
}: Props) {
  const toggleBucket = (id: RiderBucketId) => {
    onChange({ ...filter, buckets: toggleMission(filter.buckets, id) });
  };
  const everything = isEverything(filter.buckets);
  const onEverything = () => {
    onChange({ ...filter, buckets: toggleEverything(filter.buckets) });
  };

  const toggleOperator = (op: string) => {
    const set = new Set(filter.operatorSet);
    if (set.has(op)) set.delete(op);
    else set.add(op);
    onChange({ ...filter, operatorSet: [...set] });
  };

  const removeTail = (tail: string) => {
    onChange({
      ...filter,
      tailSet: filter.tailSet.filter((t) => t !== tail),
    });
  };

  const addTail = (tail: string) => {
    if (filter.tailSet.includes(tail)) return;
    onChange({ ...filter, tailSet: [...filter.tailSet, tail] });
  };

  // Bottom fade while more of the panel sits below the fold; gone once
  // the rider scrolls to the end.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const syncFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);
  useEffect(() => {
    syncFade();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncFade);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [syncFade]);

  return (
    <div
      data-testid="radar-layers-panel"
      role="dialog"
      aria-label="Layers and filters"
      style={{
        position: "absolute",
        left: 12,
        top,
        maxHeight,
        zIndex: 13,
        width: 300,
        maxWidth: "calc(100vw - 24px)",
        borderRadius: 14,
        background: "rgba(11,13,16,0.94)",
        border: `.5px solid ${SS_TOKENS.hairline2}`,
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        color: SS_TOKENS.fg0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "2px 2px 0 14px",
        }}
      >
        <span
          className="ss-mono"
          style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".1em" }}
        >
          LAYERS · FILTERS
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close layers panel"
          style={{
            width: 44,
            height: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: 0,
            borderRadius: 10,
            color: SS_TOKENS.fg1,
            cursor: "pointer",
            fontSize: 22,
            lineHeight: 1,
            padding: 0,
            touchAction: "manipulation",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div style={{ position: "relative", minHeight: 0, flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
        <div
          ref={scrollRef}
          onScroll={syncFade}
          style={{
            minHeight: 0,
            flex: "1 1 auto",
            overflowY: "auto",
            overscrollBehavior: "contain",
            padding: "0 14px 14px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {palette && onPaletteChange && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  className="ss-mono"
                  style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".1em" }}
                >
                  Colors
                </span>
                <PaletteChips active={palette} onPick={onPaletteChange} />
              </div>
            )}

            <Group label="Layers">
              <Pill active={hotZonesEnabled} onClick={onToggleHotZones}>
                Hot zones
              </Pill>
              <Pill active={flightPathsEnabled} onClick={onToggleFlightPaths}>
                Flight paths
              </Pill>
            </Group>

            <Group label="Missions">
              <Pill active={everything} onClick={onEverything}>
                Everything
              </Pill>
              {RIDER_BUCKETS.map((b) => (
                <Pill
                  key={b.id}
                  active={filter.buckets.includes(b.id)}
                  onClick={() => toggleBucket(b.id)}
                >
                  {b.label}
                </Pill>
              ))}
            </Group>

            <Group label="Operators">
              {OPERATORS.map((op) => (
                <Pill
                  key={op}
                  active={filter.operatorSet.includes(op)}
                  onClick={() => toggleOperator(op)}
                >
                  {op}
                </Pill>
              ))}
            </Group>

            <TailGroup
              selected={filter.tailSet}
              onAdd={addTail}
              onRemove={removeTail}
            />
          </div>
        </div>
        <div
          aria-hidden
          data-testid="radar-layers-fade"
          data-on={moreBelow ? "true" : "false"}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 40,
            pointerEvents: "none",
            background: "linear-gradient(to bottom, rgba(11,13,16,0), rgba(11,13,16,0.96))",
            opacity: moreBelow ? 1 : 0,
            transition: "opacity 160ms ease-out",
          }}
        />
      </div>
    </div>
  );
}

function TailGroup({
  selected,
  onAdd,
  onRemove,
}: {
  selected: string[];
  onAdd: (tail: string) => void;
  onRemove: (tail: string) => void;
}) {
  const [registry, setRegistry] = useState<RegistryTail[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getRegistryTails().then((r) => {
      if (!cancelled) setRegistry(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestions = useMemo(
    () =>
      query.trim()
        ? searchRegistryTails(registry, query, 8).filter(
            (r) => !selected.includes(r.tail),
          )
        : [],
    [registry, query, selected],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        className="ss-mono"
        style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".1em" }}
      >
        Tails
      </span>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tail or nickname"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="ss-mono"
        style={{
          background: SS_TOKENS.bg2,
          border: `.5px solid ${SS_TOKENS.hairline2}`,
          color: SS_TOKENS.fg0,
          fontSize: 16,
          minHeight: 44,
          padding: "0 10px",
          borderRadius: 8,
          outline: "none",
        }}
      />
      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {suggestions.map((s) => (
            <button
              key={s.tail}
              type="button"
              onClick={() => {
                onAdd(s.tail);
                setQuery("");
              }}
              className="ss-mono"
              style={{
                textAlign: "left",
                background: "transparent",
                border: `.5px solid ${SS_TOKENS.hairline2}`,
                borderRadius: 6,
                minHeight: 44,
                padding: "0 10px",
                color: SS_TOKENS.fg1,
                fontSize: 12,
                cursor: "pointer",
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {s.tail}
              {s.nickname ? ` · ${displayNickname(s.nickname)}` : ""}
              <span style={{ color: SS_TOKENS.fg2, marginLeft: 6 }}>
                {s.operator}
              </span>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {selected.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onRemove(t)}
              aria-label={`Remove ${t} from tail filter`}
              className="ss-mono"
              style={{
                minHeight: 44,
                padding: "0 10px 0 12px",
                borderRadius: 999,
                // Selected = neutral; orange is reserved for live aircraft.
                background: SS_TOKENS.cta,
                border: `.5px solid ${SS_TOKENS.cta}`,
                color: SS_TOKENS.ctaInk,
                fontSize: 12,
                letterSpacing: ".04em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t}
              <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>
                ×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        className="ss-mono"
        style={{ fontSize: 12, color: SS_TOKENS.fg1, letterSpacing: ".1em" }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="ss-mono"
      style={{
        minHeight: 44,
        padding: "0 12px",
        borderRadius: 999,
        // Selected = neutral; orange is reserved for live aircraft.
        background: active ? SS_TOKENS.cta : "transparent",
        border: `.5px solid ${active ? SS_TOKENS.cta : SS_TOKENS.hairline2}`,
        color: active ? SS_TOKENS.ctaInk : SS_TOKENS.fg1,
        fontSize: 12,
        letterSpacing: ".04em",
        cursor: "pointer",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
