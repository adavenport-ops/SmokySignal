"use client";

// Desktop sidebar, >= 1024px on every (tabs) route (app/globals.css hides
// the tab bar there; app/nav.css lays this out). 240px open, or the 80px
// icon rail when collapsed; the choice lives in localStorage and the
// (tabs) layout applies it to <html data-ss-nav> before first paint.
//
// Top: wordmark, a live status block on the shared /api/aircraft poll
// (lib/hooks/useAircraft.ts, no second poller), the search field (⌘K).
// Then the six sections from lib/nav.ts, with active-route highlighting
// and NEW badges, and the recently-up tails under Aircraft (three rows).
//
// Alerts and Settings are pinned in the footer row beside Collapse, so
// they are one click away at any window height; the list above scrolls
// on its own and fades out at the bottom while there is more below.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Logo } from "./brand/Logo";
import { NavIcon } from "./NavIcons";
import { RecentlyUp } from "./RecentlyUp";
import { activeNavId, navSections, NAV_COLLAPSED_KEY, showNewBadge, type NavItem } from "@/lib/nav";
import { useSharedAircraft } from "@/lib/hooks/useAircraft";
import { openSearch, useNavSeen } from "@/lib/hooks/useNavData";
import { computeStatus, makeFleetMap } from "@/lib/status";
import { formatTsBare } from "@/lib/time";
import type { Snapshot } from "@/lib/types";

export function Sidebar() {
  return (
    <Suspense fallback={<SidebarView search="" />}>
      <SidebarWithParams />
    </Suspense>
  );
}

function SidebarWithParams() {
  const sp = useSearchParams();
  return <SidebarView search={sp?.toString() ?? ""} />;
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

/** Pinned in the footer row instead of the scrolling list. */
const FOOT_IDS = ["alerts", "settings"] as const;

/** Sets data-overflow="more" on the scroller's wrapper while rows sit
 *  below the fold (app/nav.css fades the bottom edge then). */
function useOverflowCue(): React.RefObject<HTMLElement> {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const more = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
      (el.parentElement ?? el).setAttribute("data-overflow", more ? "more" : "end");
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      ro?.disconnect();
    };
  }, []);
  return ref;
}

function readCollapsed(): boolean {
  return document.documentElement.getAttribute("data-ss-nav") === "collapsed";
}

function SidebarView({ search }: { search: string }) {
  const pathname = usePathname() ?? "/";
  const desktop = useIsDesktop();
  const allSections = useMemo(() => navSections(), []);
  const sections = useMemo(
    () =>
      allSections.map((s) => ({
        ...s,
        items: s.items.filter((i) => !(FOOT_IDS as ReadonlyArray<string>).includes(i.id)),
      })),
    [allSections],
  );
  const footItems = useMemo(
    () =>
      FOOT_IDS.map((id) => allSections.flatMap((s) => s.items).find((i) => i.id === id)).filter(
        (i): i is NavItem => Boolean(i),
      ),
    [allSections],
  );
  const scrollRef = useOverflowCue();
  const activeId = activeNavId(pathname, search);
  const [seen, markSeen, seenReady] = useNavSeen();
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(0);
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setCollapsed(readCollapsed());
    setNow(Date.now());
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const toggle = useCallback(() => {
    const next = !readCollapsed();
    if (next) document.documentElement.setAttribute("data-ss-nav", "collapsed");
    else document.documentElement.removeAttribute("data-ss-nav");
    try {
      window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    setCollapsed(next);
    // MapLibre on /radar sizes itself on window resize.
    window.dispatchEvent(new Event("resize"));
  }, []);

  const mockOn = new URLSearchParams(search).has("mock");

  return (
    <aside className="ss-sidebar" aria-label="Sidebar" data-testid="sidebar" data-collapsed={collapsed ? "true" : "false"}>
      <div className="ss-sb-head">
        <Link href="/" className="ss-sb-brand" aria-label="SmokySignal home">
          <span className="ss-sb-brand-full">
            <Logo size={24} wordmark />
          </span>
          <span className="ss-sb-brand-mark">
            <Logo size={28} />
          </span>
        </Link>
      </div>

      <div className="ss-sb-top">
        {desktop ? <StatusBlock mockOn={mockOn} /> : <StatusShell />}
        <button
          type="button"
          className="ss-sb-search"
          onClick={() => openSearch()}
          aria-label="Search pages, aircraft, roads and towns"
          aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
          data-testid="sidebar-search"
        >
          <NavIcon name="search" size={16} />
          <span className="ss-sb-search-label">Search</span>
          <kbd className="ss-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </div>

      <div className="ss-sb-scrollwrap" data-overflow="more">
      <nav aria-label="Site" className="ss-sb-scroll" ref={scrollRef}>
        {sections.map((s) => {
          const onRail = s.items.some((i) => i.rail);
          return (
            <section
              key={s.id}
              className="ss-sb-section"
              data-rail={onRail ? "true" : "false"}
              data-nav-section={s.id}
              aria-labelledby={`sb-${s.id}`}
            >
              <h2 id={`sb-${s.id}`} className="ss-eyebrow ss-sb-section-title">
                {s.title}
              </h2>
              {s.items.map((it) => (
                <SidebarItem
                  key={it.id}
                  item={it}
                  active={it.id === activeId}
                  isNew={seenReady && now > 0 && showNewBadge(it.id, now, seen)}
                  onPick={() => markSeen(it.id)}
                />
              ))}
              {s.id === "aircraft" && desktop ? (
                <div className="ss-sb-recent">
                  <span className="ss-sb-sublabel">Recently up</span>
                  <SidebarRecent mockOn={mockOn} pathname={pathname} />
                </div>
              ) : null}
            </section>
          );
        })}
      </nav>
      </div>

      <div className="ss-sb-foot">
        {footItems.map((it) => (
          <Link
            key={it.id}
            href={it.href}
            prefetch={false}
            className="ss-sb-pin"
            data-nav-id={it.id}
            aria-current={it.id === activeId ? "page" : undefined}
            onClick={() => markSeen(it.id)}
            title={it.label}
          >
            <NavIcon name={it.icon} size={18} />
            <span className="ss-sb-pin-label">{it.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className="ss-sb-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          data-testid="sidebar-toggle"
        >
          <span className="ss-sb-toggle-close" title="Collapse sidebar">
            <NavIcon name="chevron-left" size={18} />
          </span>
          <span className="ss-sb-toggle-open">
            <NavIcon name="chevron-right" size={18} />
          </span>
        </button>
      </div>
    </aside>
  );
}

function SidebarItem({
  item,
  active,
  isNew,
  onPick,
}: {
  item: NavItem;
  active: boolean;
  isNew: boolean;
  onPick: () => void;
}) {
  const inner = (
    <>
      <NavIcon name={item.icon} size={18} />
      <span className="ss-sb-item-label">{item.label}</span>
      {item.rail ? (
        <span className="ss-sb-rail-label" aria-hidden="true">
          {item.rail}
        </span>
      ) : null}
      {isNew ? <span className="ss-new">NEW</span> : null}
    </>
  );
  const common = {
    className: "ss-sb-item",
    "data-nav-id": item.id,
    "data-rail": item.rail ? "true" : "false",
    "aria-current": active ? ("page" as const) : undefined,
    onClick: onPick,
  };
  if (item.file) {
    return (
      <a href={item.href} {...common}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={item.href} prefetch={false} {...common}>
      {inner}
    </Link>
  );
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

/** Placeholder with the same box, so the column never jumps. */
function StatusShell() {
  return (
    <div className="ss-sb-status" data-kind="loading" aria-hidden="true">
      <span className="ss-sb-dot" />
      <span className="ss-sb-status-text">
        <span className="ss-sb-status-head">Checking the sky</span>
        <span className="ss-sb-status-sub ss-mono">&nbsp;</span>
      </span>
    </div>
  );
}

function StatusBlock({ mockOn }: { mockOn: boolean }) {
  const snap = useSharedAircraft(mockOn);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!snap) return <StatusShell />;
  const view = statusView(snap, now);
  return (
    <Link
      href="/radar"
      className="ss-sb-status"
      data-kind={view.kind}
      data-testid="sidebar-status"
      aria-label={`${view.head} ${view.sub}. Open the radar.`}
      title={view.head}
    >
      <span className="ss-sb-dot" aria-hidden="true" />
      <span className="ss-sb-status-text" aria-hidden="true">
        <span className="ss-sb-status-head">{view.head}</span>
        <span className="ss-sb-status-sub ss-mono">{view.sub}</span>
      </span>
    </Link>
  );
}

function statusView(snap: Snapshot, now: number): { kind: "alert" | "clear" | "feed_down"; head: string; sub: string } {
  if (snap.degraded) {
    const lastGood = snap.source !== "none" ? snap.fetched_at : null;
    return {
      kind: "feed_down",
      head: "Feed quiet",
      sub: lastGood ? `last read ${formatTsBare(lastGood, "hour-min")}` : "no good read yet",
    };
  }
  const status = computeStatus(snap, makeFleetMap(snap.aircraft));
  const age = fmtAge(Math.max(0, Math.floor((now - snap.fetched_at) / 1000)));
  if (status.kind === "alert") {
    return { kind: "alert", head: "Smokey’s up", sub: `${status.alertCount} up · updated ${age}` };
  }
  return {
    kind: "clear",
    head: "Smokey’s down",
    sub: `${status.totalAirborne}/${snap.aircraft.length} up · updated ${age}`,
  };
}

function SidebarRecent({ mockOn, pathname }: { mockOn: boolean; pathname: string }) {
  const snap = useSharedAircraft(mockOn);
  return <RecentlyUp variant="sidebar" snapshot={snap} pathname={pathname} limit={3} />;
}
