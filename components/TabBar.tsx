"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Five tabs, no toggles. The screen-awake switch lives in the Home
// header and on /settings; everything secondary hangs off More (/about).
type Tab = {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
  /** Extra path prefixes that light this tab up. */
  also?: string[];
};

export const TABS: Tab[] = [
  { id: "home", label: "Home", href: "/", icon: <HomeIcon /> },
  { id: "radar", label: "Radar", href: "/radar", icon: <RadarIcon /> },
  {
    id: "flights",
    label: "Flights",
    href: "/flights",
    icon: <FlightsIcon />,
    also: ["/plane"],
  },
  {
    id: "alerts",
    label: "Alerts",
    href: "/settings/alerts",
    icon: <BellIcon />,
    also: ["/settings/zones"],
  },
  {
    id: "more",
    label: "More",
    href: "/about",
    icon: <MoreIcon />,
    also: [
      "/settings",
      "/program",
      "/aircraft",
      "/circling",
      "/seen",
      "/forecast",
      "/road",
      "/stats",
      "/data",
      "/wrap",
      "/relay",
      "/legal",
    ],
  },
];

export function TabBar() {
  const pathname = usePathname() ?? "/";
  const activeId = activeTab(pathname);
  // Bottom bar on phones, left rail at >= 1024px on every tabbed route,
  // /radar included (the radar page offsets its map by the rail width).
  // Layout lives in app/globals.css (.ss-tabbar).
  return (
    <nav aria-label="Main" className="ss-tabbar" data-rail="true">
      {TABS.map((t) => {
        const active = t.id === activeId;
        return (
          <Link
            key={t.id}
            href={t.href}
            prefetch
            aria-current={active ? "page" : undefined}
            className="ss-tabbar-item"
          >
            <span style={{ lineHeight: 1, display: "flex" }}>{t.icon}</span>
            <span className="ss-tabbar-label">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Longest matching prefix wins, so /settings/alerts is Alerts, not More. */
export function activeTab(pathname: string): string | null {
  let best: { id: string; len: number } | null = null;
  for (const t of TABS) {
    for (const href of [t.href, ...(t.also ?? [])]) {
      if (matches(pathname, href) && (!best || href.length > best.len)) {
        best = { id: t.id, len: href.length };
      }
    }
  }
  return best?.id ?? null;
}

// Lucide-style "home" icon — house outline.
function HomeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

// Lucide-style list icon: tails up now and the recent feed.
function FlightsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 6H8" />
      <path d="M21 12H8" />
      <path d="M21 18H8" />
      <circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Lucide-style "ellipsis" icon: the More hub.
function MoreIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Lucide-style "bell" icon: alerts.
function BellIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

// Lucide-style "radar" icon — concentric arcs + sweep.
function RadarIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
      <path d="M4 6h.01" />
      <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
      <path d="M16.24 7.76A6 6 0 1 0 17.91 12" />
      <path d="M12 18h.01" />
      <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
      <circle cx="12" cy="12" r="2" />
      <path d="m13.41 10.59 5.66-5.66" />
    </svg>
  );
}
