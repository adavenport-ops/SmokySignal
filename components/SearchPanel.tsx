"use client";

// The search field + result list behind the ⌘K palette and the search on
// the phone More sheet. One ARIA combobox: the input owns the listbox
// (aria-controls), the highlighted option is aria-activedescendant, and
// focus never leaves the input while arrowing. Index and scorer live in
// lib/nav-index.ts; registry tails load lazily from /api/nav-index the
// first time the field is used. The first tail match carries three
// jump-offs right under it (lib/search-actions.ts): its last 30 days on
// the radar, the same in 3D, and its logbook; they are options too, so
// the arrow keys reach them.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allNavItems } from "@/lib/nav";
import { buildNavIndex, KIND_LABEL, searchNav, type SearchKind, type SearchResult } from "@/lib/nav-index";
import { rowHref, searchRows, type SearchRow } from "@/lib/search-actions";
import { useNavTails } from "@/lib/hooks/useNavData";
import { NavIcon, type IconName } from "./NavIcons";

type Props = {
  /** Inline on a page (More sheet): no list until the rider types. */
  inline?: boolean;
  autoFocus?: boolean;
  initialQuery?: string;
  /** Called after navigating, and on Esc with an empty field. */
  onDone?: () => void;
  /** Rendered at the right of the field (the palette's close button). */
  trailing?: React.ReactNode;
  /** Controlled query (the More sheet filters its sections with it). */
  query?: string;
  onQueryChange?: (q: string) => void;
  /** Result kinds left out of the list (the More sheet shows pages as
   *  its own filtered sections). */
  excludeKinds?: ReadonlyArray<SearchKind>;
  /** No "nothing by that name" line; the caller says "No matches". */
  hideEmpty?: boolean;
  /** Reports how many rows the list shows, and whether tails are loading. */
  onResults?: (count: number, loading: boolean) => void;
};

const PAGE_ICONS: Record<string, IconName> = Object.fromEntries(
  allNavItems().map((i) => [`page:${i.id}`, i.icon]),
);

function iconFor(r: SearchResult): IconName {
  if (r.kind === "page") return PAGE_ICONS[r.id] ?? "home";
  if (r.kind === "setting") return "settings";
  if (r.kind === "road") return "road";
  if (r.kind === "aircraft") return "aircraft";
  if (r.kind === "town") return "town";
  return "seen";
}

function actionIcon(id: string): IconName {
  if (id.startsWith("action:logbook")) return "data";
  if (id.startsWith("action:3d")) return "history";
  return "radar";
}

export function SearchPanel({
  inline = false,
  autoFocus = false,
  initialQuery = "",
  onDone,
  trailing,
  query: queryProp,
  onQueryChange,
  excludeKinds,
  hideEmpty = false,
  onResults,
}: Props) {
  const router = useRouter();
  const uid = useId().replace(/:/g, "");
  const listId = `ss-search-list-${uid}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [queryState, setQueryState] = useState(initialQuery);
  const query = queryProp ?? queryState;
  const setQuery = (q: string) => {
    setQueryState(q);
    onQueryChange?.(q);
  };
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(!inline || initialQuery.length > 0);
  const [pendingEnter, setPendingEnter] = useState(false);
  const tails = useNavTails(touched);

  const index = useMemo(() => buildNavIndex({ tails: tails ?? [] }), [tails]);
  const excludeKey = (excludeKinds ?? []).join(",");
  const results = useMemo(() => {
    const out = searchNav(index, query, 12);
    return excludeKey ? out.filter((r) => !excludeKey.split(",").includes(r.kind)) : out;
  }, [index, query, excludeKey]);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => setNowMs(Date.now()), [query]);
  const rows = useMemo(() => (nowMs ? searchRows(results, nowMs) : results.map((r) => ({ type: "result" as const, id: r.id, result: r }))), [results, nowMs]);
  const showList = !inline || query.trim().length > 0;
  const current: SearchRow | undefined = rows[Math.min(active, rows.length - 1)];
  const loading = Boolean(pendingEnter || (!tails && touched));

  useEffect(() => {
    onResults?.(showList ? rows.length : 0, loading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, showList, loading]);

  useEffect(() => setActive(0), [query, tails]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Enter pressed before the tails landed (a tail typed fast after ⌘K):
  // go once they arrive, so "N305DK ↵" still lands on the plane.
  useEffect(() => {
    if (pendingEnter && tails) {
      setPendingEnter(false);
      const best = searchNav(buildNavIndex({ tails }), query, 1)[0];
      if (best) go({ type: "result", id: best.id, result: best });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, tails]);

  // Keep the highlighted option in view while arrowing.
  useEffect(() => {
    if (!current) return;
    document.getElementById(`${listId}-${current.id}`)?.scrollIntoView({ block: "nearest" });
  }, [current, listId]);

  function go(row: SearchRow) {
    onDone?.();
    const href = rowHref(row);
    if (row.type === "result" && row.result.file) {
      window.location.assign(href);
      return;
    }
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length) setActive((a) => (a + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) setActive((a) => (a - 1 + rows.length) % rows.length);
    } else if (e.key === "Home" && showList && rows.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && showList && rows.length) {
      e.preventDefault();
      setActive(rows.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!tails && query.trim()) {
        setPendingEnter(true);
        return;
      }
      if (current && showList) go(current);
    } else if (e.key === "Escape") {
      // Palette: Esc closes. Inline (More sheet): Esc clears the field.
      if (!inline && onDone) {
        e.preventDefault();
        onDone();
      } else if (query) {
        e.preventDefault();
        setQuery("");
      }
    }
  }

  const expanded = showList && rows.length > 0;

  return (
    <div className="ss-search" data-inline={inline ? "true" : "false"} data-testid="nav-search">
      <div className="ss-search-field">
        <NavIcon name="search" size={18} />
        <input
          ref={inputRef}
          type="search"
          className="ss-search-input"
          role="combobox"
          aria-label="Search pages, aircraft, roads and towns"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && current ? `${listId}-${current.id}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Search pages, tails, roads, towns"
          value={query}
          onFocus={() => setTouched(true)}
          onChange={(e) => {
            setTouched(true);
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
          data-testid="nav-search-input"
        />
        {trailing}
      </div>

      {showList ? (
        rows.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Results" className="ss-search-list" data-testid="nav-search-results">
            {rows.map((row, i) => {
              const selected = i === active;
              const common = {
                id: `${listId}-${row.id}`,
                role: "option" as const,
                "aria-selected": selected,
                "data-href": rowHref(row),
                onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
                onMouseMove: () => {
                  if (!selected) setActive(i);
                },
                onClick: () => go(row),
              };
              if (row.type === "action") {
                return (
                  <li key={row.id} {...common} className="ss-search-option ss-search-action" data-kind="action">
                    <NavIcon name={actionIcon(row.action.id)} size={16} />
                    <span className="ss-search-option-text">
                      <span className="ss-search-action-label">{row.action.label}</span>
                    </span>
                  </li>
                );
              }
              const r = row.result;
              return (
                <li key={row.id} {...common} className="ss-search-option" data-kind={r.kind}>
                  <NavIcon name={iconFor(r)} size={18} />
                  <span className="ss-search-option-text">
                    <span className={`ss-search-option-title${r.kind === "aircraft" || r.kind === "road" ? " ss-mono" : ""}`}>
                      {r.title}
                    </span>
                    {r.subtitle ? <span className="ss-search-option-sub">{r.subtitle}</span> : null}
                  </span>
                  <span className="ss-search-kind">{KIND_LABEL[r.kind]}</span>
                </li>
              );
            })}
          </ul>
        ) : hideEmpty ? null : (
          <div id={listId} className="ss-search-empty" role="status">
            {loading ? "Loading tails" : "Nothing by that name. Try a tail, a road or a town."}
          </div>
        )
      ) : null}

      <span className="ss-sr-only" role="status" aria-live="polite">
        {showList && !hideEmpty ? `${rows.length} result${rows.length === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}
