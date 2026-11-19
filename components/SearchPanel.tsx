"use client";

// The search field + result list behind the ⌘K palette and the search on
// the phone More sheet. One ARIA combobox: the input owns the listbox
// (aria-controls), the highlighted option is aria-activedescendant, and
// focus never leaves the input while arrowing. Index and scorer live in
// lib/nav-index.ts; registry tails load lazily from /api/nav-index the
// first time the field is used.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allNavItems } from "@/lib/nav";
import { buildNavIndex, KIND_LABEL, searchNav, type SearchResult } from "@/lib/nav-index";
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

export function SearchPanel({ inline = false, autoFocus = false, initialQuery = "", onDone, trailing }: Props) {
  const router = useRouter();
  const uid = useId().replace(/:/g, "");
  const listId = `ss-search-list-${uid}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(!inline || initialQuery.length > 0);
  const [pendingEnter, setPendingEnter] = useState(false);
  const tails = useNavTails(touched);

  const index = useMemo(() => buildNavIndex({ tails: tails ?? [] }), [tails]);
  const results = useMemo(() => searchNav(index, query, 12), [index, query]);
  const showList = !inline || query.trim().length > 0;
  const current = results[Math.min(active, results.length - 1)];

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
      if (best) go(best);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, tails]);

  // Keep the highlighted option in view while arrowing.
  useEffect(() => {
    if (!current) return;
    document.getElementById(`${listId}-${current.id}`)?.scrollIntoView({ block: "nearest" });
  }, [current, listId]);

  function go(r: SearchResult) {
    onDone?.();
    if (r.file) {
      window.location.assign(r.href);
      return;
    }
    router.push(r.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length) setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Home" && showList && results.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && showList && results.length) {
      e.preventDefault();
      setActive(results.length - 1);
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

  const expanded = showList && results.length > 0;

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
        results.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Results" className="ss-search-list" data-testid="nav-search-results">
            {results.map((r, i) => {
              const selected = i === active;
              return (
                <li
                  key={r.id}
                  id={`${listId}-${r.id}`}
                  role="option"
                  aria-selected={selected}
                  className="ss-search-option"
                  data-href={r.href}
                  data-kind={r.kind}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (!selected) setActive(i);
                  }}
                  onClick={() => go(r)}
                >
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
        ) : (
          <div id={listId} className="ss-search-empty" role="status">
            {pendingEnter || (!tails && touched) ? "Loading tails" : "Nothing by that name. Try a tail, a road or a town."}
          </div>
        )
      ) : null}

      <span className="ss-sr-only" role="status" aria-live="polite">
        {showList ? `${results.length} result${results.length === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  );
}
