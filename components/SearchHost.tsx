"use client";

// Mounted once in the root layout. Owns the ⌘K / Ctrl+K shortcut (and
// "/" when no field has focus), listens for openSearch() from the sidebar
// field and the More sheet, and loads the palette only when first asked.
// Also clears a page's NEW badge on the rider's first visit, whichever
// way they arrived (sidebar, search, a shared link).
//
// Not on /embed: that page is framed on other people's sites.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import nextDynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { activeNavId } from "@/lib/nav";
import { OPEN_SEARCH_EVENT, useNavSeen } from "@/lib/hooks/useNavData";

const loadPalette = () => import("./CommandPalette");
const CommandPalette = nextDynamic(loadPalette, { ssr: false });

export function SearchHost() {
  const pathname = usePathname() ?? "/";
  if (pathname === "/embed") return null;
  return (
    <>
      <PaletteHost />
      <Suspense fallback={null}>
        <SeenTracker pathname={pathname} />
      </Suspense>
    </>
  );
}

function PaletteHost() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openRef = useRef(false);
  const pathname = usePathname();

  const show = useCallback((q = "") => {
    setQuery(q);
    setOpen(true);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else show("");
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        const typing =
          t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        if (!typing) {
          e.preventDefault();
          show("");
        }
      }
    };
    const onOpen = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query ?? "";
      show(q);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    // Warm the palette chunk once the page is idle, so the first ⌘K opens
    // without a beat and no keystroke is lost.
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const warm = () => void loadPalette();
    const idle = w.requestIdleCallback ? w.requestIdleCallback(warm) : window.setTimeout(warm, 1500);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
      if (!w.requestIdleCallback) window.clearTimeout(idle);
    };
  }, [show]);

  // A route change (from a result, or the back button) closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!open) return null;
  return <CommandPalette initialQuery={query} onClose={() => setOpen(false)} />;
}

function SeenTracker({ pathname }: { pathname: string }) {
  const sp = useSearchParams();
  const search = sp?.toString() ?? "";
  const [, markSeen, ready] = useNavSeen();
  useEffect(() => {
    if (ready) markSeen(activeNavId(pathname, search));
  }, [ready, pathname, search, markSeen]);
  return null;
}
