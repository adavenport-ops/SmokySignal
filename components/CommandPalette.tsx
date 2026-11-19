"use client";

// The ⌘K / Ctrl+K search palette. A modal dialog around <SearchPanel>:
// focus moves into the field on open, Tab cycles inside the dialog, Esc
// or a click on the backdrop closes it, and focus returns to whatever
// opened it. Loaded on demand by <SearchHost> (components/SearchHost.tsx).

import { useEffect, useRef } from "react";
import { SearchPanel } from "./SearchPanel";
import { NavIcon } from "./NavIcons";

type Props = {
  initialQuery?: string;
  onClose: () => void;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CommandPalette({ initialQuery = "", onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      // Only hand focus back when it would otherwise be lost (no navigation
      // moved it somewhere new).
      const el = restoreRef.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null,
    );
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="ss-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="nav-palette"
    >
      <div
        ref={panelRef}
        className="ss-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ss-palette-title"
        onKeyDown={onKeyDown}
      >
        <h2 id="ss-palette-title" className="ss-sr-only">
          Search SmokySignal
        </h2>
        <SearchPanel
          autoFocus
          initialQuery={initialQuery}
          onDone={onClose}
          trailing={
            <button type="button" className="ss-search-close" onClick={onClose} aria-label="Close search">
              <NavIcon name="close" size={18} />
            </button>
          }
        />
        <div className="ss-search-hint" aria-hidden="true">
          <span>↑↓ move</span>
          <span>Enter go</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
